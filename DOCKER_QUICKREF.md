# Docker Quick Reference

## One-Liners

### Windows PowerShell
```powershell
# Build and run in one go
docker build -t copilot-cost . && docker run -p 4567:4567 -v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro" copilot-cost
```

### macOS/Linux
```bash
docker build -t copilot-cost . && docker run -p 4567:4567 -v ~/.copilot/otel:/home/copilot/.copilot/otel:ro copilot-cost
```

## Common Commands

| Task | Command |
|------|---------|
| Build image | `docker build -t copilot-cost .` |
| Run container | `docker run -p 4567:4567 -v $otel_path:/home/copilot/.copilot/otel:ro copilot-cost` |
| Run with docker-compose | `docker-compose up -d` |
| View logs | `docker logs -f copilot-cost` |
| Stop container | `docker stop copilot-cost` |
| Remove container | `docker rm copilot-cost` |
| Remove image | `docker rmi copilot-cost` |
| List running containers | `docker ps` |
| Health check | `docker ps --filter "name=copilot-cost"` |
| Custom port | `docker run -p 8080:4567 ...` |
| With proxy | `docker build --build-arg NPM_PROXY=http://proxy:8080 -t copilot-cost .` |

## Volume Mount Paths

| OS | Syntax |
|----|--------|
| **Windows PowerShell** | `-v "$env:USERPROFILE\.copilot\otel:/home/copilot/.copilot/otel:ro"` |
| **Windows CMD** | `-v "%USERPROFILE%\.copilot\otel:/home/copilot/.copilot/otel:ro"` |
| **Linux** | `-v ~/.copilot/otel:/home/copilot/.copilot/otel:ro` |
| **macOS** | `-v ~/.copilot/otel:/home/copilot/.copilot/otel:ro` |

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `COPILOT_OTEL_DIR` | OTel data directory | `/home/copilot/.copilot/otel` |
| `NPM_PROXY` | Build-time proxy (arg) | `http://proxy.company.com:8080` |
| `NPM_REGISTRY` | npm registry (arg) | `https://registry.npmjs.org/` |

## Troubleshooting Matrix

| Problem | Check | Fix |
|---------|-------|-----|
| No data | OTel files exist? | `ls ~/.copilot/otel/` (or Windows equivalent) |
| No data | Dashboard running? | `docker ps` should show running container |
| No data | Port correct? | Check `http://localhost:4567` is open in browser |
| Build fails | Network error | Add `--build-arg NPM_PROXY=...` |
| Port in use | Another process on 4567 | Use `-p 8080:4567` to map to 8080 |
| Permission denied | Volume mount | Use absolute path with `$env:USERPROFILE` |
| Cannot find docker | Docker not installed | Install [Docker Desktop](https://www.docker.com/products/docker-desktop) |

## Key Files

- **`Dockerfile`** — Multi-stage build (alpine, ~50MB)
- **`docker-compose.yml`** — One-command setup
- **`DOCKER.md`** — Full Docker guide
- **`WINDOWS_DOCKER.md`** — Windows-specific guide
- **`.dockerignore`** — Optimizes build size

## See Also

- [DOCKER.md](DOCKER.md) — Comprehensive Docker guide
- [WINDOWS_DOCKER.md](WINDOWS_DOCKER.md) — Windows troubleshooting
- [README.md](README.md) — Main documentation
