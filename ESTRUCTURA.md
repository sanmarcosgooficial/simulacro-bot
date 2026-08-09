# Estructura del Proyecto — CRM IA Simulacros San Marcos

Sistema CRM con agente de IA para automatizar la venta de Simulacros San Marcos vía WhatsApp.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS, SWR |
| Backend | NestJS 10, TypeScript |
| ORM | TypeORM 0.3 |
| Base de datos | PostgreSQL |
| IA | OpenAI — chat con `gpt-4o-mini`, clasificadores con `gpt-4o-mini` (via `OPENAI_CLASSIFIER_MODEL`) |
| WhatsApp | YCloud API |
| Almacenamiento | Cloudflare R2 (AWS S3 compatible) |
| Tiempo real | Server-Sent Events (SSE) |
| Autenticación | JWT + Passport |
| Monorepo | pnpm workspaces |

---

## Árbol de directorios

```
simulacro-bot/                         ← Raíz del monorepo
│
├── INICIAR.bat                        ← Arranca backend + frontend en paralelo
├── PRIMERA_VEZ.bat                    ← Instalación inicial (pnpm + dependencias)
├── cloudflared.exe                    ← Binario de Cloudflare Tunnel (gitignored, solo local)
├── package.json                       ← Scripts raíz del workspace
├── pnpm-workspace.yaml                ← Define los paquetes: backend y frontend
├── pnpm-lock.yaml
├── .gitignore
├── README.md
├── cf-out.txt / cf-err.txt            ← Logs del túnel Cloudflare (gitignored, solo local)
│
├── backend/                           ← Paquete NestJS
│   ├── .env                           ← Variables de entorno (no en git)
│   ├── .env.example                   ← Plantilla de variables de entorno
│   ├── nest-cli.json
│   ├── tsconfig.json
│   ├── package.json
│   ├── dist/                          ← Build compilado (generado)
│   ├── uploads/                       ← Archivos subidos temporalmente
│   └── src/
│       ├── main.ts                    ← Punto de entrada, configura CORS y Swagger
│       ├── app.module.ts              ← Módulo raíz, registra TypeORM y todos los módulos
│       │
│       ├── auth/                      ← Autenticación JWT
│       │   ├── dto/
│       │   │   └── login.dto.ts
│       │   ├── entities/
│       │   │   └── user.entity.ts     ← Entidad User (email, password hash, rol)
│       │   ├── guards/
│       │   │   └── jwt-auth.guard.ts
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts
│       │   ├── auth.controller.ts     ← POST /auth/login, GET /auth/me
│       │   ├── auth.module.ts
│       │   └── auth.service.ts        ← Login, validación, generación de JWT
│       │
│       ├── contacts/                  ← Gestión de prospectos / leads
│       │   ├── dto/
│       │   │   ├── create-contact.dto.ts
│       │   │   └── update-contact.dto.ts
│       │   ├── entities/
│       │   │   └── contact.entity.ts  ← Entidad Contact (nombre, teléfono, estado…)
│       │   ├── contacts.controller.ts ← CRUD /contacts
│       │   ├── contacts.module.ts
│       │   └── contacts.service.ts
│       │
│       ├── simulacros/                ← Catálogo de simulacros disponibles
│       │   ├── dto/
│       │   │   ├── create-simulacro.dto.ts
│       │   │   └── update-simulacro.dto.ts
│       │   ├── entities/
│       │   │   └── simulacro.entity.ts ← Entidad Simulacro (nombre, precio, fecha…)
│       │   ├── simulacros.controller.ts ← CRUD /simulacros
│       │   ├── simulacros.module.ts
│       │   └── simulacros.service.ts
│       │
│       ├── conversations/             ← Conversaciones de WhatsApp
│       │   ├── entities/
│       │   │   ├── conversation.entity.ts ← Conversación (contacto, estado, asignado)
│       │   │   └── message.entity.ts      ← Mensaje individual (texto, tipo, timestamp)
│       │   ├── conversations.controller.ts ← GET /conversations, GET /conversations/:id/messages
│       │   ├── conversations.module.ts
│       │   └── conversations.service.ts
│       │
│       ├── webhooks/                  ← Receptor de eventos de YCloud (WhatsApp)
│       │   ├── webhooks.controller.ts ← POST /webhooks/ycloud
│       │   ├── webhooks.module.ts
│       │   └── webhooks.service.ts    ← Procesamiento de mensajes entrantes (~38 KB)
│       │
│       ├── ai/                        ← Agente de IA (OpenAI)
│       │   ├── ai.module.ts
│       │   └── ai.service.ts          ← Lógica del agente conversacional (~12 KB)
│       │
│       ├── ycloud/                    ← Integración con la API de YCloud
│       │   ├── ycloud.module.ts
│       │   └── ycloud.service.ts      ← Envío de mensajes WhatsApp, plantillas
│       │
│       ├── settings/                  ← Configuración del sistema (key-value en BD)
│       │   ├── entities/
│       │   │   └── setting.entity.ts
│       │   ├── settings.controller.ts ← GET/PUT /settings
│       │   ├── settings.module.ts
│       │   └── settings.service.ts
│       │
│       ├── dashboard/                 ← Métricas y estadísticas
│       │   ├── dashboard.controller.ts ← GET /dashboard/stats
│       │   ├── dashboard.module.ts
│       │   └── dashboard.service.ts
│       │
│       ├── sse/                       ← Server-Sent Events (tiempo real al frontend)
│       │   ├── sse.controller.ts      ← GET /sse/events
│       │   ├── sse.module.ts
│       │   └── sse.service.ts         ← Emisión de eventos a clientes suscritos
│       │
│       └── r2/                        ← Cloudflare R2 (almacenamiento de archivos)
│           ├── r2.module.ts
│           └── r2.service.ts          ← Upload/download a bucket R2 vía AWS SDK S3
│
└── frontend/                          ← Paquete Next.js 14
    ├── .env.local                     ← Variables de entorno del cliente (no en git)
    ├── .env.local.example             ← Plantilla
    ├── next.config.js
    ├── next-env.d.ts                   ← Tipos autogenerados por Next.js
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── lib/
        │   ├── api.ts                 ← Cliente HTTP (axios) con interceptores JWT
        │   ├── auth.ts                ← Helpers de sesión (getToken, setToken…)
        │   └── utils.ts               ← Utilidades generales (cn, formatters…)
        │
        ├── components/
        │   └── layout/
        │       ├── Sidebar.tsx        ← Navegación lateral con links y logout
        │       └── AuthGuard.tsx      ← HOC que redirige a /login si no hay sesión
        │
        └── app/                       ← App Router de Next.js
            ├── globals.css
            ├── layout.tsx             ← Layout raíz (fuentes, metadata)
            ├── page.tsx               ← Redirige a /dashboard
            │
            ├── login/
            │   └── page.tsx           ← Formulario de login
            │
            └── (app)/                 ← Grupo de rutas protegidas (con Sidebar)
                ├── layout.tsx         ← Layout con AuthGuard + Sidebar
                ├── dashboard/
                │   └── page.tsx       ← Métricas: conversaciones, contactos, ventas
                ├── contacts/
                │   └── page.tsx       ← Tabla CRUD de contactos/prospectos
                ├── conversations/
                │   └── page.tsx       ← Vista de conversaciones WhatsApp en tiempo real
                ├── simulacros/
                │   └── page.tsx       ← Catálogo y gestión de simulacros
                └── settings/
                    └── page.tsx       ← Panel de configuración del sistema
```

---

## Variables de entorno (backend)

| Variable | Descripción |
|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Conexión a PostgreSQL |
| `JWT_SECRET` | Secreto para firmar tokens JWT |
| `JWT_EXPIRES_IN` | Duración del token (ej. `7d`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credenciales del admin inicial |
| `PORT` | Puerto del servidor NestJS (default `3001`) |
| `OPENAI_API_KEY` | Clave de OpenAI para el agente IA |
| `OPENAI_MODEL` | Modelo de chat (default `gpt-4o-mini`) |
| `OPENAI_CLASSIFIER_MODEL` | Modelo económico para clasificadores SI/NO y PRIMERA/EXPERIENCIA (default `gpt-4o-mini`) |
| `YCLOUD_API_KEY` | Clave de la API de YCloud (WhatsApp) |
| `YCLOUD_PHONE_NUMBER` | Número de WhatsApp Business |
| `YCLOUD_WEBHOOK_SECRET` | Secreto para validar los webhooks entrantes de YCloud |
| `MY_PHONE` | Modo prueba: solo estos números reciben respuesta del bot (vacío = responde a todos) |
| `BACKEND_PUBLIC_URL` | URL pública del backend (p. ej. túnel Cloudflare) para acceder al flyer |
| `FRONTEND_URL` | URL del frontend para CORS |

---

## Flujo principal

```
WhatsApp → YCloud → POST /webhooks/ycloud
                          │
                    WebhooksService
                    ├── guarda mensaje en BD (ConversationsService)
                    ├── emite evento SSE al frontend (SseService)
                    └── llama al agente IA (AiService)
                              │
                        genera respuesta
                              │
                        YCloudService → envía mensaje de vuelta por WhatsApp
```

## Scripts disponibles (raíz)

| Script | Descripción |
|---|---|
| `pnpm dev:backend` | Arranca NestJS en modo watch (puerto 3001) |
| `pnpm dev:frontend` | Arranca Next.js en modo dev (puerto 3000) |
| `pnpm build:backend` | Compila el backend a `dist/` |
| `pnpm build:frontend` | Build de producción de Next.js |
| `pnpm start:backend` | Inicia el backend desde `dist/main.js` |
| `pnpm db:migrate` | Ejecuta migraciones de TypeORM |

> En Windows también se pueden usar `PRIMERA_VEZ.bat` (instalación) e `INICIAR.bat` (inicio rápido).
