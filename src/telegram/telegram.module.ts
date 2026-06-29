import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { NOTIFIER } from '../notify/notifier';
import { SessionModule } from '../session/session.module';
import { VoiceModule } from '../voice/voice.module';
import { WhoopConnectModule } from '../whoop/connect/whoop-connect.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [ConversationModule, SessionModule, VoiceModule, WhoopConnectModule],
  providers: [
    TelegramService,
    { provide: NOTIFIER, useExisting: TelegramService },
  ],
  exports: [NOTIFIER],
})
export class TelegramModule {}
