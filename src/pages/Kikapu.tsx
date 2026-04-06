import { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Sale, SaleItem } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { getValidStock } from '../utils/stock';
import { Plus, Minus, Trash2, Search, ShoppingBag, RefreshCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { addDays } from 'date-fns';
import { SyncService } from '../services/sync';
import { List, RowComponentProps } from 'react-window';

export default function Kikapu() {
  const user = useStore(state => state.user);
  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';
  const isExpiryEnabled = shop?.enable_expiry === true;
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const { cart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartProfit, showAlert } = useStore();
  const products = useLiveQuery(async () => {
    if (!user?.shopId) return [];
    
    const searchLower = deferredSearch ? deferredSearch.toLowerCase() : '';
    
    const filtered = await db.products
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .filter(p => {
        if (searchLower && !p.name.toLowerCase().includes(searchLower)) return false;
        const validStock = getValidStock(p, isExpiryEnabled);
        return validStock > 0;
      })
      .toArray();
      
    return filtered.map(p => ({ ...p, stock: getValidStock(p, isExpiryEnabled) }));
  }, [user?.shopId, deferredSearch, isExpiryEnabled]) || [];
  const [isCheckout, setIsCheckout] = useState(false);
  const [isCredit, setIsCredit] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editingQtyItemId, setEditingQtyItemId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(300);

  useEffect(() => {
    if (containerRef.current) {
      setListHeight(containerRef.current.offsetHeight);
    }
    const handleResize = () => {
      if (containerRef.current) setListHeight(containerRef.current.offsetHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const customerData = useLiveQuery(async () => {
    if (!user?.shopId) return { names: [], phones: new Map<string, string>() };
    const customers = new Map<string, string>();
    const phones = new Map<string, string>();
    
    await db.sales
      .where('[shop_id+isDeleted]')
      .equals([user.shopId, 0])
      .reverse()
      .limit(2000) // Only look at the last 2000 sales to save memory
      .each(s => {
        if (s.customer_name) {
          const lower = s.customer_name.toLowerCase();
          if (!customers.has(lower)) {
            customers.set(lower, s.customer_name);
            if (s.customer_phone) {
              phones.set(lower, s.customer_phone);
            }
          }
        }
      });
      
    return {
      names: Array.from(customers.values()),
      phones
    };
  }, [user?.shopId]) || { names: [], phones: new Map() };

  const uniqueCustomers = customerData.names;

  const filteredCustomers = uniqueCustomers.filter(c => 
    c.toLowerCase().includes(customerName.toLowerCase())
  );

  const filteredProducts = useMemo(() => {
    const s = deferredSearch.toLowerCase();
    return products
      .filter(p => p.name && p.name.toLowerCase().includes(s) && p.stock > 0)
      .sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        const aStarts = aName.startsWith(s);
        const bStarts = bName.startsWith(s);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName);
      });
  }, [products, deferredSearch]);

  const ProductSelectionRow = ({ index, style }: RowComponentProps) => {
    const product = filteredProducts[index];
    if (!product) return null;
    
    const cartItem = cart.find(item => item.id === product.id);
    const isAtMaxStock = cartItem ? cartItem.qty >= product.stock : false;
    
    return (
      <div style={style} className="px-1">
        <div 
          onClick={() => {
            if (isAtMaxStock) {
              showAlert('Kikomo cha Stock', `Umeshafikia kikomo cha stock kwa ${product.name}`);
              return;
            }
            addToCart(product);
          }}
          className={`bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer active:bg-blue-50 transition-colors h-[70px] ${isAtMaxStock ? 'opacity-60' : ''}`}
        >
          <div className="flex-1 min-w-0 mr-2">
            <h3 className="font-bold text-gray-800 text-sm truncate">{product.name}</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              {formatCurrency(product.sell_price, currency)} • Zilizopo: {product.stock}
              {isAtMaxStock && <span className="ml-2 text-red-500 font-bold">(Imejaa)</span>}
            </div>
          </div>
          <div className={`${isAtMaxStock ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600'} p-2 rounded-lg shrink-0`}>
            <Plus className="w-5 h-5" />
          </div>
        </div>
      </div>
    );
  };

  const handleSelectCustomer = (name: string) => {
    setCustomerName(name);
    setShowSuggestions(false);
    // Try to find the phone number for this customer
    const phone = customerData.phones.get(name.toLowerCase());
    if (phone) {
      setCustomerPhone(phone);
    }
  };

  const handleCompleteSale = async (paymentMethod: 'cash' | 'credit') => {
    if (cart.length === 0 || !user) return;
    
    if (paymentMethod === 'credit' && !customerName) {
      showAlert('Kosa', 'Tafadhali weka jina la mteja kwa mauzo ya mkopo.');
      return;
    }

    const saleId = uuidv4();
    const isCreditSale = paymentMethod === 'credit';

    const sale: Sale = {
      id: saleId,
      shop_id: user.shopId || '',
      user_id: user.id,
      total_amount: cartTotal(),
      total_profit: cartProfit(),
      is_credit: isCreditSale,
      is_paid: !isCreditSale,
      payment_method: paymentMethod,
      status: isCreditSale ? 'pending' : 'completed',
      customer_name: isCreditSale ? customerName : undefined,
      customer_phone: isCreditSale ? customerPhone : undefined,
      due_date: isCreditSale && dueDate ? new Date(dueDate).toISOString() : undefined,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isDeleted: 0,
      synced: 0
    };

    const saleItems: SaleItem[] = cart.map(item => ({
      id: uuidv4(),
      sale_id: saleId,
      shop_id: user.shopId || '',
      product_id: item.id!,
      product_name: item.name,
      qty: item.qty,
      buy_price: item.buy_price,
      sell_price: item.sell_price,
      created_at: new Date().toISOString(),
      isDeleted: 0,
      synced: 0
    }));

    try {
      // Update stock and save sale atomically
      await db.transaction('rw', db.products, db.sales, db.saleItems, async () => {
        // Final stock check from local DB INSIDE transaction to prevent race conditions
        for (const item of cart) {
          const dbProduct = await db.products.get(item.id!);
          const validStock = dbProduct ? dbProduct.stock : 0;
          if (!dbProduct || validStock < item.qty) {
            throw new Error(`Bidhaa "${item.name}" haina stock ya kutosha. Stock iliyopo: ${validStock}`);
          }
        }

        await db.sales.add(sale);
        await db.saleItems.bulkAdd(saleItems);

        for (const item of cart) {
          const product = await db.products.get(item.id!);
          if (product) {
            let remainingQtyToDeduct = Number(item.qty);
            let updatedBatches = product.batches ? JSON.parse(JSON.stringify(product.batches)) : [];

            // Sort batches by expiry date (ascending, oldest first). Batches without expiry go last.
            updatedBatches.sort((a: any, b: any) => {
              if (!a.expiry_date) return 1;
              if (!b.expiry_date) return -1;
              return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
            });

            // Deduct from batches
            for (let i = 0; i < updatedBatches.length; i++) {
              if (remainingQtyToDeduct <= 0) break;
              
              const batch = updatedBatches[i];
              
              // Skip expired batches
              const isExpired = batch.expiry_date && new Date(batch.expiry_date) < new Date();
              if (isExpired) continue;

              if (batch.stock > 0) {
                const deductAmount = Math.min(Number(batch.stock), remainingQtyToDeduct);
                batch.stock = Number(batch.stock) - deductAmount;
                remainingQtyToDeduct -= deductAmount;
              }
            }

            // Remove empty batches
            updatedBatches = updatedBatches.filter((b: any) => Number(b.stock) > 0);

            let newStock = Math.max(0, Number(product.stock) - Number(item.qty));
            if (shop?.enable_expiry) {
              const totalBatchStock = updatedBatches.reduce((sum: number, b: any) => sum + Number(b.stock), 0);
              const originalTotalBatchStock = (product.batches || []).reduce((sum: number, b: any) => sum + Number(b.stock), 0);
              const unbatchedStock = Math.max(0, Number(product.stock) - originalTotalBatchStock);
              
              const deductedFromBatches = originalTotalBatchStock - totalBatchStock;
              const deductedFromUnbatched = Math.max(0, Number(item.qty) - deductedFromBatches);
              const remainingUnbatched = Math.max(0, unbatchedStock - deductedFromUnbatched);
              
              newStock = totalBatchStock + remainingUnbatched;
            }

            await db.products.update(product.id!, { 
              stock: newStock,
              stock_delta: (product.stock_delta || 0) - Number(item.qty),
              batches: updatedBatches,
              updated_at: new Date().toISOString(),
              synced: 0
            });
          }
        }
      });

      clearCart();
      setIsCheckout(false);
      setIsCredit(false);
      setCustomerName('');
      setCustomerPhone('');
      setDueDate('');
      
      SyncService.sync();
    } catch (error: any) {
      showAlert('Kosa', 'Kuna tatizo: ' + error.message);
    }
  };

  if (isCheckout) {
    return (
      <div className="p-4 flex flex-col h-full bg-white">
        <div className="flex items-center mb-6">
          <button onClick={() => setIsCheckout(false)} className="text-blue-600 font-medium mr-4">Nyuma</button>
          <h1 className="text-xl font-bold text-gray-800">Taarifa za Mkopo</h1>
        </div>

        <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-orange-800 font-medium">Jumla ya Deni:</span>
            <span className="text-3xl font-bold text-orange-900">{formatCurrency(cartTotal(), currency)}</span>
          </div>
          <div className="text-sm text-orange-600">Idadi ya bidhaa: {cart.reduce((a, b) => a + b.qty, 0)}</div>
        </div>

        <div className="space-y-6 flex-1">
          <div className="relative">
            <label className="block text-sm font-bold text-gray-700 mb-2">Jina la Mteja</label>
            <input 
              required 
              value={customerName} 
              onChange={e => {
                setCustomerName(e.target.value);
                setShowSuggestions(true);
              }} 
              onFocus={() => setShowSuggestions(true)}
              placeholder="Andika jina la mteja..."
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
            />
            {showSuggestions && filteredCustomers.length > 0 && customerName && (
              <div className="absolute z-10 w-full bg-white mt-1 border border-gray-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                {filteredCustomers.map(c => (
                  <button
                    key={c}
                    onClick={() => handleSelectCustomer(c)}
                    className="w-full text-left p-4 hover:bg-gray-50 border-b border-gray-100 last:border-0 text-sm font-medium"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Namba ya Simu</label>
            <input 
              type="tel" 
              value={customerPhone} 
              onChange={e => setCustomerPhone(e.target.value)} 
              placeholder="Mfano: 0787..."
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Tarehe ya Kulipa</label>
            <input 
              type="date" 
              value={dueDate} 
              onChange={e => setDueDate(e.target.value)} 
              className="w-full p-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" 
            />
          </div>
        </div>

        <button 
          onClick={() => handleCompleteSale('credit')}
          disabled={!customerName}
          className="w-full bg-orange-600 disabled:bg-gray-400 text-white font-bold py-5 rounded-2xl mt-6 shadow-xl text-lg flex items-center justify-center space-x-2"
        >
          <span>Kamilisha Mkopo</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top Half: Product Selection */}
      <div className="h-1/2 p-4 flex flex-col bg-gray-50 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-800 mb-3">Ongeza Kwenye Kikapu</h1>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Tafuta bidhaa..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="flex-1 min-h-0" ref={containerRef}>
          {filteredProducts.length > 0 ? (
            <List
              rowCount={filteredProducts.length}
              rowHeight={78} // 70px height + 8px gap
              rowComponent={ProductSelectionRow}
              rowProps={{}}
              style={{ width: '100%', height: listHeight || 300 }}
            />
          ) : (
            <div className="text-center text-gray-500 py-4 text-sm">
              Hakuna bidhaa zilizopatikana.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Half: Cart */}
      <div className="h-1/2 p-4 flex flex-col bg-white">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold text-gray-800 flex items-center">
            <ShoppingBag className="w-5 h-5 mr-2" /> Kikapu
          </h2>
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-red-500 text-sm font-medium">Safi</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-4">
          {cart.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Kikapu ni tupu
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex justify-between items-center border-b border-gray-100 pb-2">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-800 text-sm">{item.name}</h4>
                  <div className="text-xs text-gray-500">{formatCurrency(item.sell_price, currency)}</div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="flex items-center bg-gray-100 rounded-lg">
                    <button onClick={() => item.qty > 1 ? updateQty(item.id!, item.qty - 1) : removeFromCart(item.id!)} className="p-1.5 text-gray-600">
                      <Minus className="w-4 h-4" />
                    </button>
                    {editingQtyItemId === item.id ? (
                      <input
                        type="number"
                        className="w-12 text-center text-sm font-medium bg-white border border-blue-500 rounded outline-none py-0.5"
                        value={editingQtyValue}
                        onChange={(e) => setEditingQtyValue(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => {
                          const newQty = parseInt(editingQtyValue, 10);
                          if (!isNaN(newQty) && newQty > 0) {
                            updateQty(item.id!, Math.min(newQty, item.stock));
                          }
                          setEditingQtyItemId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <span 
                        className="w-8 text-center text-sm font-medium cursor-pointer hover:bg-gray-200 rounded py-1"
                        onClick={() => {
                          setEditingQtyItemId(item.id!);
                          setEditingQtyValue(item.qty.toString());
                        }}
                      >
                        {item.qty}
                      </span>
                    )}
                    <button 
                      onClick={() => item.qty < item.stock && updateQty(item.id!, item.qty + 1)} 
                      className={`p-1.5 ${item.qty >= item.stock ? 'text-gray-300' : 'text-gray-600'}`}
                      disabled={item.qty >= item.stock}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <button onClick={() => removeFromCart(item.id!)} className="text-red-500 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-3 border-t border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-600 font-medium">Jumla:</span>
            <span className="text-xl font-bold text-gray-900">{formatCurrency(cartTotal(), currency)}</span>
          </div>
          
          {cart.length > 0 && (
            <div className="flex space-x-2">
              <button 
                onClick={() => setIsCheckout(true)}
                className="flex-1 bg-orange-600 disabled:bg-gray-400 text-white font-bold py-3.5 rounded-xl shadow-md text-sm"
              >
                Uza kwa Mkopo
              </button>
              <button 
                onClick={() => handleCompleteSale('cash')}
                className="flex-1 bg-green-600 disabled:bg-gray-400 text-white font-bold py-3.5 rounded-xl shadow-md text-sm flex items-center justify-center space-x-2"
              >
                <span>Kamilisha Mauzo</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
