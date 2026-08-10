// Prueba: la IA NO responde temas ajenos → "no entendí" + retoma guion.
// Temas DENTRO del simulacro (precio, modalidad, horarios) SÍ se responden.
// Con reintentos para la variabilidad natural de la IA (temperature 0.6).
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

const OFF = [
  'dame una receta de ceviche',
  'como llego a san isidro',
  'que restaurante me recomiendas',
  'dime un chiste',
  'cuanto cuesta viajar a cusco',
  'resuelveme este ejercicio de matematicas',
];
const ON = [
  ['cuanto cuesta el simulacro', /s\/\s*50|50 soles|precio/i],
  ['es virtual?', /virtual/i],
  ['que horarios hay?', /de \d|horario/i],
];

let pass = 0, fail = 0;
for (const msg of OFF) {
  let r = '', ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    r = await ai.processMessage(msg, [], '+51999999999', { name: 'Ana', funnelStage: 'libre' });
    ok = /no entend[ií]|no te entend[ií]|disculpa/i.test(r);
    if (!ok) await sleep(5000);
  }
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} FUERA: "${msg}" → "${r.replace(/\|\|/g, ' || ').slice(0, 90)}"`);
}
for (const [msg, re] of ON) {
  let r = '', ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    r = await ai.processMessage(msg, [], '+51999999998', { name: 'Ana', career: 'Medicina', funnelStage: 'libre' });
    ok = re.test(r) && !/no entend[ií]/.test(r);
    if (!ok) await sleep(5000);
  }
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} DENTRO: "${msg}" → "${r.replace(/\|\|/g, ' || ').slice(0, 90)}"`);
}
console.log(`\nRESULTADO: ${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
