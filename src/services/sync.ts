import { db, AuditLog } from '../db';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { LicenseService } from './license';

export class SyncService {
  private static isSyncing = false;

  static async sync(force = false) {
    if (this.isSyncing || !navigator.onLine) return;
    this.isSyncing = true;

    const state = useStore.getState();
    const user = state.user;
    
    if (!user || !user.shopId) {
      this.isSyncing = false;
      return;
    }

    const shopId = user.shopId;
    const settings = await db.settings.get(1);
    const lastSync = settings?.lastSync || 0;
    const lastSyncDate = new Date(lastSync).toISOString();

    try {
      console.log('Starting sync process...');

      // 0. Sync License
      await LicenseService.syncLicense();

      // 1. Push local changes
      await Promise.allSettled([
        this.pushTable('shops', db.shops),
        this.pushTable('users', db.users),
        this.pushTable('products', db.products),
        this.pushTable('sales', db.sales),
        this.pushTable('sale_items', db.saleItems),
        this.pushTable('expenses', db.expenses),
        this.pushTable('features', db.features),
        this.pushTable('audit_logs', db.auditLogs),
        this.pushTable('debt_payments', db.debtPayments)
      ]);

      // 2. Pull remote changes (incremental)
      await Promise.allSettled([
        this.pullTable('shops', db.shops, shopId, lastSyncDate, force),
        this.pullTable('users', db.users, shopId, lastSyncDate, force),
        this.pullTable('products', db.products, shopId, lastSyncDate, force),
        this.pullTable('sales', db.sales, shopId, lastSyncDate, force),
        this.pullTable('sale_items', db.saleItems, shopId, lastSyncDate, force),
        this.pullTable('expenses', db.expenses, shopId, lastSyncDate, force),
        this.pullTable('features', db.features, shopId, lastSyncDate, force),
        this.pullTable('debt_payments', db.debtPayments, shopId, lastSyncDate, force),
        this.pullTable('audit_logs', db.auditLogs, shopId, lastSyncDate, force)
      ]);

      // 3. Update last sync time
      await db.settings.update(1, { lastSync: Date.now() });

      // 4. Update store features
      const allFeatures = await db.features.toArray();
      const featureMap: Record<string, boolean> = {};
      allFeatures.forEach(f => {
        featureMap[f.featureKey] = f.isEnabled;
      });
      useStore.getState().setFeatures(featureMap);

      console.log('Sync completed successfully');
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private static async pushTable(tableName: string, table: any) {
    const unsynced = await table.where('synced').equals(0).toArray();
    
    if (unsynced.length === 0) return;

    // Handle products as a single batch operation
    if (tableName === 'products') {
      const productsData = unsynced.map(record => {
        const { synced, ...localData } = record;
        const dataToSync = this.mapToRemote(tableName, localData);
        // Use the persistent stock_delta
        dataToSync.stock_delta = record.stock_delta || 0;
        return dataToSync;
      });

      if (productsData.length > 0) {
        const { error: rpcError } = await supabase.rpc('sync_products_with_deltas', { products_data: productsData });
        if (!rpcError) {
          for (const record of unsynced) {
            await db.transaction('rw', table, async () => {
              const current = await table.get(record.id);
              if (current) {
                // Atomically subtract the delta we just synced
                const newDelta = (current.stock_delta || 0) - (record.stock_delta || 0);
                await table.update(record.id, { 
                  synced: newDelta === 0 ? 1 : 0,
                  stock_delta: newDelta
                });
              }
            });
          }
        } else {
          console.error(`Error syncing products via RPC:`, rpcError);
        }
      }
      return;
    }

    // Standard upsert for other tables
    for (const record of unsynced) {
      const { synced, ...localData } = record;
      const dataToSync = this.mapToRemote(tableName, localData);
      
      const upsertOptions: any = { onConflict: 'id' };
      if (tableName === 'features') {
        upsertOptions.onConflict = 'shop_id, feature_key';
      }
      
      // Use insert for audit_logs since they are immutable and to avoid UPDATE policy checks
      const request = tableName === 'audit_logs' 
        ? supabase.from(tableName).insert(dataToSync)
        : supabase.from(tableName).upsert(dataToSync, upsertOptions);

      const { error: pushError } = await request;

      if (!pushError) {
        await table.update(record.id, { synced: 1 });
      } else {
        console.error(`Error syncing ${tableName} record ${record.id}:`, pushError);
        console.error(`Failed data for ${tableName}:`, dataToSync);
        if (pushError.message && (pushError.message.includes('column') || pushError.message.includes('not found'))) {
          console.warn(`Possible schema mismatch for ${tableName}. Please check if all columns exist in Supabase.`);
        }
      }
    }
  }

  private static async pullTable(tableName: string, table: any, shopId: string, lastSyncDate: string, force: boolean) {
    let query = supabase.from(tableName).select('*');
    
    if (tableName === 'shops') {
      query = query.eq('id', shopId);
    } else {
      query = query.eq('shop_id', shopId);
    }

    // Pull audit logs only for bosses
    if (tableName === 'audit_logs') {
      const role = useStore.getState().user?.role;
      if (role !== 'boss' && role !== 'admin' && role !== 'superadmin') {
        return;
      }
      query = query.eq('is_deleted', false);
    }

    // Incremental sync: only pull what's new since last sync
    if (lastSyncDate && !force && tableName !== 'shops' && tableName !== 'features') {
      query = query.gt('updated_at', lastSyncDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error pulling ${tableName}:`, error);
      return;
    }

    if (data && data.length > 0) {
      for (const record of data) {
        await db.transaction('rw', table, async () => {
          const localData = this.mapToLocal(tableName, record);
          const existing = await table.get(record.id);

          const isRemoteNewer = existing && record.updated_at && 
            new Date(record.updated_at) > new Date(existing.updated_at);
            
          const hasUnsyncedChanges = existing && existing.synced === 0;

          if (!existing) {
            const dataToStore = { ...localData, synced: 1 };
            if (tableName === 'products') {
              dataToStore.stock_delta = localData.stock_delta || 0;
            }
            await table.put(dataToStore);
          } else if (isRemoteNewer) {
            if (tableName === 'products' && hasUnsyncedChanges) {
              // Smart Merge for products: remote stock + local pending delta
              const pendingDelta = existing.stock_delta || 0;
              const remoteStock = Number(record.stock) || 0;
              const mergedStock = Math.max(0, remoteStock + pendingDelta);
              
              await table.put({ 
                ...localData, 
                stock: mergedStock,
                stock_delta: pendingDelta,
                synced: 0 // Keep unsynced because of the pending delta
              });
            } else if (!hasUnsyncedChanges) {
              // Standard overwrite if no local changes
              await table.put({ ...localData, synced: 1 });
            }
          }
        });
      }
    }
  }

  private static mapToRemote(tableName: string, data: any) {
    const mapped: any = { ...data };

    // Tables that have is_deleted column in Supabase
    const tablesWithIsDeleted = ['products', 'sales', 'sale_items', 'expenses', 'debt_payments', 'audit_logs'];

    // Handle is_deleted mapping
    if ('isDeleted' in mapped) {
      if (tablesWithIsDeleted.includes(tableName)) {
        mapped.is_deleted = mapped.isDeleted === 1;
      }
      delete mapped.isDeleted;
    }

    // Handle shop_id mapping (local uses shopId or shop_id)
    if ('shopId' in mapped) {
      if (!mapped.shop_id) {
        mapped.shop_id = mapped.shopId;
      }
      delete mapped.shopId;
    }

    // Remove internal fields
    delete mapped.synced;
    delete mapped.stock_delta;

    if (tableName === 'users') {
      mapped.status = data.status || (data.isActive ? 'active' : 'blocked');
      // Remove local aliases
      delete mapped.isActive;
    }

    if (tableName === 'sales') {
      // Supabase schema uses payment_method and status directly
      // Ensure they are valid according to the CHECK constraints
      if (mapped.payment_method === 'mobile' || mapped.payment_method === 'card') {
        mapped.payment_method = 'mobile_money';
      }
      
      // Map date to created_at if created_at is missing
      if (!mapped.created_at && mapped.date) {
        mapped.created_at = mapped.date;
      }

      // Remove fields not in Supabase schema
      delete mapped.is_credit;
      delete mapped.is_paid;
      delete mapped.date;
    }

    if (tableName === 'debt_payments') {
      // Supabase schema uses created_at, not date
      if (mapped.date) {
        mapped.created_at = mapped.date;
      }
      delete mapped.date;
    }

    if (tableName === 'features') {
      mapped.feature_key = data.featureKey;
      mapped.is_enabled = data.isEnabled;
      delete mapped.featureKey;
      delete mapped.isEnabled;
    }

    if (tableName === 'audit_logs') {
      // Supabase uses created_at, but we might have it locally
    }

    return mapped;
  }

  private static mapToLocal(tableName: string, data: any) {
    const mapped: any = { ...data };

    // Default isDeleted to 0 if not present
    mapped.isDeleted = 0;

    if ('is_deleted' in data) {
      mapped.isDeleted = data.is_deleted ? 1 : 0;
      delete mapped.is_deleted;
    }

    if (tableName === 'users') {
      mapped.isActive = data.status === 'active';
      mapped.shopId = data.shop_id;
    }

    if (tableName === 'sales') {
      // Local Sale interface expects these fields
      mapped.is_credit = data.payment_method === 'credit';
      mapped.is_paid = data.status === 'completed';
      mapped.date = data.created_at;
    }

    if (tableName === 'debt_payments') {
      mapped.date = data.created_at;
    }

    if (tableName === 'sale_items') {
      mapped.product_name = data.product_name || data.name;
    }

    if (tableName === 'features') {
      mapped.featureKey = data.feature_key;
      mapped.isEnabled = data.is_enabled;
    }

    return mapped;
  }

  static getIsSyncing() {
    return this.isSyncing;
  }

  static async logAction(action: AuditLog['action'], details: any) {
    const user = useStore.getState().user;
    if (!user || !user.shopId) return;

    // Don't log boss/admin actions for fraud detection
    const isBoss = user.role === 'boss' || user.role === 'admin' || user.role === 'superadmin';
    if (isBoss) return;

    await db.auditLogs.add({
      id: crypto.randomUUID(),
      shop_id: user.shopId,
      user_id: user.id,
      user_name: user.name,
      action,
      details,
      isDeleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: 0
    });

    // Trigger sync in background outside of any active transaction
    setTimeout(() => {
      this.sync();
    }, 0);
  }

  static async toggleFeature(key: string, isEnabled: boolean) {
    const user = useStore.getState().user;
    if (!user || !user.shopId) return;

    const existing = await db.features.where('featureKey').equals(key).first();
    const now = new Date().toISOString();

    if (existing) {
      await db.features.update(existing.id, {
        shop_id: user.shopId,
        isEnabled,
        updated_at: now,
        synced: 0
      });
    } else {
      await db.features.add({
        id: crypto.randomUUID(),
        shop_id: user.shopId,
        featureKey: key,
        isEnabled,
        updated_at: now,
        synced: 0
      });
    }

    // Update store immediately
    const currentFeatures = useStore.getState().features;
    useStore.getState().setFeatures({ ...currentFeatures, [key]: isEnabled });

    // Trigger sync
    this.sync();
  }
}
