-- The official PostgreSQL image creates POSTGRES_DB and its bootstrap role.
-- Keep the bootstrap role for cluster maintenance; Hindsight uses a dedicated
-- non-superuser role, which owns only this database.
\getenv app_user HINDSIGHT_DB_USER
\getenv app_password HINDSIGHT_DB_PASSWORD
\getenv database_name POSTGRES_DB
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'app_user') \gexec
CREATE EXTENSION IF NOT EXISTS vector;
SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT ALL PRIVILEGES ON SCHEMA public TO %I', :'app_user') \gexec
