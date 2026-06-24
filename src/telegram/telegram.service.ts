import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Context } from 'grammy';
import { ClaudeEvent } from '../claude/claude.types';
import { ConversationService } from '../conversation/conversation.service';
import { SessionService } from '../session/session.service';
import { chunk, formatAge, progressLine, shortId } from './telegram-format.util';

/** Минимальный интервал между правками плейсхолдера, мс. */
const PROGRESS_THROTTLE_MS = 1500;

/**
 * Telegram-бот (grammY, long polling). Принимает сообщения, гоняет их через
 * ConversationService, показывает прогресс в плейсхолдере и отдаёт ответ.
 * Доступ ограничен allowlist по Telegram user id (single-user).
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TelegramService.name);
  private bot?: Bot;
  private allowed = new Set<number>();

  constructor(
    private readonly config: ConfigService,
    private readonly conversation: ConversationService,
    private readonly sessions: SessionService,
  ) {}

  onModuleInit(): void {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.log.warn('TELEGRAM_BOT_TOKEN не задан — бот выключен.');
      return;
    }
    this.allowed = this.parseAllowed(
      this.config.get<string>('TELEGRAM_ALLOWED_USER_IDS', ''),
    );

    const bot = new Bot(token);
    this.bot = bot;

    bot.use(this.guard);
    bot.command('start', (ctx) => this.onStart(ctx));
    bot.command('new', (ctx) => this.onNew(ctx));
    bot.command('sessions', (ctx) => this.onSessions(ctx));
    bot.command('resume', (ctx) => this.onResume(ctx));
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.catch((err) => this.log.error(`bot error: ${err.message}`, err.stack));

    void bot
      .start({
        onStart: (info) => this.log.log(`Telegram-бот запущен: @${info.username}`),
      })
      .catch((err) =>
        this.log.error(`не удалось запустить бота: ${(err as Error).message}`),
      );
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot?.stop();
  }

  // --- middleware ---

  private guard = async (ctx: Context, next: () => Promise<void>): Promise<void> => {
    const id = ctx.from?.id;
    if (!id || !this.allowed.has(id)) {
      await ctx.reply(
        `⛔ Не авторизовано. Ваш Telegram ID: ${id ?? 'неизвестен'}.\n` +
          `Добавьте его в TELEGRAM_ALLOWED_USER_IDS и перезапустите бота.`,
      );
      return;
    }
    await next();
  };

  // --- команды ---

  private async onStart(ctx: Context): Promise<void> {
    await ctx.reply(
      'Привет! Я мост к Claude.\n\n' +
        'Просто напиши сообщение — отвечу.\n\n' +
        'Команды:\n' +
        '/new — новая сессия\n' +
        '/sessions — список сессий\n' +
        '/resume N — переключиться на сессию N\n\n' +
        `Ваш ID: ${ctx.from?.id}`,
    );
  }

  private async onNew(ctx: Context): Promise<void> {
    const s = this.sessions.createNew(String(ctx.chat!.id));
    await ctx.reply(`🆕 Новая сессия начата (${shortId(s.sessionId)}).`);
  }

  private async onSessions(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const list = this.sessions.list(chatId);
    if (!list.length) {
      await ctx.reply('Сессий пока нет. Напиши сообщение, чтобы начать.');
      return;
    }
    const active = this.sessions.getActive(chatId);
    const lines = list.map((s, i) => {
      const mark = active && s.sessionId === active.sessionId ? '⭐' : '▫️';
      return `${i + 1}. ${mark} ${shortId(s.sessionId)} · ходов:${s.turnCount} · ${formatAge(s.lastUsedAt)}`;
    });
    await ctx.reply(
      'Сессии:\n' + lines.join('\n') + '\n\nПереключиться: /resume N',
    );
  }

  private async onResume(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const arg = (ctx.match as string)?.trim();
    const list = this.sessions.list(chatId);
    const n = Number(arg);
    if (!arg || !Number.isInteger(n) || n < 1 || n > list.length) {
      await ctx.reply('Укажи номер сессии: /resume N (см. /sessions).');
      return;
    }
    const target = list[n - 1];
    this.sessions.setActive(chatId, target.sessionId);
    await ctx.reply(`↩️ Переключился на сессию ${n} (${shortId(target.sessionId)}).`);
  }

  // --- основной поток ---

  private async onText(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const text = ctx.message!.text!;

    await ctx.replyWithChatAction('typing').catch(() => undefined);
    const ph = await ctx.reply(progressLine());

    let lastEdit = 0;
    let lastStatus = '';
    const onEvent = (evt: ClaudeEvent): void => {
      if (evt.type !== 'assistant') return;
      const tool = evt.message.content.find((b) => b.type === 'tool_use');
      if (!tool) return;
      const status = progressLine(tool.name);
      const now = Date.now();
      if (status !== lastStatus && now - lastEdit > PROGRESS_THROTTLE_MS) {
        lastEdit = now;
        lastStatus = status;
        void ctx.api
          .editMessageText(ctx.chat!.id, ph.message_id, status)
          .catch(() => undefined);
      }
    };

    try {
      const result = await this.conversation.send(chatId, text, onEvent);
      const body = (result.isError ? '⚠️ ' : '') + result.text;
      const parts = chunk(body);
      await ctx.api
        .editMessageText(ctx.chat!.id, ph.message_id, parts[0])
        .catch(() => undefined);
      for (let i = 1; i < parts.length; i++) {
        await ctx.reply(parts[i]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`turn failed for chat ${chatId}: ${msg}`);
      await ctx.api
        .editMessageText(ctx.chat!.id, ph.message_id, `❌ Ошибка: ${msg}`)
        .catch(() => undefined);
    }
  }

  // --- helpers ---

  private parseAllowed(csv: string): Set<number> {
    const ids = csv
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) {
      this.log.warn(
        'TELEGRAM_ALLOWED_USER_IDS пуст — бот никого не пустит (напишите боту, он покажет ваш ID).',
      );
    }
    return new Set(ids);
  }
}
