# Multi-stage build for copilot-cost dashboard
# Stage 1: Build environment
FROM node:20.20.2-alpine3.22 AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
# Support npm proxy configuration via build args
ARG NPM_REGISTRY=""
ARG NPM_PROXY=""
RUN if [ -n "${NPM_REGISTRY}" ]; then npm config set registry ${NPM_REGISTRY}; fi && \
    if [ -n "${NPM_PROXY}" ]; then npm config set proxy ${NPM_PROXY}; fi && \
    npm ci --prefer-offline --no-audit

# Copy source code
COPY src ./src
COPY tsconfig.json tsup.config.ts tailwind.config.js ./
COPY scripts ./scripts
COPY dashboard-ui ./dashboard-ui
COPY pricing.snapshot.yaml ./

# Build the application
RUN npm run build

# Prune devDependencies - keep only production dependencies for runtime
RUN npm prune --omit=dev

# Stage 2: Runtime environment
FROM node:20.20.2-alpine3.22

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy built artifacts and pruned node_modules from builder
# No second npm install needed - dependencies are already installed and pruned
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dashboard-ui/dist ./dashboard-ui/dist
COPY --from=builder /app/pricing.snapshot.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create non-root user for security
RUN addgroup -g 10000 copilot && \
    adduser -D -u 10000 -G copilot copilot

# Create volume mount point for OpenTelemetry data
RUN mkdir -p /home/copilot/.copilot/otel && \
    chown -R copilot:copilot /home/copilot

WORKDIR /home/copilot

USER copilot

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:4567/api/health || exit 1

# Expose port
EXPOSE 4567

# Use dumb-init to properly handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command: start dashboard
CMD ["node", "/app/dist/cli.js", "dashboard", "--host", "127.0.0.1"]
