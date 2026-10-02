import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");

const repoHooks = [
  {
    repo: "cima-contracts",
    command: "pnpm build && pnpm test",
  },
  {
    repo: "crm-auth",
    command: "pnpm build && pnpm test:unit",
  },
  {
    repo: "crm-collab",
    command: "pnpm build && pnpm test:unit",
  },
  {
    repo: "crm-media",
    command: "pnpm build && pnpm test:unit",
  },
  {
    repo: "crm-frontend",
    command: "pnpm build && pnpm test:unit",
  },
  {
    repo: "crm-infra",
    command: "pnpm registry:validate && pnpm test:deploy",
  },
];

function generateHookContent(command) {
  return `#!/usr/bin/env bash
# Guardrail preventivo pre-push CIMA CRM
set -e
echo "==> [PRE-PUSH GUARDRAIL] Validando build y tests antes de subir cambios..."
${command}
echo "==> [PRE-PUSH GUARDRAIL] Verificación superada con éxito."
`;
}

for (const { repo, command } of repoHooks) {
  const hooksDir = path.join(workspaceRoot, repo, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    console.warn(`[skip] No se encontró directorio .git/hooks en ${repo}`);
    continue;
  }
  const hookFile = path.join(hooksDir, "pre-push");
  fs.writeFileSync(hookFile, generateHookContent(command), { mode: 0o755 });
  console.log(`[guardrail] Hook pre-push instalado en ${repo}`);
}

console.log("==> Guardrails instalados exitosamente en todos los repositorios.");
