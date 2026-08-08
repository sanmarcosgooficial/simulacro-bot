import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SimulacrosService } from './simulacros.service';
import { SimulacrosController } from './simulacros.controller';
import { Simulacro } from './entities/simulacro.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Simulacro]), ConfigModule],
  controllers: [SimulacrosController],
  providers: [SimulacrosService],
  exports: [SimulacrosService],
})
export class SimulacrosModule {}
