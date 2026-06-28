import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deriveTitle, SessionService } from './session.service';

function makeService(): SessionService {
  const config = {
    get: (key: string, def?: unknown) =>
      key === 'DB_PATH' ? ':memory:' : def,
  } as unknown as ConfigService;
  return new SessionService(config);
}

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    service = makeService();
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('новый чат: resolve создаёт сессию с resume=false', () => {
    const r = service.resolveForMessage('chat-1');
    expect(r.resume).toBe(false);
    expect(r.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const active = service.getActive('chat-1');
    expect(active?.sessionId).toBe(r.sessionId);
    expect(active?.turnCount).toBe(0);
  });

  it('после recordTurn: resolve возвращает ту же сессию с resume=true', () => {
    const first = service.resolveForMessage('chat-1');
    service.recordTurn('chat-1', first.sessionId);

    const second = service.resolveForMessage('chat-1');
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resume).toBe(true);
    expect(service.getActive('chat-1')?.turnCount).toBe(1);
  });

  it('createNew переключает активную сессию и сбрасывает resume', () => {
    const first = service.resolveForMessage('chat-1');
    service.recordTurn('chat-1', first.sessionId);

    const fresh = service.createNew('chat-1');
    expect(fresh.sessionId).not.toBe(first.sessionId);
    expect(fresh.turnCount).toBe(0);

    const r = service.resolveForMessage('chat-1');
    expect(r.sessionId).toBe(fresh.sessionId);
    expect(r.resume).toBe(false);
  });

  it('list возвращает сессии чата, новые сверху', () => {
    const a = service.createNew('chat-1');
    const b = service.createNew('chat-1');
    service.recordTurn('chat-1', a.sessionId); // a становится свежее b

    const list = service.list('chat-1');
    expect(list).toHaveLength(2);
    expect(list[0].sessionId).toBe(a.sessionId);
    expect(list[1].sessionId).toBe(b.sessionId);
  });

  it('setActive переключает на прошлую сессию', () => {
    const a = service.createNew('chat-1');
    const b = service.createNew('chat-1');
    expect(service.getActive('chat-1')?.sessionId).toBe(b.sessionId);

    const restored = service.setActive('chat-1', a.sessionId);
    expect(restored.sessionId).toBe(a.sessionId);
    expect(service.getActive('chat-1')?.sessionId).toBe(a.sessionId);
  });

  it('setActive на чужую/несуществующую сессию бросает NotFound', () => {
    service.createNew('chat-1');
    const other = service.createNew('chat-2');

    expect(() => service.setActive('chat-1', other.sessionId)).toThrow(
      NotFoundException,
    );
    expect(() => service.setActive('chat-1', 'no-such-id')).toThrow(
      NotFoundException,
    );
  });

  it('изоляция чатов', () => {
    const a = service.resolveForMessage('chat-1');
    const b = service.resolveForMessage('chat-2');
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(service.list('chat-1')).toHaveLength(1);
    expect(service.list('chat-2')).toHaveLength(1);
    expect(service.getActive('chat-2')?.sessionId).toBe(b.sessionId);
  });

  it('discardIfUnused удаляет неотработавшую сессию и снимает active', () => {
    const r = service.resolveForMessage('chat-1');
    expect(service.discardIfUnused('chat-1', r.sessionId)).toBe(true);
    expect(service.getActive('chat-1')).toBeNull();
    expect(service.list('chat-1')).toHaveLength(0);

    // следующий resolve создаёт свежую сессию
    const next = service.resolveForMessage('chat-1');
    expect(next.sessionId).not.toBe(r.sessionId);
    expect(next.resume).toBe(false);
  });

  it('discardIfUnused НЕ трогает сессию с ходами', () => {
    const r = service.resolveForMessage('chat-1');
    service.recordTurn('chat-1', r.sessionId);
    expect(service.discardIfUnused('chat-1', r.sessionId)).toBe(false);
    expect(service.getActive('chat-1')?.sessionId).toBe(r.sessionId);
  });

  describe('deriveTitle', () => {
    it('длинная строка обрезается с многоточием', () => {
      const t = deriveTitle('a'.repeat(100));
      expect(t.endsWith('…')).toBe(true);
      expect(t.length).toBe(41); // 40 символов + «…»
    });

    it('схлопывает переносы и лишние пробелы', () => {
      expect(deriveTitle('  привет\n\nкак   дела  ')).toBe('привет как дела');
    });

    it('пустой/пробельный вход → пустая строка', () => {
      expect(deriveTitle('   \n  ')).toBe('');
      expect(deriveTitle('')).toBe('');
    });
  });

  describe('setTitleIfEmpty', () => {
    it('ставит title при null и не перетирает при повторе', () => {
      const r = service.resolveForMessage('chat-1');
      service.setTitleIfEmpty('chat-1', r.sessionId, 'Первый');
      expect(service.list('chat-1')[0].title).toBe('Первый');

      service.setTitleIfEmpty('chat-1', r.sessionId, 'Второй');
      expect(service.list('chat-1')[0].title).toBe('Первый');
    });

    it('не трогает чужой chatId', () => {
      const r = service.resolveForMessage('chat-1');
      service.setTitleIfEmpty('chat-2', r.sessionId, 'Чужой');
      expect(service.list('chat-1')[0].title).toBeNull();
    });
  });
});
