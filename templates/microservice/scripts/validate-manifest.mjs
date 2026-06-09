#!/usr/bin/env node
/**
 * validate-manifest.mjs — Validates gateway.manifest.json against the schema.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function fail(msg) {
  console.error(`\n❌ Manifest validation failed: ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

let manifest;
try {
  const raw = readFileSync(resolve(ROOT, "gateway", "gateway.manifest.json"), "utf-8");
  manifest = JSON.parse(raw);
} catch (e) {
  fail(`Could not read gateway/gateway.manifest.json: ${e.message}`);
}

if (!manifest.service || typeof manifest.service !== "string") {
  fail("manifest.service must be a non-empty string");
}

if (!manifest.version || typeof manifest.version !== "string") {
  fail("manifest.version must be a non-empty string");
}

const allEndpoints = [
  ...(manifest.public_endpoints ?? []),
  ...(manifest.authenticated_endpoints ?? []),
];

if (allEndpoints.length === 0) {
  fail("Manifest must have at least one endpoint in public_endpoints or authenticated_endpoints");
}

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const seenEndpoints = new Set();

for (const ep of allEndpoints) {
  if (!ep.endpoint || typeof ep.endpoint !== "string") {
    fail(`Endpoint missing or invalid 'endpoint' field: ${JSON.stringify(ep)}`);
  }

  if (!ep.method || !VALID_METHODS.includes(ep.method)) {
    fail(`Endpoint ${ep.endpoint}: invalid method '${ep.method}'`);
  }

  const key = `${ep.method}:${ep.endpoint}`;
  if (seenEndpoints.has(key)) {
    fail(`Duplicate endpoint: ${key}`);
  }
  seenEndpoints.add(key);

  if (ep.rate_limit !== undefined) {
    if (typeof ep.rate_limit.max_rate !== "number") {
      fail(`Endpoint ${key}: rate_limit.max_rate must be a number`);
    }
  }

  if (ep.cache_ttl !== undefined) {
    if (!/^\d+(s|m|h)$/.test(ep.cache_ttl)) {
      fail(`Endpoint ${key}: cache_ttl must be in format '<n>s', '<n>m', or '<n>h'`);
    }
  }
}

const noBackendUrl = allEndpoints.filter((ep) => !ep.backend_url);
for (const ep of noBackendUrl) {
  warn(`Endpoint ${ep.method}:${ep.endpoint} has no backend_url — will default to endpoint path`);
}

console.log(`\n✅ gateway.manifest.json is valid`);
console.log(`   service  : ${manifest.service}`);
console.log(`   version  : ${manifest.version}`);
console.log(`   endpoints: ${allEndpoints.length} (${manifest.public_endpoints?.length ?? 0} public, ${manifest.authenticated_endpoints?.length ?? 0} authenticated)\n`);
