import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { SessionModule } from '../session/session.module';
import { VoiceModule } from '../voice/voice.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [ConversationModule, SessionModule, VoiceModule],
  providers: [TelegramService],
})
export class TelegramModule {}
