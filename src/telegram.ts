// telegram.ts — grammY 봇 래퍼 (토픽/메시지/답장)
import { Bot, Context } from 'grammy';
import { DaemonConfig, SessionRecord } from './types.js';
import { ReplyQueue } from './reply-queue.js';
import { SessionsStore } from './store.js';
import { logger } from './logger.js';

export class TelegramBot {
  private bot: Bot | null = null;
  private config: DaemonConfig;
  private store: SessionsStore;
  private replyQueue: ReplyQueue;

  constructor(config: DaemonConfig, store: SessionsStore, replyQueue: ReplyQueue) {
    this.config = config;
    this.store = store;
    this.replyQueue = replyQueue;
  }

  async init(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error('botToken is required');
    }

    this.bot = new Bot(this.config.botToken);

    // 전역 에러 핸들링
    this.bot.catch((err) => {
      const ctx = err.ctx;
      const error = err.error as any;
      logger.error('Telegram bot error', {
        error: error?.message ?? String(err.error),
        chatId: ctx?.chat?.id,
        userId: ctx?.from?.id,
      });
    });

    // 메시지 핸들러 — 단일 리스너, 동적 등록 금지
    this.bot.on('message', (ctx) => this.handleMessage(ctx));

    // 폴링 시작
    await this.bot.start({
      allowed_updates: ['message'],
    });

    logger.info('Telegram bot started (polling)');
  }

  // ===== 토픽 관리 =====

  async createTopic(project: string): Promise<number> {
    if (!this.bot) throw new Error('Bot not initialized');

    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').slice(0, 16); // YYYY-MM-DD HH:mm
    const topicName = `${this.config.topicPrefix} ${project} — ${timeStr}`;

    const forumTopic = await this.bot.api.createForumTopic(
      this.config.groupId,
      topicName
    );

    logger.info('Forum topic created', {
      topic_id: forumTopic.message_thread_id,
      name: topicName,
    });

    return forumTopic.message_thread_id;
  }

  // ===== 메시지 전송 =====

  async sendStartMessage(
    chatId: number,
    topicId: number,
    sessionId: string,
    model: string
  ): Promise<number> {
    if (!this.bot) throw new Error('Bot not initialized');

    const msg = await this.bot.api.sendMessage(chatId, this.escapeMarkdownV2(
      `🟢 *새 세션*\n\nproject: ${sessionId}\nmodel: ${model}`
    ), {
      parse_mode: 'MarkdownV2',
      message_thread_id: topicId,
    });

    return msg.message_id;
  }

  async sendStopMessage(
    chatId: number,
    topicId: number,
    turnId: string,
    lastMessage: string,
    totalTurns: number
  ): Promise<number> {
    if (!this.bot) throw new Error('Bot not initialized');

    // lastMessage 500자 제한
    const preview = lastMessage.length > 500
      ? lastMessage.slice(0, 500) + '...'
      : lastMessage;

    const text = [
      `✅ *Turn #${totalTurns} 완료*`,
      '',
      this.escapeMarkdownV2(preview),
      '',
      '다음에는 뭘 할까\\?',
    ].join('\n');

    const msg = await this.bot.api.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      message_thread_id: topicId,
    });

    return msg.message_id;
  }

  async sendCompleteMessage(
    chatId: number,
    topicId: number,
    totalTurns: number,
    duration: string
  ): Promise<void> {
    if (!this.bot) throw new Error('Bot not initialized');

    await this.bot.api.sendMessage(chatId, this.escapeMarkdownV2(
      `🏁 *세션 종료*\n\n총 ${totalTurns}턴 · ${duration}`
    ), {
      parse_mode: 'MarkdownV2',
      message_thread_id: topicId,
    });
  }

  async sendReconnectMessage(
    chatId: number,
    topicId: number,
    sessionId: string
  ): Promise<void> {
    if (!this.bot) throw new Error('Bot not initialized');

    await this.bot.api.sendMessage(chatId, this.escapeMarkdownV2(
      `🔌 *재연결 완료*\n\nsession: ${sessionId}\n이전 세션 복원됨`
    ), {
      parse_mode: 'MarkdownV2',
      message_thread_id: topicId,
    });
  }

  async sendReplyFallbackMessage(
    chatId: number,
    topicId: number
  ): Promise<void> {
    if (!this.bot) throw new Error('Bot not initialized');

    await this.bot.api.sendMessage(chatId, '⚠️ 작업 완료 메시지에 Reply해주세요', {
      message_thread_id: topicId,
    });
  }

  async addReaction(
    chatId: number,
    messageId: number,
    emoji: string
  ): Promise<void> {
    if (!this.bot) throw new Error('Bot not initialized');

    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [
        { type: 'emoji', emoji } as any,
      ]);
    } catch (err) {
      logger.warn('Failed to add reaction', {
        chatId,
        messageId,
        emoji,
        error: (err as Error).message,
      });
    }
  }

  // ===== 메시지 핸들링 =====

  private async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message) return;

    // 1. forum 토픽이 아니면 무시 (General 토픽 등)
    if (!message.message_thread_id) return;

    // 2. reply인지 확인
    const replyTo = message.reply_to_message;
    if (replyTo) {
      // stop_message_id와 매칭
      const matched = this.matchReplyToSession(message.message_thread_id, replyTo.message_id);
      if (matched) {
        const replyText = message.text ?? message.caption ?? '';
        if (replyText.trim()) {
          this.replyQueue.deliver(matched, replyText.trim());
          // 👍 반응
          await this.addReaction(
            this.config.groupId,
            message.message_id,
            this.config.emojiReaction
          );
        }
        return;
      }

      // 매칭 실패 → fallback
      await this.sendReplyFallbackMessage(
        this.config.groupId,
        message.message_thread_id
      );
      return;
    }

    // 3. 일반 메시지 — active/waiting 세션이 있는 토픽인지 확인
    const session = this.getSessionByTopic(message.message_thread_id);
    if (session && session.record.status === 'waiting') {
      // waiting 상태면 일반 메시지도 답장으로 처리
      const replyText = message.text ?? message.caption ?? '';
      if (replyText.trim()) {
        this.replyQueue.deliver(session.id, replyText.trim());
        await this.addReaction(
          this.config.groupId,
          message.message_id,
          this.config.emojiReaction
        );
      }
      return;
    }

    // 그 외에는 무시
  }

  private matchReplyToSession(
    threadId: number,
    repliedToMessageId: number
  ): string | null {
    const sessions = this.store.listActive();
    for (const { id, record } of sessions) {
      if (
        record.topic_id === threadId &&
        record.stop_message_id === repliedToMessageId
      ) {
        return id;
      }
    }
    return null;
  }

  private getSessionByTopic(
    threadId: number
  ): { id: string; record: SessionRecord } | null {
    const sessions = this.store.listActive();
    for (const { id, record } of sessions) {
      if (record.topic_id === threadId) {
        return { id, record };
      }
    }
    return null;
  }

  // ===== MarkdownV2 이스케이프 =====

  private escapeMarkdownV2(text: string): string {
    const chars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    let result = text;
    for (const char of chars) {
      result = result.replaceAll(char, `\\${char}`);
    }
    return result;
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      logger.info('Telegram bot stopped');
    }
  }
}
