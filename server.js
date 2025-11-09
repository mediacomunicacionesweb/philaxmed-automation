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

async function getBrowser() {
    // Reiniciar navegador cada 10 peticiones para liberar memoria
    if (browser && requestCount > 10) {
        console.log('🔄 Reiniciando navegador para liberar memoria...');
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
            console.log('🚀 Iniciando navegador...');
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
            console.log('✅ Navegador iniciado');
        } catch (error) {
            console.error('❌ Error al iniciar navegador:', error);
            throw error;
        }
    }
    return browser;
}

// Sistema de cola para evitar peticiones simultáneas
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
        // Procesar siguiente petición después de 1 segundo
        setTimeout(processQueue, 1000);
    }
}

function queueRequest(handler) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ handler, resolve, reject });
        processQueue();
    });
}

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

// Obtener especialidades
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
            console.log(`📋 Obteniendo especialidades de ${agenda}...`);
            
            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();
            
            try {
                await page.goto(AGENDAS[agenda], {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });
                
                await page.waitForTimeout(5000);
                
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
                    if (reservarBtn) reservarBtn.click();
                });
                
                await page.waitForTimeout(3000);
                
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
                    if (especialidadBtn) especialidadBtn.click();
                });
                
                await page.waitForTimeout(5000);
                
                const especialidades = await page.evaluate(() => {
                    const especialidadesData = [];
                    const cellWidgets = Array.from(document.querySelectorAll('.cellWidget'));
                    
                    cellWidgets.forEach(cell => {
                        const text = cell.textContent.trim();
                        const title = cell.getAttribute('title');
                        
                        if (text && text.length > 3) {
                            especialidadesData.push({
                                text: title || text,
                                value: title || text
                            });
                        }
                    });
                    
                    return especialidadesData;
                });
                
                requestCount++;
                console.log(`✅ Encontradas ${especialidades.length} especialidades`);
                
                return {
                    success: true,
                    agenda: agenda,
                    total: especialidades.length,
                    especialidades: especialidades
                };
            } finally {
                await page.close();
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

// Obtener profesionales
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
            console.log(`👨‍⚕️ Obteniendo profesionales de ${agenda} para: ${especialidad}`);
            
            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();
            
            try {
                await page.goto(AGENDAS[agenda], {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });
                
                await page.waitForTimeout(5000);
                
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
                    if (reservarBtn) reservarBtn.click();
                });
                
                await page.waitForTimeout(3000);
                
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
                    if (especialidadBtn) especialidadBtn.click();
                });
                
                await page.waitForTimeout(5000);
                
                console.log(`🔘 Seleccionando especialidad: ${especialidad}`);
                const clickedEspecialidad = await page.evaluate((esp) => {
                    const cellWidgets = Array.from(document.querySelectorAll('.cellWidget'));
                    const especialidadCell = cellWidgets.find(cell => {
                        const title = cell.getAttribute('title');
                        const text = cell.textContent.trim();
                        return title === esp || text === esp;
                    });
                    
                    if (especialidadCell) {
                        especialidadCell.click();
                        return true;
                    }
                    return false;
                }, especialidad);
                
                if (!clickedEspecialidad) {
                    return {
                        success: false,
                        error: 'No se pudo seleccionar la especialidad'
                    };
                }
                
                await page.waitForTimeout(5000);
                
                console.log('👨‍⚕️ Extrayendo profesionales...');
                const profesionales = await page.evaluate(() => {
                    const profesionalesData = [];
                    const bodyText = document.body.innerText;
                    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
                    
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith('Especialidad:')) {
                            const nombre = lines[i - 1] || '';
                            const especialidad = lines[i].replace('Especialidad:', '').trim();
                            const sucursal = lines[i + 1]?.startsWith('Sucursal:') ? lines[i + 1].replace('Sucursal:', '').trim() : '';
                            const proximoCupo = lines[i + 2]?.startsWith('Próximo Cupo:') ? lines[i + 2].replace('Próximo Cupo:', '').trim() : '';
                            
                            if (nombre && nombre.length > 3 && !nombre.includes('Especialidad') && !nombre.includes('Seleccione')) {
                                profesionalesData.push({
                                    nombre: nombre,
                                    especialidad: especialidad,
                                    sucursal: sucursal,
                                    proximo_cupo: proximoCupo,
                                    value: nombre
                                });
                            }
                        }
                    }
                    
                    return profesionalesData;
                });
                
                requestCount++;
                console.log(`✅ Encontrados ${profesionales.length} profesionales`);
                
                return {
                    success: true,
                    agenda: agenda,
                    especialidad: especialidad,
                    total: profesionales.length,
                    profesionales: profesionales
                };
            } finally {
                await page.close();
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

// Obtener horas disponibles
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
            console.log(`📅 Obteniendo horas de ${agenda} para: ${profesional}`);
            
            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();
            
            try {
                await page.goto(AGENDAS[agenda], {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });
                
                await page.waitForTimeout(5000);
                
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
                    if (reservarBtn) reservarBtn.click();
                });
                
                await page.waitForTimeout(3000);
                
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
                    if (especialidadBtn) especialidadBtn.click();
                });
                
                await page.waitForTimeout(5000);
                
                await page.evaluate((esp) => {
                    const cellWidgets = Array.from(document.querySelectorAll('.cellWidget'));
                    const especialidadCell = cellWidgets.find(cell => {
                        const title = cell.getAttribute('title');
                        const text = cell.textContent.trim();
                        return title === esp || text === esp;
                    });
                    if (especialidadCell) especialidadCell.click();
                }, especialidad);
                
                await page.waitForTimeout(5000);
                
                console.log(`🔘 Seleccionando profesional: ${profesional}`);
                const clickedProfesional = await page.evaluate((prof) => {
                    const bodyText = document.body.innerText;
                    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
                    
                    const profIndex = lines.findIndex(line => line === prof);
                    
                    if (profIndex !== -1) {
                        const allDivs = Array.from(document.querySelectorAll('div'));
                        const profesionalDiv = allDivs.find(div => 
                            div.textContent.includes(prof) && 
                            div.textContent.includes('Especialidad:')
                        );
                        
                        if (profesionalDiv) {
                            profesionalDiv.click();
                            return true;
                        }
                    }
                    return false;
                }, profesional);
                
                if (!clickedProfesional) {
                    return {
                        success: false,
                        error: 'No se pudo seleccionar el profesional'
                    };
                }
                
                await page.waitForTimeout(5000);
                
                console.log('🕐 Extrayendo horas...');
                const horas = await page.evaluate(() => {
                    const horasData = [];
                    const bodyText = document.body.innerText;
                    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
                    
                    lines.forEach(line => {
                        const match = line.match(/(\d{1,2}):(\d{2})\s*(DISPONIBLE|OCUPADO)?/);
                        if (match) {
                            const hora = match[1] + ':' + match[2];
                            const disponible = line.includes('DISPONIBLE') || (!line.includes('OCUPADO') && match[3] !== 'OCUPADO');
                            
                            horasData.push({
                                hora: hora,
                                disponible: disponible,
                                estado: line.includes('DISPONIBLE') ? 'DISPONIBLE' : (line.includes('OCUPADO') ? 'OCUPADO' : 'DESCONOCIDO')
                            });
                        }
                    });
                    
                    return horasData;
                });
                
                const horasDisponibles = horas.filter(h => h.disponible);
                
                requestCount++;
                console.log(`✅ Encontradas ${horasDisponibles.length} horas disponibles`);
                
                return {
                    success: true,
                    agenda: agenda,
                    especialidad: especialidad,
                    profesional: profesional,
                    fecha: fecha || new Date().toISOString().split('T')[0],
                    horas: horasDisponibles,
                    total: horasDisponibles.length
                };
            } finally {
                await page.close();
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

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📋 Agendas disponibles: ${Object.keys(AGENDAS).join(', ')}`);
});

process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
