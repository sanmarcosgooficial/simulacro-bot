import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { ContactsModule } from '../contacts/contacts.module';
import { AiModule } from '../ai/ai.module';
import { YCloudModule } from '../ycloud/ycloud.module';
import { SettingsModule } from '../settings/settings.module';
import { SseModule } from '../sse/sse.module';
import { SimulacrosModule } from '../simulacros/simulacros.module';

@Module({
  imports: [
    ConfigModule,
    ConversationsModule,
    ContactsModule,
    AiModule,
    YCloudModule,
    SettingsModule,
    SseModule,
    SimulacrosModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
