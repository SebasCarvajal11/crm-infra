#!/usr/bin/env node
/**
 * validate-openapi.mjs — Validates the OpenAPI specification file for the service.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function fail(msg) {
  console.error(`\n❌ OpenAPI validation failed: ${msg}\n`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(resolve(ROOT, "openapi", "openapi.yaml"), "utf-8");
} catch (e) {
  fail(`Could not read openapi/openapi.yaml: ${e.message}`);
}

if (!raw.includes("openapi:")) {
  fail("File does not appear to be an OpenAPI spec (missing 'openapi:' key)");
}

if (!raw.includes("info:")) {
  fail("OpenAPI spec missing 'info' section");
}

if (!raw.includes("paths:")) {
  fail("OpenAPI spec missing 'paths' section");
}

import yaml from "yaml";
let parsed;
try {
  parsed = yaml.parse(raw);
} catch (e) {
  fail(`YAML parse error: ${e.message}`);
}

const paths = Object.keys(parsed.paths ?? {});

if (paths.length === 0) {
  fail("OpenAPI spec has no paths defined");
}

if (!parsed.info?.title) {
  fail("OpenAPI spec missing info.title");
}

if (!parsed.info?.version) {
  fail("OpenAPI spec missing info.version");
}

if (!parsed.paths?.["health"]) {
  console.warn(`⚠️  OpenAPI spec does not define /health path`);
}

console.log(`\n✅ openapi.yaml is valid`);
console.log(`   title  : ${parsed.info.title}`);
console.log(`   version: ${parsed.info.version}`);
console.log(`   paths  : ${paths.length}\n`);
