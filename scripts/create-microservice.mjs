import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync, renameSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function showUsageAndExit() {
  console.error("Usage: node scripts/create-microservice.mjs --name=<name> --port=<port>");
  console.error("Example: node scripts/create-microservice.mjs --name=billing --port=3005");
  process.exit(1);
}

// Parse arguments
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--")) {
    const [key, val] = arg.slice(2).split("=");
    args[key] = val;
  }
}

const name = args.name?.toLowerCase().trim();
const portStr = args.port?.trim();

if (!name || !portStr) {
  showUsageAndExit();
}

const port = parseInt(portStr, 10);
if (isNaN(port) || port < 1024 || port > 65535) {
  console.error(`❌ Invalid port: ${portStr}. Port must be between 1024 and 65535.`);
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`❌ Invalid name: ${name}. Only lowercase letters, numbers, and hyphens are allowed.`);
  process.exit(1);
}

const infraDir = resolve(__dirname, "..");
const templateDir = resolve(infraDir, "templates", "microservice");
const targetDir = resolve(infraDir, "..", `crm-${name}`);

console.log(`🚀 Creating new microservice "crm-${name}" on port ${port}...`);

if (statSync(targetDir, { throwIfNoEntry: false })) {
  console.error(`❌ Target directory already exists: ${targetDir}`);
  process.exit(1);
}

// 1. Copy template directory
try {
  console.log(`- Copying template to ${targetDir}...`);
  cpSync(templateDir, targetDir, { recursive: true });
} catch (err) {
  console.error(`❌ Failed to copy template: ${err.message}`);
  process.exit(1);
}

// 2. Process files recursively (placeholders and renaming)
const title = name.charAt(0).toUpperCase() + name.slice(1);
const dbPassword = `${name}password`;

function processDir(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      processDir(fullPath);
    } else {
      // Read and replace placeholders
      let content = readFileSync(fullPath, "utf-8");
      content = content.replaceAll("{{SERVICE_NAME}}", name);
      content = content.replaceAll("{{SERVICE_NAME_UPPER}}", name.toUpperCase().replace(/-/g, "_"));
      content = content.replaceAll("{{SERVICE_PORT}}", port.toString());
      content = content.replaceAll("{{DB_PASSWORD}}", dbPassword);
      content = content.replaceAll("{{SERVICE_TITLE}}", title);
      writeFileSync(fullPath, content, "utf-8");

      // Rename .template files
      if (entry.endsWith(".template")) {
        const renamedPath = join(dir, entry.slice(0, -9));
        renameSync(fullPath, renamedPath);
        console.log(`  Processed & renamed: ${entry} -> ${entry.slice(0, -9)}`);
      } else {
        console.log(`  Processed: ${entry}`);
      }
    }
  }
}

console.log("- Replacing placeholders and renaming template files...");
processDir(targetDir);

// 3. Append to services.json registry
try {
  console.log("- Registering microservice in registry/services.json...");
  const servicesJsonPath = resolve(infraDir, "registry", "services.json");
  const services = JSON.parse(readFileSync(servicesJsonPath, "utf-8"));

  // Check if name or port already used in registry
  if (services.some(s => s.name === name)) {
    console.error(`❌ Service with name "${name}" is already registered in services.json.`);
    process.exit(1);
  }
  if (services.some(s => s.port === port)) {
    console.warn(`⚠️ Port ${port} is already registered to another service. Proceeding anyway...`);
  }

  const newEntry = {
    name: name,
    repo: `SebasCarvajal11/crm-${name}`,
    port: port,
    schema: `schema_${name}`,
    composeService: name,
    manifestPath: `crm-${name}/gateway/gateway.manifest.json`,
    composeFile: `../crm-${name}/docker-compose.yml`,
    dbInitScript: "db:bootstrap",
    dbMigrateScript: "db:migrate",
    dbSetupScripts: ["db:bootstrap", "db:push"],
    requiredSecrets: [],
    workers: []
  };

  services.push(newEntry);
  writeFileSync(servicesJsonPath, JSON.stringify(services, null, 2) + "\n", "utf-8");
  console.log("✓ Added service to registry/services.json successfully");
} catch (err) {
  console.error(`❌ Failed to update services.json: ${err.message}`);
  process.exit(1);
}

// 4. Regenerate docker-compose files and krakend config
try {
  console.log("- Re-generating docker-compose and krakend configurations...");
  execSync("node scripts/generate-compose.mjs", { cwd: infraDir, stdio: "inherit" });
  execSync("node gateway/build-krakend.mjs", { cwd: infraDir, stdio: "inherit" });
} catch (err) {
  console.warn(`⚠️ Failed to regenerate configurations: ${err.message}`);
}

// 5. GitHub Repository Creation Instructions / Attempt
console.log("- Attempting to create GitHub Repository...");
let ghCreated = false;
try {
  // Check if gh is installed and authenticated
  execSync("gh auth status", { stdio: "ignore" });
  console.log("  gh CLI authenticated. Creating repository...");
  execSync(`gh repo create SebasCarvajal11/crm-${name} --public --description "${title} microservice for CIMA CRM" --source=${targetDir} --remote=origin --push`, { stdio: "inherit" });
  ghCreated = true;
  console.log(`✓ GitHub Repository SebasCarvajal11/crm-${name} created and pushed successfully.`);
} catch (err) {
  console.log("\n⚠️ Could not automatically create GitHub repository using 'gh' CLI.");
  console.log("  Please follow these manual steps to publish the repository:");
  console.log(`  1. Go to GitHub and create a repository named "crm-${name}" under SebasCarvajal11.`);
  console.log(`  2. In your terminal, run:`);
  console.log(`     cd "../crm-${name}"`);
  console.log(`     git init`);
  console.log(`     git add .`);
  console.log(`     git commit -m "Initialize crm-${name} from template"`);
  console.log(`     git branch -M main`);
  console.log(`     git remote add origin https://github.com/SebasCarvajal11/crm-${name}.git`);
  console.log(`     git push -u origin main`);
}

console.log("\n=======================================================");
console.log(`🎉 Microservice "crm-${name}" created successfully!`);
console.log(`📍 Path: ${targetDir}`);
console.log(`🔌 Local Port: ${port}`);
console.log(`🗃️ DB Schema: schema_${name}`);
console.log("=======================================================");
console.log("\nNext Steps:");
console.log(`1. Run "pnpm setup:env" to configure local .env for the new service.`);
console.log(`2. Start the service with "pnpm --dir ../crm-${name} dev" or use "docker compose up -d" from crm-infra.`);
console.log("=======================================================\n");
