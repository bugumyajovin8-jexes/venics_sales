import { useEffect, useState } from 'react';
import { LicenseService, LicenseStatus } from '../services/license';
import { AlertTriangle, Wifi, Lock, CalendarX } from 'lucide-react';
import { useStore } from '../store';

export default function LicenseGuard({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.user);
  const [status, setStatus] = useState<LicenseStatus>('VALID');
  const [daysRemaining, setDaysRemaining] = useState<number>(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await LicenseService.checkStatus();
        setStatus(res.status);
        setDaysRemaining(res.daysRemaining);
        setLoading(false);
        
        if (navigator.onLine) {
          // Try to sync in background
          await LicenseService.syncLicense();
          
          // Re-check after sync
          const afterSync = await LicenseService.checkStatus();
          setStatus(afterSync.status);
          setDaysRemaining(afterSync.daysRemaining);
        }
      } catch (e) {
        console.error('License check failed:', e);
        setLoading(false);
      }
    };
    
    check();
    
    // Check every 5 minutes
    const interval = setInterval(check, 5 * 60 * 1000);
    
    // Check when app becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);

  if (loading) return <div className="h-screen bg-gray-50 flex items-center justify-center">Inapakia...</div>;

  if (status !== 'VALID') {
    let icon = <Lock className="w-16 h-16 text-red-500 mb-4" />;
    let title = 'Akaunti Imefungwa';
    let message = 'Tafadhali wasiliana na msimamizi wako. 0787979273';

    if (status === 'EXPIRED') {
      icon = <CalendarX className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Leseni Imeisha';
      message = 'Muda wa matumizi ya mfumo umeisha. Piga 0787979273 kuongeza muda.';
    } else if (status === 'SYNC_REQUIRED') {
      icon = <Wifi className="w-16 h-16 text-orange-500 mb-4" />;
      title = 'Unganisha Mtandao';
      message = 'Mfumo unahitaji mtandao kuhakiki leseni. Tafadhali washa data au WiFi.';
    } else if (status === 'DATE_MANIPULATED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Tarehe Sio Sahihi';
      message = 'Tafadhali rekebisha tarehe na saa ya simu yako iwe sahihi.';
    } else if (status === 'TAMPERED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />;
      title = 'Hitilafu ya Usalama';
      message = 'Mfumo umegundua mabadiliko yasiyo halali kwenye faili za leseni. Tafadhali wasiliana na msimamizi wako.';
    }

    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        {icon}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">{message}</p>
        
        <button 
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold transition-colors flex items-center gap-2"
        >
          <Wifi className="w-5 h-5" />
          Hakiki Leseni Sasa
        </button>
      </div>
    );
  }

  return (
    <>
      {daysRemaining <= 5 && (
        <div className="bg-orange-500 text-white text-xs font-bold text-center py-1.5 px-4 z-50 relative shadow-sm">
          Siku {daysRemaining} zimebaki kabla ya leseni kuisha. Piga 0787979273 kupata leseni mapema.
        </div>
      )}
      {children}
    </>
  );
}
