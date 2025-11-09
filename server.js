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
        version: '3.0.0',
        agendas: Object.keys(AGENDAS),
        endpoints: {
            health: '/health',
            especialidades: '/api/especialidades?agenda=kineyfisio',
            profesionales: '/api/profesionales?agenda=kineyfisio&especialidad=NOMBRE',
            horas: '/api/horas?agenda=kineyfisio&profesional=ID&fecha=YYYY-MM-DD'
        },
        status: 'running'
    });
});

// Obtener especialidades (botones)
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
        
        // Esperar a que cargue el panel de especialidades
        await page.waitForTimeout(5000);
        
        // Click en "Por Especialidad" si existe
        try {
            await page.waitForSelector('button:has-text("Por Especialidad"), .onlineBooking-tabButton', { timeout: 3000 });
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const text = await page.evaluate(el => el.textContent, button);
                if (text.includes('Por Especialidad')) {
                    await button.click();
                    await page.waitForTimeout(2000);
                    break;
                }
            }
        } catch (e) {
            console.log('No se encontró botón "Por Especialidad"');
        }
        
        // Extraer especialidades de los botones
        const especialidades = await page.evaluate(() => {
            const especialidadButtons = [];
            
            // Buscar botones de especialidad
            const buttons = document.querySelectorAll('button.gwt-Button, button[class*="specialty"], button[class*="especialidad"]');
            
            buttons.forEach(btn => {
                const text = btn.textContent.trim();
                if (text && text.length > 3 && !text.includes('Volver') && !text.includes('Buscar')) {
                    especialidadButtons.push({
                        text: text,
                        value: text
                    });
                }
            });
            
            // Si no encontró botones, buscar en divs
            if (especialidadButtons.length === 0) {
                const divs = document.querySelectorAll('div[class*="specialty"], div[class*="especialidad"]');
                divs.forEach(div => {
                    const text = div.textContent.trim();
                    if (text && text.length > 3) {
                        especialidadButtons.push({
                            text: text,
                            value: text
                        });
                    }
                });
            }
            
            return especialidadButtons;
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

// Obtener profesionales (tarjetas con fotos)
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
        
        // Click en "Por Especialidad"
        try {
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const text = await page.evaluate(el => el.textContent, button);
                if (text.includes('Por Especialidad')) {
                    await button.click();
                    await page.waitForTimeout(2000);
                    break;
                }
            }
        } catch (e) {}
        
        // Click en la especialidad
        const especialidadButtons = await page.$$('button');
        let clicked = false;
        for (const button of especialidadButtons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.trim() === especialidad) {
                await button.click();
                await page.waitForTimeout(3000);
                clicked = true;
                break;
            }
        }
        
        if (!clicked) {
            await page.close();
            return res.json({
                success: false,
                error: 'No se pudo seleccionar la especialidad'
            });
        }
        
        // Extraer profesionales de las tarjetas
        const profesionales = await page.evaluate(() => {
            const profesionalesData = [];
            
            // Buscar tarjetas de profesionales
            const cards = document.querySelectorAll('div[class*="agendaSelection"], div[class*="professional"], div[class*="especialista"]');
            
            cards.forEach((card, index) => {
                const nombreEl = card.querySelector('div, span, p');
                const especialidadEl = card.querySelectorAll('div, span, p')[1];
                const cupoEl = card.querySelector('div:has-text("Próximo Cupo"), span:has-text("Próximo Cupo")');
                
                if (nombreEl) {
                    const nombre = nombreEl.textContent.trim();
                    const especialidadText = especialidadEl ? especialidadEl.textContent.trim() : '';
                    const cupo = cupoEl ? cupoEl.textContent.trim() : '';
                    
                    if (nombre && nombre.length > 3) {
                        profesionalesData.push({
                            id: index,
                            nombre: nombre,
                            especialidad: especialidadText,
                            proximo_cupo: cupo,
                            value: nombre
                        });
                    }
                }
            });
            
            return profesionalesData;
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
        
        await page.waitForTimeout(5000);
        
        // Navegar: Por Especialidad -> Especialidad -> Profesional
        try {
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const text = await page.evaluate(el => el.textContent, button);
                if (text.includes('Por Especialidad')) {
                    await button.click();
                    await page.waitForTimeout(2000);
                    break;
                }
            }
        } catch (e) {}
        
        // Click en especialidad
        const especialidadButtons = await page.$$('button');
        for (const button of especialidadButtons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.trim() === especialidad) {
                await button.click();
                await page.waitForTimeout(3000);
                break;
            }
        }
        
        // Click en profesional (tarjeta)
        const cards = await page.$$('div[class*="agendaSelection"]');
        for (const card of cards) {
            const text = await page.evaluate(el => el.textContent, card);
            if (text.includes(profesional)) {
                await card.click();
                await page.waitForTimeout(3000);
                break;
            }
        }
        
        // Si hay fecha, seleccionarla
        if (fecha) {
            // Buscar selector de fecha
            const dateSelectors = await page.$$('select, input[type="date"]');
            if (dateSelectors.length > 0) {
                // Implementar selección de fecha
            }
        }
        
        // Extraer horas disponibles
        const horas = await page.evaluate(() => {
            const horasData = [];
            
            // Buscar botones de hora
            const timeButtons = document.querySelectorAll('button, div[class*="time"]');
            
            timeButtons.forEach(btn => {
                const text = btn.textContent.trim();
                const isDisponible = text.includes('DISPONIBLE') || !text.includes('OCUPADO');
                
                // Extraer hora (formato HH:MM)
                const horaMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (horaMatch) {
                    horasData.push({
                        hora: horaMatch[0],
                        disponible: isDisponible,
                        estado: text.includes('DISPONIBLE') ? 'DISPONIBLE' : 'OCUPADO'
                    });
                }
            });
            
            return horasData;
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
