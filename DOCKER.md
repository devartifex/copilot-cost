# Docker Deployment Guide for copilot-cost

This guide explains how to run `copilot-cost` dashboard in a Docker container, useful for:
- Controlled Windows environments with permission restrictions
- Proxy-constrained networks
- Isolated environments
- No local npm installation needed

## Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- OpenTelemetry data files from your Copilot CLI (`~/.copilot/otel/copilot-otel.jsonl`)

## Quick Start (Windows PowerShell)

### 1. Locate your OpenTelemetry data

Your Copilot CLI traces are stored in:
```powershell
$env:USERPROFILE\.copilot\otel
```

Verify the file exists:
```powershell
Test-Path "$env:USERPROFILE\.copilot\otel\copilot-otel.jsonl"
```

### 2. Build the Docker image

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

### 3. Run the container with mounted data

```powershell
docker run `
  -p 4567:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  --name copilot-cost `
  copilot-cost:latest
```

Then open your browser to: **http://localhost:4567**

## Using Docker Compose (Recommended)

### 1. Edit `docker-compose.yml`

Uncomment the appropriate volume mount for your OS. For Windows PowerShell:

```yaml
volumes:
  - $env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro
```

For Windows CMD, use:
```yaml
volumes:
  - %USERPROFILE%\.copilot\otel:/home/copilot/.copilot/otel:ro
```

### 2. Start the container

```powershell
docker-compose up -d
```

### 3. View logs

```powershell
docker-compose logs -f copilot-cost-dashboard
```

### 4. Access the dashboard

Open: **http://localhost:4567**

## Behind a Corporate Proxy

### Build-time proxy

If your Docker host is behind an HTTP proxy:

**Docker Compose approach** — Edit `docker-compose.yml`:
```yaml
build:
  context: .
  args:
    NPM_PROXY: "http://proxy.company.com:8080"
```

**Manual build**:
```powershell
docker build `
  --build-arg NPM_PROXY="http://proxy.company.com:8080" `
  -t copilot-cost:latest .
```

### Docker daemon proxy

If Docker itself cannot reach npm registry, configure Docker daemon:

**Windows**: Add to `~\.docker\config.json`:
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

## Windows (CMD) Usage

### 1. Set variable for volume mount

```cmd
setlocal enabledelayedexpansion
set OTEL_PATH=%USERPROFILE%\.copilot\otel
```

### 2. Run container

```cmd
docker run ^
  -p 4567:4567 ^
  -v "%OTEL_PATH%:/home/copilot/.copilot/otel:ro" ^
  --name copilot-cost ^
  copilot-cost:latest
```

## Updating OTel Data (Hot Reload)

The dashboard reads OpenTelemetry files from the mounted volume in real-time. To update:

1. **Run new Copilot CLI sessions** to generate new traces
2. **New .jsonl files** are automatically picked up
3. **No container restart needed** — refresh the dashboard in your browser

## Managing the Container

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

## Advanced: Custom Port

### Docker run

```powershell
docker run `
  -p 8080:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  copilot-cost:latest
```

Then access at: **http://localhost:8080**

### Docker Compose

Edit `docker-compose.yml`:
```yaml
ports:
  - "8080:4567"
```

## Troubleshooting

### "Volume mount not found" error

**Windows PowerShell** — Ensure you're using the full path:
```powershell
# ✗ Wrong (relative path)
-v ".copilot\otel:..."

# ✓ Correct (absolute path)
-v "$env:USERPROFILE\.copilot\otel:..."
```

**Windows CMD** — Use absolute paths:
```cmd
# ✓ Correct
-v "%USERPROFILE%\.copilot\otel:..."
```

### Dashboard shows no data

1. Verify OTel files exist: `ls $env:USERPROFILE\.copilot\otel\*.jsonl`
2. Run a Copilot CLI prompt to generate traces
3. Refresh the dashboard (F5)
4. Check container logs: `docker logs copilot-cost`

### "Permission denied" when mounting

Make sure the OTel directory has read permissions:
```powershell
icacls "$env:USERPROFILE\.copilot\otel" /grant "$env:USERNAME`:F"
```

### npm install fails behind proxy

1. Verify proxy is correct in docker-compose.yml
2. Test proxy outside Docker: `npm config get proxy`
3. Try `docker build --progress=plain` to see detailed errors
4. Check corporate proxy requires authentication (may need registry URL changes)

## Volumes Explained

- **`-v SRC:DEST:ro`** — Read-only mount (dashboard reads but cannot modify)
- **`SRC`** — Your host path (e.g., `$env:USERPROFILE\.copilot\otel`)
- **`DEST`** — Container path (`/home/copilot/.copilot/otel`)

The `:ro` flag prevents accidental modifications.

## Security Notes

- Dashboard binds to `127.0.0.1` inside container, exposed via port mapping
- Volume mounted read-only (`:ro`)
- Container runs as non-root user (uid 1000)
- No secrets or credentials stored in image
- Usage data stays local (not uploaded anywhere)

## Building from Source (Development)

To build with live code changes:

```powershell
# Rebuild image
docker build -t copilot-cost:dev .

# Run with volume mount for code changes
docker run `
  -p 4567:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  -it `
  copilot-cost:dev
```

After code edits, rebuild the image.

## Next Steps

- See main [README.md](README.md) for statusline setup
- Check [Troubleshooting section](README.md#-troubleshooting) in main README
- Run `docker-compose logs` for diagnostic output
