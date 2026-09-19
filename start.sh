#!/usr/bin/env bash
# Starts the server under pm2, installing pm2 if it is missing.
set -e
cd "$(dirname "$0")"

command -v pm2 >/dev/null || npm install -g pm2

pm2 start ecosystem.config.js --update-env
pm2 save
