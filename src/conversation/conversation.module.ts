import { Module } from '@nestjs/common';
import { ClaudeModule } from '../claude/claude.module';
import { SessionModule } from '../session/session.module';
import { ChatQueue } from './chat-queue';
import { ConversationService } from './conversation.service';

@Module({
  imports: [SessionModule, ClaudeModule],
  providers: [ConversationService, ChatQueue],
  exports: [ConversationService],
})
export class ConversationModule {}
