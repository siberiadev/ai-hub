/**
 * Тонкий порт уведомлений владельцу — чтобы доменные модули (например WHOOP) слали алерты, не завися
 * от Telegram напрямую. Реализуется TelegramService; при выключенном боте — no-op.
 */
export interface Notifier {
  notifyOwner(text: string): Promise<void>;
}

/** DI-токен для инъекции реализации Notifier. */
export const NOTIFIER = Symbol('NOTIFIER');
