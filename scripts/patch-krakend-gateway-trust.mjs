/**
 * Añade a krakend.json:
 * - Martian: cabecera X-Gateway-Trust hacia mod-auth (debe coincidir con GATEWAY_TRUST_SECRET).
 * - auth/validator: propagate_claims exp → X-Token-Exp.
 * - input_headers: X-Token-Exp donde hay validator.
 *
 * Uso: node scripts/patch-krakend-gateway-trust.mjs
 * Opcional: GATEWAY_TRUST_SECRET="tu-secreto-largo" node scripts/patch-krakend-gateway-trust.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const krakendPath = path.join(root, "krakend.json");

const SECRET =
  process.env.GATEWAY_TRUST_SECRET ||
  "cima-local-gateway-trust-secret-do-not-use-production-2026";

const martianBlock = {
  "modifier/martian": {
    "header.Modifier": {
      scope: ["request"],
      name: "X-Gateway-Trust",
      value: SECRET,
    },
  },
};

const raw = fs.readFileSync(krakendPath, "utf8");
const j = JSON.parse(raw);

for (const ep of j.endpoints) {
  const b0 = ep.backend?.[0];
  if (!b0) continue;
  b0.extra_config = { ...(b0.extra_config || {}), ...martianBlock };

  const validator = ep.extra_config?.["auth/validator"];
  if (validator?.propagate_claims) {
    const hasExp = validator.propagate_claims.some((pair) => pair[0] === "exp");
    if (!hasExp) {
      validator.propagate_claims.push(["exp", "X-Token-Exp"]);
    }
    const ih = ep.input_headers || [];
    if (!ih.includes("X-Token-Exp")) {
      ih.push("X-Token-Exp");
      ep.input_headers = ih;
    }
  }
}

fs.writeFileSync(krakendPath, JSON.stringify(j, null, 2) + "\n", "utf8");
console.log("krakend.json actualizado (Martian + exp). SECRET length:", SECRET.length);
