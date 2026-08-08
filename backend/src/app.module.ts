import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ContactsModule } from './contacts/contacts.module';
import { SimulacrosModule } from './simulacros/simulacros.module';
import { ConversationsModule } from './conversations/conversations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AiModule } from './ai/ai.module';
import { SettingsModule } from './settings/settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SseModule } from './sse/sse.module';

@Module({
  imports: [
    // Variables de entorno disponibles globalmente
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Base de datos
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        database: config.get('DB_NAME', 'crm_sanmarcos'),
        username: config.get('DB_USER', 'crm_user'),
        password: config.get('DB_PASSWORD', 'crm_password'),
        autoLoadEntities: true,
        synchronize: true, // En producción usar migrations
        logging: false,
      }),
      inject: [ConfigService],
    }),

    AuthModule,
    ContactsModule,
    SimulacrosModule,
    ConversationsModule,
    WebhooksModule,
    AiModule,
    SettingsModule,
    DashboardModule,
    SseModule,
  ],
})
export class AppModule {}
