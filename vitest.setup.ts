// Server tests run against an isolated in-memory SQLite DB. This must be set
// before any test file imports server modules — `db` is a module-level
// singleton created from these env vars at import time (db/index.ts).
process.env.DATABASE_URL = ':memory:';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
