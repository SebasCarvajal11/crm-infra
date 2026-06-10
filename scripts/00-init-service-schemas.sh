#!/usr/bin/env sh
# 00-init-service-schemas.sh
# Idempotent PostgreSQL bootstrap driven by registry/db/grants.json.
# Each entry creates the role (or updates the password), creates the schema,
# and applies the declared GRANT statements.
#
# Required env vars (must be set before invoking):
#   POSTGRES_USER        – superuser (defaults to "root")
#   POSTGRES_DB          – target database (defaults to "crm_database")
#   AUTH_DB_PASSWORD     – password for auth_user
#   COLLAB_DB_PASSWORD   – password for collab_user
#   MEDIA_DB_PASSWORD    – password for media_user
#
# Optional:
#   GRANTS_JSON          – path to grants.json (defaults to registry/db/grants.json
#                          relative to this script)

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GRANTS_FILE="${GRANTS_JSON:-${SCRIPT_DIR}/../registry/db/grants.json}"

: "${POSTGRES_DB:=crm_database}"
: "${POSTGRES_USER:=root}"

# ── Validate grants file exists ──────────────────────────────────────────────
if [ ! -f "$GRANTS_FILE" ]; then
  echo "ERROR: grants file not found at $GRANTS_FILE" >&2
  exit 1
fi

# ── Parse grants.json with jq ────────────────────────────────────────────────
if ! command -v jq > /dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

# Count entries
entry_count=$(jq 'length' "$GRANTS_FILE")
echo "→ Processing $entry_count service(s) from $GRANTS_FILE"

i=0
while [ "$i" -lt "$entry_count" ]; do
  service=$(jq -r ".[$i].service"        "$GRANTS_FILE")
  role=$(jq -r    ".[$i].role"           "$GRANTS_FILE")
  pwd_env=$(jq -r ".[$i].passwordEnvVar" "$GRANTS_FILE")
  schema=$(jq -r  ".[$i].schema"         "$GRANTS_FILE")

  # Resolve password from environment
  password=$(eval "echo \"\${${pwd_env}:-}\"")
  if [ -z "$password" ]; then
    echo "ERROR: env var '$pwd_env' for service '$service' is not set or empty" >&2
    exit 1
  fi

  # Build grant lists
  schema_grants=$(jq -r ".[$i].grants.schema   | join(\", \")" "$GRANTS_FILE")
  table_grants=$(jq -r  ".[$i].grants.tables   | join(\", \")" "$GRANTS_FILE")
  seq_grants=$(jq -r    ".[$i].grants.sequences | join(\", \")" "$GRANTS_FILE")
  fn_grants=$(jq -r     ".[$i].grants.functions | join(\", \")" "$GRANTS_FILE")

  echo "→ Bootstrapping service=$service role=$role schema=$schema"

  psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname   "$POSTGRES_DB" \
    <<SQL
-- ── Role ──────────────────────────────────────────────────────────────────────
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${role}', '${password}');
    RAISE NOTICE 'Created role %', '${role}';
  ELSE
    EXECUTE format('ALTER  ROLE %I LOGIN PASSWORD %L', '${role}', '${password}');
    RAISE NOTICE 'Updated password for role %', '${role}';
  END IF;
END
\$\$;

-- ── Database connect ──────────────────────────────────────────────────────────
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO \$\$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', '${POSTGRES_DB}', '${role}');
END
\$\$;

-- ── Schema ────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS "${schema}" AUTHORIZATION "${role}";
ALTER  SCHEMA "${schema}" OWNER TO "${role}";
REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC;
GRANT ${schema_grants} ON SCHEMA "${schema}" TO "${role}";

-- ── Existing objects: transfer ownership ──────────────────────────────────────
DO \$\$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT c.relkind, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}'
      AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE obj.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        ELSE 'TABLE'
      END,
      '${schema}', obj.relname, '${role}'
    );
  END LOOP;

  FOR obj IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = '${schema}'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) OWNER TO %I',
      '${schema}', obj.proname, obj.args, '${role}'
    );
  END LOOP;

  FOR obj IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = '${schema}'
      AND t.typtype IN ('d', 'e', 'r')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', '${schema}', obj.typname, '${role}');
  END LOOP;
END
\$\$;

-- ── Grants on existing objects ────────────────────────────────────────────────
GRANT ${table_grants} ON ALL TABLES    IN SCHEMA "${schema}" TO "${role}";
GRANT ${seq_grants}   ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}";
GRANT ${fn_grants}    ON ALL FUNCTIONS IN SCHEMA "${schema}" TO "${role}";

-- ── Default privileges for future objects ─────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE "${role}" IN SCHEMA "${schema}"
  GRANT ${table_grants} ON TABLES    TO "${role}";
ALTER DEFAULT PRIVILEGES FOR ROLE "${role}" IN SCHEMA "${schema}"
  GRANT ${seq_grants}   ON SEQUENCES TO "${role}";
ALTER DEFAULT PRIVILEGES FOR ROLE "${role}" IN SCHEMA "${schema}"
  GRANT ${fn_grants}    ON FUNCTIONS TO "${role}";
SQL

  echo "✓ Bootstrap complete for service=$service"
  i=$((i + 1))
done

echo "✓ All services bootstrapped successfully."
