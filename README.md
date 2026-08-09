# CRM IA - Simulacros San Marcos

Sistema CRM con agente de IA para automatizar la venta de Simulacros San Marcos vía WhatsApp.

## Requisitos

- Node.js >= 20
- pnpm >= 9

## Inicio rápido

### 1. Configurar variables de entorno

```bash
cp backend/.env.example backend/.env
```

Editar `backend/.env` con tus credenciales.

### 2. Instalar dependencias

```bash
pnpm install
```

### 3. Iniciar el backend

```bash
pnpm dev:backend
```

### 4. Iniciar el frontend

```bash
pnpm dev:frontend
```

## Stack

- **Frontend**: Next.js 14 + React + Tailwind CSS
- **Backend**: NestJS
- **ORM**: TypeORM
- **Base de datos**: PostgreSQL
- **IA**: OpenAI (GPT-4o Mini)
- **WhatsApp**: YCloud
- **Tiempo real**: SSE
