import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");

const tasks = [
  { name: "cima-contracts", cmd: "pnpm build && pnpm test" },
  { name: "crm-auth", cmd: "pnpm build && pnpm test:unit" },
  { name: "crm-collab", cmd: "pnpm build && pnpm test:unit" },
  { name: "crm-media", cmd: "pnpm build && pnpm test:unit" },
  { name: "crm-frontend", cmd: "pnpm build && pnpm test:unit" },
  { name: "crm-infra", cmd: "pnpm registry:validate && pnpm test:deploy" },
];

function run(task) {
  const cwd = path.join(workspaceRoot, task.name);
  console.log(`[check] ${task.name}...`);
  try {
    execSync(task.cmd, { cwd, stdio: "inherit", shell: true });
    console.log(`[ok] ${task.name}`);
  } catch {
    console.error(`[fail] ${task.name} no superó la verificación.`);
    process.exit(1);
  }
}

console.log("==> Iniciando verificación integral de la plataforma CIMA CRM...");
for (const task of tasks) {
  run(task);
}
console.log("==> Toda la plataforma superó las validaciones con éxito.");
