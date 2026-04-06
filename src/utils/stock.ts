import { Product } from '../db';

export function getValidStock(product: Product, isExpiryEnabled: boolean): number {
  if (!isExpiryEnabled || !product.batches || product.batches.length === 0) {
    return product.stock;
  }

  const now = new Date();
  const totalBatchStock = product.batches.reduce((sum, b) => sum + Number(b.stock), 0);
  const unbatchedStock = Math.max(0, Number(product.stock) - totalBatchStock);
  
  const validBatchStock = product.batches.reduce((sum, b) => {
    if (Number(b.stock) > 0 && new Date(b.expiry_date) > now) {
      return sum + Number(b.stock);
    }
    return sum;
  }, 0);
  
  return validBatchStock + unbatchedStock;
}
