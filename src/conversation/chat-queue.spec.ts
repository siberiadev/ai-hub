import { ChatQueue } from './chat-queue';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Прокрутить микро- и макро-таски. */
const tick = () => new Promise((r) => setImmediate(r));

describe('ChatQueue', () => {
  it('один ключ: задачи выполняются строго по очереди', async () => {
    const q = new ChatQueue();
    const events: string[] = [];
    const d1 = deferred<void>();
    const d2 = deferred<void>();

    const p1 = q.enqueue('k', async () => {
      events.push('start1');
      await d1.promise;
      events.push('end1');
      return 1;
    });
    const p2 = q.enqueue('k', async () => {
      events.push('start2');
      await d2.promise;
      events.push('end2');
      return 2;
    });

    await tick();
    expect(events).toEqual(['start1']); // вторая ещё не стартовала

    d1.resolve();
    await p1;
    await tick();
    expect(events).toEqual(['start1', 'end1', 'start2']);

    d2.resolve();
    await expect(p2).resolves.toBe(2);
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2']);
  });

  it('упавшая задача не блокирует следующую того же ключа', async () => {
    const q = new ChatQueue();
    const order: string[] = [];
    const p1 = q.enqueue('k', async () => {
      order.push('1');
      throw new Error('boom');
    });
    const p2 = q.enqueue('k', async () => {
      order.push('2');
      return 'ok';
    });

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(order).toEqual(['1', '2']);
  });

  it('разные ключи идут параллельно', async () => {
    const q = new ChatQueue();
    const started: string[] = [];
    const dA = deferred<void>();
    const dB = deferred<void>();

    const pA = q.enqueue('A', async () => {
      started.push('A');
      await dA.promise;
      return 'A';
    });
    const pB = q.enqueue('B', async () => {
      started.push('B');
      await dB.promise;
      return 'B';
    });

    await tick();
    expect(started.sort()).toEqual(['A', 'B']); // оба стартовали, не дожидаясь друг друга

    dA.resolve();
    dB.resolve();
    await expect(Promise.all([pA, pB])).resolves.toEqual(['A', 'B']);
  });

  it('очищает запись ключа после оседания', async () => {
    const q = new ChatQueue();
    const p = q.enqueue('k', async () => 1);
    expect(q.pending('k')).toBe(true);
    await p;
    await tick();
    expect(q.pending('k')).toBe(false);
  });
});
