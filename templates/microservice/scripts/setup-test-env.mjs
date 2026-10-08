import fs from 'node:fs';

const lines = [
  'DATABASE_URL=postgres://root:rootpassword@127.0.0.1:5432/crm_database',
  'DB_SCHEMA=schema_{{SERVICE_NAME}}',
  'REDIS_URL=redis://127.0.0.1:6379',
  'NODE_ENV=test',
  'PORT={{PORT}}',
  'TRUST_GATEWAY_JWT_HEADERS=true',
];

fs.writeFileSync('.env', lines.join('\n') + '\n');
console.log('[setup-test-env] .env successfully generated for crm-{{SERVICE_NAME}}.');
