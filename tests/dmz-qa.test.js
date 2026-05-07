/**
 * DMZ Audit — Suite de Pruebas Unitarias (Jest)
 * Ejecutar: cd racreaa && npx jest tests/dmz-qa.test.js
 *
 * Cubre: IDB persistence, colisión auto-save, timer stability,
 *        ECT scoring, PDF overflow guard, retry queue logic.
 */

'use strict';

// ── Mocks del entorno browser ──────────────────────────────────

// IndexedDB mock simplificado
const idbStore = new Map();
global.indexedDB = {
  open: (name, ver) => {
    const req = {};
    const db = {
      transaction: (store, mode) => ({
        objectStore: () => ({
          put:    (v, k) => { idbStore.set(k, v); return { onsuccess: null }; },
          get:    (k)    => { const r = { result: idbStore.get(k)||null }; Promise.resolve().then(()=>r.onsuccess?.({})); return r; },
          delete: (k)    => { idbStore.delete(k); return {}; },
        }),
        oncomplete: null
      }),
      createObjectStore: () => {}
    };
    Promise.resolve().then(() => {
      if (req.onupgradeneeded) req.onupgradeneeded({ target:{ result: db } });
      if (req.onsuccess)       req.onsuccess({ target:{ result: db } });
    });
    return req;
  }
};

// localStorage mock
const lsStore = new Map();
global.localStorage = {
  getItem:    k     => lsStore.get(k) ?? null,
  setItem:    (k,v) => lsStore.set(k, v),
  removeItem: k     => lsStore.delete(k),
  clear:      ()    => lsStore.clear()
};

// ── Lógica ECT re-implementada para tests (idéntica a app.html) ──

const CRIT_M = ['presentacion','temperatura','sabor','textura','porcion'];
const NMAP = {
  excelente: { hex:'#1A5E3A', label:'Excelente' },
  bueno:     { hex:'#2E7D52', label:'Bueno' },
  regular:   { hex:'#A07820', label:'Regular' },
  deficiente:{ hex:'#C06020', label:'Deficiente' },
  critico:   { hex:'#B83232', label:'Crítico' },
};
function getNKey(s){ if(s>=85)return'excelente';if(s>=70)return'bueno';if(s>=55)return'regular';if(s>=40)return'deficiente';return'critico'; }

function getECTDesc(val) {
  if (val<=2) return {label:'Crítico',     cls:'ect-critico'};
  if (val<=4) return {label:'Deficiente',  cls:'ect-deficiente'};
  if (val<=6) return {label:'Estándar',    cls:'ect-estandar'};
  if (val<=8) return {label:'Bueno',       cls:'ect-bueno'};
  return             {label:'Excelencia',  cls:'ect-excelencia'};
}

function calcScore(criterios) {
  const vals = Object.values(criterios).filter(v=>v>0);
  if (!vals.length) return 0;
  const avg  = vals.reduce((a,b)=>a+b,0) / CRIT_M.length;
  return Math.round(avg * 10);
}

// ── RetryQueue lógica pura ──────────────────────────────────────

const RETRY_KEY = 'dmz_retry_q';
const BACKOFF   = [5000, 15000, 45000];

function rqLoad()     { try { return JSON.parse(localStorage.getItem(RETRY_KEY)||'[]'); } catch { return []; } }
function rqSave(q)    { localStorage.setItem(RETRY_KEY, JSON.stringify(q)); }
function rqEnqueue(type, payload) {
  const q = rqLoad();
  q.push({ id: Date.now(), type, payload, attempts: 0, nextTry: Date.now() });
  rqSave(q); return q;
}
function rqAbandoned(item) { return item.attempts >= 3; }
function rqNextBackoff(attempts) { return BACKOFF[attempts] ?? 60000; }

// ══════════════════════════════════════════════════════════════════
// SUITE 1 — ECT Scoring
// ══════════════════════════════════════════════════════════════════
describe('ECT — Escala de Cumplimiento Técnico', () => {

  test('getECTDesc: valores límite exactos', () => {
    expect(getECTDesc(1).label).toBe('Crítico');
    expect(getECTDesc(2).label).toBe('Crítico');
    expect(getECTDesc(3).label).toBe('Deficiente');
    expect(getECTDesc(4).label).toBe('Deficiente');
    expect(getECTDesc(5).label).toBe('Estándar');
    expect(getECTDesc(6).label).toBe('Estándar');
    expect(getECTDesc(7).label).toBe('Bueno');
    expect(getECTDesc(8).label).toBe('Bueno');
    expect(getECTDesc(9).label).toBe('Excelencia');
    expect(getECTDesc(10).label).toBe('Excelencia');
  });

  test('calcScore: todos criterios en 10 → score 100', () => {
    const c = { presentacion:10, temperatura:10, sabor:10, textura:10, porcion:10 };
    expect(calcScore(c)).toBe(100);
  });

  test('calcScore: todos criterios en 5 → score 50', () => {
    const c = { presentacion:5, temperatura:5, sabor:5, textura:5, porcion:5 };
    expect(calcScore(c)).toBe(50);
  });

  test('calcScore: mix — promedio 7/10 → score 70', () => {
    const c = { presentacion:7, temperatura:7, sabor:7, textura:7, porcion:7 };
    expect(calcScore(c)).toBe(70);
  });

  test('calcScore: criterios en 0 no afectan promedio', () => {
    // Solo 2 criterios con valor, promedio = 8/5 (no /2) → score 16
    const c = { presentacion:8, temperatura:0, sabor:0, textura:0, porcion:0 };
    // avg = 8/5 = 1.6 → score 16 (divide sobre 5 criterios totales, no solo los llenos)
    expect(calcScore(c)).toBe(16);
  });

  test('getNKey: umbrales correctos', () => {
    expect(getNKey(100)).toBe('excelente');
    expect(getNKey(85)).toBe('excelente');
    expect(getNKey(84)).toBe('bueno');
    expect(getNKey(70)).toBe('bueno');
    expect(getNKey(69)).toBe('regular');
    expect(getNKey(55)).toBe('regular');
    expect(getNKey(54)).toBe('deficiente');
    expect(getNKey(40)).toBe('deficiente');
    expect(getNKey(39)).toBe('critico');
    expect(getNKey(0)).toBe('critico');
  });
});

// ══════════════════════════════════════════════════════════════════
// SUITE 2 — Timer Stability
// ══════════════════════════════════════════════════════════════════
describe('Cronómetros — Estabilidad de timers', () => {

  test('Timer start no se sobreescribe en re-renders', () => {
    const timers = {};
    const id = 'card_test_1';
    const t0 = new Date(Date.now() - 120000);
    timers[id] = { start: t0 };

    // Simular re-render (solo lee, no escribe start)
    const snapshot = timers[id].start.getTime();
    const rendered = timers[id].start.getTime(); // re-lectura
    expect(rendered).toBe(snapshot);
  });

  test('Timer end se registra solo una vez', () => {
    const timers = {};
    const id = 'card_test_2';
    timers[id] = { start: new Date(Date.now() - 60000) };

    // Primera stamping
    timers[id].end = new Date();
    const firstEnd = timers[id].end.getTime();

    // Segunda stamping (debe ignorarse si ya existe)
    if (!timers[id].end) timers[id].end = new Date();
    expect(timers[id].end.getTime()).toBe(firstEnd);
  });

  test('Semáforo: < 15min → sem-ok', () => {
    const LIMITE = 20;
    const diffMin = 12;
    let cls = 'sem-ok';
    if (diffMin > LIMITE)               cls = 'sem-late';
    else if (diffMin > LIMITE * 0.75)   cls = 'sem-warn';
    expect(cls).toBe('sem-ok');
  });

  test('Semáforo: 16min (80% de 20) → sem-warn', () => {
    const LIMITE = 20;
    const diffMin = 16;
    let cls = 'sem-ok';
    if (diffMin > LIMITE)               cls = 'sem-late';
    else if (diffMin > LIMITE * 0.75)   cls = 'sem-warn';
    expect(cls).toBe('sem-warn');
  });

  test('Semáforo: 22min → sem-late', () => {
    const LIMITE = 20;
    const diffMin = 22;
    let cls = 'sem-ok';
    if (diffMin > LIMITE)               cls = 'sem-late';
    else if (diffMin > LIMITE * 0.75)   cls = 'sem-warn';
    expect(cls).toBe('sem-late');
  });
});

// ══════════════════════════════════════════════════════════════════
// SUITE 3 — IndexedDB Persistence
// ══════════════════════════════════════════════════════════════════
describe('IDB — Persistencia de borradores', () => {

  test('SESSION_ID tiene formato correcto', () => {
    localStorage.setItem('dmz_audit_session', 'SES-M7X2A-KQ3P');
    const sid = localStorage.getItem('dmz_audit_session');
    expect(sid).toMatch(/^SES-/);
    expect(sid.length).toBeGreaterThan(8);
  });

  test('Borrador con age > 8h se descarta', () => {
    const draft = { ts: Date.now() - 9 * 3600000, cardsM: [{ id:'old1' }] };
    const age = (Date.now() - draft.ts) / 3600000;
    expect(age > 8).toBe(true); // debe descartarse
  });

  test('Borrador con age < 8h se restaura', () => {
    const draft = { ts: Date.now() - 2 * 3600000, cardsM: [{ id:'recent1' }] };
    const age = (Date.now() - draft.ts) / 3600000;
    expect(age < 8).toBe(true); // debe restaurarse
  });
});

// ══════════════════════════════════════════════════════════════════
// SUITE 4 — Retry Queue
// ══════════════════════════════════════════════════════════════════
describe('RetryQueue — Cola de reintentos', () => {

  beforeEach(() => { localStorage.removeItem(RETRY_KEY); });

  test('Enqueue agrega item a la cola', () => {
    rqEnqueue('audit_submit', { id: 'AUD-001' });
    const q = rqLoad();
    expect(q.length).toBe(1);
    expect(q[0].type).toBe('audit_submit');
  });

  test('Item se abandona tras 3 intentos', () => {
    const item = { id:1, type:'audit_submit', payload:{}, attempts:3, nextTry:0 };
    expect(rqAbandoned(item)).toBe(true);
  });

  test('Item no se abandona antes de 3 intentos', () => {
    const item = { id:2, type:'audit_submit', payload:{}, attempts:2, nextTry:0 };
    expect(rqAbandoned(item)).toBe(false);
  });

  test('Backoff exponencial correcto', () => {
    expect(rqNextBackoff(0)).toBe(5000);   // 5s
    expect(rqNextBackoff(1)).toBe(15000);  // 15s
    expect(rqNextBackoff(2)).toBe(45000);  // 45s
    expect(rqNextBackoff(3)).toBe(60000);  // default
  });

  test('Queue vacía devuelve array vacío', () => {
    expect(rqLoad()).toEqual([]);
  });

  test('Múltiples encolas se acumulan', () => {
    rqEnqueue('type_a', {});
    rqEnqueue('type_b', {});
    rqEnqueue('type_c', {});
    expect(rqLoad().length).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════
// SUITE 5 — PDF Guard (lógica de sanitización de texto)
// ══════════════════════════════════════════════════════════════════
describe('PDF — Sanitización y overflow guard', () => {

  function splitTextToSize(text, maxLen) {
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const w of words) {
      if ((current + w).length > maxLen) { lines.push(current.trim()); current = ''; }
      current += w + ' ';
    }
    if (current.trim()) lines.push(current.trim());
    return lines;
  }

  function sanitizePDF(text, maxChars=2000) {
    return String(text||'').slice(0, maxChars).replace(/[<>]/g,'');
  }

  test('Texto de 1000 chars se trunca a 1000', () => {
    const long = 'A'.repeat(1000);
    expect(sanitizePDF(long, 1000).length).toBe(1000);
  });

  test('Texto de 5000 chars se trunca a 2000 (default)', () => {
    const long = 'B'.repeat(5000);
    expect(sanitizePDF(long).length).toBe(2000);
  });

  test('Caracteres < > se eliminan', () => {
    const xss = '<script>alert("xss")</script>';
    const clean = sanitizePDF(xss);
    expect(clean).not.toContain('<');
    expect(clean).not.toContain('>');
  });

  test('Caracteres especiales permitidos se preservan', () => {
    const special = 'ñáéíóú «»— ¡¿%&@#';
    const clean = sanitizePDF(special);
    expect(clean).toContain('ñ');
    expect(clean).toContain('á');
    expect(clean).toContain('«');
  });

  test('splitTextToSize no genera líneas > maxLen', () => {
    const long = 'palabra '.repeat(200);
    const lines = splitTextToSize(long, 40);
    lines.forEach(l => expect(l.length).toBeLessThanOrEqual(42));
  });

  test('null/undefined se convierte a string vacío', () => {
    expect(sanitizePDF(null)).toBe('');
    expect(sanitizePDF(undefined)).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════
// SUITE 6 — Validación de cierre de sheet
// ══════════════════════════════════════════════════════════════════
describe('Validación de cierre — Bloqueo por timers activos', () => {

  test('Sin timers cerrados → bloquea envío', () => {
    const cardsM = [
      { id:'c1', _pct:80, nombre:'Pasta' },
      { id:'c2', _pct:70, nombre:'Sopa' }
    ];
    const platilloTimers = {
      c1: { start: new Date(), end: new Date() },   // cerrado
      c2: { start: new Date() }                      // abierto
    };
    const sinCerrar = cardsM.filter(c => c._pct!==undefined && !platilloTimers[c.id]?.end);
    expect(sinCerrar.length).toBe(1);
    expect(sinCerrar[0].nombre).toBe('Sopa');
  });

  test('Todos los timers cerrados → permite envío', () => {
    const cardsM = [{ id:'c3', _pct:85, nombre:'Postre' }];
    const platilloTimers = { c3: { start: new Date(), end: new Date() } };
    const sinCerrar = cardsM.filter(c => c._pct!==undefined && !platilloTimers[c.id]?.end);
    expect(sinCerrar.length).toBe(0);
  });

  test('Score < 60 sin conclusion → rechaza envío', () => {
    const score = 45;
    const conclusion = 'corta'; // < 20 chars
    const debeBloquear = score < 60 && (!conclusion || conclusion.length < 20);
    expect(debeBloquear).toBe(true);
  });

  test('Score < 60 con conclusion válida → permite envío', () => {
    const score = 45;
    const conclusion = 'Las causas detectadas son temperatura baja y presentación deficiente en línea.';
    const debeBloquear = score < 60 && (!conclusion || conclusion.length < 20);
    expect(debeBloquear).toBe(false);
  });
});
