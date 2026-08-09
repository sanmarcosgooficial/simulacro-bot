import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import { AiService } from '../ai/ai.service';
import { YCloudService } from '../ycloud/ycloud.service';
import { SettingsService } from '../settings/settings.service';
import { SseService } from '../sse/sse.service';
import { SimulacrosService } from '../simulacros/simulacros.service';
import { MessageRole, MessageType } from '../conversations/entities/message.entity';
import { ContactStatus } from '../contacts/entities/contact.entity';
import { ConversationStage } from '../conversations/entities/conversation.entity';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  // Debounce: timer por número de teléfono para esperar que el cliente termine de escribir
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  // Guardar el último messageId por teléfono para el typing indicator
  private readonly lastMessageId = new Map<string, string>();
  // Acumular todos los mensajes del periodo de debounce por teléfono
  private readonly pendingMessages = new Map<string, string[]>();
  // IDs de mensajes ya procesados (YCloud a veces reenvía el mismo webhook)
  private readonly processedMessageIds = new Set<string>();

  constructor(
    private readonly conversations: ConversationsService,
    private readonly contacts: ContactsService,
    private readonly ai: AiService,
    private readonly ycloud: YCloudService,
    private readonly settings: SettingsService,
    private readonly sse: SseService,
    private readonly config: ConfigService,
    private readonly simulacros: SimulacrosService,
  ) {}


  // Procesar webhook de YCloud
  async processYCloudWebhook(payload: any): Promise<void> {
    this.logger.log(`Webhook recibido tipo: ${payload?.type}`);

    // Evento de mensaje entrante de WhatsApp (formato oficial YCloud v2)
    if (payload.type === 'whatsapp.inbound_message.received') {
      await this.handleIncomingMessage(payload.whatsappInboundMessage);
    }
  }

  private async handleIncomingMessage(messageData: any): Promise<void> {
    if (!messageData) return;

    // El número viene sin '+' en YCloud: ej "51978069398"
    const rawPhone = messageData.from || '';
    const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;

    if (!phone || phone === '+') {
      this.logger.warn('Mensaje sin número de teléfono');
      return;
    }



    const profileName = messageData.customerProfile?.name || null;
    const messageType = messageData.type || 'text';
    const textContent = messageData.text?.body || '';
    const mediaUrl = messageData.image?.link || messageData.document?.link || null;
    const messageId = messageData.id || '';

    // Ignorar re-entregas del mismo mensaje (YCloud puede reenviar el mismo webhook)
    if (messageId && this.processedMessageIds.has(messageId)) {
      this.logger.log(`Mensaje duplicado ignorado (${messageId})`);
      return;
    }
    if (messageId) {
      this.processedMessageIds.add(messageId);
      // Evitar que el set crezca sin límite en memoria
      if (this.processedMessageIds.size > 1000) {
        const first = this.processedMessageIds.values().next().value;
        this.processedMessageIds.delete(first);
      }
    }

    // Guardar el último messageId para usarlo en el typing indicator
    this.lastMessageId.set(phone, messageId);

    // Acumular mensajes de texto durante el periodo de debounce
    if (textContent) {
      const pending = this.pendingMessages.get(phone) || [];
      pending.push(textContent);
      this.pendingMessages.set(phone, pending);
    }

    // Tiempo de lectura: apenas llega el primer mensaje del cliente (y no hay
    // debounce activo), mostramos el indicador "escribiendo..." para que el
    // cliente sepa que el bot está leyendo mientras espera sus mensajes por
    // partes (ej. "ok" + "enviado" + "me envía la información por favor").
    const isFirstInWindow = !this.debounceTimers.has(phone);
    if (isFirstInWindow && messageId) {
      try { await this.ycloud.sendTypingIndicator(phone, messageId); }
      catch (e) { this.logger.warn('Typing indicator no enviado: ' + e.message); }
    }

    // Capturar el stage ANTES del debounce para que mensajes múltiples
    // no confundan la etapa (el primero no debe avanzar antes de que el último procese)
    if (!(this as any)._stageSnapshot) (this as any)._stageSnapshot = {};
    if (!(this as any)._stageSnapshot[phone]) {
      // Solo guardamos el snapshot la primera vez (cuando no hay timer activo)
      const convSnapshot = await this.conversations.findByPhone(phone);
      (this as any)._stageSnapshot[phone] = convSnapshot?.stage || ConversationStage.NUEVA;
    }

    // Debounce: solo el ÚLTIMO mensaje en llegar dispara la respuesta.
    // Cada mensaje cancela el timer anterior y crea uno nuevo.
    // Al cancelar el timer anterior, la Promise de ese mensaje queda pendiente
    // para siempre — por eso usamos un flag (token) en lugar de Promise.
    const myToken = Date.now() + Math.random(); // token único para este mensaje
    (this as any)._lastToken = (this as any)._lastToken || {};
    (this as any)._lastToken[phone] = myToken;

    if (this.debounceTimers.has(phone)) {
      clearTimeout(this.debounceTimers.get(phone));
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // Limpiar el mapa para que el próximo mensaje (aunque sea horas después)
        // vuelva a considerar este número como "inicio de ventana" (typing indicator).
        this.debounceTimers.delete(phone);
        resolve();
      }, 7000);
      this.debounceTimers.set(phone, timer);
    });

    // Si mientras esperaba llegó otro mensaje, ese otro ya tomó el control → salir
    if ((this as any)._lastToken[phone] !== myToken) return;

    // Tomar todos los mensajes acumulados y limpiar el acumulador
    const allPending = this.pendingMessages.get(phone) || [textContent];
    this.pendingMessages.delete(phone);
    const combinedText = allPending.join(' ');

    // Recuperar el stage capturado antes del debounce y limpiar snapshot
    const snapshotStage = (this as any)._stageSnapshot?.[phone];
    if ((this as any)._stageSnapshot) delete (this as any)._stageSnapshot[phone];

    try {
      // 1. Buscar o crear contacto
      const contact = await this.contacts.findOrCreate(phone, profileName);

      // 2. Buscar o crear conversación
      const conversation = await this.conversations.findOrCreateByPhone(
        phone,
        profileName || contact.name,
      );

      // 3. Actualizar nombre si llegó del webhook
      if (profileName && !contact.name) {
        await this.contacts.update(contact.id, { name: profileName });
        await this.conversations.updateContactName(conversation.id, profileName);
      }

      // 4. Vincular contacto a conversación
      if (!conversation.contactId) {
        await this.conversations.linkContact(phone, contact.id);
      }

      // 5. Guardar el mensaje del usuario. Si hubo mensajes por partes acumulados
      //    en el debounce, guardamos el texto COMBINADO para que la IA tenga el
      //    contexto completo en los siguientes turnos ("ya postulo antes me envia
      //    la informacion enviado porfavor" y no solo la última parte).
      const userTextToSave = allPending.length > 1 ? combinedText : (textContent || `[${messageType}]`);
      const userMsg = await this.conversations.addMessage(
        conversation.id,
        MessageRole.USER,
        userTextToSave,
        {
          type: messageType === 'image' ? MessageType.IMAGE : 
                messageType === 'document' ? MessageType.DOCUMENT : MessageType.TEXT,
          mediaUrl,
          externalId: messageData.id,
        },
      );

      // 6. Emitir evento SSE de nuevo mensaje
      this.sse.emitNewMessage(conversation.id, {
        ...userMsg,
        conversationPhone: phone,
        contactName: profileName || contact.name,
      });

      // 7. Verificar si el agente está pausado
      if (conversation.isAgentPaused) {
        this.logger.log(`Agente pausado para ${phone}, no se responde automáticamente`);
        return;
      }

      // 8. Verificar si el agente está habilitado globalmente
      const agentEnabled = await this.settings.get('agent_enabled');
      if (agentEnabled === 'false') {
        this.logger.log('Agente IA deshabilitado globalmente');
        return;
      }

      // Leer el stage fresco de la BD para evitar usar un stage desactualizado
      const freshConv = await this.conversations.findByPhone(phone);
      const stage = (freshConv?.stage || conversation.stage || ConversationStage.NUEVA) as ConversationStage;
      this.logger.log(`[STAGE] ${phone} → ${stage} | msg: "${combinedText.substring(0,50)}"`);

      // ── COMPROBANTE DE PAGO ───────────────────────────────────────────────
      // Cualquier imagen después de iniciar el funnel se trata como comprobante
      // (aunque la IA no haya emitido [PAGO], no se pierde ninguna inscripción).
      const isPaymentStage =
        stage === ConversationStage.ESPERANDO_PAGO ||
        stage === ConversationStage.CONFIRMANDO ||
        stage === ConversationStage.CON_CARRERA ||
        stage === ConversationStage.CON_EXPERIENCIA ||
        stage === ConversationStage.CON_HORARIO;
      if (messageType === 'image' && isPaymentStage) {
        await this.sendAndSaveReply(conversation.id, phone,
          '¡Gracias! 📸 Recibí tu comprobante. El equipo lo verificará en breve y te confirmamos tu inscripción 🙏');
        await this.conversations.setStage(conversation.id, ConversationStage.INSCRITO);
        await this.contacts.update(contact.id, { status: ContactStatus.INSCRITO });
        this.sse.emitContactUpdated(contact);
        this.sse.emitDashboardUpdate({ refreshNeeded: true });
        return;
      }

      // ── MÁQUINA DE ESTADOS ────────────────────────────────────────────────
      const history = await this.conversations.getChatHistory(conversation.id, 40);

      // Detección estricta del mensaje del anuncio:
      // "Hola, quiero probarme en el Simulacro de San Marcos ⚕️!" — el mensaje
      // DEBE contener "quiero probarme" + "simulacro"/"san marcos".
      // Primero se limpian emojis/emoticonos (y variantes unicode) para que
      // el texto se lea puro: si el cliente manda el anuncio con emojis
      // (ej. "...San Marcos🧑⚕️!"), la detección funciona igual.
      const tLower = combinedText
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu, '')
        .toLowerCase();
      const isAdMessage = tLower.includes('quiero probarme') && /simulacro|san marcos/.test(tLower);

      // Si llega el mensaje del anuncio con la conversación estancada en el inicio
      // (etapa SALUDADA/CON_CARRERA sin avanzar), reiniciamos el flujo para empezar
      // de cero y evitar que el saludo se repita infinitamente.
      let effectiveStage = stage;
      if (isAdMessage && (stage === ConversationStage.SALUDADA || stage === ConversationStage.CON_CARRERA)) {
        this.logger.log(`[RESTART] Mensaje de anuncio en etapa ${stage} → reiniciando flujo para ${phone}`);
        await this.conversations.setStage(conversation.id, ConversationStage.NUEVA);
        effectiveStage = ConversationStage.NUEVA;
      }

      switch (effectiveStage) {

        // ETAPA 0: cliente nuevo → responde a CUALQUIER mensaje de consulta
        // (venga del anuncio de Meta o sea una consulta normal: "hola",
        // "cuánto cuesta", "info del simulacro"...). La IA abre la conversación:
        // si es el anuncio saluda y pregunta la carrera; si es una consulta,
        // la responde brevemente y luego lleva la conversación al guion.
        case ConversationStage.NUEVA: {
          const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
            name: contact.name, funnelStage: 'inicio', greeting: this.getGreeting(), isAdMessage,
          });
          if (aiReply && !aiReply.includes('Soy el asesor de Simulacros San Marcos')) {
            await this.sendSplitReply(conversation.id, phone, aiReply);
          } else {
            // Respaldo determinista si la IA falla: saludo según hora de Perú + pregunta la carrera
            await this.sendAndSaveReply(conversation.id, phone, `${this.getGreeting()} 😊`);
            await new Promise((r) => setTimeout(r, 1200));
            await this.sendAndSaveReply(conversation.id, phone, '¿A qué carrera postulas? 😊');
          }
          await this.conversations.setStage(conversation.id, ConversationStage.SALUDADA);
          await this.contacts.update(contact.id, { status: ContactStatus.INTERESADO });
          break;
        }

        // TODAS las demás etapas: la IA maneja la conversación libremente con el
        // historial completo como contexto. Solo se procesan los marcadores de acción.
        default: {
          const funnelStage =
            effectiveStage === ConversationStage.ESPERANDO_PAGO ? 'esperando_pago' :
            effectiveStage === ConversationStage.INSCRITO ? 'inscrito' : 'libre';

          const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
            name: contact.name, career: contact.career, funnelStage,
          });

          // Marcadores de acción: [FLYER] envía la imagen, [PAGO] activa la espera del comprobante
          const parsed = this.parseMarkers(aiReply);
          if (parsed.text) await this.sendSplitReply(conversation.id, phone, parsed.text);

          if (parsed.flyer) {
            await new Promise((r) => setTimeout(r, 1000));
            const activeSimulacros = await this.simulacros.findActive();
            const simFlyer = activeSimulacros.find((s) => (s as any).flyerUrl)?.flyerUrl;
            const globalFlyer = await this.settings.get('flyer_url');
            const rawPath = simFlyer || globalFlyer;
            if (rawPath?.trim()) {
              const publicUrl = this.config.get('BACKEND_PUBLIC_URL', '').replace(/\/$/, '');
              const base = publicUrl || `http://localhost:${this.config.get('PORT', '3001')}`;
              const flyerUrl = rawPath.startsWith('http') ? rawPath : `${base}${rawPath}`;
              try { await this.ycloud.sendImageMessage(phone, flyerUrl); }
              catch (e) { this.logger.warn('Flyer no enviado: ' + e.message); }
            } else {
              this.logger.warn('[FLYER] solicitado pero no hay flyer configurado (simulacro ni setting flyer_url)');
            }
            // Bookkeeping para el panel de administración
            if (effectiveStage !== ConversationStage.ESPERANDO_PAGO && effectiveStage !== ConversationStage.INSCRITO) {
              await this.conversations.setStage(conversation.id, ConversationStage.CON_EXPERIENCIA);
            }
          }

          if (parsed.pago) {
            await this.conversations.setStage(conversation.id, ConversationStage.ESPERANDO_PAGO);
            await this.contacts.update(contact.id, { status: ContactStatus.ESPERANDO_PAGO });
          }

          // Guardar la carrera en el CRM cuando la IA la detecte (para el panel)
          if (!contact.career && funnelStage === 'libre') {
            const aiCareer = await this.ai.detectCareer(combinedText);
            if (aiCareer) {
              this.logger.log(`[IA] Carrera guardada en CRM: "${aiCareer}" para ${phone}`);
              await this.contacts.update(contact.id, { career: aiCareer });
              if (effectiveStage === ConversationStage.SALUDADA) {
                await this.conversations.setStage(conversation.id, ConversationStage.CON_CARRERA);
              }
            }
          }
          break;
        }
      }
      this.sse.emitDashboardUpdate({ refreshNeeded: true });

    } catch (error) {
      this.logger.error(`Error procesando mensaje de ${phone}:`, error.message);
    }
  }

  // Enviar respuesta con soporte de || para 2 mensajes separados
  private async sendSplitReply(conversationId: string, phone: string, text: string): Promise<void> {
    const parts = text.split('||').map((p) => p.trim()).filter(Boolean);
    await this.sendAndSaveReply(conversationId, phone, parts[0]);
    if (parts[1]) {
      await new Promise((r) => setTimeout(r, 1200));
      await this.sendAndSaveReply(conversationId, phone, parts[1]);
    }
  }

  // Separar los marcadores de acción del texto que ve el cliente
  private parseMarkers(text: string): { text: string; flyer: boolean; pago: boolean } {
    const flyer = /\[FLYER\]/i.test(text);
    const pago = /\[PAGO\]/i.test(text);
    const clean = text.replace(/\[(FLYER|PAGO)\]/gi, '').trim();
    return { text: clean, flyer, pago };
  }

  private async sendAndSaveReply(
    conversationId: string,
    phone: string,
    text: string,
    showTyping = true,
  ): Promise<void> {
    // Mostrar "escribiendo..." mientras "piensa"
    if (showTyping) {
      const msgId = this.lastMessageId.get(phone) || '';
      if (msgId) await this.ycloud.sendTypingIndicator(phone, msgId);
    }

    // Delay natural: simula el tiempo de escritura (40ms por carácter, entre 1.5s y 5s)
    const typingDelay = Math.min(Math.max(text.length * 40, 1500), 5000);
    await new Promise((r) => setTimeout(r, typingDelay));

    // Guardar respuesta en DB
    const aiMsg = await this.conversations.addMessage(
      conversationId,
      MessageRole.ASSISTANT,
      text,
      { type: MessageType.TEXT },
    );

    // Enviar por WhatsApp
    await this.ycloud.sendTextMessage(phone, text);

    // Emitir evento SSE
    this.sse.emitNewMessage(conversationId, aiMsg);
  }

  // Saludo según la hora del día (hora de Perú UTC-5)
  private getGreeting(): string {
    // Peru es UTC-5, siempre fijo (no tiene horario de verano)
    const utcHour = new Date().getUTCHours();
    const peruHour = (utcHour - 5 + 24) % 24;

    if (peruHour >= 5 && peruHour < 12) return 'Buenos días';
    if (peruHour >= 12 && peruHour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }


}
