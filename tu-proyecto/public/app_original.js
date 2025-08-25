/*
 * app.js — Conversational Tree
 * Visualizador de árbol conversacional con memoria contextual.
 * Usa D3.js para renderizar y manipular el árbol de conversación.
 */
/* global d3 */
'use strict';

/* --------------------------------------------------------------------------------
 * Constants & Utilities
 * ------------------------------------------------------------------------------*/


// Dimensiones para los vectores de embedding (representación semántica de texto)
const EMBEDDING_DIM_SMALL = 10;
const EMBEDDING_DIM_FALLBACK = 1536;


// Intervalo para generar resúmenes y límites de zoom en el árbol
const SUMMARY_INTERVAL_MS = 10000; // Cambiado de 2000ms a 10000ms (10 segundos)
const ZOOM_EXTENT = [0.1, 3];


// Parámetros de diseño para el árbol y etiquetas
const LAYOUT = {
  // Distancia horizontal entre padre e hijos
  levelDX: 260,
  // Espacio vertical mínimo entre hermanos
  siblingGapMin: 90,
  // Dimensiones de las etiquetas
  // offset:  controla cuánto se separa la caja de la etiqueta respecto al nodo al que pertenece,
  label: { w: 240, h: 150, offset: 30 },
  wrapperMargin: 8,
  wrapperGap: 20,
  repelIterations: 5,
};


// Splash screen duration (in milliseconds)
const SPLASH_DURATION = 3000; // 3 seconds

// Selectores de elementos del DOM usados en la app
const SELECTORS = {
  svg: '#treeSvg',
  tooltip: '#tooltip',
  messageForm: '#messageForm',
  messageInput: '#messageInput',
  importFile: '#importFile',
  controls: '.controls',
  chatArea: '#chatArea',
  memoryContext: '#memoryContext',
  infoPanel: '#infoPanel',
  nodeInfo: '#nodeInfo',
  statusBar: '#statusBar',
  modelSelector: '#modelSelector',
};


// Escapa caracteres peligrosos para evitar XSS en HTML
const escapeHTML = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));


// Acorta un string a n caracteres, agregando "…" si es necesario
const truncate = (s, n = 160) => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/* --------------------------------------------------------------------------------
 * Splash Screen Functions
 * ------------------------------------------------------------------------------*/

// Check if this is a fresh app launch (not a navigation)
function isFreshAppLaunch() {
  // Check if we've shown the splash screen in this session
  const hasShownSplash = sessionStorage.getItem('splashShown');
  console.log('🔍 Checking if fresh app launch. hasShownSplash:', hasShownSplash);
  const isFresh = !hasShownSplash;
  console.log('🔍 isFreshAppLaunch result:', isFresh);
  return isFresh;
}

// Mark that splash screen has been shown
function markSplashShown() {
  console.log('📝 Marking splash as shown in session storage');
  sessionStorage.setItem('splashShown', 'true');
}

// Initialize splash screen and app
function initializeSplashScreen() {
  console.log('🚀 Initializing splash screen...');
  const splashScreen = document.getElementById('splashScreen');
  const mainApp = document.getElementById('mainApp');
  
  if (!splashScreen || !mainApp) {
    console.warn('Splash screen elements not found, showing main app directly');
    showMainApp();
    return;
  }
  
  console.log('✅ Splash screen elements found');
  // Show splash screen initially
  splashScreen.style.display = 'flex';
  mainApp.classList.add('hidden');
  
  console.log(`⏰ Setting timeout for ${SPLASH_DURATION}ms`);
  // After the splash duration, transition to main app
  setTimeout(() => {
    console.log('⏰ Timeout fired, hiding splash screen...');
    hideSplashScreen();
  }, SPLASH_DURATION);
}

function hideSplashScreen() {
  console.log('🎭 Hiding splash screen...');
  const splashScreen = document.getElementById('splashScreen');
  const mainApp = document.getElementById('mainApp');
  
  if (splashScreen) {
    console.log('✅ Splash screen element found, applying fade out');
    splashScreen.style.opacity = '0';
    splashScreen.style.transition = 'opacity 0.5s ease-out';
    
    setTimeout(() => {
      console.log('📱 Showing main app...');
      splashScreen.style.display = 'none';
      showMainApp();
    }, 500);
  } else {
    console.log('❌ Splash screen element not found, showing main app directly');
    showMainApp();
  }
}

function showMainApp() {
  console.log('📱 showMainApp called');
  const mainApp = document.getElementById('mainApp');
  if (mainApp) {
    console.log('✅ Main app element found, showing it');
    mainApp.classList.remove('hidden');
    mainApp.style.opacity = '0';
    mainApp.style.transition = 'opacity 0.5s ease-in';
    
    // Trigger fade-in animation
    setTimeout(() => {
      mainApp.style.opacity = '1';
      console.log('✨ Main app fully visible');
    }, 50);
  } else {
    console.log('❌ Main app element not found');
  }
}


// Hash simple para strings (usado en embeddings)
const hash32 = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};


// Normaliza un vector numérico
const normalize = (v) => {
  const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return m ? v.map((x) => x / m) : v.slice();
};


// Calcula la similitud coseno entre dos vectores
const cosine = (a, b) => {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const ma = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const mb = Math.sqrt(b.reduce((s, v) => s + s * 0 + v * v, 0)); // keep consistent signature
  return ma && mb ? dot / (ma * mb) : 0;
};


// Ordena nodos por fecha ascendente
const byTimeAsc = (a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0);


// Obtiene el modelo seleccionado en el selector de modelos
const getSelectedModel = () => document.querySelector(SELECTORS.modelSelector)?.value ?? 'gpt-5-nano';


// Muestra un mensaje de estado en la barra de estado
const setStatus = (msg) => {
  const el = document.querySelector(SELECTORS.statusBar);
  if (el) el.textContent = msg ?? '';
};
const clearStatus = () => setStatus('');


/**
 * @typedef {Object} TreeNode
 * Estructura de un nodo del árbol conversacional
 * @property {string} id
 * @property {string} content
 * @property {string|null} parentId
 * @property {string[]} children
 * @property {Date} timestamp
 * @property {number[]} embedding
 * @property {number} importance
 * @property {boolean} isAI
 * @property {'assistant'|'user'} role
 * @property {string|null} summary
 * @property {string[]} keywords
 * @property {boolean=} summaryGenerating
 * @property {number=} fx
 * @property {number=} fy
 * @property {number=} layoutX
 * @property {number=} layoutY
 */

/* --------------------------------------------------------------------------------
 * Core Data
 * ------------------------------------------------------------------------------*/


// Clase principal para manejar el árbol conversacional y sus nodos
class ConversationalTree {
  constructor() {
    /** @type {Map<string, TreeNode>} */
    this.nodes = new Map();
    this.rootId = null;
    this.currentNodeId = null;
    this.idCounter = 0;
  }


  // Calcula la importancia de un nodo según su contenido
  _importance(content) {
    let score = 0.3;
    score += Math.min((content?.length ?? 0) / 100, 0.3);
    for (const w of ['important', 'key', 'main', 'primary', 'crucial']) {
      if (content?.toLowerCase().includes(w)) score += 0.1;
    }
    return Math.min(score, 1);
  }


  // Genera un embedding simulado para un texto (vector numérico)
  _mockEmbedding(text) {
    const vec = new Array(EMBEDDING_DIM_SMALL).fill(0);
    for (const w of String(text ?? '').toLowerCase().split(/\s+/)) {
      if (!w) continue;
      vec[hash32(w) % EMBEDDING_DIM_SMALL] += 1;
    }
    return normalize(vec);
  }


  // Devuelve el camino desde la raíz hasta el nodo dado
  getPathToNode(id) {
    const path = [];
    let cur = id;
    while (cur && this.nodes.has(cur)) {
      path.unshift(cur);
      cur = this.nodes.get(cur).parentId;
    }
    return path;
  }


  // Calcula la relevancia de un nodo respecto a otro
  relevanceScore(node, target, proximity) {
    let score = node.importance * 0.4;
    const proxScore = proximity === 'close' ? 0.6 : proximity === 'medium' ? 0.4 : 0.2;
    score += proxScore;
    const hours = Math.abs(node.timestamp - target.timestamp) / 36e5;
    score += Math.max(0, 0.2 - hours * 0.01);
    return score;
  }


  // Obtiene los nodos más relevantes para el contexto de un nodo
  getRelevantContext(nodeId, maxResults = 5) {
    if (!this.nodes.has(nodeId)) return [];
    const target = this.nodes.get(nodeId);

    const cands = [];

    // Camino desde la raíz
    for (const id of this.getPathToNode(nodeId)) {
      if (id !== nodeId) cands.push({ node: this.nodes.get(id), proximity: 'close', reason: 'path' });
    }

    // Hermanos del nodo
    if (target.parentId) {
      const parent = this.nodes.get(target.parentId);
      for (const cid of parent.children) {
        if (cid === nodeId) continue;
        if (this.getPathToNode(nodeId).includes(cid)) continue;
        cands.push({ node: this.nodes.get(cid), proximity: 'medium', reason: 'sibling' });
      }
    }

    // Nodos semánticamente similares
    this.nodes.forEach((n, id) => {
      if (id === nodeId || cands.some((c) => c.node.id === id)) return;
      const sim = cosine(target.embedding, n.embedding);
      if (sim > 0.5) cands.push({ node: n, proximity: sim > 0.8 ? 'close' : 'medium', reason: 'semantic' });
    });

    cands.sort((a, b) => this.relevanceScore(b.node, target, b.proximity) - this.relevanceScore(a.node, target, a.proximity));
    return cands.slice(0, maxResults);
  }


  // Devuelve los datos del árbol para renderizado (nodos y enlaces)
  getTreeData() {
    if (!this.rootId) return { nodes: [], links: [] };

    const nodes = [];
    const links = [];

    this.nodes.forEach((n) => {
      nodes.push({
        id: n.id,
        content: n.content,
        importance: n.importance,
        role: n.role ?? (n.isAI ? 'assistant' : 'user'),
        parentId: n.parentId,
        layoutX: n.layoutX,
        layoutY: n.layoutY,
        fx: n.fx,
        fy: n.fy,
      });
      if (n.parentId) links.push({ source: n.parentId, target: n.id });
    });

    return { nodes, links };
  }
}

class OpenAIIntegration {
  async getEmbedding(text) {
    const body = { input: text ?? '' };
    try {
      const r = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return this.fallbackEmbedding(text);
      const data = await r.json();
      return Array.isArray(data?.embedding) ? data.embedding : this.fallbackEmbedding(text);
    } catch {
      return this.fallbackEmbedding(text);
    }
  }

  async getChatResponse(pathIds, context) {
    const system = this.buildSystemPrompt(context);
    const messages = this.buildMessageHistory(pathIds);
    const model = getSelectedModel();

    console.log('getChatResponse called with:');
    console.log('- pathIds:', pathIds);
    console.log('- context items:', context.length);
    console.log('- system prompt:', system.substring(0, 100) + '...');
    console.log('- messages:', messages);
    console.log('- model:', model);

    try {
      const requestBody = { messages, system, model };
      console.log('Sending request to /api/chat:', requestBody);

      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('Response status:', r.status);
      console.log('Response ok:', r.ok);

      if (!r.ok) {
        const errorText = await r.text();
        console.error('API error response:', errorText);
        return '';
      }

      const data = await r.json();
      console.log('API response data:', data);

      const content = typeof data?.content === 'string' ? data.content : '';
      console.log('Extracted content:', content);
      
      return content;
    } catch (error) {
      console.error('getChatResponse fetch error:', error);
      return '';
    }
  }

  buildSystemPrompt(ctxList) {
    let p =
      'helpful\n';
    for (const { node, proximity, reason } of ctxList) {
      p += `- [${proximity.toUpperCase()}-${reason}]: "${node.content}"\n`;
    }
    p += 'Instructions: consider context, reference branches, be concise, optionally suggest new branch directions.';
    return p;
  }

  buildMessageHistory(pathIds) {
    const arr = [];
    for (const id of pathIds) {
      const n = tree.nodes.get(id);
      if (!n) continue;
      const role = n.role ?? (n.isAI ? 'assistant' : 'user');
      arr.push({ role, content: n.content ?? '' });
    }
    return arr;
  }

  fallbackEmbedding(text) {
    const vec = new Array(EMBEDDING_DIM_FALLBACK).fill(0);
    for (const w of String(text ?? '').toLowerCase().split(/\s+/)) {
      if (!w) continue;
      const h = hash32(w);
      vec[h % EMBEDDING_DIM_FALLBACK] = Math.sin(h) * 0.1;
    }
    return normalize(vec);
  }
}

class EnhancedConversationalTree extends ConversationalTree {
  constructor(openai) {
    super();
    this.openai = openai;
    this.isProcessing = false;
    this.nodeViewStates = new Map(); // Track whether each node shows full content or summary
    this.globalViewMode = 'summary'; // Global view mode: 'summary' or 'content'
  }

  // Get whether a node should show full content (true) or summary (false)
  getNodeViewState(nodeId) {
    return this.nodeViewStates.get(nodeId) || false; // Default to summary view
  }

  // Set whether a node should show full content or summary
  setNodeViewState(nodeId, showFull) {
    this.nodeViewStates.set(nodeId, showFull);
  }

  // Get the global view mode
  getGlobalViewMode() {
    return this.globalViewMode;
  }

  // Set the global view mode and apply to all nodes
  setGlobalViewMode(mode) {
    this.globalViewMode = mode;
    const showFull = mode === 'content';
    
    // Apply to all existing nodes
    this.nodes.forEach((_, nodeId) => {
      this.nodeViewStates.set(nodeId, showFull);
    });
  }

  // Get effective view state for a node (considering global mode)
  getEffectiveViewState(nodeId) {
    if (this.globalViewMode === 'content') return true;
    if (this.globalViewMode === 'summary') return false;
    // If individual mode, use individual node state
    return this.getNodeViewState(nodeId);
  }

  async addNode(content, parentId = null, isBranch = false, isAI = false) {
    const id = `node_${this.idCounter++}`;
    const role = isAI ? 'assistant' : 'user';

    console.log(`🌳 Adding new node: ${id} (${role}) with parent: ${parentId}`);

    let embedding;
    try {
      embedding = await this.openai.getEmbedding(content);
    } catch {
      embedding = this.openai.fallbackEmbedding(content ?? '');
    }

    const node = {
      id,
      content: content ?? '',
      parentId: parentId ?? null,
      children: [],
      timestamp: new Date(),
      embedding,
      importance: this._importance(content ?? ''),
      isAI,
      role,
      summary: null,
      keywords: [],
    };

    this.nodes.set(id, node);

    if (parentId && this.nodes.has(parentId)) {
      this.nodes.get(parentId).children.push(id);
      console.log(`✅ Added ${id} as child of ${parentId}`);
    } else if (!this.rootId) {
      this.rootId = id;
      console.log(`🌱 Set ${id} as root node`);
    }

    this.currentNodeId = id;

    this.generateSummaryForNode(id).catch((err) => console.warn('Summary generation failed', err));
    return id;
  }

  async generateSummaryForNode(nodeId) { 
    const node = this.nodes.get(nodeId); 
    if (!node || node.summary || node.summaryGenerating) return; 
 
    // Skip if content has less than 5 words 
    const wordCount = (node.content || '').trim().split(/\s+/).filter(word => word.length > 0).length; 
    if (wordCount < 5) { 
      node.summary = node.content; 
      console.log('📝 Skipping summary for short content:', node.content.substring(0, 50));
      return; 
    } 
 
    node.summaryGenerating = true; 
    console.log('📝 Starting summary generation for node:', nodeId);
    console.log('📝 Content to summarize:', node.content.substring(0, 100) + '...');
 
    try { 
      // Use the new /api/summary endpoint that supports OpenAI responses API format
      const requestBody = {
        "model": "gpt-5-nano",
        "input": [
          {
            "role": "developer",
            "content": [
              {
                "type": "input_text",
                "text": ` Ignora reiteraciones sobre un mismo asunto y limítate solo a las ideas principales. Devuelve solo conceptos claves. La respuesta no puede ser mayor que el input.\n\n\n\n${node.content}`
              }
            ]
          }
        ],
        "text": {
          "format": {
            "type": "text"
          },
          "verbosity": "low"
        },
        "reasoning": {
          "effort": "minimal"
        },
        "tools": [],
        "store": false
      };

      console.log('🚀 Sending summary request to /api/summary');
      console.log('📤 Request body structure:', {
        model: requestBody.model,
        inputLength: requestBody.input[0].content[0].text.length,
        verbosity: requestBody.text.verbosity
      });

      const r = await fetch('/api/summary', { 
        method: 'POST', // Método HTTP POST para enviar datos
        headers: { 'Content-Type': 'application/json' }, // Especifica que enviamos JSON
        body: JSON.stringify(requestBody), 
      }); 

      console.log('📥 Summary API response status:', r.status, r.ok ? 'OK' : 'ERROR');
      
      if (!r.ok) {
        const errorText = await r.text();
        console.error('❌ Summary API error response:', errorText);
        throw new Error(String(r.status));
      }

      const data = await r.json(); 
      console.log('✅ Summary API response received:', {
        contentLength: data?.content?.length || 0,
        hasUsage: !!data?.usage
      });
      console.log('📄 Summary content preview:', data?.content?.substring(0, 100) + '...');

      const n = this.nodes.get(nodeId); 
      if (n) { 
        let summary = data?.content || '';
        
        // Clean and validate the summary
        if (summary) {
          // Remove any extra whitespace and newlines
          summary = summary.trim().replace(/\s+/g, ' ');
          
          // Split into keywords and limit to 10
          const keywords = summary.split(',')
            .map(k => k.trim())
            .filter(k => k && k.length > 0)
            .slice(0, 10); // Ensure max 10 keywords
          
          // Rejoin and set summary
          summary = keywords.join(', ');
          n.keywords = keywords;
          console.log('🔤 Generated keywords:', keywords);
        }
        
        // Fallback: generate shorter summary from content
        if (!summary || summary.length === 0) {
          const words = n.content.trim().split(/\s+/).slice(0, 8); // Max 8 words
          summary = words.join(' ') + (n.content.trim().split(/\s+/).length > 8 ? '...' : '');
          n.keywords = words.filter(w => w.length > 3); // Only meaningful words
          console.log('🔄 Using fallback summary:', summary);
        }
        
        n.summary = summary;
        console.log('✅ Summary saved for node:', nodeId, '→', summary);
      } 
    } catch (e) { 
      console.error('❌ Summary generation error for node:', nodeId, e);
      const n = this.nodes.get(nodeId); 
      if (n && !n.summary) {
        // Better fallback: extract first few meaningful words
        const words = n.content.trim().split(/\s+/)
          .filter(w => w.length > 3) // Filter out short words
          .slice(0, 6); // Max 6 meaningful words
        n.summary = words.join(' ') + (n.content.trim().split(/\s+/).length > 6 ? '...' : '');
        n.keywords = words;
        console.log('🔄 Using error fallback summary:', n.summary);
      }
      console.warn('Summarize error', e); 
    } finally { 
      const n3 = this.nodes.get(nodeId); 
      if (n3) delete n3.summaryGenerating; 
      updateVisualization(); 
      updateSidebar(); 
      console.log('🏁 Summary generation completed for node:', nodeId);
    } 
  }

  async ensureSummaries(batchSize = 2) {
    // Solo procesar si no hay operaciones de resumen en curso
    const generatingCount = [...this.nodes.values()].filter((n) => n.summaryGenerating).length;
    if (generatingCount > 0) {
      console.log(`⏸️ Skipping summary generation - ${generatingCount} summaries already in progress`);
      return;
    }

    const pending = [...this.nodes.values()].filter((n) => !n.summary && !n.summaryGenerating);
    if (pending.length === 0) {
      console.log('✅ All nodes have summaries');
      return;
    }
    
    console.log(`📝 Processing ${Math.min(pending.length, batchSize)} pending summaries out of ${pending.length} total`);
    for (const n of pending.slice(0, batchSize)) {
      this.generateSummaryForNode(n.id);
    }
  }

  async generateAIResponse() {
    if (this.isProcessing) return '';
    this.isProcessing = true;

    try {
      const current = this.nodes.get(this.currentNodeId);
      if (!current) {
        console.error('No current node found');
        return '';
      }

      const role = current.role ?? (current.isAI ? 'assistant' : 'user');
      if (role === 'user') {
        const hasAssistantChild = (current.children ?? []).some((cid) => this.nodes.get(cid)?.role === 'assistant');
        if (hasAssistantChild) return '';
      }

      const path = this.getPathToNode(this.currentNodeId);
      if (!path.length) {
        console.error('No path found to current node');
        return '';
      }

      const ctx = this.getRelevantContext(this.currentNodeId);
      console.log('Calling AI with path:', path.length, 'context:', ctx.length);
      
      const reply = await this.openai.getChatResponse(path, ctx);
      console.log('AI response received:', reply ? reply.substring(0, 50) + '...' : 'empty');

      if (reply?.trim()) {
        await this.addNode(reply, this.currentNodeId, false, true);
      }
      return reply ?? '';
    } catch (error) {
      console.error('generateAIResponse error:', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  async loadExportedNodes(arr) {
    this.nodes = new Map();
    this.rootId = null;
    this.currentNodeId = null;
    this.idCounter = 0;
    if (!Array.isArray(arr)) return;

    const parsed = arr
      .map((n) => ({ ...n, timestamp: n.timestamp ? new Date(n.timestamp) : new Date() }))
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const n of parsed) {
      const id = n.id && /^node_\d+$/.test(n.id) ? n.id : `node_${this.idCounter}`;
      const numeric = parseInt(id.split('_')[1] ?? '0', 10);
      this.idCounter = Math.max(this.idCounter, numeric + 1);

      const idx = parsed.indexOf(n);
      const role = idx === 0 ? 'assistant' : idx % 2 === 1 ? 'user' : 'assistant';

      let embedding;
      try {
        embedding = await this.openai.getEmbedding(n.content ?? '');
      } catch {
        embedding = this.openai.fallbackEmbedding(n.content ?? '');
      }

      const node = {
        id,
        content: n.content ?? '',
        parentId: n.parentId ?? null,
        children: [],
        timestamp: new Date(n.timestamp ?? Date.now()),
        embedding,
        importance: this._importance(n.content ?? ''),
        isAI: role === 'assistant',
        role,
        summary: n.summary ?? null,
        keywords: n.keywords ?? [],
      };

      this.nodes.set(id, node);
    }

    this.nodes.forEach((node) => {
      if (node.parentId && this.nodes.has(node.parentId)) this.nodes.get(node.parentId).children.push(node.id);
    });

    const roots = [...this.nodes.values()].filter((n) => !n.parentId).sort(byTimeAsc);
    this.rootId = roots[0]?.id ?? null;
    this.currentNodeId = this.rootId;
  }
}

/* --------------------------------------------------------------------------------
 * D3 Renderer — Hierarchical Parent→Children Layout
 * ------------------------------------------------------------------------------*/

class TreeRenderer {
  constructor(svgSel) {
    this.svg = d3.select(svgSel);
    this.g = this.svg.append('g');
    this.tooltipEl = document.querySelector(SELECTORS.tooltip);

    const zoom = d3.zoom().scaleExtent(ZOOM_EXTENT).on('zoom', (ev) => {
      this.g.attr('transform', ev.transform);
    });
    this.svg.call(zoom);
  }

  update() {
    if (!tree) return;
    const data = tree.getTreeData();
    this.g.selectAll('*').remove();
    if (!data.nodes.length) return;

    // adjacency
    const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
    const childrenById = new Map();
    data.nodes.forEach((n) => childrenById.set(n.id, []));
    data.links.forEach((l) => {
      if (childrenById.has(l.source)) childrenById.get(l.source).push(l.target);
    });

    // compute hierarchical positions
    this._layoutHierarchy(data, nodesById, childrenById);

    // layers
    const linkLayer = this.g.append('g').attr('class', 'link-layer');
    const wrapperLayer = this.g.append('g').attr('class', 'wrapper-layer');

    // links
    const linksData = data.links.map((l) => ({ source: nodesById.get(l.source), target: nodesById.get(l.target) }));
    const link = linkLayer
      .selectAll('line')
      .data(linksData)
      .join('line')
      .attr('class', (d) => {
        const path = tree.getPathToNode(tree.currentNodeId);
        const inPath = path.includes(d.source.id) && path.includes(d.target.id);
        return `link ${inPath ? 'active-path' : ''}`;
      })
      .attr('x1', (d) => this._posX(d.source))
      .attr('y1', (d) => this._posY(d.source))
      .attr('x2', (d) => this._posX(d.target))
      .attr('y2', (d) => this._posY(d.target));

    // nodes
    const nodeG = this.g
      .append('g')
      .selectAll('g.node-wrap')
      .data(data.nodes)
      .join('g')
      .attr('class', 'node-wrap')
      .attr('data-node-id', (d) => d.id)
      .attr('tabindex', 0)
      .call(
        d3
          .drag()
          .on('start', (_, d) => {
            d.fx = this._posX(d);
            d.fy = this._posY(d);
          })
          .on('drag', (ev, d) => {
            d.fx = ev.x;
            d.fy = ev.y;
            updatePositions();
          })
          .on('end', (ev, d) => {
            d.fx = ev.x;
            d.fy = ev.y;
            updatePositions();
          }),
      )
      .on('click', (_, d) => {
        tree.currentNodeId = d.id;
        updateAll(); // no view reset/recenter
        showNodeInfo(d);
      })
      .on('keydown', (ev, d) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          tree.currentNodeId = d.id;
          updateAll();
          showNodeInfo(d);
        }
      })
      // removed dblclick reset
      .on('mouseover', (ev, d) => this._showTooltip(ev, d))
      .on('mousemove', (ev) => this._moveTooltip(ev))
      .on('mouseout', () => this._hideTooltip())
      .attr('transform', (d) => `translate(${this._posX(d)},${this._posY(d)})`);

    nodeG
      .filter((d) => d.role === 'assistant')
      .append('circle')
      .attr('class', (d) => `node ${d.id === tree.currentNodeId ? 'active' : ''}`)
      .attr('r', (d) => 8 + (d.importance ?? 0) * 4);

    nodeG
      .filter((d) => d.role !== 'assistant')
      .append('rect')
      .attr('class', (d) => `node user ${d.id === tree.currentNodeId ? 'active' : ''}`)
      .attr('width', (d) => 16 + (d.importance ?? 0) * 8)
      .attr('height', (d) => 16 + (d.importance ?? 0) * 8)
      .attr('x', (d) => -(8 + (d.importance ?? 0) * 4))
      .attr('y', (d) => -(8 + (d.importance ?? 0) * 4))
      .attr('transform', 'rotate(45)');

    // labels
    const labels = this.g
      .append('g')
      .selectAll('foreignObject')
      .data(data.nodes)
      .join('foreignObject')
      .attr('class', 'node-label')
      .attr('width', LAYOUT.label.w)
      .attr('height', LAYOUT.label.h)
      .html((d) => {
        const full = tree.nodes.get(d.id);
        const showFull = tree.getEffectiveViewState(d.id);
        
        let displayText;
        if (showFull) {
          // Show full content
          displayText = full?.content ?? '';
        } else {
          // Show summary
          let summary = full?.summary;
          if (!summary) summary = full?.summaryGenerating ? '…' : truncate(full?.content ?? '', 160);
          displayText = summary;
        }
        
        return `<div xmlns="http://www.w3.org/1999/xhtml" class="label-box">
                  <div class="content-display">${escapeHTML(truncate(displayText, showFull ? 400 : 200))}</div>
                </div>`;
      });

    const shapeBBox = (n) => {
      if (n.role === 'assistant') {
        const r = 8 + (n.importance ?? 0) * 4;
        return { left: this._posX(n) - r, right: this._posX(n) + r, top: this._posY(n) - r, bottom: this._posY(n) + r };
      } else {
        const size = 16 + (n.importance ?? 0) * 8;
        const dist = size / Math.SQRT2;
        return {
          left: this._posX(n) - dist,
          right: this._posX(n) + dist,
          top: this._posY(n) - dist,
          bottom: this._posY(n) + dist,
        };
      }
    };

    const labelRects = () => {
      const rects = [];
      labels.each((d) => {
        rects.push({
          d,
          x: this._posX(d) - LAYOUT.label.w / 2,
          y: this._posY(d) + LAYOUT.label.offset,
          w: LAYOUT.label.w,
          h: LAYOUT.label.h,
        });
      });
      return rects;
    };

    const unionWrapperFrom = (d, rLabel) => {
      const s = shapeBBox(d);
      const m = LAYOUT.wrapperMargin;
      const left = Math.min(s.left, rLabel.x) - m;
      const right = Math.max(s.right, rLabel.x + rLabel.w) + m;
      const top = Math.min(s.top, rLabel.y) - m;
      const bottom = Math.max(s.bottom, rLabel.y + rLabel.h) + m;
      return { node: d, left, top, right, bottom, get w() { return this.right - this.left; }, get h() { return this.bottom - this.top; } };
    };

    const drawWrappersFrom = (wrappers) => {
      wrapperLayer
        .selectAll('rect')
        .data(wrappers, (w) => w.node.id)
        .join('rect')
        .attr('class', (w) => `node-wrapper-box ${w.node.id === tree.currentNodeId ? 'active' : ''}`)
        .attr('x', (w) => w.left)
        .attr('y', (w) => w.top)
        .attr('width', (w) => w.w)
        .attr('height', (w) => w.h)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('pointer-events', 'none');
    };

    const updatePositions = () => {
      link
        .attr('x1', (d) => this._posX(d.source))
        .attr('y1', (d) => this._posY(d.source))
        .attr('x2', (d) => this._posX(d.target))
        .attr('y2', (d) => this._posY(d.target));
      nodeG.attr('transform', (d) => `translate(${this._posX(d)},${this._posY(d)})`);
      labels.attr('x', (d) => this._posX(d) - LAYOUT.label.w / 2).attr('y', (d) => this._posY(d) + LAYOUT.label.offset);

      // wrappers
      let lrs = labelRects();
      const byId = new Map(lrs.map((r) => [r.d.id, r]));
      let wrappers = data.nodes.map((n) => unionWrapperFrom(n, byId.get(n.id)));
      drawWrappersFrom(wrappers);

      // repulsion of wrappers (global, prevents overlap)
      const ensureAnchors = () => {
        data.nodes.forEach((n) => {
          if (n.fx == null) n.fx = this._posX(n);
          if (n.fy == null) n.fy = this._posY(n);
        });
      };

      const resolveWrapperOverlaps = () => {
        let movedAny = false;
        for (let it = 0; it < LAYOUT.repelIterations; it++) {
          let moved = false;

          lrs = labelRects();
          const map2 = new Map(lrs.map((r) => [r.d.id, r]));
          wrappers = data.nodes.map((n) => unionWrapperFrom(n, map2.get(n.id)));

          for (let i = 0; i < wrappers.length; i++) {
            for (let j = i + 1; j < wrappers.length; j++) {
              const a = wrappers[i];
              const b = wrappers[j];

              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

              if (overlapX > 0 && overlapY > 0) {
                const needX = overlapX + LAYOUT.wrapperGap;
                const needY = overlapY + LAYOUT.wrapperGap;

                if (needX < needY) {
                  const push = needX / 2;
                  const aCenter = (a.left + a.right) / 2;
                  const bCenter = (b.left + b.right) / 2;
                  const dir = aCenter <= bCenter ? -1 : 1;
                  a.node.fx += dir * push;
                  b.node.fx -= dir * push;
                } else {
                  const push = needY / 2;
                  const aCenter = (a.top + a.bottom) / 2;
                  const bCenter = (b.top + b.bottom) / 2;
                  const dir = aCenter <= bCenter ? -1 : 1;
                  a.node.fy += dir * push;
                  b.node.fy -= dir * push;
                }
                moved = true;
              }
            }
          }

          if (moved) {
            movedAny = true;
            link
              .attr('x1', (d) => this._posX(d.source))
              .attr('y1', (d) => this._posY(d.source))
              .attr('x2', (d) => this._posX(d.target))
              .attr('y2', (d) => this._posY(d.target));
            nodeG.attr('transform', (d) => `translate(${this._posX(d)},${this._posY(d)})`);
            labels.attr('x', (d) => this._posX(d) - LAYOUT.label.w / 2).attr('y', (d) => this._posY(d) + LAYOUT.label.offset);
          } else break;
        }
        return movedAny;
      };

      ensureAnchors();
      const moved = resolveWrapperOverlaps();

      if (moved) {
        lrs = labelRects();
        const map3 = new Map(lrs.map((r) => [r.d.id, r]));
        wrappers = data.nodes.map((n) => unionWrapperFrom(n, map3.get(n.id)));
      }
      drawWrappersFrom(wrappers);
    };

    updatePositions();
  }

  /* ----- Hierarchical layout helpers ----- */

  _posX(n) { return n.fx ?? n.layoutX ?? 0; }
  _posY(n) { return n.fy ?? n.layoutY ?? 0; }

  _svgSize() {
    const node = this.svg.node();
    const bb = node.getBoundingClientRect();
    return { w: bb.width || 800, h: bb.height || 600 };
  }

  /**
   * Place roots at center, and for each parent, place children to the right (same X),
   * and pack siblings vertically around parent's Y with minimal gap (no overlap),
   * later refined by wrapper repulsion.
   */
  _layoutHierarchy(data, nodesById, childrenById) {
    // clear previous layout unless fixed
    data.nodes.forEach((n) => {
      if (n.fx == null) n.layoutX = undefined;
      if (n.fy == null) n.layoutY = undefined;
    });

    const { w, h } = this._svgSize();
    const centerX = w / 2;
    const centerY = h / 2;

    // prefer the tree.rootId as the main root
    const roots = data.nodes.filter((n) => !n.parentId);
    if (roots.length === 0) return;

    // place the first root at center; remaining roots stacked vertically
    const rootMain = nodesById.get(tree.rootId) || roots[0];
    const extraRoots = roots.filter((r) => r.id !== rootMain.id);

    this._ensurePlaced(rootMain, centerX, centerY);
    const rootGap = Math.max(LAYOUT.siblingGapMin, LAYOUT.label.h + 2 * LAYOUT.wrapperMargin);
    extraRoots.forEach((r, i) => {
      this._ensurePlaced(r, centerX, centerY + (i + 1) * rootGap);
    });

    // BFS from all roots
    const queue = [rootMain, ...extraRoots];
    const seen = new Set(queue.map((n) => n.id));

    while (queue.length) {
      const parent = queue.shift();
      const kidsIds = childrenById.get(parent.id) || [];
      const kids = kidsIds.map((id) => nodesById.get(id)).filter(Boolean);
      if (!kids.length) continue;

      // Parent anchor
      const px = this._posX(parent);
      const py = this._posY(parent);

      // children x aligned on a straight line to the right of parent
      const cx = px + LAYOUT.levelDX;

      // minimal vertical gap = label height + margin, but allow tighter if shapes are small
      const minGap = Math.max(LAYOUT.siblingGapMin, LAYOUT.label.h + 2 * LAYOUT.wrapperMargin);

      // center siblings around parent y
      const yStart = py - ((kids.length - 1) * minGap) / 2;

      kids.forEach((child, i) => {
        if (child.fx == null && child.fy == null) {
          this._ensurePlaced(child, cx, yStart + i * minGap);
        }
        if (!seen.has(child.id)) {
          seen.add(child.id);
          queue.push(child);
        }
      });
    }
  }

  _ensurePlaced(n, x, y) {
    if (n.fx == null && n.layoutX == null) n.layoutX = x;
    if (n.fy == null && n.layoutY == null) n.layoutY = y;
  }

  /* ----- tooltip ----- */

  _showTooltip(ev, d) {
    if (!this.tooltipEl) return;
    this.tooltipEl.style.display = 'block';
    this.tooltipEl.textContent = d.content ?? '';
    const off = 14;
    this.tooltipEl.style.left = `${ev.pageX + off}px`;
    this.tooltipEl.style.top = `${ev.pageY + off}px`;
    this.tooltipEl.setAttribute('aria-hidden', 'false');
  }
  _moveTooltip(ev) {
    if (!this.tooltipEl || this.tooltipEl.style.display === 'none') return;
    const off = 14;
    this.tooltipEl.style.left = `${ev.pageX + off}px`;
    this.tooltipEl.style.top = `${ev.pageY + off}px`;
  }
  _hideTooltip() {
    if (!this.tooltipEl) return;
    this.tooltipEl.style.display = 'none';
    this.tooltipEl.setAttribute('aria-hidden', 'true');
  }
}

/* --------------------------------------------------------------------------------
 * Sidebar & Memory
 * ------------------------------------------------------------------------------*/

function updateSidebar() {
  const chat = document.querySelector(SELECTORS.chatArea);
  if (!chat) return;
  chat.innerHTML = '';

  const path = tree.getPathToNode(tree.currentNodeId);
  for (const id of path) {
    const n = tree.nodes.get(id);
    const wrap = document.createElement('div');
    wrap.className = `message ${id === tree.currentNodeId ? 'active' : ''}`;
    wrap.tabIndex = 0;

    let summary = n.summary;
    if (!summary) summary = n.summaryGenerating ? 'Generando…' : truncate(n.content, 160);

    // Check current view state for this node
    const showFull = tree.getEffectiveViewState(id);
    const toggleButtonText = showFull ? '🔁 View' : '🔁View';

    wrap.innerHTML = `
      <div class="msg-summary" data-full="${showFull ? '1' : '0'}">
        <div class="summary-text" ${showFull ? 'hidden' : ''}>${escapeHTML(truncate(summary, 300))}</div>
        <div class="full-text" ${showFull ? '' : 'hidden'}>${escapeHTML(n.content)}</div>
      </div>
      <div class="message-actions">
        <button class="copy-btn" data-action="copy" data-id="${id}">Copy</button>
        <button class="regen-btn" data-action="regen" data-id="${id}">Regen</button>
        <button class="toggle-btn" data-action="toggle" data-id="${id}">${toggleButtonText}</button>
      </div>`;

    wrap.addEventListener('click', (ev) => {
      if (ev.target.closest('.message-actions')) return;
      tree.currentNodeId = id;
      updateAll();
    });

    chat.appendChild(wrap);
  }

  chat.addEventListener('click', onChatAction, { once: true });
  chat.scrollTop = chat.scrollHeight;
}

function onChatAction(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action || !id) return;
  e.stopPropagation();

  if (action === 'copy') copyNodeContent(id, btn);
  else if (action === 'regen') regenerateSummary(id, btn);
  else if (action === 'toggle') toggleMessageView(id, btn);
}

async function regenerateSummary(nodeId, btn) {
  const node = tree.nodes.get(nodeId);
  if (!node) return;
  node.summary = null;
  node.keywords = [];
  btn.disabled = true;
  btn.textContent = '…';
  await tree.generateSummaryForNode(nodeId);
  btn.textContent = 'Regen';
  btn.disabled = false;
  updateSidebar();
  updateVisualization();
}

function copyNodeContent(nodeId, btn) {
  const node = tree.nodes.get(nodeId);
  if (!node?.content) return;
  navigator.clipboard
    .writeText(node.content)
    .then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copy-success');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copy-success');
      }, 1500);
    })
    .catch((err) => {
      console.error('Copy failed', err);
      alert('Copy failed');
    });
}

function toggleMessageView(nodeId, btn) {
  // Find the message wrapper containing this button
  const messageWrap = btn.closest('.message');
  if (!messageWrap) return;
  
  const box = messageWrap.querySelector('.msg-summary');
  const summaryText = box.querySelector('.summary-text');
  const fullText = box.querySelector('.full-text');
  const isFull = box.getAttribute('data-full') === '1';
  
  // Toggle visibility
  if (isFull) {
    // Currently showing full, switch to summary
    fullText.hidden = true;
    summaryText.hidden = false;
    box.setAttribute('data-full', '0');
    btn.textContent = 'View';
    tree.setNodeViewState(nodeId, false); // Set to summary view
    // Reset global mode to allow individual control
    tree.globalViewMode = 'individual';
  } else {
    // Currently showing summary, switch to full
    summaryText.hidden = true;
    fullText.hidden = false;
    box.setAttribute('data-full', '1');
    btn.textContent = 'Show Summary';
    tree.setNodeViewState(nodeId, true); // Set to full view
    // Reset global mode to allow individual control
    tree.globalViewMode = 'individual';
  }
  
  // Update the global button to show mixed state
  const globalButton = document.querySelector('[data-action="change-view"]');
  if (globalButton) {
    globalButton.textContent = 'CHANGE VIEW (Mixed)';
  }
  
  // Update the tree visualization to reflect the change
  updateVisualization();
}

function toggleGlobalView() {
  if (!tree) return;
  
  const currentMode = tree.getGlobalViewMode();
  const newMode = currentMode === 'summary' ? 'content' : 'summary';
  
  tree.setGlobalViewMode(newMode);
  
  // Update the button text to show current state
  const button = document.querySelector('[data-action="change-view"]');
  if (button) {
    button.textContent = newMode === 'summary' ? 'CHANGE VIEW (Summary)' : 'CHANGE VIEW (Content)';
  }
  
  // Update all visualizations
  updateAll();
}

function updateMemoryContext() {
  const el = document.querySelector(SELECTORS.memoryContext);
  if (!el) return;
  const ctx = tree.getRelevantContext(tree.currentNodeId);
  el.innerHTML = '';
  for (const { node, proximity, reason } of ctx) {
    const div = document.createElement('div');
    div.className = 'context-item';
    div.innerHTML = `<span class="proximity-indicator ${proximity}"></span><strong>${reason}:</strong> ${escapeHTML(
      node.content.substring(0, 50),
    )}...`;
    el.appendChild(div);
  }
}

/* --------------------------------------------------------------------------------
 * Branching & Info
 * ------------------------------------------------------------------------------*/

function showNodeInfo(nodeData) {
  const panel = document.querySelector(SELECTORS.infoPanel);
  const info = document.querySelector(SELECTORS.nodeInfo);
  const closeBtn = document.querySelector('#closeInfoPanel');
  if (!panel || !info || !closeBtn) return;

  const node = tree.nodes.get(nodeData.id);
  info.innerHTML = `
    <div class="node-content-display">${escapeHTML(node.content)}</div>`;
  
  // Store the originating element for focus return
  panel.dataset.originatingNodeId = nodeData.id;
  
  // Show panel and update accessibility
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  
  // Move focus to the close button
  closeBtn.focus();
}

function closeNodeInfo() {
  const panel = document.querySelector(SELECTORS.infoPanel);
  if (!panel) return;

  // Hide panel and update accessibility
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  
  // Return focus to the originating node if possible
  const originatingNodeId = panel.dataset.originatingNodeId;
  if (originatingNodeId) {
    // Find the node element in the visualization and focus it
    const nodeElement = document.querySelector(`g.node-wrap[data-node-id="${originatingNodeId}"]`);
    if (nodeElement && nodeElement.tabIndex !== undefined) {
      nodeElement.focus();
    }
    // Clear the stored reference
    delete panel.dataset.originatingNodeId;
  }
}

/* --------------------------------------------------------------------------------
 * Export / Import
 * ------------------------------------------------------------------------------*/

function exportTree() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes: [...tree.nodes.values()].map((n) => ({
      id: n.id,
      content: n.content,
      parentId: n.parentId,
      timestamp: n.timestamp,
      summary: n.summary ?? null,
      keywords: n.keywords ?? [],
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'conversational-tree.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json.nodes) throw new Error('Invalid file: missing nodes');

    await tree.loadExportedNodes(json.nodes);
    updateAll();
    tree.ensureSummaries?.();
  } catch (err) {
    alert('Failed to import: ' + err.message);
  } finally {
    e.target.value = '';
  }
}

/* --------------------------------------------------------------------------------
 * App wiring
 * ------------------------------------------------------------------------------*/

let tree;
let openaiIntegration;
let renderer;

function updateVisualization() {
  renderer?.update();
}
function updateAll() {
  updateVisualization();
  updateSidebar();
  updateMemoryContext();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function addMessage() {
  const input = document.querySelector(SELECTORS.messageInput);
  if (!input) {
    console.error('Message input not found');
    return;
  }

  const content = input.value.trim();
  if (!content) {
    console.log('Empty message, skipping');
    return;
  }
  
  if (tree.isProcessing) {
    console.log('Tree is processing, skipping');
    return;
  }

  console.log('Adding user message:', content.substring(0, 50));
  input.disabled = true;

  // Lógica simplificada para el parentId
  let parentId = tree.currentNodeId;
  const current = tree.nodes.get(tree.currentNodeId);

  if (current) {
    const role = current.role ?? (current.isAI ? 'assistant' : 'user');
    console.log(`Current node role: ${role}, ID: ${current.id}`);
    
    // Si el nodo actual es del usuario, buscar si ya tiene una respuesta IA
    if (role === 'user') {
      // Buscar hijo IA existente
      const aiChild = (current.children ?? []).find((cid) => {
        const child = tree.nodes.get(cid);
        return child && (child.role === 'assistant' || child.isAI);
      });
      
      if (aiChild) {
        // Si ya existe respuesta IA, el nuevo mensaje de usuario va después de la IA
        parentId = aiChild;
        console.log(`Found existing AI child ${aiChild}, using as parent for new user message`);
      } else {
        // Si no hay respuesta IA, el mensaje va como hermano (mismo padre)
        parentId = current.parentId;
        console.log(`No AI child found, using current node's parent: ${parentId}`);
      }
    }
    // Si el nodo actual es IA, el nuevo mensaje de usuario va después
    // (parentId ya es correcto como tree.currentNodeId)
  }

  try {
    setStatus('Enviando mensaje…');
    await tree.addNode(content, parentId, false, false); // isAI = false para mensaje de usuario
    input.value = '';
    updateAll();

    setStatus('Esperando respuesta IA…');
    const reply = await tree.generateAIResponse();
    setStatus(reply ? 'Respuesta recibida' : 'Sin respuesta IA (vacía).');
    console.log('Message flow completed successfully');
  } catch (err) {
    console.error('AI response error', err);
    setStatus('Error IA: ' + (err.message ?? 'desconocido'));
  } finally {
    updateAll();
    input.disabled = false;
    input.focus();
    setTimeout(clearStatus, 4000);
  }
}

function bindUI() {
  const form = document.querySelector(SELECTORS.messageForm);
  const input = document.querySelector(SELECTORS.messageInput);
  const importFile = document.querySelector(SELECTORS.importFile);
  const controls = document.querySelector(SELECTORS.controls);
  const closeInfoBtn = document.querySelector('#closeInfoPanel');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addMessage();
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') e.target.blur();
  });

  importFile?.addEventListener('change', onImportFile);

  // Close button for info panel
  closeInfoBtn?.addEventListener('click', closeNodeInfo);

  // Keyboard support for closing info panel with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const panel = document.querySelector(SELECTORS.infoPanel);
      if (panel && !panel.hidden) {
        closeNodeInfo();
      }
    }
  });

  // removed "reset-view" action by request
  controls?.addEventListener('click', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    if (!(el instanceof HTMLElement)) return;
    const action = el.dataset.action;
    if (!action) return;
    if (action === 'export') exportTree();
    else if (action === 'import') importFile?.click();
    else if (action === 'change-view') toggleGlobalView();
  });
}

/* --------------------------------------------------------------------------------
 * Original App Initialization
 * ------------------------------------------------------------------------------*/

async function initializeApp() {
  openaiIntegration = new OpenAIIntegration();
  tree = new EnhancedConversationalTree(openaiIntegration);
  renderer = new TreeRenderer(SELECTORS.svg);

  // Initialize the global view button text
  const globalButton = document.querySelector('[data-action="change-view"]');
  if (globalButton) {
    globalButton.textContent = 'CHANGE VIEW (Summary)'; // Default is summary mode
  }

  // Crear el nodo inicial con mensaje de bienvenida
  const welcomeNodeId = await tree.addNode("¿Dime en que puedo ayudarte hoy?", null, false, true);
  
  // Establecer el resumen personalizado para el nodo de bienvenida
  const welcomeNode = tree.nodes.get(welcomeNodeId);
  if (welcomeNode) {
    welcomeNode.summary = "Dime, ayudar";
    welcomeNode.keywords = ["Dime", "ayudar"];
  }
  
  updateAll();

  bindUI();

  // Intervalo más inteligente para generar resúmenes
  window._summaryIntervalId = setInterval(() => {
    if (tree) {
      tree.ensureSummaries();
    }
  }, SUMMARY_INTERVAL_MS);

  // Pausar el intervalo cuando la página no esté visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('📴 Page hidden - pausing summary generation');
      if (window._summaryIntervalId) {
        clearInterval(window._summaryIntervalId);
        window._summaryIntervalId = null;
      }
    } else {
      console.log('👁️ Page visible - resuming summary generation');
      if (!window._summaryIntervalId) {
        window._summaryIntervalId = setInterval(() => {
          if (tree) tree.ensureSummaries();
        }, SUMMARY_INTERVAL_MS);
      }
    }
  });

  window.addEventListener('resize', debounce(updateVisualization, 150));
}

window.addEventListener('DOMContentLoaded', async () => {
  console.log('🌟 DOM Content Loaded');
  
  // Temporary: Clear session storage to always show splash screen for testing
  sessionStorage.removeItem('splashShown');
  
  // Check if this is a fresh app launch
  if (isFreshAppLaunch()) {
    console.log('🆕 Fresh app launch detected - showing splash screen');
    // Show splash screen for fresh launches
    markSplashShown();
    initializeSplashScreen();
    
    // Initialize app after splash screen duration
    setTimeout(async () => {
      console.log('🔄 Initializing app after splash...');
      await initializeApp();
    }, SPLASH_DURATION - 500); // Start initializing slightly before splash ends
  } else {
    console.log('🔄 Not a fresh launch - skipping splash screen');
    // Skip splash screen for navigations/refreshes within the same session
    showMainApp();
    await initializeApp();
  }
});

// expose minimal API
window._ctree = { 
  tree,
  // Función para controlar el intervalo de resúmenes
  pauseSummaryGeneration: () => {
    if (window._summaryIntervalId) {
      clearInterval(window._summaryIntervalId);
      window._summaryIntervalId = null;
      console.log('📴 Summary generation paused manually');
    }
  },
  resumeSummaryGeneration: () => {
    if (!window._summaryIntervalId && tree) {
      window._summaryIntervalId = setInterval(() => {
        if (tree) tree.ensureSummaries();
      }, SUMMARY_INTERVAL_MS);
      console.log('▶️ Summary generation resumed manually');
    }
  }
};
