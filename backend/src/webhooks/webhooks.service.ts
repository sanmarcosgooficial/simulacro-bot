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
      const timer = setTimeout(resolve, 7000);
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

      // 5. Guardar el mensaje del usuario
      const userMsg = await this.conversations.addMessage(
        conversation.id,
        MessageRole.USER,
        textContent || `[${messageType}]`,
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

      // ── COMPROBANTE DE PAGO (cualquier etapa) ─────────────────────────────
      if (messageType === 'image' && stage === ConversationStage.ESPERANDO_PAGO) {
        await this.sendAndSaveReply(conversation.id, phone,
          '¡Gracias! 📸 Recibí tu comprobante. El equipo lo verificará en breve y te confirmamos tu inscripción 🙏');
        await this.conversations.setStage(conversation.id, ConversationStage.INSCRITO);
        await this.contacts.update(contact.id, { status: ContactStatus.INSCRITO });
        this.sse.emitContactUpdated(contact);
        this.sse.emitDashboardUpdate({ refreshNeeded: true });
        return;
      }

      // ── MÁQUINA DE ESTADOS ────────────────────────────────────────────────
      const history = await this.conversations.getChatHistory(conversation.id, 10);

      // Detección estricta del mensaje del anuncio:
      // "Hola, quiero probarme en el Simulacro de San Marcos ⚕️!" — el mensaje
      // DEBE contener "quiero probarme" + "simulacro"/"san marcos".
      const tLower = combinedText.toLowerCase();
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

        // ETAPA 0: cliente nuevo → SOLO responde si viene del anuncio de Meta
        // (mensaje del tipo "Hola, quiero probarme en el Simulacro de San Marcos ⚕️!")
        case ConversationStage.NUEVA: {
          if (!isAdMessage) {
            // Mensaje que no viene del anuncio → ignorar silenciosamente
            this.logger.log(`[SKIP] Contacto nuevo sin mensaje de anuncio: "${combinedText.substring(0, 50)}"`);
            return;
          }
          // Primer mensaje DEFAULT (hardcodeado, NO lo genera la IA)
          await this.sendAndSaveReply(conversation.id, phone, '¡Hola! 👋 Soy el asesor de Simulacros San Marcos. ¿Qué carrera estás postulando?');
          await this.conversations.setStage(conversation.id, ConversationStage.SALUDADA);
          await this.contacts.update(contact.id, { status: ContactStatus.INTERESADO });
          break;
        }

        // ETAPA 1: bot ya saludó → detectar carrera en lo que dice el cliente
        case ConversationStage.SALUDADA: {
          const careerMatch = this.detectCareer(combinedText);
          if (careerMatch) {
            // Carrera detectada → respuesta hardcodeada + preguntar experiencia
            await this.contacts.update(contact.id, {
              career: careerMatch.career, area: careerMatch.area,
              status: ContactStatus.INTERESADO,
            });
            await this.sendAndSaveReply(conversation.id, phone, careerMatch.comment);
            await new Promise((r) => setTimeout(r, 1200));
            await this.sendAndSaveReply(conversation.id, phone, '¿Primera vez que postulas o ya tienes experiencia?');
            await this.conversations.setStage(conversation.id, ConversationStage.CON_CARRERA);
          } else {
            // No se detectó la carrera → responder brevemente si preguntó algo y volver a pedir carrera.
            // IMPORTANTE: aquí la IA NO vuelve a saludar (el saludo ya se dio al iniciar la conversación),
            // para que el mensaje nunca se repita. El bot siempre termina pidiendo la carrera una sola vez.
            const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
              name: contact.name, funnelStage: 'sin_carrera',
              greeting: this.getGreeting(),
            });
            // Solo tomar la primera parte si hay || y quitar cualquier saludo repetido
            let firstPart = (aiReply.split('||')[0] || '').trim();
            firstPart = firstPart.replace(/^(buenos días|buenas tardes|buenas noches|hola)[,!.:\s]*/i, '').trim() || firstPart;
            await this.sendAndSaveReply(conversation.id, phone, firstPart);
            // Si la IA no preguntó por la carrera, la pregunta el bot (una sola vez)
            if (!/carrera|estudi|postul/i.test(firstPart)) {
              await new Promise((r) => setTimeout(r, 1000));
              await this.sendAndSaveReply(conversation.id, phone, '¿A qué carrera postulas? 😊');
            }
          }
          break;
        }

        // ETAPA 2: sabe la carrera → detectar si es primera vez o tiene experiencia
        case ConversationStage.CON_CARRERA: {
          const isFirstTime = await this.ai.detectFirstTime(combinedText);
          if (isFirstTime !== null) {
            const msg2 = isFirstTime
              ? 'Este simulacro te va ayudar a que te familiarices con el nivel y el tiempo de San Marcos, también puedas ver en que nivel te encuentras actualmente y saber los que te falta por mejorar'
              : 'Este simulacro te va ayudar bastante ya que podrás ver en que nivel te encuentras actualmente y saber los que te falta por mejorar para llegar listo al examen';
            await this.sendAndSaveReply(conversation.id, phone, 'Excelente, vamos con todo 💪');
            await new Promise((r) => setTimeout(r, 1200));
            await this.sendAndSaveReply(conversation.id, phone, msg2);
            // Enviar flyer: usar el del simulacro activo, con fallback al global
            await new Promise((r) => setTimeout(r, 1000));
            try {
              const activeSimulacros = await this.simulacros.findActive();
              const simFlyer = activeSimulacros.find((s) => (s as any).flyerUrl)?.flyerUrl;
              const globalFlyer = await this.settings.get('flyer_url');
              const rawPath = simFlyer || globalFlyer;
              if (rawPath?.trim()) {
                // Construir URL absoluta para YCloud (necesita URL pública)
                const publicUrl = this.config.get('BACKEND_PUBLIC_URL', '').replace(/\/$/, '');
                const base = publicUrl || `http://localhost:${this.config.get('PORT', '3001')}`;
                const flyerUrl = rawPath.startsWith('http') ? rawPath : `${base}${rawPath}`;
                await this.ycloud.sendImageMessage(phone, flyerUrl);
              }
            } catch (e) { this.logger.warn('Flyer no enviado: ' + e.message); }
            // Preguntar si quiere ponerse a prueba
            await new Promise((r) => setTimeout(r, 1500));
            await this.sendAndSaveReply(conversation.id, phone, 'Te atreves a ponerte a prueba?');
            await this.conversations.setStage(conversation.id, ConversationStage.CON_EXPERIENCIA);
          } else {
            // No se entendió si es primera vez o tiene experiencia → volver a preguntar
            await this.sendAndSaveReply(conversation.id, phone, '¿Es tu primera vez postulando a San Marcos o ya has dado el examen antes?');
            // Nos quedamos en CON_CARRERA esperando respuesta clara
          }
          break;
        }

        // ETAPA 3: preguntó "¿Te atreves a ponerte a prueba?" → si dice sí, preguntar horario
        case ConversationStage.CON_EXPERIENCIA: {
          const wantsToTry = await this.ai.detectYesOrNo(combinedText);

          if (wantsToTry === true) {
            // Si además preguntó algo extra (ej: "Si, es virtual?"), GPT lo responde primero
            const hasExtraQuestion = combinedText.trim().split(/\s+/).length > 3;
            if (hasExtraQuestion) {
              const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
                name: contact.name, career: contact.career, funnelStage: 'tiene_experiencia',
              });
              // Solo enviar la respuesta de GPT, sin mencionar precio ni horario
              const parts = aiReply.split('||').map((p) => p.trim()).filter(Boolean);
              await this.sendAndSaveReply(conversation.id, phone, parts[0]);
              if (parts[1]) {
                await new Promise((r) => setTimeout(r, 1000));
                await this.sendAndSaveReply(conversation.id, phone, parts[1]);
              }
              await new Promise((r) => setTimeout(r, 1200));
            }

            // Siempre preguntar el horario después
            const activeSimulacros = await this.simulacros.findActive();
            const { text: scheduleText } = this.buildScheduleText(activeSimulacros);
            if (!scheduleText) {
              await this.sendAndSaveReply(conversation.id, phone, 'Por el momento no tenemos horarios disponibles, te avisamos pronto 🙏');
              break;
            }
            const scheduleQ = `¿En qué horario te acomoda mejor, ${scheduleText}?`;
            await this.sendAndSaveReply(conversation.id, phone, scheduleQ);
            await this.conversations.setStage(conversation.id, ConversationStage.CONFIRMANDO);

          } else if (wantsToTry === false) {
            // Dijo no → GPT responde con empatía
            const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
              name: contact.name, career: contact.career, funnelStage: 'tiene_experiencia',
            });
            await this.sendSplitReply(conversation.id, phone, aiReply);
          } else {
            // No dijo sí ni no (preguntó cómo inscribirse, precio, horario, etc.)
            // → Perfecto, te ayudo. Primero comprometer con horario antes de mencionar precio
            const activeSimulacros = await this.simulacros.findActive();
            const { text: scheduleText2 } = this.buildScheduleText(activeSimulacros);
            await this.sendAndSaveReply(conversation.id, phone, 'Perfecto, te ayudo 😊');
            await new Promise((r) => setTimeout(r, 1000));
            if (!scheduleText2) {
              await this.sendAndSaveReply(conversation.id, phone, 'Por el momento no tenemos horarios disponibles, te avisamos pronto 🙏');
              break;
            }
            await this.sendAndSaveReply(conversation.id, phone, `¿En qué horario te acomoda mejor, ${scheduleText2}?`);
            await this.conversations.setStage(conversation.id, ConversationStage.CONFIRMANDO);
          }
          break;
        }

        // ETAPA 4: respondió el horario → confirmar, pedir pago e informar del link
        case ConversationStage.CONFIRMANDO: {
          const s = await this.settings.getAll();
          const yapeNumber = (s.yape_number || '').replace('+51', '').trim();
          const yapeName = s.yape_name || '';
          const activeSimulacros = await this.simulacros.findActive();

          // Detectar si pregunta por mañana → responder con los horarios de mañana
          const asksTomorrow = /ma[ñn]ana|el otro d[ií]a|pa['']?l otro/i.test(combinedText);
          if (asksTomorrow) {
            const nextSim = activeSimulacros.find(s => s.date !== activeSimulacros[0]?.date);
            if (nextSim) {
              const options = (nextSim.schedules || []).map((h: string) => this.formatScheduleNatural(h)).join(' o ');
              await this.sendAndSaveReply(conversation.id, phone, `Mañana tenemos ${options} ¿Cuál te acomoda?`);
            } else {
              await this.sendAndSaveReply(conversation.id, phone, 'Por el momento solo tenemos el de hoy, ¿te animas? 😊');
            }
            break;
          }

          // Detectar rechazo explícito ("no puedo", "no me queda", etc.)
          const rejectsSchedule = /no puedo|no me queda|otro d[ií]a|no tengo|imposible|no llego|ese no|ese horario no/i.test(combinedText);

          if (rejectsSchedule) {
            // Buscar el siguiente simulacro disponible (saltando el primero)
            const { text: nextSchedule } = this.buildScheduleText(activeSimulacros.slice(1));
            if (nextSchedule) {
              await this.sendAndSaveReply(conversation.id, phone, `No hay problema, también tenemos ${nextSchedule} ¿Te acomoda?`);
            } else {
              await this.sendAndSaveReply(conversation.id, phone, 'Entiendo, por el momento esos son los horarios disponibles. Cuando puedas avísame y te ayudo 😊');
              await this.conversations.setStage(conversation.id, ConversationStage.CON_EXPERIENCIA);
            }
            break;
          }

          // Detectar el horario que eligió el cliente buscando en todos los simulacros
          let chosenSchedule = '';
          for (const sim of activeSimulacros) {
            for (const h of (sim.schedules || [])) {
              const natural = this.formatScheduleNatural(h);
              const startHour = h.split(' - ')[0]?.split(':')[0];
              const fmt12Start = String(parseInt(startHour) > 12 ? parseInt(startHour) - 12 : parseInt(startHour));
              if (
                combinedText.includes(startHour) ||
                combinedText.includes(fmt12Start) ||
                combinedText.toLowerCase().includes(natural.toLowerCase())
              ) {
                chosenSchedule = natural;
                break;
              }
            }
            if (chosenSchedule) break;
          }
          if (!chosenSchedule && activeSimulacros[0]?.schedules?.length) {
            chosenSchedule = this.formatScheduleNatural(activeSimulacros[0].schedules[0]);
          }

          await this.sendAndSaveReply(conversation.id, phone, 'Ok, ya lo registro');
          await new Promise((r) => setTimeout(r, 1000));
          await this.sendAndSaveReply(conversation.id, phone,
            `Me confirma con el yape al ${yapeNumber} a nombre de ${yapeName} 😊`);
          await new Promise((r) => setTimeout(r, 1200));
          // Extraer la hora de inicio del horario elegido por el cliente
          // Busca en formato 24h ("17") y en formato 12h ("5") para cubrir ambos casos
          let startHourOnly = '';
          if (activeSimulacros.length > 0 && activeSimulacros[0].schedules?.length) {
            const fmt12 = (h: number) => h > 12 ? h - 12 : h;
            for (const h of activeSimulacros[0].schedules) {
              const start24 = parseInt(h.split(' - ')[0]?.split(':')[0]);
              const start12 = fmt12(start24);
              if (
                combinedText.includes(String(start24)) ||
                combinedText.includes(String(start12))
              ) {
                startHourOnly = String(start12);
                break;
              }
            }
            if (!startHourOnly) {
              const start24 = parseInt(activeSimulacros[0].schedules[0].split(' - ')[0]?.split(':')[0]);
              startHourOnly = String(fmt12(start24));
            }
          }
          await this.sendAndSaveReply(conversation.id, phone,
            `Se le compartirá el link minutos antes de las ${startHourOnly}`);
          await this.conversations.setStage(conversation.id, ConversationStage.ESPERANDO_PAGO);
          await this.contacts.update(contact.id, { status: ContactStatus.ESPERANDO_PAGO });
          break;
        }

        // ETAPA 4: precio mostrado → empujar a Yape
        case ConversationStage.CON_HORARIO: {
          const aiReply = await this.ai.processMessage(combinedText, history as any, phone, {
            name: contact.name, career: contact.career, funnelStage: 'precio_mencionado',
          });
          await this.sendSplitReply(conversation.id, phone, aiReply);
          if (this.detectsPaymentIntent(combinedText)) {
            await this.conversations.setStage(conversation.id, ConversationStage.ESPERANDO_PAGO);
            await this.contacts.update(contact.id, { status: ContactStatus.ESPERANDO_PAGO });
          }
          break;
        }

        // ETAPA 5: esperando comprobante
        case ConversationStage.ESPERANDO_PAGO: {
          await this.sendAndSaveReply(conversation.id, phone, 'Ok, quedo atento para registrarlo');
          break;
        }

        // ETAPA 6: inscrito
        case ConversationStage.INSCRITO: {
          await this.sendAndSaveReply(conversation.id, phone,
            '¡Ya estás inscrito! 🎉 Pronto te enviamos los detalles. Cualquier duda, aquí estoy 😊');
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

  // Encuentra el primer simulacro con horarios disponibles y devuelve su texto.
  // Si hoy solo queda 1 horario, añade mañana como alternativa.
  private buildScheduleText(simulacros: any[]): { text: string; simDate: string } {
    // Fecha y hora actuales SIEMPRE en hora de Perú (UTC-5, sin horario de verano)
    const now = new Date(Date.now() - 5 * 3600 * 1000);
    const todayStr = now.toISOString().split('T')[0];
    const tomorrowStr = (() => { const d = new Date(now); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
    const currentHour = now.getUTCHours() + now.getUTCMinutes() / 60;

    const getAvailable = (sim: any) => {
      const isToday = sim.date === todayStr;
      return (sim.schedules || []).filter((h: string) => {
        if (!isToday) return true;
        const startHour = parseInt(h.split(' - ')[0]?.split(':')[0] || '0');
        return startHour > currentHour + (5 / 60);
      });
    };

    const dayLabel = (date: string) =>
      date === todayStr ? 'hoy' : date === tomorrowStr ? 'mañana' : `el ${date}`;

    // Primer simulacro con horarios disponibles
    const first = simulacros.find(s => getAvailable(s).length > 0);
    if (!first) return { text: '', simDate: '' };

    const firstAvailable = getAvailable(first);
    const firstOptions = firstAvailable.map((h: string) => this.formatScheduleNatural(h)).join(' o ');
    let text = `${dayLabel(first.date)} ${firstOptions}`;

    // Si hoy solo queda 1 horario, mencionar mañana sin dar detalles (genera curiosidad)
    if (first.date === todayStr && firstAvailable.length === 1) {
      const next = simulacros.find(s => s.date !== todayStr && getAvailable(s).length > 0);
      if (next) text += ` o mañana`;
    }

    return { text, simDate: first.date };
  }

  // Convierte "10:00 - 13:00" → "de 10 a 1" (formato natural)
  private formatScheduleNatural(schedule: string): string {
    // Extraer las dos horas del formato "HH:MM - HH:MM" o "H - H"
    const match = schedule.match(/(\d{1,2})(?::\d{2})?\s*[-–a]\s*(\d{1,2})(?::\d{2})?/);
    if (!match) return `de ${schedule}`;
    let start = parseInt(match[1]);
    let end = parseInt(match[2]);
    // Convertir a formato 12h sin ceros
    const fmt = (h: number) => h > 12 ? h - 12 : h;
    return `de ${fmt(start)} a ${fmt(end)}`;
  }

  // Detectar carrera en el texto del cliente
  private detectCareer(text: string): { career: string; area: string; comment: string } | null {
    const careerMap: Record<string, { area: string; comment: string }> = {
      // Área A: Ciencias de la Salud
      'medicina': { area: 'Área A: Ciencias de la Salud', comment: 'Uff de las mejores carreras y competitivas' },
      'medicina humana': { area: 'Área A: Ciencias de la Salud', comment: 'Uff de las mejores carreras y competitivas' },
      'enfermería': { area: 'Área A: Ciencias de la Salud', comment: 'Una carrera muy noble y esencial' },
      'enfermeria': { area: 'Área A: Ciencias de la Salud', comment: 'Una carrera muy noble y esencial' },
      'obstetricia': { area: 'Área A: Ciencias de la Salud', comment: 'Muy buena carrera y con alta demanda' },
      'obsetricia': { area: 'Área A: Ciencias de la Salud', comment: 'Muy buena carrera y con alta demanda' },
      'obtetrica': { area: 'Área A: Ciencias de la Salud', comment: 'Muy buena carrera y con alta demanda' },
      'obstetrica': { area: 'Área A: Ciencias de la Salud', comment: 'Muy buena carrera y con alta demanda' },
      'farmacia': { area: 'Área A: Ciencias de la Salud', comment: 'Gran elección, tiene mucho futuro' },
      'farmacia y bioquímica': { area: 'Área A: Ciencias de la Salud', comment: 'Gran elección, tiene mucho futuro' },
      'farmacia y bioquimica': { area: 'Área A: Ciencias de la Salud', comment: 'Gran elección, tiene mucho futuro' },
      'odontología': { area: 'Área A: Ciencias de la Salud', comment: 'Excelente carrera, muy demandada' },
      'odontologia': { area: 'Área A: Ciencias de la Salud', comment: 'Excelente carrera, muy demandada' },
      'medicina veterinaria': { area: 'Área A: Ciencias de la Salud', comment: 'Gran carrera, mucho campo laboral' },
      'veterinaria': { area: 'Área A: Ciencias de la Salud', comment: 'Gran carrera, mucho campo laboral' },
      'nutrición': { area: 'Área A: Ciencias de la Salud', comment: 'Carrera con mucho crecimiento hoy en día' },
      'nutricion': { area: 'Área A: Ciencias de la Salud', comment: 'Carrera con mucho crecimiento hoy en día' },
      'tecnología médica': { area: 'Área A: Ciencias de la Salud', comment: 'Gran elección, muy valorada en salud' },
      'tecnologia medica': { area: 'Área A: Ciencias de la Salud', comment: 'Gran elección, muy valorada en salud' },
      // Área B: Ciencias Básicas
      'matemática': { area: 'Área B: Ciencias Básicas', comment: 'La base de todo, gran elección' },
      'matematica': { area: 'Área B: Ciencias Básicas', comment: 'La base de todo, gran elección' },
      'física': { area: 'Área B: Ciencias Básicas', comment: 'Una de las ciencias más desafiantes' },
      'fisica': { area: 'Área B: Ciencias Básicas', comment: 'Una de las ciencias más desafiantes' },
      'química': { area: 'Área B: Ciencias Básicas', comment: 'Gran base científica e industrial' },
      'quimica': { area: 'Área B: Ciencias Básicas', comment: 'Gran base científica e industrial' },
      'investigación operativa': { area: 'Área B: Ciencias Básicas', comment: 'Carrera muy técnica y con mucho futuro' },
      'investigacion operativa': { area: 'Área B: Ciencias Básicas', comment: 'Carrera muy técnica y con mucho futuro' },
      'genética': { area: 'Área B: Ciencias Básicas', comment: 'Una de las ciencias del futuro' },
      'genetica': { area: 'Área B: Ciencias Básicas', comment: 'Una de las ciencias del futuro' },
      'biología': { area: 'Área B: Ciencias Básicas', comment: 'Excelente base científica' },
      'biologia': { area: 'Área B: Ciencias Básicas', comment: 'Excelente base científica' },
      'estadística': { area: 'Área B: Ciencias Básicas', comment: 'Muy demandada en empresas y tecnología' },
      'estadistica': { area: 'Área B: Ciencias Básicas', comment: 'Muy demandada en empresas y tecnología' },
      'computación científica': { area: 'Área B: Ciencias Básicas', comment: 'Excelente carrera con mucho futuro digital' },
      'computacion cientifica': { area: 'Área B: Ciencias Básicas', comment: 'Excelente carrera con mucho futuro digital' },
      'computación': { area: 'Área B: Ciencias Básicas', comment: 'Excelente carrera con mucho futuro digital' },
      'computacion': { area: 'Área B: Ciencias Básicas', comment: 'Excelente carrera con mucho futuro digital' },
      // Área C: Ingeniería
      'ingeniería de sistemas': { area: 'Área C: Ingeniería', comment: 'Uff de las carreras con más futuro ahora' },
      'ingenieria de sistemas': { area: 'Área C: Ingeniería', comment: 'Uff de las carreras con más futuro ahora' },
      'sistemas': { area: 'Área C: Ingeniería', comment: 'Uff de las carreras con más futuro ahora' },
      'ingeniería civil': { area: 'Área C: Ingeniería', comment: 'Una de las ingenierías más sólidas' },
      'ingenieria civil': { area: 'Área C: Ingeniería', comment: 'Una de las ingenierías más sólidas' },
      'ingeniería industrial': { area: 'Área C: Ingeniería', comment: 'Excelente, muy demandada en empresas' },
      'ingenieria industrial': { area: 'Área C: Ingeniería', comment: 'Excelente, muy demandada en empresas' },
      'industrial': { area: 'Área C: Ingeniería', comment: 'Excelente, muy demandada en empresas' },
      'ingeniería electrónica': { area: 'Área C: Ingeniería', comment: 'Muy buena carrera, mucha tecnología' },
      'ingenieria electronica': { area: 'Área C: Ingeniería', comment: 'Muy buena carrera, mucha tecnología' },
      'electrónica': { area: 'Área C: Ingeniería', comment: 'Muy buena carrera, mucha tecnología' },
      'electronica': { area: 'Área C: Ingeniería', comment: 'Muy buena carrera, mucha tecnología' },
      'ingeniería mecánica': { area: 'Área C: Ingeniería', comment: 'Gran carrera con mucho campo laboral' },
      'ingenieria mecanica': { area: 'Área C: Ingeniería', comment: 'Gran carrera con mucho campo laboral' },
      'mecánica': { area: 'Área C: Ingeniería', comment: 'Gran carrera con mucho campo laboral' },
      'mecanica': { area: 'Área C: Ingeniería', comment: 'Gran carrera con mucho campo laboral' },
      'ingeniería agroindustrial': { area: 'Área C: Ingeniería', comment: 'Carrera con mucho futuro en agronegocios' },
      'ingenieria agroindustrial': { area: 'Área C: Ingeniería', comment: 'Carrera con mucho futuro en agronegocios' },
      'agroindustrial': { area: 'Área C: Ingeniería', comment: 'Carrera con mucho futuro en agronegocios' },
      'ingeniería ambiental': { area: 'Área C: Ingeniería', comment: 'Carrera con mucho futuro, el mundo la necesita' },
      'ingenieria ambiental': { area: 'Área C: Ingeniería', comment: 'Carrera con mucho futuro, el mundo la necesita' },
      'ambiental': { area: 'Área C: Ingeniería', comment: 'Carrera con mucho futuro, el mundo la necesita' },
      // Área D: Ciencias Económicas y de la Gestión
      'administración': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Excelente para el mundo empresarial' },
      'administracion': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Excelente para el mundo empresarial' },
      'contabilidad': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Siempre en demanda, muy estable' },
      'economía': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Carrera muy versátil y bien valorada' },
      'economia': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Carrera muy versátil y bien valorada' },
      'negocios internacionales': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Gran carrera para el mundo globalizado' },
      'gestión tributaria': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Muy demandada en el sector empresarial y público' },
      'gestion tributaria': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Muy demandada en el sector empresarial y público' },
      'tributaria': { area: 'Área D: Ciencias Económicas y de la Gestión', comment: 'Muy demandada en el sector empresarial y público' },
      // Área E: Humanidades y Ciencias Jurídicas y Sociales
      'derecho': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Una de las carreras más prestigiosas' },
      'literatura': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Gran carrera para la investigación y docencia' },
      'educación': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Una carrera muy importante para el país' },
      'educacion': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Una carrera muy importante para el país' },
      'comunicación social': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Carrera muy creativa y con muchas salidas' },
      'comunicacion social': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Carrera muy creativa y con muchas salidas' },
      'comunicación': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Carrera muy creativa y con muchas salidas' },
      'comunicacion': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Carrera muy creativa y con muchas salidas' },
      'psicología': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Una de las carreras más elegidas ahora' },
      'psicologia': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Una de las carreras más elegidas ahora' },
      'filosofía': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Gran carrera para el pensamiento crítico' },
      'filosofia': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Gran carrera para el pensamiento crítico' },
      'sociología': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Carrera con mucho campo de investigación' },
      'sociologia': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Carrera con mucho campo de investigación' },
      'historia': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Excelente para la investigación y docencia' },
      'arqueología': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Perú es el mejor lugar para esta carrera' },
      'arqueologia': { area: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', comment: 'Perú es el mejor lugar para esta carrera' },
    };
    const normalized = text.toLowerCase().trim();
    for (const [key, value] of Object.entries(careerMap)) {
      if (normalized.includes(key)) {
        return { career: key.charAt(0).toUpperCase() + key.slice(1), ...value };
      }
    }
    return null;
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

  // Detectar si el mensaje expresa intención de inscribirse/pagar
  private detectsPaymentIntent(text: string): boolean {
    const keywords = ['inscrib', 'apunt', 'pag', 'yape', 'yapeo', 'transferi', 'quiero entrar'];
    return keywords.some((k) => text.toLowerCase().includes(k));
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
