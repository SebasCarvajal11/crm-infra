#!/bin/sh
set -e

# Wait for database to be ready
if [ -n "$DATABASE_URL" ]; then
  echo "Waiting for database..."
  until pg_isready -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER:-root}" 2>/dev/null; do
    sleep 2
  done
  echo "Database is ready"
fi

exec java -jar app.jar "$@"
