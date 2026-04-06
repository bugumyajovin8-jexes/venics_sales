import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format, startOfDay, startOfWeek, startOfMonth, subMonths, startOfYear, eachDayOfInterval, subDays } from 'date-fns';
import { Receipt, Calendar, Download, TrendingUp, BarChart3, ArrowUpRight, ArrowDownRight, RotateCcw, AlertCircle } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { SyncService } from '../services/sync';
import { notifications } from '../services/notifications';

export default function Historia() {
  const { user, isBoss } = useStore();
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  
  const [view, setView] = useState<'risiti' | 'ripoti'>('risiti');
  const [filter, setFilter] = useState('leo'); // leo, wiki, mwezi, miezi6, mwaka, yote
  const [reportType, setReportType] = useState<'mwezi' | 'mwaka'>('mwezi');
  const [topProductsMetric, setTopProductsMetric] = useState<'qty' | 'profit'>('qty');
  const [reversingSaleId, setReversingSaleId] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  
  const boss = isBoss();
  
  const sales = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    let startDateNum = 0;
    const n = new Date();
    switch(filter) {
      case 'leo': startDateNum = startOfDay(n).getTime(); break;
      case 'wiki': startDateNum = startOfWeek(n).getTime(); break;
      case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
      case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
      case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
      default: startDateNum = 0; break;
    }
    
    const minDate = Math.min(startDateNum, subDays(n, 30).getTime());
    const minIso = new Date(minDate).toISOString();

    return db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(s => s.created_at >= minIso && (boss || s.user_id === user.id))
      .reverse()
      .sortBy('created_at');
  }, [user?.shopId, filter, boss, user?.id]) || [];

  const saleItems = useLiveQuery(async () => {
    if (!user?.shopId || sales.length === 0) return [];
    const saleIds = new Set(sales.map(s => s.id));
    return db.saleItems
      .where('shop_id')
      .equals(user.shopId)
      .filter(i => i.isDeleted !== 1 && saleIds.has(i.sale_id))
      .toArray();
  }, [user?.shopId, sales]) || [];
  
  const expenses = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    let startDateNum = 0;
    const n = new Date();
    switch(filter) {
      case 'leo': startDateNum = startOfDay(n).getTime(); break;
      case 'wiki': startDateNum = startOfWeek(n).getTime(); break;
      case 'mwezi': startDateNum = startOfMonth(n).getTime(); break;
      case 'miezi6': startDateNum = subMonths(n, 6).getTime(); break;
      case 'mwaka': startDateNum = startOfYear(n).getTime(); break;
      default: startDateNum = 0; break;
    }
    const minIso = new Date(startDateNum).toISOString();

    return db.expenses
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(e => e.date >= minIso && (boss || e.user_id === user.id))
      .reverse()
      .sortBy('date');
  }, [user?.shopId, filter, boss, user?.id]) || [];

  const now = new Date();
  const getStartDate = () => {
    switch(filter) {
      case 'leo': return startOfDay(now).getTime();
      case 'wiki': return startOfWeek(now).getTime();
      case 'mwezi': return startOfMonth(now).getTime();
      case 'miezi6': return subMonths(now, 6).getTime();
      case 'mwaka': return startOfYear(now).getTime();
      default: return 0;
    }
  };

  const startDate = getStartDate();
  const filteredSales = sales.filter(s => new Date(s.created_at).getTime() >= startDate);
  const filteredExpenses = expenses.filter(e => new Date(e.date).getTime() >= startDate);

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalProfit = filteredSales.reduce((sum, s) => sum + s.total_profit, 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Show net profit for all filters
  const showNetProfit = true;
  const netProfit = totalProfit - totalExpenses;

  // Chart Data: Revenue Trend (Last 30 days)
  const trendData = useMemo(() => {
    const last30Days = eachDayOfInterval({
      start: subDays(now, 29),
      end: now
    });

    return last30Days.map(day => {
      const dayStart = startOfDay(day).getTime();
      const dayEnd = dayStart + 86400000;
      const daySales = sales.filter(s => {
        const t = new Date(s.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      });
      return {
        date: format(day, 'dd/MM'),
        Mapato: daySales.reduce((sum, s) => sum + s.total_amount, 0),
        Faida: daySales.reduce((sum, s) => sum + s.total_profit, 0)
      };
    });
  }, [sales]);

  // Chart Data: Top 10 Products
  const topProductsData = useMemo(() => {
    const productStats: Record<string, { name: string, qty: number, profit: number }> = {};
    
    saleItems.forEach(item => {
      if (!productStats[item.product_id]) {
        productStats[item.product_id] = { name: item.product_name, qty: 0, profit: 0 };
      }
      productStats[item.product_id].qty += item.qty;
      productStats[item.product_id].profit += (item.sell_price - item.buy_price) * item.qty;
    });

    return Object.values(productStats)
      .sort((a, b) => topProductsMetric === 'qty' ? b.qty - a.qty : b.profit - a.profit)
      .slice(0, 10)
      .map(p => ({
        name: p.name.length > 12 ? p.name.substring(0, 10) + '..' : p.name,
        value: topProductsMetric === 'qty' ? p.qty : p.profit
      }));
  }, [saleItems, topProductsMetric]);

  const handleReverseSale = async (saleId: string) => {
    if (!user?.shopId) return;
    setIsReversing(true);
    
    try {
      await db.transaction('rw', [db.sales, db.saleItems, db.products, db.debtPayments, db.auditLogs], async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error('Sale not found');
        
        const items = await db.saleItems.where('sale_id').equals(saleId).toArray();
        
        // 1. Return stock to products
        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            let updatedBatches = product.batches ? JSON.parse(JSON.stringify(product.batches)) : [];
            
            if (updatedBatches.length > 0) {
              // Return to the first non-expired batch, or the first one if all expired
              let returned = false;
              for (let i = 0; i < updatedBatches.length; i++) {
                const isExpired = updatedBatches[i].expiry_date && new Date(updatedBatches[i].expiry_date) < new Date();
                if (!isExpired) {
                  updatedBatches[i].stock = Number(updatedBatches[i].stock) + item.qty;
                  returned = true;
                  break;
                }
              }
              if (!returned) {
                updatedBatches[0].stock = Number(updatedBatches[0].stock) + item.qty;
              }
            }
            
            await db.products.update(item.product_id, {
              stock: Number(product.stock) + item.qty,
              stock_delta: (product.stock_delta || 0) + item.qty,
              batches: updatedBatches,
              updated_at: new Date().toISOString(),
              synced: 0
            });
          }
        }
        
        // 2. Soft delete sale and items
        await db.sales.update(saleId, { 
          isDeleted: 1, 
          status: 'refunded',
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // Trigger Audit Alert for Boss
        if (sale) {
          notifications.sendAuditAlert(sale.total_amount, user?.name || 'Employee');
        }
        
        const itemIds = items.map(i => i.id);
        await db.saleItems.where('id').anyOf(itemIds).modify({ 
          isDeleted: 1,
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // 3. Soft delete debt payments if any
        await db.debtPayments.where('sale_id').equals(saleId).modify({
          isDeleted: 1,
          updated_at: new Date().toISOString(),
          synced: 0 
        });

        // 4. Log to audit logs for the boss to see
        await SyncService.logAction('refund_sale', {
          sale_id: saleId,
          amount: sale.total_amount,
          items: items.map(i => ({ name: i.product_name, qty: i.qty })),
          customer: sale.customer_name
        });
      });
      
      setReversingSaleId(null);
      SyncService.sync();
    } catch (error: any) {
      console.error('Failed to reverse sale:', error);
      alert('Imeshindwa kurudisha mauzo: ' + error.message);
    } finally {
      setIsReversing(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Tarehe', 'Kiasi', 'Faida', 'Aina', 'Mteja'];
    const rows = filteredSales.map(s => [
      format(new Date(s.created_at), 'yyyy-MM-dd HH:mm'),
      s.total_amount,
      s.total_profit,
      s.payment_method === 'credit' ? 'Mkopo' : 'Taslimu',
      s.customer_name || 'Taslimu'
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mauzo_${filter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate Reports Data
  const reportData = useMemo(() => {
    const groups: Record<string, { mapato: number, faida: number, matumizi: number, mauzo: number }> = {};
    
    sales.filter(sale => !sale.isDeleted).forEach(sale => {
      const date = new Date(sale.created_at);
      const dateStr = reportType === 'mwezi' 
        ? format(date, 'MMM yyyy') 
        : format(date, 'yyyy');
        
      if (!groups[dateStr]) {
        groups[dateStr] = { mapato: 0, faida: 0, matumizi: 0, mauzo: 0 };
      }
      groups[dateStr].mapato += sale.total_amount;
      groups[dateStr].faida += sale.total_profit;
      groups[dateStr].mauzo += 1;
    });

    expenses.forEach(expense => {
      const date = new Date(expense.date);
      const dateStr = reportType === 'mwezi' 
        ? format(date, 'MMM yyyy') 
        : format(date, 'yyyy');
        
      if (groups[dateStr]) {
        groups[dateStr].matumizi += expense.amount;
      } else {
        // Even if no sales, we might have expenses
        groups[dateStr] = { mapato: 0, faida: 0, matumizi: expense.amount, mauzo: 0 };
      }
    });

    return Object.entries(groups).map(([label, data]) => ({
      label,
      ...data,
      faidaHalisi: data.faida - data.matumizi
    })).sort((a, b) => {
      // Sort by date descending
      const parseDate = (s: string) => {
        if (reportType === 'mwaka') return new Date(parseInt(s), 0, 1).getTime();
        return new Date(s).getTime();
      };
      return parseDate(b.label) - parseDate(a.label);
    });
  }, [sales, expenses, reportType]);

  return (
    <div className="p-4 flex flex-col h-full">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Historia ya Mauzo</h1>

      {/* View Toggle */}
      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
        <div className="flex bg-gray-200 p-1 rounded-xl mb-6">
          <button 
            onClick={() => setView('risiti')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg flex justify-center items-center transition-colors ${view === 'risiti' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
          >
            <Receipt className="w-4 h-4 mr-2" /> Risiti
          </button>
          <button 
            onClick={() => setView('ripoti')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg flex justify-center items-center transition-colors ${view === 'ripoti' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
          >
            <BarChart3 className="w-4 h-4 mr-2" /> Ripoti
          </button>
        </div>
      )}

      {view === 'risiti' ? (
        <>
          <div className="flex space-x-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
            {[
              { id: 'leo', label: 'Leo' },
              { id: 'wiki', label: 'Wiki Hii' },
              { id: 'mwezi', label: 'Mwezi Huu' },
              { id: 'miezi6', label: 'Miezi 6' },
              { id: 'mwaka', label: 'Mwaka Huu' },
              { id: 'yote', label: 'Yote' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
                  filter === f.id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className={`bg-white p-3 rounded-xl border border-gray-200 shadow-sm ${(user?.role === 'employee' || user?.role === 'staff' || user?.role === 'cashier' || user?.role === 'manager') ? 'col-span-2' : ''}`}>
              <p className="text-xs text-gray-500 mb-1">Jumla ya Mapato</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(totalRevenue, currency)}</p>
            </div>
            {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">Jumla ya Faida</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(totalProfit, currency)}</p>
              </div>
            )}
            {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && showNetProfit && (
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 shadow-sm col-span-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-blue-600 mb-1 font-semibold">Faida Halisi (Baada ya Matumizi)</p>
                    <p className={`text-xl font-bold ${netProfit >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                      {formatCurrency(netProfit, currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-blue-500 uppercase font-bold">Matumizi</p>
                    <p className="text-sm font-bold text-gray-700">{formatCurrency(totalExpenses, currency)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Risiti za Mauzo</h2>
            <button onClick={exportCSV} className="text-blue-600 flex items-center text-sm font-medium">
              <Download className="w-4 h-4 mr-1" /> Pakua CSV
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {filteredSales.length === 0 ? (
              <div className="text-center text-gray-500 py-10">
                Hakuna mauzo katika kipindi hiki.
              </div>
            ) : (
              filteredSales.map(sale => (
                <div key={sale.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center text-gray-600 text-sm">
                      <Calendar className="w-4 h-4 mr-1.5" />
                      {format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${sale.payment_method === 'credit' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                      {sale.payment_method === 'credit' ? 'Mkopo' : 'Taslimu'}
                    </span>
                  </div>
                  <div className="flex justify-between items-end mt-3">
                    <div className="text-sm text-gray-500">
                      <div className="font-medium text-gray-700">
                        {saleItems.filter(i => i.sale_id === sale.id).map(i => i.product_name).join(', ')}
                      </div>
                      Idadi: {saleItems.filter(i => i.sale_id === sale.id).reduce((a, b) => a + b.qty, 0)}
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="font-bold text-gray-900">{formatCurrency(sale.total_amount, currency)}</div>
                      {(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss') && (
                        <div className="text-xs text-green-600 mb-2">Faida: {formatCurrency(sale.total_profit, currency)}</div>
                      )}
                      
                      {isAuthenticated && (
                        <button 
                          onClick={() => setReversingSaleId(sale.id)}
                          className="flex items-center text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" /> RUDISHA MAUZO
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Reverse Sale Confirmation Modal */}
          {reversingSaleId && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
                <div className="flex items-center text-red-600 mb-4">
                  <AlertCircle className="w-6 h-6 mr-2" />
                  <h3 className="text-lg font-bold">Rudisha Mauzo?</h3>
                </div>
                <p className="text-gray-600 mb-6 text-sm">
                  Je, una uhakika unataka kurudisha mauzo haya? 
                  <br /><br />
                  <span className="font-bold text-red-600">Hii itarudisha bidhaa kwenye stock na kufuta rekodi hii ya mauzo.</span>
                </p>
                <div className="flex space-x-3">
                  <button 
                    onClick={() => setReversingSaleId(null)}
                    disabled={isReversing}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl disabled:opacity-50"
                  >
                    Hapana
                  </button>
                  <button 
                    onClick={() => handleReverseSale(reversingSaleId)}
                    disabled={isReversing}
                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-200 disabled:opacity-50 flex items-center justify-center"
                  >
                    {isReversing ? 'Inarudisha...' : 'Ndio, Rudisha'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pb-4 scrollbar-hide">
          {/* Revenue Trend Chart */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Mwenendo wa Mapato (Siku 30)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis 
                    dataKey="date" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                    interval={4}
                  />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v/1000}k`} />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value, currency)}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line type="monotone" dataKey="Mapato" stroke="#3b82f6" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="Faida" stroke="#10b981" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center space-x-4 mt-2">
              <div className="flex items-center text-xs text-gray-500">
                <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div> Mapato
              </div>
              <div className="flex items-center text-xs text-gray-500">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div> Faida
              </div>
            </div>
          </div>

          {/* Top Products Chart */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Bidhaa 10 Zinazoongoza</h2>
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button 
                  onClick={() => setTopProductsMetric('qty')}
                  className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${topProductsMetric === 'qty' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                >
                  Idadi
                </button>
                <button 
                  onClick={() => setTopProductsMetric('profit')}
                  className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${topProductsMetric === 'profit' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                >
                  Faida
                </button>
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductsData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    fontSize={10} 
                    width={80} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <Tooltip 
                    formatter={(value: number) => topProductsMetric === 'qty' ? value : formatCurrency(value, currency)}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar 
                    dataKey="value" 
                    fill={topProductsMetric === 'qty' ? '#8b5cf6' : '#10b981'} 
                    radius={[0, 4, 4, 0]} 
                    barSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex space-x-2 mb-2">
            <button
              onClick={() => setReportType('mwezi')}
              className={`flex-1 py-2 rounded-xl text-sm font-medium ${reportType === 'mwezi' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              Kila Mwezi
            </button>
            <button
              onClick={() => setReportType('mwaka')}
              className={`flex-1 py-2 rounded-xl text-sm font-medium ${reportType === 'mwaka' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              Kila Mwaka
            </button>
          </div>

          <div className="space-y-4">
            {reportData.length === 0 ? (
              <div className="text-center text-gray-500 py-10">
                Hakuna data ya ripoti.
              </div>
            ) : (
              reportData.map((report, idx) => (
                <div key={idx} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
                    <h3 className="font-bold text-gray-800 text-lg flex items-center">
                      <Calendar className="w-5 h-5 mr-2 text-blue-500" />
                      {report.label}
                    </h3>
                    <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                      Mauzo {report.mauzo}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 flex justify-between items-center pb-2 border-b border-gray-50">
                      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Mapato</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(report.mapato, currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Jumla ya Faida</p>
                      <p className="text-lg font-bold text-green-600">{formatCurrency(report.faida, currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Faida Halisi</p>
                      <p className={`text-lg font-bold flex items-center ${report.faidaHalisi >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {report.faidaHalisi >= 0 ? <ArrowUpRight className="w-4 h-4 mr-1" /> : <ArrowDownRight className="w-4 h-4 mr-1" />}
                        {formatCurrency(report.faidaHalisi, currency)}
                      </p>
                      {report.matumizi > 0 && (
                        <p className="text-[10px] text-gray-400 mt-1">Matumizi: {formatCurrency(report.matumizi, currency)}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
