import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { Contact } from '../contacts/entities/contact.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Simulacro } from '../simulacros/entities/simulacro.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Conversation, Simulacro]),
    SettingsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
