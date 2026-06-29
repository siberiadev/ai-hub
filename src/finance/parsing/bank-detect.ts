import type { BankSource } from '../finance.types';

/**
 * Определяет банк по тексту первой страницы. Достаточно характерных маркеров
 * каждого формата (заголовки/бренд).
 */
export function detectBank(firstPageText: string): BankSource | null {
  const t = firstPageText;
  if (/Mox\s*Bank\s*statement|Mox\s*銀行/i.test(t)) return 'mox';
  if (/Consolidated\s*Statement|渣打|Standard\s*Chartered/i.test(t)) {
    return 'standard_chartered';
  }
  if (/Alipay|支付寶|支付宝/i.test(t)) return 'alipay';
  return null;
}
