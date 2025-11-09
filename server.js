// server.js - Versión mejorada para Philaxmed Multi-Agenda Automation
// Mejoras:
// - Normalización de texto para matching (acentos, mayúsculas, espacios)
// - Clicks robustos por texto mediante XPath y fallback
// - Menos waitForTimeout fijos, uso de waitForSelector cuando es posible
// - Logs con timestamps por etapa para detectar cuellos de botella
// - Dedupe de horas y filtrado más robusto
// - Reinicio del browser más frecuente para evitar OOM en Render
// - Cola de peticiones con delay mayor entre peticiones para evitar saturación

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

function now() {
    return new Date().toISOString();
}

function log(...args) {
    console.log(`[${now()}]`, ...args);
}

// Normaliza texto (quita diacríticos, minúsculas, espacios múltiples)
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

// getBrowser con reinicio agresivo para Render (cada 6 requests)
async function getBrowser() {
    // Reiniciar navegador cada 6 peticiones para liberar memoria
    if (browser && requestCount >= 6) {
        log('🔄 Reiniciando navegador para liberar memoria (threshold alcanzado)...');
        try {
            await browser.close();
        } catch (e) {
            console.error('Error al cerrar navegador:', e);
        }
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
        // Procesar siguiente petición después de 1.5 segundos para evitar saturación
        setTimeout(processQueue, 1500);
    }
}

function queueRequest(handler) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ handler, resolve, reject });
        processQueue();
    });
}

// -------------------- UTILIDADES PARA PAGINA (PUPPETEER) --------------------

// Click robusto por texto usando XPath (busca el texto en el elemento y lo clicka)
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
        // fallback: intentar buscar por querySelector y comparar textContent en contexto de la página
        try {
            const clicked = await page.evaluate((t) => {
                const norm = (s) => String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
                const el = Array.from(document.querySelectorAll('button, a')).find(b => norm(b.textContent).includes(norm(t)));
                if (el) {
                    el.scrollIntoView({behavior: 'auto', block: 'center'});
                    el.click();
                    return true;
                }
                return false;
            }, text);
            return clicked;
        } catch (e2) {
            // no hizo click
        }
    }
    return false;
}

// Click en un elemento que contiene texto dentro de una lista (ej. .cellWidget)
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
                clickable.scrollIntoView({behavior: 'auto', block: 'center'});
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
        version: '4.1.0',
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
        return res.status(400).json({
            success: false,
            error: 'Agenda no válida. Opciones: ' + Object.keys(AGENDAS).join(', ')
        });
    }

    try {
        const result = await queueRequest(async () => {
            const startTs = Date.now();
            log(`📋 Obteniendo especialidades de ${agenda}...`);

            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();

            try {
                await page.goto(AGENDAS[agenda], {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
                log('⏱ after goto (especialidades):', Date.now() - startTs, 'ms');

                // Esperar a que aparezca el botón o el contenedor con especialidades
                // Preferimos selectores en lugar de sleeps
                try {
                    await page.waitForSelector('.cellWidget, .especialidad, .service-item', { timeout: 20000 });
                } catch (e) {
                    // fallback: intentar click en "Reservar Hora" si existe
                }

                // Click en "Reservar Hora" de manera robusta (si existe)
                await clickButtonByText(page, 'reservar hora').catch(() => {});
                await page.waitForTimeout(600);

                // Click en "Por Especialidad" robusto
                await clickButtonByText(page, 'por especialidad').catch(() => {});
                await page.waitForTimeout(800);

                // Esperar contenedores de especialidades
                try {
                    await page.waitForSelector('.cellWidget', { timeout: 20000 });
                } catch (e) {
                    // si no existe, seguimos (tal vez la página tenga otro layout)
                }

                const especialidades = await page.evaluate(() => {
                    const especialidadesData = [];
                    const elems = Array.from(document.querySelectorAll('.cellWidget, .especialidad, .service-item, .item'));
                    elems.forEach(cell => {
                        const text = (cell.textContent || '').trim();
                        const title = cell.getAttribute('title') || '';
                        if (text && text.length > 3) {
                            especialidadesData.push({
                                text: title || text,
                                value: title || text
                            });
                        }
                    });
                    // fallback: si no se encontraron, intentar leer líneas del body y filtrar
                    if (especialidadesData.length === 0) {
                        const lines = (document.body.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
                        // heurística: líneas largas y sin palabras como 'Reservar' o 'Por Especialidad'
                        lines.forEach(l => {
                            if (l.length > 4 && !/reservar|especialidad|por especialidad/i.test(l)) {
                                especialidadesData.push({ text: l, value: l });
                            }
                        });
                    }
                    return especialidadesData;
                });

                requestCount++;
                log(`✅ Encontradas ${especialidades.length} especialidades - tiempo: ${Date.now() - startTs} ms`);

                return {
                    success: true,
                    agenda: agenda,
                    total: especialidades.length,
                    especialidades: especialidades
                };
            } finally {
                try { await page.close(); } catch (e) {}
            }
        });

        res.json(result);

    } catch (error) {
        console.error('❌ Error al obtener especialidades:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- PROFESIONALES --------------------

app.get('/api/profesionales', async (req, res) => {
    const { agenda, especialidad } = req.query;

    if (!agenda || !AGENDAS[agenda]) {
        return res.status(400).json({
            success: false,
            error: 'Agenda no válida'
        });
    }

    if (!especialidad) {
        return res.status(400).json({
            success: false,
            error: 'Especialidad es requerida'
        });
    }

    try {
        const result = await queueRequest(async () => {
            const startTs = Date.now();
            log(`👨‍⚕️ Obteniendo profesionales de ${agenda} para: ${especialidad}`);

            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();

            try {
                await page.goto(AGENDAS[agenda], {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
                log('⏱ after goto (profesionales):', Date.now() - startTs, 'ms');

                // Intentar clicks robustos
                await clickButtonByText(page, 'reservar hora').catch(() => {});
                await page.waitForTimeout(600);
                await clickButtonByText(page, 'por especialidad').catch(() => {});
                await page.waitForTimeout(800);

                // Seleccionamos la especialidad (robusto)
                const clickedEspecialidad = await clickElementInSelectorByText(page, '.cellWidget, .especialidad, .service-item', especialidad);
                if (!clickedEspecialidad) {
                    // intentar fallback por texto en todo el DOM
                    const tried = await page.evaluate((esp) => {
                        function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
                        const txt = n(esp);
                        const all = Array.from(document.querySelectorAll('div, li, span, button, a'));
                        const el = all.find(e => n(e.textContent || '').includes(txt));
                        if (el) {
                            const clickable = el.querySelector('button, a') || el;
                            clickable.scrollIntoView({behavior:'auto', block:'center'});
                            clickable.click();
                            return true;
                        }
                        return false;
                    }, especialidad);
                    if (!tried) {
                        return { success: false, error: 'No se pudo seleccionar la especialidad' };
                    }
                }

                await page.waitForTimeout(1200);
                log('⏱ after select especialidad:', Date.now() - startTs, 'ms');

                // Extraer profesionales desde DOM (más robusto)
                const profesionales = await page.evaluate(() => {
                    const profesionalesData = [];
                    const bodyText = document.body.innerText || '';
                    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

                    // Buscamos patrones: Nombre seguido de "Especialidad:" o "Sucursal:" etc.
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (/especialidad[:\s]/i.test(line) && i > 0) {
                            const nombre = lines[i - 1] || '';
                            const especialidad = line.replace(/Especialidad[:\s]/i, '').trim();
                            const sucursal = lines[i + 1] && /Sucursal[:\s]/i.test(lines[i+1]) ? lines[i+1].replace(/Sucursal[:\s]/i,'').trim() : '';
                            if (nombre && nombre.length > 3 && !/especialidad|seleccione/i.test(nombre)) {
                                profesionalesData.push({
                                    nombre: nombre,
                                    especialidad: especialidad,
                                    sucursal: sucursal,
                                    value: nombre
                                });
                            }
                        }
                    }
                    // fallback: si no se llenó, intentar extraer bloques más simples
                    if (profesionalesData.length === 0) {
                        const possible = Array.from(document.querySelectorAll('.profesional, .medico, .practitioner, .list-item, .item'));
                        possible.forEach(el => {
                            const txt = el.textContent || '';
                            if (txt && txt.length > 5) {
                                // tomar la primer linea de texto como nombre
                                const first = txt.split('\n').map(l=>l.trim()).filter(Boolean)[0] || txt;
                                profesionalesData.push({ nombre: first, value: first });
                            }
                        });
                    }
                    // dedupe by name
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

                requestCount++;
                log(`✅ Encontrados ${profesionales.length} profesionales - tiempo: ${Date.now() - startTs} ms`);

                return {
                    success: true,
                    agenda: agenda,
                    especialidad: especialidad,
                    total: profesionales.length,
                    profesionales: profesionales
                };
            } finally {
                try { await page.close(); } catch (e) {}
            }
        });

        res.json(result);

    } catch (error) {
        console.error('❌ Error al obtener profesionales:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- HORAS --------------------

app.get('/api/horas', async (req, res) => {
    const { agenda, especialidad, profesional, fecha } = req.query;

    if (!agenda || !AGENDAS[agenda]) {
        return res.status(400).json({
            success: false,
            error: 'Agenda no válida'
        });
    }

    if (!especialidad || !profesional) {
        return res.status(400).json({
            success: false,
            error: 'Especialidad y profesional son requeridos'
        });
    }

    try {
        const result = await queueRequest(async () => {
            const startTs = Date.now();
            log(`📅 Obteniendo horas de ${agenda} para: ${profesional} (especialidad: ${especialidad})`);

            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();

            try {
                await page.goto(AGENDAS[agenda], {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
                log('⏱ after goto (horas):', Date.now() - startTs, 'ms');

                // Intentar clicks robustos
                await clickButtonByText(page, 'reservar hora').catch(() => {});
                await page.waitForTimeout(600);
                await clickButtonByText(page, 'por especialidad').catch(() => {});
                await page.waitForTimeout(800);

                // Seleccionar especialidad
                let clickedEspecialidad = await clickElementInSelectorByText(page, '.cellWidget, .especialidad, .service-item', especialidad);
                if (!clickedEspecialidad) {
                    // fallback general
                    const tried = await page.evaluate((esp) => {
                        function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
                        const txt = n(esp);
                        const all = Array.from(document.querySelectorAll('div, li, span, button, a'));
                        const el = all.find(e => n(e.textContent || '').includes(txt));
                        if (el) {
                            const clickable = el.querySelector('button, a') || el;
                            clickable.scrollIntoView({behavior:'auto', block:'center'});
                            clickable.click();
                            return true;
                        }
                        return false;
                    }, especialidad);
                    if (!tried) {
                        return { success: false, error: 'No se pudo seleccionar la especialidad' };
                    }
                }

                await page.waitForTimeout(1200);
                log('⏱ after select especialidad (horas):', Date.now() - startTs, 'ms');

                // Selección de profesional (robusta)
                const profNorm = normalizeStringNode(profesional);
                const clickedProfesional = await page.evaluate((profNorm) => {
                    function n(s){ return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '); }
                    const candidates = Array.from(document.querySelectorAll('div, li, span, button, a')).filter(el => {
                        const t = (el.textContent || '').trim();
                        return t && n(t).includes(profNorm);
                    });
                    if (candidates.length === 0) return false;

                    // prefer candidate that also contains "Especialidad" or "Sucursal" nearby
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
                    // fallback: intentar seleccionar primer profesional visible
                    const fallback = await page.evaluate(() => {
                        const all = Array.from(document.querySelectorAll('div, li, .list-item, .profesional, .medico'));
                        const el = all[0];
                        if (!el) return false;
                        const clickable = el.querySelector('button, a') || el;
                        clickable.scrollIntoView({behavior:'auto', block:'center'});
                        clickable.click();
                        return true;
                    });
                    if (!fallback) {
                        return { success: false, error: 'No se pudo seleccionar el profesional' };
                    }
                }

                await page.waitForTimeout(1200);
                log('⏱ after select profesional:', Date.now() - startTs, 'ms');

                // Extracción de horas (regex robusto)
                const horas = await page.evaluate(() => {
                    const horasData = [];
                    const bodyText = document.body.innerText || '';
                    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

                    // regex que captura HH:MM y estado opcional
                    const regex = /(?:^|\s)(\d{1,2}:\d{2})(?:\s*[-–—]?\s*(DISPONIBLE|OCUPADO|RESERVADO)?)?/i;

                    for (const line of lines) {
                        const m = line.match(regex);
                        if (m) {
                            const hora = m[1];
                            const estadoRaw = (m[2] || '').toUpperCase();
                            const estado = estadoRaw === 'OCUPADO' ? 'OCUPADO' : (estadoRaw === 'DISPONIBLE' ? 'DISPONIBLE' : 'DESCONOCIDO');
                            const disponible = estado === 'DISPONIBLE' || (estado === 'DESCONOCIDO' && !/OCUPADO/i.test(line));
                            horasData.push({
                                hora: hora,
                                disponible: disponible,
                                estado: estado
                            });
                        }
                    }
                    return horasData;
                });

                // Filtrado y dedupe
                const horasDisponibles = (horas || []).filter(h => h.disponible).map(h => ({ hora: h.hora, estado: h.estado }));
                const seen = new Set();
                const uniqueHoras = [];
                for (const h of horasDisponibles) {
                    const key = h.hora;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueHoras.push(h);
                    }
                }

                requestCount++;
                log(`✅ Encontradas ${uniqueHoras.length} horas disponibles - tiempo total handler: ${Date.now() - startTs} ms`);

                return {
                    success: true,
                    agenda: agenda,
                    especialidad: especialidad,
                    profesional: profesional,
                    fecha: fecha || new Date().toISOString().split('T')[0],
                    horas: uniqueHoras,
                    total: uniqueHoras.length
                };
            } finally {
                try { await page.close(); } catch (e) {}
            }
        });

        res.json(result);

    } catch (error) {
        console.error('❌ Error al obtener horas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
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
