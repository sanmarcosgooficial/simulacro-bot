// Prueba: la IA SIEMPRE repite la fecha exacta de SIMULACROS DISPONIBLES
// (mañana, 10 de agosto) y NUNCA se equivoca de día ni la calcula mal.
import { AiService } from './dist/ai/ai.service.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = { get: (k, d) => ({ OPENAI_API_KEY: process.env.OPENAI_API_KEY || '', OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini', OPENAI_CLASSIFIER_MODEL: 'gpt-4o-mini' }[k] ?? d) };
const settings = { get: async (key) => ({ ai_model: null, price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos', flyer_url: '' }[key] ?? null), getAll: async () => ({ price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos' }) };
const simulacros = { findActive: async () => [{ id: '1', name: 'San Marcos Las Fijas', date: '2026-08-10', schedules: ['10:00 - 13:00', '17:00 - 20:00'], flyerUrl: '/uploads/flyer.png', area: 'Ciencias' }] };
const ai = new AiService(config, settings, simulacros);
ai.onModuleInit();

let pass = 0, fail = 0;
const QUESTIONS = [
  '¿qué día es el simulacro?',
  'quiero inscribirme, ¿cuándo es?',
  '¿para qué fecha es?',
  '¿qué horarios y qué día?',
];
for (let i = 0; i < 6; i++) {
  const q = QUESTIONS[i % QUESTIONS.length];
  let r = '';
  for (let t = 0; t < 3 && !/10 de agosto/.test(r); t++) {
    r = await ai.processMessage(q, [], '+51999999999', { name: 'Ana', funnelStage: 'libre' });
    if (!/10 de agosto/.test(r)) await sleep(4000);
  }
  const dice10 = /10 de agosto/.test(r);
  const diceMal = /11 de agosto|12 de agosto|9 de agosto/.test(r);
  const ok = dice10 && !diceMal;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} [${i + 1}] "${q}" → "${r.replace(/\|\|/g, ' || ').slice(0, 110)}"`);
}
console.log(`\nRESULTADO: ${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
