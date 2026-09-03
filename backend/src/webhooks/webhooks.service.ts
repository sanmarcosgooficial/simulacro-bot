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
  // (30s por defecto; cada mensaje nuevo reinicia el contador). Ver this.debounceMs.
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  // Tiempo de espera del debounce en milisegundos (default 30000 = 30s).
  private readonly debounceMs: number;
  // Guardar el último messageId por teléfono para el typing indicator
  private readonly lastMessageId = new Map<string, string>();
  // Acumular todos los mensajes del periodo de debounce por teléfono
  private readonly pendingMessages = new Map<string, string[]>();
  // Acumular si llegó una imagen durante el debounce (para no perderla si llega con texto)
  private readonly pendingImage = new Map<string, { url: string }>();
  // IDs de mensajes ya procesados (YCloud a veces reenvía el mismo webhook)
  private readonly processedMessageIds = new Set<string>();
  // Lock por teléfono: evita que dos mensajes se procesen en paralelo para el mismo número
  private readonly processingLock = new Set<string>();

  constructor(
    private readonly conversations: ConversationsService,
    private readonly contacts: ContactsService,
    private readonly ai: AiService,
    private readonly ycloud: YCloudService,
    private readonly settings: SettingsService,
    private readonly sse: SseService,
    private readonly config: ConfigService,
    private readonly simulacros: SimulacrosService,
  ) {
    // Cuánto esperamos SIN mensajes antes de responder. Cada mensaje nuevo
    // reinicia el contador a 0. Configurable con AI_DEBOUNCE_MS (ms).
    // Default 10s (10000ms) para dar tiempo a que el cliente escriba completo.
    this.debounceMs = Number(this.config.get('AI_DEBOUNCE_MS', '10000')) || 10000;
  }


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
    // Desde marzo 2026, si el usuario tiene username de WhatsApp, 'from' puede
    // venir vacío y el identificador está en 'fromUserId' (BSUID).
    // Usamos: número de teléfono si viene, BSUID como fallback.
    const rawPhone = messageData.from || '';
    const fromUserId = messageData.fromUserId || ''; // BSUID del usuario
    const isBsuid = !rawPhone && !!fromUserId; // solo BSUID si no hay número
    const phone = rawPhone
      ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`)
      : fromUserId; // fallback al BSUID

    if (!phone) {
      this.logger.warn('Mensaje sin número de teléfono ni BSUID');
      return;
    }

    if (isBsuid) {
      this.logger.log(`[BSUID] Cliente con username de WhatsApp: ${fromUserId}`);
    }



    const profileName = messageData.customerProfile?.name || null;
    const messageType = messageData.type || 'text';
    // El caption de una imagen/video también cuenta como texto (ej. anuncios de Meta
    // que llegan como imagen con el mensaje del cliente en el caption)
    const textContent = messageData.text?.body || messageData.image?.caption || messageData.video?.caption || '';
    const mediaUrl = messageData.image?.link || messageData.document?.link || null;
    const messageId = messageData.id || '';
    // Detectar si viene de un anuncio de Meta (Instagram/Facebook → WhatsApp)
    // Según la doc de YCloud el campo es referral.source_type === 'ad'
    const hasReferral = !!(messageData.referral?.source_type);

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

    // Ignorar tipos de mensaje que no aportan al flujo de ventas (stickers, audios, videos, reacciones)
    const ignoredTypes = ['sticker', 'audio', 'voice', 'video', 'reaction', 'location', 'contacts'];
    if (ignoredTypes.includes(messageType)) {
      this.logger.log(`[IGNORADO] Mensaje de tipo "${messageType}" de ${phone} — sin respuesta`);
      return;
    }

    // Acumular mensajes de texto durante el periodo de debounce
    if (textContent) {
      const pending = this.pendingMessages.get(phone) || [];
      pending.push(textContent);
      this.pendingMessages.set(phone, pending);
    }

    // Si llegó una imagen, acumularla para que el debounce no la pierda
    // aunque después llegue un mensaje de texto en la misma ventana
    if (messageType === 'image' && mediaUrl) {
      this.pendingImage.set(phone, { url: mediaUrl });
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

    // Debounce de 30 segundos (configurable con AI_DEBOUNCE_MS):
    // cada mensaje nuevo cancela el timer anterior, reinicia el contador a 0 y
    // crea uno nuevo. La IA responde UNA sola vez, con TODOS los mensajes
    // combinados, cuando el cliente deja de escribir 30s seguidos.
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
      }, this.debounceMs);
      this.debounceTimers.set(phone, timer);
    });

    // Si mientras esperaba llegó otro mensaje, ese otro ya tomó el control → salir
    if ((this as any)._lastToken[phone] !== myToken) return;

    // Si ya hay un procesamiento activo para este número, esperar hasta que termine
    if (this.processingLock.has(phone)) {
      this.logger.log(`[LOCK] ${phone} ya está procesando, mensaje descartado para evitar duplicado`);
      return;
    }
    this.processingLock.add(phone);

    // Tomar todos los mensajes acumulados y limpiar el acumulador
    const allPending = this.pendingMessages.get(phone) || [textContent];
    this.pendingMessages.delete(phone);
    const combinedText = allPending.join(' ');

    // Recuperar imagen acumulada durante el debounce (si llegó foto + texto juntos)
    // La imagen tiene prioridad: si en la ventana llegó una imagen, se trata como imagen.
    // EXCEPCIÓN: si viene de un anuncio de Meta (hasReferral), la imagen ES el creativo
    // del anuncio, no un comprobante — se trata como texto para seguir el flujo normal.
    const pendingImg = this.pendingImage.get(phone);
    this.pendingImage.delete(phone);
    const isAdImage = (messageType === 'image' || !!pendingImg) && hasReferral;
    const effectiveMessageType = isAdImage ? 'text' : (pendingImg ? 'image' : messageType);
    const effectiveMediaUrl = pendingImg ? pendingImg.url : mediaUrl;

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
      const userTextToSave = allPending.length > 1 ? combinedText : (textContent || `[${effectiveMessageType}]`);
      const userMsg = await this.conversations.addMessage(
        conversation.id,
        MessageRole.USER,
        userTextToSave,
        {
          type: effectiveMessageType === 'image' ? MessageType.IMAGE : 
                effectiveMessageType === 'document' ? MessageType.DOCUMENT : MessageType.TEXT,
          mediaUrl: effectiveMediaUrl,
          externalId: messageData.id,
        },
      );

      // 6. Emitir evento SSE de nuevo mensaje
      this.sse.emitNewMessage(conversation.id, {
        ...userMsg,
        conversationPhone: phone,
        contactName: profileName || contact.name,
      });

      // 7. Verificar si el agente está pausado (releer de BD para tener el valor más fresco)
      const freshConvPause = await this.conversations.findByPhone(phone);
      if (freshConvPause?.isAgentPaused || conversation.isAgentPaused) {
        this.logger.log(`Agente pausado para ${phone}, no se responde automáticamente`);
        return;
      }
      // Si el cliente ya está inscrito, no responder bajo ninguna circunstancia
      if (freshConvPause?.stage === ConversationStage.INSCRITO) {
        this.logger.log(`Cliente inscrito ${phone}, bot silenciado`);
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
      let stage = (freshConv?.stage || conversation.stage || ConversationStage.NUEVA) as ConversationStage;

      // ── ANTI-PÉRDIDA DE CONTEXTO ──────────────────────────────────────────
      // Si el cliente vuelve a escribir mucho después (ej. horas o al día
      // siguiente), el stage de la BD puede estar "congelado" en una etapa
      // intermedia del funnel. Para no forzar al bot a repetir preguntas ya
      // respondidas, si pasó más de 2h desde el último mensaje y el stage no es
      // INSCRITO/ESPERANDO_PAGO (estados que siguen siendo válidos), se resetea
      // a un estado neutro y la IA retoma con TODO el historial como contexto.
      const STALE_MS = 2 * 60 * 60 * 1000; // 2 horas
      const lastMsgTime = freshConv?.lastMessageAt ? new Date(freshConv.lastMessageAt).getTime() : 0;
      const isStale =
        lastMsgTime > 0 &&
        Date.now() - lastMsgTime > STALE_MS &&
        stage !== ConversationStage.INSCRITO &&
        stage !== ConversationStage.ESPERANDO_PAGO;
      if (isStale) {
        this.logger.log(`[STALE] ${phone}: ${Math.round((Date.now() - lastMsgTime) / 60000)}min sin actividad, reset de stage ${stage} → nuevo`);
        stage = ConversationStage.NUEVA;
        await this.conversations.setStage(conversation.id, ConversationStage.NUEVA);
      }
      this.logger.log(`[STAGE] ${phone} → ${stage} | msg: "${combinedText.substring(0,50)}"`);

      // ── COMPROBANTE DE PAGO ───────────────────────────────────────────────
      // Solo se trata como comprobante si:
      //   1. El mensaje es una IMAGEN (no texto, no audio, no sticker)
      //   2. El stage es ESPERANDO_PAGO o CONFIRMANDO (el bot ya pidió el Yape)
      //   3. NO viene de un anuncio de Meta (los anuncios llegan como imagen con caption)
      // Así evitamos que cualquier foto en etapas tempranas se tome como pago.
      const isPaymentStage =
        stage === ConversationStage.ESPERANDO_PAGO ||
        stage === ConversationStage.CONFIRMANDO;

      // IMAGEN en etapa de pago → comprobante real
      if (effectiveMessageType === 'image' && isPaymentStage && !hasReferral) {
        await this.sendAndSaveReply(conversation.id, phone,
          '¡Gracias! 📸 Recibí tu comprobante. El equipo lo verificará en breve y te confirmamos tu inscripción 🙏');
        await this.conversations.setStage(conversation.id, ConversationStage.INSCRITO);
        const updatedConv = await this.conversations.toggleAgent(conversation.id, true);
        await this.contacts.update(contact.id, { status: ContactStatus.INSCRITO });
        this.sse.emitContactUpdated(contact);
        this.sse.emitConversationUpdated(updatedConv);
        this.sse.emitDashboardUpdate({ refreshNeeded: true });
        return;
      }

      // TEXTO en etapa de pago sin pregunta → animar a enviar foto, nunca confirmar inscripción
      // Si el cliente hace una pregunta (?), dejar que la IA la responda normalmente
      const hasQuestion = /\?|¿/.test(combinedText);
      if (effectiveMessageType !== 'image' && isPaymentStage && !hasQuestion) {
        const replies = [
          'Quedo atento 👀 Mándame la captura del Yape cuando lo hagas 📸',
          'Dale, en cuanto yapees me mandas la foto del comprobante 😊',
          'Perfecto, cuando hagas el Yape me mandas la captura y te confirmo 🙌',
        ];
        await this.sendAndSaveReply(conversation.id, phone, replies[Math.floor(Math.random() * replies.length)]);
        return;
      }



      // ── MÁQUINA DE ESTADOS ────────────────────────────────────────────────
      const history = await this.conversations.getChatHistory(conversation.id, 40);

      // Detección estricta del mensaje del anuncio. Se aceptan las dos variantes:
      //   1. "Hola, quiero probarme en el Simulacro de San Marcos🧑‍⚕️!"
      //   2. "¡Hola! Quiero ponerme a prueba en el Simulacro San Marcos 🎯"
      // Se limpian emojis/emoticonos antes de comparar para que variantes
      // con/sin emoji sean equivalentes.
      const tLower = combinedText
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu, '')
        .toLowerCase();
      const isAdMessage =
        hasReferral || // viene directo de un anuncio de Meta (Instagram/Facebook)
        (tLower.includes('quiero probarme') && /simulacro|san marcos/.test(tLower)) ||
        (tLower.includes('quiero ponerme a prueba') && /simulacro|san marcos/.test(tLower)) ||
        tLower.includes('quiero mas informacion') ||
        tLower.includes('quiero más información');

      // Si es conversación nueva (stage NUEVA) y no viene del anuncio, verificar que
      // el mensaje tenga relación con el simulacro antes de responder.
      // Si habla de otro tema (app, otra cosa), ignorar para no interferir.
      if (stage === ConversationStage.NUEVA && !isAdMessage) {
        const esSimulacro = /simulacro|san marcos|postul|carrera|examen|admis|inscri|horario|precio|costo|virtual|ingres|prepar|cuanto|deco|yape|pagar|fecha|hola|buenas|información|info/i.test(combinedText);
        if (!esSimulacro) {
          this.logger.log(`[FILTRO] Mensaje ignorado de ${phone} (no relacionado al simulacro): "${combinedText.substring(0, 60)}"`);
          return;
        }
      }

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
          if (isAdMessage) {
            // Mensaje del anuncio de Meta: respuesta 100% determinista, sin IA.
            // Siempre es: saludo según hora + "¿A qué carrera postulas?"
            // La IA aquí solo introduce variabilidad innecesaria y fallas.
            await this.sendAndSaveReply(conversation.id, phone, this.getGreeting());
            await new Promise((r) => setTimeout(r, 1200));
            await this.sendAndSaveReply(conversation.id, phone, '¿A qué carrera postulas? 😊');
          } else {
            // Consulta genérica (no viene del anuncio): la IA responde con libertad.
            const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
              name: contact.name, career: contact.career, funnelStage: 'inicio', greeting: this.getGreeting(), isAdMessage,
            });
            if (aiReply && !aiReply.includes('Soy el asesor de Simulacros San Marcos')) {
              const parsed = this.parseMarkers(aiReply);
              if (parsed.textBefore) await this.sendSplitReply(conversation.id, phone, parsed.textBefore);
              const activeSimulacros = await this.simulacros.findActive();
              const flyerDate = parsed.flyerDate || this.detectMentionedDate(aiReply, activeSimulacros);
              if (!parsed.promoFlyer && (parsed.flyer || flyerDate)) {
                await new Promise((r) => setTimeout(r, 1000));
                await this.sendFlyerForDate(phone, flyerDate);
                if (!contact.career) {
                  await this.conversations.setStage(conversation.id, ConversationStage.SALUDADA);
                }
              }
              if (parsed.textAfter) {
                await new Promise((r) => setTimeout(r, 1000));
                await this.sendSplitReply(conversation.id, phone, parsed.textAfter);
              }
            } else {
              await this.sendAndSaveReply(conversation.id, phone, `${this.getGreeting()} 😊`);
              await new Promise((r) => setTimeout(r, 1200));
              await this.sendAndSaveReply(conversation.id, phone, '¿En qué te puedo ayudar? 😊');
            }
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
            effectiveStage === ConversationStage.INSCRITO ? 'inscrito' :
            effectiveStage === ConversationStage.CON_EXPERIENCIA ? 'tiene_experiencia' :
            effectiveStage === ConversationStage.CON_CARRERA ||
            (effectiveStage === ConversationStage.SALUDADA && contact.career) ? 'tiene_carrera' :
            effectiveStage === ConversationStage.SALUDADA ? 'sin_carrera' :
            'libre';

          const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
            name: contact.name, career: contact.career, funnelStage,
          });

          // Marcadores de acción: [FLYER] envía la imagen, [PAGO] activa la espera del comprobante
          const parsed = this.parseMarkers(aiReply);

          // GUARDIA CRÍTICA: si la IA dice que recibió el comprobante sin que haya llegado
          // una imagen real, interceptamos y pedimos la foto. Esto nunca debe llegar al cliente.
          const fakeConfirmation = /recib[íi]\s*(tu\s*)?comprobante|inscripci[oó]n\s*confirmada|equipo lo verificar[áa]/i.test(parsed.textBefore || '');
          if (fakeConfirmation && effectiveMessageType !== 'image') {
            const replies = [
              'Quedo atento 👀 Mándame la captura del Yape cuando lo hagas 📸',
              'Dale, en cuanto yapees me mandas la foto del comprobante 😊',
              'Perfecto, cuando hagas el Yape me mandas la captura y te confirmo 🙌',
            ];
            await this.sendAndSaveReply(conversation.id, phone, replies[Math.floor(Math.random() * replies.length)]);
            break;
          }

          if (parsed.textBefore) await this.sendSplitReply(conversation.id, phone, parsed.textBefore);

          // El flyer normal solo se envía si el cliente AÚN NO llegó a CON_EXPERIENCIA.
          // Una vez que está en CON_EXPERIENCIA o más avanzado, el flyer ya se mandó
          // y no se vuelve a mandar aunque la IA lo pida o mencione una fecha.
          const flyerYaEnviado =
            effectiveStage === ConversationStage.CON_EXPERIENCIA ||
            effectiveStage === ConversationStage.CONFIRMANDO ||
            effectiveStage === ConversationStage.CON_HORARIO ||
            effectiveStage === ConversationStage.ESPERANDO_PAGO ||
            effectiveStage === ConversationStage.INSCRITO;

          const activeSimulacros = await this.simulacros.findActive();
          const flyerDate = parsed.flyerDate || this.detectMentionedDate(aiReply, activeSimulacros);
          // Si la IA emitió [PROMO_FLYER], NO enviamos el flyer normal aunque la IA
          // mencione una fecha en el texto: evita que se mande el flyer del 1er simulacro
          // en vez del flyer de las 3 fechas cuando el bot ofrece la promo.
          const shouldSendFlyer = !parsed.promoFlyer && !flyerYaEnviado && (parsed.flyer || !!flyerDate);

          // Forzar envío del flyer si la IA lo olvidó: solo en etapas donde aún
          // corresponde mandarlo (SALUDADA o CON_CARRERA, nunca CON_EXPERIENCIA+).
          const isFlyerStage =
            effectiveStage === ConversationStage.SALUDADA ||
            effectiveStage === ConversationStage.CON_CARRERA;
          const flyerForzado = !shouldSendFlyer && !parsed.promoFlyer && !flyerYaEnviado && isFlyerStage &&
            /prueba|simulacro|atreves|examen|inscri/i.test(aiReply);

          if (shouldSendFlyer || flyerForzado) {
            await new Promise((r) => setTimeout(r, 1000));
            await this.sendFlyerForDate(phone, flyerDate);
            if (effectiveStage === ConversationStage.SALUDADA || effectiveStage === ConversationStage.CON_CARRERA) {
              await this.conversations.setStage(conversation.id, ConversationStage.CON_EXPERIENCIA);
            }
          }

          // [PROMO_FLYER] → enviar el flyer de la promo (las 3 fechas).
          if (parsed.promoFlyer) {
            await new Promise((r) => setTimeout(r, 1000));
            await this.sendPromoFlyer(phone);
          }

          // Texto que va DESPUÉS del flyer (ej. "¿Te atreves a ponerte a prueba?")
          if (parsed.textAfter) {
            await new Promise((r) => setTimeout(r, 1000));
            await this.sendSplitReply(conversation.id, phone, parsed.textAfter);
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
    } finally {
      this.processingLock.delete(phone);
    }
  }

  // Enviar respuesta con soporte de || para VARIOS mensajes separados
  // (así la IA puede responder como una persona real: frase por frase).
  private async sendSplitReply(conversationId: string, phone: string, text: string): Promise<void> {
    const parts = text.split('||').map((p) => p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        // Pequeña pausa natural entre mensajes (como una persona escribiendo)
        await new Promise((r) => setTimeout(r, 1200));
      }
      await this.sendAndSaveReply(conversationId, phone, parts[i]);
    }
  }

  // Detectar en el texto de la IA la fecha (en español, ej. "10 de agosto") de un
  // simulacro activo, para enviar su flyer aunque la IA no haya emitido el marcador
  // [FLYER:YYYY-MM-DD]. Retorna la fecha ISO (YYYY-MM-DD) o null.
  private detectMentionedDate(text: string, simulacros: any[]): string | null {
    const normalize = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalized = normalize(text);
    // Filtrar simulacros que aún tienen horarios disponibles (no pasados)
    const now = new Date(Date.now() - 5 * 3600 * 1000);
    const todayStr = now.toISOString().split('T')[0];
    const currentHour = now.getUTCHours() + now.getUTCMinutes() / 60;
    const validSims = simulacros.filter((sim) => {
      if (sim.date > todayStr) return true;
      if (sim.date < todayStr) return false;
      // Es hoy: verificar si tiene horarios disponibles
      return (sim.schedules || []).some((h: string) => {
        const startH = parseInt(h.split(' - ')[0]?.split(':')[0] || '0');
        return startH > currentHour + (5 / 60);
      });
    });
    for (const sim of validSims) {
      // Formato español ("10 de agosto") y formato ISO ("2026-08-10", que la IA
      // puede copiar tal cual de SIMULACROS DISPONIBLES).
      const labels = [this.dateInSpanish(sim.date), sim.date].filter(Boolean);
      for (const rawLabel of labels) {
        const label = normalize(rawLabel);
        if (!label) continue;
        const idx = normalized.indexOf(label);
        // Evitar falsos positivos tipo "19 de agosto" matcheando "9 de agosto":
        // el carácter previo no debe ser un dígito.
        if (idx >= 0) {
          const before = normalized[idx - 1];
          if (!before || !/\d/.test(before)) return sim.date;
        }
      }
    }
    return null;
  }

  // Formatear una fecha ISO (YYYY-MM-DD) en español: "10 de agosto"
  private dateInSpanish(iso: string): string {
    const [y, m, d] = (iso || '').split('-');
    if (!y || !m || !d) return '';
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1] || ''}`;
  }

  // Separar los marcadores de acción del texto que ve el cliente.
  // [FLYER] envía el flyer del primer disponible; [FLYER:YYYY-MM-DD] envía
  // el flyer del simulacro con ESA fecha exacta (el que la IA está ofreciendo).
  // [PROMO_FLYER] envía el flyer de la promo (con las 3 fechas).
  private parseMarkers(text: string): { text: string; textBefore: string; textAfter: string; flyer: boolean; pago: boolean; flyerDate?: string; promoFlyer: boolean } {
    const flyer = /\[FLYER(:\d{4}-\d{2}-\d{2})?\]/i.test(text);
    const pago = /\[PAGO\]/i.test(text);
    const promoFlyer = /\[PROMO_FLYER\]/i.test(text);
    const flyerDateMatch = text.match(/\[FLYER:(\d{4}-\d{2}-\d{2})\]/i);
    const clean = text
      .replace(/\[FLYER(:\d{4}-\d{2}-\d{2})?\]/gi, '')
      .replace(/\[PAGO\]/gi, '')
      .replace(/\[PROMO_FLYER\]/gi, '')
      .trim();
    return { text: clean, textBefore: clean, textAfter: '', flyer, pago, flyerDate: flyerDateMatch?.[1], promoFlyer };
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

  // Enviar el flyer de la promo (con las 3 fechas), configurado en ajustes
  private async sendPromoFlyer(phone: string): Promise<void> {
    const rawPath = await this.settings.get('promo_flyer_url');
    if (!rawPath?.trim()) {
      this.logger.warn('[PROMO_FLYER] solicitado pero no hay flyer de promo configurado en ajustes');
      return;
    }
    const publicUrl = this.config.get('BACKEND_PUBLIC_URL', '').replace(/\/$/, '');
    const base = publicUrl || `http://localhost:${this.config.get('PORT', '3001')}`;
    const flyerUrl = rawPath.startsWith('http') ? rawPath : `${base}${rawPath}`;
    try {
      await this.ycloud.sendImageMessage(phone, flyerUrl);
      this.logger.log(`Flyer de promo enviado a ${phone}`);
    } catch (e) {
      this.logger.warn('Flyer de promo no enviado: ' + e.message);
    }
  }

  // Enviar flyer de un simulacro específico (o del primero disponible)
  private async sendFlyerForDate(phone: string, flyerDate?: string): Promise<void> {
    const activeSimulacros = await this.simulacros.findActive();
    const simFlyer = flyerDate
      ? activeSimulacros.find((s) => s.date === flyerDate)?.flyerUrl
      : activeSimulacros.find((s) => (s as any).flyerUrl)?.flyerUrl;
    const globalFlyer = await this.settings.get('flyer_url');
    const rawPath = simFlyer || globalFlyer;
    if (rawPath?.trim()) {
      const publicUrl = this.config.get('BACKEND_PUBLIC_URL', '').replace(/\/$/, '');
      const base = publicUrl || `http://localhost:${this.config.get('PORT', '3001')}`;
      const flyerUrl = rawPath.startsWith('http') ? rawPath : `${base}${rawPath}`;
      try {
        await this.ycloud.sendImageMessage(phone, flyerUrl);
        this.logger.log(`Flyer enviado a ${phone}`);
      } catch (e) {
        this.logger.warn('Flyer no enviado: ' + e.message);
      }
    } else {
      this.logger.warn(`[FLYER] solicitado${flyerDate ? ` (fecha ${flyerDate})` : ''} pero no hay flyer configurado: sube el flyer del simulacro o define flyer_url en ajustes`);
    }
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
