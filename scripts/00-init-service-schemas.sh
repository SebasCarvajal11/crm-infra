#!/usr/bin/env sh
set -eu

: "${POSTGRES_DB:=crm_database}"
: "${POSTGRES_USER:=root}"
: "${AUTH_DB_PASSWORD:=authpassword}"
: "${COLLAB_DB_PASSWORD:=collabpassword}"
: "${MEDIA_DB_PASSWORD:=mediapassword}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v auth_password="$AUTH_DB_PASSWORD" \
  -v collab_password="$COLLAB_DB_PASSWORD" \
  -v media_password="$MEDIA_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'auth_user', :'auth_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_user')\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'auth_user', :'auth_password')\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'collab_user', :'collab_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'collab_user')\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'collab_user', :'collab_password')\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'media_user', :'media_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'media_user')\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', 'media_user', :'media_password')\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM auth_user, collab_user, media_user;

CREATE SCHEMA IF NOT EXISTS schema_auth AUTHORIZATION auth_user;
CREATE SCHEMA IF NOT EXISTS schema_collab AUTHORIZATION collab_user;
CREATE SCHEMA IF NOT EXISTS schema_media AUTHORIZATION media_user;

ALTER SCHEMA schema_auth OWNER TO auth_user;
ALTER SCHEMA schema_collab OWNER TO collab_user;
ALTER SCHEMA schema_media OWNER TO media_user;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relkind, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'schema_auth'
      AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE item.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        ELSE 'TABLE'
      END,
      'schema_auth',
      item.relname,
      'auth_user'
    );
  END LOOP;

  FOR item IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'schema_auth'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) OWNER TO %I',
      'schema_auth',
      item.proname,
      item.args,
      'auth_user'
    );
  END LOOP;

  FOR item IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'schema_auth'
      AND t.typtype IN ('d', 'e', 'r')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', 'schema_auth', item.typname, 'auth_user');
  END LOOP;
END
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relkind, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'schema_collab'
      AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE item.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        ELSE 'TABLE'
      END,
      'schema_collab',
      item.relname,
      'collab_user'
    );
  END LOOP;

  FOR item IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'schema_collab'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) OWNER TO %I',
      'schema_collab',
      item.proname,
      item.args,
      'collab_user'
    );
  END LOOP;

  FOR item IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'schema_collab'
      AND t.typtype IN ('d', 'e', 'r')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', 'schema_collab', item.typname, 'collab_user');
  END LOOP;
END
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relkind, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'schema_media'
      AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE item.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        ELSE 'TABLE'
      END,
      'schema_media',
      item.relname,
      'media_user'
    );
  END LOOP;

  FOR item IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'schema_media'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) OWNER TO %I',
      'schema_media',
      item.proname,
      item.args,
      'media_user'
    );
  END LOOP;

  FOR item IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'schema_media'
      AND t.typtype IN ('d', 'e', 'r')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', 'schema_media', item.typname, 'media_user');
  END LOOP;
END
$$;

REVOKE ALL ON SCHEMA schema_auth FROM PUBLIC, collab_user, media_user;
REVOKE ALL ON SCHEMA schema_collab FROM PUBLIC, auth_user, media_user;
REVOKE ALL ON SCHEMA schema_media FROM PUBLIC, auth_user, collab_user;

GRANT USAGE, CREATE ON SCHEMA schema_auth TO auth_user;
GRANT USAGE, CREATE ON SCHEMA schema_collab TO collab_user;
GRANT USAGE, CREATE ON SCHEMA schema_media TO media_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA schema_auth TO auth_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA schema_auth TO auth_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA schema_auth TO auth_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA schema_collab TO collab_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA schema_collab TO collab_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA schema_collab TO collab_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA schema_media TO media_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA schema_media TO media_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA schema_media TO media_user;

ALTER DEFAULT PRIVILEGES FOR ROLE auth_user IN SCHEMA schema_auth
  GRANT ALL PRIVILEGES ON TABLES TO auth_user;
ALTER DEFAULT PRIVILEGES FOR ROLE auth_user IN SCHEMA schema_auth
  GRANT ALL PRIVILEGES ON SEQUENCES TO auth_user;
ALTER DEFAULT PRIVILEGES FOR ROLE auth_user IN SCHEMA schema_auth
  GRANT ALL PRIVILEGES ON FUNCTIONS TO auth_user;

ALTER DEFAULT PRIVILEGES FOR ROLE collab_user IN SCHEMA schema_collab
  GRANT ALL PRIVILEGES ON TABLES TO collab_user;
ALTER DEFAULT PRIVILEGES FOR ROLE collab_user IN SCHEMA schema_collab
  GRANT ALL PRIVILEGES ON SEQUENCES TO collab_user;
ALTER DEFAULT PRIVILEGES FOR ROLE collab_user IN SCHEMA schema_collab
  GRANT ALL PRIVILEGES ON FUNCTIONS TO collab_user;

ALTER DEFAULT PRIVILEGES FOR ROLE media_user IN SCHEMA schema_media
  GRANT ALL PRIVILEGES ON TABLES TO media_user;
ALTER DEFAULT PRIVILEGES FOR ROLE media_user IN SCHEMA schema_media
  GRANT ALL PRIVILEGES ON SEQUENCES TO media_user;
ALTER DEFAULT PRIVILEGES FOR ROLE media_user IN SCHEMA schema_media
  GRANT ALL PRIVILEGES ON FUNCTIONS TO media_user;
SQL
