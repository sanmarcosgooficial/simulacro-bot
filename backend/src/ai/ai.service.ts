import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { SimulacrosService } from '../simulacros/simulacros.service';
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private client: OpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly simulacrosService: SimulacrosService,
  ) {}

  onModuleInit() {
    this.client = new OpenAI({
      apiKey: this.config.get('OPENAI_API_KEY', ''),
    });
  }

  // Construir el system prompt del agente
  private async buildSystemPrompt(contactContext?: {
    name?: string;
    career?: string;
    area?: string;
    status?: string;
    funnelStage?: string;
    greeting?: string;
    isAdMessage?: boolean;
  }): Promise<string> {
    const s = await this.settings.getAll();
    const activeSimulacros = await this.simulacrosService.findActive();

    let simulacrosText = '';
    if (activeSimulacros.length === 0) {
      simulacrosText = 'No hay simulacros programados por ahora.';
    } else {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const tomorrowStr = (() => { const d = new Date(now); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      const fmt12 = (h: number) => h > 12 ? h - 12 : h;

      simulacrosText = activeSimulacros
        .map((sim) => {
          const isToday = sim.date === todayStr;
          const isTomorrow = sim.date === tomorrowStr;
          const dayLabel = isToday ? 'hoy' : isTomorrow ? 'mañana' : `el ${sim.date}`;

          const availableSchedules = (sim.schedules || []).filter((h: string) => {
            if (!isToday) return true;
            const startH = parseInt(h.split(' - ')[0]?.split(':')[0] || '0');
            return startH > currentHour + (5 / 60);
          });

          if (availableSchedules.length === 0 && isToday) return null;

          const horarios = availableSchedules.length
            ? availableSchedules.map((h: string) => {
                const start = parseInt(h.split(' - ')[0]?.split(':')[0]);
                const end = parseInt(h.split(' - ')[1]?.split(':')[0]);
                return `de ${fmt12(start)} a ${fmt12(end)}`;
              }).join(' o ')
            : (sim.schedules || [sim.time]).join(' o ');

          return `- San Marcos Las Fijas (${dayLabel}), horarios: ${horarios}${sim.area ? ` (${sim.area})` : ''} - 100% virtual`;
        })
        .filter(Boolean)
        .join('\n');

      if (!simulacrosText) simulacrosText = 'No hay horarios disponibles por ahora.';
    }

    // Contexto del cliente actual
    let clientContext = '';
    if (contactContext?.name || contactContext?.career) {
      clientContext = `\nCLIENTE ACTUAL:`;
      if (contactContext.name) clientContext += `\n- Nombre: ${contactContext.name}`;
      if (contactContext.career) clientContext += `\n- Carrera: ${contactContext.career}`;
      if (contactContext.area) clientContext += `\n- Área: ${contactContext.area}`;
    }

    // Instrucción según etapa del funnel
    let funnelInstruction = '';
    const stage = contactContext?.funnelStage || 'inicio';
    if (stage === 'inicio') {
      const greet = contactContext?.greeting || 'Hola';
      funnelInstruction = `ETAPA ACTUAL: El cliente acaba de escribir por primera vez. Debes responder con el saludo "${greet}" en un mensaje, y en otro mensaje separado con || pregúntale qué carrera postula. Siempre usa el formato: "${greet}||A qué carrera postulas 😊?". Si el cliente preguntó algo específico además del saludo, respóndelo brevemente en el primer mensaje antes del ||.`;
    } else if (stage === 'tiene_carrera') {
      funnelInstruction = `ETAPA ACTUAL: Ya sabemos que postula a ${contactContext?.career}. Si pregunta algo sobre el simulacro, respóndele y luego pregúntale si es su primera vez postulando o ya tiene experiencia.`;
    } else if (stage === 'tiene_experiencia') {
      funnelInstruction = `ETAPA ACTUAL: Ya conocemos su experiencia. Ya vio el flyer y le preguntamos el horario. Si responde el horario o pregunta algo, respóndele y luego menciona el precio (S/ ${s.price || '50'}) y anímalo a inscribirse.`;
    } else if (stage === 'precio_mencionado') {
      funnelInstruction = `ETAPA ACTUAL: El cliente ya conoce el precio. Si tiene dudas, resuélvelas. Si quiere inscribirse, dale los datos de Yape: ${s.yape_number || ''} a nombre de ${s.yape_name || ''}.`;
    } else if (stage === 'esperando_pago') {
      funnelInstruction = `ETAPA ACTUAL: El cliente está a punto de pagar. Sé breve y directo, transmite urgencia amigable para cerrar la venta ahora. No le des opción de dejarlo para después. Algo como "Perfecto, quedo atento a tu comprobante 👀" o "Dale, te espero con el yape 🙌". Nunca uses frases pasivas como "cuando puedas" o "no olvides". Máximo 1 mensaje corto.`;
    }

    return `Eres un asesor comercial humano de ${s.business_name || 'Simulacros San Marcos'}, simulacros de examen para postulantes a San Marcos (UNMSM).

TONO: ${s.agent_tone || 'amigable'}, muy breve, cálido, coloquial peruano. NUNCA suenes a robot ni a plantilla.

INFORMACIÓN DEL NEGOCIO:
- Precio: S/ ${s.price || '50'} por simulacro
- Modalidad: 100% virtual (desde casa, celular o PC)
- Pago: Yape al ${s.yape_number || '+51999999999'} a nombre de ${s.yape_name || 'el titular'}

SIMULACROS DISPONIBLES:
${simulacrosText}
${clientContext}

${funnelInstruction}

FORMATO DE RESPUESTA — MUY IMPORTANTE:
- Cuando quieras enviar DOS mensajes separados (como haría una persona real en WhatsApp), usa el separador || entre ellos
- Ejemplo: "Buenas tardes 😊||¿A qué carrera postulas?"
- Cuando sea un solo mensaje, escríbelo normal sin ||
- Máximo 2 mensajes por respuesta (un solo ||)
- Cada mensaje: máximo 2-3 líneas

REGLAS:
- Si el cliente pregunta algo fuera del flujo (precio, horario, virtual, etc.), respóndelo y retoma el flujo
- NUNCA menciones el nombre del área ni el área académica
- NUNCA preguntes la carrera (el flujo la captura solo)
- NUNCA inventes precios, fechas ni descuentos
- Si mencionas el simulacro, llámalo "San Marcos Las Fijas"
- NUNCA menciones horarios en formato técnico como "10:00 a 13:00", usa solo "de 10 a 1" o "de 5 a 8"
- Si no sabes algo, di "ya lo consulto y te aviso"`;
  }

  // Procesar mensaje y generar respuesta
  async processMessage(
    userMessage: string,
    conversationHistory: ChatMessage[],
    phone?: string,
    contactContext?: {
      name?: string;
      career?: string;
      area?: string;
      status?: string;
      funnelStage?: string;
      greeting?: string;
      isAdMessage?: boolean;
    },
  ): Promise<string> {
    const apiKey = this.config.get('OPENAI_API_KEY', '');
    const model =
      (await this.settings.get('openai_model')) ||
      this.config.get('OPENAI_MODEL', 'gpt-4o-mini');

    // Sin API key → respuestas de respaldo
    if (!apiKey || apiKey.includes('sk-pon-aqui')) {
      return this.getFallbackResponse(userMessage);
    }

    try {
      const systemPrompt = await this.buildSystemPrompt(contactContext);

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...conversationHistory.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: userMessage },
      ];

      const completion = await this.client.chat.completions.create({
        model,
        messages,
        max_tokens: 300,
        temperature: 0.6,
      });

      const reply = completion.choices[0]?.message?.content?.trim() || '';

      if (!reply) return this.getFallbackResponse(userMessage);

      this.logger.log(`GPT [${model}] → ${reply.substring(0, 80)}`);
      return reply;

    } catch (error: any) {
      this.logger.error('Error OpenAI:', error?.message || error);

      // Si el error es de API key inválida, indicarlo claramente en el log
      if (error?.status === 401) {
        this.logger.error('API key de OpenAI inválida. Revisa OPENAI_API_KEY en el .env');
      }

      return this.getFallbackResponse(userMessage);
    }
  }

  // Respuestas de respaldo cuando no hay API key o falla OpenAI
  private getFallbackResponse(message: string): string {
    const msg = message.toLowerCase();

    if (msg.includes('hola') || msg.includes('buenas') || msg.includes('buenos') || msg.includes('hi')) {
      return '¡Hola! 👋 Soy el asesor de Simulacros San Marcos. ¿Qué carrera estás postulando?';
    }
    if (msg.includes('precio') || msg.includes('costo') || msg.includes('cuánto') || msg.includes('cuanto')) {
      return 'El simulacro cuesta S/ 50 💪 Es 100% virtual. ¿Qué carrera postulas?';
    }
    if (msg.includes('virtual') || msg.includes('presencial') || msg.includes('online')) {
      return '¡Sí, es 100% virtual! 📱 Lo rindes desde tu celular o PC. ¿Qué carrera postulas?';
    }
    if (msg.includes('medicina')) {
      return 'Medicina es Área Biomédicas 🩺 Tenemos simulacro disponible. ¿Te interesa inscribirte? Son S/ 50.';
    }
    if (msg.includes('inscrib') || msg.includes('apunt') || msg.includes('quiero pagar')) {
      return '¡Genial! 🎉 Yapea S/ 50 al +51978069398 y envíame el comprobante por aquí.';
    }
    if (msg.includes('yape') || msg.includes('pago') || msg.includes('pagar')) {
      return 'Yapea S/ 50 al +51978069398 📲 y mándame la captura. ¡En seguida confirmo!';
    }

    return '¡Hola! ¿Me dices qué carrera postulas para San Marcos? Así te explico lo del simulacro 😊';
  }

  isPaymentProof(messageType: string): boolean {
    return messageType === 'image';
  }

  // Detectar si el cliente dice sí (true), no (false), o no está claro (null)
  async detectYesOrNo(text: string): Promise<boolean | null> {
    const apiKey = this.config.get('OPENAI_API_KEY', '');
    if (!apiKey || apiKey.includes('sk-pon-aqui')) {
      const t = text.toLowerCase();
      if (t.includes('sí') || t.includes('si') || t.includes('dale') || t.includes('claro') || t.includes('quiero') || t.includes('ya')) return true;
      if (t.includes('no') || t.includes('nop') || t.includes('mejor no')) return false;
      return null;
    }
    try {
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres un clasificador. El usuario responde si quiere o no quiere participar/inscribirse en algo. Responde SOLO con: SI, NO, o DESCONOCIDO.' },
          { role: 'user', content: text },
        ],
        max_tokens: 10,
        temperature: 0,
      });
      const answer = res.choices[0]?.message?.content?.trim().toUpperCase() || '';
      if (answer.includes('SI') || answer.includes('SÍ')) return true;
      if (answer.includes('NO')) return false;
      return null;
    } catch {
      return null;
    }
  }

  // Detectar si el cliente es primera vez (true) o tiene experiencia (false)
  // Retorna null si no está claro en el mensaje
  async detectFirstTime(text: string): Promise<boolean | null> {
    const apiKey = this.config.get('OPENAI_API_KEY', '');
    if (!apiKey || apiKey.includes('sk-pon-aqui')) {
      // Fallback sin API
      const t = text.toLowerCase();
      if (t.includes('primera') || t.includes('nunca') || t.includes('nuevo') || t.includes('recién') || t.includes('si')) return true;
      if (t.includes('ya') || t.includes('segunda') || t.includes('antes') || t.includes('postulé') || t.includes('experiencia')) return false;
      return null;
    }
    try {
      const res = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres un clasificador. El usuario responde si es su primera vez postulando a la universidad o si ya tiene experiencia. Responde SOLO con: PRIMERA, EXPERIENCIA, o DESCONOCIDO.' },
          { role: 'user', content: text },
        ],
        max_tokens: 10,
        temperature: 0,
      });
      const answer = res.choices[0]?.message?.content?.trim().toUpperCase() || '';
      if (answer.includes('PRIMERA')) return true;
      if (answer.includes('EXPERIENCIA')) return false;
      return null;
    } catch {
      return null;
    }
  }
}
