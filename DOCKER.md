# Docker Deployment Guide for copilot-cost

This guide explains how to run `copilot-cost` dashboard in a Docker container, useful for:
- Controlled Windows environments with permission restrictions
- Proxy-constrained networks
- Isolated environments
- No local npm installation needed

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [One-Liners](#one-liners)
- [Using Docker Compose](#using-docker-compose)
- [Common Commands](#common-commands)
- [Building Behind a Proxy](#building-behind-a-proxy)
- [Environment Variables](#environment-variables)
- [Hot Reload and Updates](#hot-reload-and-updates)
- [Managing Containers](#managing-containers)
- [Advanced Configuration](#advanced-configuration)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)

## Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- **OpenTelemetry collection enabled in your Copilot CLI** (see "[Enabling OTel Collection](#enabling-otel-collection)" below)
- OpenTelemetry data files from your Copilot CLI (`~/.copilot/otel/copilot-otel.jsonl`)

## Enabling OTel Collection

**Important:** The Docker container only **reads and analyzes** traces—it does **not** enable trace collection in the Copilot CLI. You must set up OTel collection on your **local machine first**.

### Option 1: Use copilot-cost install (Recommended)

On your local machine (not in Docker):
```bash
git clone https://github.com/devartifex/copilot-cost.git
cd copilot-cost
npm install && npm run build && npm link
copilot-cost install
```

This configures:
- `~/.copilot/settings.json` with `"experimental": true` (required for custom statusline)
- OpenTelemetry environment variables in your shell profile
- Local JSONL output to `~/.copilot/otel/`

Then **restart your shell and Copilot CLI**.

### Option 2: Manual Configuration

If you prefer not to run the installer, manually configure:

1. **Enable experimental flag** in `~/.copilot/settings.json`:
   ```json
   {
     "experimental": true
   }
   ```

2. **Add OTel env vars to your shell profile** (`.bashrc`, `.zshrc`, `.profile`, or PowerShell profile):
   ```bash
   export COPILOT_OTEL_ENABLED=true
   export COPILOT_OTEL_EXPORTER_TYPE=file
   export COPILOT_OTEL_FILE_EXPORTER_PATH="$HOME/.copilot/otel/copilot-otel.jsonl"
   ```

3. **Restart your shell and Copilot CLI**

### Verify OTel Collection is Working

Run a Copilot prompt and check:
```bash
ls ~/.copilot/otel/*.jsonl
```

If files exist and have recent timestamps, collection is working. Now proceed to Docker.

## Quick Start

### Windows PowerShell

**1. Locate your OpenTelemetry data:**
```powershell
$env:USERPROFILE\.copilot\otel
```

Verify the file exists:
```powershell
Test-Path "$env:USERPROFILE\.copilot\otel\copilot-otel.jsonl"
```

**2. Build the Docker image:**
```powershell
cd C:\path\to\copilot-cost
docker build -t copilot-cost:latest .
```

With npm proxy support (if behind corporate proxy):
```powershell
docker build `
  --build-arg NPM_PROXY="http://proxy.company.com:8080" `
  -t copilot-cost:latest .
```

**3. Run the dashboard:**
```powershell
docker run `
  -p 4567:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel `
  -e COPILOT_OTEL_ENABLED=true `
  -e COPILOT_OTEL_EXPORTER_TYPE=file `
  copilot-cost:latest
```

Open your browser to: **http://localhost:4567**

### macOS/Linux

**1. Verify OTel data:**
```bash
ls ~/.copilot/otel/copilot-otel.jsonl
```

**2. Build the image:**
```bash
docker build -t copilot-cost:latest .
```

**3. Run the dashboard:**
```bash
docker run \
  -p 4567:4567 \
  -v ~/.copilot/otel:/home/copilot/.copilot/otel:ro \
  -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel \
  -e COPILOT_OTEL_ENABLED=true \
  -e COPILOT_OTEL_EXPORTER_TYPE=file \
  copilot-cost:latest
```

Open your browser to: **http://localhost:4567**

## One-Liners

### Windows PowerShell
```powershell
docker run -p 4567:4567 -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel -e COPILOT_OTEL_ENABLED=true -e COPILOT_OTEL_EXPORTER_TYPE=file copilot-cost:latest
```

### macOS/Linux
```bash
docker run -p 4567:4567 -v ~/.copilot/otel:/home/copilot/.copilot/otel:ro -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel -e COPILOT_OTEL_ENABLED=true -e COPILOT_OTEL_EXPORTER_TYPE=file copilot-cost:latest
```

## Using Docker Compose

Docker Compose is easier for repeated use and handles mounting automatically.

### Setup (Windows PowerShell)

**1. Edit `docker-compose.yml`:**

Uncomment the appropriate volume mount:
```yaml
volumes:
  - $env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro
```

If behind a corporate proxy, uncomment and update build args:
```yaml
build:
  context: .
  dockerfile: Dockerfile
  args:
    NPM_PROXY: "http://proxy.company.com:8080"
    NPM_REGISTRY: "https://registry.npmjs.org/"
```

**2. Start the container:**
```powershell
docker-compose up -d
```

**3. Access the dashboard:**
Open: **http://localhost:4567**

**4. View logs:**
```powershell
docker-compose logs -f copilot-cost-dashboard
```

### Setup (Linux/macOS)

**1. Edit `docker-compose.yml`:**

Uncomment the Linux volume mount:
```yaml
volumes:
  - ~/.copilot/otel:/home/copilot/.copilot/otel:ro
```

**2. Start the container:**
```bash
docker-compose up -d
```

**3. Access and manage:**
```bash
docker-compose logs -f copilot-cost-dashboard  # View logs
docker-compose down                             # Stop and remove
```

## Common Commands

| Task | Command |
|------|---------|
| Build image | `docker build -t copilot-cost .` |
| Run container (full) | `docker run -p 4567:4567 -v $otel_path:/home/copilot/.copilot/otel:ro -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel -e COPILOT_OTEL_ENABLED=true -e COPILOT_OTEL_EXPORTER_TYPE=file copilot-cost` |
| Run with docker-compose | `docker-compose up -d` |
| View logs | `docker logs -f copilot-cost` |
| Stop container | `docker stop copilot-cost` |
| Remove container | `docker rm copilot-cost` |
| Remove image | `docker rmi copilot-cost` |
| List running containers | `docker ps` |
| Health check | `docker ps --filter "name=copilot-cost"` |
| Custom port | `docker run -p 8080:4567 ...` |

## Building Behind a Proxy

### Build-time proxy

If your Docker host is behind an HTTP proxy:

**With Docker Compose:**
```yaml
build:
  context: .
  args:
    NPM_PROXY: "http://proxy.company.com:8080"
```

**Manual build:**
```powershell
docker build `
  --build-arg NPM_PROXY="http://proxy.company.com:8080" `
  -t copilot-cost:latest .
```

### Docker daemon proxy

If Docker itself cannot reach npm registry, configure the Docker daemon.

**Windows:** Add to `~\.docker\config.json`:
```json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.company.com:8080",
      "httpsProxy": "http://proxy.company.com:8080"
    }
  }
}
```

Then restart Docker Desktop.

**Linux/macOS:** Edit `~/.docker/daemon.json`:
```json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.company.com:8080",
      "httpsProxy": "http://proxy.company.com:8080"
    }
  }
}
```

Then restart Docker daemon.

## Environment Variables

### Required (at runtime)

| Variable | Value | Purpose |
|----------|-------|---------|
| `COPILOT_OTEL_DIR` | `/home/copilot/.copilot/otel` | OTel data directory inside container (must match volume mount) |
| `COPILOT_OTEL_ENABLED` | `true` | Enable OTel mode |
| `COPILOT_OTEL_EXPORTER_TYPE` | `file` | Read from mounted files (not network) |

### Optional (at build time)

| Variable | Value | Purpose |
|----------|-------|---------|
| `NPM_PROXY` | `http://proxy.company.com:8080` | HTTP proxy for npm during build |
| `NPM_REGISTRY` | `https://registry.npmjs.org/` | npm registry URL (corporate proxy mirror) |

### Volume Mount Paths Reference

| OS | Syntax |
|----|--------|
| **Windows PowerShell** | `-v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro"` |
| **Windows CMD** | `-v "%USERPROFILE%\.copilot\otel:/home/copilot/.copilot/otel:ro"` |
| **Linux** | `-v ~/.copilot/otel:/home/copilot/.copilot/otel:ro` |
| **macOS** | `-v ~/.copilot/otel:/home/copilot/.copilot/otel:ro` |

## Hot Reload and Updates

The dashboard reads OpenTelemetry files from the mounted volume in real-time:

1. **Run new Copilot CLI sessions** to generate new traces
2. **New .jsonl files** are automatically picked up
3. **No container restart needed** — refresh the dashboard in your browser

## Managing Containers

### Stop the container
```powershell
docker stop copilot-cost
```

### Remove the container
```powershell
docker rm copilot-cost
```

### View container logs
```powershell
docker logs copilot-cost
```

### Check container health
```powershell
docker ps --filter "name=copilot-cost"
```

The HEALTHCHECK runs every 30 seconds. Status shows `(healthy)` or `(unhealthy)`.

### Custom Port

**Docker run:**
```powershell
docker run `
  -p 8080:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel `
  -e COPILOT_OTEL_ENABLED=true `
  -e COPILOT_OTEL_EXPORTER_TYPE=file `
  copilot-cost:latest
```

Then access at: **http://localhost:8080**

**Docker Compose:**
```yaml
ports:
  - "8080:4567"
```

## Advanced Configuration

### Development Build

To build with live code changes:

```powershell
docker build -t copilot-cost:dev .

docker run `
  -p 4567:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel `
  -e COPILOT_OTEL_ENABLED=true `
  -e COPILOT_OTEL_EXPORTER_TYPE=file `
  -it `
  copilot-cost:dev
```

After code edits, rebuild the image.

### Build with Corporate .npmrc

If your npm registry requires authentication:

```powershell
docker build `
  --build-arg NPMRC_FILE=.npmrc `
  -t copilot-cost:latest .
```

The Dockerfile will securely copy your `.npmrc` during build only.

## Troubleshooting

### Problem: Volume mount not found

**Cause:** Relative path or incorrect path format

**Solution - Windows PowerShell:**
```powershell
# ✗ Wrong (relative path)
-v ".copilot\otel:..."

# ✓ Correct (absolute path)
-v "$env:USERPROFILE\.copilot\otel:..."
```

**Solution - Windows CMD:**
```cmd
# ✓ Correct
-v "%USERPROFILE%\.copilot\otel:..."
```

### Problem: Dashboard shows no data

**Checklist:**
1. Verify OTel files exist: 
   - Windows: `Get-ChildItem "$env:USERPROFILE\.copilot\otel\*.jsonl"`
   - Linux/macOS: `ls ~/.copilot/otel/*.jsonl`

2. Verify container is running: `docker ps`

3. Run a Copilot CLI prompt to generate traces

4. Refresh the dashboard (F5)

5. Check container logs: `docker logs copilot-cost`

### Problem: Permission denied when mounting

**Cause:** OTel directory lacks read permissions

**Solution - Windows:**
```powershell
icacls "$env:USERPROFILE\.copilot\otel" /grant "$env:USERNAME`:F"
```

**Solution - Linux/macOS:**
```bash
chmod 755 ~/.copilot/otel
```

### Problem: npm install fails during build

**Cause:** Behind corporate proxy without proper configuration

**Solution:**
1. Verify proxy is correct: `npm config get proxy`
2. Add proxy args to build:
   ```powershell
   docker build `
     --build-arg NPM_PROXY="http://proxy.company.com:8080" `
     --build-arg NPM_REGISTRY="https://registry.npmjs.org/" `
     -t copilot-cost:latest .
   ```
3. See "[Building Behind a Proxy](#building-behind-a-proxy)" section above

### Problem: Cannot connect to http://localhost:4567

**Cause:** Port 4567 already in use or Docker not running

**Solution:**
```powershell
# Check if Docker is running
docker ps

# List processes using port 4567
netstat -ano | findstr :4567

# Use a different port
docker run -p 8080:4567 ... copilot-cost:latest
```

### Problem: Cannot find docker

**Cause:** Docker not installed or not in PATH

**Solution:**
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Restart PowerShell after installation
3. Verify: `docker --version`

### Troubleshooting Matrix

| Problem | Check | Fix |
|---------|-------|-----|
| No data | OTel files exist? | `ls ~/.copilot/otel/` (or Windows equivalent) |
| No data | Dashboard running? | `docker ps` should show running container |
| No data | Port correct? | Check `http://localhost:4567` is open in browser |
| Build fails | Network error | Add `--build-arg NPM_PROXY=...` |
| Port in use | Another process on 4567 | Use `-p 8080:4567` to map to 8080 |
| Permission denied | Volume mount | Use absolute path with `$env:USERPROFILE` |
| Cannot find docker | Docker not installed | Install [Docker Desktop](https://www.docker.com/products/docker-desktop) |

## Security Notes

- Dashboard binds to `127.0.0.1` inside container, exposed via port mapping only
- Volume mounted read-only (`:ro` flag)
- Container runs as non-root user (uid 1000)
- No secrets or credentials stored in image
- Usage data stays local (not uploaded anywhere)
- Dockerfile uses multi-stage build for minimal runtime image (~50MB)

## Files Reference

- **`Dockerfile`** — Multi-stage build configuration
- **`docker-compose.yml`** — One-command setup (edit volume mount for your OS)
- **`.dockerignore`** — Build optimization

## See Also

- [README.md](README.md) — Main documentation
- [Troubleshooting section](README.md#-troubleshooting) in main README
