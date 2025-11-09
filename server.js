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
        version: '3.3.0',
        agendas: Object.keys(AGENDAS),
        endpoints: {
            health: '/health',
            debug: '/api/debug?agenda=kineyfisio',
            especialidades: '/api/especialidades?agenda=kineyfisio',
            profesionales: '/api/profesionales?agenda=kineyfisio&especialidad=NOMBRE',
            horas: '/api/horas?agenda=kineyfisio&profesional=NOMBRE&fecha=YYYY-MM-DD'
        },
        status: 'running'
    });
});

// ENDPOINT DE DEBUG MEJORADO
app.get('/api/debug', async (req, res) => {
    const { agenda } = req.query;
    
    if (!agenda || !AGENDAS[agenda]) {
        return res.status(400).json({
            success: false,
            error: 'Agenda no válida'
        });
    }
    
    try {
        console.log(`🔍 DEBUG: Analizando ${agenda}...`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.goto(AGENDAS[agenda], {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        await page.waitForTimeout(5000);
        
        // Click en "Reservar Hora"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
            if (reservarBtn) reservarBtn.click();
        });
        
        await page.waitForTimeout(3000);
        
        // Click en "Por Especialidad"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
            if (especialidadBtn) especialidadBtn.click();
        });
        
        await page.waitForTimeout(5000); // Más tiempo de espera
        
        // Hacer scroll para cargar contenido
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        
        await page.waitForTimeout(2000);
        
        // Extraer TODO el contenido visible
        const estadoFinal = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const allDivs = Array.from(document.querySelectorAll('div'));
            const listWidget = document.querySelector('.onlineBookingListWidget');
            
            return {
                total_buttons: buttons.length,
                button_texts: buttons.map(b => b.textContent.trim()),
                total_divs: allDivs.length,
                listWidget_html: listWidget ? listWidget.innerHTML : 'NO ENCONTRADO',
                body_text: document.body.innerText.substring(0, 3000)
            };
        });
        
        await page.close();
        
        res.json({
            success: true,
            agenda: agenda,
            debug: estadoFinal
        });
        
    } catch (error) {
        console.error('❌ Error en debug:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
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
        
        // Click en "Reservar Hora"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const reservarBtn = buttons.find(btn => btn.textContent.includes('Reservar Hora'));
            if (reservarBtn) reservarBtn.click();
        });
        
        await page.waitForTimeout(3000);
        
        // Click en "Por Especialidad"
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const especialidadBtn = buttons.find(btn => btn.textContent.includes('Por Especialidad'));
            if (especialidadBtn) especialidadBtn.click();
        });
        
        await page.waitForTimeout(5000);
        
        // Hacer scroll
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        
        await page.waitForTimeout(2000);
        
        // Extraer especialidades del texto visible
        const especialidades = await page.evaluate(() => {
            const especialidadesData = [];
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
            
            // Buscar después de "Seleccione Especialidad"
            const startIndex = lines.findIndex(l => l.includes('Seleccione') || l.includes('Especialidad'));
            
            if (startIndex !== -1) {
                // Las siguientes líneas deberían ser especialidades
                for (let i = startIndex + 1; i < lines.length; i++) {
                    const line = lines[i];
                    
                    // Filtrar líneas válidas
                    if (line.length > 5 && 
                        !line.includes('Volver') && 
                        !line.includes('Buscar') &&
                        !line.includes('Por Profesional') &&
                        !line.includes('Por Especialidad') &&
                        !line.includes('Seleccione')) {
                        
                        especialidadesData.push({
                            text: line,
                            value: line
                        });
                    }
                    
                    // Detener si encontramos "Volver" o "Buscar"
                    if (line.includes('Volver') || line.includes('Buscar')) {
                        break;
                    }
                }
            }
            
            return especialidadesData;
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
        
        // Navegar hasta especialidad
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
        
        // Click en especialidad (buscar en el texto)
        const clickedEspecialidad = await page.evaluate((esp) => {
            const bodyText = document.body.innerText;
            if (bodyText.includes(esp)) {
                // Buscar elemento clickeable
                const allElements = Array.from(document.querySelectorAll('div, button, span'));
                const especialidadEl = allElements.find(el => 
                    el.textContent.trim() === esp && 
                    el.offsetParent !== null
                );
                if (especialidadEl) {
                    especialidadEl.click();
                    return true;
                }
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
        
        await page.waitForTimeout(5000);
        
        // Extraer profesionales
        const profesionales = await page.evaluate(() => {
            const profesionalesData = [];
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('Especialidad:')) {
                    const nombre = lines[i - 1] || '';
                    const especialidad = lines[i].replace('Especialidad:', '').trim();
                    const sucursal = lines[i + 1]?.includes('Sucursal:') ? lines[i + 1].replace('Sucursal:', '').trim() : '';
                    const proximoCupo = lines[i + 2]?.includes('Próximo Cupo:') ? lines[i + 2].replace('Próximo Cupo:', '').trim() : '';
                    
                    if (nombre && nombre.length > 3 && !nombre.includes('Especialidad')) {
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

// Obtener horas
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
        
        // Navegar hasta profesional
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
            const allElements = Array.from(document.querySelectorAll('div, button, span'));
            const especialidadEl = allElements.find(el => 
                el.textContent.trim() === esp && 
                el.offsetParent !== null
            );
            if (especialidadEl) especialidadEl.click();
        }, especialidad);
        
        await page.waitForTimeout(5000);
        
        // Click en profesional
        const clickedProfesional = await page.evaluate((prof) => {
            const allElements = Array.from(document.querySelectorAll('div, button, span'));
            const profesionalEl = allElements.find(el => 
                el.textContent.includes(prof) && 
                el.textContent.includes('Especialidad:') &&
                el.offsetParent !== null
            );
            if (profesionalEl) {
                profesionalEl.click();
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
        
        await page.waitForTimeout(5000);
        
        // Extraer horas
        const horas = await page.evaluate(() => {
            const horasData = [];
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
            
            lines.forEach(line => {
                const horaMatch = line.match(/(\d{1,2}):(\d{2})/);
                if (horaMatch) {
                    const disponible = line.includes('DISPONIBLE');
                    horasData.push({
                        hora: horaMatch[0],
                        disponible: disponible,
                        estado: line.includes('DISPONIBLE') ? 'DISPONIBLE' : 'OCUPADO'
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
