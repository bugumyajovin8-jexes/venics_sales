import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useEffect, useState } from 'react';
import { SyncService } from './services/sync';
import { notifications } from './services/notifications';
import BottomNav from './components/BottomNav';
import Dashibodi from './pages/Dashibodi';
import Bidhaa from './pages/Bidhaa';
import Kikapu from './pages/Kikapu';
import Madeni from './pages/Madeni';
import Historia from './pages/Historia';
import Matumizi from './pages/Matumizi';
import Zaidi from './pages/Zaidi';
import AuditLogs from './pages/AuditLogs';
import ExecutiveDashboard from './pages/ExecutiveDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SetupShop from './pages/SetupShop';
import LicenseGuard from './components/LicenseGuard';
import { supabase } from './supabase';
import { Lock, AlertTriangle } from 'lucide-react';
import React from 'react';
import { GlobalModal } from './components/GlobalModal';
import ToastContainer from './components/ToastContainer';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center">
          <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Kuna tatizo limetokea</h1>
          <p className="text-gray-600 mb-6 max-w-md">Programu imeshindwa kuendelea. Tafadhali jaribu kupakia upya ukurasa.</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg"
          >
            Pakia Upya
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-8 p-4 bg-white border border-red-100 rounded-xl text-left text-xs overflow-auto max-w-full">
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const user = useStore(state => state.user);
  const setAuth = useStore(state => state.setAuth);
  const updateUser = useStore(state => state.updateUser);
  const logout = useStore(state => state.logout);
  const settings = useLiveQuery(() => db.settings.get(1));

  useEffect(() => {
    if (isAuthenticated) {
      notifications.initPushNotifications();
      notifications.startService();
    } else {
      notifications.stopService();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    // Listen to Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        logout();
      } else if (session && event === 'SIGNED_IN') {
        // If we just signed in, the user data is already set in Login/Register
        // But if it's a page refresh, we might need to fetch user data if it's missing from local storage
        const currentUser = useStore.getState().user;
        if (!currentUser) {
          try {
            const { data: userData } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();
              
            if (userData) {
              const localUser = {
                id: userData.id,
                email: session.user.email || '',
                name: userData.name,
                role: userData.role as any,
                shop_id: userData.shop_id,
                shopId: userData.shop_id,
                status: userData.status,
                isActive: userData.status === 'active',
                created_at: userData.created_at,
                updated_at: userData.updated_at,
                isDeleted: 0,
                synced: 1
              };
              setAuth(session.access_token, localUser);
            }
          } catch (e) {
            console.error('Failed to fetch user profile on auth state change', e);
          }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setAuth, logout]);

  useEffect(() => {
    const isBoss = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
    if (isAuthenticated && isBoss) {
      notifications.requestPermission();
      notifications.startService();
    } else {
      notifications.stopService();
    }
    return () => notifications.stopService();
  }, [isAuthenticated, user?.role]);

  // Periodic check for user status (blocking mechanism)
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      const checkStatus = async () => {
        try {
          // Master Switch: Check both user status and shop status in one query
          const { data: userData, error } = await supabase
            .from('users')
            .select('status, role, shop_id, shop:shops(status)')
            .eq('id', user.id)
            .maybeSingle();

          if (userData && !error) {
            const isUserActive = userData.status === 'active';
            const hasShop = !!userData.shop_id;
            const isShopActive = hasShop ? (userData.shop as any)?.status === 'active' : true;
            
            // Force logout if user is blocked OR if they have a shop and it is blocked
            if (!isUserActive || (hasShop && !isShopActive)) {
              await supabase.auth.signOut();
              logout('Akaunti Imezuiliwa: Tafadhali wasiliana 0787979273');
              return;
            }

            // Sync role and shop_id to prevent local privilege escalation and handle remote assignments
            if (userData.role !== user.role || userData.shop_id !== user.shop_id) {
              updateUser({ 
                role: userData.role as any,
                shop_id: userData.shop_id,
                shopId: userData.shop_id
              });
            }

            // Check for invitations if user has no shop
            if (!userData.shop_id && user.email) {
              const { data: invitation } = await supabase
                .from('shop_invitations')
                .select('*')
                .eq('email', user.email.toLowerCase())
                .maybeSingle();

              if (invitation) {
                // Update user profile with invitation data
                const { error: updateError } = await supabase
                  .from('users')
                  .update({
                    shop_id: invitation.shop_id,
                    role: invitation.role
                  })
                  .eq('id', user.id);

                if (!updateError) {
                  // Delete invitation
                  await supabase.from('shop_invitations').delete().eq('id', invitation.id);
                  
                  // Update local state
                  updateUser({
                    shop_id: invitation.shop_id,
                    shopId: invitation.shop_id,
                    role: invitation.role as any
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error('Failed to check user status', e);
        }
      };

      // Check immediately on mount/auth
      checkStatus();

      // Check every 30 seconds
      const interval = setInterval(checkStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, user?.id, user?.isActive, user?.role, user?.shop_id, user?.email]);

  useEffect(() => {
    if (isAuthenticated) {
      // Initial sync
      SyncService.sync();

      // Check for broadcast messages
      const checkBroadcasts = async () => {
        try {
          const { data: messages } = await supabase
            .from('broadcast_messages')
            .select('*')
            .eq('status', 'sent')
            .or(`target_role.eq.all,target_role.eq.${user?.role},target_ids.cs.{${user?.id}}`)
            .order('created_at', { ascending: false })
            .limit(1);

          if (messages && messages.length > 0) {
            const latestMsg = messages[0];
            const lastSeenId = localStorage.getItem('last_broadcast_id');

            if (latestMsg.id !== lastSeenId) {
              useStore.getState().showAlert(latestMsg.title, latestMsg.body);
              localStorage.setItem('last_broadcast_id', latestMsg.id);
            }
          }
        } catch (e) {
          console.error('Failed to check broadcasts', e);
        }
      };

      checkBroadcasts();

      // Sync every 30 seconds if online
      const interval = setInterval(() => {
        if (navigator.onLine) {
          SyncService.sync();
          checkBroadcasts();
        }
      }, 30 * 1000);

      // Sync when app becomes visible
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          SyncService.sync();
          checkBroadcasts();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // If authenticated but no shop_id, force setup
  const needsShopSetup = !user?.shop_id;
  const isBoss = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';

  return (
    <ErrorBoundary>
      <GlobalModal />
      <ToastContainer />
      <LicenseGuard>
        <div className={`flex flex-col h-screen bg-gray-50 ${settings?.darkMode ? 'dark' : ''}`}>
          <div className="flex-1 overflow-y-auto pb-16">
            <Routes>
              {needsShopSetup ? (
                <>
                  <Route path="/setup-shop" element={<SetupShop />} />
                  <Route path="*" element={<Navigate to="/setup-shop" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={isBoss ? <Navigate to="/executive" replace /> : <Dashibodi />} />
                  <Route path="/dashibodi" element={<Dashibodi />} />
                  <Route path="/bidhaa" element={<Bidhaa />} />
                  <Route path="/kikapu" element={<Kikapu />} />
                  <Route path="/madeni" element={<Madeni />} />
                  <Route path="/historia" element={<Historia />} />
                  <Route path="/matumizi" element={<Matumizi />} />
                  <Route path="/executive" element={<ExecutiveDashboard />} />
                  <Route path="/audit-logs" element={<AuditLogs />} />
                  <Route path="/zaidi" element={<Zaidi />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
          </div>
          {!needsShopSetup && <BottomNav />}
        </div>
      </LicenseGuard>
    </ErrorBoundary>
  );
}
