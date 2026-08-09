import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Body,
  UseGuards,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { R2Service } from '../r2/r2.service';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly config: ConfigService,
    private readonly r2: R2Service,
  ) {}

  @Get()
  getAll() {
    return this.settingsService.getAll();
  }

  @Patch()
  updateMany(@Body() updates: Record<string, string>) {
    return this.settingsService.updateMany(updates);
  }

  // Limpiar datos de prueba de un número específico
  @Delete('clear-test-data')
  clearTestData(@Query('phone') phone: string) {
    return this.settingsService.clearTestData(phone);
  }

  // Subir flyer global
  @Post('upload-flyer')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Solo se permiten imágenes'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadFlyer(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const url = await this.r2.uploadFile(file, 'flyer-global');
    await this.settingsService.set('flyer_url', url);
    return { url, message: 'Flyer subido correctamente' };
  }

  // Limpiar mi número de prueba (MY_PHONE en .env)
  @Delete('clear-test-phones')
  async clearTestPhones() {
    const testPhones = this.config.get('MY_PHONE', '');
    if (!testPhones) {
      return { message: 'No hay número configurado en MY_PHONE del .env' };
    }

    const phones = testPhones.split(',').map((p) => p.trim()).filter(Boolean);
    const results = [];

    for (const phone of phones) {
      const result = await this.settingsService.clearTestData(phone);
      results.push(result);
    }

    return {
      message: `Limpiados ${phones.length} número(s): ${phones.join(', ')}`,
      results,
    };
  }
}
