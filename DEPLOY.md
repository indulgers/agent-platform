# Deploy guide

Production target: a single 腾讯云 4C8G VPS (Ubuntu 22.04 or similar).
Everything lives in Docker Compose. CI is a thin shim: it SSH's into the VPS
and runs `git pull && docker compose build && up -d`. Building on the server
side-steps the cross-pacific image-transfer bottleneck (GHCR is fronted by
GitHub's CDN in US/EU — slow from CN).

## One-time VPS bootstrap

Do this once per VPS.

### 1. Install docker + compose

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in so the group change takes effect
```

Confirm:

```bash
docker --version
docker compose version
```

### 2. Create a dedicated deploy user (recommended)

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy
```

### 3. SSH key for GitHub Actions

On your laptop:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agent-platform-deploy -C 'gha-deploy@agent-platform'
```

Copy the public key into the deploy user's `authorized_keys` on the VPS:

```bash
# on the VPS as the deploy user (sudo -iu deploy if you're root)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... gha-deploy@agent-platform' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 4. Clone the repo into the deploy directory

The deploy workflow will `git init + git fetch` on first run if it doesn't
find a `.git/` here, but cloning yourself is faster + lets you set up `.env`
before the first build.

```bash
sudo -iu deploy
cd ~
git clone https://github.com/indulgers/agent-platform.git
cd agent-platform
```

### 5. Create the production `.env`

```bash
cp .env.production.example .env
nano .env
chmod 600 .env
```

Fill in every `CHANGEME`. Critical values the compose refuses to start
without:

| var | what it is |
|---|---|
| `POSTGRES_PASSWORD` | random strong string |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO root creds (≥ 8 chars) |
| `S3_PUBLIC_ENDPOINT` | `http://<your-vps-ip>:9100` |
| `WEB_ORIGIN` | `http://<your-vps-ip>` |

At least one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY`.

### 6. First-time build + boot (manual)

```bash
cd ~/agent-platform
docker compose --env-file .env -f deploy/docker-compose.yml build
docker compose --env-file .env -f deploy/docker-compose.yml up -d
docker compose --env-file .env -f deploy/docker-compose.yml ps
# all services should be 'healthy' / 'running'
```

Apply the Prisma schema once (and every time the schema changes):

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec api \
  node node_modules/.bin/prisma db push --schema=prisma/schema.prisma
```

Hit it:

```bash
curl http://localhost/                # landing HTML
curl http://localhost/api/health      # {"status":"ok",...}
```

From your laptop:

```bash
open http://<vps-ip>/
```

## GitHub Actions secrets

In the GitHub UI under your repo → Settings → Secrets and variables → Actions
→ **New repository secret** (or **Environment "prod"** if you want the deploy
job to ask for approval before running). Add:

| name | value |
|---|---|
| `SSH_HOST` | VPS public IP or hostname |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | the contents of `~/.ssh/agent-platform-deploy` (the private key) |
| `SSH_PORT` | optional, defaults to 22 |
| `DEPLOY_DIR` | `/home/deploy/agent-platform` |

The deploy workflow expects these to live in the `prod` Environment — bind
it via `environment: prod` (already set in `.github/workflows/deploy.yml`).

## How deploys flow

1. You merge a PR to `main`.
2. `.github/workflows/deploy.yml` triggers.
3. A `changes` job runs `dorny/paths-filter` against the diff to figure out
   which services need rebuilding:
   - touching `apps/api/**` → rebuild `api`
   - touching `apps/web/**` → rebuild `web`
   - touching `apps/landing/**` → rebuild `landing`
   - touching `packages/shared/**` → rebuild **both** `api` and `web`
     (they consume shared)
   - touching `deploy/nginx/**` or `deploy/docker-compose.yml` → recreate `nginx`
   - touching `pnpm-lock.yaml` / `package.json` → rebuild all 3 apps
     (dep change could affect any)
4. The `deploy` job SSH's into the VPS, runs `git fetch + reset --hard`,
   then `docker compose build <only the changed services>`,
   `up -d <those services>`, and bounces nginx so it re-resolves upstream
   IPs after container replacement.
5. If **nothing** matched (e.g. a README-only PR), the deploy job skips
   entirely.

Wall time:
- README / docs only: skipped — 30s job overhead.
- One service changed: 1-3 min.
- Shared package: 2-4 min (api + web both rebuild).
- All 3 changed / cold first build: 5-10 min.

## Manual deploy / rollback

**Force a redeploy** (after editing `.env`, or to retry a failed run):

GitHub UI → Actions → **deploy** → Run workflow → leave inputs blank.
Manual triggers always run (don't skip), and by default rebuild only what
path-filter sees as changed since the previous main HEAD.

**Force-rebuild specific services**: in the manual trigger, set
`services` to `api`, `api,web`, or `all`. Use this when you've edited
`.env` and only need to restart api, or when you want a clean rebuild of
everything (`all`).

**Deploy a different ref** (rollback to a previous commit, or a feature
branch for staging on the same host): set `ref` to a branch name or SHA.

Directly on the VPS (no workflow):

```bash
cd ~/agent-platform
git fetch origin
git reset --hard origin/main   # or any other ref
# rebuild only what you need:
docker compose --env-file .env -f deploy/docker-compose.yml build api
docker compose --env-file .env -f deploy/docker-compose.yml up -d api
docker compose --env-file .env -f deploy/docker-compose.yml restart nginx
```

## Speed up `pnpm install` from CN (one-time per VPS)

Dockerfiles default `NPM_REGISTRY=https://registry.npmmirror.com` so the
`pnpm install` step in each image runs against a CN-side mirror — cuts
`pnpm install` from ~5min to ~30s on a fresh build.

Override at build time if you're building elsewhere:

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org api
```

## Adding HTTPS (later, once a domain is wired up)

Cheapest path is to swap nginx for Caddy — it auto-provisions Let's Encrypt
certs and renews them. The drop-in replacement looks like:

1. Point an A record at the VPS, e.g. `agent.example.com → 1.2.3.4`
2. In `deploy/docker-compose.yml`, replace the `nginx` service with:

   ```yaml
   caddy:
     image: caddy:2.8
     restart: unless-stopped
     depends_on: [api, web, landing]
     ports: ['80:80', '443:443']
     volumes:
       - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
       - caddydata:/data
       - caddyconfig:/config
   ```

3. Create `deploy/caddy/Caddyfile`:

   ```
   agent.example.com {
     handle /api/* { reverse_proxy api:3000 }
     handle /app/* { reverse_proxy web:80 }
     handle      { reverse_proxy landing:80 }
   }
   ```

4. Update `.env`: `WEB_ORIGIN=https://agent.example.com`, `S3_PUBLIC_ENDPOINT=https://your-host:9100` (or proxy MinIO behind Caddy too).
5. Re-deploy. First boot signs the cert.

## Troubleshooting

**`POSTGRES_PASSWORD is required`** on `docker compose up` — `.env` is missing
or unreadable from the deploy dir. `cat .env | head` to confirm.

**`/api/*` returns 502 from nginx** — the api container probably crashed.
`docker compose logs api | tail -50` will say why. Most common: missing
`JWT_SECRET` or a DB connection issue if postgres took longer than usual to
become healthy.

**`pnpm install` step is slow during build** — confirm the npmmirror
build-arg is in effect; check `docker compose build api 2>&1 | grep registry`.

**`git fetch` fails with auth error** — the repo is public so this shouldn't
happen. If it does, change the remote URL to use a deploy token or switch
to SSH: `git remote set-url origin git@github.com:indulgers/agent-platform.git`.

**Browser can't reach MinIO at :9100** — firewall. Open the port:

```bash
sudo ufw allow 9100/tcp
```

(or in 腾讯云控制台 → 安全组 → 入站规则 → 添加 TCP:9100)
