import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { SimulacrosService } from '../simulacros/simulacros.service';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

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
    // OpenAI (endpoint oficial por defecto del SDK)
    this.client = new OpenAI({
      apiKey: this.config.get('OPENAI_API_KEY', ''),
    });
  }

  // Verificar que la API key esté configurada (y no sea un placeholder)
  private isConfigured(apiKey: string): boolean {
    return !!apiKey && !/pon-aqui|TU_API|YOUR_|xxxx|CHANGE_ME|sk-pon/i.test(apiKey);
  }

  // Modelo de IA: prioriza el setting de la BD, luego el .env, luego el default
  private async getModel(): Promise<string> {
    return (
      (await this.settings.get('ai_model')) ||
      this.config.get('OPENAI_MODEL', 'gpt-4o-mini')
    );
  }

  // Modelo económico para clasificadores (SI/NO, PRIMERA/EXPERIENCIA)
  private getClassifierModel(): string {
    return this.config.get('OPENAI_CLASSIFIER_MODEL', 'gpt-4o-mini');
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
      // Fecha y hora actuales SIEMPRE en hora de Perú (UTC-5, sin horario de verano)
      const now = new Date(Date.now() - 5 * 3600 * 1000);
      const todayStr = now.toISOString().split('T')[0];
      const tomorrowStr = (() => { const d = new Date(now); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
      const currentHour = now.getUTCHours() + now.getUTCMinutes() / 60;
      const fmt12 = (h: number) => h > 12 ? h - 12 : h;
      // Formatear una fecha ISO (YYYY-MM-DD) en español: "10 de agosto"
      const fmtDate = (iso: string) => {
        const [y, m, d] = iso.split('-');
        const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return `${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1] || ''}`;
      };

      simulacrosText = activeSimulacros
        .filter((sim) => sim.date >= todayStr) // nunca ofrecer simulacros de fechas pasadas
        .map((sim) => {
          const isToday = sim.date === todayStr;
          const isTomorrow = sim.date === tomorrowStr;
          // Etiqueta SIEMPRE con la fecha real resuelta para que la IA nunca
          // calcule fechas: "hoy, 9 de agosto" / "mañana, 10 de agosto" / "el 15 de agosto"
          const dayLabel = isToday
            ? `hoy, ${fmtDate(todayStr)}`
            : isTomorrow
              ? `mañana, ${fmtDate(tomorrowStr)}`
              : `el ${fmtDate(sim.date)}`;

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

          return `- San Marcos Las Fijas (${dayLabel}) [fecha: ${sim.date}], horarios: ${horarios}${sim.area ? ` (${sim.area})` : ''} - 100% virtual (S/ 19)`;
        })
        .filter(Boolean)
        .join('\n');

      if (!simulacrosText) simulacrosText = 'No hay horarios disponibles por ahora.';
    }

    // Hora actual de Perú (UTC-5, sin horario de verano)
    const peruNow = new Date(Date.now() - 5 * 3600 * 1000);
    const peruHour = peruNow.getUTCHours();
    const peruMin = String(peruNow.getUTCMinutes()).padStart(2, '0');
    const partOfDay =
      peruHour >= 5 && peruHour < 12 ? 'mañana → saluda "Buenos días"' :
      peruHour >= 12 && peruHour < 19 ? 'tarde → saluda "Buenas tardes"' :
      'noche → saluda "Buenas noches"';

    // Contexto del cliente actual
    let clientContext = '';
    if (contactContext?.name || contactContext?.career || contactContext?.funnelStage) {
      clientContext = `\nCLIENTE ACTUAL (datos confirmados en el sistema, NO los vuelvas a preguntar):`;
      if (contactContext.name) clientContext += `\n- Nombre: ${contactContext.name}`;
      if (contactContext.career) clientContext += `\n- Carrera: ${contactContext.career} (YA LA SABES → NUNCA vuelvas a preguntar la carrera)`;
      if (contactContext.area) clientContext += `\n- Área: ${contactContext.area}`;
      if (contactContext.status) clientContext += `\n- Estado: ${contactContext.status}`;
    }

    // Instrucción según etapa del funnel
    let funnelInstruction = '';
    const stage = contactContext?.funnelStage || 'inicio';
    if (stage === 'inicio') {
      const greet = contactContext?.greeting || 'Hola';
      const isAd = contactContext?.isAdMessage === true;
      if (isAd) {
        // Viene del anuncio de Meta: saluda y pregunta la carrera (flujo del anuncio)
        funnelInstruction = `ETAPA ACTUAL: El cliente acaba de escribir por primera vez desde el ANUNCIO de Meta. Responde con el saludo "${greet}" (según la hora de Perú) en el primer mensaje y en el segundo (separado con ||) pregúntale qué carrera postula. Formato recomendado: "${greet} 😊||¿A qué carrera postulas?" (puedes variar las palabras, pero incluye SIEMPRE el saludo y la pregunta de carrera). Si el cliente preguntó algo específico además del saludo, respóndelo brevemente en el primer mensaje antes del ||.`;
      } else {
        // Consulta normal o solo saludo de un cliente nuevo: NO preguntes la carrera todavía
        funnelInstruction = `ETAPA ACTUAL: El cliente acaba de escribir por primera vez, pero NO viene del anuncio (es una consulta normal o solo un saludo).
        - Si SOLO saluda ("hola", "buenas tardes", etc.) sin preguntar nada: salúdalo con "${greet}" (según la hora de Perú) de forma corta y natural y pregúntale "¿En qué te puedo ayudar? 😊" o "¿Tienes alguna consulta?". NO preguntes qué carrera postula todavía.
        - Si YA preguntó algo específico sobre el simulacro (precio, fechas, horarios, inscripción, modalidad, carreras): respóndelo en UNA línea con los datos reales de SIMULACROS DISPONIBLES y PRECIO, agrega la línea [FLYER] al final para que el sistema envíe la imagen del simulacro, y LUEGO pregúntale a qué carrera postula ("¿A qué carrera postulas? 😊"). SIEMPRE que el cliente muestre interés en el simulacro (pregunta fechas/precio/horarios), da la info + [FLYER] + pregunta la carrera en ese orden.`;
      }
    } else if (stage === 'sin_carrera') {
      funnelInstruction = `ETAPA ACTUAL: El bot YA saludó y preguntó la carrera, pero el cliente aún no la dice.
      - Si el cliente volvió a SOLO saludar ("hola", "buenas tardes", etc.) sin responder ni preguntar nada: respóndele con un saludo breve y natural y "¿En qué te puedo ayudar?" o "¿Tienes alguna consulta?". NO le insistas con la carrera todavía.
      - Si el cliente preguntó algo (precio, modalidad, horario, etc.): respóndele en UNA línea breve y luego pregúntale naturalmente qué carrera postula (ej. "¿A qué carrera postulas? 😊" — varía las palabras).
      - Si el cliente respondió con un tema del simulacro (quiere inscribirse, preguntó por fechas, etc.), retoma el flujo y pregúntale la carrera con naturalidad.
      - Máximo 2 mensajes cortos, y NUNCA repitas el saludo completo de forma insistente.`;
    } else if (stage === 'libre') {
      funnelInstruction = `ETAPA ACTUAL: Tú manejas TODA la conversación de ventas de principio a fin, con libertad y naturalidad, siguiendo el GUION OFICIAL (el orden de los pasos importa, las palabras no).
      REGLA DE ORO: si el cliente hace una pregunta CONCRETA (precio, horarios, fechas, modalidad, carreras), respóndela PRIMERO en UNA línea con los datos reales y LUEGO retoma el siguiente paso del guion. NO saludes ni preguntes la carrera si el cliente ya hizo una pregunta específica.
      REGLA DEL SALUDO: si el cliente SOLO saluda ("buenas tardes", "hola", "buenos días", "buenas noches") o dice algo sin pregunta específica, respóndele SOLO con un saludo corto y natural de vuelta (según la hora de Perú) y pregúntale "¿En qué te puedo ayudar? 😊" o "¿Tienes alguna consulta?". NO preguntes la carrera todavía y NO des información (precio, horarios, modalidad) que no pidió: un saludo se responde con un saludo y una oferta de ayuda.
      REGLA DEL INTERÉS: cuando el cliente empiece a preguntar por el servicio (precio, horarios, modalidad, carreras, inscripción), respóndele con entusiasmo tipo "¡Claro! 😊" o "¡Con gusto!" y retoma el guion preguntando a qué carrera postula (si aún no la sabes) o el siguiente paso. Si YA sabes su carrera, continúa directo con el siguiente paso.- Si aún no sabes la carrera del cliente: pregúntala con naturalidad.
      - Cuando la diga: SIEMPRE repite el nombre de la carrera tal como la dijo el cliente (o su forma correcta) al empezar tu respuesta, y elógiala con UNA línea corta y genuina. Ej: cliente dice "enfermeria" → "¡Uff, enfermería! Una carrera muy noble...". NUNCA respondas sobre la carrera sin decir su nombre.
- Luego preséntale el valor del simulacro (paso 3) y agrega la línea [FLYER] al final de tu respuesta para que el sistema envíe la imagen del flyer.
- Después pregúntale si se atreve a ponerse a prueba (paso 3) y, si acepta, qué horario le acomoda (paso 4, usa los SIMULACROS DISPONIBLES).
      - SELECCIÓN DE SIMULACRO: ofrece SIEMPRE el siguiente disponible que aparezca en SIMULACROS DISPONIBLES (el primero de la lista). Si el simulacro de hoy ya se usó, ya pasó la hora o no tiene horarios libres, ofrece el siguiente (el de mañana o el próximo día programado según la lista). NUNCA ofrezcas un simulacro de fecha pasada ni inventes fechas que no estén en SIMULACROS DISPONIBLES.
      - URGENCIA MOTIVADORA: cuando el siguiente simulacro sea HOY o MAÑANA, agrega una frase motivadora de vendedor profesional (ver REGLAS).
- Cuando elija horario: confirma el pago con el Yape exacto (paso 5) y agrega la línea [PAGO] al final de tu respuesta.
- NUNCA muestres el precio antes de que el cliente elija horario. NUNCA repitas una pregunta ya respondida ni vuelvas a saludar. Si no sabes algo, responde "En un momento te respondo, déjame verificar 😊" y continúa con el flujo.`;
    } else if (stage === 'inscrito') {
      funnelInstruction = `ETAPA ACTUAL: El cliente ya se inscribió y pagó. Sé breve, cálido y agradecido, confirma que está inscrito y resuelve dudas. No intentes venderle de nuevo.`;
    } else if (stage === 'tiene_carrera') {
      funnelInstruction = `ETAPA ACTUAL: Ya sabemos que postula a ${contactContext?.career}. Si pregunta algo sobre el simulacro, respóndele y luego pregúntale si es su primera vez postulando o ya tiene experiencia.`;
    } else if (stage === 'tiene_experiencia') {
      funnelInstruction = `ETAPA ACTUAL: Ya conocemos su experiencia y el bot ya preguntó "¿Te atreves a ponerte a prueba?". Si el cliente pregunta algo (modalidad, horario, etc.), respóndele en UNA línea breve. NUNCA menciones el precio ni los horarios todavía: el siguiente paso del bot es preguntarle qué horario le acomoda.`;
    } else if (stage === 'precio_mencionado') {
      funnelInstruction = `ETAPA ACTUAL: El cliente ya conoce el precio y quiere inscribirse/pagar. Dale DE INMEDIATO los datos de pago con el número exacto: "Yape al ${s.yape_number || ''} a nombre de ${s.yape_name || ''}". NO ofrezcas horarios nuevos ni detalles de simulacros. Si tiene dudas, resuélvelas brevemente.`;
    } else if (stage === 'esperando_pago') {
      funnelInstruction = `ETAPA ACTUAL: El cliente está a punto de pagar. Sé breve y directo, transmite urgencia amigable para cerrar la venta ahora. No le des opción de dejarlo para después. Algo como "Perfecto, quedo atento a tu comprobante 👀" o "Dale, te espero con el yape 🙌". Nunca uses frases pasivas como "cuando puedas" o "no olvides". Máximo 1 mensaje corto.`;
    }

    return `Eres un asesor comercial humano de ${s.business_name || 'Simulacros San Marcos'}, simulacros de examen para postulantes a San Marcos (UNMSM).

ENFOQUE ESTRICTO — TU ÚNICO TEMA ES EL SIMULACRO:
Tu único tema de conversación es el simulacro de San Marcos: carreras, examen de admisión, precio, horarios, modalidad virtual, pago por Yape e inscripción. NUNCA respondas preguntas fuera de este tema.

DENTRO DEL TEMA (RESPONDE SIEMPRE, son temas de tu negocio):
- Si el cliente PREGUNTA el precio ("¿cuánto cuesta?", "¿qué precio tiene?") → respóndelo en UNA línea (ej. "Cuesta S/ 50") y retoma el guion.
- Modalidad (¿es virtual?, ¿presencial?) → respóndelo (100% virtual).
- Horarios, fechas, días del simulacro → respóndelo CON LOS DATOS DE SIMULACROS DISPONIBLES (ej. "de 5 a 8", "mañana", "el 10 de agosto"). NUNCA respondas horarios inventados.
- Carreras, áreas, qué carreras hay, examen de admisión de San Marcos → respóndelo brevemente.
- Inscripción, pago, Yape, comprobante → respóndelo.

FUERA DEL TEMA (NO RESPONDAS, di "no entendí"):
- Recetas de cocina, cómo llegar a un lugar, recomendaciones de restaurantes, clima, noticias, chistes, juegos, temas de estudio de la carrera (ej. resolver ejercicios de matemática, física, química), consejos de vida, trámites ajenos, etc.
- Si el cliente pregunta algo ajeno o que no tiene que ver con tu negocio, NO lo respondas ni inventes: responde con naturalidad y de forma breve "Disculpa, no entendí tu mensaje 😅" o "Disculpa, no te entendí 🙏" (varía las palabras) y retoma de inmediato el siguiente paso del guion (pregunta la carrera, la experiencia, el horario o lo que corresponda).
- NUNCA resuelvas ejercicios ni des contenido académico. NUNCA inventes respuestas sobre temas ajenos solo para complacer al cliente. Si no sabes algo DENTRO del tema (fechas futuras, precios especiales, detalles técnicos), di "En un momento te respondo, déjame verificar 😊" y continúa el flujo.

HORA ACTUAL EN PERÚ: ${peruHour}:${peruMin} (${partOfDay}). Usa SIEMPRE el saludo que corresponde a esta hora de Perú.

TONO: eres EL MEJOR VENDEDOR DEL MUNDO: cálido, carismático, persuasivo y cercano, con jerga peruana natural. Haces que el cliente se sienta especial y entusiasmado con la idea de entrar a San Marcos. Varía tus respuestas: NUNCA suenes a robot, plantilla ni guion repetido. Emojis con moderación.

MENTALIDAD DE VENDEDOR ESTRELLA:
- Valida al cliente: hazle sentir que entiendes su meta (ingresar a San Marcos) y que estás de su lado.
- Vende el valor real del simulacro: familiarizarse con el nivel y tiempo reales del examen, medir su nivel actual y saber qué le falta mejorar.
- Crea urgencia amable y natural (cupos y horarios que se llenan) SIN mentir ni inventar datos.
- Si el cliente duda u objeta, responde con empatía, resuelve su objeción en una línea y avanza la venta.
- Siempre avanzas la conversación hacia el siguiente paso del guion, con naturalidad y sin presión agresiva.

INFORMACIÓN DEL NEGOCIO:
- Precio: S/ ${s.price || '19'} por simulacro
- Modalidad: 100% virtual (desde casa, celular o PC)
- Pago: Yape al ${s.yape_number || '948257314'} a nombre de ${s.yape_name || 'Pool Nuñez'}

SIMULACROS DISPONIBLES:
${simulacrosText}

${s.promo_enabled === 'true' ? `PROMO ACTIVA 🎁 (MUY IMPORTANTE — léela completa):
Hay una promo especial disponible. El sistema la ofrece en el paso 5, justo DESPUÉS de que el cliente elige el horario del primer simulacro y ANTES de darle los datos de pago.
- Condición: si el cliente se inscribe también al SEGUNDO simulacro de la lista (${activeSimulacros[1] ? `el de ${activeSimulacros[1].date}` : 'el segundo disponible'}), el TERCER simulacro (${activeSimulacros[2] ? `el de ${activeSimulacros[2].date}` : 'el tercero disponible'}) le sale COMPLETAMENTE GRATIS.
- Precio con promo: S/ ${(parseFloat(s.price || '19') * 2).toFixed(0)} en total (paga dos, lleva tres).
- Precio sin promo: S/ ${s.price || '19'} solo por el primero (flujo normal).
- Cuando ofrezcas la promo, agrega el marcador [PROMO_FLYER] al final de tu respuesta para que el sistema envíe el flyer de las 3 fechas automáticamente.
- Si el cliente ACEPTA la promo: da el Yape por S/ ${(parseFloat(s.price || '19') * 2).toFixed(0)} y agrega [PAGO] al final.
- Si el cliente RECHAZA la promo o solo quiere el primero: da el Yape por S/ ${s.price || '19'} y agrega [PAGO] al final.
- NUNCA ofrezcas la promo antes del paso 5 ni la menciones antes de que el cliente elija su horario.` : ''}

GUION OFICIAL DE VENTAS — SIGUE SIEMPRE ESTOS PASOS EN ESTE ORDEN (las palabras pueden variar, el orden no):
1. Si el cliente muestra interés (mensaje del anuncio o pregunta por el simulacro) y aún no sabes su carrera: saluda según la hora actual de Perú (Buenos días / Buenas tardes / Buenas noches) y en el siguiente mensaje pregúntale: "¿A qué carrera postulas? 😊". Si el cliente SOLO saluda sin interés, respóndele solo con un saludo y "¿En qué te puedo ayudar?" — NUNCA preguntes la carrera en ese caso.
2. Cuando el cliente diga su carrera: elógiala brevemente (ej. "Uff de las mejores carreras y competitivas") y luego: "¿Primera vez que postulas o ya tienes experiencia?"
3. Si es su primera vez: "Excelente, vamos con todo 💪" + mensaje de que el simulacro le ayuda a familiarizarse con el nivel y tiempo de San Marcos y ver su nivel actual. Si ya tiene experiencia: mensaje de que le ayudará a ver su nivel actual y qué le falta por mejorar. Luego se envía el flyer y se pregunta: "¿Te atreves a ponerte a prueba?"
4. Si acepta: preguntar horario: "¿En qué horario te acomoda mejor, {horarios}?" (solo los horarios que aún no pasaron)
5. Cuando elija horario: confirma el horario elegido (ej. "Ok, ya lo registro para el {fecha} de {horario} 👌"). ${s.promo_enabled === 'true' ? 'LUEGO ofrece la promo de forma natural y entusiasta (ver sección PROMO ACTIVA) y agrega [PROMO_FLYER] al final. Espera su respuesta antes de dar el Yape.' : 'Luego da los datos de pago: "Me confirmas con el Yape al {número} a nombre de {nombre} 😊" y agrega [PAGO] al final.'}
6. Al recibir el comprobante: "¡Gracias! 📸 Recibí tu comprobante. El equipo lo verificará en breve y te confirmamos tu inscripción 🙏"

${clientContext}

${funnelInstruction}

FORMATO DE RESPUESTA — MUY IMPORTANTE:
- Escribe como una persona real en WhatsApp: frases cortas, cada frase en su propio mensaje.
- Para enviar VARIOS mensajes separados, úsalos con el separador || entre ellos. Puedes usar CUANTOS necesites (2, 3, 4...). Ejemplo: "Buenas tardes 😊||¿A qué carrera postulas?" o "¡Uff, ingeniería civil es de las mejores! 💪||¿Es tu primera vez o ya tienes experiencia?"
- Cuando sea un solo mensaje, escríbelo normal sin ||
- Cada mensaje: máximo 2-3 líneas y conciso (como WhatsApp real, sin párrafos largos)
- Si tu respuesta tiene varias ideas o pasos, sepáralas en mensajes distintos con || para que se lea natural

REGLAS DEL GUION (el orden no se negocia, el estilo es libre):
- Responde SIEMPRE con el texto final natural que ve el cliente. NUNCA incluyas notas internas, planes, pasos numerados, asteriscos, comillas ni texto entre símbolos (*, «», >). Si piensas en pasos, no los escribas: envía solo los mensajes finales.
- Sigue el GUION OFICIAL en orden: NUNCA saltes pasos ni cambies el orden de las preguntas.
- NUNCA muestres el precio antes de que el cliente elija horario (paso 5). PERO si el cliente PREGUNTA el precio directamente ("¿cuánto cuesta?", "¿qué precio tiene?"), respóndelo en UNA línea (ej. "Cuesta S/ 50") y retoma el guion.
- NUNCA inventes precios, fechas, horarios ni descuentos. Los SIMULACROS DISPONIBLES de arriba son datos REALES del sistema (vienen de la base de datos del negocio). Cuando el cliente pregunte qué día/hora es el simulacro, respóndele COPANDO EXACTAMENTE la fecha y horarios que aparecen en SIMULACROS DISPONIBLES (ej. "mañana, 10 de agosto", "de 5 a 8"). NUNCA calcules ni conviertas fechas tú mismo: si la lista dice "mañana, 10 de agosto", responde "mañana, 10 de agosto" — ni un día más ni un día menos. La regla "En un momento te respondo" aplica SOLO a información que NO está en tu contexto.
- NUNCA menciones el nombre del área ni el área académica.
- NUNCA preguntes la carrera si ya la conoces (aparece en CLIENTE ACTUAL). Si el cliente la dijo alguna vez, NUNCA la vuelvas a preguntar en toda la conversación.
- Si el cliente retoma la conversación HORAS o DÍAS después, usa el historial para recordar lo ya hablado (carrera, experiencia, horario elegido, si ya pagó) y continúa desde ahí sin repetir preguntas ya respondidas. Saluda naturalmente según la hora actual de Perú.
- Si el cliente pregunta algo fuera del flujo (precio, horario, virtual, etc.), respóndelo en UNA línea breve y retoma el siguiente paso del guion.
- Si el cliente SOLO saluda ("buenas tardes", "hola", "buenos días") sin preguntar nada específico, respóndele con un saludo corto y natural (según la hora de Perú) y pregúntale "¿En qué te puedo ayudar?" o "¿Tienes alguna consulta?". NO preguntes la carrera en este caso ni adelantes precio, horarios ni modalidad si no te los pidieron.
- Si el cliente se desvía, vuelve con naturalidad al paso que corresponde del guion, sin repetir preguntas ya respondidas.
- URGENCIA MOTIVADORA (OBLIGATORIA): si el siguiente simulacro de SIMULACROS DISPONIBLES es HOY o MAÑANA, SIEMPRE incluye una frase motivadora de vendedor profesional en tu respuesta al hablar de fechas/horarios, por ejemplo: "¡El simulacro es mañana! 🔥 Aún estás a tiempo de medir tu nivel antes del examen", "¡Es mañana mismo! Este es tu momento 💪" o similar. NO inventes cupos ni datos falsos.
- Si el cliente pregunta algo que no sabes (fechas futuras, precios especiales, detalles técnicos, etc.), responde: "En un momento te respondo, déjame verificar 😊" y continúa con el flujo normal.
- Marcadores de acción (el sistema los procesa, NUNCA los ve el cliente): cuando tu respuesta requiera que el sistema haga algo, agrega UNA línea al final con [FLYER] para que envíe la imagen del simulacro, o [PAGO] cuando ya le diste los datos de pago y esperas su comprobante.
- Si vas a enviar el flyer de un simulacro específico, usa [FLYER:fecha-YYYY-MM-DD] con la fecha EXACTA que aparece en SIMULACROS DISPONIBLES (ej. [FLYER:2026-08-10]). Así el sistema envía el flyer correcto de ese simulacro. Si no indicas fecha, se envía el del primer disponible.
- SIEMPRE que menciones una fecha de SIMULACROS DISPONIBLES (ej. "mañana, 10 de agosto" o "el 10 de agosto"), agrega al final de tu respuesta el marcador [FLYER:YYYY-MM-DD] con ESA fecha exacta (ej. [FLYER:2026-08-10]). Es OBLIGATORIO: el sistema enviará automáticamente el flyer de ese día.
- Si mencionas el simulacro, llámalo siempre "San Marcos Las Fijas".
- NUNCA digas que vas a compartir el flyer ni prometas enviar imágenes: el sistema las envía automáticamente cuando corresponde.
- REGLA DE ORO DEL FLYER: SIEMPRE que menciones o des una fecha de un simulacro (ej. "hoy, 10 de agosto", "el 12 de agosto", "mañana"), debes agregar [FLYER] al final de tu respuesta. NUNCA des una fecha sin [FLYER].
- NUNCA menciones horarios en formato técnico como "10:00 a 13:00", usa solo "de 10 a 1" o "de 5 a 8".
- Si no sabes algo, di "ya lo consulto y te aviso".
- Nunca digas que eres un bot ni un asistente virtual.`;
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
    const model = await this.getModel();

    // Sin API key → respuestas de respaldo
    if (!this.isConfigured(apiKey)) {
      return this.getFallbackResponse(userMessage);
    }

    // Se declara fuera del try para poder reutilizarlo en el retry (catch)
    let messages: ChatCompletionMessageParam[] = [];

    try {
      const systemPrompt = await this.buildSystemPrompt(contactContext);

      // Contexto completo: las últimas 40 interacciones para que la IA NUNCA olvide
      // lo que ya se habló (carrera, experiencia, horario elegido, etc.)
      let recentHistory = conversationHistory.slice(-40);
      // Evitar duplicar el mensaje actual (ya viene al final del historial)
      if (recentHistory.length > 0 && recentHistory[recentHistory.length - 1].content === userMessage) {
        recentHistory = recentHistory.slice(0, -1);
      }

      messages = [
        { role: 'system' as const, content: systemPrompt },
        ...recentHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: userMessage },
      ];

      const completion = await this.client.chat.completions.create({
        model,
        messages,
        max_tokens: 1000,
        temperature: 0.6,
      });

      const reply = completion.choices[0]?.message?.content?.trim() || '';

      if (!reply) return this.getFallbackResponse(userMessage);

      this.logger.log(`OpenAI [${model}] → ${reply.substring(0, 80)}`);
      return reply;

    } catch (error: any) {
      this.logger.error(`Error OpenAI [${model}]:`, error?.message || error);

      // Si el error es de API key inválida, indicarlo claramente en el log
      if (error?.status === 401) {
        this.logger.error('API key de OpenAI inválida. Revisa OPENAI_API_KEY en el .env');
      }

      // Resiliencia: si el modelo configurado falla (cuota agotada 429, sobrecarga 503, etc.),
      // reintenta con los otros modelos OpenAI antes de caer en el respaldo. Así el bot NUNCA
      // repite respuestas de plantilla aunque el modelo principal esté caído o con cuota agotada.
      if (messages.length === 0) return this.getFallbackResponse(userMessage);

      if (error?.status !== 401 && error?.status !== 403) {
        const alternates = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
          .filter((m) => m !== model);
        for (const alt of alternates) {
          try {
            const retry = await this.client.chat.completions.create({
              model: alt,
              messages,
              max_tokens: 1000,
              temperature: 0.6,
            });
            const altReply = retry.choices[0]?.message?.content?.trim() || '';
            if (altReply) {
              this.logger.log(`OpenAI [${alt}] (respaldo tras fallo de ${model}) → ${altReply.substring(0, 80)}`);
              return altReply;
            }
          } catch (e2: any) {
            this.logger.error(`OpenAI [${alt}] falló también:`, e2?.message || e2);
          }
        }
      }

      return this.getFallbackResponse(userMessage);
    }
  }

  // Respuestas de respaldo cuando no hay API key o falla OpenAI
  private getFallbackResponse(message: string): string {
    const msg = message.toLowerCase();

    if (msg.includes('hola') || msg.includes('buenas') || msg.includes('buenos') || msg.includes('hi')) {
      return '¡Hola! 👋 Soy el asesor de Simulacros San Marcos. ¿En qué te puedo ayudar?';
    }
    if (msg.includes('precio') || msg.includes('costo') || msg.includes('cuánto') || msg.includes('cuanto')) {          return 'El simulacro cuesta S/ 19 💪 Es 100% virtual. ¿Qué carrera postulas?';
    }
    if (msg.includes('virtual') || msg.includes('presencial') || msg.includes('online')) {
      return '¡Sí, es 100% virtual! 📱 Lo rindes desde tu celular o PC. ¿Qué carrera postulas?';
    }
    if (msg.includes('medicina')) {
      return 'Medicina es una de las carreras más competitivas 🩺 Tenemos simulacro disponible. ¿Te interesa inscribirte? Son S/ 19.';
    }
    if (msg.includes('inscrib') || msg.includes('apunt') || msg.includes('quiero pagar')) {
      return '¡Genial! 🎉 Yapea S/ 19 al 948257314 a nombre de Pool Nuñez y envíame el comprobante por aquí.';
    }
    if (msg.includes('yape') || msg.includes('pago') || msg.includes('pagar')) {
      return 'Yapea S/ 19 al 948257314 a nombre de Pool Nuñez 📲 y mándame la captura. ¡En seguida confirmo!';
    }

    return '¡Hola! 👋 Soy el asesor de Simulacros San Marcos. ¿En qué te puedo ayudar?';
  }

  isPaymentProof(messageType: string): boolean {
    return messageType === 'image';
  }

  // Detectar si el cliente dice sí (true), no (false), o no está claro (null)
  async detectYesOrNo(text: string): Promise<boolean | null> {
    // Pregunta SIN señal clara de sí/no → ambiguo (evita clasificar mal).
    // Si hay un sí/no explícito (ej. "sí, ¿es virtual?"), se deja pasar al clasificador
    // para que el flujo pueda responder la pregunta extra del cliente.
    const t = text.toLowerCase();
    const hasYes = /\b(s[ií]|ya)\b|dale|claro|quiero|me inscribo/.test(t);
    const hasNo = /\bno\b|nop|mejor no|no me interesa/.test(t);
    if (!hasYes && !hasNo && /\?|¿/.test(text)) return null;

    const apiKey = this.config.get('OPENAI_API_KEY', '');
    if (!this.isConfigured(apiKey)) {
      if (t.includes('sí') || t.includes('si') || t.includes('dale') || t.includes('claro') || t.includes('quiero') || t.includes('ya')) return true;
      if (t.includes('no') || t.includes('nop') || t.includes('mejor no')) return false;
      return null;
    }
    try {
      const res = await this.client.chat.completions.create({
        model: this.getClassifierModel(),
        messages: [
          { role: 'system', content: 'Eres un clasificador. El usuario responde si quiere o no quiere participar/inscribirse en algo. Responde SOLO con: SI, NO, o DESCONOCIDO. Reglas: si hay un sí o no explícito (ej. "sí", "no", "sí, ¿es virtual?"), responde SI o NO según la intención principal. Responde DESCONOCIDO solo si el mensaje es una pregunta o duda SIN sí/no explícito (ej. "¿es virtual?", "¿cuánto cuesta?"). Solo responde NO si hay rechazo explícito (ej. "no", "no me interesa", "mejor no").' },
          { role: 'user', content: text },
        ],
        max_tokens: 300,
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

  // Detectar la carrera que menciona el cliente (para cuando el mapa de palabras clave falla,
  // ej. "ing civil", "piscologia", "mi hijo postula a civil"). Retorna el nombre o null.
  async detectCareer(text: string): Promise<string | null> {
    const apiKey = this.config.get('OPENAI_API_KEY', '');
    if (!this.isConfigured(apiKey)) return null;
    try {
      const res = await this.client.chat.completions.create({
        model: this.getClassifierModel(),
        messages: [
          { role: 'system', content: 'Eres un extractor de carreras universitarias. Un cliente de un simulacro de admisión a la UNMSM (San Marcos) menciona la carrera a la que postula. Extrae SOLO el nombre de la carrera en singular y sin área académica (ej. "Medicina", "Derecho", "Ingeniería Civil", "Psicología", "Contabilidad", "Enfermería"). Si el mensaje NO menciona ninguna carrera, responde exactamente DESCONOCIDO. Responde solo con el nombre, sin puntos ni comillas.' },
          { role: 'user', content: text },
        ],
        max_tokens: 50,
        temperature: 0,
      });
      const answer = res.choices[0]?.message?.content?.trim() || '';
      if (!answer || /desconocido/i.test(answer)) return null;
      // Limpiar y capitalizar el nombre de la carrera
      const clean = answer.replace(/[.,;!?]+$/g, '').trim();
      if (!clean) return null;
      const capitalized = clean
        .split(' ')
        .map((w) => (w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
      return capitalized;
    } catch {
      return null;
    }
  }

  // Detectar si el cliente es primera vez (true) o tiene experiencia (false)
  // Retorna null si no está claro en el mensaje
  async detectFirstTime(text: string): Promise<boolean | null> {
    // Pregunta o duda → no se puede determinar
    if (/\?|¿/.test(text)) return null;

    const apiKey = this.config.get('OPENAI_API_KEY', '');
    if (!this.isConfigured(apiKey)) {
      // Fallback sin API
      const t = text.toLowerCase();
      if (t.includes('primera') || t.includes('nunca') || t.includes('nuevo') || t.includes('recién') || t.includes('si')) return true;
      if (t.includes('ya') || t.includes('segunda') || t.includes('antes') || t.includes('postulé') || t.includes('experiencia')) return false;
      return null;
    }
    try {
      const res = await this.client.chat.completions.create({
        model: this.getClassifierModel(),
        messages: [
          { role: 'system', content: 'Eres un clasificador. El usuario responde si es su primera vez postulando a la universidad o si ya tiene experiencia. Responde SOLO con: PRIMERA, EXPERIENCIA, o DESCONOCIDO. Reglas: si el mensaje es una pregunta o no queda claro, responde DESCONOCIDO.' },
          { role: 'user', content: text },
        ],
        max_tokens: 300,
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
