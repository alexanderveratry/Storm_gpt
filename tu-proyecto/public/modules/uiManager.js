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

  toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleIcon = document.querySelector('.toggle-icon');
    
    if (!sidebar || !toggleIcon) return;

    const isCollapsed = sidebar.classList.contains('collapsed');
    
    if (isCollapsed) {
      // Expandir sidebar
      sidebar.classList.remove('collapsed');
      sidebar.setAttribute('aria-expanded', 'true');
      toggleIcon.setAttribute('aria-label', 'Collapse sidebar');
      console.log('📖 Sidebar expanded');
    } else {
      // Colapsar sidebar  
      sidebar.classList.add('collapsed');
      sidebar.setAttribute('aria-expanded', 'false');
      toggleIcon.setAttribute('aria-label', 'Expand sidebar');
      console.log('📕 Sidebar collapsed');
    }

    // Actualizar visualización después de un breve delay para permitir la transición CSS
    setTimeout(() => {
      this.updateVisualization();
    }, 350);
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

      // OPTIMIZACIÓN: Mostrar progreso y hacer resúmenes opcionales
      const nodeCount = json.nodes.length;
      const shouldGenerateSummaries = nodeCount <= 20; // Solo auto-generar para conversaciones pequeñas
      
      console.log(`📥 Importing ${nodeCount} nodes (summaries: ${shouldGenerateSummaries ? 'auto' : 'manual'})`);
      
      // Indicador de progreso durante la carga
      const importBtn = document.querySelector('[data-action="import"]');
      if (importBtn) {
        importBtn.disabled = true;
        importBtn.textContent = 'Loading...';
      }

      // Callback de progreso para embeddings
      const progressCallback = (current, total) => {
        if (importBtn) {
          const percentage = Math.round((current / total) * 100);
          importBtn.textContent = `Loading ${percentage}%`;
        }
      };

      // OPTIMIZACIÓN: Cargar nodos con progreso
      await this.tree.loadExportedNodes(json.nodes, progressCallback);
      
      // OPTIMIZACIÓN: Actualizar UI una sola vez después de cargar todo
      this.updateAll();
      
      // OPTIMIZACIÓN: Resúmenes opcionales según tamaño
      if (shouldGenerateSummaries) {
        console.log('🔄 Auto-generating summaries for small conversation...');
        this.tree.ensureSummaries?.();
      } else {
        console.log('⏭️ Skipping auto-summary generation for large conversation. Use "Revisar Resúmenes" button if needed.');
        alert(`Imported ${nodeCount} nodes successfully!\n\nSummaries not generated automatically for large conversations.\nUse "Revisar Resúmenes" button if needed.`);
      }

      if (importBtn) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
      }
      
    } catch (err) {
      console.error('Import error:', err);
      alert('Failed to import: ' + err.message);
      
      // Restaurar botón en caso de error
      const importBtn = document.querySelector('[data-action="import"]');
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
      }
    } finally {
      e.target.value = '';
    }
  }

  /**
   * Transforma un JSON con formato {messages: [{role: "Prompt|Response", say: "..."}]}
   * al formato utilizado en la aplicación
   * @param {Object} inputJson - JSON con formato original
   * @returns {Object} - JSON transformado al formato de la app
   */
  transformJsonFormat(inputJson) {
    if (!inputJson.messages || !Array.isArray(inputJson.messages)) {
      throw new Error('Invalid JSON format: missing "messages" array');
    }

    const nodes = [];
    const currentTime = new Date().toISOString();

    // Agregar nodo inicial de bienvenida
    const welcomeNode = {
      id: "node_0",
      content: "Bienvenido",
      parentId: null,
      timestamp: currentTime,
      summary: "",
      keywords: []
    };
    nodes.push(welcomeNode);

    // Procesar mensajes de la conversación importada
    inputJson.messages.forEach((message, index) => {
      if (!message.role || !message.say) {
        throw new Error(`Invalid message format at index ${index}: missing "role" or "say"`);
      }

      // Los IDs ahora empiezan desde node_1 porque node_0 es el de bienvenida
      const nodeId = `node_${index + 1}`;
      const parentId = index === 0 ? "node_0" : `node_${index}`;

      const transformedNode = {
        id: nodeId,
        content: message.say,
        parentId: parentId,
        timestamp: currentTime,
        summary: "", // Vacío como especificado
        keywords: [] // Vacío como especificado
      };

      nodes.push(transformedNode);
    });

    return {
      version: 1,
      exportedAt: currentTime,
      nodes: nodes
    };
  }

  async onTransformFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const inputJson = JSON.parse(text);
      
      // Transformar el formato
      const transformedJson = this.transformJsonFormat(inputJson);
      
      // Mostrar confirmación al usuario con preview del resultado
      const preview = `Archivo transformado:\n- Nodos totales: ${transformedJson.nodes.length}\n- Nodo inicial: "Bienvenido"\n- Mensajes importados: ${transformedJson.nodes.length - 1}\n- Primer mensaje importado: "${transformedJson.nodes[1]?.content.substring(0, 50)}..."\n\n¿Deseas cargar esta conversación?`;
      
      if (confirm(preview)) {
        // OPTIMIZACIÓN: Aplicar las mismas mejoras que en onImportFile
        const nodeCount = transformedJson.nodes.length;
        const shouldGenerateSummaries = nodeCount <= 20;
        
        console.log(`🔄 Loading transformed conversation: ${nodeCount} nodes (summaries: ${shouldGenerateSummaries ? 'auto' : 'manual'})`);
        
        // Indicador de progreso
        const transformBtn = document.querySelector('[data-action="transform-json"]');
        if (transformBtn) {
          transformBtn.disabled = true;
          transformBtn.textContent = 'Loading...';
        }

        // Callback de progreso
        const progressCallback = (current, total) => {
          if (transformBtn) {
            const percentage = Math.round((current / total) * 100);
            transformBtn.textContent = `Loading ${percentage}%`;
          }
        };

        try {
          // Cargar nodos transformados con progreso
          await this.tree.loadExportedNodes(transformedJson.nodes, progressCallback);
          this.updateAll();
          
          // Resúmenes opcionales
          if (shouldGenerateSummaries) {
            console.log('🔄 Auto-generating summaries for transformed conversation...');
            this.tree.ensureSummaries?.();
          } else {
            console.log('⏭️ Skipping auto-summary for large transformed conversation.');
          }
          
          // Opcional: descargar el archivo transformado
          const downloadTransformed = confirm('¿Deseas descargar el archivo transformado?');
          if (downloadTransformed) {
            const blob = new Blob([JSON.stringify(transformedJson, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `transformed_${file.name}`;
            a.click();
            URL.revokeObjectURL(url);
          }
        } finally {
          if (transformBtn) {
            transformBtn.disabled = false;
            transformBtn.textContent = 'Transform JSON';
          }
        }
      }
    } catch (err) {
      console.error('Transform error:', err);
      alert('Failed to transform: ' + err.message);
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

    console.log('Adding user message:', content.substring(0, 50));

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
      // Generar respuesta de IA en background sin bloquear la interfaz
      this.tree.generateAIResponse().then((reply) => {
        setStatus(reply ? 'Respuesta recibida' : 'Sin respuesta IA (vacía).');
        console.log('Message flow completed successfully');
        this.updateAll(); // Actualizar interfaz cuando se reciba la respuesta
        setTimeout(clearStatus, 4000);
      }).catch((err) => {
        console.error('AI response error', err);
        setStatus('Error IA: ' + (err.message ?? 'desconocido'));
        setTimeout(clearStatus, 4000);
      });

      // Limpiar input y reenfocar inmediatamente sin esperar la respuesta
      input.focus();
      console.log('User message processed, UI remains interactive');
    } catch (err) {
      console.error('Error adding user message:', err);
      setStatus('Error: ' + (err.message ?? 'desconocido'));
      setTimeout(clearStatus, 4000);
    }
  }

  bindUI() {
    const form = document.querySelector(SELECTORS.messageForm);
    const input = document.querySelector(SELECTORS.messageInput);
    const importFile = document.querySelector(SELECTORS.importFile);
    const transformFile = document.querySelector('#transformFile');
    const controls = document.querySelector(SELECTORS.controls);
    const closeInfoBtn = document.querySelector('#closeInfoPanel');
    const sidebarToggle = document.querySelector('#sidebarToggle');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.addMessage();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.target.blur();
    });

    importFile?.addEventListener('change', (e) => this.onImportFile(e));
    transformFile?.addEventListener('change', (e) => this.onTransformFile(e));

    // Sidebar toggle functionality
    sidebarToggle?.addEventListener('click', () => this.toggleSidebar());

    // Close button for info panel
    closeInfoBtn?.addEventListener('click', () => this.closeNodeInfo());

    // Keyboard support for closing info panel with Escape and sidebar toggle
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const panel = document.querySelector(SELECTORS.infoPanel);
        if (panel && !panel.hidden) {
          this.closeNodeInfo();
        }
      }
      
      // Ctrl/Cmd + B para toggle del sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        this.toggleSidebar();
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
      else if (action === 'transform-json') transformFile?.click();
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
