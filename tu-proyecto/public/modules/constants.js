/*
 * constants.js — Application Constants
 * Todas las constantes utilizadas en la aplicación.
 */

// Dimensiones para los vectores de embedding (representación semántica de texto)
export const EMBEDDING_DIM_SMALL = 10;
export const EMBEDDING_DIM_FALLBACK = 1536;

// Intervalo para generar resúmenes y límites de zoom en el árbol
export const SUMMARY_INTERVAL_MS = 10000; // 10 segundos
export const ZOOM_EXTENT = [0.1, 3];

// Parámetros de diseño para el árbol y etiquetas
export const LAYOUT = {
  // Distancia horizontal entre padre e hijos
  levelDX: 260,
  // Espacio vertical mínimo entre hermanos
  siblingGapMin: 90,
  // Dimensiones de las etiquetas
  // offset: controla cuánto se separa la caja de la etiqueta respecto al nodo al que pertenece
  label: { w: 240, h: 150, offset: 30 },
  wrapperMargin: 8,
  wrapperGap: 20,
  repelIterations: 5,
};

// Splash screen duration (in milliseconds)
export const SPLASH_DURATION = 3000; // 3 seconds

// Selectores de elementos del DOM usados en la app
export const SELECTORS = {
  svg: '#treeSvg',
  messageForm: '#messageForm',
  messageInput: '#messageInput',
  importFile: '#importFile',
  controls: '.controls',
  chatArea: '#chatArea',
  infoPanel: '#infoPanel',
  nodeInfo: '#nodeInfo',
  statusBar: '#statusBar',
  modelSelector: '#modelSelector',
  treeView: '#treeView',
  chatView: '#chatView',
  chatMessageForm: '#chatMessageForm',
  chatMessageInput: '#chatMessageInput',
  currentBranchInfo: '#currentBranchInfo',
};

// Modos de vista disponibles
export const VIEW_MODES = {
  TREE: 'tree',
  CHAT: 'chat'
};
