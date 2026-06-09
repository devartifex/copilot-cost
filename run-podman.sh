#!/bin/bash

podman run -p 4567:4567 --entrypoint node -v ${USERPROFILE}/.copilot/otel:/home/copilot/.copilot/otel:ro -e COPILOT_OTEL_DIR=/home/copilot/.copilot/otel copilot-cost:latest /app/dist/cli.js dashboard --no-open
