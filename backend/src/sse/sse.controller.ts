import { Controller, Get, Sse, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { SseService } from './sse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('sse')
@Controller('sse')
export class SseController {
  constructor(private readonly sseService: SseService) {}

  // Endpoint SSE para el frontend - no requiere guard para evitar problemas con EventSource
  @Get('events')
  @Sse()
  events(): Observable<MessageEvent> {
    return this.sseService.getObservable().pipe(
      map((event) => ({
        type: event.type,
        data: JSON.stringify(event.data),
      } as MessageEvent)),
    );
  }
}
