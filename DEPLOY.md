# Deploy guide

Production target: a single 腾讯云 4C8G VPS (Ubuntu 22.04 or similar). Everything
lives in Docker Compose. CI builds and pushes images to GHCR; GitHub Actions
SSH's into the VPS to pull + restart on every `main` push.

## One-time VPS bootstrap

Do this once per VPS, as `root` or via `sudo`.

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
sudo -iu deploy
```

### 3. SSH key for GitHub Actions

On your laptop:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agent-platform-deploy -C 'gha-deploy@agent-platform'
```

Copy the public key onto the VPS:

```bash
# on the VPS as the deploy user
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... gha-deploy@agent-platform' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 4. Authorise the VPS to pull from GHCR

GHCR private images need a PAT. Create one with `read:packages` only:

> github.com → Settings → Developer settings → PAT (classic) → `read:packages`

On the VPS as `deploy`:

```bash
echo '<your-PAT>' | docker login ghcr.io -u indulgers --password-stdin
```

This writes `~/.docker/config.json` so future `docker compose pull` works
without prompting.

### 5. Lay out the deploy directory

```bash
sudo -iu deploy
mkdir -p ~/agent-platform/deploy/nginx
cd ~/agent-platform
# These two files come from the repo. The deploy workflow scp's the latest
# versions on every run, so first-time you can clone the repo OR just copy
# the two files manually:
#   ~/agent-platform/deploy/docker-compose.yml
#   ~/agent-platform/deploy/nginx/default.conf
```

### 6. Create the production `.env`

```bash
cd ~/agent-platform
# Copy the template from the repo (see .env.production.example in repo root)
nano .env
```

Fill in **every** value marked `CHANGEME`. Critical ones the compose will
refuse to start without:

| var | what it is |
|---|---|
| `POSTGRES_PASSWORD` | random strong string |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO root creds (≥ 8 chars) |
| `S3_PUBLIC_ENDPOINT` | `http://<your-vps-ip>:9100` |
| `WEB_ORIGIN` | `http://<your-vps-ip>` |

At least one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY`.

### 7. First-time pull + boot (manual)

```bash
cd ~/agent-platform
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps   # all services 'healthy' / 'running'
```

Apply the Prisma schema once:

```bash
docker compose -f deploy/docker-compose.yml exec api pnpm exec prisma db push
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

In the repo on github.com → Settings → Secrets and variables → Actions →
**New repository secret**. Add:

| name | value |
|---|---|
| `SSH_HOST` | VPS public IP or hostname |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | the contents of `~/.ssh/agent-platform-deploy` (the private key) |
| `SSH_PORT` | optional, defaults to 22 |
| `DEPLOY_DIR` | `/home/deploy/agent-platform` |

`GITHUB_TOKEN` is automatic — it's used to push images to GHCR under the
repo's own namespace.

## How deploys flow

1. You merge a PR to `main`.
2. `.github/workflows/deploy.yml` triggers:
   - matrix-builds 3 images in parallel: `agent-platform-api`, `-web`, `-landing`
   - pushes them to `ghcr.io/indulgers/agent-platform-<target>:sha-<commit>` and `:latest`
3. The `deploy` job:
   - `scp`s the latest `deploy/docker-compose.yml` + `deploy/nginx/default.conf` onto the VPS
   - `ssh`'s in, runs `docker compose pull && up -d --remove-orphans`
   - prunes dangling images
4. New containers run on `:latest` (which now points at the freshly-pushed images).

Total wall time: ~3 minutes including image push.

## Manual deploy / rollback

**Re-deploy the same code** (e.g. after editing an env value):

GitHub UI → Actions → **deploy** → Run workflow → leave inputs blank.

**Deploy a specific image** (rollback):

GitHub UI → Actions → **deploy** → Run workflow → set `image_tag` to a
previous `sha-xxxxxxx` (find them under Packages on the repo).

You can also do it directly on the VPS:

```bash
cd ~/agent-platform
export IMAGE_TAG=sha-abc1234
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
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

**`docker compose pull` says 'unauthorized'** — the deploy user's GHCR login
expired. Re-run step 4 with a fresh PAT.

**`POSTGRES_PASSWORD is required`** on `docker compose up` — `.env` is missing
or unreadable from the deploy dir. `cat .env | head` to confirm.

**`/api/*` returns 502 from nginx** — the api container probably crashed.
`docker compose logs api | tail -50` will say why. Most common: missing
`JWT_SECRET` or a DB connection issue if postgres took longer than usual to
become healthy.

**Browser can't reach MinIO at :9100** — firewall. Open the port:

```bash
sudo ufw allow 9100/tcp
```

(or in 腾讯云控制台 → 安全组 → 入站规则 → 添加 TCP:9100)
