import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class YCloudService {
  private readonly logger = new Logger(YCloudService.name);
  private readonly baseUrl = 'https://api.ycloud.com/v2';
  private apiKey: string;
  private phoneNumber: string;
  private webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get('YCLOUD_API_KEY', '');
    this.phoneNumber = this.config.get('YCLOUD_PHONE_NUMBER', '');
    this.webhookSecret = this.config.get('YCLOUD_WEBHOOK_SECRET', '');
  }

  // Detectar si un identificador es BSUID (ej. "US.13491208655302741918")
  private isBsuid(id: string): boolean {
    return /^[A-Z]{2}\.[A-Z0-9.]+$/i.test(id) && !id.startsWith('+');
  }

  // Construir el campo to/recipient según el tipo de identificador
  private buildRecipientFields(to: string): { to?: string; recipient?: string } {
    if (this.isBsuid(to)) {
      return { recipient: to }; // BSUID → campo recipient, sin 'to'
    }
    return { to }; // número normal → campo to
  }

  // Enviar mensaje de texto simple (con reply opcional)
  async sendTextMessage(to: string, text: string, replyToExternalId?: string): Promise<string | null> {
    if (!this.apiKey || this.apiKey === 'xxxxxxxxxx') {
      this.logger.warn(`[MODO DEMO] Mensaje a ${to}: ${text}`);
      return 'demo-id';
    }

    try {
      const body: any = {
        from: this.phoneNumber,
        ...this.buildRecipientFields(to),
        type: 'text',
        text: { body: text },
      };

      // Si hay un messageId al que responder, incluir contexto (cita)
      if (replyToExternalId) {
        body.context = { messageId: replyToExternalId };
      }

      const response = await axios.post(
        `${this.baseUrl}/whatsapp/messages`,
        body,
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`Mensaje enviado a ${to}: ${response.data.id}`);
      return response.data.id || null;
    } catch (error) {
      this.logger.error(`Error enviando mensaje a ${to}:`, error?.response?.data || error.message);
      return null;
    }
  }

  // Mostrar indicador de escritura ("escribiendo...") en WhatsApp
  async sendTypingIndicator(to: string, messageId: string): Promise<void> {
    if (!this.apiKey || this.apiKey === 'xxxxxxxxxx') return;
    try {
      await axios.post(
        `${this.baseUrl}/whatsapp/inboundMessages/${messageId}/typingIndicator`,
        {},
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch {
      // No es crítico si falla, seguimos igual
    }
  }

  // Enviar imagen — retorna el ID del mensaje enviado (para poder citarlo después)
  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<string | null> {
    if (!this.apiKey || this.apiKey === 'xxxxxxxxxx') {
      this.logger.warn(`[MODO DEMO] Imagen a ${to}: ${imageUrl}`);
      return 'demo-id';
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/whatsapp/messages`,
        {
          from: this.phoneNumber,
          ...this.buildRecipientFields(to),
          type: 'image',
          image: { link: imageUrl, caption },
        },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data.id || null;
    } catch (error) {
      this.logger.error(`Error enviando imagen a ${to}:`, error?.response?.data || error.message);
      return null;
    }
  }

  // Enviar texto citando (reply) un mensaje previo por su ID de YCloud
  async sendReplyMessage(to: string, text: string, quotedMessageId: string): Promise<void> {
    if (!this.apiKey || this.apiKey === 'xxxxxxxxxx') {
      this.logger.warn(`[MODO DEMO] Reply a ${to}: ${text}`);
      return;
    }
    try {
      await axios.post(
        `${this.baseUrl}/whatsapp/messages`,
        {
          from: this.phoneNumber,
          ...this.buildRecipientFields(to),
          type: 'text',
          text: { body: text },
          context: { messageId: quotedMessageId },
        },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Si falla el reply, enviar como mensaje normal
      this.logger.warn(`Reply falló, enviando sin cita: ${error?.response?.data?.message}`);
      await this.sendTextMessage(to, text);
    }
  }

  // Verificar firma HMAC del webhook de YCloud
  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    if (!this.webhookSecret || !signature) return true; // Sin secret = aceptar todo

    try {
      // YCloud usa HMAC-SHA256: firma = hmac(secret_sin_prefijo, rawBody)
      const secret = this.webhookSecret.startsWith('whsec_')
        ? this.webhookSecret.slice(6)
        : this.webhookSecret;

      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      // La firma que manda YCloud puede venir como "sha256=xxx" o solo "xxx"
      const received = signature.startsWith('sha256=')
        ? signature.slice(7)
        : signature;

      const match = crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(received.padEnd(expected.length, '0').slice(0, expected.length), 'hex'),
      );

      if (!match) {
        this.logger.warn('Firma de webhook inválida - posible mensaje no autorizado');
      }
      return match;
    } catch {
      // Si falla la verificación, igual aceptamos para no bloquear mensajes reales
      return true;
    }
  }
}
