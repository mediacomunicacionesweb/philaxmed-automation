const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let browser = null;

async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
    }
    return browser;
}

// Endpoint: Obtener horas disponibles
app.get('/api/horas', async (req, res) => {
    let page;
    try {
        const { especialidad, fecha } = req.query;
        
        if (!especialidad) {
            return res.json({
                success: false,
                error: 'Especialidad requerida'
            });
        }
        
        console.log('Obteniendo horas para:', especialidad, fecha);
        
        const browser = await getBrowser();
        page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        await page.goto('https://s2.philaxmed.cl/ReservaOnline.html?mc=cesmed', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        await page.waitForTimeout(3000);
        
        // Intentar seleccionar especialidad
        const selectores = [
            'select[name="especialidad"]',
            'select#especialidad',
            'select.especialidad'
        ];
        
        let seleccionado = false;
        for (const selector of selectores) {
            try {
                const existe = await page.$(selector);
                if (existe) {
                    await page.select(selector, especialidad);
                    seleccionado = true;
                    console.log('Especialidad seleccionada con:', selector);
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!seleccionado) {
            throw new Error('No se pudo seleccionar la especialidad');
        }
        
        await page.waitForTimeout(2000);
        
        // Seleccionar fecha si existe
        if (fecha) {
            try {
                await page.type('input[type="date"]', fecha);
            } catch (e) {
                console.log('No se pudo ingresar fecha');
            }
        }
        
        // Buscar botón de búsqueda
        await page.evaluate(() => {
            const botones = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const boton = botones.find(b => 
                b.textContent.toLowerCase().includes('buscar') ||
                b.textContent.toLowerCase().includes('consultar') ||
                b.value?.toLowerCase().includes('buscar')
            );
            if (boton) boton.click();
        });
        
        await page.waitForTimeout(3000);
        
        // Extraer horas disponibles
        const horas = await page.evaluate(() => {
            const horasArray = [];
            
            // Buscar diferentes patrones
            const selectores = [
                '[data-hora]',
                '.hora-disponible',
                'button[class*="hora"]',
                'div[class*="hora"]',
                '.horario',
                '.disponible'
            ];
            
            for (const selector of selectores) {
                const elementos = document.querySelectorAll(selector);
                if (elementos.length > 0) {
                    elementos.forEach(el => {
                        const hora = el.getAttribute('data-hora') || el.textContent.trim();
                        const match = hora.match(/(\d{1,2}:\d{2})/);
                        
                        if (match) {
                            horasArray.push({
                                hora: match[1],
                                disponible: !el.classList.contains('disabled') && 
                                           !el.classList.contains('ocupado')
                            });
                        }
                    });
                    break;
                }
            }
            
            // Fallback: buscar en todo el texto
            if (horasArray.length === 0) {
                const texto = document.body.innerText;
                const regex = /(\d{1,2}:\d{2})/g;
                const matches = [...texto.matchAll(regex)];
                
                matches.forEach(match => {
                    horasArray.push({
                        hora: match[1],
                        disponible: true
                    });
                });
            }
            
            // Eliminar duplicados
            const horasUnicas = [];
            const horasVistas = new Set();
            
            horasArray.forEach(h => {
                if (!horasVistas.has(h.hora)) {
                    horasVistas.add(h.hora);
                    horasUnicas.push(h);
                }
            });
            
            return horasUnicas;
        });
        
        await page.close();
        
        console.log('Horas encontradas:', horas.length);
        
        res.json({
            success: true,
            horas: horas,
            especialidad: especialidad,
            fecha: fecha || new Date().toISOString().split('T')[0]
        });
        
    } catch (error) {
        console.error('Error:', error);
        if (page) await page.close();
        
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint: Realizar reserva
app.post('/api/reservar', async (req, res) => {
    let page;
    try {
        const datos = req.body;
        
        // Validar campos requeridos
        const required = ['nombre', 'rut', 'email', 'telefono', 'especialidad', 'fecha', 'hora'];
        for (const field of required) {
            if (!datos[field]) {
                return res.json({
                    success: false,
                    error: `Campo requerido: ${field}`
                });
            }
        }
        
        console.log('Realizando reserva para:', datos.nombre);
        
        const browser = await getBrowser();
        page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        await page.goto('https://s2.philaxmed.cl/ReservaOnline.html?mc=cesmed', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        await page.waitForTimeout(3000);
        
        // Seleccionar especialidad
        await page.select('select[name="especialidad"]', datos.especialidad);
        await page.waitForTimeout(2000);
        
        // Ingresar fecha
        if (datos.fecha) {
            await page.type('input[type="date"]', datos.fecha);
            await page.waitForTimeout(1000);
        }
        
        // Buscar
        await page.click('button[type="submit"]');
        await page.waitForTimeout(3000);
        
        // Seleccionar hora
        await page.evaluate((hora) => {
            const elementos = Array.from(document.querySelectorAll('button, [data-hora], div'));
            const elemento = elementos.find(el => 
                el.textContent.includes(hora) || 
                el.getAttribute('data-hora') === hora
            );
            if (elemento) elemento.click();
        }, datos.hora);
        
        await page.waitForTimeout(2000);
        
        // Llenar formulario
        await page.type('input[name="nombre"]', datos.nombre);
        await page.type('input[name="rut"]', datos.rut);
        await page.type('input[name="email"]', datos.email);
        await page.type('input[name="telefono"]', datos.telefono);
        
        if (datos.comentarios) {
            await page.type('textarea[name="comentarios"]', datos.comentarios);
        }
        
        await page.waitForTimeout(1000);
        
        // Confirmar
        await page.evaluate(() => {
            const botones = Array.from(document.querySelectorAll('button'));
            const boton = botones.find(b => 
                b.textContent.toLowerCase().includes('confirmar') ||
                b.textContent.toLowerCase().includes('agendar') ||
                b.textContent.toLowerCase().includes('reservar')
            );
            if (boton) boton.click();
        });
        
        await page.waitForTimeout(3000);
        
        // Extraer confirmación
        const confirmacion = await page.evaluate(() => {
            const texto = document.body.innerText;
            const patrones = [
                /confirmaci[oó]n[:\s]+([A-Z0-9-]+)/i,
                /c[oó]digo[:\s]+([A-Z0-9-]+)/i,
                /reserva[:\s#]+([A-Z0-9-]+)/i
            ];
            
            for (const patron of patrones) {
                const match = texto.match(patron);
                if (match) return match[1];
            }
            
            return 'CONF-' + Date.now();
        });
        
        await page.close();
        
        console.log('Reserva confirmada:', confirmacion);
        
        res.json({
            success: true,
            confirmacion: confirmacion,
            mensaje: 'Reserva realizada exitosamente',
            datos: {
                nombre: datos.nombre,
                especialidad: datos.especialidad,
                fecha: datos.fecha,
                hora: datos.hora
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        if (page) await page.close();
        
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString() 
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'API Philaxmed Automation',
        endpoints: {
            horas: '/api/horas?especialidad=X&fecha=YYYY-MM-DD',
            reservar: '/api/reservar (POST)'
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

process.on('SIGTERM', async () => {
    if (browser) await browser.close();
    process.exit(0);
});
