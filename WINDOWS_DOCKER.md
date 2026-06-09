# Windows-Specific Docker Setup Guide

For users behind proxies or in controlled Windows environments where `npm install` fails.

## Quick Start (Windows PowerShell)

### 1. Clone the repository

```powershell
git clone https://github.com/devartifex/copilot-cost.git
cd copilot-cost
```

### 2. Build the Docker image

```powershell
docker build -t copilot-cost:latest .
```

**Behind a corporate proxy?** Add these parameters:

```powershell
docker build `
  --build-arg NPM_PROXY="http://proxy.company.com:8080" `
  --build-arg NPM_REGISTRY="https://registry.npmjs.org/" `
  -t copilot-cost:latest .
```

### 3. Verify your OpenTelemetry data location

```powershell
# Check if OTel directory exists
Test-Path "$env:USERPROFILE\.copilot\otel"

# List traces
Get-ChildItem "$env:USERPROFILE\.copilot\otel" -Filter "*.jsonl"
```

### 4. Run the dashboard

```powershell
docker run `
  -p 4567:4567 `
  -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" `
  --name copilot-cost `
  copilot-cost:latest
```

You should see:
```
dashboard: http://127.0.0.1:4567/
```

Open your browser to: **http://localhost:4567**

## Using Docker Compose (Easier)

Docker Compose is easier for repeated use and handles mounting automatically.

### 1. Edit docker-compose.yml

Open `docker-compose.yml` and uncomment the Windows volume mount (line 18):

```yaml
volumes:
  - $env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro
```

If behind a corporate proxy, also uncomment and update the build args (lines 6-9):

```yaml
build:
  context: .
  dockerfile: Dockerfile
  args:
    NPM_PROXY: "http://proxy.company.com:8080"
    NPM_REGISTRY: "https://registry.npmjs.org/"
```

### 2. Start the container

```powershell
docker-compose up -d
```

### 3. Access the dashboard

Open: **http://localhost:4567**

### 4. View logs

```powershell
docker-compose logs -f copilot-cost-dashboard
```

### 5. Stop and clean up

```powershell
# Stop the container
docker-compose down

# Remove the image
docker rmi copilot-cost:latest

# Remove everything including volumes
docker-compose down -v
```

## Using Docker Desktop on Windows

If you prefer GUI management:

1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. Install and restart Windows
3. Open Docker Desktop (it runs a background service)
4. Build the image: `docker build -t copilot-cost:latest .`
5. In Docker Desktop GUI → Images → find `copilot-cost` → Run → configure port `4567:4567` and volume mount
6. Access: **http://localhost:4567**

## Troubleshooting on Windows

### Issue: "Volume mount not found"

**Cause**: Relative path or incorrect path format

**Solution**: Always use absolute path with `$env:USERPROFILE`:

```powershell
# ✗ Wrong
-v ".copilot\otel:..."

# ✓ Correct
-v "$env:USERPROFILE\.copilot\otel:..."
```

### Issue: "Access denied" when mounting

**Cause**: Permissions issue on the OTel directory

**Solution**: Grant yourself full permissions:

```powershell
icacls "$env:USERPROFILE\.copilot\otel" /grant "$env:USERNAME`:F"
```

### Issue: npm install fails during build

**Cause**: Behind corporate proxy without proper configuration

**Solution**: Add proxy args to build:

```powershell
docker build `
  --build-arg NPM_PROXY="http://proxy.company.com:8080" `
  --build-arg NPM_REGISTRY="https://registry.npmjs.org/" `
  -t copilot-cost:latest .
```

If proxy requires authentication, you may need to configure Docker daemon settings.

### Issue: Dashboard shows "No data" or is empty

**Cause**: OTel traces not generated yet

**Solution**: Generate traces by running Copilot CLI:

```powershell
# In your favorite IDE, open Copilot CLI and send a prompt
# Wait a few seconds, then refresh the dashboard (F5)
```

Verify traces exist:

```powershell
Get-ChildItem "$env:USERPROFILE\.copilot\otel\*.jsonl" | Select-Object Name, Length
```

### Issue: Cannot connect to http://localhost:4567

**Cause**: Port 4567 already in use or Docker not running

**Solution**:

```powershell
# Check if Docker is running
docker ps

# List containers using port 4567
netstat -ano | findstr :4567

# Use a different port
docker run -p 8080:4567 -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" copilot-cost:latest
# Then open http://localhost:8080
```

### Issue: "Cannot find Docker"

**Cause**: Docker not installed or not in PATH

**Solution**:

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. Restart PowerShell after installation
3. Verify: `docker --version`

## Performance Notes

- **First build**: 2-5 minutes (downloads dependencies)
- **Subsequent builds**: 30 seconds (cached layers)
- **Container startup**: 3-5 seconds
- **Dashboard responsiveness**: Instant (local analysis)

## Security Notes

- `:ro` flag makes volume read-only (dashboard cannot modify your data)
- Container runs as non-root user (uid 1000)
- Dashboard binds to 127.0.0.1 by default (local access only)
- No credentials or secrets in image
- All processing happens locally (no data leaves your machine)

## Advanced: Building Behind a Firewall

If your proxy requires a domain (not just IP:port):

```powershell
# Test connectivity to npm registry
curl https://registry.npmjs.org/ -x "http://proxy.company.com:8080"

# Configure Docker daemon proxy
# Edit or create C:\Users\<username>\.docker\config.json
```

Example `config.json`:

```json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.company.com:8080",
      "httpsProxy": "http://proxy.company.com:8080",
      "noProxy": "localhost,127.0.0.1"
    }
  }
}
```

Then restart Docker Desktop.

## Next Steps

- See main [README.md](README.md) for statusline setup
- Check [DOCKER.md](DOCKER.md) for comprehensive Docker guide
- View dashboard: **http://localhost:4567**
