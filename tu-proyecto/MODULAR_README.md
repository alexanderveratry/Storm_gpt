# 🏗️ Estructura Modular - Storm GPT

La aplicación ha sido **modularizada** para mejorar la organización, mantenimiento y escalabilidad del código.

## 📁 Estructura de Archivos

```
public/
├── app.js                     # 🚀 Punto de entrada principal (modular)
├── app_original.js           # 📦 Respaldo del archivo original monolítico
├── app_modular.js            # 📝 Versión temporal del archivo modular
├── index.html                # 🌐 HTML principal (actualizado para usar módulos)
├── style.css                 # 🎨 Estilos CSS
└── modules/                  # 📚 Módulos organizados por funcionalidad
    ├── constants.js          # 📏 Constantes y configuraciones
    ├── utils.js              # 🔧 Funciones utilitarias
    ├── splashScreen.js       # 🎭 Gestión de pantalla de splash
    ├── conversationalTree.js # 🌳 Clases del árbol conversacional
    ├── openaiIntegration.js  # 🤖 Integración con OpenAI API
    ├── treeRenderer.js       # 🎨 Renderizado con D3.js
    └── uiManager.js          # 🖱️ Gestión de interfaz y eventos
```

## 🧩 Módulos Principales

### 📏 `constants.js`
- Todas las constantes de la aplicación
- Dimensiones de embedding
- Configuraciones de layout
- Selectores DOM
- Parámetros de tiempo

### 🔧 `utils.js`
- Funciones utilitarias reutilizables
- Escape HTML y truncado de texto
- Funciones matemáticas (hash, coseno, normalización)
- Helpers de DOM y estado

### 🎭 `splashScreen.js`
- Gestión completa de la pantalla de splash
- Control de animaciones de inicio
- Transiciones entre splash y app principal

### 🌳 `conversationalTree.js`
- `ConversationalTree`: Clase base del árbol
- `EnhancedConversationalTree`: Extensión con funcionalidades avanzadas
- Lógica de nodos, embeddings y contexto
- Generación de resúmenes

### 🤖 `openaiIntegration.js`
- Comunicación con APIs de OpenAI
- Manejo de embeddings y chat
- Construcción de prompts y historial
- Fallbacks y manejo de errores

### 🎨 `treeRenderer.js`
- Renderizado completo con D3.js
- Layout jerárquico y posicionamiento
- Interacciones drag & drop
- Tooltips y visualización

### 🖱️ `uiManager.js`
- Gestión de toda la interfaz de usuario
- Eventos y formularios
- Sidebar y contexto de memoria
- Import/export de datos
- Estados de vista (resumen/contenido)


## 🔄 modulos

1. **✅ Extracción de constantes** → `constants.js`
2. **✅ Separación de utilidades** → `utils.js`  
3. **✅ Modularización de clases principales** → `conversationalTree.js`
4. **✅ Aislamiento de integración API** → `openaiIntegration.js`
5. **✅ Separación de renderizado** → `treeRenderer.js`
6. **✅ Gestión de UI independiente** → `uiManager.js`
7. **✅ Splash screen modular** → `splashScreen.js`
8. **✅ Nuevo punto de entrada** → `app.js` 
