# Documentación para LLM: Conversational Tree 🌳

## 🎯 Propósito del Proyecto
Esta aplicación implementa un **sistema de conversación no lineal** donde las conversaciones pueden ramificarse como un árbol. Los usuarios pueden chatear con IA y crear múltiples ramas de conversación desde cualquier punto, permitiendo explorar diferentes líneas de conversación de manera organizada.

## 🏗️ Arquitectura General

```
┌─────────────────┬─────────────────────────────────┐
│    Backend      │           Frontend              │
│   (server.js)   │      (HTML + JS + D3.js)       │
├─────────────────┼─────────────────────────────────┤
│ • Express API   │ • Visualización del árbol      │
│ • OpenAI SDK    │ • Lógica de conversación       │
│ • Cache embedds │ • Interfaz de usuario          │
│ • Retries       │ • Exportar/Importar sesiones   │
└─────────────────┴─────────────────────────────────┘
```

## 📂 Estructura de Archivos

```
tu-proyecto/
├── server.js                 # Backend API con Express
├── package.json              # Dependencias del proyecto
├── .env                      # Variables de entorno (no incluido)
└── public/
    ├── index.html            # Estructura HTML principal
    ├── app.js                # Lógica principal del frontend
    └── style.css             # Estilos CSS
```

## 🧠 Conceptos Clave

### 1. Estructura de Datos del Nodo
Cada mensaje en la conversación es un "nodo" con esta estructura:

```javascript
{
  id: "node_5",                    // Identificador único
  content: "Hola, ¿cómo estás?",   // Contenido del mensaje
  parentId: "node_3",              // ID del nodo padre (null para raíz)
  children: ["node_6", "node_7"],  // IDs de nodos hijos
  timestamp: new Date(),           // Momento de creación
  embedding: [...],                // Vector de embeddings para similitud
  importance: 0.7,                 // Puntuación de importancia (0-1)
  role: "user",                    // "user" o "assistant"
  isAI: false,                     // true si fue generado por IA
  summary: "Saludo inicial...",    // Resumen generado automáticamente
  keywords: ["saludo", "estado"]   // Palabras clave extraídas
}
```

### 2. Sistema de Contexto Relevante
La IA recibe contexto interno de tres fuentes para generar respuestas coherentes:

1. **Path Context**: Todos los nodos en el camino desde la raíz hasta el nodo actual
2. **Sibling Context**: Nodos hermanos (mismo padre)
3. **Semantic Context**: Nodos semánticamente similares (usando embeddings)

### 3. Roles de Usuario y Tipos de Nodo
- **Usuario**: Representado por rombos rojos (⧫)
- **IA**: Representado por círculos azules/verdes (●)
- **Nodo Activo**: Resaltado con borde blanco

## 🔧 Componentes Técnicos

### Backend (server.js)

#### Endpoints Principales:

```javascript
POST /api/embeddings
// Genera embeddings para texto usando OpenAI
// Input: { input: "texto a procesar" }
// Output: { embedding: [0.1, 0.2, ...] }

POST /api/chat  
// Genera respuesta de IA basada en contexto
// Input: { messages: [...], system: "prompt", model: "gpt-4" }
// Output: { content: "respuesta de la IA" }
```

#### Características Clave:
- **Cache de Embeddings**: Evita recalcular embeddings repetidos
- **Sistema de Reintentos**: Maneja fallos de API con backoff exponencial
- **Modo Mock**: Funciona offline para desarrollo sin consumir API

### Frontend (app.js)

#### Clases Principales:

```javascript
// Maneja la estructura del árbol de conversación
class ConversationalTree {
  addNode(content, parentId)     // Añade un nuevo nodo
  getPathToNode(id)              // Obtiene el camino completo a un nodo
  getRelevantContext(id)         // Calcula contexto relevante
  cosine(a, b)                   // Similitud coseno entre embeddings
}

// Integración con OpenAI
class OpenAIIntegration {
  getEmbedding(text)             // Obtiene embedding de texto
  getChatResponse(path, context) // Genera respuesta de IA
  buildSystemPrompt(context)     // Construye prompt con contexto
}

// Extensión con funcionalidades avanzadas
class EnhancedConversationalTree extends ConversationalTree {
  generateAIResponse()           // Genera respuesta automática de IA
  generateSummaryForNode()       // Crea resúmenes automáticos
  loadExportedNodes()            // Importa conversaciones guardadas
}

// Gestión de interfaz de usuario
class UIManager {
  exportTree()                   // Exporta el árbol actual a JSON
  onImportFile()                 // Importa archivo JSON con formato de la app
  transformJsonFormat()          // Transforma JSON externo al formato interno
  onTransformFile()              // Maneja la selección y transformación de archivos
  checkSummaries()               // Revisa y genera resúmenes faltantes
  toggleSidebar()                // Expande/contrae el panel lateral con animación
  toggleViewMode()               // Alterna entre vista árbol y chat
  setViewMode()                  // Establece modo de vista específico
  renderChatView()               // Renderiza vista de chat lineal con burbujas
  navigateToBranch()             // Navega entre ramas paralelas en vista chat
  addChatMessage()               // Añade mensajes desde la vista de chat
  updateChatBranchInfo()         // Actualiza información del nodo de expansión
}
```

### Visualización (D3.js)

La visualización usa D3.js para crear un árbol interactivo:

```javascript
// Layout en cascada vertical
// - Root en la parte superior
// - Cada nivel de conversación en una fila
// - Ramificaciones se extienden horizontalmente

function updateVisualization() {
  // 1. Calcula posiciones de nodos en cascada
  // 2. Dibuja enlaces entre nodos padre-hijo
  // 3. Renderiza nodos como círculos (IA) o rombos (usuario)
  // 4. Añade etiquetas con resúmenes
  // 5. Maneja interacciones (drag, click, hover)
}
```

## 🎮 Flujo de Interacción del Usuario

### 1. Envío de Mensaje
```
Usuario escribe mensaje → 
Nodo usuario creado → 
IA calcula contexto relevante → 
IA genera respuesta → 
Nodo IA creado → 
Visualización actualizada
```

### 2. Ramificación (Branching)
```
Usuario hace click en "Branch" → 
Selecciona punto de ramificación → 
Escribe nuevo mensaje → 
Nueva rama creada desde ese punto
```

### 3. Navegación en Vista Árbol
```
Click en nodo → 
Nodo se vuelve activo → 
Path actualizado en sidebar → 
Contexto relevante recalculado
```

### 4. Vista de Chat Lineal
```
Click en "Vista Chat" → 
Se muestra rama completa como conversación → 
Burbujas estilo ChatGPT/Claude → 
Navegación con flechas ← → entre ramas paralelas
```

#### Características de la Vista Chat:
- **Selección de Rama**: Al seleccionar un nodo en vista árbol, la vista chat muestra desde la raíz hasta todas las hojas de esa rama
- **Navegación de Ramas**: Cuando hay múltiples respuestas al mismo mensaje (nodos hermanos), aparecen flechas ← → para navegar entre ellas
- **Indicador de Posición**: Se muestra "2/4" para indicar qué respuesta alternativa se está viendo
- **Burbujas Diferenciadas**: Mensajes de usuario (verde, alineados a la derecha) y asistente (gris, alineados a la izquierda)
- **IDs de Nodos**: Cada mensaje muestra su identificador (node_1, node_2, etc.) con destacado especial para el nodo actual
- **Nodo Actual Resaltado**: El nodo seleccionado se resalta con borde verde brillante y glow
- **Timestamps**: Cada mensaje muestra la hora de creación
- **Persistencia de Foco**: Al cambiar entre vistas, se mantiene el nodo seleccionado
- **Expansión de Conversación**: Input al final de la vista para continuar la conversación desde el último nodo
- **Información Contextual**: Muestra desde qué nodo se expandirá la conversación

## 📊 Algoritmos Clave

### Cálculo de Importancia
```javascript
function _importance(content) {
  let score = 0.3; // Base score
  score += Math.min(content.length/100, 0.3); // Length bonus
  
  // Keyword bonus
  ['important', 'key', 'main', 'primary', 'crucial'].forEach(word => {
    if(content.toLowerCase().includes(word)) score += 0.1;
  });
  
  return Math.min(score, 1);
}
```

### Similitud Semántica
```javascript
function cosine(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}
```

### Scoring de Relevancia
```javascript
function relevanceScore(node, target, proximity) {
  let score = node.importance * 0.4;
  
  // Proximity bonus
  const proxScore = proximity === 'close' ? 0.6 : 
                   proximity === 'medium' ? 0.4 : 0.2;
  score += proxScore;
  
  // Temporal relevance
  const timeDiff = Math.abs(node.timestamp - target.timestamp) / (1000*60*60);
  score += Math.max(0, 0.2 - timeDiff * 0.01);
  
  return score;
}
```

## 🎨 Sistema de Estilos

### Variables CSS Principales:
```css
:root {
  --color-bg: #0a0a0a;           /* Fondo principal */
  --color-panel: #1a1a1a;       /* Paneles laterales */
  --color-accent: #00ff88;       /* Color de acento */
  --color-accent-alt: #0066cc;   /* Color alternativo */
  --color-danger: #ff6b6b;       /* Color de alerta */
}
```

### Componentes Visuales:
- **Nodos IA**: Círculos azules con efecto hover
- **Nodos Usuario**: Rombos rojos rotados 45°
- **Enlaces**: Líneas grises que se vuelven verdes en el path activo
- **Tooltips**: Cajas flotantes con fondo semi-transparente
- **Sidebar**: Panel izquierdo con chat history (expandible/contraíble)
- **Botón Toggle**: Círculo verde ‹ para contraer/expandir sidebar con animación suave
- **Vista Chat**: Interfaz lineal estilo ChatGPT/Claude con burbujas diferenciadas
- **Navegación de Ramas**: Flechas ← → para alternar entre respuestas paralelas

## 🔄 Sistema de Persistencia

### Formato de Exportación:
```json
{
  "version": 1,
  "exportedAt": "2025-08-14T...",
  "nodes": [
    {
      "id": "node_0",
      "content": "Mensaje...",
      "parentId": null,
      "timestamp": "2025-08-14T...",
      "summary": "Resumen...",
      "keywords": ["palabra1", "palabra2"]
    }
  ]
}
```

### Proceso de Importación (Optimizado):
1. Se limpia el árbol actual
2. Nodos se ordenan por timestamp
3. **Generación paralela de embeddings** (principal optimización)
4. Se construyen nodos con embeddings obtenidos
5. Se reconstruyen relaciones padre-hijo
6. Se infieren roles user/assistant alternados
7. **Generación de resúmenes condicional** (solo para conversaciones ≤20 nodos)

#### Optimizaciones de Rendimiento:
- **Procesamiento paralelo**: Los embeddings se generan simultáneamente en lugar de secuencialmente
- **Resúmenes inteligentes**: Solo se generan automáticamente para conversaciones pequeñas
- **Indicadores de progreso**: Muestra porcentaje de carga en tiempo real
- **Cache de embeddings**: El servidor evita recalcular embeddings repetidos
- **UI diferida**: La interfaz se actualiza una sola vez al final del proceso

### Transformación de JSON:
La aplicación incluye una funcionalidad para transformar archivos JSON de formato externo al formato interno de la aplicación.

#### Formato de Entrada Esperado:
```json
{
  "metadata": {
    "dates": {
      "created": "8/28/2025 16:39:42"
    },
    "powered_by": "ChatGPT Exporter (https://www.chatgptexporter.com)"
  },
  "messages": [
    {
      "role": "Prompt",
      "say": "¿Mensaje del usuario?"
    },
    {
      "role": "Response", 
      "say": "Respuesta del asistente..."
    }
  ]
}
```

#### Reglas de Transformación:
- Se crea un nodo inicial de bienvenida (`node_0`) con contenido "Bienvenido"
- Cada elemento en `messages` se convierte en un nodo adicional
- El campo `say` se mapea a `content`
- Los IDs se generan en orden ascendente: `node_0` (bienvenida), `node_1`, `node_2`, etc.
- El nodo de bienvenida tiene `parentId: null`
- El primer mensaje importado (`node_1`) tiene como padre el nodo de bienvenida (`node_0`)
- Los nodos subsecuentes tienen como `parentId` el ID del nodo anterior
- Los campos `summary` y `keywords` se inicializan vacíos
- Se asigna el timestamp actual a todos los nodos

#### Proceso de Transformación:
1. Usuario hace click en "Transform JSON"
2. Selecciona archivo JSON con formato externo
3. El sistema valida la estructura del archivo
4. Se muestra un preview del resultado
5. Usuario confirma la carga
6. Opcionalmente se puede descargar el archivo transformado

## 🛠️ Configuración y Uso

### Variables de Entorno:
```env
OPENAI_API_KEY=sk-...        # API key de OpenAI
MOCK_OPENAI=false           # true para modo desarrollo
PORT=3000                   # Puerto del servidor
```

### Comandos:
```bash
npm install                 # Instalar dependencias
npm start                   # Iniciar servidor
```



### Controles Disponibles:

1. **CHANGE VIEW**: Alterna entre vista de resumen y contenido completo (solo en modo árbol)
2. **Vista Árbol/Chat**: Alterna entre visualización de árbol y chat lineal
3. **Revisar Resúmenes**: Genera resúmenes para nodos que no los tengan
4. **Export**: Descarga el árbol actual en formato JSON
5. **Import**: Carga un archivo JSON con formato de la aplicación
6. **Transform JSON**: Convierte archivos JSON externos al formato interno
7. **Toggle Sidebar**: Botón ‹ en el sidebar para expandir/contraer el panel lateral

**Nota**: Los botones "CHANGE VIEW" y "Vista Árbol/Chat" son independientes y cumplen funciones diferentes.

### Atajos de Teclado:

- **Ctrl/Cmd + B**: Alternar sidebar (expandir/contraer)
- **Escape**: Cerrar panel de información de nodo

### Para Añadir Nuevas Funcionalidades:

1. **Nuevos Tipos de Nodo**: Modificar `role` y añadir lógica en `updateVisualization()`
2. **Algoritmos de Layout**: Reemplazar lógica en `updateVisualization()`
3. **Nuevos Modelos de IA**: Modificar endpoints en `server.js`
4. **Persistencia en DB**: Reemplazar sistema de export/import
5. **Colaboración Tiempo Real**: Añadir WebSockets
6. **Nuevos Formatos de Transformación**: Extender `transformJsonFormat()` en `UIManager`

### Hooks de Eventos Importantes:
```javascript
// Al añadir nodo
tree.addNode(content, parentId) 

// Al cambiar nodo activo  
tree.currentNodeId = newId;
updateAll();

// Al generar respuesta IA
tree.generateAIResponse()

// Al exportar/importar
exportTree() / onImportFile()
```
