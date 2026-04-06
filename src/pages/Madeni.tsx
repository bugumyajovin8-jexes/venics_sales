import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Sale } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { format } from 'date-fns';
import { CheckCircle, Phone, User, History, Plus, X, CreditCard } from 'lucide-react';
import { SyncService } from '../services/sync';
import { v4 as uuidv4 } from 'uuid';

export default function Madeni() {
  const { user, showConfirm, showAlert } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';

  const [selectedDebt, setSelectedDebt] = useState<Sale | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [showHistory, setShowHistory] = useState<string | null>(null);
  
  const allSales = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.sales.filter(s => s.isDeleted !== 1 && s.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];
  
  const saleItems = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.saleItems.filter(i => i.isDeleted !== 1 && i.shop_id === user.shopId).toArray();
  }, [user?.shopId]) || [];

  const debtPayments = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.debtPayments
      .where('shop_id')
      .equals(user.shopId)
      .filter(p => p.isDeleted !== 1)
      .toArray();
  }, [user?.shopId]) || [];
  
  const unpaidDebts = allSales
    .filter(s => s.payment_method === 'credit' && s.status === 'pending')
    .filter(s => {
      const payments = debtPayments.filter(p => p.sale_id === s.id);
      const paid = payments.reduce((sum, p) => sum + p.amount, 0);
      return (s.total_amount - paid) > 0.1; // Only show if balance is more than 0.1
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  const totalDebt = unpaidDebts.reduce((sum, debt) => {
    const payments = debtPayments.filter(p => p.sale_id === debt.id);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    return sum + Math.max(0, debt.total_amount - paid);
  }, 0);

  const handleRecordPayment = async (saleId: string, amount: number) => {
    if (amount <= 0 || !user?.shopId) return;
    
    const sale = await db.sales.get(saleId);
    if (!sale) return;

    // Fetch current payments from DB to ensure accuracy
    const currentPayments = await db.debtPayments.where('sale_id').equals(saleId).toArray();
    const totalPaidSoFar = currentPayments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = sale.total_amount - totalPaidSoFar;

    // Use a small epsilon (0.1) to handle floating point rounding issues
    if (amount > (remaining + 0.1)) {
      showAlert('Kosa', `Kiasi unacholipa (${formatCurrency(amount, currency)}) ni kikubwa kuliko deni lililobaki (${formatCurrency(remaining, currency)})`);
      return;
    }

    const paymentId = uuidv4();
    const now = new Date().toISOString();
    await db.debtPayments.add({
      id: paymentId,
      shop_id: user.shopId,
      sale_id: saleId,
      amount: amount,
      date: now,
      isDeleted: 0,
      created_at: now,
      updated_at: now,
      synced: 0
    });

    // If the new total paid is equal to or very close to the total amount, mark as completed
    if ((totalPaidSoFar + amount) >= (sale.total_amount - 0.1)) {
      await db.sales.update(saleId, {
        status: 'completed',
        updated_at: new Date().toISOString(),
        synced: 0
      });
    } else {
      await db.sales.update(saleId, {
        updated_at: new Date().toISOString(),
        synced: 0
      });
    }
    
    SyncService.sync();
    setSelectedDebt(null);
    setPaymentAmount('');
  };

  const handleFullPayment = (debt: Sale) => {
    const payments = debtPayments.filter(p => p.sale_id === debt.id);
    const totalPaidSoFar = payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = debt.total_amount - totalPaidSoFar;

    showConfirm('Thibitisha Malipo', `Je, unathibitisha kuwa deni lote la ${formatCurrency(remaining, currency)} limelipwa?`, () => {
      handleRecordPayment(debt.id, remaining);
    });
  };

  return (
    <div className="p-4 flex flex-col h-full relative">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Madeni</h1>

      <div className="bg-red-50 p-4 rounded-2xl border border-red-100 mb-6">
        <p className="text-sm text-red-800 mb-1">Jumla ya Madeni Yote</p>
        <p className="text-2xl font-bold text-red-600">{formatCurrency(totalDebt, currency)}</p>
      </div>

      <h2 className="text-lg font-semibold text-gray-800 mb-3">Orodha ya Wanaodaiwa</h2>
      
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {unpaidDebts.length === 0 ? (
          <div className="text-center text-gray-500 py-10">
            Hakuna madeni yoyote.
          </div>
        ) : (
          unpaidDebts.map(debt => {
            const payments = debtPayments.filter(p => p.sale_id === debt.id);
            const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
            const remaining = debt.total_amount - totalPaid;

            return (
              <div key={debt.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-800 flex items-center">
                      <User className="w-4 h-4 mr-1.5 text-gray-400" />
                      {debt.customer_name}
                    </h3>
                    {debt.customer_phone && (
                      <p className="text-sm text-gray-500 flex items-center mt-1">
                        <Phone className="w-3 h-3 mr-1.5" />
                        {debt.customer_phone}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-red-600">{formatCurrency(remaining, currency)}</div>
                    <div className="text-[10px] text-gray-400 uppercase font-bold">Baki</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-gray-50 p-2 rounded-lg">
                    <p className="text-[10px] text-gray-400 uppercase font-bold">Jumla ya Deni</p>
                    <p className="text-xs font-bold text-gray-700">{formatCurrency(debt.total_amount, currency)}</p>
                  </div>
                  <div className="bg-green-50 p-2 rounded-lg">
                    <p className="text-[10px] text-green-400 uppercase font-bold">Zilizolipwa</p>
                    <p className="text-xs font-bold text-green-700">{formatCurrency(totalPaid, currency)}</p>
                  </div>
                </div>

                <div className="mb-3 bg-gray-50 p-2 rounded-lg">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Bidhaa:</p>
                    <button 
                      onClick={() => setShowHistory(showHistory === debt.id ? null : debt.id)}
                      className="text-[10px] font-bold text-blue-600 uppercase flex items-center"
                    >
                      <History className="w-3 h-3 mr-1" /> Historia
                    </button>
                  </div>
                  <div className="space-y-1">
                    {saleItems.filter(i => i.sale_id === debt.id).map((item, idx) => (
                      <div key={idx} className="text-xs text-gray-700 flex justify-between">
                        <span>{item.product_name} x{item.qty}</span>
                        <span>{formatCurrency(item.sell_price * item.qty, currency)}</span>
                      </div>
                    ))}
                  </div>

                  {showHistory === debt.id && payments.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-gray-200">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Historia ya Malipo:</p>
                      <div className="space-y-1">
                        {payments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((p, idx) => (
                          <div key={idx} className="text-[10px] text-gray-600 flex justify-between">
                            <span>{format(new Date(p.created_at), 'dd/MM/yyyy HH:mm')}</span>
                            <span className="font-bold text-green-600">+{formatCurrency(p.amount, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button 
                    onClick={() => setSelectedDebt(debt)}
                    className="flex-1 flex items-center justify-center text-xs font-bold text-blue-600 bg-blue-50 py-2 rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Lipa Kidogo
                  </button>
                  <button 
                    onClick={() => handleFullPayment(debt)}
                    className="flex-1 flex items-center justify-center text-xs font-bold text-green-600 bg-green-50 py-2 rounded-lg"
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    Lipa Zote
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Partial Payment Modal */}
      {selectedDebt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">Rekodi Malipo</h3>
              <button onClick={() => setSelectedDebt(null)} className="p-1 text-gray-400">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Mteja: <span className="font-bold text-gray-800">{selectedDebt.customer_name}</span></p>
              <p className="text-sm text-gray-500">Deni Lililobaki: <span className="font-bold text-red-600">{formatCurrency(selectedDebt.total_amount - (debtPayments.filter(p => p.sale_id === selectedDebt.id).reduce((s, p) => s + p.amount, 0)), currency)}</span></p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Kiasi cha Malipo</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Weka kiasi..."
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-bold text-lg"
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setSelectedDebt(null)}
                  className="py-3 bg-gray-100 text-gray-600 rounded-xl font-bold"
                >
                  Ghairi
                </button>
                <button 
                  onClick={() => handleRecordPayment(selectedDebt.id, Number(paymentAmount))}
                  disabled={!paymentAmount || Number(paymentAmount) <= 0}
                  className="py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md shadow-blue-200 disabled:opacity-50"
                >
                  Hifadhi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
