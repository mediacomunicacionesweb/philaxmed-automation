const express = require('express');
const cors = require('cors');
const puppeteerCore = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browser = null;

// URLs de las agendas de Philaxmed
const AGENDAS = {
    kineyfisio: 'https://web.philaxmed.cl/ReservaOnline.html?mc=kineyfisio#_',
    cesmed: 'https://s2.philaxmed.cl/ReservaOnline.html?mc=cesmed#_'
};

async function getBrowser() {
    if (!browser) {
        try {
            browser = await puppeteerCore.launch({
                args: chromium.args,
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

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'Philaxmed Multi-Agenda Automation'
    });
});

// Página principal
app.get('/', (req, res) => {
    res.json({
        service: 'Philaxmed Multi-Agenda API',
        version: '2.0.0',
        agendas: Object.keys(AGENDAS),
        endpoints: {
            health: '/health',
            especialidades: '/api/especialidades?agenda=kineyfisio',
            profesionales: '/api/profesionales?agenda=kineyfisio&especialidad=NOMBRE',
            horas: '/api/horas?agenda=kineyfisio&especialidad=NOMBRE&profesional=NOMBRE&fecha=YYYY-MM-DD'
        },
        status: 'running'
    });
});

// Obtener especialidades disponibles
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
        
        // Esperar a que cargue el formulario
        await page.waitForTimeout(3000);
        
        // Extraer especialidades (Philaxmed usa diferentes selectores)
        const especialidades = await page.evaluate(() => {
            const selectors = [
                'select#cmbEspecialidad',
                'select[name="especialidad"]',
                '#especialidad',
                'select.especialidad'
            ];
            
            let select = null;
            for (const selector of selectors) {
                select = document.querySelector(selector);
                if (select) break;
            }
            
            if (!select) return [];
            
            const options = Array.from(select.options);
            return options
                .filter(opt => opt.value && opt.value !== '' && opt.value !== '0')
                .map(opt => ({
                    value: opt.value,
                    text: opt.text.trim()
                }));
        });
        
        await page.close();
        
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

// Obtener profesionales por especialidad
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
        
        await page.waitForTimeout(3000);
        
        // Seleccionar especialidad
        const especialidadSelected = await page.evaluate((esp) => {
            const selectors = [
                'select#cmbEspecialidad',
                'select[name="especialidad"]',
                '#especialidad'
            ];
            
            for (const selector of selectors) {
                const select = document.querySelector(selector);
                if (select) {
                    select.value = esp;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, especialidad);
        
        if (!especialidadSelected) {
            await page.close();
            return res.json({
                success: false,
                error: 'No se pudo seleccionar la especialidad'
            });
        }
        
        // Esperar a que carguen los profesionales
        await page.waitForTimeout(3000);
        
        // Extraer profesionales
        const profesionales = await page.evaluate(() => {
            const selectors = [
                'select#cmbProfesional',
                'select[name="profesional"]',
                '#profesional',
                'select.profesional'
            ];
            
            let select = null;
            for (const selector of selectors) {
                select = document.querySelector(selector);
                if (select) break;
            }
            
            if (!select) return [];
            
            const options = Array.from(select.options);
            return options
                .filter(opt => opt.value && opt.value !== '' && opt.value !== '0')
                .map(opt => ({
                    value: opt.value,
                    text: opt.text.trim()
                }));
        });
        
        await page.close();
        
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
        console.log(`📅 Obteniendo horas de ${agenda} para: ${profesional} - ${fecha || 'hoy'}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(AGENDAS[agenda], {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        await page.waitForTimeout(3000);
        
        // Seleccionar especialidad
        await page.evaluate((esp) => {
            const select = document.querySelector('select#cmbEspecialidad, select[name="especialidad"], #especialidad');
            if (select) {
                select.value = esp;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, especialidad);
        
        await page.waitForTimeout(3000);
        
        // Seleccionar profesional
        await page.evaluate((prof) => {
            const select = document.querySelector('select#cmbProfesional, select[name="profesional"], #profesional');
            if (select) {
                select.value = prof;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, profesional);
        
        await page.waitForTimeout(3000);
        
        // Si hay fecha, seleccionarla
        if (fecha) {
            await page.evaluate((f) => {
                const dateInput = document.querySelector('input[type="date"], input#txtFecha, input[name="fecha"]');
                if (dateInput) {
                    dateInput.value = f;
                    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, fecha);
            await page.waitForTimeout(3000);
        }
        
        // Extraer horas disponibles
        const horas = await page.evaluate(() => {
            const horaElements = document.querySelectorAll(
                'button.hora-disponible, .hora-btn, button[data-hora], div.time-slot, select#cmbHora option'
            );
            
            if (horaElements.length === 0) {
                // Intentar con select de horas
                const select = document.querySelector('select#cmbHora, select[name="hora"], #hora');
                if (select) {
                    const options = Array.from(select.options);
                    return options
                        .filter(opt => opt.value && opt.value !== '' && opt.value !== '0')
                        .map(opt => ({
                            hora: opt.text.trim(),
                            value: opt.value,
                            disponible: true
                        }));
                }
            }
            
            return Array.from(horaElements).map(el => {
                const isButton = el.tagName === 'BUTTON';
                return {
                    hora: el.textContent.trim() || el.getAttribute('data-hora') || el.value,
                    value: el.value || el.getAttribute('data-hora'),
                    disponible: !el.classList.contains('disabled') && !el.disabled
                };
            }).filter(h => h.hora);
        });
        
        await page.close();
        
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

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📋 Agendas disponibles: ${Object.keys(AGENDAS).join(', ')}`);
});

// Cerrar navegador al terminar
process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
