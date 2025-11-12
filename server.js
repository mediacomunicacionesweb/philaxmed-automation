// server.js - Versión con CACHE en memoria + campos de compatibilidad
const express = require('express');
const cors = require('cors');
const puppeteerCore = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browser = null;
let requestCount = 0;
let isProcessing = false;
const requestQueue = [];

const AGENDAS = {
  kineyfisio: 'https://web.philaxmed.cl/ReservaOnline.html?mc=kineyfisio#_',
  cesmed: 'https://s2.philaxmed.cl/ReservaOnline.html?mc=cesmed#_'
};

// -------------------- HELPERS --------------------
function now() { return new Date().toISOString(); }
function log(...args) { console.log(`[${now()}]`, ...args); }

function normalizeStringNode(s) {
  if (!s) return '';
  try {
    return String(s)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  } catch (e) {
    return String(s).toLowerCase().trim();
  }
}

async function getBrowser() {
  if (browser && requestCount >= 6) {
    log('🔄 Reiniciando navegador para liberar memoria (threshold alcanzado)...');
    try { await browser.close(); } catch (e) {}
    browser = null;
    requestCount = 0;
  }

  if (!browser) {
    try {
      log('🚀 Iniciando navegador...');
      browser = await puppeteerCore.launch({
        args: [
          ...chromium.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote'
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      log('✅ Navegador iniciado');
    } catch (error) {
      console.error('❌ Error al iniciar navegador:', error);
      throw error;
    }
  }
  return browser;
}

// -------------------- SIMPLE CACHE EN MEMORIA (para demo) --------------------
const CACHE = {
  especialidades: { ts:0, ttl: 1000*60*5, data: null },      // 5 min
  profesionales: {}, // map: key = agenda|especialidad -> { ts, ttl, data }
  horas: {}          // map: key = agenda|especialidad|profesional -> { ts, ttl, data }
};

function nowTs(){ return Date.now(); }

function getCache({ type, key, ttl }) {
  if (type === 'especialidades') {
    const c = CACHE.especialidades;
    if (c.data && (nowTs() - c.ts) < (ttl || c.ttl)) return c.data;
    return null;
  } else if (type === 'profesionales') {
    const c = CACHE.profesionales[key];
    if (c && (nowTs() - c.ts) < (ttl || c.ttl)) return c.data;
    return null;
  } else if (type === 'horas') {
    const c = CACHE.horas[key];
    if (c && (nowTs() - c.ts) < (ttl || c.ttl)) return c.data;
    return null;
  }
  return null;
}

function setCache({ type, key, ttl }, data) {
  if (type === 'especialidades') {
    CACHE.especialidades = { ts: nowTs(), ttl: ttl || CACHE.especialidades.ttl, data };
  } else if (type === 'profesionales') {
    CACHE.profesionales[key] = { ts: nowTs(), ttl: ttl || (1000*60*5), data };
  } else if (type === 'horas') {
    CACHE.horas[key] = { ts: nowTs(), ttl: ttl || (1000*30), data };
  }
}

// -------------------- COLA DE PETICIONES --------------------
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  const { handler, resolve, reject } = requestQueue.shift();
  try {
    const result = await handler();
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    isProcessing = false;
    setTimeout(processQueue, 1500);
  }
}

function queueRequest(handler) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ handler, resolve, reject });
    processQueue();
  });
}

// -------------------- PUPPETEER UTILITIES --------------------
async function clickButtonByText(page, text, timeout = 20000) {
  try {
    const textLower = String(text).toLowerCase();
    const xpath = `//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${textLower}')] | //a[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${textLower}')]`;
    await page.waitForXPath(xpath, { timeout });
    const [el] = await page.$x(xpath);
    if (el) {
      await el.evaluate(e => e.scrollIntoView({ behavior: 'auto', block: 'center' }));
      await el.click();
      return true;
    }
  } catch (e) {
    try {
      const clicked = await page.evaluate((t) => {
        const norm = (s) => String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
        const el = Array.from(document.querySelectorAll('button, a')).find(b => norm(b.textContent).includes(norm(t)));
        if (el) {
          el.scrollIntoView({behavior: 'auto', block:'center'});
          el.click();
          return true;
        }
        return false;
      }, text);
      return clicked;
    } catch (e2) {}
  }
  return false;
}

async function clickElementInSelectorByText(page, selector, text, timeout = 20000) {
  try {
    const tNorm = normalizeStringNode(text);
    await page.waitForSelector(selector, { timeout });
    const clicked = await page.evaluate((sel, tNorm) => {
      function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
      const elements = Array.from(document.querySelectorAll(sel));
      const target = elements.find(el => {
        const title = el.getAttribute('title') || '';
        const txt = el.textContent || '';
        return n(title) === tNorm || n(txt) === tNorm || n(txt).includes(tNorm);
      });
      if (target) {
        const clickable = target.querySelector('button, a') || target;
        clickable.scrollIntoView({behavior: 'auto', block:'center'});
        clickable.click();
        return true;
      }
      return false;
    }, selector, tNorm);
    return clicked;
  } catch (e) {
    return false;
  }
}

// -------------------- ENDPOINTS --------------------

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Philaxmed Multi-Agenda Automation',
    requestCount: requestCount,
    queueLength: requestQueue.length
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Philaxmed Multi-Agenda API',
    version: '4.2.0',
    agendas: Object.keys(AGENDAS),
    endpoints: {
      health: '/health',
      especialidades: '/api/especialidades?agenda=kineyfisio',
      profesionales: '/api/profesionales?agenda=kineyfisio&especialidad=KINESIOLOGÍA',
      horas: '/api/horas?agenda=kineyfisio&especialidad=KINESIOLOGÍA&profesional=NOMBRE'
    },
    status: 'running',
    queue: requestQueue.length
  });
});

// -------------------- ESPECIALIDADES --------------------

app.get('/api/especialidades', async (req, res) => {
  const { agenda } = req.query;
  if (!agenda || !AGENDAS[agenda]) {
    return res.status(400).json({ success:false, error:'Agenda no válida. Opciones: ' + Object.keys(AGENDAS).join(', ') });
  }

  // cache check
  const cached = getCache({ type:'especialidades' });
  if (cached) {
    log('♻️ /api/especialidades - returning cached result');
    return res.json(cached);
  }

  try {
    const result = await queueRequest(async () => {
      const startTs = Date.now();
      log(`📋 Obteniendo especialidades de ${agenda}...`);

      const browserInstance = await getBrowser();
      const page = await browserInstance.newPage();

      try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
        await page.setViewport({ width: 1200, height: 900 });
      } catch (e) {}

      page.on('console', msg => { try{ console.log('PAGE LOG>', msg.type(), msg.text()); }catch(e){} });
      page.on('pageerror', err => { console.log('PAGE ERROR>', err && err.stack ? err.stack : String(err)); });
      page.on('requestfailed', req => { const f = req.failure && req.failure(); console.log('REQUEST FAILED>', req.url(), f && f.errorText); });

      try {
        await page.goto(AGENDAS[agenda], { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.cellWidget, .especialidad, .service-item', { timeout: 20000 }).catch(()=>{});
        await clickButtonByText(page, 'reservar hora').catch(()=>{});
        await page.waitForTimeout(600);
        await clickButtonByText(page, 'por especialidad').catch(()=>{});
        await page.waitForTimeout(800);
        await page.waitForSelector('.cellWidget', { timeout: 20000 }).catch(()=>{});

        const especialidades = await page.evaluate(() => {
          const especialidadesData = [];
          const elems = Array.from(document.querySelectorAll('.cellWidget, .especialidad, .service-item, .item'));
          elems.forEach(cell => {
            const text = (cell.textContent || '').trim();
            const title = cell.getAttribute('title') || '';
            if (text && text.length > 3) {
              especialidadesData.push({ text: title || text, value: title || text });
            }
          });
          if (especialidadesData.length === 0) {
            const lines = (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
            lines.forEach(l => {
              if (l.length > 4 && !/reservar|especialidad|por especialidad/i.test(l)) {
                especialidadesData.push({ text: l, value: l });
              }
            });
          }
          return especialidadesData;
        });

        log('DEBUG especialidades raw', JSON.stringify(especialidades));

        const especialidades_list = especialidades.map(e => e.text || e.value || JSON.stringify(e));
        const especialidades_text = especialidades_list.map((s,i) => `${i+1}. ${s}`).join('\n');

        requestCount++;
        log(`✅ Encontradas ${especialidades.length} especialidades - tiempo: ${Date.now() - startTs} ms`);

        const responseObj = {
          success: true,
          agenda: agenda,
          total: especialidades.length,
          // claves principales: strings para compatibilidad
          especialidades: especialidades_list,
          especialidades_objects: especialidades,
          especialidades_text: especialidades_text,
          // compatibilidad extra
          especialidades_values: especialidades_list,
          especialidades_raw: JSON.stringify(especialidades)
        };

        // set cache
        setCache({ type:'especialidades' }, responseObj);
        return responseObj;
      } finally {
        try { await page.close(); } catch (e) {}
      }
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Error al obtener especialidades:', error);
    res.status(500).json({ success:false, error: error.message });
  }
});

// -------------------- PROFESIONALES --------------------

app.get('/api/profesionales', async (req, res) => {
  const { agenda, especialidad } = req.query;
  if (!agenda || !AGENDAS[agenda]) {
    return res.status(400).json({ success:false, error:'Agenda no válida' });
  }
  if (!especialidad) {
    return res.status(400).json({ success:false, error:'Especialidad es requerida' });
  }

  const cacheKey = `${agenda}|${especialidad}`;
  const cached = getCache({ type:'profesionales', key: cacheKey });
  if (cached) {
    log('♻️ /api/profesionales - returning cached result for', cacheKey);
    return res.json(cached);
  }

  try {
    const result = await queueRequest(async () => {
      const startTs = Date.now();
      log(`👨‍⚕️ Obteniendo profesionales de ${agenda} para: ${especialidad}`);

      const browserInstance = await getBrowser();
      const page = await browserInstance.newPage();

      try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
        await page.setViewport({ width: 1200, height: 900 });
      } catch (e) {}

      page.on('console', msg => { try{ console.log('PAGE LOG>', msg.type(), msg.text()); }catch(e){} });
      page.on('pageerror', err => { console.log('PAGE ERROR>', err && err.stack ? err.stack : String(err)); });
      page.on('requestfailed', req => { const f = req.failure && req.failure(); console.log('REQUEST FAILED>', req.url(), f && f.errorText); });

      try {
        await page.goto(AGENDAS[agenda], { waitUntil: 'domcontentloaded', timeout: 60000 });
        await clickButtonByText(page, 'reservar hora').catch(()=>{});
        await page.waitForTimeout(600);
        await clickButtonByText(page, 'por especialidad').catch(()=>{});
        await page.waitForTimeout(800);

        const clickedEspecialidad = await clickElementInSelectorByText(page, '.cellWidget, .especialidad, .service-item', especialidad);
        if (!clickedEspecialidad) {
          const tried = await page.evaluate((esp) => {
            function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
            const txt = n(esp);
            const all = Array.from(document.querySelectorAll('div, li, span, button, a'));
            const el = all.find(e => n(e.textContent || '').includes(txt));
            if (el) {
              const clickable = el.querySelector('button, a') || el;
              clickable.scrollIntoView({behavior: 'auto', block:'center'});
              clickable.click();
              return true;
            }
            return false;
          }, especialidad);
          if (!tried) return { success:false, error:'No se pudo seleccionar la especialidad' };
        }

        await page.waitForTimeout(1200);
        log(`⏱ after select especialidad: ${Date.now() - startTs} ms`);

        const profesionales = await page.evaluate(() => {
          const profesionalesData = [];
          const bodyText = document.body.innerText || '';
          const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/especialidad[:\s]/i.test(line) && i > 0) {
              const nombre = lines[i - 1] || '';
              if (nombre && nombre.length > 3 && !/especialidad|seleccione/i.test(nombre)) {
                profesionalesData.push({ nombre: nombre, value: nombre });
              }
            }
          }
          if (profesionalesData.length === 0) {
            const possible = Array.from(document.querySelectorAll('.profesional, .medico, .practitioner, .list-item, .item'));
            possible.forEach(el => {
              const txt = el.textContent || '';
              if (txt && txt.length > 5) {
                const first = txt.split('\n').map(l=>l.trim()).filter(Boolean)[0] || txt;
                profesionalesData.push({ nombre: first, value: first });
              }
            });
          }
          const seen = new Set();
          const unique = [];
          profesionalesData.forEach(p => {
            const key = (p.nombre || p.value || '').trim();
            if (key && !seen.has(key)) {
              seen.add(key);
              unique.push({ nombre: key, value: key, especialidad: p.especialidad || '' });
            }
          });
          return unique;
        });

        log('DEBUG profesionales raw', JSON.stringify(profesionales));

        const profesionales_list = profesionales.map(p => p.nombre || p.value || JSON.stringify(p));
        const profesionales_text = profesionales_list.map((s, i) => `${i+1}. ${s}`).join('\n');

        requestCount++;
        log(`✅ Encontrados ${profesionales.length} profesionales - tiempo: ${Date.now() - startTs} ms`);

        const responseObj = {
          success: true,
          agenda: agenda,
          especialidad: especialidad,
          total: profesionales.length,
          profesionales: profesionales_list,
          profesionales_objects: profesionales,
          profesionales_text: profesionales_text,
          // compatibilidad extra
          profesionales_values: profesionales_list,
          profesionales_raw: JSON.stringify(profesionales)
        };

        setCache({ type:'profesionales', key: cacheKey }, responseObj);
        return responseObj;
      } finally {
        try { await page.close(); } catch (e) {}
      }
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Error al obtener profesionales:', error);
    res.status(500).json({ success:false, error: error.message });
  }
});

// -------------------- HORAS --------------------

app.get('/api/horas', async (req, res) => {
  const { agenda, especialidad, profesional, fecha } = req.query;
  if (!agenda || !AGENDAS[agenda]) {
    return res.status(400).json({ success:false, error:'Agenda no válida' });
  }
  if (!especialidad || !profesional) {
    return res.status(400).json({ success:false, error:'Especialidad y profesional son requeridos' });
  }

  const cacheKey = `${agenda}|${especialidad}|${profesional}`;
  const cached = getCache({ type:'horas', key: cacheKey });
  if (cached) {
    log('♻️ /api/horas - returning cached result for', cacheKey);
    return res.json(cached);
  }

  try {
    const result = await queueRequest(async () => {
      const startTs = Date.now();
      log(`📅 Obteniendo horas de ${agenda} para: ${profesional} (especialidad: ${especialidad})`);

      const browserInstance = await getBrowser();
      const page = await browserInstance.newPage();

      try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
        await page.setViewport({ width: 1200, height: 900 });
      } catch (e) {}

      // Try to reduce load
      try { await page.setRequestInterception(true); } catch (e) {}
      let lastXHR = null;

      page.on('console', msg => { try{ console.log('PAGE LOG>', msg.type(), msg.text()); }catch(e){} });
      page.on('pageerror', err => { console.log('PAGE ERROR>', err && err.stack ? err.stack : String(err)); });
      page.on('requestfailed', req => { const f = req.failure && req.failure(); console.log('REQUEST FAILED>', req.url(), f && f.errorText); });

      page.on('request', req => {
        try {
          const url = req.url().toLowerCase();
          const rtype = req.resourceType();
          if (rtype === 'image' || rtype === 'media' || rtype === 'font' ||
              /(\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|\.mp4|\.mp3)$/i.test(url)) {
            try { req.abort(); return; } catch(e) {}
          }
        } catch (e) {}
        try { req.continue(); } catch (e) {}
      });

      page.on('response', async (response) => {
        try {
          const req = response.request();
          const url = response.url();
          const urlLow = url.toLowerCase();
          const headers = response.headers ? (response.headers()['content-type'] || response.headers()['Content-Type'] || '') : '';
          let json = null;
          if ((headers && headers.toLowerCase().includes('application/json')) || urlLow.includes('/api/') || urlLow.includes('/application')) {
            json = await response.json().catch(() => null);
            if (json) {
              console.log('DEBUG horas raw', JSON.stringify({ url, body: json }));
              lastXHR = { url, json, text: null };
            } else {
              const txt = await response.text().catch(() => null);
              if (txt) {
                const sample = txt.length > 20000 ? txt.slice(0,20000) + '...[truncated]' : txt;
                console.log('DEBUG horas raw-text', JSON.stringify({ url, body: sample }));
                lastXHR = { url, json: null, text: txt };
              }
            }
          } else {
            if (urlLow.includes('/onlinebooking/application')) {
              const txt = await response.text().catch(() => '');
              const sample = txt.length > 20000 ? txt.slice(0,20000) + '...[truncated]' : txt;
              console.log('DEBUG horas-application', JSON.stringify({ url, sample }));
              lastXHR = { url, json: null, text: txt };
            } else if (/hora|horas|slot|available|availability|getavailable|reserva|agenda|timeslot|getslots|disponible/.test(urlLow)) {
              const txt = await response.text().catch(() => null);
              if (txt) {
                const sample = txt.length > 20000 ? txt.slice(0,20000) + '...[truncated]' : txt;
                console.log('DEBUG horas raw-text (interesting)', JSON.stringify({ url, body: sample }));
                lastXHR = { url, json: null, text: txt };
              }
            }
          }
        } catch (e) {}
      });

      try {
        await page.goto(AGENDAS[agenda], { waitUntil: 'domcontentloaded', timeout: 60000 });
        await clickButtonByText(page, 'reservar hora').catch(()=>{});
        await page.waitForTimeout(600);
        await clickButtonByText(page, 'por especialidad').catch(()=>{});
        await page.waitForTimeout(800);

        let clickedEspecialidad = await clickElementInSelectorByText(page, '.cellWidget, .especialidad, .service-item', especialidad);
        if (!clickedEspecialidad) {
          const tried = await page.evaluate((esp) => {
            function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
            const txt = n(esp);
            const all = Array.from(document.querySelectorAll('div, li, span, button, a'));
            const el = all.find(e => n(e.textContent || '').includes(txt));
            if (el) {
              const clickable = el.querySelector('button, a') || el;
              clickable.scrollIntoView({behavior: 'auto', block:'center'});
              clickable.click();
              return true;
            }
            return false;
          }, especialidad);
          if (!tried) return { success:false, error:'No se pudo seleccionar la especialidad' };
        }

        await page.waitForTimeout(1200);

        const profNorm = normalizeStringNode(profesional);
        const clickedProfesional = await page.evaluate((profNorm) => {
          function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
          const candidates = Array.from(document.querySelectorAll('div, li, span, button, a')).filter(el => {
            const t = (el.textContent || '').trim();
            return t && n(t).includes(profNorm);
          });
          if (candidates.length === 0) return false;
          let chosen = candidates.find(c => /especialidad[:\s]/i.test(c.textContent)) || candidates[0];
          try {
            const clickable = chosen.querySelector('button, a') || chosen;
            clickable.scrollIntoView({behavior: 'auto', block: 'center'});
            clickable.click();
            return true;
          } catch (e) {
            try { chosen.click(); return true; } catch (e2) { return false; }
          }
        }, profNorm);

        if (!clickedProfesional) {
          log('⚠️ No se pudo seleccionar el profesional por click directo. Intentando fallback por índice.');
          const fallback = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('div, li, .list-item, .profesional, .medico'));
            const el = all[0];
            if (!el) return false;
            const clickable = el.querySelector('button, a') || el;
            clickable.scrollIntoView({behavior:'auto', block:'center'});
            clickable.click();
            return true;
          });
          if (!fallback) return { success:false, error:'No se pudo seleccionar el profesional' };
        }

        await page.waitForTimeout(1200);

        // Wait for application response and/or DOM pattern HH:MM
        try {
          await page.waitForResponse(
            r => (r.url().toLowerCase().includes('/onlinebooking/application') || r.url().toLowerCase().includes('/application')) && r.status() === 200,
            { timeout: 60000 }
          );
          log('ℹ️ Capturada response /onlineBooking/application (waitForResponse)');
        } catch (e) {
          log('⚠️ Timeout esperando /onlineBooking/application response (waitForResponse)');
        }

        try {
          await page.waitForFunction(
            () => /\b\d{1,2}:\d{2}\b/.test(document.body.innerText),
            { timeout: 60000 }
          );
          log('ℹ️ Detectado patrón HH:MM en el DOM (waitForFunction)');
        } catch (e) {
          log('⚠️ Timeout esperando patrón HH:MM en el DOM (waitForFunction)');
        }

        // Try extract times from intercepted XHR
        function findTimesInObject(o, results = []) {
          if (!o) return results;
          if (Array.isArray(o)) {
            o.forEach(item => {
              if (typeof item === 'string') {
                const m = item.match(/\d{1,2}:\d{2}/);
                if (m) results.push(m[0]);
              } else if (typeof item === 'object') {
                for (const k of ['time','hora','start','slot','hour','available','schedule','timeSlot','availableTime']) {
                  if (item[k]) {
                    if (typeof item[k] === 'string') {
                      const m = item[k].match(/\d{1,2}:\d{2}/);
                      if (m) results.push(m[0]);
                    }
                  }
                }
                findTimesInObject(item, results);
              }
            });
          } else if (typeof o === 'object') {
            Object.values(o).forEach(v => findTimesInObject(v, results));
          }
          return results;
        }

        let horasFromXHR = [];
        if (lastXHR && lastXHR.json) {
          try {
            horasFromXHR = findTimesInObject(lastXHR.json, []);
            if (horasFromXHR && horasFromXHR.length > 0) {
              log('ℹ️ USING XHR JSON for horas, found', horasFromXHR.length);
            } else {
              log('ℹ️ lastXHR captured but no direct time strings found. lastXHR.url=', lastXHR.url);
            }
          } catch (e) {
            log('WARN: error processing lastXHR json', e && e.message);
          }
        } else if (lastXHR && lastXHR.text && lastXHR.url && lastXHR.url.toLowerCase().includes('/onlinebooking/application')) {
          try {
            const m = lastXHR.text.match(/\d{1,2}:\d{2}/g);
            if (m) horasFromXHR = Array.from(new Set(m));
            if (horasFromXHR.length > 0) {
              log('ℹ️ USING application TEXT for horas, found', horasFromXHR.length);
            }
          } catch (e) {}
        }

        let uniqueHoras = [];
        if (horasFromXHR && horasFromXHR.length > 0) {
          const seen = new Set();
          horasFromXHR.forEach(h => {
            const key = h;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueHoras.push({ hora: key, estado: 'DESCONOCIDO' });
            }
          });
        } else {
          const horas = await page.evaluate(() => {
            const horasData = [];
            const bodyText = document.body.innerText || '';
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
            const regex = /(?:^|\s)(\d{1,2}:\d{2})(?:\s*[-–—]?\s*(DISPONIBLE|OCUPADO|RESERVADO)?)?/i;
            for (const line of lines) {
              const m = line.match(regex);
              if (m) {
                const hora = m[1];
                const estadoRaw = (m[2] || '').toUpperCase();
                const estado = estadoRaw === 'OCUPADO' ? 'OCUPADO' : (estadoRaw === 'DISPONIBLE' ? 'DISPONIBLE' : 'DESCONOCIDO');
                const disponible = estado === 'DISPONIBLE' || (estado === 'DESCONOCIDO' && !/OCUPADO/i.test(line));
                horasData.push({ hora: hora, disponible: disponible, estado: estado });
              }
            }
            return horasData;
          });
          const horasDisponibles = (horas || []).filter(h => h.disponible).map(h => ({ hora: h.hora, estado: h.estado }));
          const seen = new Set();
          for (const h of horasDisponibles) {
            const key = h.hora;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueHoras.push(h);
            }
          }
        }

        requestCount++;
        log(`✅ Encontradas ${uniqueHoras.length} horas disponibles - tiempo total handler: ${Date.now() - startTs} ms`);

        const horas_list = uniqueHoras.map(h => h.hora || String(h));
        const horas_text = horas_list.map((s,i) => `${i+1}. ${s}`).join('\n');

        const responseObj = {
          success: true,
          agenda: agenda,
          especialidad: especialidad,
          profesional: profesional,
          fecha: fecha || new Date().toISOString().split('T')[0],
          horas: horas_list,
          horas_objects: uniqueHoras,
          horas_text: horas_text,
          total: uniqueHoras.length,
          // compatibilidad extra
          horas_values: horas_list,
          horas_raw: JSON.stringify(uniqueHoras)
        };

        setCache({ type:'horas', key: cacheKey, ttl: 1000*60 }, responseObj); // cache 60s por defecto
        return responseObj;
      } finally {
        try { await page.close(); } catch (e) {}
      }
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Error al obtener horas:', error);
    res.status(500).json({ success:false, error:error.message });
  }
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  log(`🚀 Servidor corriendo en puerto ${PORT}`);
  log(`📋 Agendas disponibles: ${Object.keys(AGENDAS).join(', ')}`);
});

process.on('SIGINT', async () => {
  if (browser) {
    try { await browser.close(); } catch (e) {}
  }
  process.exit();
});
