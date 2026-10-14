#!/bin/sh
set -eu
# Only the database container receives the superuser credential.
APP_DB_PASSWORD=$(cat /run/secrets/db_password)
export APP_DB_PASSWORD
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password APP_DB_PASSWORD
CREATE ROLE tabbridge LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
ALTER DATABASE tabbridge OWNER TO tabbridge;
GRANT CREATE ON SCHEMA public TO tabbridge;
SQL
unset APP_DB_PASSWORD
