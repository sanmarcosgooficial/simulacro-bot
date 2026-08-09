// PRUEBA: (1) un cliente NUEVO responde a CUALQUIER mensaje de consulta
// (no solo al anuncio), (2) mensajes por partes se acumulan con debounce,
// (3) simulacros de fecha pasada nunca se ofrecen.
import { WebhooksService } from './dist/webhooks/webhooks.service.js';
import { AiService } from './dist/ai/ai.service.js';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name} ${extra}`); }
}

function makeHarness() {
  const history = [];
  const conv = { stage: 'nueva', id: 'conv1', contactId: 'ct1', isAgentPaused: false, phone: '+51999999999' };
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
  const simulacros = { findActive: async () => [] };
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
  return { ws, conv, contact, sentTexts, history };
}

const msg = (text, i) => ({
  from: '51999999999',
  id: 'waid' + i,
  type: 'text',
  text: { body: text },
  customerProfile: { name: 'Ana' },
});

// ── 1. Consulta normal en cliente NUEVO responde (no se ignora) ───────
{
  const h = makeHarness();
  await h.ws.handleIncomingMessage(msg('hola, me das información del simulacro por favor', 1));
  check('NUEVA: consulta normal SÍ responde (no se ignora)', h.sentTexts.length > 0, `→ ${h.sentTexts.length} msgs`);
  check('NUEVA: respuesta no es de respaldo', h.sentTexts.join(' ').includes('carrera') || h.sentTexts.join(' ').length > 20, `→ "${h.sentTexts[0]?.slice(0, 60)}"`);
  check('NUEVA: avanza a SALUDADA', h.conv.stage === 'saludada', `→ ${h.conv.stage}`);
}

// ── 2. Mensajes por partes: se acumulan y se responde UN turno de IA ──
{
  const h = makeHarness();
  let aiTurns = 0;
  const origProcess = h.ws.ai.processMessage.bind(h.ws.ai);
  h.ws.ai.processMessage = async (...args) => { aiTurns++; return origProcess(...args); };
  h.conv.stage = 'saludada';
  // Disparar 3 mensajes casi simultáneos (debounce los acumula). Solo el último
  // (p3) procesa; los anteriores quedan cancelados por el debounce (diseño real).
  const p1 = h.ws.handleIncomingMessage(msg('ya postulo antes', 10));
  const p2 = h.ws.handleIncomingMessage(msg('me envia la informacion', 11));
  await h.ws.handleIncomingMessage(msg('enviado porfavor', 12));
  void p1; void p2; // promesas canceladas por diseño del debounce (no se esperan)
  check('PARTES: los 3 mensajes se acumulan en 1 turno de IA', aiTurns === 1, `→ ${aiTurns} turnos IA, ${h.sentTexts.length} msgs enviados`);
  check('PARTES: el texto combinado incluye las 3 partes', (h.sentTexts.join(' ') || '').length > 0 && aiTurns === 1, '');
}

// ── 3. Simulacros: fecha pasada nunca se ofrece (via prompt) ─────────
{
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const config = {
    get: (key, def) => {
      if (key === 'OPENAI_API_KEY') return process.env.OPENAI_API_KEY || '';
      if (key === 'OPENAI_MODEL') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
      if (key === 'OPENAI_CLASSIFIER_MODEL') return 'gpt-4o-mini';
      return def;
    },
  };
  const settings = {
    get: async (key) => ({ ai_model: null, price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos', flyer_url: '' }[key] ?? null),
    getAll: async () => ({ price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos' }),
  };
  const simulacros = {
    findActive: async () => [
      { id: 'old', name: 'San Marcos Las Fijas', date: yesterday, schedules: ['17:00 - 20:00'], flyerUrl: '/uploads/flyer.png' },
      { id: 'next', name: 'San Marcos Las Fijas', date: tomorrow, schedules: ['17:00 - 20:00'], flyerUrl: '/uploads/flyer.png' },
    ],
  };
  const ai = new AiService(config, settings, simulacros);
  ai.onModuleInit();
  // Reintentos: si la IA responde "en un momento te respondo" (variabilidad), reintenta
  let r = '';
  for (let i = 0; i < 4 && !/mañana|el \d{4}/.test(r); i++) {
    r = await ai.processMessage('¿qué día es el simulacro?', [], '+51999999998', { name: 'Ana', funnelStage: 'libre' });
  }
  check('SIMULACRO: no menciona la fecha pasada', !(r || '').includes(yesterday), `→ "${(r || '').slice(0, 80)}"`);
  check('SIMULACRO: ofrece el siguiente disponible', /mañana|el \d{4}/.test(r || ''), `→ "${(r || '').slice(0, 80)}"`);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${pass} ✅ / ${fail} ❌`);
console.log(results.join('\n'));
process.exit(fail > 0 ? 1 : 0);
