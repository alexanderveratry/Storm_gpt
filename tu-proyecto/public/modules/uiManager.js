/*
 * uiManager.js — UI Management and Event Handling
 * Manejo de toda la lógica de interfaz de usuario y eventos.
 */

import { SELECTORS, SUMMARY_INTERVAL_MS } from './constants.js';
import { escapeHTML, truncate, setStatus, clearStatus, debounce } from './utils.js';

export class UIManager {
  constructor(tree, renderer) {
    this.tree = tree;
    this.renderer = renderer;
  }

  updateSidebar() {
    const chat = document.querySelector(SELECTORS.chatArea);
    if (!chat) return;
    chat.innerHTML = '';

    const path = this.tree.getPathToNode(this.tree.currentNodeId);
    for (const id of path) {
      const n = this.tree.nodes.get(id);
      const wrap = document.createElement('div');
      wrap.className = `message ${id === this.tree.currentNodeId ? 'active' : ''}`;
      wrap.tabIndex = 0;

      let summary = n.summary;
      if (!summary) summary = n.summaryGenerating ? 'Generando…' : truncate(n.content, 160);

      // Check current view state for this node
      const showFull = this.tree.getEffectiveViewState(id);
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
        this.tree.currentNodeId = id;
        this.updateAll();
      });

      chat.appendChild(wrap);
    }

    chat.addEventListener('click', (e) => this.onChatAction(e), { once: true });
    chat.scrollTop = chat.scrollHeight;
  }

  onChatAction(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;
    e.stopPropagation();

    if (action === 'copy') this.copyNodeContent(id, btn);
    else if (action === 'regen') this.regenerateSummary(id, btn);
    else if (action === 'toggle') this.toggleMessageView(id, btn);
  }

  async regenerateSummary(nodeId, btn) {
    const node = this.tree.nodes.get(nodeId);
    if (!node) return;
    node.summary = null;
    node.keywords = [];
    btn.disabled = true;
    btn.textContent = '…';
    await this.tree.generateSummaryForNode(nodeId);
    btn.textContent = 'Regen';
    btn.disabled = false;
    this.updateSidebar();
    this.updateVisualization();
  }

  copyNodeContent(nodeId, btn) {
    const node = this.tree.nodes.get(nodeId);
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

  toggleMessageView(nodeId, btn) {
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
      this.tree.setNodeViewState(nodeId, false); // Set to summary view
      // Reset global mode to allow individual control
      this.tree.globalViewMode = 'individual';
    } else {
      // Currently showing summary, switch to full
      summaryText.hidden = true;
      fullText.hidden = false;
      box.setAttribute('data-full', '1');
      btn.textContent = 'Show Summary';
      this.tree.setNodeViewState(nodeId, true); // Set to full view
      // Reset global mode to allow individual control
      this.tree.globalViewMode = 'individual';
    }
    
    // Update the global button to show mixed state
    const globalButton = document.querySelector('[data-action="change-view"]');
    if (globalButton) {
      globalButton.textContent = 'CHANGE VIEW (Mixed)';
    }
    
    // Update the tree visualization to reflect the change
    this.updateVisualization();
  }

  toggleGlobalView() {
    if (!this.tree) return;
    
    const currentMode = this.tree.getGlobalViewMode();
    const newMode = currentMode === 'summary' ? 'content' : 'summary';
    
    this.tree.setGlobalViewMode(newMode);
    
    // Update the button text to show current state
    const button = document.querySelector('[data-action="change-view"]');
    if (button) {
      button.textContent = newMode === 'summary' ? 'CHANGE VIEW (Summary)' : 'CHANGE VIEW (Content)';
    }
    
    // Update all visualizations
    this.updateAll();
  }

  updateMemoryContext() {
    const el = document.querySelector(SELECTORS.memoryContext);
    if (!el) return;
    const ctx = this.tree.getRelevantContext(this.tree.currentNodeId);
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

  showNodeInfo(nodeData) {
    const panel = document.querySelector(SELECTORS.infoPanel);
    const info = document.querySelector(SELECTORS.nodeInfo);
    const closeBtn = document.querySelector('#closeInfoPanel');
    if (!panel || !info || !closeBtn) return;

    const node = this.tree.nodes.get(nodeData.id);
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

  closeNodeInfo() {
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

  exportTree() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: [...this.tree.nodes.values()].map((n) => ({
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

  async onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.nodes) throw new Error('Invalid file: missing nodes');

      await this.tree.loadExportedNodes(json.nodes);
      this.updateAll();
      this.tree.ensureSummaries?.();
    } catch (err) {
      alert('Failed to import: ' + err.message);
    } finally {
      e.target.value = '';
    }
  }

  updateVisualization() {
    this.renderer?.update(this.tree, 
      () => this.updateAll(), 
      () => this.updateVisualization(), 
      () => this.updateSidebar(), 
      (nodeData) => this.showNodeInfo(nodeData)
    );
  }

  updateAll() {
    this.updateVisualization();
    this.updateSidebar();
    this.updateMemoryContext();
  }

  async addMessage() {
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
    
    if (this.tree.isProcessing) {
      console.log('Tree is processing, skipping');
      return;
    }

    console.log('Adding user message:', content.substring(0, 50));
    input.disabled = true;

    // Lógica simplificada para el parentId
    let parentId = this.tree.currentNodeId;
    const current = this.tree.nodes.get(this.tree.currentNodeId);

    if (current) {
      const role = current.role ?? (current.isAI ? 'assistant' : 'user');
      console.log(`Current node role: ${role}, ID: ${current.id}`);
      
      // Si el nodo actual es del usuario, buscar si ya tiene una respuesta IA
      if (role === 'user') {
        // Buscar hijo IA existente
        const aiChild = (current.children ?? []).find((cid) => {
          const child = this.tree.nodes.get(cid);
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
      await this.tree.addNode(content, parentId, false, false); // isAI = false para mensaje de usuario
      input.value = '';
      this.updateAll();

      setStatus('Esperando respuesta IA…');
      const reply = await this.tree.generateAIResponse();
      setStatus(reply ? 'Respuesta recibida' : 'Sin respuesta IA (vacía).');
      console.log('Message flow completed successfully');
    } catch (err) {
      console.error('AI response error', err);
      setStatus('Error IA: ' + (err.message ?? 'desconocido'));
    } finally {
      this.updateAll();
      input.disabled = false;
      input.focus();
      setTimeout(clearStatus, 4000);
    }
  }

  bindUI() {
    const form = document.querySelector(SELECTORS.messageForm);
    const input = document.querySelector(SELECTORS.messageInput);
    const importFile = document.querySelector(SELECTORS.importFile);
    const controls = document.querySelector(SELECTORS.controls);
    const closeInfoBtn = document.querySelector('#closeInfoPanel');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.addMessage();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.target.blur();
    });

    importFile?.addEventListener('change', (e) => this.onImportFile(e));

    // Close button for info panel
    closeInfoBtn?.addEventListener('click', () => this.closeNodeInfo());

    // Keyboard support for closing info panel with Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const panel = document.querySelector(SELECTORS.infoPanel);
        if (panel && !panel.hidden) {
          this.closeNodeInfo();
        }
      }
    });

    // removed "reset-view" action by request
    controls?.addEventListener('click', (e) => {
      const el = /** @type {HTMLElement} */ (e.target);
      if (!(el instanceof HTMLElement)) return;
      const action = el.dataset.action;
      if (!action) return;
      if (action === 'export') this.exportTree();
      else if (action === 'import') importFile?.click();
      else if (action === 'change-view') this.toggleGlobalView();
      else if (action === 'check-summaries') this.checkSummaries();
    });
  }

  setupSummaryGeneration() {
    // Configuración de eventos de visibilidad (sin intervalo automático)
    // La generación de resúmenes ahora es manual mediante botón
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('📴 Page hidden ');
      } else {
        console.log('👁️ Page visible -');
      }
    });

    window.addEventListener('resize', debounce(() => this.updateVisualization(), 150));
  }

  // Nueva función para revisar resúmenes manualmente
  async checkSummaries() {
    if (!this.tree) {
      console.log('❌ No tree available for summary check');
      return;
    }

    const button = document.querySelector('[data-action="check-summaries"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Revisando...';
    }

    try {
      console.log('🔍 Checking for missing summaries...');
      await this.tree.ensureSummaries();
      console.log('✅ Summary check completed');
    } catch (error) {
      console.error('❌ Error during summary check:', error);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Revisar Resúmenes';
      }
    }
  }
}
