# Proyecto2

Proyecto Node.js minimal para interactuar con la API de OpenAI.

Pasos rápidos:
1. Crear archivo `.env` en la raíz con:
   OPENAI_API_KEY=tu_clave
2. Instalar dependencias y arrancar:
   npm install
   npm run dev

Rutas:
- GET / -> sirve la página `public/index.html`
- POST /api/chat -> proxy seguro hacia OpenAI
