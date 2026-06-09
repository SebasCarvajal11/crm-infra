import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));

function validateFile(schemaPath, dataPath, label) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const data   = JSON.parse(readFileSync(dataPath,   "utf-8"));

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  if (!validate(data)) {
    console.error(`❌ ${label} validation failed:`);
    console.error(validate.errors);
    process.exit(1);
  }

  console.log(`✓ ${label} is valid.`);
}

// Validate services registry
validateFile(
  resolve(__dirname, "../registry/services.schema.json"),
  resolve(__dirname, "../registry/services.json"),
  "services.json"
);

// Validate DB grants registry
validateFile(
  resolve(__dirname, "../registry/db/grants.schema.json"),
  resolve(__dirname, "../registry/db/grants.json"),
  "registry/db/grants.json"
);

// Cross-check: every service with a schema in services.json must have a grants entry
const services = JSON.parse(readFileSync(resolve(__dirname, "../registry/services.json"), "utf-8"));
const grants   = JSON.parse(readFileSync(resolve(__dirname, "../registry/db/grants.json"), "utf-8"));
const grantedServices = new Set(grants.map(g => g.service));

let crossCheckOk = true;
for (const svc of services) {
  if (svc.schema && !grantedServices.has(svc.name)) {
    console.error(`❌ Service "${svc.name}" has schema "${svc.schema}" in services.json but no entry in grants.json`);
    crossCheckOk = false;
  }
}

if (!crossCheckOk) {
  process.exit(1);
}

console.log("✓ Cross-check: all DB-backed services have grants entries.");
