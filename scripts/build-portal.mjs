import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

console.log("🚀 Iniciando compilación del Catálogo de APIs y Eventos...");

// Servicios a escanear
const services = [
  { name: "crm-auth", label: "Auth (Identidad y Acceso)", openapiPath: "crm-auth/openapi/openapi.yaml" },
  { name: "crm-collab", label: "Collab (Colaboración)", openapiPath: "crm-collab/openapi/openapi.yaml" },
  { name: "crm-media", label: "Media (Almacenamiento)", openapiPath: "crm-media/openapi/openapi.yaml" }
];

// Leer y parsear OpenAPI Specs
const openapiData = [];
for (const svc of services) {
  const fullPath = path.join(projectRoot, svc.openapiPath);
  if (fs.existsSync(fullPath)) {
    try {
      const fileContent = fs.readFileSync(fullPath, "utf8");
      const parsed = YAML.parse(fileContent);
      openapiData.push({
        service: svc.name,
        label: svc.label,
        version: parsed.info?.version || "1.0.0",
        title: parsed.info?.title || svc.label,
        description: parsed.info?.description || "",
        paths: parsed.paths || {},
        components: parsed.components || {}
      });
      console.log(`✅ Cargada especificación OpenAPI de ${svc.name}`);
    } catch (err) {
      console.error(`❌ Error al parsear OpenAPI de ${svc.name}:`, err.message);
    }
  } else {
    console.warn(`⚠ Especificación OpenAPI no encontrada en: ${fullPath}`);
  }
}

// Leer y parsear Eventos de cima-contracts
const eventsData = [];
const contractsSrcDir = path.join(projectRoot, "cima-contracts/src");
if (fs.existsSync(contractsSrcDir)) {
  const files = fs.readdirSync(contractsSrcDir);
  for (const file of files) {
    if (file.endsWith("-events.ts")) {
      const filePath = path.join(contractsSrcDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      
      // Intentar extraer eventos y esquemas de forma estática simple
      const eventTypes = [];
      const typeMatches = content.matchAll(/type:\s*z\.literal\(["']([^"']+)["']\)/g);
      for (const match of typeMatches) {
        if (!eventTypes.includes(match[1])) {
          eventTypes.push(match[1]);
        }
      }

      // Buscar si tiene replay-requested o schemas adicionales
      const schemas = [];
      const schemaMatches = content.matchAll(/export\s+const\s+(\w+Schema)\s*=\s*/g);
      for (const match of schemaMatches) {
        schemas.push(match[1]);
      }

      eventsData.push({
        file,
        domain: file.replace("-events.ts", ""),
        schemas,
        eventTypes,
        rawCode: content
      });
      console.log(`✅ Procesado archivo de eventos: ${file}`);
    }
  }
} else {
  console.warn(`⚠ Directorio de contratos no encontrado: ${contractsSrcDir}`);
}

// Leer template HTML
const templatePath = path.join(__dirname, "../templates/portal/portal.html.template");
if (!fs.existsSync(templatePath)) {
  console.error(`❌ Template no encontrado en: ${templatePath}`);
  process.exit(1);
}

let htmlContent = fs.readFileSync(templatePath, "utf8");

// Reemplazar placeholders con datos
htmlContent = htmlContent.replace("{{OPENAPI_DATA}}", JSON.stringify(openapiData, null, 2));
htmlContent = htmlContent.replace("{{EVENTS_DATA}}", JSON.stringify(eventsData, null, 2));

// Crear directorio si no existe y escribir el portal
const portalDir = path.join(projectRoot, "crm-infra/api-portal");
if (!fs.existsSync(portalDir)) {
  fs.mkdirSync(portalDir, { recursive: true });
}
const portalPath = path.join(portalDir, "index.html");
fs.writeFileSync(portalPath, htmlContent, "utf8");

console.log(`🎉 ¡Portal del catálogo compilado con éxito en ${portalPath}!`);
