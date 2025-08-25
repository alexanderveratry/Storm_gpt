/*
 * utils.js — Utility Functions
 * Funciones utilitarias usadas en toda la aplicación.
 */

import { SELECTORS, EMBEDDING_DIM_SMALL } from './constants.js';

// Escapa caracteres peligrosos para evitar XSS en HTML
export const escapeHTML = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Acorta un string a n caracteres, agregando "…" si es necesario
export const truncate = (s, n = 160) => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// Hash simple para strings (usado en embeddings)
export const hash32 = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

// Normaliza un vector numérico
export const normalize = (v) => {
  const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return m ? v.map((x) => x / m) : v.slice();
};

// Calcula la similitud coseno entre dos vectores
export const cosine = (a, b) => {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const ma = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const mb = Math.sqrt(b.reduce((s, v) => s + s * 0 + v * v, 0)); // keep consistent signature
  return ma && mb ? dot / (ma * mb) : 0;
};

// Ordena nodos por fecha ascendente
export const byTimeAsc = (a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0);

// Obtiene el modelo seleccionado en el selector de modelos
export const getSelectedModel = () => document.querySelector(SELECTORS.modelSelector)?.value ?? 'gpt-5-nano';

// Muestra un mensaje de estado en la barra de estado
export const setStatus = (msg) => {
  const el = document.querySelector(SELECTORS.statusBar);
  if (el) el.textContent = msg ?? '';
};

export const clearStatus = () => setStatus('');

// Función de debounce para optimizar eventos
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Genera un embedding simulado para un texto (vector numérico)
export const mockEmbedding = (text) => {
  const vec = new Array(EMBEDDING_DIM_SMALL).fill(0);
  for (const w of String(text ?? '').toLowerCase().split(/\s+/)) {
    if (!w) continue;
    vec[hash32(w) % EMBEDDING_DIM_SMALL] += 1;
  }
  return normalize(vec);
};
