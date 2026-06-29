import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bot, Context, InlineKeyboard } from 'grammy';
import { parseAsk } from '../claude/ask-protocol';
import { ClaudeEvent } from '../claude/claude.types';
import { ConversationService } from '../conversation/conversation.service';
import { SessionService } from '../session/session.service';
import { TranscriptionService } from '../voice/transcription.service';
import { WhoopAuthUrlService } from '../whoop/connect/whoop-auth-url.service';
import { WhoopBackfillTriggerService } from '../whoop/connect/whoop-backfill-trigger.service';
import { FINANCE_IMPORT } from '../finance/finance.types';
import type { FinanceImportService } from '../finance/import/finance-import.service';
import { formatImportSummary } from '../finance/import/finance-summary.util';
import { Notifier } from '../notify/notifier';
import {
  canRenderRich,
  chunk,
  clampForEdit,
  formatAge,
  shortId,
} from './telegram-format.util';

/** Минимальный интервал между правками плейсхолдера, мс. */
const PROGRESS_THROTTLE_MS = 1200;

/** Канонические промпты отчётов WHOOP (кнопки меню → ход к Claude через mcp__whoop__read). */
const WHOOP_REPORT_DAY =
  'Give me a short report on my WHOOP data for today: recovery, HRV, resting heart ' +
  'rate, sleep, and daily strain. Keep it concise.';
const WHOOP_REPORT_WEEK =
  'Give me a report on my WHOOP data for the last 7 days: averages and trends for ' +
  'recovery, HRV, resting heart rate, sleep, and strain. Note the dynamics.';
const WHOOP_REPORT_MONTH =
  'Give me a report on my WHOOP data for the last 30 days: trends for recovery, HRV, ' +
  'resting heart rate, sleep, and strain. Note the dynamics and notable changes.';

/**
 * Telegram-бот (grammY, long polling). Принимает сообщения, гоняет их через
 * ConversationService, показывает прогресс в плейсхолдере и отдаёт ответ.
 * Доступ ограничен allowlist по Telegram user id (single-user).
 */
@Injectable()
export class TelegramService
  implements OnModuleInit, OnModuleDestroy, Notifier
{
  private readonly log = new Logger(TelegramService.name);
  private bot?: Bot;
  private allowed = new Set<number>();
  /** Токен бота — для скачивания файлов (getFile + download). */
  private botToken = '';
  /** Рендерить финал как rich-сообщение (нативные таблицы и пр.). */
  private richEnabled = false;
  /** Варианты ожидающего вопроса по chatId (один на чат; очередь сериализует ходы). */
  private readonly pendingAsk = new Map<string, string[]>();

  constructor(
    private readonly config: ConfigService,
    private readonly conversation: ConversationService,
    private readonly sessions: SessionService,
    private readonly transcription: TranscriptionService,
    private readonly whoopAuthUrl: WhoopAuthUrlService,
    private readonly whoopBackfill: WhoopBackfillTriggerService,
    @Optional()
    @Inject(FINANCE_IMPORT)
    private readonly financeImport?: FinanceImportService,
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
    this.richEnabled =
      this.config.get<string>('TELEGRAM_RICH', 'true') !== 'false';

    this.botToken = token;
    const bot = new Bot(token);
    this.bot = bot;

    bot.use(this.guard);
    bot.command('start', (ctx) => this.onStart(ctx));
    bot.command('new', (ctx) => this.onNew(ctx));
    bot.command('sessions', (ctx) => this.onSessions(ctx));
    bot.command('resume', (ctx) => this.onResume(ctx));
    bot.command('whoop', (ctx) => this.onWhoop(ctx));
    bot.command('finance', (ctx) => this.onFinanceHelp(ctx));
    bot.on('message:text', (ctx) => this.onText(ctx));
    bot.on('message:voice', (ctx) => this.onVoice(ctx));
    bot.on('message:document', (ctx) => this.onDocument(ctx));
    bot.callbackQuery(/^ask:(\d+)$/, (ctx) => this.onAskChoice(ctx));
    bot.callbackQuery(/^whoop:(login|sync|day|week|month)$/, (ctx) =>
      this.onWhoopMenu(ctx),
    );
    bot.catch((err) => this.log.error(`bot error: ${err.message}`, err.stack));

    // Меню команд Telegram (то, что показывается в клиенте). Best-effort.
    void bot.api
      .setMyCommands([
        { command: 'new', description: 'new session' },
        { command: 'sessions', description: 'list sessions' },
        { command: 'resume', description: 'switch to session N' },
        { command: 'whoop', description: 'WHOOP menu' },
        { command: 'finance', description: 'import bank statements (PDF)' },
      ])
      .catch((err) =>
        this.log.warn(`setMyCommands: ${(err as Error).message}`),
      );

    // Кнопка «Menu» слева от поля ввода → показывает список команд выше.
    void bot.api
      .setChatMenuButton({ menu_button: { type: 'commands' } })
      .catch((err) =>
        this.log.warn(`setChatMenuButton: ${(err as Error).message}`),
      );

    void bot
      .start({
        onStart: (info) =>
          this.log.log(`Telegram-бот запущен: @${info.username}`),
      })
      .catch((err) =>
        this.log.error(`не удалось запустить бота: ${(err as Error).message}`),
      );
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot?.stop();
  }

  // --- middleware ---

  private guard = async (
    ctx: Context,
    next: () => Promise<void>,
  ): Promise<void> => {
    const id = ctx.from?.id;
    if (!id || !this.allowed.has(id)) {
      await ctx.reply(
        `⛔ Not authorized. Your Telegram ID: ${id ?? 'unknown'}.\n` +
          `Add it to TELEGRAM_ALLOWED_USER_IDS and restart the bot.`,
      );
      return;
    }
    await next();
  };

  // --- команды ---

  private async onStart(ctx: Context): Promise<void> {
    await ctx.reply(
      "Hi! I'm a bridge to Claude.\n\n" +
        "Just send a message — I'll reply.\n\n" +
        'Commands:\n' +
        '/new — new session\n' +
        '/sessions — list sessions\n' +
        '/resume N — switch to session N\n' +
        '/whoop — WHOOP menu (connect, sync, reports)\n\n' +
        `Your ID: ${ctx.from?.id}`,
    );
  }

  /** /whoop: присылает сообщение с inline-меню WHOOP (кнопки в области чата). */
  private async onWhoop(ctx: Context): Promise<void> {
    const kb = new InlineKeyboard()
      .text('Login', 'whoop:login')
      .text('Sync', 'whoop:sync')
      .row()
      .text('Report: day', 'whoop:day')
      .row()
      .text('Report: week', 'whoop:week')
      .text('Report: month', 'whoop:month');
    await ctx.reply('🏃 WHOOP — choose an action:', { reply_markup: kb });
  }

  /** Нажата кнопка inline-меню WHOOP. */
  private async onWhoopMenu(ctx: Context): Promise<void> {
    const action = (ctx.match as RegExpMatchArray)[1];
    await ctx.answerCallbackQuery();
    switch (action) {
      case 'login':
        await this.whoopLogin(ctx);
        return;
      case 'sync':
        await this.runWhoopBackfill(ctx);
        return;
      case 'day':
      case 'week':
      case 'month': {
        const chatId = String(ctx.chat!.id);
        this.pendingAsk.delete(chatId);
        const prompt =
          action === 'day'
            ? WHOOP_REPORT_DAY
            : action === 'week'
              ? WHOOP_REPORT_WEEK
              : WHOOP_REPORT_MONTH;
        await this.processTurn(ctx, prompt);
        return;
      }
    }
  }

  /** Login: строит authorize-URL WHOOP и присылает ссылку для согласия. */
  private async whoopLogin(ctx: Context): Promise<void> {
    const configured =
      this.config.get<string>('WHOOP_CLIENT_ID')?.trim() &&
      this.config.get<string>('WHOOP_REDIRECT_URI')?.trim();
    if (!configured) {
      await ctx.reply(
        '⚠️ WHOOP is not configured (no WHOOP_CLIENT_ID / WHOOP_REDIRECT_URI).',
      );
      return;
    }
    const { url } = this.whoopAuthUrl.buildAuthorizeUrl();
    await ctx.reply('🔗 Connect WHOOP:\n' + url, {
      link_preview_options: { is_disabled: true },
    });
  }

  /** Sync: запускает исторический бэкфилл WHOOP в фоне (вся история). */
  private async runWhoopBackfill(ctx: Context): Promise<void> {
    if (!this.whoopBackfill.configured) {
      await ctx.reply(
        '⚠️ WHOOP backfill is not configured (no WHOOP_CONNECT_SECRET).',
      );
      return;
    }
    const status = await ctx.reply('⏳ Starting WHOOP history import…');
    try {
      const res = await this.whoopBackfill.trigger();
      const scope =
        res.since === '2000-01-01T00:00:00.000Z'
          ? 'all history'
          : `since ${res.since}`;
      const text = res.alreadyRunning
        ? '↻ Backfill is already running — wait for it to finish.'
        : `✅ Import started (${scope}). Running in background — check results later.`;
      await ctx.api
        .editMessageText(ctx.chat!.id, status.message_id, text)
        .catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`whoop sync failed: ${msg}`);
      await ctx.api
        .editMessageText(
          ctx.chat!.id,
          status.message_id,
          `❌ Failed to start: ${msg}`,
        )
        .catch(() => undefined);
    }
  }

  private async onNew(ctx: Context): Promise<void> {
    const s = this.sessions.createNew(String(ctx.chat!.id));
    await ctx.reply(`🆕 New session started (${shortId(s.sessionId)}).`);
  }

  private async onSessions(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const list = this.sessions.list(chatId);
    if (!list.length) {
      await ctx.reply('No sessions yet. Send a message to start.');
      return;
    }
    const active = this.sessions.getActive(chatId);
    const lines = list.map((s, i) => {
      const mark = active && s.sessionId === active.sessionId ? '⭐' : '▫️';
      const label = s.title ?? shortId(s.sessionId);
      return `${i + 1}. ${mark} ${label} · turns:${s.turnCount} · ${formatAge(s.lastUsedAt)}`;
    });
    await ctx.reply('Sessions:\n' + lines.join('\n') + '\n\nSwitch: /resume N');
  }

  private async onResume(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const arg = (ctx.match as string)?.trim();
    const list = this.sessions.list(chatId);
    const n = Number(arg);
    if (!arg || !Number.isInteger(n) || n < 1 || n > list.length) {
      await ctx.reply('Specify a session number: /resume N (see /sessions).');
      return;
    }
    const target = list[n - 1];
    this.sessions.setActive(chatId, target.sessionId);
    await ctx.reply(
      `↩️ Switched to session ${n} (${shortId(target.sessionId)}).`,
    );
  }

  // --- основной поток ---

  private async onText(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    this.pendingAsk.delete(chatId); // свободный ввод отменяет ожидающий вопрос
    await this.processTurn(ctx, ctx.message!.text!);
  }

  /** Голосовое сообщение: скачать → распознать (whisper) → прогнать как обычный текст. */
  private async onVoice(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    this.pendingAsk.delete(chatId);

    if (!this.transcription.enabled) {
      await ctx.reply('🎤 Voice transcription is not configured.');
      return;
    }

    await ctx.replyWithChatAction('typing').catch(() => undefined);
    const status = await ctx.reply('🎤 transcribing…');
    let oggPath: string | undefined;
    try {
      oggPath = await this.downloadVoice(ctx);
      const text = await this.transcription.transcribe(oggPath);
      if (!text) {
        await ctx.api
          .editMessageText(
            ctx.chat!.id,
            status.message_id,
            '🎤 Could not transcribe.',
          )
          .catch(() => undefined);
        return;
      }
      await ctx.api
        .editMessageText(ctx.chat!.id, status.message_id, `🎤 «${text}»`)
        .catch(() => undefined);
      await this.processTurn(ctx, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`voice failed for chat ${chatId}: ${msg}`);
      await ctx.api
        .editMessageText(
          ctx.chat!.id,
          status.message_id,
          `❌ Transcription error: ${msg}`,
        )
        .catch(() => undefined);
    } finally {
      if (oggPath) await rm(oggPath, { force: true }).catch(() => undefined);
    }
  }

  /** Подсказка по финансовому модулю. */
  private async onFinanceHelp(ctx: Context): Promise<void> {
    if (!this.financeImport) {
      await ctx.reply('⚠️ Finance module is disabled (no DATABASE_URL).');
      return;
    }
    await ctx.reply(
      "📄 Send a PDF statement as a file — I'll parse it and add transactions to the ledger.\n\n" +
        'Supported: Mox Bank, Standard Chartered, Alipay HK.\n' +
        'Re-uploading the same file is rejected (dedup by content).',
    );
  }

  /** Документ (ожидаем PDF-выписку): скачать → распарсить → занести в леджер → сводка. */
  private async onDocument(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    this.pendingAsk.delete(chatId);

    const doc = ctx.message?.document;
    const name = doc?.file_name ?? 'file';
    const isPdf = doc?.mime_type === 'application/pdf' || /\.pdf$/i.test(name);
    if (!isPdf) {
      await ctx.reply(
        '📄 Send a bank PDF statement (Mox / Standard Chartered / Alipay).',
      );
      return;
    }
    if (!this.financeImport) {
      await ctx.reply('⚠️ Finance module is disabled (no DATABASE_URL).');
      return;
    }

    await ctx.replyWithChatAction('typing').catch(() => undefined);
    const status = await ctx.reply('📄 parsing statement…');
    try {
      const buf = await this.downloadDocument(ctx);
      const result = await this.financeImport.importPdf(buf, name);
      const text = formatImportSummary(result);
      await ctx.api
        .editMessageText(ctx.chat!.id, status.message_id, text)
        .catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`document import failed for chat ${chatId}: ${msg}`);
      await ctx.api
        .editMessageText(
          ctx.chat!.id,
          status.message_id,
          `❌ Import error: ${msg}`,
        )
        .catch(() => undefined);
    }
  }

  /** Скачивает документ в память (Buffer). */
  private async downloadDocument(ctx: Context): Promise<Buffer> {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Скачивает голосовой файл во временный .ogg, возвращает путь. */
  private async downloadVoice(ctx: Context): Promise<string> {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const path = join(tmpdir(), `aihub-${randomUUID()}.ogg`);
    await writeFile(path, buf);
    return path;
  }

  /** Нажата кнопка ответа на уточняющий вопрос. */
  private async onAskChoice(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const options = this.pendingAsk.get(chatId);
    const idx = Number((ctx.match as RegExpMatchArray)[1]);
    const chosen = options?.[idx];
    if (!chosen) {
      await ctx.answerCallbackQuery('Question expired');
      return;
    }
    this.pendingAsk.delete(chatId);
    await ctx.answerCallbackQuery();
    // убрать кнопки и пометить выбор (edit без reply_markup снимает клавиатуру)
    await ctx.editMessageText(`✅ ${chosen}`).catch(() => undefined);
    await this.processTurn(ctx, chosen);
  }

  /** Один ход: индикатор «печатает…» → стриминг текста → финал (текст или вопрос с кнопками). */
  private async processTurn(ctx: Context, userText: string): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const tgChatId = ctx.chat!.id;

    // Нативный индикатор «печатает…». Telegram гасит его ~5с → обновляем каждые 4с,
    // пока не пойдёт текст ответа.
    const sendTyping = () =>
      void ctx.api.sendChatAction(tgChatId, 'typing').catch(() => undefined);
    sendTyping();
    let typingTimer: NodeJS.Timeout | undefined = setInterval(sendTyping, 4000);
    const stopTyping = () => {
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = undefined;
      }
    };

    // Сообщение с ответом создаётся на ПЕРВОМ токене (до этого виден индикатор).
    let msgId: number | undefined;
    let creating: Promise<void> | undefined;
    let streamed = '';
    let lastShown = '';
    let lastEdit = 0;

    const onEvent = (evt: ClaudeEvent): void => {
      if (
        evt.type !== 'stream_event' ||
        evt.event.delta?.type !== 'text_delta' ||
        !evt.event.delta.text
      ) {
        return;
      }
      streamed += evt.event.delta.text;
      const clamped = clampForEdit(streamed);
      if (!clamped) return;
      const now = Date.now();

      if (msgId === undefined) {
        if (creating) return; // сообщение уже создаётся — ждём
        stopTyping();
        lastShown = clamped;
        lastEdit = now;
        creating = ctx
          .reply(clamped)
          .then((m) => {
            msgId = m.message_id;
          })
          .catch(() => undefined);
        return;
      }
      if (clamped !== lastShown && now - lastEdit > PROGRESS_THROTTLE_MS) {
        lastEdit = now;
        lastShown = clamped;
        void ctx.api
          .editMessageText(tgChatId, msgId, clamped)
          .catch(() => undefined);
      }
    };

    try {
      const result = await this.conversation.send(chatId, userText, onEvent);
      stopTyping();
      await creating; // дождаться создания сообщения, если оно началось

      if (result.isError) {
        await this.renderFinal(ctx, tgChatId, msgId, '⚠️ ' + result.text);
        return;
      }

      const { text, ask } = parseAsk(result.text);
      if (ask) {
        this.pendingAsk.set(chatId, ask.options);
        const kb = new InlineKeyboard();
        ask.options.forEach((opt, i) => kb.text(opt, `ask:${i}`).row());
        const body = (text ? text + '\n\n' : '') + '❓ ' + ask.question;
        const shown = clampForEdit(body);
        if (msgId !== undefined) {
          await ctx.api
            .editMessageText(tgChatId, msgId, shown, { reply_markup: kb })
            .catch(() => undefined);
        } else {
          await ctx.reply(shown, { reply_markup: kb });
        }
        return;
      }

      await this.sendRichOrPlain(ctx, tgChatId, msgId, text);
    } catch (err) {
      stopTyping();
      await creating;
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`turn failed for chat ${chatId}: ${msg}`);
      await this.renderFinal(ctx, tgChatId, msgId, `❌ Error: ${msg}`);
    }
  }

  /** Финал нормального ответа: rich (нативные таблицы) с фолбэком на обычный текст. */
  private async sendRichOrPlain(
    ctx: Context,
    tgChatId: number,
    msgId: number | undefined,
    body: string,
  ): Promise<void> {
    if (canRenderRich(body, this.richEnabled)) {
      try {
        if (msgId !== undefined) {
          await ctx.api.editMessageText(tgChatId, msgId, { markdown: body });
        } else {
          await ctx.replyWithRichMessage({ markdown: body });
        }
        return;
      } catch (e) {
        this.log.warn(
          `rich render failed, fallback to plain: ${(e as Error).message}`,
        );
      }
    }
    await this.renderFinal(ctx, tgChatId, msgId, body);
  }

  /** Выводит финальный текст: правит плейсхолдер (если был стриминг) + чанкинг. */
  private async renderFinal(
    ctx: Context,
    tgChatId: number,
    msgId: number | undefined,
    body: string,
  ): Promise<void> {
    const parts = chunk(body);
    if (msgId !== undefined) {
      await ctx.api
        .editMessageText(tgChatId, msgId, parts[0])
        .catch(() => undefined);
    } else {
      await ctx.reply(parts[0]);
    }
    for (let i = 1; i < parts.length; i++) {
      await ctx.reply(parts[i]);
    }
  }

  /** Notifier: разослать алерт владельцам из allowlist. No-op, если бот не запущен. */
  async notifyOwner(text: string): Promise<void> {
    if (!this.bot) return;
    for (const id of this.allowed) {
      try {
        await this.bot.api.sendMessage(id, text);
      } catch (err) {
        this.log.warn(`notifyOwner ${id}: ${(err as Error).message}`);
      }
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
