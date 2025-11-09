const express = require('express');
const cors = require('cors');
const puppeteerCore = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browser = null;

// URL de Philaxmed - REEMPLAZA CON TU URL REAL
const PHILAXMED_URL = 'https://kinefisio.cl/reserva-de-horas/'; // 👈 CAMBIA ESTO

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
        service: 'Philaxmed Automation'
    });
});

// Página principal
app.get('/', (req, res) => {
    res.json({
        service: 'Philaxmed Automation API',
        version: '2.0.0',
        endpoints: {
            health: '/health',
            especialidades: '/api/especialidades',
            profesionales: '/api/profesionales?especialidad=NOMBRE',
            horas: '/api/horas?especialidad=NOMBRE&profesional=NOMBRE&fecha=YYYY-MM-DD'
        },
        status: 'running'
    });
});

// Obtener especialidades disponibles
app.get('/api/especialidades', async (req, res) => {
    try {
        console.log('📋 Obteniendo especialidades...');
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(PHILAXMED_URL, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Esperar a que cargue el selector de especialidades
        await page.waitForSelector('select[name="especialidad"], #especialidad, select.especialidad', {
            timeout: 10000
        });
        
        // Extraer especialidades
        const especialidades = await page.evaluate(() => {
            const select = document.querySelector('select[name="especialidad"], #especialidad, select.especialidad');
            if (!select) return [];
            
            const options = Array.from(select.options);
            return options
                .filter(opt => opt.value && opt.value !== '')
                .map(opt => ({
                    value: opt.value,
                    text: opt.text.trim()
                }));
        });
        
        await page.close();
        
        res.json({
            success: true,
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
    const { especialidad } = req.query;
    
    if (!especialidad) {
        return res.status(400).json({
            success: false,
            error: 'Especialidad es requerida'
        });
    }
    
    try {
        console.log(`👨‍⚕️ Obteniendo profesionales para: ${especialidad}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(PHILAXMED_URL, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Seleccionar especialidad
        await page.waitForSelector('select[name="especialidad"], #especialidad, select.especialidad');
        await page.select('select[name="especialidad"], #especialidad, select.especialidad', especialidad);
        
        // Esperar a que carguen los profesionales
        await page.waitForTimeout(2000);
        await page.waitForSelector('select[name="profesional"], #profesional, select.profesional', {
            timeout: 10000
        });
        
        // Extraer profesionales
        const profesionales = await page.evaluate(() => {
            const select = document.querySelector('select[name="profesional"], #profesional, select.profesional');
            if (!select) return [];
            
            const options = Array.from(select.options);
            return options
                .filter(opt => opt.value && opt.value !== '')
                .map(opt => ({
                    value: opt.value,
                    text: opt.text.trim()
                }));
        });
        
        await page.close();
        
        res.json({
            success: true,
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
    const { especialidad, profesional, fecha } = req.query;
    
    if (!especialidad || !profesional) {
        return res.status(400).json({
            success: false,
            error: 'Especialidad y profesional son requeridos'
        });
    }
    
    try {
        console.log(`📅 Obteniendo horas para: ${profesional} - ${fecha || 'hoy'}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(PHILAXMED_URL, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Seleccionar especialidad
        await page.waitForSelector('select[name="especialidad"], #especialidad, select.especialidad');
        await page.select('select[name="especialidad"], #especialidad, select.especialidad', especialidad);
        
        await page.waitForTimeout(2000);
        
        // Seleccionar profesional
        await page.waitForSelector('select[name="profesional"], #profesional, select.profesional');
        await page.select('select[name="profesional"], #profesional, select.profesional', profesional);
        
        await page.waitForTimeout(2000);
        
        // Si hay fecha, seleccionarla
        if (fecha) {
            const dateInput = await page.$('input[type="date"], input[name="fecha"], #fecha');
            if (dateInput) {
                await dateInput.click({ clickCount: 3 });
                await dateInput.type(fecha);
            }
            await page.waitForTimeout(2000);
        }
        
        // Extraer horas disponibles
        const horas = await page.evaluate(() => {
            // Buscar botones, divs o elementos con horas
            const horaElements = document.querySelectorAll(
                '.hora-disponible, .hora, button[data-hora], div[data-hora], .time-slot'
            );
            
            if (horaElements.length === 0) {
                // Intentar con selectores alternativos
                const select = document.querySelector('select[name="hora"], #hora, select.hora');
                if (select) {
                    const options = Array.from(select.options);
                    return options
                        .filter(opt => opt.value && opt.value !== '')
                        .map(opt => ({
                            hora: opt.text.trim(),
                            disponible: true
                        }));
                }
            }
            
            return Array.from(horaElements).map(el => ({
                hora: el.textContent.trim() || el.getAttribute('data-hora'),
                disponible: !el.classList.contains('disabled') && !el.disabled
            })).filter(h => h.hora);
        });
        
        await page.close();
        
        res.json({
            success: true,
            especialidad: especialidad,
            profesional: profesional,
            fecha: fecha || new Date().toISOString().split('T')[0],
            horas: horas,
            total: horas.length
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
});

// Cerrar navegador al terminar
process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
