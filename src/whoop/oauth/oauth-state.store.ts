import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/** TTL выданного state, мс (окно между /start и /callback). */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Хранилище OAuth-`state` (анти-CSRF). In-memory — достаточно для single-instance деплоя:
 * `issue()` выдаёт случайный одноразовый state, `consume()` валидирует и сразу удаляет его.
 * Протухшие записи чистятся при обращении.
 */
@Injectable()
export class OAuthStateStore {
  private readonly states = new Map<string, number>(); // state → expiresAt(ms)

  /** Выдаёт новый одноразовый state (≥16 байт энтропии, base64url). */
  issue(): string {
    this.prune();
    const state = randomBytes(24).toString('base64url');
    this.states.set(state, Date.now() + STATE_TTL_MS);
    return state;
  }

  /** true, если state валиден и не протух; в любом случае удаляет его (одноразовость). */
  consume(state: string): boolean {
    const expiresAt = this.states.get(state);
    this.states.delete(state);
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  private prune(): void {
    const now = Date.now();
    for (const [state, expiresAt] of this.states) {
      if (expiresAt <= now) this.states.delete(state);
    }
  }
}
