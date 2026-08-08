import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { YCloudService } from '../ycloud/ycloud.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly ycloud: YCloudService,
  ) {}

  // Endpoint de webhook de YCloud
  // URL: POST /api/webhooks/ycloud
  @Post('ycloud')
  @HttpCode(HttpStatus.OK)
  async handleYcloud(
    @Body() payload: any,
    @Headers() headers: any,
    @Req() req: Request,
  ) {
    // Verificar firma si YCloud la envía
    const signature = headers['ycloud-signature'] || headers['x-ycloud-signature'] || '';
    const rawBody = JSON.stringify(payload);
    this.ycloud.verifyWebhookSignature(signature, rawBody);

    this.logger.log(`Webhook YCloud recibido: type=${payload?.type}`);

    // Procesar de forma asíncrona (YCloud espera 200 en < 5s)
    this.webhooksService.processYCloudWebhook(payload).catch((err) =>
      this.logger.error('Error en processYCloudWebhook:', err.message),
    );

    return { received: true };
  }
}
