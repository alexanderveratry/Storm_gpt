/*
 * uiManager.js — UI Management and Event Handling
 * Manejo de toda la lógica de interfaz de usuario y eventos.
 */

import { SELECTORS, SUMMARY_INTERVAL_MS, VIEW_MODES, CONTENT_VIEW_MODES } from './constants.js';
import { escapeHTML, truncate, setStatus, clearStatus, debounce } from './utils.js';

export class UIManager {
  constructor(tree, renderer) {
    this.tree = tree;
    this.renderer = renderer;
    this.currentViewMode = VIEW_MODES.TREE;
    this.chatBranches = new Map(); // Para rastrear ramas paralelas en cada posición
  }

  updateSidebar() {
    const chat = document.querySelector(SELECTORS.chatArea);
    if (!chat) return;
    
    // Header with title
    chat.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--color-accent); font-size: 1.2rem; font-weight: 600; border-bottom: 1px solid var(--color-border);">
        Conversaciones Storm GPT
      </div>
      <div id="savedChatsList" style="padding: 10px; max-height: calc(100% - 80px); overflow-y: auto;">
        <div style="text-align: center; color: #888; padding: 20px;">
          Cargando chats guardados...
        </div>
      </div>
    `;
    
    // Load saved chats
    this.loadSavedChats();
  }

  async loadSavedChats() {
    try {
      const response = await fetch('/api/saved-chats');
      const result = await response.json();
      
      const chatsList = document.getElementById('savedChatsList');
      if (!chatsList) return;

      if (!result.chats || result.chats.length === 0) {
        chatsList.innerHTML = `
          <div style="text-align: center; color: #888; padding: 20px;">
            No hay chats guardados aún
          </div>
        `;
        return;
      }

      // Generate list of saved chats
      const chatsHTML = result.chats.map(chat => {
        const date = new Date(chat.modified).toLocaleDateString('es-ES', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        return `
          <div class="saved-chat-item" data-filename="${chat.filename}" style="
            padding: 10px;
            margin: 5px 0;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            background: var(--color-panel);
          ">
            <div style="font-weight: 600; color: var(--color-text); margin-bottom: 4px;">
              ${escapeHTML(chat.displayName)}
            </div>
            <div style="font-size: 0.8rem; color: #888;">
              ${date}
            </div>
          </div>
        `;
      }).join('');

      chatsList.innerHTML = chatsHTML;

      // Add click handlers for loading chats
      chatsList.querySelectorAll('.saved-chat-item').forEach(item => {
        item.addEventListener('click', () => {
          const filename = item.dataset.filename;
          this.loadSavedChat(filename);
        });
        
        // Hover effects
        item.addEventListener('mouseenter', () => {
          item.style.backgroundColor = 'var(--color-hover)';
          item.style.borderColor = 'var(--color-accent)';
        });
        
        item.addEventListener('mouseleave', () => {
          item.style.backgroundColor = 'var(--color-panel)';
          item.style.borderColor = 'var(--color-border)';
        });
      });

    } catch (error) {
      console.error('Error loading saved chats:', error);
      const chatsList = document.getElementById('savedChatsList');
      if (chatsList) {
        chatsList.innerHTML = `
          <div style="text-align: center; color: #ff6b6b; padding: 20px;">
            Error al cargar chats guardados
          </div>
        `;
      }
    }
  }

  async loadSavedChat(filename) {
    try {
      const response = await fetch(`/api/saved-chats/${filename}`);
      const result = await response.json();
      
      if (result.success && result.data) {
        // Import the chat data using the correct method
        await this.tree.loadExportedNodes(result.data.nodes);
        this.updateAll();
        console.log(`📂 Loaded saved chat: ${filename}`);
      } else {
        console.error('Failed to load chat:', result.error);
      }
    } catch (error) {
      console.error('Error loading saved chat:', error);
    }
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
    let newMode;
    
    // Ciclar entre los tres modos: summary -> content -> stickers -> summary
    if (currentMode === 'summary') {
      newMode = 'content';
    } else if (currentMode === 'content') {
      newMode = 'stickers';
    } else {
      newMode = 'summary';
    }
    
    this.tree.setGlobalViewMode(newMode);
    
    // Update the button text to show current state
    const button = document.querySelector('[data-action="change-view"]');
    if (button) {
      if (newMode === 'summary') {
        button.textContent = 'CHANGE VIEW (Summary)';
      } else if (newMode === 'content') {
        button.textContent = 'CHANGE VIEW (Content)';
      } else if (newMode === 'stickers') {
        button.textContent = 'CHANGE VIEW (Stickers)';
      }
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
    
    // Build info content with sticker support
    let infoContent = `<div class="node-content-display">${escapeHTML(node.content)}</div>`;
    
    // Add sticker display if available
    if (node.image) {
      infoContent += `
        <div class="node-sticker">
          <img src="${node.image}" alt="Generated sticker" />
          <div class="sticker-info">Prompt: "${node.imagePrompt || 'N/A'}"</div>
        </div>`;
    }
    
    info.innerHTML = infoContent;
    
    // Update sticker buttons
    this.updateStickerButtons(nodeData.id);
    
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

  toggleViewMode() {
    // Cycle through: TREE -> CHAT -> STICKERS -> TREE
    let newMode;
    if (this.currentViewMode === VIEW_MODES.TREE) {
      newMode = VIEW_MODES.CHAT;
    } else if (this.currentViewMode === VIEW_MODES.CHAT) {
      newMode = 'STICKERS';
    } else {
      newMode = VIEW_MODES.TREE;
    }
    this.setViewMode(newMode);
  }

  setViewMode(mode) {
    this.currentViewMode = mode;
    
    const treeView = document.querySelector(SELECTORS.treeView);
    const chatView = document.querySelector(SELECTORS.chatView);
    const stickersView = document.querySelector('#stickersView');
    const viewButton = document.querySelector('[data-action="change-view-mode"]');
    
    // Conservar el nodo actual para mantener el foco
    const currentNodeId = this.tree.currentNodeId;
    
    // Hide all views first
    treeView.hidden = true;
    chatView.hidden = true;
    if (stickersView) stickersView.hidden = true;
    
    if (mode === VIEW_MODES.CHAT) {
      // Cambiar a vista de chat
      chatView.hidden = false;
      if (viewButton) viewButton.textContent = 'Vista Chat';
      
      // Asegurar que el nodo actual se mantiene al renderizar chat
      if (currentNodeId) {
        this.tree.currentNodeId = currentNodeId;
      }
      this.renderChatView();
      console.log(`💬 Switched to chat view (focused on: ${currentNodeId})`);
    }  else {
      // Cambiar a vista de árbol
      treeView.hidden = false;
      if (viewButton) viewButton.textContent = 'Vista Árbol';
      
      // Asegurar que el nodo actual se mantiene al actualizar árbol
      if (currentNodeId) {
        this.tree.currentNodeId = currentNodeId;
      }
      this.updateVisualization();
      this.updateSidebar(); // Actualizar sidebar para mostrar el path correcto
      console.log(`🌳 Switched to tree view (focused on: ${currentNodeId})`);
    }
  }

  renderChatView() {
    if (!this.tree || !this.tree.currentNodeId) return;
    
    console.log(`🔄 renderChatView called with currentNodeId: ${this.tree.currentNodeId}`);
    
    const chatMessages = document.querySelector('#chatMessages');
    if (!chatMessages) return;
    
    // Obtener el path desde la raíz hasta el nodo actual, luego extender hasta todas las hojas
    const fullBranch = this.getFullBranchFromNode(this.tree.currentNodeId);
    
    console.log(`🌿 Full branch:`, fullBranch.map(n => n.id));
    
    chatMessages.innerHTML = '';
    this.chatBranches.clear();
    
    // Renderizar cada mensaje en la rama
    fullBranch.forEach((node, index) => {
      const messageEl = this.createChatMessage(node, index, fullBranch);
      chatMessages.appendChild(messageEl);
    });
    
    console.log(`📦 Rendered ${fullBranch.length} messages to chat view`);
    
    // Actualizar información del nodo actual para el input
    this.updateChatBranchInfo();
    
    // Centrar en el nodo actual en lugar de ir al final
    setTimeout(() => {
      console.log(`⏰ About to scroll to current node: ${this.tree.currentNodeId}`);
      this.scrollToNodeInChat(this.tree.currentNodeId);
    }, 50);
  }

  updateChatBranchInfo() {
    const branchInfo = document.querySelector(SELECTORS.currentBranchInfo);
    if (!branchInfo || !this.tree.currentNodeId) return;
    
    // Encontrar el último nodo de la rama (donde se expandirá)
    const fullBranch = this.getFullBranchFromNode(this.tree.currentNodeId);
    const lastNode = fullBranch[fullBranch.length - 1];
    
    if (lastNode) {
      branchInfo.textContent = `Expandiendo desde: ${lastNode.id}`;
    }
  }

  async addChatMessage() {
    const input = document.querySelector(SELECTORS.chatMessageInput);
    if (!input) {
      console.error('Chat message input not found');
      return;
    }

    const content = input.value.trim();
    if (!content) {
      console.log('Empty chat message, skipping');
      return;
    }

    console.log('Adding chat message:', content.substring(0, 50));

    try {
      setStatus('Añadiendo mensaje al chat…');
      
      // Encontrar el último nodo de la rama actual para usarlo como padre
      const fullBranch = this.getFullBranchFromNode(this.tree.currentNodeId);
      const lastNode = fullBranch[fullBranch.length - 1];
      const parentId = lastNode ? lastNode.id : this.tree.currentNodeId;
      
      console.log(`Adding message with parent: ${parentId}`);
      
      // Agregar el nodo del usuario
      const userNodeId = await this.tree.addNode(content, parentId, false, false);
      
      // Actualizar el nodo actual al nuevo mensaje de usuario
      this.tree.currentNodeId = userNodeId;
      
      // Re-renderizar la vista de chat
      this.renderChatView();
      
      // Limpiar input
      input.value = '';
      
      setStatus('Generando respuesta IA…');
      
      // Generar respuesta de IA
      this.tree.generateAIResponse().then((reply) => {
        setStatus(reply ? 'Respuesta recibida' : 'Sin respuesta IA');
        console.log('Chat message flow completed successfully');
        // Re-renderizar después de la respuesta IA
        this.renderChatView();
        // Scroll al final de la conversación
        setTimeout(() => {
          const chatMessages = document.querySelector('#chatMessages');
          if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        }, 100);
        setTimeout(clearStatus, 4000);
      }).catch((err) => {
        console.error('AI response error in chat', err);
        setStatus('Error IA: ' + (err.message ?? 'desconocido'));
        setTimeout(clearStatus, 4000);
      });

      // Reenfocar input
      input.focus();
      console.log('Chat message processed, UI remains interactive');
    } catch (err) {
      console.error('Error adding chat message:', err);
      setStatus('Error: ' + (err.message ?? 'desconocido'));
      setTimeout(clearStatus, 4000);
    }
  }

  getFullBranchFromNode(nodeId) {
    // Primero obtener el path hasta el nodo seleccionado
    const pathToNode = this.tree.getPathToNode(nodeId);
    const result = [];
    
    // Agregar todos los nodos del path
    for (const id of pathToNode) {
      const node = this.tree.nodes.get(id);
      if (node) result.push(node);
    }
    
    // Luego, desde el nodo seleccionado, seguir el primer hijo hasta llegar a una hoja
    let currentNode = this.tree.nodes.get(nodeId);
    while (currentNode && currentNode.children && currentNode.children.length > 0) {
      // Tomar el primer hijo por defecto
      const firstChild = this.tree.nodes.get(currentNode.children[0]);
      if (firstChild && !result.find(n => n.id === firstChild.id)) {
        result.push(firstChild);
      }
      currentNode = firstChild;
    }
    
    return result;
  }

  createChatMessage(node, index, fullBranch) {
    const messageDiv = document.createElement('div');
    const isCurrentNode = node.id === this.tree.currentNodeId;
    messageDiv.className = `chat-message ${node.role || (node.isAI ? 'assistant' : 'user')} ${isCurrentNode ? 'current-node' : ''}`;
    messageDiv.dataset.nodeId = node.id;
    
    // Buscar hermanos (nodos con el mismo padre)
    const siblings = this.findSiblings(node.id, fullBranch);
    const currentSiblingIndex = siblings.indexOf(node.id);
    
    const timestamp = new Date(node.timestamp).toLocaleTimeString();
    
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-role">${node.role === 'user' ? 'Tú' : 'Asistente'}</span>
        <span class="node-id ${isCurrentNode ? 'current' : ''}">${node.id}</span>
        <span class="message-timestamp">${timestamp}</span>
      </div>
      <div class="message-bubble">
        ${escapeHTML(node.content)}
      </div>
      ${siblings.length > 1 ? this.createBranchNavigation(siblings, currentSiblingIndex, index, fullBranch) : ''}
    `;
    
    return messageDiv;
  }

  findSiblings(nodeId, fullBranch) {
    const node = this.tree.nodes.get(nodeId);
    if (!node || !node.parentId) return [nodeId];
    
    const parent = this.tree.nodes.get(node.parentId);
    if (!parent || !parent.children) return [nodeId];
    
    return parent.children;
  }

  createBranchNavigation(siblings, currentIndex, messageIndex, fullBranch) {
    const totalSiblings = siblings.length;
    
    return `
      <div class="branch-navigation">
        <button class="branch-nav-btn" 
                onclick="window._ctree.uiManager.navigateToBranch(${messageIndex}, ${currentIndex - 1}, '${siblings.join(',')}')"
                ${currentIndex === 0 ? 'disabled' : ''}>
          ←
        </button>
        <span class="branch-indicator">${currentIndex + 1}/${totalSiblings}</span>
        <button class="branch-nav-btn"
                onclick="window._ctree.uiManager.navigateToBranch(${messageIndex}, ${currentIndex + 1}, '${siblings.join(',')}')"
                ${currentIndex === totalSiblings - 1 ? 'disabled' : ''}>
          →
        </button>
      </div>
    `;
  }

  navigateToBranch(messageIndex, newSiblingIndex, siblingsStr) {
    const siblings = siblingsStr.split(',');
    const newNodeId = siblings[newSiblingIndex];
    
    if (!newNodeId) return;
    
    console.log(`🔄 Navigating to branch: ${newNodeId} from siblings: [${siblings.join(', ')}]`);
    
    // Obtener el nodo padre (donde están las flechas) para centrar la vista ahí
    const newNode = this.tree.nodes.get(newNodeId);
    const parentNodeId = newNode?.parentId;
    
    console.log(`📋 New node: ${newNodeId}, Parent: ${parentNodeId}`);
    console.log(`📋 New node object:`, newNode);
    
    // Verificar que el nodo padre existe
    const parentNode = parentNodeId ? this.tree.nodes.get(parentNodeId) : null;
    console.log(`📋 Parent node object:`, parentNode);
    
    // Actualizar el nodo actual para reflejar la nueva rama seleccionada
    this.tree.currentNodeId = newNodeId;
    
    // Re-renderizar la vista de chat
    this.renderChatView();
    
    // Centrar en el nodo padre (donde están las opciones con flechas)
    setTimeout(() => {
      if (parentNodeId && parentNode) {
        console.log(`📍 Attempting to center on parent node: ${parentNodeId}`);
        // FIJO: Verificar que el elemento del padre existe en el contenedor de chat
        const chatMessages = document.querySelector('#chatMessages');
        const parentElement = chatMessages ? chatMessages.querySelector(`[data-node-id="${parentNodeId}"]`) : null;
        console.log(`📍 Parent element found in chat:`, parentElement);
        
        if (parentElement) {
          // Centrar en el padre, pero highlight el hijo que cambió
          this.scrollToNodeInChat(parentNodeId, newNodeId);
          console.log(`📍 Successfully centered on parent node: ${parentNodeId} (child changed to: ${newNodeId})`);
        } else {
          console.log(`❌ Parent element not found in chat DOM, falling back to child node`);
          this.scrollToNodeInChat(newNodeId);
        }
      } else {
        // Fallback: centrar en el nodo seleccionado si no hay padre
        console.log(`❌ No parent found or parent doesn't exist, centering on: ${newNodeId}`);
        this.scrollToNodeInChat(newNodeId);
      }
    }, 150); // Aumentar delay para asegurar que el DOM esté completamente renderizado
  }

  scrollToNodeInChat(nodeId, highlightNodeId = null) {
    console.log(`🎯 scrollToNodeInChat called with nodeId: ${nodeId}, highlightNodeId: ${highlightNodeId}`);
    
    const chatMessages = document.querySelector('#chatMessages');
    // FIJO: Buscar solo dentro del contenedor de chat, no en todo el documento
    const targetMessage = chatMessages ? chatMessages.querySelector(`[data-node-id="${nodeId}"]`) : null;
    
    console.log(`🎯 chatMessages container:`, chatMessages);
    console.log(`🎯 targetMessage element:`, targetMessage);
    
    if (!chatMessages || !targetMessage) {
      console.log(`❌ Missing elements - chatMessages: ${!!chatMessages}, targetMessage: ${!!targetMessage}`);
      return;
    }
    
    // Calcular la posición para centrar el mensaje
    const containerHeight = chatMessages.clientHeight;
    const messageTop = targetMessage.offsetTop;
    const messageHeight = targetMessage.offsetHeight;
    
    console.log(`📏 Container height: ${containerHeight}, Message top: ${messageTop}, Message height: ${messageHeight}`);
    
    // Centrar el mensaje en la vista
    const scrollTop = messageTop - (containerHeight / 2) + (messageHeight / 2);
    
    console.log(`📏 Calculated scrollTop: ${scrollTop}`);
    
    // Scroll suave al mensaje seleccionado
    chatMessages.scrollTo({
      top: Math.max(0, scrollTop),
      behavior: 'smooth'
    });
    
    console.log(`📍 Scrolled to position: ${Math.max(0, scrollTop)}`);
    
    // Animación temporal para destacar el nodo que cambió (si se especifica)
    const nodeToHighlight = highlightNodeId || nodeId;
    // FIJO: Buscar elemento de highlight solo en el contenedor de chat
    const highlightMessage = chatMessages ? chatMessages.querySelector(`[data-node-id="${nodeToHighlight}"]`) : null;
    
    console.log(`✨ Highlighting node: ${nodeToHighlight}, element:`, highlightMessage);
    
    if (highlightMessage) {
      highlightMessage.classList.add('highlight-navigation');
      setTimeout(() => {
        highlightMessage.classList.remove('highlight-navigation');
      }, 1500);
    }
    
    console.log(`📍 Centered chat view on node: ${nodeId}${highlightNodeId ? ` (highlighted: ${highlightNodeId})` : ''}`);
  }

  async exportTree() {
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
        sticker: n.image ?? "", // Incluir la URL del sticker
      })),
    };

    // Download to user's computer
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversational-tree.json';
    a.click();
    URL.revokeObjectURL(url);

    // Also save to server
    try {
      const response = await fetch('/api/export-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: data,
          filename: 'conversational-tree'
        })
      });

      const result = await response.json();
      if (result.success) {
        console.log(`💾 Chat automatically saved to server: ${result.filename}`);
        // Refresh the saved chats list
        this.loadSavedChats();
      } else {
        console.error('Failed to save chat to server:', result.error);
      }
    } catch (error) {
      console.error('Error saving chat to server:', error);
    }
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
    if (this.currentViewMode === VIEW_MODES.CHAT) {
      this.renderChatView();
    } else {
      this.updateVisualization();
    }
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
    const chatForm = document.querySelector(SELECTORS.chatMessageForm);
    const chatInput = document.querySelector(SELECTORS.chatMessageInput);
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

    // Chat form event handling
    chatForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.addChatMessage();
    });

    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.target.blur();
    });

    importFile?.addEventListener('change', (e) => this.onImportFile(e));
    transformFile?.addEventListener('change', (e) => this.onTransformFile(e));

    // Sidebar toggle functionality
    sidebarToggle?.addEventListener('click', () => this.toggleSidebar());

    // Close button for info panel
    closeInfoBtn?.addEventListener('click', () => this.closeNodeInfo());

    // Sticker buttons
    const generateStickerBtn = document.querySelector('#generateStickerBtn');
    const viewStickerBtn = document.querySelector('#viewStickerBtn');
    
    generateStickerBtn?.addEventListener('click', () => this.generateSticker());
    viewStickerBtn?.addEventListener('click', () => this.viewSticker());

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
    controls?.addEventListener('click', async (e) => {
      const el = /** @type {HTMLElement} */ (e.target);
      if (!(el instanceof HTMLElement)) return;
      const action = el.dataset.action;
      if (!action) return;
      if (action === 'export') await this.exportTree();
      else if (action === 'import') importFile?.click();
      else if (action === 'transform-json') transformFile?.click();
      else if (action === 'change-view') this.toggleGlobalView();
      else if (action === 'change-view-mode') this.toggleViewMode();
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

  // Métodos para manejar stickers
  updateStickerButtons(nodeId) {
    const generateBtn = document.querySelector('#generateStickerBtn');
    const viewBtn = document.querySelector('#viewStickerBtn');
    if (!generateBtn || !viewBtn) return;

    const node = this.tree.nodes.get(nodeId);
    if (!node) return;

    if (node.imageGenerating) {
      generateBtn.disabled = true;
      generateBtn.textContent = '⏳ Generando...';
      viewBtn.style.display = 'none';
    } else if (node.image) {
      generateBtn.disabled = false;
      generateBtn.textContent = '🔄 Regenerar Sticker';
      viewBtn.style.display = 'inline-block';
    } else {
      generateBtn.disabled = false;
      generateBtn.textContent = '🎨 Generar Sticker';
      viewBtn.style.display = 'none';
    }
  }

  async generateSticker() {
    const panel = document.querySelector(SELECTORS.infoPanel);
    const nodeId = panel?.dataset.originatingNodeId;
    if (!nodeId) return;

    console.log('🎨 Generating sticker for node:', nodeId);
    
    const success = await this.tree.generateImageForNode(nodeId);
    if (success) {
      // Refresh the node info panel to show the new sticker
      const nodeData = { id: nodeId };
      this.showNodeInfo(nodeData);
      console.log('✅ Sticker generated and displayed');
    } else {
      console.error('❌ Failed to generate sticker');
      // You could show an error message to the user here
    }
  }

  viewSticker() {
    const panel = document.querySelector(SELECTORS.infoPanel);
    const nodeId = panel?.dataset.originatingNodeId;
    if (!nodeId) return;

    const node = this.tree.nodes.get(nodeId);
    if (node?.image) {
      // Open sticker in a modal or new window
      const modal = document.createElement('div');
      modal.className = 'sticker-modal';
      modal.innerHTML = `
        <div class="sticker-modal-content">
          <button class="sticker-modal-close">✕</button>
          <img src="${node.image}" alt="Generated sticker" />
          <div class="sticker-modal-info">
            <p><strong>Nodo:</strong> ${nodeId}</p>
            <p><strong>Prompt:</strong> ${node.imagePrompt || 'N/A'}</p>
          </div>
        </div>
      `;
      
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
        background: rgba(0,0,0,0.8); display: flex; align-items: center; 
        justify-content: center; z-index: 10000;
      `;
      
      const content = modal.querySelector('.sticker-modal-content');
      content.style.cssText = `
        background: var(--color-panel); padding: 20px; border-radius: 8px; 
        max-width: 90%; max-height: 90%; position: relative; text-align: center;
      `;
      
      const closeBtn = modal.querySelector('.sticker-modal-close');
      closeBtn.style.cssText = `
        position: absolute; top: 10px; right: 15px; background: none; 
        border: none; font-size: 20px; color: var(--color-text); cursor: pointer;
      `;
      
      const img = modal.querySelector('img');
      img.style.cssText = 'max-width: 100%; max-height: 60vh; border-radius: 8px;';
      
      closeBtn.addEventListener('click', () => document.body.removeChild(modal));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
      });
      
      document.body.appendChild(modal);
    }
  }


}
