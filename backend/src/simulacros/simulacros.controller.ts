import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SimulacrosService } from './simulacros.service';
import { CreateSimulacroDto } from './dto/create-simulacro.dto';
import { UpdateSimulacroDto } from './dto/update-simulacro.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { R2Service } from '../r2/r2.service';

@ApiTags('simulacros')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('simulacros')
export class SimulacrosController {
  constructor(
    private readonly simulacrosService: SimulacrosService,
    private readonly config: ConfigService,
    private readonly r2: R2Service,
  ) {}

  @Get()
  findAll() {
    return this.simulacrosService.findAll();
  }

  @Get('active')
  findActive() {
    return this.simulacrosService.findActive();
  }

  @Get('areas')
  getAreas() {
    return this.simulacrosService.getAreasInfo();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.simulacrosService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSimulacroDto) {
    return this.simulacrosService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSimulacroDto) {
    return this.simulacrosService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.simulacrosService.remove(id);
  }

  @Post(':id/upload-flyer')
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
  async uploadFlyer(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const url = await this.r2.uploadFile(file, `flyer-sim-${id}`);
    await this.simulacrosService.update(id, { flyerUrl: url });
    return { url, message: 'Flyer subido correctamente' };
  }
}
