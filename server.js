const express = require('express');
const cors = require('cors');
const puppeteerCore = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browser = null;

const AGENDAS = {
    kineyfisio: 'https://web.philaxmed.cl/ReservaOnline.html?mc=kineyfisio#_',
    cesmed: 'https://s2.philaxmed.cl/ReservaOnline.html?mc=cesmed#_'
};

async function getBrowser() {
    if (!browser) {
        try {
            browser = await puppeteerCore.launch({
                args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
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

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'Philaxmed Multi-Agenda Automation'
    });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Philaxmed Multi-Agenda API',
        version: '3.1.0',
        agendas: Object.keys(AGENDAS),
        endpoints: {
            health: '/health',
            especialidades: '/api/especialidades?agenda=kineyfisio',
            profesionales: '/api/profesionales?agenda=kineyfisio&especialidad=NOMBRE',
            horas: '/api/horas?agenda=kineyfisio&profesional=NOMBRE&fecha=YYYY-MM-DD'
        },
        status: 'running'
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
        console.log(`📋 Obteniendo especialidades de ${agenda}...`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(AGENDAS[agenda], {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        await page.waitForTimeout(5000);
        
        // PASO 1: Click en "Reservar Hora"
        console.log('🔘 Haciendo click en "Reservar Hora"...');
        const clickedReservar = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
            if (reservarBtn) {
                reservarBtn.click();
                return true;
            }
            return false;
        });
        
        if (!clickedReservar) {
            await page.close();
            return res.json({
                success: false,
                error: 'No se encontró el botón "Reservar Hora"'
            });
        }
        
        await page.waitForTimeout(3000);
        
        // PASO 2: Click en "Por Especialidad"
        console.log('🔘 Haciendo click en "Por Especialidad"...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
            if (especialidadBtn) {
                especialidadBtn.click();
            }
        });
        
        await page.waitForTimeout(3000);
        
        // PASO 3: Extraer especialidades
        console.log('📋 Extrayendo especialidades...');
        const especialidades = await page.evaluate(() => {
            const especialidadesData = [];
            const buttons = Array.from(document.querySelectorAll('button.gwt-Button'));
            
            buttons.forEach(btn => {
                const text = btn.textContent.trim();
                // Filtrar botones que no son especialidades
                if (text && 
                    text.length > 5 && 
                    !text.includes('Volver') && 
                    !text.includes('Buscar') &&
                    !text.includes('Reservar') &&
                    !text.includes('Confirmar') &&
                    !text.includes('Cancelar') &&
                    !text.includes('Por Profesional') &&
                    !text.includes('Por Especialidad')) {
                    especialidadesData.push({
                        text: text,
                        value: text
                    });
                }
            });
            
            return especialidadesData;
        });
        
        await page.close();
        
        console.log(`✅ Encontradas ${especialidades.length} especialidades`);
        
        res.json({
            success: true,
            agenda: agenda,
            especialidades: especialidades
        });
        
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
        console.log(`👨‍⚕️ Obteniendo profesionales de ${agenda} para: ${especialidad}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(AGENDAS[agenda], {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        await page.waitForTimeout(5000);
        
        // PASO 1: Click en "Reservar Hora"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
            if (reservarBtn) reservarBtn.click();
        });
        
        await page.waitForTimeout(3000);
        
        // PASO 2: Click en "Por Especialidad"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
            if (especialidadBtn) especialidadBtn.click();
        });
        
        await page.waitForTimeout(3000);
        
        // PASO 3: Click en la especialidad seleccionada
        console.log(`🔘 Seleccionando especialidad: ${especialidad}`);
        const clickedEspecialidad = await page.evaluate((esp) => {
            const buttons = Array.from(document.querySelectorAll('button.gwt-Button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.trim() === esp);
            if (especialidadBtn) {
                especialidadBtn.click();
                return true;
            }
            return false;
        }, especialidad);
        
        if (!clickedEspecialidad) {
            await page.close();
            return res.json({
                success: false,
                error: 'No se pudo seleccionar la especialidad'
            });
        }
        
        await page.waitForTimeout(4000);
        
        // PASO 4: Extraer profesionales
        console.log('👨‍⚕️ Extrayendo profesionales...');
        const profesionales = await page.evaluate(() => {
            const profesionalesData = [];
            
            // Buscar todas las tarjetas de profesionales
            const allDivs = Array.from(document.querySelectorAll('div'));
            
            allDivs.forEach((div, index) => {
                const text = div.textContent;
                
                // Detectar si es una tarjeta de profesional
                if (text.includes('Especialidad:') && text.includes('Próximo Cupo:')) {
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                    
                    let nombre = '';
                    let especialidad = '';
                    let sucursal = '';
                    let proximoCupo = '';
                    
                    lines.forEach((line, i) => {
                        if (i === 0 && !line.includes('Especialidad')) {
                            nombre = line;
                        }
                        if (line.startsWith('Especialidad:')) {
                            especialidad = line.replace('Especialidad:', '').trim();
                        }
                        if (line.startsWith('Sucursal:')) {
                            sucursal = line.replace('Sucursal:', '').trim();
                        }
                        if (line.startsWith('Próximo Cupo:')) {
                            proximoCupo = line.replace('Próximo Cupo:', '').trim();
                        }
                    });
                    
                    if (nombre) {
                        profesionalesData.push({
                            id: index,
                            nombre: nombre,
                            especialidad: especialidad,
                            sucursal: sucursal,
                            proximo_cupo: proximoCupo,
                            value: nombre
                        });
                    }
                }
            });
            
            return profesionalesData;
        });
        
        await page.close();
        
        console.log(`✅ Encontrados ${profesionales.length} profesionales`);
        
        res.json({
            success: true,
            agenda: agenda,
            especialidad: especialidad,
            profesionales: profesionales
        });
        
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
        console.log(`📅 Obteniendo horas de ${agenda} para: ${profesional}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(AGENDAS[agenda], {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        await page.waitForTimeout(5000);
        
        // PASO 1: Click en "Reservar Hora"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
            if (reservarBtn) reservarBtn.click();
        });
        
        await page.waitForTimeout(3000);
        
        // PASO 2: Click en "Por Especialidad"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
            if (especialidadBtn) especialidadBtn.click();
        });
        
        await page.waitForTimeout(3000);
        
        // PASO 3: Click en especialidad
        await page.evaluate((esp) => {
            const buttons = Array.from(document.querySelectorAll('button.gwt-Button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.trim() === esp);
            if (especialidadBtn) especialidadBtn.click();
        }, especialidad);
        
        await page.waitForTimeout(4000);
        
        // PASO 4: Click en profesional
        console.log(`🔘 Seleccionando profesional: ${profesional}`);
        const clickedProfesional = await page.evaluate((prof) => {
            const allDivs = Array.from(document.querySelectorAll('div'));
            const profesionalDiv = allDivs.find(div => div.textContent.includes(prof) && div.textContent.includes('Especialidad:'));
            if (profesionalDiv) {
                profesionalDiv.click();
                return true;
            }
            return false;
        }, profesional);
        
        if (!clickedProfesional) {
            await page.close();
            return res.json({
                success: false,
                error: 'No se pudo seleccionar el profesional'
            });
        }
        
        await page.waitForTimeout(4000);
        
        // PASO 5: Si hay fecha, seleccionarla
        if (fecha) {
            console.log(`📅 Seleccionando fecha: ${fecha}`);
            await page.evaluate((f) => {
                const selects = Array.from(document.querySelectorAll('select'));
                const dateSelect = selects.find(sel => sel.options && sel.options.length > 0);
                if (dateSelect) {
                    // Buscar la opción que coincida con la fecha
                    Array.from(dateSelect.options).forEach(opt => {
                        if (opt.text.includes(f)) {
                            dateSelect.value = opt.value;
                            dateSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                }
            }, fecha);
            
            await page.waitForTimeout(3000);
        }
        
        // PASO 6: Extraer horas disponibles
        console.log('🕐 Extrayendo horas...');
        const horas = await page.evaluate(() => {
            const horasData = [];
            const buttons = Array.from(document.querySelectorAll('button'));
            
            buttons.forEach(btn => {
                const text = btn.textContent.trim();
                
                // Detectar formato de hora (HH:MM)
                const horaMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (horaMatch) {
                    const disponible = text.includes('DISPONIBLE');
                    const ocupado = text.includes('OCUPADO');
                    
                    horasData.push({
                        hora: horaMatch[0],
                        disponible: disponible,
                        estado: disponible ? 'DISPONIBLE' : (ocupado ? 'OCUPADO' : 'DESCONOCIDO')
                    });
                }
            });
            
            return horasData;
        });
        
        await page.close();
        
        console.log(`✅ Encontradas ${horas.filter(h => h.disponible).length} horas disponibles`);
        
        res.json({
            success: true,
            agenda: agenda,
            especialidad: especialidad,
            profesional: profesional,
            fecha: fecha || new Date().toISOString().split('T')[0],
            horas: horas.filter(h => h.disponible),
            total: horas.filter(h => h.disponible).length
        });
        
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
