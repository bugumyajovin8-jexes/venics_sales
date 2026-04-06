import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Expense } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { Plus, Trash2, Calendar, Tag, FileText, Wallet } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { SyncService } from '../services/sync';
import { format } from 'date-fns';

const CATEGORIES = [
  'Kodi',
  'Umeme',
  'Maji',
  'Usafiri',
  'Mishahara',
  'Chakula',
  'Matengenezo',
  'Mengineyo'
];

export default function Matumizi() {
  const { user, showConfirm, showAlert } = useStore();
  const settings = useLiveQuery(() => db.settings.get(1));
  const currency = settings?.currency || 'TZS';
  const expenses = useLiveQuery(() => {
    if (!user?.shopId) return [];
    return db.expenses.filter(e => e.isDeleted !== 1 && e.shop_id === user.shopId).reverse().toArray();
  }, [user?.shopId]) || [];
  
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState('');

  const formatInputNumber = (val: string) => {
    const num = val.replace(/[^0-9]/g, '');
    if (!num) return '';
    return Number(num).toLocaleString();
  };

  const parseInputNumber = (val: string) => {
    return Number(val.replace(/,/g, '')) || 0;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData(e.currentTarget);
      
      const rawAmount = parseInputNumber(formAmount);
      const expense: Expense = {
        id: uuidv4(),
        shop_id: user?.shopId || '',
        amount: rawAmount,
        category: formData.get('category') as string,
        description: (formData.get('description') as string)?.trim() || 'Maelezo hayakuwekwa',
        date: formData.get('date') as string || new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 0
      };

      await db.expenses.add(expense);
      
      // Log audit for boss to see
      await SyncService.logAction('add_expense', {
        category: expense.category,
        amount: rawAmount,
        description: expense.description
      });

      setIsAdding(false);
      setFormAmount('');
      SyncService.sync().catch(err => console.error('Sync failed:', err));
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      setError('Imeshindwa kuhifadhi matumizi. Tafadhali jaribu tena.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    const isBoss = user?.role === 'admin' || user?.role === 'boss';
    if (!isBoss) {
      showAlert('Kizuizi', 'Huna ruhusa ya kufuta matumizi haya.');
      return;
    }
    showConfirm('Futa Matumizi', 'Una uhakika unataka kufuta matumizi haya?', async () => {
      await db.expenses.update(id, { 
        isDeleted: 1,
        updated_at: new Date().toISOString(),
        synced: 0
      });
      SyncService.sync();
    });
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  if (isAdding) {
    return (
      <div className="p-4">
        <div className="flex items-center mb-6">
          <button 
            onClick={() => setIsAdding(false)}
            className="text-blue-600 font-medium mr-4"
          >
            Nyuma
          </button>
          <h1 className="text-xl font-bold text-gray-800">Ongeza Matumizi</h1>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kiasi (Amount)</label>
            <input 
              required 
              type="text" 
              inputMode="numeric" 
              value={formAmount}
              onChange={e => setFormAmount(formatInputNumber(e.target.value))}
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold" 
              placeholder="0"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kundi (Category)</label>
            <select 
              required 
              name="category" 
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Maelezo (Description)</label>
            <textarea 
              name="description" 
              rows={3}
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Elezea matumizi haya..."
            ></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tarehe</label>
            <input 
              type="date" 
              name="date" 
              defaultValue={new Date().toISOString().split('T')[0]}
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl mt-6 shadow-lg shadow-blue-100"
          >
            {loading ? 'Inahifadhi...' : 'Hifadhi Matumizi'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Matumizi</h1>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-blue-600 text-white p-3 rounded-2xl shadow-lg shadow-blue-100"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      <div className="bg-orange-500 text-white p-6 rounded-3xl shadow-lg mb-8 relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-orange-100 text-sm font-medium mb-1">Jumla ya Matumizi</p>
          <p className="text-3xl font-bold">{formatCurrency(totalExpenses, currency)}</p>
        </div>
        <Wallet className="absolute -right-4 -bottom-4 w-32 h-32 text-white opacity-10 rotate-12" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {expenses.length === 0 ? (
          <div className="text-center text-gray-500 py-10">
            <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            Hakuna matumizi yaliyorekodiwa bado.
          </div>
        ) : (
          expenses.map(expense => (
            <div key={expense.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
              <div className="flex items-center">
                <div className="bg-orange-100 p-3 rounded-xl mr-4">
                  <Tag className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">{expense.category}</h3>
                  <p className="text-xs text-gray-500 flex items-center mt-1">
                    <Calendar className="w-3 h-3 mr-1" />
                    {format(new Date(expense.date), 'dd MMM yyyy')}
                  </p>
                  {expense.description && (
                    <p className="text-xs text-gray-400 mt-1 italic">"{expense.description}"</p>
                  )}
                </div>
              </div>
              <div className="text-right flex flex-col items-end">
                <div className="font-bold text-red-600">{formatCurrency(expense.amount, currency)}</div>
                {(user?.role === 'admin' || user?.role === 'boss') && (
                  <button 
                    onClick={() => expense.id && handleDelete(expense.id)} 
                    className="mt-2 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
