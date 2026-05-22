# agent-platform

Multi-tool task agent. Vite + React frontend, NestJS backend, PostgreSQL + pgvector, Redis + BullMQ, SSE streaming. Deploys to a single 4C8G host with Docker Compose + Nginx.

## Stack

- **Web**: Vite · React · TypeScript · TanStack Router (file-based) · TanStack Query · Zustand · Tailwind · shadcn/ui
- **API**: NestJS · Prisma · PostgreSQL (pgvector) · Redis · BullMQ · SSE
- **LLM**: OpenAI + Anthropic SDKs (no agent framework — hand-rolled plan/act loop)
- **Auth**: email + password → JWT (argon2 hashing)

## Layout

```
apps/web      # frontend
apps/api      # backend
packages/shared   # zod schemas + SseEvent types shared by both apps
deploy        # Dockerfiles, docker-compose, nginx config
```

## Quickstart (local dev)

```bash
corepack enable pnpm
pnpm install

cp .env.example .env                # fill in OPENAI_API_KEY / ANTHROPIC_API_KEY / JWT_SECRET

# Start postgres + redis only — apps run on the host for fast HMR
docker compose -f deploy/docker-compose.dev.yml up -d

# Apply prisma migrations + enable pgvector
pnpm db:migrate

# Run api (:3000) and web (:5173) concurrently
pnpm dev
```

Open http://localhost:5173 → register → chat.

## Deploy (full stack via Docker)

```bash
docker compose -f deploy/docker-compose.yml up --build -d
```

Nginx listens on :80, proxies `/api/` to the api container, serves the web build for everything else. SSE-friendly proxy timeouts are set.

## Scripts (root)

| Command | What |
|---|---|
| `pnpm dev` | turbo: api + web together |
| `pnpm build` | turbo: build everything |
| `pnpm typecheck` | turbo: tsc across all workspaces |
| `pnpm lint` | turbo: lint everything |
| `pnpm db:migrate` | apply prisma migrations + generate client |
| `pnpm db:studio` | open Prisma Studio |
| `pnpm format` | prettier across the repo |

## Author

indulger
