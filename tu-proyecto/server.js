import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
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

// Configuración de Hugging Face para generación de imágenes
const HF_TOKEN = process.env.HF_TOKEN || 'hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const HF_API_URL = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';

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

    // Validate input (Responses API-like shape)
    if (!input || !Array.isArray(input) || input.length === 0) {
      console.error('Invalid input:', input);
      return res.status(400).json({ error: 'input must be a non-empty array' });
    }

    // Extract developer instructions and user text from the provided array
    const developerBlocks = input.find((b) => b?.role === 'developer')?.content ?? [];
    const userBlocks = input.find((b) => b?.role === 'user')?.content ?? [];
    const developerInstruction = developerBlocks
      .filter((c) => c && c.type === 'input_text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim();
    const userText = userBlocks
      .filter((c) => c && c.type === 'input_text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim();

    if (!userText) {
      console.error('Invalid or missing user text in input:', userBlocks);
      return res.status(400).json({ error: 'user input text must be a non-empty string' });
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
    // Prefer the developer instruction provided by the client; fallback to a safe default
    const defaultPrompt = 'Ignora reiteraciones y limita a ideas principales. Devuelve solo conceptos clave, separados por comas. La respuesta no puede ser mayor que el input.';
    const systemPrompt = (developerInstruction || defaultPrompt).trim();

    // Use requested model (keep nano if specified)
    const summaryModel = model || 'gpt-5-nano';

    const requestParams = {
      model: summaryModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
    };

    console.log('📡 Sending chat completion request with params:', {
      model: requestParams.model,
      messageCount: requestParams.messages.length,
      maxTokens: requestParams.max_tokens,
      inputLength: userText.length
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
      const words = userText.trim().split(/\s+/).slice(0, 8);
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

// Hugging Face Text-to-Image API endpoint
app.post('/api/generate-image', async (req, res) => {
  try {
    const { text, options = {}, nodeId } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: 'Falta text para generar imagen' });
    }

    console.log('Sending request to Hugging Face with text:', text);

    // Usar GPT-5 Nano para reducir el texto a un concepto clave
    let cleanText;
    try {
      console.log('🧠 Using GPT-5 Nano to extract key concept from:', text);
      
      const conceptResponse = await withRetries(() =>
        client.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [
            { 
              role: 'system', 
              content: 'Reduce el texto a 1-2 palabras clave que representen el concepto principal. Solo responde con las palabras clave, sin explicaciones. Ejemplos: "Camada: 2–5 gatitos" → "camada gatos", "¿Qué come un perro?" → "perro comida"' 
            },
            { role: 'user', content: text }
          ],
          temperature: 0.3,
          max_tokens: 10
        })
      );
      
      cleanText = conceptResponse?.choices?.[0]?.message?.content?.trim() || text;
      console.log('🎯 Key concept extracted:', cleanText);
    } catch (error) {
      console.error('❌ Error extracting concept, using fallback:', error.message);
      // Fallback: usar método original si GPT falla
      cleanText = text.trim().replace(/^(un|una|el|la)\s+/i, '');
    }
    
    // Agregar contexto automáticamente al prompt para generar stickers
    const enhancedPrompt = `imagen de un ${cleanText} animado simple, formato sticker cute`;
    console.log('Enhanced prompt:', enhancedPrompt);

    const payload = {
      inputs: enhancedPrompt,
      parameters: {
        negative_prompt: options.negativePrompt || "",
        num_inference_steps: options.steps || 20,
        guidance_scale: options.guidanceScale || 7.5,
        width: options.width || 512,
        height: options.height || 512,
      }
    };

    const resp = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    console.log('Hugging Face response status:', resp.status);

    if (!resp.ok) {
      const errorText = await resp.text();
      console.log('Hugging Face error response:', errorText);
      throw new Error(`Hugging Face API error: ${resp.status} ${resp.statusText} - ${errorText}`);
    }

    // La respuesta es un blob (imagen)
    const imageBuffer = await resp.arrayBuffer();
    
    // Crear carpeta de stickers si no existe
    const stickersDir = path.join(__dirname, 'public', 'stickers');
    if (!fs.existsSync(stickersDir)) {
      fs.mkdirSync(stickersDir, { recursive: true });
    }
    
    // Generar nombre único para la imagen
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = cleanText.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const fileName = `${nodeId || 'sticker'}_${safeName}_${timestamp}.jpg`;
    const filePath = path.join(stickersDir, fileName);
    
    // Guardar imagen en disco
    fs.writeFileSync(filePath, Buffer.from(imageBuffer));
    
    // URL relativa para acceder a la imagen
    const stickerUrl = `/stickers/${fileName}`;
    
    console.log('Hugging Face success - image generated and saved:', filePath);
    res.json({ 
      output_url: stickerUrl, // Ahora devuelve la URL del archivo guardado
      file_path: filePath,
      success: true,
      message: 'Imagen generada exitosamente',
      prompt: text,
      enhanced_prompt: enhancedPrompt
    });
  } catch (err) {
    console.error('Hugging Face error:', err);
    res.status(500).json({ error: 'Error llamando a Hugging Face', detail: err.message });
  }
});

// Test endpoint to verify Hugging Face API
app.post('/api/test-hf', async (_req, res) => {
  try {
    console.log('Testing Hugging Face API connection...');
    
    const payload = {
      inputs: "imagen de un gato animado simple, formato sticker cute",
      parameters: {
        num_inference_steps: 10,
        width: 256,
        height: 256,
      }
    };

    const resp = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    console.log('Hugging Face test response status:', resp.status);

    if (!resp.ok) {
      const errorText = await resp.text();
      console.log('Hugging Face test error response:', errorText);
      return res.status(resp.status).json({ 
        error: 'Hugging Face API test failed', 
        status: resp.status, 
        statusText: resp.statusText,
        response: errorText 
      });
    }

    res.json({ 
      success: true, 
      message: 'Hugging Face API connection successful'
    });
  } catch (err) {
    console.error('Hugging Face test error:', err);
    res.status(500).json({ error: 'Hugging Face API test error', detail: err.message });
  }
});

// Endpoint para exportar y guardar chats
app.post('/api/export-chat', async (req, res) => {
  try {
    const { data, filename } = req.body;
    
    if (!data || !filename) {
      return res.status(400).json({ error: 'Data and filename are required' });
    }

    // Crear nombre de archivo único con timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeFilename = filename.replace(/[^a-zA-Z0-9\-_]/g, '_');
    const fullFilename = `${safeFilename}_${timestamp}.json`;
    
    // Ruta de la carpeta saved_chats
    const savedChatsDir = path.join(__dirname, 'saved_chats');
    const filePath = path.join(savedChatsDir, fullFilename);
    
    // Asegurar que el directorio existe
    if (!fs.existsSync(savedChatsDir)) {
      fs.mkdirSync(savedChatsDir, { recursive: true });
    }

    // Guardar el archivo
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    console.log(`💾 Chat saved: ${fullFilename}`);
    
    res.json({ 
      success: true, 
      filename: fullFilename,
      message: 'Chat exported and saved successfully' 
    });
  } catch (err) {
    console.error('Export chat error:', err);
    res.status(500).json({ error: 'Failed to export chat', detail: err.message });
  }
});

// Endpoint para listar chats guardados
app.get('/api/saved-chats', async (req, res) => {
  try {
    const savedChatsDir = path.join(__dirname, 'saved_chats');
    
    // Verificar si el directorio existe
    if (!fs.existsSync(savedChatsDir)) {
      return res.json({ chats: [] });
    }

    // Leer archivos del directorio
    const files = fs.readdirSync(savedChatsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(savedChatsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          displayName: file.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/, ''),
          created: stats.birthtime,
          modified: stats.mtime,
          size: stats.size
        };
      })
      .sort((a, b) => b.modified - a.modified); // Más recientes primero

    res.json({ chats: files });
  } catch (err) {
    console.error('List saved chats error:', err);
    res.status(500).json({ error: 'Failed to list saved chats', detail: err.message });
  }
});

// Endpoint para cargar un chat guardado
app.get('/api/saved-chats/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const savedChatsDir = path.join(__dirname, 'saved_chats');
    const filePath = path.join(savedChatsDir, filename);
    
    // Verificación de seguridad - asegurar que el archivo esté en saved_chats
    if (!filePath.startsWith(savedChatsDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Chat file not found' });
    }

    const data = fs.readFileSync(filePath, 'utf8');
    const chatData = JSON.parse(data);
    
    res.json({ success: true, data: chatData });
  } catch (err) {
    console.error('Load saved chat error:', err);
    res.status(500).json({ error: 'Failed to load saved chat', detail: err.message });
  }
});

// ✅ usa RegExp en vez de '*'
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));

