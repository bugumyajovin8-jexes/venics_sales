import { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Sale, SaleItem } from '../db';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { getValidStock } from '../utils/stock';
import { Plus, Minus, Trash2, Search, ShoppingBag, RefreshCw, Edit2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { addDays } from 'date-fns';
import { SyncService } from '../services/sync';
import { List, RowComponentProps } from 'react-window';

const PriceInput = ({ item, currency }: { item: any, currency: string }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.sell_price.toString());
  const updateCartItemPrice = useStore(state => state.updateCartItemPrice);

  if (isEditing) {
    return (
      <input
        type="number"
        className="w-24 text-right p-2 border-2 border-blue-500 rounded-xl text-sm font-black outline-none shadow-lg"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const newPrice = parseFloat(value);
          if (!isNaN(newPrice) && newPrice >= 0) {
            updateCartItemPrice(item.id!, newPrice);
          }
          setIsEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
      />
    );
  }

  return (
    <div 
      onClick={() => {
        setIsEditing(true);
        setValue(item.sell_price.toString());
      }}
      className="flex items-center bg-blue-50 text-blue-700 px-3 py-2 rounded-xl cursor-pointer active:scale-95 transition-all border border-blue-100"
    >
      <span className="font-black text-xs mr-2">{formatCurrency(item.sell_price, currency)}</span>
      <Edit2 className="w-3.5 h-3.5 opacity-50" />
    </div>
  );
};

export default function Kikapu() {
  const user = useStore(state => state.user);
  const settings = useLiveQuery(() => db.settings.get(1));
  const shop = useLiveQuery(() => user?.shopId ? db.shops.get(user.shopId) : Promise.resolve(undefined), [user?.shopId]);
  const currency = settings?.currency || 'TZS';
  const isExpiryEnabled = shop?.enable_expiry === true;
  const [search, setSearch] = useState('');
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const { cart, addToCart, removeFromCart, updateQty, updateCartItemPrice, clearCart, cartTotal, cartProfit, showAlert, showToast } = useStore();
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
  const [isDiscountMode, setIsDiscountMode] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

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
  }, [isCheckout, isDiscountMode]);

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
      .filter(p => {
        if (!p.name) return false;
        const nameLower = p.name.toLowerCase();
        if (s && !nameLower.includes(s)) return false;
        if (selectedLetter) {
          if (selectedLetter === '#') {
            return !/^[a-zA-Z]/.test(p.name);
          }
          return nameLower.startsWith(selectedLetter.toLowerCase());
        }
        return p.stock > 0;
      })
      .sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        const aStarts = aName.startsWith(s);
        const bStarts = bName.startsWith(s);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName);
      });
  }, [products, deferredSearch, selectedLetter]);

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

  const ProductSelectionRow = ({ index, style }: RowComponentProps) => {
    const productsInRow = [
      filteredProducts[index * 2],
      filteredProducts[index * 2 + 1]
    ].filter(Boolean);

    return (
      <div style={style} className="px-1 flex gap-2">
        {productsInRow.map(product => {
          const cartItem = cart.find(item => item.id === product.id);
          const isAtMaxStock = cartItem ? cartItem.qty >= product.stock : false;
          const inCart = !!cartItem;
          
          return (
            <div 
              key={product.id}
              className={`flex-1 bg-white p-2.5 rounded-xl shadow-sm border flex flex-col justify-between transition-all h-[74px] ${inCart ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-100'} ${isAtMaxStock ? 'opacity-90' : ''}`}
            >
              <div 
                className="min-w-0 cursor-pointer"
                onClick={() => {
                  if (isAtMaxStock) {
                    showToast(`Umeshafikia kikomo cha stock kwa ${product.name}`, 'info');
                    return;
                  }
                  addToCart(product);
                }}
              >
                <h3 className="font-bold text-gray-900 text-[12px] leading-tight line-clamp-1 tracking-tight">{product.name}</h3>
                <div className="text-[10px] font-bold text-blue-600 mt-0.5">
                  {formatCurrency(product.sell_price, currency)}
                </div>
              </div>

              <div className="flex justify-between items-center mt-1">
                {inCart ? (
                  <div className="flex items-center bg-blue-50 rounded-lg p-0.5 w-full justify-between">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (cartItem.qty > 1) {
                          updateQty(product.id!, cartItem.qty - 1);
                        } else {
                          removeFromCart(product.id!);
                        }
                      }}
                      className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-[11px] font-black text-blue-700 mx-1">{cartItem.qty}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isAtMaxStock) return;
                        updateQty(product.id!, cartItem.qty + 1);
                      }}
                      disabled={isAtMaxStock}
                      className={`p-1 rounded ${isAtMaxStock ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-100'}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="text-[9px] text-gray-400 font-medium">
                    Stock: {product.stock}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {productsInRow.length === 1 && <div className="flex-1" />}
      </div>
    );
  };

  const CartItemRow = ({ index, style }: RowComponentProps) => {
    const item = cart[index];
    if (!item) return null;
    
    return (
      <div style={style} className="px-2">
        <div className="bg-white border border-gray-100 rounded-2xl p-3 flex items-center justify-between shadow-sm mb-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-gray-800 text-sm truncate">{item.name}</h4>
            <div className="text-[10px] text-gray-500 font-medium">
              Qty: {item.qty} • Bei ya awali: {formatCurrency(item.sell_price, currency)}
            </div>
          </div>
          
          <div className="flex items-center space-x-3 ml-2">
            <PriceInput item={item} currency={currency} />
            
            <button 
              onClick={() => removeFromCart(item.id!)} 
              className="text-red-400 p-2 rounded-xl hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
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
      showToast('Tafadhali weka jina la mteja kwa mauzo ya mkopo.', 'error');
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

    const discountsToLog: any[] = [];

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
          
          if (dbProduct && Number(item.sell_price) < Number(dbProduct.sell_price)) {
            discountsToLog.push({
              product_id: item.id,
              name: item.name,
              original_price: Number(dbProduct.sell_price) * item.qty,
              discounted_price: Number(item.sell_price) * item.qty,
              qty: item.qty
            });
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

      if (discountsToLog.length > 0) {
        const totalOriginalPrice = discountsToLog.reduce((sum, d) => sum + d.original_price, 0);
        const totalDiscountedPrice = discountsToLog.reduce((sum, d) => sum + d.discounted_price, 0);
        const totalQty = discountsToLog.reduce((sum, d) => sum + d.qty, 0);
        const productNames = discountsToLog.map(d => d.name).join(', ');

        await SyncService.logAction('discounted_sale', {
          sale_id: saleId,
          number_of_items_sold: totalQty,
          original_price: totalOriginalPrice,
          price_on_discount: totalDiscountedPrice,
          name_of_person_who_sold: user.name || 'Unknown',
          name_of_product: productNames,
          time: sale.created_at
        });
      }

      clearCart();
      setIsDiscountMode(false);
      setIsCheckout(false);
      setIsCredit(false);
      setCustomerName('');
      setCustomerPhone('');
      setDueDate('');
      
      SyncService.sync();
      showToast('Sale yamefanikiwa!', 'success');
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
    <div className="flex flex-col h-full bg-gray-50 relative">
      {/* Product Discovery Mode */}
      <div className="flex-1 p-4 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          {isDiscountMode ? (
            <button 
              onClick={() => setIsDiscountMode(false)}
              className="text-blue-600 font-bold text-sm flex items-center bg-blue-50 px-3 py-1.5 rounded-xl"
            >
               Nyuma kwenye Bidhaa
            </button>
          ) : (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder="Tafuta bidhaa..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
          )}
          
          {isDiscountMode && (
            <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest ml-4">Hali ya Punguzo</h2>
          )}
        </div>

        {!isDiscountMode && (
          <div className="flex overflow-x-auto pb-2 scrollbar-hide space-x-2 mb-2">
            <button
              onClick={() => setSelectedLetter(null)}
              className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${!selectedLetter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
            >
              All
            </button>
            {alphabet.map(letter => (
              <button
                key={letter}
                onClick={() => setSelectedLetter(selectedLetter === letter ? null : letter)}
                className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${selectedLetter === letter ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
              >
                {letter}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 bg-white rounded-3xl border border-gray-100 shadow-inner p-2" ref={containerRef}>
          {isDiscountMode ? (
            cart.length > 0 ? (
              <List
                rowCount={cart.length}
                rowHeight={70}
                rowComponent={CartItemRow}
                rowProps={{}}
                style={{ width: '100%', height: listHeight || 500 }}
              />
            ) : (
              <div className="text-center text-gray-500 py-12">
                <ShoppingBag className="w-12 h-12 text-gray-100 mx-auto mb-4" />
                <p className="font-bold">Kikapu kiko tupu</p>
                <button 
                  onClick={() => setIsDiscountMode(false)}
                  className="text-blue-600 text-xs mt-2 underline"
                >
                  Rudi kuongeza bidhaa
                </button>
              </div>
            )
          ) : filteredProducts.length > 0 ? (
            <List
              rowCount={Math.ceil(filteredProducts.length / 2)}
              rowHeight={82}
              rowComponent={ProductSelectionRow}
              rowProps={{}}
              style={{ width: '100%', height: listHeight || 500 }}
            />
          ) : (
            <div className="text-center text-gray-500 py-12 flex flex-col items-center">
              <div className="bg-gray-100 p-4 rounded-full mb-3">
                <Search className="w-8 h-8 text-gray-300" />
              </div>
              <p className="font-medium">Hakuna bidhaa iliyopatikana</p>
              <p className="text-xs text-gray-400">Jaribu neno lingine ama ungeza bidhaa mpya</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Cart Panel */}
      {cart.length > 0 && (
        <div className="fixed bottom-20 left-3 right-3 animate-in slide-in-from-bottom duration-300 z-40">
          <div className="bg-gray-900/95 backdrop-blur-lg text-white p-3 rounded-[2.5rem] shadow-2xl border border-white/10 flex flex-col space-y-3">
            {/* Top: Summary */}
            <div className="flex items-center justify-between px-4 py-1">
              <div className="flex items-center">
                <div className="bg-blue-600 p-2.5 rounded-2xl mr-3 relative shadow-lg shadow-blue-500/20">
                  <ShoppingBag className="w-5 h-5" />
                  <span className="absolute -top-1 -right-1 bg-white text-blue-600 text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border-2 border-gray-900">
                    {cart.reduce((a, b) => a + b.qty, 0)}
                  </span>
                </div>
                <div>
                  <p className="text-xl font-black tracking-tight">{formatCurrency(cartTotal(), currency)}</p>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Kikapu kimejaa</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  clearCart();
                  setIsDiscountMode(false);
                }}
                className="text-gray-400 hover:text-white p-2 transition-colors"
                title="Safi Kikapu"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            {/* Bottom: Action Buttons */}
            <div className="grid grid-cols-3 gap-2 px-1 pb-1">
              <button 
                onClick={() => setIsDiscountMode(!isDiscountMode)}
                className={`${isDiscountMode ? 'bg-blue-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'} py-3.5 rounded-2xl font-bold text-xs transition-all active:scale-95`}
              >
                {isDiscountMode ? 'Bidhaa' : 'Punguzo'}
              </button>
              <button 
                onClick={() => setIsCheckout(true)}
                className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 py-3.5 rounded-2xl font-bold text-xs border border-orange-500/30 transition-all active:scale-95"
              >
                Mkopo
              </button>
              <button 
                onClick={() => handleCompleteSale('cash')}
                className="bg-green-600 hover:bg-green-700 text-white py-3.5 rounded-2xl font-black text-xs shadow-lg shadow-green-900/20 transition-all active:scale-95 flex items-center justify-center"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Uza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
