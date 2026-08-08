import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SimulacroStatus } from '../entities/simulacro.entity';

export class CreateSimulacroDto {
  @ApiProperty({ example: 'Simulacro General Agosto 2025' })
  @IsString()
  title: string;

  @ApiProperty({ example: '2025-08-15' })
  @IsString()
  date: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  time: string;

  @ApiPropertyOptional({ example: 'Biomédicas' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ enum: SimulacroStatus })
  @IsOptional()
  @IsEnum(SimulacroStatus)
  status?: SimulacroStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flyerUrl?: string;

  @ApiPropertyOptional({ example: ['10:00 - 13:00', '17:00 - 20:00'] })
  @IsOptional()
  @IsArray()
  schedules?: string[];
}
