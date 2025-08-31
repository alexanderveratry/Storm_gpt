/*
 * conversationalTree.js — Conversational Tree Classes
 * Clases principales para manejar el árbol conversacional y sus nodos.
 */

import { EMBEDDING_DIM_SMALL } from './constants.js';
import { hash32, normalize, cosine, byTimeAsc } from './utils.js';

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

// Clase principal para manejar el árbol conversacional y sus nodos
export class ConversationalTree {
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

export class EnhancedConversationalTree extends ConversationalTree {
  constructor(openai) {
    super();
    this.openai = openai;
    this.nodeViewStates = new Map(); // Track whether each node shows full content or summary
    this.globalViewMode = 'summary'; // Global view mode: 'summary' or 'content'
    
    // Concurrent operation tracking
    this.pendingOps = new Map(); // Map<opId, OperationRecord>
    this.opCounter = 0;
    this.pendingNodeStates = new Map(); // Map<nodeId, Set<opId>> - track pending ops per node
  }

  // Concurrent operation management
  createOperation(targetNodeId, prompt, type = 'expansion') {
    const opId = `op_${Date.now()}_${this.opCounter++}`;
    const operation = {
      opId,
      targetNodeId,
      prompt,
      type,
      status: 'pending',
      createdAt: new Date(),
      attempt: 1,
      meta: {}
    };
    
    this.pendingOps.set(opId, operation);
    
    // Track pending operations per node
    if (!this.pendingNodeStates.has(targetNodeId)) {
      this.pendingNodeStates.set(targetNodeId, new Set());
    }
    this.pendingNodeStates.get(targetNodeId).add(opId);
    
    console.log(`🎯 Created operation ${opId} for node ${targetNodeId} (${type})`);
    return opId;
  }

  completeOperation(opId, success = true, result = null) {
    const operation = this.pendingOps.get(opId);
    if (!operation) {
      console.warn(`⚠️ Attempted to complete unknown operation: ${opId}`);
      return;
    }

    operation.status = success ? 'completed' : 'failed';
    operation.completedAt = new Date();
    operation.result = result;
    
    // Remove from pending states
    const targetNodeId = operation.targetNodeId;
    if (this.pendingNodeStates.has(targetNodeId)) {
      this.pendingNodeStates.get(targetNodeId).delete(opId);
      if (this.pendingNodeStates.get(targetNodeId).size === 0) {
        this.pendingNodeStates.delete(targetNodeId);
      }
    }
    
    console.log(`✅ Completed operation ${opId} with status: ${operation.status}`);
    
    // Clean up completed operations after a delay
    setTimeout(() => {
      this.pendingOps.delete(opId);
    }, 30000); // Keep completed ops for 30 seconds for debugging
  }

  cancelOperation(opId, reason = 'cancelled') {
    const operation = this.pendingOps.get(opId);
    if (!operation) return;

    operation.status = 'cancelled';
    operation.cancelReason = reason;
    
    // Remove from pending states
    const targetNodeId = operation.targetNodeId;
    if (this.pendingNodeStates.has(targetNodeId)) {
      this.pendingNodeStates.get(targetNodeId).delete(opId);
      if (this.pendingNodeStates.get(targetNodeId).size === 0) {
        this.pendingNodeStates.delete(targetNodeId);
      }
    }
    
    console.log(`❌ Cancelled operation ${opId}: ${reason}`);
    
    setTimeout(() => {
      this.pendingOps.delete(opId);
    }, 5000);
  }

  getNodePendingCount(nodeId) {
    return this.pendingNodeStates.get(nodeId)?.size || 0;
  }

  isNodePending(nodeId) {
    return this.getNodePendingCount(nodeId) > 0;
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

    // Solo cambiar el nodo actual si es un mensaje de usuario, no respuestas de IA
    if (!isAI) {
      this.currentNodeId = id;
      console.log(`🎯 Focus changed to user node: ${id}`);
    } else {
      console.log(`🤖 AI response node ${id} added without changing focus`);
    }

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
      const developerInstruction = 'Instrucciones:  Haz un resumen lo más corto posible, Ignora reiteraciones sobre un mismo asunto y limítate solo a las ideas principales. Devuelve solo conceptos claves. La respuesta no puede ser mayor que el input.';
      const requestBody = {
        "model": "gpt-5-nano",
        "input": [
          {
            "role": "developer",
            "content": [
              {
                "type": "input_text",
                "text": developerInstruction
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "type": "input_text",
                "text": node.content
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
        userInputLength: (node.content || '').length,
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
        const inputLengthLimit = (n.content || '').length;
        let summary = typeof data?.content === 'string' ? data.content : '';

        if (summary) {
          // Normalize whitespace
          summary = summary.trim().replace(/\s+/g, ' ');

          // Extract concepts, remove redundancy (case-insensitive), limit to 10
          const rawItems = summary.split(/[\n;,•\-]+|,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(s => s.trim()).filter(Boolean);
          const seen = new Set();
          const concepts = [];
          const userTextLc = (n.content || '').toLowerCase();
          for (const item of rawItems) {
            const norm = item.toLowerCase();
            // Keep only if not seen and concept links to user's text (at least one 4+ letter word appears in user text)
            const hasUserOverlap = norm.split(/\s+/).some(w => w.length >= 4 && userTextLc.includes(w));
            if (!seen.has(norm) && hasUserOverlap) {
              seen.add(norm);
              concepts.push(item);
              if (concepts.length >= 10) break;
            }
          }

          let joined = concepts.join(', ');

          // Enforce length restriction: summary must not exceed input length
          while (joined.length > inputLengthLimit && concepts.length > 1) {
            concepts.pop();
            joined = concepts.join(', ');
          }
          if (joined.length > inputLengthLimit) {
            joined = joined.slice(0, inputLengthLimit);
          }

          summary = joined;
          n.keywords = concepts;
          console.log('🔤 Generated keywords (deduped):', concepts);
        }

        // Fallback: extract short concepts from content
        if (!summary || summary.length === 0) {
          const wordsAll = n.content.trim().split(/\s+/);
          const words = wordsAll.filter(w => w.length > 3).slice(0, 8);
          let fallback = words.join(', ');
          if (fallback.length > inputLengthLimit) fallback = fallback.slice(0, inputLengthLimit);
          summary = fallback || n.content.slice(0, inputLengthLimit);
          n.keywords = words;
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
      // Note: updateVisualization and updateSidebar will be called from main app
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

  async generateAIResponse(explicitTargetNodeId = null) {
    // Capture the target node at request time - never read current selection later
    const targetNodeId = explicitTargetNodeId || this.currentNodeId;
    
    if (!targetNodeId) {
      console.error('No target node specified for AI response generation');
      return '';
    }

    const targetNode = this.nodes.get(targetNodeId);
    if (!targetNode) {
      console.error(`Target node ${targetNodeId} not found`);
      return '';
    }

    // Create operation to track this request
    const opId = this.createOperation(targetNodeId, 'AI response generation', 'expansion');
    
    try {
      const role = targetNode.role ?? (targetNode.isAI ? 'assistant' : 'user');
      if (role === 'user') {
        const hasAssistantChild = (targetNode.children ?? []).some((cid) => this.nodes.get(cid)?.role === 'assistant');
        if (hasAssistantChild) {
          console.log(`Node ${targetNodeId} already has assistant response, skipping`);
          this.completeOperation(opId, false, 'Already has assistant response');
          return '';
        }
      }

      const path = this.getPathToNode(targetNodeId);
      if (!path.length) {
        console.error(`No path found to target node ${targetNodeId}`);
        this.completeOperation(opId, false, 'No path to target node');
        return '';
      }

      const ctx = this.getRelevantContext(targetNodeId);
      console.log(`🤖 Generating AI response for operation ${opId} (target: ${targetNodeId})`);
      console.log('- Path nodes:', path.length, 'Context items:', ctx.length);
      
      const reply = await this.openai.getChatResponse(path, ctx, this, opId);
      console.log(`🤖 AI response received for operation ${opId}:`, reply ? reply.substring(0, 50) + '...' : 'empty');

      if (reply?.trim()) {
        // Verify target node still exists (edge case: node deleted during API call)
        if (!this.nodes.has(targetNodeId)) {
          console.warn(`⚠️ Target node ${targetNodeId} was deleted during API call for operation ${opId}`);
          this.completeOperation(opId, false, 'Target node deleted');
          
          // Optional: Try to attach to parent if it still exists
          const operation = this.pendingOps.get(opId);
          if (operation) {
            const parentId = this.findFallbackParent(targetNodeId);
            if (parentId) {
              console.log(`🔄 Attaching response to fallback parent ${parentId}`);
              const newNodeId = await this.addNode(reply, parentId, false, true);
              this.completeOperation(opId, true, { newNodeId, fallbackParent: parentId });
              return reply;
            }
          }
          return '';
        }

        // Attach to the original target node (never to current selection)
        const newNodeId = await this.addNode(reply, targetNodeId, false, true);
        this.completeOperation(opId, true, { newNodeId });
        console.log(`✅ AI response attached to target node ${targetNodeId} as ${newNodeId}`);
      } else {
        this.completeOperation(opId, false, 'Empty response');
      }
      
      return reply ?? '';
    } catch (error) {
      console.error(`❌ AI response generation failed for operation ${opId}:`, error);
      this.completeOperation(opId, false, error.message);
      throw error;
    }
  }

  findFallbackParent(deletedNodeId) {
    // Try to find a suitable fallback parent when target node is deleted
    // This is a fallback mechanism - ideally the UI should prevent node deletion with pending ops
    
    // For now, just return the current root or current node
    return this.rootId || this.currentNodeId;
  }

  async loadExportedNodes(arr, progressCallback = null) {
    this.nodes = new Map();
    this.rootId = null;
    this.currentNodeId = null;
    this.idCounter = 0;
    if (!Array.isArray(arr)) return;

    const parsed = arr
      .map((n) => ({ ...n, timestamp: n.timestamp ? new Date(n.timestamp) : new Date() }))
      .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`🚀 Loading ${parsed.length} nodes with parallel embedding generation...`);
    
    // OPTIMIZACIÓN 1: Procesar embeddings en paralelo
    const embeddingPromises = parsed.map(async (n, idx) => {
      const id = n.id && /^node_\d+$/.test(n.id) ? n.id : `node_${this.idCounter + idx}`;
      const role = idx === 0 ? 'assistant' : idx % 2 === 1 ? 'user' : 'assistant';
      
      let embedding;
      try {
        embedding = await this.openai.getEmbedding(n.content ?? '');
      } catch {
        embedding = this.openai.fallbackEmbedding(n.content ?? '');
      }

      // Callback de progreso opcional
      if (progressCallback) {
        progressCallback(idx + 1, parsed.length);
      }

      return {
        originalData: n,
        id,
        role,
        embedding,
        idx
      };
    });

    // Esperar a que todos los embeddings se generen en paralelo
    const embeddingResults = await Promise.all(embeddingPromises);
    
    // OPTIMIZACIÓN 2: Construir nodos después de tener todos los embeddings
    for (const result of embeddingResults) {
      const { originalData: n, id, role, embedding, idx } = result;
      
      const numeric = parseInt(id.split('_')[1] ?? '0', 10);
      this.idCounter = Math.max(this.idCounter, numeric + 1);

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

    // Construir relaciones padre-hijo
    this.nodes.forEach((node) => {
      if (node.parentId && this.nodes.has(node.parentId)) this.nodes.get(node.parentId).children.push(node.id);
    });

    const roots = [...this.nodes.values()].filter((n) => !n.parentId).sort(byTimeAsc);
    this.rootId = roots[0]?.id ?? null;
    this.currentNodeId = this.rootId;
    
    console.log(`✅ Loaded ${this.nodes.size} nodes successfully`);
  }
}
