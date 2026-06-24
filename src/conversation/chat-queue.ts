import { Injectable } from '@nestjs/common';

/**
 * Сериализует задачи по ключу: для одного ключа задачи выполняются строго по
 * очереди (не параллельно), для разных ключей — независимо/параллельно.
 *
 * В нашем случае ключ — это chatId: гарантирует, что по одной сессии Claude не
 * запустятся два `--resume` одновременно. Ошибка одной задачи не блокирует
 * следующие задачи того же ключа.
 */
@Injectable()
export class ChatQueue {
  /** Последний «хвост» цепочки на ключ; намеренно никогда не реджектится. */
  private readonly tails = new Map<string, Promise<unknown>>();

  /** Ставит задачу в очередь ключа. Возвращает промис с реальным результатом/ошибкой задачи. */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Запускаем task после предыдущего НЕЗАВИСИМО от его исхода.
    const run = prev.catch(() => undefined).then(() => task());
    // В map кладём незавершающийся ошибкой хвост, чтобы следующий enqueue всегда дождался.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    // Чистим запись, когда хвост осел и он всё ещё текущий (иначе map растёт вечно).
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return run;
  }

  /** Есть ли активная/ожидающая цепочка по ключу. */
  pending(key: string): boolean {
    return this.tails.has(key);
  }
}
