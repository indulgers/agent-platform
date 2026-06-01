# Deploy guide

Production target: a single 腾讯云 4C8G VPS (Ubuntu 22.04 or similar).

Hybrid build model:
- **api** is built in docker, on the VPS, by the SSH deploy script. (GHCR
  pulls from CN are too slow, so building locally is the lesser evil.)
- **web** and **landing** are static — built on the GH runner, tar'd, and
  scp'd to the VPS. nginx serves them directly from bind-mounted host dirs
  (`/srv/web-dist`, `/srv/landing-dist`). No inner web/landing containers
  anymore.

This split exists because (a) building a Vite SPA on the runner is faster
and cheaper than rebuilding a docker image of nginx-serving-static every
push, and (b) it positions us one CI step away from R2/CDN — just swap the
final scp for an `aws s3 sync` against R2 when we want that.

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

### 4b. Create the static-frontend bind-mount directories

nginx serves `web` and `landing` directly out of `/srv/web-dist` and
`/srv/landing-dist` (bind-mounted from the host into the nginx container).
The deploy script populates them, but they must exist before the first
nginx start. On the host as root:

```bash
sudo mkdir -p /srv/web-dist /srv/landing-dist
sudo chown deploy:deploy /srv/web-dist /srv/landing-dist
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
3. The `changes` job runs `dorny/paths-filter` and emits four signals:
   - `api`: touched `apps/api/**`, `packages/shared/**`, `deploy/Dockerfile.api`,
     or any root config (`pnpm-lock.yaml`, `package.json`, etc.)
   - `web`: touched `apps/web/**`, `packages/shared/**`, or root config
   - `landing`: touched `apps/landing/**` or root config
   - `infra`: touched `deploy/docker-compose.yml` or `deploy/nginx/**`
4. The `build-static` job runs whenever `web` or `landing` changed. It
   builds the dist on the GH runner (with pnpm + cached deps), tars each,
   and uploads as workflow artifacts.
5. The `deploy` job:
   - Downloads any artifacts produced by `build-static`.
   - scp's tarballs to the VPS under `/tmp/agent-platform-static/`.
   - SSH-pulls the latest `main` and unpacks tarballs via
     `rsync --delete-after` into `/srv/web-dist` / `/srv/landing-dist` —
     the live dirs nginx serves from.
   - If `api` changed: `docker compose build api && up -d api`.
   - If `infra` changed: `docker compose up -d --force-recreate nginx`.
     Otherwise if any service was updated: `docker compose restart nginx`
     (refresh upstream DNS + re-stat dist files).
6. README-only / docs-only / workflow-only PRs short-circuit: no
   `build-static`, no `deploy`.

Wall time (typical, after layer cache + pnpm cache warm):
- README only: skipped — 30s job overhead.
- api only: 2-4 min (mostly docker rebuild on VPS).
- web only: 1-2 min (build on runner ~1 min, scp + unpack ~10s).
- landing only: 30-60s (smaller bundle).
- All three: 4-6 min (build-static parallel with the deploy job's git
  fetch + api docker build).

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
# api docker build:
docker compose --env-file .env -f deploy/docker-compose.yml build api
docker compose --env-file .env -f deploy/docker-compose.yml up -d api
# nginx (picks up new dist + re-resolves api):
docker compose --env-file .env -f deploy/docker-compose.yml restart nginx
```

For web / landing on the VPS, you'd need pnpm + node 20 installed locally
(the deploy normally builds them on the GH runner instead). One-shot manual
build, if you really need to:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm --filter @agent-platform/shared build
pnpm --filter @agent-platform/web build && rsync -a --delete-after apps/web/dist/ /srv/web-dist/
pnpm --filter @agent-platform/landing build && rsync -a --delete-after apps/landing/dist/ /srv/landing-dist/
```

## Speed up `pnpm install` from CN (one-time per VPS)

`deploy/Dockerfile.api` defaults `NPM_REGISTRY=https://registry.npmmirror.com`
so the api docker build's `pnpm install` runs against a CN-side mirror — cuts
~5min to ~30s on a fresh build.

Override at build time if you're building elsewhere:

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org api
```

(The static `build-static` job in CI runs on a GH-hosted ubuntu runner and
uses the default npm registry directly — the registry mirror only matters
for the VPS-side api build.)

## Adding HTTPS (later, once a domain is wired up)

You have a Cloudflare-registered domain — the **fast path is to put it in
front of nginx** rather than swap nginx for Caddy:

1. Cloudflare DNS: `A` record `your-domain.com → VPS IP`, orange-cloud on.
2. Install certbot on the VPS and grab a Let's Encrypt cert, then have
   nginx listen on 443. Or, if you prefer zero VPS changes: Cloudflare
   SSL/TLS mode `Flexible` (Cloudflare→VPS over HTTP, browser→Cloudflare
   over HTTPS). Flexible is "good enough for staging" but logs sessions in
   the clear between Cloudflare and the VPS — switch to `Full (strict)` +
   Let's Encrypt for real production.
3. Cloudflare Cache Rules:
   - `path matches "^/(app/)?assets/"` → Eligible for cache, edge TTL 1 year.
   - `path matches "^/api/"` → Bypass cache.
4. Update `.env`: `WEB_ORIGIN=https://your-domain.com`.
5. Lock down the VPS firewall (腾讯云安全组) to only allow Cloudflare IP
   ranges on 80/443 — see https://www.cloudflare.com/ips/.

This is Tier 3-a in the deployment plan; details in the plan file under
`~/.claude/plans/`.

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

**`git fetch` from VPS times out / 1000 bytes/sec** — github.com from CN
VPS is intermittently unreachable; the deploy script retries 5× with
exponential backoff. If it still fails, re-trigger the workflow manually
(usually clears within minutes) or `gh workflow run deploy.yml -f services=...`
to retry.

**Static frontend 404 after first deploy** — `/srv/web-dist` or
`/srv/landing-dist` doesn't exist on the host. SSH in and run
`sudo mkdir -p /srv/{web,landing}-dist && sudo chown deploy:deploy /srv/{web,landing}-dist`,
then re-trigger the workflow with `services="web,landing"`.

**Browser can't reach MinIO at :9100** — firewall. Open the port:

```bash
sudo ufw allow 9100/tcp
```

(or in 腾讯云控制台 → 安全组 → 入站规则 → 添加 TCP:9100)
