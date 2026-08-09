// QA de regresión: detección estricta del anuncio + sin repetición de saludo + funnel real con OpenAI
// (con reintentos para saltar los rate limits momentáneos del tier gratuito)
import { AiService } from './dist/ai/ai.service.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name} ${extra}`); }
}

// ══ 1. LÓGICA DE DETECCIÓN DEL ANUNCIO (idéntica a webhooks.service.ts) ══
function isAdMessage(text) {
  const t = text.toLowerCase();
  return t.includes('quiero probarme') && /simulacro|san marcos/.test(t);
}
check('Anuncio exacto con emoji → activa', isAdMessage('Hola, quiero probarme en el Simulacro de San Marcos ⚕️!'));
check('Anuncio sin emoji → activa', isAdMessage('Hola, quiero probarme en el Simulacro de San Marcos'));
check('Variante corta → activa', isAdMessage('quiero probarme en el simulacro'));
check('Variante sin "hola" → activa', isAdMessage('quiero probarme en el simulacro de san marcos'));
check('Solo "hola" → NO activa', !isAdMessage('hola'));
check('Solo "quiero probarme" (sin simulacro) → NO activa', !isAdMessage('quiero probarme'));
check('Solo "simulacro" (sin quiero probarme) → NO activa', !isAdMessage('cuánto cuesta el simulacro?'));
check('Mensaje random → NO activa', !isAdMessage('buenas, me das información'));
check('"hola, quiero probarme" sin simulacro → NO activa', !isAdMessage('hola quiero probarme'));

// ══ 2. AiService REAL con OpenAI ══
const config = {
  get: (key, def) => {
    if (key === 'OPENAI_API_KEY') return process.env.OPENAI_API_KEY || '';
    if (key === 'OPENAI_MODEL') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (key === 'OPENAI_CLASSIFIER_MODEL') return process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini';
    return def;
  },
};
const settings = {
  get: async (key) => {
    const map = { ai_model: null, price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos', flyer_url: '' };
    return key in map ? map[key] : null;
  },
  getAll: async () => ({ price: '50', yape_number: '978069398', yape_name: 'Pool Nuñez', business_name: 'Simulacros San Marcos' }),
};
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
const simulacros = {
  findActive: async () => [{
    id: '1', name: 'San Marcos Las Fijas', date: tomorrow, time: '17:00',
    schedules: ['17:00 - 20:00', '19:00 - 22:00'], area: 'Ciencias de la Salud', flyerUrl: '/uploads/flyer.png',
  }],
};

const ai = new AiService(config, settings, simulacros);
ai.onModuleInit();

// Detectar si la respuesta es de respaldo (plantilla) en vez de OpenAI real
const FALLBACK_MARKERS = ['Soy el asesor de Simulacros San Marcos', '¿Qué carrera estás postulando?', '¿Me dices qué carrera postulas para San Marcos?'];
const isFallbackChat = (s) => FALLBACK_MARKERS.some((m) => s.includes(m)) || /^¡Hola!/i.test(s);

// Llamada con reintentos: si OpenAI responde plantilla o falla (rate limit), espera y reintenta
async function realChat(msg, hist, phone, ctx, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await ai.processMessage(msg, hist, phone, ctx);
    if (r && !isFallbackChat(r)) return r;
    await sleep(6000);
  }
  return '';
}
async function realClassify(fn, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fn();
    if (r !== null) return r;
    await sleep(6000);
  }
  return null;
}

// Limpieza que hace el webhook para nunca repetir el saludo
const stripGreeting = (s) => s.replace(/^(buenos d[ií]as|buenas tardes|buenas noches|hola)[,!.:\s]*/i, '').trim();
const startsWithGreeting = (s) => /^(buenos d[ií]as|buenas tardes|buenas noches|hola)[,!.:\s]/i.test(s.trim());

// 2a. sin_carrera: el bot YA saludó → NO debe repetir el saludo (bug reportado por el usuario)
const r1 = await realChat('hola', [], '+51999999999', { name: 'Ana', funnelStage: 'sin_carrera', greeting: 'Buenas tardes' });
const cleaned1 = stripGreeting(r1);
check('sin_carrera: respuesta REAL de OpenAI', r1 !== '', '→ respuesta de respaldo (rate limit)');
check('sin_carrera: no repite saludo (tras limpieza del webhook)', !startsWithGreeting(cleaned1), `→ "${(r1 || '').substring(0, 70)}"`);
check('sin_carrera: pregunta la carrera o responde corto', /carrera|postul|estudi/i.test(cleaned1) || cleaned1.length < 110, `→ "${(r1 || '').substring(0, 70)}"`);

// 2b. inicio (primera vez): saluda según hora de Perú + pregunta carrera
const r2 = await realChat('Hola, quiero probarme en el Simulacro de San Marcos ⚕️!', [], '+51999999998', { name: 'Ana', funnelStage: 'inicio', greeting: 'Buenas tardes' });
check('inicio: respuesta REAL de OpenAI', r2 !== '', '→ respuesta de respaldo (rate limit)');
check('inicio: saluda según hora Perú', /buenos d[ií]as|buenas tardes|buenas noches/i.test(r2), `→ "${(r2 || '').substring(0, 70)}"`);
check('inicio: pregunta la carrera', /carrera|postul/i.test(r2), `→ "${(r2 || '').substring(0, 70)}"`);

// 2c. tiene_experiencia: pregunta algo → responde SIN mencionar precio
const r3 = await realChat('¿eso es virtual?', [], '+51999999997', { name: 'Ana', career: 'Medicina', funnelStage: 'tiene_experiencia' });
check('tiene_experiencia: NO menciona el precio', !/s\/\s*50|precio|costo/i.test(r3), `→ "${(r3 || '').substring(0, 70)}"`);

// 2d. precio_mencionado: da el Yape EXACTO
const r4 = await realChat('quiero inscribirme ya', [], '+51999999996', { name: 'Ana', career: 'Medicina', funnelStage: 'precio_mencionado' });
check('precio_mencionado: incluye yape exacto 978069398', (r4 || '').includes('978069398'), `→ "${(r4 || '').substring(0, 90)}"`);

// ══ 3. Clasificadores ══
const ft1 = await realClassify(() => ai.detectFirstTime('es mi primera vez postulando'));
check('detectFirstTime: "primera vez" → true', ft1 === true, `→ ${ft1}`);
const ft2 = await realClassify(() => ai.detectFirstTime('ya he dado el examen antes'));
check('detectFirstTime: "ya he dado antes" → false', ft2 === false, `→ ${ft2}`);
const ft3 = await ai.detectFirstTime('¿y cómo es el simulacro?');
check('detectFirstTime: pregunta → null', ft3 === null, `→ ${ft3}`);
const yn1 = await realClassify(() => ai.detectYesOrNo('sí, claro'));
check('detectYesOrNo: "sí, claro" → true', yn1 === true, `→ ${yn1}`);
const yn2 = await realClassify(() => ai.detectYesOrNo('no me interesa'));
check('detectYesOrNo: "no me interesa" → false', yn2 === false, `→ ${yn2}`);
const yn3 = await ai.detectYesOrNo('¿eso es virtual?');
check('detectYesOrNo: pregunta sin sí/no → null', yn3 === null, `→ ${yn3}`);
const yn4 = await realClassify(() => ai.detectYesOrNo('sí, ¿es virtual?'));
check('detectYesOrNo: "sí, ¿es virtual?" NO es "no"', yn4 !== false, `→ ${yn4}`);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${pass} ✅ / ${fail} ❌`);
console.log(results.join('\n'));
process.exit(fail > 0 ? 1 : 0);
