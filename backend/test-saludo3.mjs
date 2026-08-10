// Prueba: (1) cliente NUEVO con solo saludo → NO pregunta carrera, ofrece ayuda
// (2) cliente NUEVO con el anuncio → saluda + pregunta carrera
import { AiService } from './dist/ai/ai.service.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const config = { get: (k, d) => ({ OPENAI_API_KEY: process.env.OPENAI_API_KEY || '', OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini', OPENAI_CLASSIFIER_MODEL: 'gpt-4o-mini' }[k] ?? d) };
const settings = { get: async (k) => ({ ai_model: null, price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos', flyer_url: '' }[k] ?? null), getAll: async () => ({ price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos' }) };
const simulacros = { findActive: async () => [{ id: '1', name: 'San Marcos Las Fijas', date: '2026-08-10', schedules: ['10:00 - 13:00', '17:00 - 20:00'], flyerUrl: '/uploads/flyer.png', area: 'Ciencias' }] };
const ai = new AiService(config, settings, simulacros); ai.onModuleInit();
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name} ${extra}`); } }

async function chat(msg, ctx, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await ai.processMessage(msg, [], '+51999999999', ctx);
    if (r && !/^¡Hola!/.test(r)) return r;
    await sleep(4000);
  }
  return '';
}

// 1) Nuevo, solo saludo (NO anuncio) → NO pregunta carrera
const r1 = await chat('hola', { name: 'Ana', funnelStage: 'inicio', greeting: 'Buenas tardes', isAdMessage: false });
const noCarrera = !/¿A qué carrera postulas\?|¿Qué carrera/.test(r1);
check('saludo nuevo: responde saludo', /buenas tardes|buenos d[ií]as|hola|buenas noches/i.test(r1), `→ "${r1.slice(0, 90)}"`);
check('saludo nuevo: NO pregunta carrera', noCarrera, `→ "${r1.replace(/\|\|/g, ' || ').slice(0, 90)}"`);
check('saludo nuevo: ofrece ayuda', /ayud|consult|puedo|estoy para/i.test(r1), `→ "${r1.slice(0, 90)}"`);
console.log(`   → "${r1.replace(/\|\|/g, ' || ').slice(0, 110)}"\n`);

// 2) Nuevo, anuncio → saluda + pregunta carrera
const r2 = await chat('Hola, quiero probarme en el Simulacro de San Marcos🧑⚕️!', { name: 'Ana', funnelStage: 'inicio', greeting: 'Buenas tardes', isAdMessage: true });
check('anuncio: responde saludo', /buenas tardes|buenos d[ií]as|hola|buenas noches/i.test(r2), `→ "${r2.slice(0, 90)}"`);
check('anuncio: pregunta carrera', /carrera|postul/i.test(r2), `→ "${r2.slice(0, 90)}"`);
console.log(`   → "${r2.replace(/\|\|/g, ' || ').slice(0, 110)}"\n`);

console.log(`RESULTADO: ${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
