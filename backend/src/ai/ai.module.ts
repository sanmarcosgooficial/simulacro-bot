import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SettingsModule } from '../settings/settings.module';
import { SimulacrosModule } from '../simulacros/simulacros.module';

@Module({
  imports: [SettingsModule, SimulacrosModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
