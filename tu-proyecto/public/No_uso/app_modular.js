/*
 * app.js — Main Application Entry Point (Modular Version)
 * Punto de entrada principal que orquesta todos los módulos.
 */
'use strict';

// Imports de módulos
import { SPLASH_DURATION, SUMMARY_INTERVAL_MS } from '../modules/constants.js';
import { 
  isFreshAppLaunch, 
  markSplashShown, 
  initializeSplashScreen, 
  showMainApp 
} from '../modules/splashScreen.js';
import { EnhancedConversationalTree } from '../modules/conversationalTree.js';
import { OpenAIIntegration } from '../modules/openaiIntegration.js';
import { TreeRenderer } from '../modules/treeRenderer.js';
import { UIManager } from '../modules/uiManager.js';
import { SELECTORS } from '../modules/constants.js';

// Variables globales principales
let tree;
let openaiIntegration;
let renderer;
let uiManager;

async function initializeApp() {
  console.log('🚀 Initializing modular app...');
  
  // Inicializar componentes principales
  openaiIntegration = new OpenAIIntegration();
  tree = new EnhancedConversationalTree(openaiIntegration);
  renderer = new TreeRenderer(SELECTORS.svg);
  uiManager = new UIManager(tree, renderer);

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
  
  // Actualizar interfaz
  uiManager.updateAll();

  // Configurar eventos y generación de resúmenes
  uiManager.bindUI();
  uiManager.setupSummaryGeneration();

  console.log('✅ Modular app initialized successfully');
}

// Inicialización principal
window.addEventListener('DOMContentLoaded', async () => {
  console.log('🌟 DOM Content Loaded - Modular Version');
  
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

// Exponer API mínima para debugging y control manual
window._ctree = { 
  get tree() { return tree; },
  get uiManager() { return uiManager; },
  get renderer() { return renderer; },
  get openaiIntegration() { return openaiIntegration; },
  
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
