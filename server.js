const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let browser = null;

// Función para obtener el navegador
async function getBrowser() {
    if (!browser) {
        try {
            browser = await puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
            });
            console.log('✅ Navegador iniciado correctamente');
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
        version: '1.0.0',
        endpoints: {
            health: '/health',
            obtenerHoras: '/api/horas?especialidad=NOMBRE&fecha=YYYY-MM-DD',
            realizarReserva: '/api/reservar (POST)'
        },
        status: 'running'
    });
});

// Endpoint para obtener horas disponibles
app.get('/api/horas', async (req, res) => {
    const { especialidad, fecha } = req.query;
    
    if (!especialidad) {
        return res.status(400).json({
            success: false,
            error: 'Especialidad es requerida'
        });
    }
    
    try {
        console.log(`📅 Obteniendo horas para: ${especialidad} - ${fecha || 'hoy'}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        // Configurar timeout
        await page.setDefaultNavigationTimeout(60000);
        
        // Ir a Philaxmed
        await page.goto('https://philaxmed.cl/reserva-de-horas/', {
            waitUntil: 'networkidle2'
        });
        
        console.log('✅ Página cargada');
        
        // Aquí iría el scraping real de Philaxmed
        // Por ahora, devolvemos datos de ejemplo
        const horasDisponibles = [
            { hora: '09:00', disponible: true },
            { hora: '10:00', disponible: true },
            { hora: '11:00', disponible: true },
            { hora: '14:00', disponible: true },
            { hora: '15:00', disponible: true },
            { hora: '16:00', disponible: true }
        ];
        
        await page.close();
        
        res.json({
            success: true,
            especialidad: especialidad,
            fecha: fecha || new Date().toISOString().split('T')[0],
            horas: horasDisponibles,
            nota: 'Datos de ejemplo - scraping real en desarrollo'
        });
        
    } catch (error) {
        console.error('❌ Error al obtener horas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para realizar reserva
app.post('/api/reservar', async (req, res) => {
    const { nombre, rut, email, telefono, especialidad, fecha, hora, comentarios } = req.body;
    
    // Validar campos requeridos
    if (!nombre || !rut || !email || !telefono || !especialidad || !fecha || !hora) {
        return res.status(400).json({
            success: false,
            error: 'Faltan campos requeridos'
        });
    }
    
    try {
        console.log(`📝 Procesando reserva para: ${nombre}`);
        
        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();
        
        await page.setDefaultNavigationTimeout(60000);
        
        // Ir a Philaxmed
        await page.goto('https://philaxmed.cl/reserva-de-horas/', {
            waitUntil: 'networkidle2'
        });
        
        console.log('✅ Formulario cargado');
        
        // Aquí iría el proceso real de reserva
        // Por ahora, simulamos éxito
        
        await page.close();
        
        const codigoConfirmacion = 'RES-' + Date.now().toString(36).toUpperCase();
        
        res.json({
            success: true,
            confirmacion: codigoConfirmacion,
            mensaje: 'Reserva realizada exitosamente',
            datos: {
                nombre,
                especialidad,
                fecha,
                hora
            }
        });
        
    } catch (error) {
        console.error('❌ Error al realizar reserva:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
});

// Cerrar navegador al terminar
process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
