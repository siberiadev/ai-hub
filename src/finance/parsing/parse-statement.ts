import type { BankSource } from '../finance.types';
import { detectBank } from './bank-detect';
import { parseAlipayPages } from './alipay.parser';
import { parseMoxPages } from './mox.parser';
import { parseSCPages } from './sc.parser';
import type { ParsedStatement } from './parsed.types';
import { extractPages } from './pdf-words';

export class UnknownBankError extends Error {
  constructor() {
    super(
      'Не удалось определить банк выписки (ожидаются Mox / Standard Chartered / Alipay).',
    );
    this.name = 'UnknownBankError';
  }
}

/** Извлекает страницы один раз, определяет банк и направляет в нужный парсер. */
export async function parseStatement(
  data: Uint8Array,
): Promise<ParsedStatement> {
  const pages = await extractPages(data);
  const bank: BankSource | null = detectBank(pages[0]?.text ?? '');
  switch (bank) {
    case 'mox':
      return parseMoxPages(pages);
    case 'standard_chartered':
      return parseSCPages(pages);
    case 'alipay':
      return parseAlipayPages(pages);
    default:
      throw new UnknownBankError();
  }
}
