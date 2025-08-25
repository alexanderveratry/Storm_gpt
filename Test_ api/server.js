import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai/index.mjs';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] Falta OPENAI_API_KEY en .env');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Modelos recomendados/soportados por la app (se envían al cliente)
const MODELS = [
  // Frontier models
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  // Otros modelos populares
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1-mini'
];

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Devuelve la lista de modelos que la app permite seleccionar
app.get('/api/models', (_req, res) => {
  res.json({ models: MODELS });
});

app.post('/api/chat', async (req, res) => {
  try {
  const { message, model = 'gpt-5-nano' } = req.body || {}; // El servidor acepta cualquier modelo que soporte la API
    if (!message) {
      return res.status(400).json({ error: 'Falta message' });
    }

    // Chat Completions API
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Eres un asistente útil.' },
        { role: 'user', content: message }
      ],
      temperature: 1,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || '';
    res.json({ reply, usage: completion.usage });
  } catch (err) {
    console.error('OpenAI error:', err);
    const status = err?.status || err?.response?.status || 500;
    // Mensaje más claro cuando el modelo no existe o no está habilitado
    const rawMsg = err?.message || err?.response?.data?.error?.message || String(err);
    const hint = /model.*not.*found|unknown.*model|does not exist|unsupported model/i.test(rawMsg)
      ? 'Modelo no encontrado o no disponible para tu organización.'
      : undefined;
    res.status(status).json({ error: 'Error llamando a OpenAI', detail: rawMsg, hint });
  }
});

app.listen(port, () => {
  console.log(`Proyecto2 escuchando en http://localhost:${port}`);
});
