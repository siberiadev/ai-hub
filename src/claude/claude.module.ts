import { Module } from '@nestjs/common';
import { ClaudeClientService } from './claude-client.service';

@Module({
  providers: [ClaudeClientService],
  exports: [ClaudeClientService],
})
export class ClaudeModule {}
