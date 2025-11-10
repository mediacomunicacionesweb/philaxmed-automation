// server.js (ejemplo Node + Express)
const express = require('express');
const fetch = require('node-fetch'); // o global fetch en Node >=18
const app = express();
app.use(express.json());

const RENDER_BASE = 'https://philaxmed-automation.onrender.com';

app.get('/api/kommo/profesionales', async (req, res) => {
  try {
    const agenda = req.query.agenda || 'kineyfisio';
    const especialidad = req.query.especialidad || 'KINESIOLOGÍA';
    const url = `${RENDER_BASE}/api/profesionales?agenda=${encodeURIComponent(agenda)}&especialidad=${encodeURIComponent(especialidad)}`;
    const r = await fetch(url, { timeout: 20000 });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('application/json')) {
      const text = await r.text();
      return res.status(502).json({ success: false, error: 'Bad upstream response', raw: text.slice(0,2000) });
    }
    const data = await r.json();
    // normalizar a array de objetos { nombre, value }
    const items = (data.profesionales_objects && data.profesionales_objects.length)
      ? data.profesionales_objects.map(p => ({ nombre: p.nombre, value: p.value || p.nombre }))
      : (data.profesionales || []).map(n => ({ nombre: n, value: n }));
    return res.json({ success: true, profesionales: items });
  } catch (err) {
    console.error('error /api/kommo/profesionales', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API listening on', PORT));
