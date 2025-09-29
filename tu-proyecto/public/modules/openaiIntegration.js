/*
 * openaiIntegration.js — OpenAI API Integration
 * Manejo de las comunicaciones con la API de OpenAI para embeddings y chat.
 */

import { EMBEDDING_DIM_FALLBACK } from './constants.js';
import { getSelectedModel, hash32, normalize } from './utils.js';

export class OpenAIIntegration {
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

  async getChatResponse(pathIds, context, tree) {
    const system = this.buildSystemPrompt(context);
    const messages = this.buildMessageHistory(pathIds, tree);
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
    let p = 'helpful\n';
    for (const { node, proximity, reason } of ctxList) {
      p += `- [${proximity.toUpperCase()}-${reason}]: "${node.content}"\n`;
    }
    p += 'Instructions: Answer simple';
    return p;
  }

  buildMessageHistory(pathIds, tree) {
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
