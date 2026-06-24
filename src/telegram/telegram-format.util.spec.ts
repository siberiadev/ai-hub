import {
  canRenderRich,
  chunk,
  clampForEdit,
  formatAge,
  progressLine,
  RICH_MAX_LEN,
  shortId,
  TELEGRAM_MAX_LEN,
} from './telegram-format.util';

describe('telegram-format.util', () => {
  describe('chunk', () => {
    it('короткий текст → один кусок', () => {
      expect(chunk('hello')).toEqual(['hello']);
    });

    it('пустой текст → заглушка', () => {
      expect(chunk('')).toEqual(['(пустой ответ)']);
    });

    it('ровно лимит → один кусок', () => {
      const s = 'a'.repeat(TELEGRAM_MAX_LEN);
      expect(chunk(s)).toEqual([s]);
    });

    it('длиннее лимита → несколько кусков в пределах лимита', () => {
      const s = 'a'.repeat(TELEGRAM_MAX_LEN + 100);
      const parts = chunk(s);
      expect(parts.length).toBe(2);
      expect(parts.every((p) => p.length <= TELEGRAM_MAX_LEN)).toBe(true);
      expect(parts.join('')).toBe(s);
    });

    it('режет по переводам строк', () => {
      const size = 10;
      const parts = chunk('aaaa\nbbbb\ncccc', size);
      expect(parts.every((p) => p.length <= size)).toBe(true);
      // склейка обратно через \n восстанавливает исходник
      expect(parts.join('\n')).toBe('aaaa\nbbbb\ncccc');
    });

    it('одна гигантская строка рубится жёстко', () => {
      const size = 10;
      const parts = chunk('x'.repeat(25), size);
      expect(parts).toEqual(['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx']);
    });
  });

  it('shortId берёт первые 8 символов', () => {
    expect(shortId('dec24e64-acf5-4447-8e79-c28bc87d1c9d')).toBe('dec24e64');
  });

  describe('formatAge', () => {
    const now = 1_000_000_000_000;
    it('меньше минуты', () => {
      expect(formatAge(now - 30_000, now)).toBe('только что');
    });
    it('минуты', () => {
      expect(formatAge(now - 5 * 60_000, now)).toBe('5м');
    });
    it('часы', () => {
      expect(formatAge(now - 2 * 3_600_000, now)).toBe('2ч');
    });
    it('дни', () => {
      expect(formatAge(now - 3 * 86_400_000, now)).toBe('3д');
    });
  });

  it('progressLine', () => {
    expect(progressLine('Read')).toBe('🔧 Read…');
    expect(progressLine()).toBe('🤔 думаю…');
  });

  describe('clampForEdit', () => {
    it('короткий текст не трогает', () => {
      expect(clampForEdit('hi')).toBe('hi');
    });
    it('длинный усекает с многоточием в пределах лимита', () => {
      const s = 'a'.repeat(TELEGRAM_MAX_LEN + 50);
      const out = clampForEdit(s);
      expect(out.length).toBe(TELEGRAM_MAX_LEN);
      expect(out.endsWith('…')).toBe(true);
    });
  });

  describe('canRenderRich', () => {
    it('флаг выключен → false', () => {
      expect(canRenderRich('| a | b |', false)).toBe(false);
    });
    it('пустой текст → false', () => {
      expect(canRenderRich('   ', true)).toBe(false);
    });
    it('длиннее лимита rich → false', () => {
      expect(canRenderRich('a'.repeat(RICH_MAX_LEN + 1), true)).toBe(false);
    });
    it('нормальный текст при включённом флаге → true', () => {
      expect(canRenderRich('| a | b |\n|---|---|', true)).toBe(true);
    });
  });
});
