// PRUEBA: la IA responde a CUALQUIER carrera (no solo "ing civil").
// Simula el flujo del anuncio con 5 carreras distintas y verifica que
// la respuesta del bot menciona la carrera correcta en cada caso.
import { WebhooksService } from './dist/webhooks/webhooks.service.js';
import { AiService } from './dist/ai/ai.service.js';

const CASES = [
  ['medicina humana', /medicina/i],
  ['derecho', /derecho/i],
  ['enfermeria', /enfermer/i],
  ['contabilidad', /contabil/i],
  ['psicologia', /psicolog/i],
];

let pass = 0, fail = 0;

for (const [career, re] of CASES) {
  // ── Mocks frescos por carrera ─────────────────────────────────────
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

  // ── Flujo: anuncio → carrera ──────────────────────────────────────
  await ws.handleIncomingMessage(msg('Hola, quiero probarme en el Simulacro de San Marcos🧑‍⚕️!', 1));
  await ws.handleIncomingMessage(msg(`hola, quiero postular a ${career}`, 2));

  const all = sentTexts.join(' ');
  const ok = re.test(all);
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} "${career}" → ${re.test(all) ? 'RESPONDE BIEN' : 'NO mencionó la carrera'}`);
  console.log(`     Bot: "${all.slice(0, 200).replace(/\|\|/g, ' || ')}"`);
  console.log(`     Carrera en CRM: "${contact.career}"`);
  if (sentImages.length) console.log(`     📸 Flyer enviado: ${sentImages.join(', ')}`);
  console.log('');
}

console.log('════════════════════════════════════════');
console.log(`RESULTADO: ${pass} ✅ / ${fail} ❌`);
process.exit(fail > 0 ? 1 : 0);
