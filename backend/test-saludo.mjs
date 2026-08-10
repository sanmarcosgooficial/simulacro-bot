// Prueba: saludo solo → saludo corto; pregunta específica → info real
import { AiService } from './dist/ai/ai.service.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const simulacros = {
  findActive: async () => [{ id: '1', name: 'San Marcos Las Fijas', date: tomorrow, schedules: ['17:00 - 20:00'], flyerUrl: '/uploads/flyer.png', area: 'Ciencias' }],
};
const ai = new AiService(config, settings, simulacros);
ai.onModuleInit();

let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name} ${extra}`); } }

async function realChat(msg, hist, phone, ctx, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await ai.processMessage(msg, hist, phone, ctx);
    if (r && !/^¡Hola!/.test(r)) return r;
    await sleep(5000);
  }
  return '';
}

// 1) Solo saludo → debe responder saludo corto, SIN precio ni horarios
const r1 = await realChat('buenas tardes', [], '+51999999991', { name: 'Ana', funnelStage: 'libre' });
check('saludo: responde algo', r1.length > 0, '→ respaldo');
check('saludo: es un saludo corto', /buenas tardes|buenos d[ií]as|hola|buenas noches/i.test(r1), `→ "${r1.slice(0, 80)}"`);
check('saludo: NO adelanta precio/horarios', !/s\/\s*50|precio|cuesta|de \d a \d|horario/i.test(r1), `→ "${r1.slice(0, 80)}"`);
console.log(`   → "${r1.replace(/\|\|/g, ' || ').slice(0, 100)}"\n`);

// 2) Pregunta específica → sí da info
const r2 = await realChat('¿cuánto cuesta?', [], '+51999999992', { name: 'Ana', career: 'Medicina', funnelStage: 'libre' });
check('pregunta: responde el precio', /s\/\s*50|50/.test(r2), `→ "${r2.slice(0, 80)}"`);
console.log(`   → "${r2.replace(/\|\|/g, ' || ').slice(0, 100)}"\n`);

// 3) Pregunta específica horarios → da horarios
const r3 = await realChat('¿qué horarios hay?', [], '+51999999993', { name: 'Ana', career: 'Medicina', funnelStage: 'libre' });
check('pregunta: responde horarios', /de \d|horario|mañana/i.test(r3), `→ "${r3.slice(0, 80)}"`);
console.log(`   → "${r3.replace(/\|\|/g, ' || ').slice(0, 100)}"\n`);

console.log(`RESULTADO: ${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
