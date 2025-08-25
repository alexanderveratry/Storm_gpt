import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
const MOCK = process.env.MOCK_OPENAI === 'true';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const app = express();
app.use(express.json());
// Add mild caching for static assets (not HTML)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(?:js|css|svg|png|jpg|jpeg|gif)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
    }
  }
}));

// Create OpenAI client with proper error handling
const client = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

if (!process.env.OPENAI_API_KEY) {
  console.warn('[WARN] Falta OPENAI_API_KEY en .env');
}

async function withRetries(fn, {tries=3, base=400} = {}) {
  let lastErr;
  for (let i=0; i<tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const status = e.status || e.response?.status;
      if (status && status < 500 && status !== 429) throw e; // no reintentar 4xx (excepto 429)
      await sleep(base * Math.pow(2, i)); // 400ms, 800ms, 1600ms
    }
  }
  throw lastErr;
}

// cache simple en memoria para embeddings (evita pagar por textos repetidos)
const embedCache = new Map();
function keyFor(text){ return text.trim().toLowerCase(); }

app.post('/api/embeddings', async (req, res) => {
  try {
    const { input } = req.body;
    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: 'input must be a non-empty string' });
    }

    // MOCK: devuelve un vector corto normalizado
    if (MOCK) {
      const h = Array.from(input).reduce((s,c)=> (s*31 + c.charCodeAt(0))>>>0, 7);
      const vec = new Array(10).fill(0).map((_,i)=> ((h>>i)&1) ? 1 : 0.3);
      const m = Math.hypot(...vec); return res.json({ embedding: vec.map(v=>v/m) });
    }

    const k = keyFor(input);
    if (embedCache.has(k)) return res.json({ embedding: embedCache.get(k) });

    const data = await withRetries(() =>
      client.embeddings.create({ model: 'text-embedding-3-small', input })
    );

    const emb = data.data[0].embedding;
    embedCache.set(k, emb);
    res.json({ embedding: emb });
  } catch (e) {
    console.error('Embeddings error:', e.status, e.message);
    if (e.status === 429) return res.status(429).json({ error: 'Rate limit / quota' });
    res.status(500).json({ error: 'Embeddings failed' });
  }
});

// New endpoint for summary generation using OpenAI responses API
app.post('/api/summary', async (req, res) => {
  try {
    console.log('📝 Summary API called');
    console.log('Request body structure:', JSON.stringify(req.body, null, 2));
    console.log('Summary API called with:', { 
      inputLength: req.body?.input?.[0]?.content?.[0]?.text?.length,
      model: req.body?.model,
      verbosity: req.body?.text?.verbosity,
      mockMode: MOCK
    });
    
    const { model = 'gpt-5-nano', input, text, reasoning, tools, store } = req.body || {};

    // Validate input
    if (!input || !Array.isArray(input) || input.length === 0) {
      console.error('Invalid input:', input);
      return res.status(400).json({ error: 'input must be a non-empty array' });
    }

    const inputText = input[0]?.content?.[0]?.text;
    if (!inputText || typeof inputText !== 'string') {
      console.error('Invalid input text:', inputText);
      return res.status(400).json({ error: 'input text must be a non-empty string' });
    }

    // MOCK: responde sin llamar a OpenAI
    if (MOCK) {
      const words = inputText.trim().split(/\s+/).slice(0, 8);
      const mockSummary = words.join(' ') + (inputText.trim().split(/\s+/).length > 8 ? '...' : '');
      console.log('🎭 MOCK mode - generating summary for:', inputText.substring(0, 50) + '...');
      console.log('🎭 MOCK summary generated:', mockSummary);
      return res.json({ content: mockSummary });
    }

    // Skip the experimental responses API and use chat completions directly
    console.log('🔄 Using chat completions API for summary generation...');
    const systemPrompt = "Extrae las ideas principales del texto y devuélvelas como palabras clave separadas por comas. Enfócate en conceptos clave, temas importantes y palabras relevantes. ";
    
    // Use a more reliable model for summaries
    const summaryModel = model === 'gpt-5-nano' ? 'gpt-5-nano' : model;

    const requestParams = {
      model: summaryModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: inputText }
      ],
    };

    console.log('📡 Sending chat completion request with params:', {
      model: requestParams.model,
      messageCount: requestParams.messages.length,
      maxTokens: requestParams.max_tokens,
      inputLength: inputText.length
    });

    const data = await withRetries(() =>
      client.chat.completions.create(requestParams)
    );

    const content = data?.choices?.[0]?.message?.content?.trim() || '';
    console.log('✅ Chat completion success! Response length:', content.length);
    console.log('📄 Summary content preview:', content.substring(0, 100) + '...');
    
    // Ensure we have valid content
    if (!content) {
      console.log('⚠️ Empty response from API, generating fallback summary...');
      const words = inputText.trim().split(/\s+/).slice(0, 8);
      const fallbackContent = words.join(' ') + (inputText.trim().split(/\s+/).length > 8 ? '...' : '');
      console.log('🔄 Fallback summary generated:', fallbackContent);
      return res.json({ content: fallbackContent, usage: data?.usage });
    }
    
    res.json({ content, usage: data.usage });
  } catch (e) {
    console.error('❌ Summary error details:', {
      status: e.status,
      message: e.message,
      response: e.response?.data || e.response?.body || 'no response data'
    });
    console.error('Full error object:', e);
    if (e.status === 429) return res.status(429).json({ error: 'Rate limit / quota' });
    const hint = /model.*not.*found|unknown.*model|does not exist|unsupported model/i.test(e.message)
      ? 'Modelo no encontrado o no disponible para tu organización.'
      : undefined;
    res.status(500).json({ 
      error: 'Summary failed: ' + (e.message || 'unknown error'),
      hint 
    });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    console.log('Chat API called with:', { 
      messagesCount: req.body?.messages?.length,
      system: req.body?.system?.substring(0, 50),
      model: req.body?.model 
    });
    const { messages, system, model = 'gpt-5-nano' } = req.body || {};


    // Validate input
    if (!messages || !Array.isArray(messages)) {
      console.error('Invalid messages:', messages);
      return res.status(400).json({ error: 'messages must be an array' });
    }

    if (messages.length === 0) {
      console.error('Empty messages array');
      return res.status(400).json({ error: 'messages array cannot be empty' });
    }

    // MOCK: responde sin llamar a OpenAI
    if (MOCK) {
      const last = messages?.slice(-1)?.[0]?.content || '';
      console.log('MOCK response for:', last.substring(0, 30));
      return res.json({ content: `MOCK: te leí "${last}". ¿Seguimos?` });
    }

    // The 'messages' array represents the conversation history (context).
    // Each message has a 'role' (user, assistant, system) and 'content'.
    // The context is sent to the AI model so it can generate a relevant response.
    // The 'system' message sets the behavior/persona of the AI.
    // The model uses the entire array as context for its reply.
    const requestParams = {
      model: model,
      messages: [{ role: 'system', content: system || 'You are helpful.' }, ...messages],
      temperature: 1,
    };

    console.log('Calling OpenAI with model:', model, 'messages:', messages.length);

    const data = await withRetries(() =>
      client.chat.completions.create(requestParams)
    );

    const content = data?.choices?.[0]?.message?.content?.trim() || '';
    console.log('OpenAI response length:', content.length);
    
    res.json({ content, usage: data.usage });
  } catch (e) {
    console.error('Chat error details:', {
      status: e.status,
      message: e.message,
      response: e.response?.data || e.response?.body || 'no response data'
    });
    if (e.status === 429) return res.status(429).json({ error: 'Rate limit / quota' });
    const hint = /model.*not.*found|unknown.*model|does not exist|unsupported model/i.test(e.message)
      ? 'Modelo no encontrado o no disponible para tu organización.'
      : undefined;
    res.status(500).json({ 
      error: 'Chat failed: ' + (e.message || 'unknown error'),
      hint 
    });
  }
});


// ✅ usa RegExp en vez de '*'
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));

