import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format, startOfDay, startOfMonth, startOfYear, subMonths, isBefore, isAfter, addDays } from 'date-fns';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingUp, DollarSign, Package, ShieldCheck, CreditCard, ChevronRight, Calendar, Clock, X, Plus, Trash2, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SyncService } from '../services/sync';
import { v4 as uuidv4 } from 'uuid';

export default function Dashibodi() {
  const { user, showAlert, showToast, isBoss, isFeatureEnabled } = useStore();
  const navigate = useNavigate();
  const boss = isBoss();

  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';

  const sales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const minDateIso = new Date(Math.min(subMonths(new Date(), 6).getTime(), startOfYear(new Date()).getTime())).toISOString();
    return db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(s => s.created_at >= minDateIso && (boss || s.user_id === user.id))
      .toArray();
  }, [user?.shopId, boss, user?.id]) || [];

  const totalDebt = useLiveQuery(async () => {
    if (!user?.shopId) return 0;
    
    // Get all pending credit sales
    const sales = await db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(s => s.payment_method === 'credit' && s.status !== 'completed')
      .toArray();
    
    if (sales.length === 0) return 0;
    
    // Get all payments for these sales
    const saleIds = sales.map(s => s.id);
    const payments = await db.debtPayments
      .where('sale_id')
      .anyOf(saleIds)
      .toArray();
      
    let total = 0;
    sales.forEach(s => {
      const salePayments = payments.filter(p => p.sale_id === s.id && p.isDeleted === 0);
      const paidAmount = salePayments.reduce((sum, p) => sum + p.amount, 0);
      const remaining = s.total_amount - paidAmount;
      if (remaining > 0) {
        total += remaining;
      }
    });
    
    return total;
  }, [user?.shopId]) || 0;

  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    return db.products
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .toArray();
  }, [user?.shopId]) || [];

  const expenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    const monthStartIso = new Date(startOfMonth(new Date())).toISOString();
    return db.expenses
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(e => e.date >= monthStartIso && (boss || e.user_id === user.id))
      .toArray();
  }, [user?.shopId, boss, user?.id]) || [];
  const license = useLiveQuery(() => db.license.get(1));

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const monthStart = startOfMonth(now).getTime();
  const sixMonthsAgo = subMonths(now, 6).getTime();
  const yearStart = startOfYear(now).getTime();

  const isExpiryEnabled = shop?.enable_expiry === true;
  const expiredBatchesCount = isExpiryEnabled ? products.reduce((count, p) => {
    return count + (p.batches?.filter(b => isBefore(new Date(b.expiry_date), now)).length || 0);
  }, 0) : 0;

  const expiringSoonBatchesCount = isExpiryEnabled ? products.reduce((count, p) => {
    return count + (p.batches?.filter(b => {
      const expiry = new Date(b.expiry_date);
      return isAfter(expiry, now) && isBefore(expiry, addDays(now, 30));
    }).length || 0);
  }, 0) : 0;

  const todaySales = sales.filter(s => new Date(s.created_at).getTime() >= todayStart);
  const monthSales = sales.filter(s => new Date(s.created_at).getTime() >= monthStart);
  const sixMonthSales = sales.filter(s => new Date(s.created_at).getTime() >= sixMonthsAgo);
  const yearSales = sales.filter(s => new Date(s.created_at).getTime() >= yearStart);
  const monthExpenses = expenses.filter(e => new Date(e.date).getTime() >= monthStart);

  const calcTotal = (arr: any[]) => arr.reduce((sum, s) => sum + s.total_amount, 0);
  const calcProfit = (arr: any[]) => arr.reduce((sum, s) => sum + s.total_profit, 0);
  const totalMonthExpenses = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const monthNetProfit = calcProfit(monthSales) - totalMonthExpenses;

  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  const canManageStock = isBoss() || isFeatureEnabled('staff_product_management');
  const lowStockProducts = products.filter(p => p.stock <= p.min_stock);

  // License calculation
  const daysRemaining = license ? Math.max(0, Math.ceil((license.expiryDate - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  // Chart data (last 7 days)
  const chartData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayStart = startOfDay(d).getTime();
    const dayEnd = dayStart + 86400000;
    const daySales = sales.filter(s => {
      const saleTime = new Date(s.created_at).getTime();
      return saleTime >= dayStart && saleTime < dayEnd;
    });
    return {
      name: d.toLocaleDateString('sw-TZ', { weekday: 'short' }),
      Mapato: calcTotal(daySales),
    };
  });

  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const [selectedProductForStock, setSelectedProductForStock] = useState<any>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const formatInputNumber = (val: string) => {
    const numeric = val.replace(/[^0-9]/g, '');
    return numeric;
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForStock || !stockToAdd) return;

    const quantity = parseInt(stockToAdd);
    if (isNaN(quantity) || quantity <= 0) return;

    try {
      await db.transaction('rw', db.products, async () => {
        const currentProduct = await db.products.get(selectedProductForStock.id);
        if (!currentProduct) throw new Error('Bidhaa haikupatikana');

        if (isExpiryEnabled) {
          if (!expiryDate) {
            throw new Error('Tafadhali weka tarehe ya kuisha muda.');
          }
          const newBatch = {
            id: uuidv4(),
            batch_number: `B-${Date.now()}`,
            stock: quantity,
            expiry_date: new Date(expiryDate).toISOString(),
            created_at: new Date().toISOString()
          };
          const updatedBatches = [...(currentProduct.batches || []), newBatch];
          await db.products.update(currentProduct.id, {
            stock: currentProduct.stock + quantity,
            stock_delta: (currentProduct.stock_delta || 0) + quantity,
            batches: updatedBatches,
            updated_at: new Date().toISOString(),
            synced: 0
          });
        } else {
          await db.products.update(currentProduct.id, {
            stock: currentProduct.stock + quantity,
            stock_delta: (currentProduct.stock_delta || 0) + quantity,
            updated_at: new Date().toISOString(),
            synced: 0
          });
        }
      });

      setStockToAdd('');
      setExpiryDate('');
      setSelectedProductForStock(null);
      showToast('Stock imeongezwa!', 'success');
      SyncService.sync();
    } catch (error: any) {
      console.error('Error adding stock:', error);
      showToast(error.message || 'Kuna tatizo wakati wa kuongeza stock', 'error');
    }
  };

  return (
    <div className="p-4 space-y-6">
      <header className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{settings?.shopName || 'Venics Sales'}</h1>
          <div className="flex flex-col space-y-1 mt-1">
            {license ? (
              <div className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium w-fit ${daysRemaining > 5 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                {daysRemaining > 5 ? <ShieldCheck className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
                Siku {daysRemaining} zimebaki (Leseni)
              </div>
            ) : null}
            <div className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 w-fit">
              <Calendar className="w-3 h-3 mr-1" />
              {format(now, 'dd MMMM, yyyy')}
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          {isExpiryEnabled && (expiredBatchesCount > 0 || expiringSoonBatchesCount > 0) && (
            <div 
              onClick={() => navigate('/zaidi', { state: { openExpiryList: true } })}
              className="relative cursor-pointer"
            >
              <div className={`${expiredBatchesCount > 0 ? 'bg-red-100' : 'bg-orange-100'} p-2 rounded-full`}>
                <Clock className={`w-6 h-6 ${expiredBatchesCount > 0 ? 'text-red-600' : 'text-orange-600'}`} />
              </div>
              <span className={`absolute -top-1 -right-1 ${expiredBatchesCount > 0 ? 'bg-red-600' : 'bg-orange-600'} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white`}>
                {expiredBatchesCount + expiringSoonBatchesCount}
              </span>
            </div>
          )}
          {lowStockProducts.length > 0 && (
            <div 
              onClick={() => setShowLowStockModal(true)}
              className="relative cursor-pointer"
            >
              <div className="bg-red-100 p-2 rounded-full">
                <Package className="w-6 h-6 text-red-600" />
              </div>
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white">
                {lowStockProducts.length}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-500 text-white p-4 rounded-2xl shadow-sm">
          <div className="flex items-center space-x-2 opacity-80 mb-1">
            <DollarSign className="w-4 h-4" />
            <span className="text-sm font-medium">Mapato (Leo)</span>
          </div>
          <div className="text-xl font-bold">{formatCurrency(calcTotal(todaySales), currency)}</div>
        </div>
        {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') ? (
          <div className="bg-green-500 text-white p-4 rounded-2xl shadow-sm">
            <div className="flex items-center space-x-2 opacity-80 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Faida (Leo)</span>
            </div>
            <div className="text-xl font-bold">{formatCurrency(calcProfit(todaySales), currency)}</div>
          </div>
        ) : (
          <div className="bg-purple-500 text-white p-4 rounded-2xl shadow-sm">
            <div className="flex items-center space-x-2 opacity-80 mb-1">
              <ShoppingCart className="w-4 h-4" />
              <span className="text-sm font-medium">Mauzo (Leo)</span>
            </div>
            <div className="text-xl font-bold">{todaySales.length} Mauzo</div>
          </div>
        )}
      </div>

      {/* Debt Summary */}
      <div className="bg-red-500 text-white p-4 rounded-2xl shadow-sm">
        <div className="flex items-center space-x-2 opacity-80 mb-1">
          <CreditCard className="w-4 h-4" />
          <span className="text-sm font-medium">Madeni</span>
        </div>
        <div className="text-xl font-bold">{formatCurrency(totalDebt, currency)}</div>
      </div>

      {/* Quick Access Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button 
          onClick={() => navigate('/matumizi')}
          className="flex items-center justify-center py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-bold text-gray-700 active:scale-95 transition-all"
        >
          <DollarSign className="w-3.5 h-3.5 mr-1.5 text-red-500" />
          Matumizi
        </button>
        <button 
          onClick={() => navigate('/historia')}
          className="flex items-center justify-center py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-bold text-gray-700 active:scale-95 transition-all"
        >
          <Clock className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
          Historia
        </button>
      </div>

      {/* Monthly Stats */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Muhtasari wa Mwezi</h2>
          <button 
            onClick={() => navigate('/historia')}
            className="text-sm font-medium text-blue-600 flex items-center bg-blue-50 px-3 py-1 rounded-full"
          >
            Historia <ChevronRight className="w-4 h-4 ml-1" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Mapato</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(calcTotal(monthSales), currency)}</p>
          </div>
          {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
            <div>
              <p className="text-sm text-gray-500">Faida</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(calcProfit(monthSales), currency)}</p>
            </div>
          )}
          {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
            <div className="col-span-2 pt-3 border-t border-gray-50 flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Faida Halisi</p>
                <p className={`text-xl font-bold ${monthNetProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(monthNetProfit, currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400 uppercase">Matumizi</p>
                <p className="text-xs font-bold text-gray-600">{formatCurrency(totalMonthExpenses, currency)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Mapato (Siku 7 Zilizopita)</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip 
                formatter={(value: number) => formatCurrency(value, currency)}
                cursor={{fill: '#f3f4f6'}}
              />
              <Bar dataKey="Mapato" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Inventory Summary */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Hali ya Stock</h2>
          <Package className="text-gray-400 w-5 h-5" />
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">Jumla ya Bidhaa:</span>
          <span className="font-bold text-gray-900">{totalStock}</span>
        </div>
        
        <div className="space-y-3 mt-4">
          {lowStockProducts.length > 0 && (
            <div 
              onClick={() => setShowLowStockModal(true)}
              className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-start space-x-3 cursor-pointer hover:bg-red-100 transition-colors"
            >
              <AlertTriangle className="text-red-500 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Tahadhari ya Bidhaa</p>
                <p className="text-xs text-red-600 mt-1">
                  Kuna bidhaa {lowStockProducts.length} zinakaribia kuisha.
                </p>
              </div>
            </div>
          )}

          {isExpiryEnabled && expiredBatchesCount > 0 && (
            <div 
              onClick={() => navigate('/zaidi', { state: { openExpiryList: true } })}
              className="p-3 bg-red-100 rounded-xl border border-red-200 flex items-start space-x-3 cursor-pointer hover:bg-red-200 transition-colors"
            >
              <Clock className="text-red-600 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-900">Zimekwisha Muda (Expired)</p>
                <p className="text-xs text-red-700 mt-1">
                  Kuna batches {expiredBatchesCount} zimekwisha muda.
                </p>
              </div>
            </div>
          )}

          {isExpiryEnabled && expiringSoonBatchesCount > 0 && (
            <div 
              onClick={() => navigate('/zaidi', { state: { openExpiryList: true } })}
              className="p-3 bg-orange-50 rounded-xl border border-orange-100 flex items-start space-x-3 cursor-pointer hover:bg-orange-100 transition-colors"
            >
              <Clock className="text-orange-500 w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-orange-800">Zinakaribia Kuisha Muda</p>
                <p className="text-xs text-orange-600 mt-1">
                  Kuna batches {expiringSoonBatchesCount} zitakwisha muda ndani ya siku 30.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Low Stock Modal */}
      {showLowStockModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center text-red-600">
                <AlertTriangle className="w-6 h-6 mr-2" />
                <h2 className="text-xl font-bold">Bidhaa Zinazoisha</h2>
              </div>
              <button onClick={() => { setShowLowStockModal(false); setSelectedProductForStock(null); }} className="p-2 bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {lowStockProducts.length > 0 ? (
                lowStockProducts.map((product) => (
                  <div key={product.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold text-gray-800 text-lg">{product.name}</p>
                        <p className="text-sm text-red-600 font-medium">Stock: {product.stock} / Min: {product.min_stock}</p>
                      </div>
                      {canManageStock && (
                        <button 
                          onClick={() => setSelectedProductForStock(selectedProductForStock?.id === product.id ? null : product)}
                          className={`p-2 rounded-xl transition-colors ${selectedProductForStock?.id === product.id ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}
                        >
                          {selectedProductForStock?.id === product.id ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                        </button>
                      )}
                    </div>

                    {selectedProductForStock?.id === product.id && (
                      <form onSubmit={handleAddStock} className="mt-4 pt-4 border-t border-gray-200 space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Idadi ya Kuongeza</label>
                          <input 
                            autoFocus
                            required
                            type="text"
                            inputMode="numeric"
                            placeholder="Mfano: 10"
                            value={stockToAdd}
                            onChange={e => setStockToAdd(formatInputNumber(e.target.value))}
                            className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                          />
                        </div>

                        {isExpiryEnabled && (
                          <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1 flex items-center">
                              <Calendar className="w-3 h-3 mr-1" /> Tarehe ya Kuisha (Expiry)
                            </label>
                            <input 
                              type="date"
                              required
                              value={expiryDate}
                              onChange={e => setExpiryDate(e.target.value)}
                              className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        )}

                        <button 
                          type="submit"
                          className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-100"
                        >
                          Hifadhi Stock Mpya
                        </button>
                      </form>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck className="w-8 h-8 text-green-600" />
                  </div>
                  <p className="text-gray-500 font-medium">Bidhaa zote zina stock ya kutosha!</p>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => { setShowLowStockModal(false); setSelectedProductForStock(null); }}
              className="w-full mt-6 py-4 bg-gray-100 text-gray-600 font-bold rounded-2xl"
            >
              Funga
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
