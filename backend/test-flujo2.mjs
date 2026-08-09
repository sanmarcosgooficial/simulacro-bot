// PRUEBA DEL FLUJO IA-LIBRE: simula la conversación real de asihabla.txt
// (número atascado → anuncio → "ing civil" → "ya postulo antes" → "si")
// con el WebhooksService real + OpenAI real. Verifica: sin repetición, contexto
// completo (recuerda la carrera), flyer enviado, marcadores procesados.
import { WebhooksService } from './dist/webhooks/webhooks.service.js';
import { AiService } from './dist/ai/ai.service.js';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name} ${extra}`); }
}

// ── Mocks ─────────────────────────────────────────────────────────────
const history = [];
const conv = { stage: 'saludada', id: 'conv1', contactId: 'ct1', isAgentPaused: false, phone: '+51999999999' };
const conversations = {
  findByPhone: async () => ({ ...conv }),
  findOrCreateByPhone: async () => ({ ...conv }),
  updateContactName: async () => {},
  linkContact: async () => {},
  addMessage: async (_id, role, content) => {
    const m = { role: role === 'assistant' ? 'assistant' : 'user', content };
    history.push(m);
    return m;
  },
  getChatHistory: async () => history.slice(-40),
  setStage: async (_id, s) => { conv.stage = s; },
};
const contact = { id: 'ct1', name: null, career: null, status: null };
const contacts = {
  findOrCreate: async () => contact,
  update: async (_id, data) => Object.assign(contact, data),
};
const config = {
  get: (k, d) => {
    if (k === 'GEMINI_API_KEY' || k === 'OPENAI_API_KEY') return process.env.OPENAI_API_KEY || '';
    if (k === 'GEMINI_MODEL' || k === 'OPENAI_MODEL') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (k === 'GEMINI_CLASSIFIER_MODEL' || k === 'OPENAI_CLASSIFIER_MODEL') return 'gpt-4o-mini';
    if (k === 'BACKEND_PUBLIC_URL') return 'http://localhost:3001';
    if (k === 'PORT') return '3001';
    return d;
  },
};
const settings = {
  get: async (key) => {
    if (key === 'agent_enabled') return 'true';
    if (key === 'flyer_url') return '';
    if (key === 'ai_model') return null;
    return null;
  },
  getAll: async () => ({ price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos' }),
};
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const simulacros = {
  findActive: async () => [{ id: '1', name: 'San Marcos Las Fijas', date: tomorrow, schedules: ['17:00 - 20:00'], flyerUrl: '/uploads/flyer.png', area: 'Ciencias' }],
};
const sentTexts = [];
const sentImages = [];
const ycloud = {
  sendTextMessage: async (_p, text) => sentTexts.push(text),
  sendImageMessage: async (_p, url) => sentImages.push(url),
  sendTypingIndicator: async () => {},
};
const sse = { emitNewMessage: () => {}, emitDashboardUpdate: () => {}, emitContactUpdated: () => {} };

const ai = new AiService(config, settings, simulacros);
ai.onModuleInit();
const ws = new WebhooksService(conversations, contacts, ai, ycloud, settings, sse, config, simulacros);

const msg = (text, i) => ({
  from: '51999999999',
  id: 'waid' + i,
  type: 'text',
  text: { body: text },
  customerProfile: { name: 'Ana' },
});

// ── parseMarkers (unit) ────────────────────────────────────────────────
const pm1 = ws.parseMarkers('Hola 😊\n[FLYER]');
check('parseMarkers: detecta [FLYER] y lo quita', pm1.flyer === true && pm1.text === 'Hola 😊', JSON.stringify(pm1));
const pm2 = ws.parseMarkers('Yape al 978069398 [PAGO]');
check('parseMarkers: detecta [PAGO] y lo quita', pm2.pago === true && !pm2.text.includes('[PAGO]'), JSON.stringify(pm2));
const pm3 = ws.parseMarkers('Hola');
check('parseMarkers: sin marcadores', pm3.flyer === false && pm3.pago === false && pm3.text === 'Hola', JSON.stringify(pm3));

// ── Conversación real (igual que asihabla.txt) ────────────────────────
console.log('▶ Msg 1: mensaje del anuncio (número atascado en saludada)...');
await ws.handleIncomingMessage(msg('Hola, quiero probarme en el Simulacro de San Marcos🧑⚕️!', 1));
console.log('▶ Msg 2: "hola mi hijo esta postulando a ing civil"...');
await ws.handleIncomingMessage(msg('hola mi hijo esta postulando a ing civil', 2));
console.log('▶ Msg 3: "ya postulo antes"...');
await ws.handleIncomingMessage(msg('ya postulo antes', 3));
console.log('▶ Msg 4: "si"...');
await ws.handleIncomingMessage(msg('si', 4));

// ── Verificaciones ────────────────────────────────────────────────────
console.log('\n── Mensajes enviados por el bot ──');
sentTexts.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log(`  📸 Imágenes enviadas: ${sentImages.length} → ${sentImages.join(', ') || 'ninguna'}`);

const all = sentTexts.join(' ');
const fallbackMarkers = ['Soy el asesor de Simulacros San Marcos'];

check('Msg1: la IA saluda y/o pregunta la carrera', /Buenos d[ií]as|Buenas tardes|Buenas noches|carrera|postul/i.test(sentTexts[0] || ''), `→ "${(sentTexts[0] || '').slice(0, 60)}"`);
check('🎯 SIN RESPALDO: ninguna respuesta es plantilla', !fallbackMarkers.some((m) => all.includes(m)), '');
check('🎯 CONTEXTO: el bot recuerda la carrera (menciona civil/ingeniería)', /civil|ingenier/i.test(all), '');
check('🎯 AVANZA: pregunta por el horario', /horario|te acomoda/i.test(all), '');
check('🎯 FLYER ENVIADO (imagen)', sentImages.length >= 1, `→ ${sentImages.length}`);
check('🎯 SIN REPETICIÓN: "¿A qué carrera postulas?" aparece ≤ 1 vez', (all.match(/¿A qué carrera postulas\?/g) || []).length <= 1, `→ ${(all.match(/¿A qué carrera postulas\?/g) || []).length} veces`);
check('🎯 Marcadores no se envían al cliente', !/\[FLYER\]|\[PAGO\]/.test(all), '');
check('Carrera guardada en CRM', /civil/i.test(contact.career || ''), `→ "${contact.career}"`);
check('Etapa avanzó (no quedó atascada)', conv.stage !== 'saludada', `→ ${conv.stage}`);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${pass} ✅ / ${fail} ❌`);
console.log(results.join('\n'));
process.exit(fail > 0 ? 1 : 0);
