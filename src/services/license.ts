import { db, type License } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { generateHMAC, verifyHMAC } from '../utils/encryption';

export type LicenseStatus = 'VALID' | 'EXPIRED' | 'BLOCKED' | 'DATE_MANIPULATED' | 'SYNC_REQUIRED' | 'TAMPERED';

export class LicenseService {
  private static getLicensePayload(license: Partial<License>): string {
    // Only sign critical fields to detect tampering
    return `${license.deviceId}-${license.startDate}-${license.expiryDate}-${license.isActive}`;
  }

  static async getLocalLicense() {
    let license = await db.license.get(1);
    if (!license) {
      const user = useStore.getState().user;
      // Only create a trial license if we have a shopId (meaning we are in a shop context)
      // or if we are the boss setting up.
      if (!user?.shopId && user?.role !== 'boss') {
        return null;
      }

      const now = Date.now();
      const newLicense: Partial<License> = {
        id: 1,
        deviceId: uuidv4(),
        startDate: now,
        expiryDate: now + (14 * 24 * 60 * 60 * 1000), // 14 days trial
        isActive: true,
        lastVerifiedAt: now
      };
      
      // Sign the initial license
      newLicense.signature = generateHMAC(this.getLicensePayload(newLicense));
      await db.license.add(newLicense as License);
      license = newLicense as License;
    }
    return license;
  }

  static async checkStatus(): Promise<{ status: LicenseStatus, daysRemaining: number }> {
    const user = useStore.getState().user;
    
    // If no shop yet, allow access to setup
    if (!user?.shopId) {
      return { status: 'VALID', daysRemaining: 14 };
    }

    const license = await this.getLocalLicense();
    if (!license) {
      return { status: 'VALID', daysRemaining: 14 };
    }

    const now = Date.now();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    const daysRemaining = Math.ceil((license.expiryDate - now) / (24 * 60 * 60 * 1000));

    // 1. Check for Tampering (HMAC Signature)
    const currentPayload = this.getLicensePayload(license);
    if (!license.signature || !verifyHMAC(currentPayload, license.signature)) {
      return { status: 'TAMPERED', daysRemaining };
    }

    if (!license.isActive) return { status: 'BLOCKED', daysRemaining };
    
    // 2. Anti-cheat: Offline Date Manipulation
    if (now < license.lastVerifiedAt - 120000) {
      return { status: 'DATE_MANIPULATED', daysRemaining };
    }
    
    if (now > license.expiryDate) return { status: 'EXPIRED', daysRemaining };
    
    // 3. Forced Sync: If it's been more than 5 days since the last sync, require a sync
    if (now - license.lastVerifiedAt > fiveDays) return { status: 'SYNC_REQUIRED', daysRemaining };

    // Update lastVerifiedAt locally to track time progress.
    if (now > license.lastVerifiedAt) {
      await db.license.update(1, { lastVerifiedAt: now });
    }

    return { status: 'VALID', daysRemaining };
  }

  static async syncLicense() {
    const user = useStore.getState().user;
    if (!user || !user.shopId || !navigator.onLine) return;

    const shopId = user.shopId;

    try {
      // Fetch both license and server time
      const [licenseRes, serverTimeRes] = await Promise.all([
        supabase.from('licenses').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.rpc('get_server_time')
      ]);

      const { data: remote, error } = licenseRes;
      const serverTimeData = serverTimeRes.data;
        
      if (error) {
        console.error('Error fetching license from Supabase:', error);
        return;
      }

      const serverTime = serverTimeData ? new Date(serverTimeData).getTime() : Date.now();
      const localTime = Date.now();

      // 4. Server-Time Heartbeat: Check for "Frozen Time" or "Future Time"
      // If server time and local time differ by more than 1 hour, it's suspicious
      if (Math.abs(serverTime - localTime) > 3600000) {
        console.warn('Significant time drift detected between server and local clock');
      }
      
      const currentLicense = await this.getLocalLicense();
      if (!currentLicense) return;

      if (remote) {
        const updatedLicense: Partial<License> = {
          expiryDate: new Date(remote.expiry_date).getTime(),
          isActive: remote.status === 'active',
          lastVerifiedAt: serverTime // Use server time as the new baseline
        };

        // Re-sign the license after update
        const mergedLicense = { ...currentLicense, ...updatedLicense };
        updatedLicense.signature = generateHMAC(this.getLicensePayload(mergedLicense));

        await db.license.update(1, updatedLicense);
      } else {
        // If no remote license, push the local one to Supabase
        const { error: insertError } = await supabase
          .from('licenses')
          .insert({
            shop_id: shopId,
            status: 'active',
            expiry_date: new Date(currentLicense.expiryDate).toISOString(),
            created_at: new Date(currentLicense.startDate).toISOString()
          });

        if (insertError) {
          console.error('Error creating remote license:', insertError);
        }

        // Even if no remote license, update lastVerifiedAt with server time
        const updated: Partial<License> = { lastVerifiedAt: serverTime };
        updated.signature = generateHMAC(this.getLicensePayload({ ...currentLicense, ...updated }));
        await db.license.update(1, updated);
      }
    } catch (e) {
      console.error('License sync failed', e);
    }
  }
}
