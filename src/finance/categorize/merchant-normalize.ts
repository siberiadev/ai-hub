/**
 * Нормализует имя плательщика/мерчанта в ключ дедупликации. Порт norm_merchant()
 * из load.py: схлопывает пробелы, срезает хвостовую гео-метку (HKG/HONGKONG HKG) и
 * хвостовой номер магазина, UPPERCASE, до 120 символов.
 */
export function normMerchant(s: string | null | undefined): string {
  let r = (s ?? '').replace(/\s+/g, ' ').trim();
  r = r.replace(/\s+(HONGKONG\s+)?HKG\b/i, '');
  r = r.replace(/\b\d{2,}\b\s*$/, '').trim();
  return r.toUpperCase().slice(0, 120) || 'UNKNOWN';
}
