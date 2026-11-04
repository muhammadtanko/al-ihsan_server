#!/bin/sh
set -e

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting AL-IHSAN API..."
exec node dist/src/server.js
