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

// Generar HTML del Portal
const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CIMA CRM — Portal de APIs y Catálogo de Eventos</title>
  
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --bg-main: #0B0F19;
      --bg-card: #161F30;
      --bg-header: #0F172A;
      --bg-input: #1E293B;
      --border-color: #334155;
      
      --text-main: #E2E8F0;
      --text-muted: #94A3B8;
      --text-accent: #3B82F6;
      --text-success: #10B981;
      
      --accent-indigo: #6366F1;
      --accent-teal: #14B8A6;
      --accent-rose: #F43F5E;
      
      --font-sans: 'Outfit', sans-serif;
      --font-mono: 'Fira Code', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-main);
      color: var(--text-main);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding-bottom: 4rem;
    }

    header {
      background: linear-gradient(135deg, var(--bg-header) 0%, #0F172A 100%);
      border-bottom: 1px solid var(--border-color);
      padding: 2.5rem 2rem;
      position: relative;
      overflow: hidden;
    }

    header::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -20%;
      width: 60%;
      height: 200%;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 60%);
      pointer-events: none;
    }

    .container {
      max-width: 1300px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .header-content {
      position: relative;
      z-index: 10;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      background: linear-gradient(to right, #818CF8, #34D399);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
      font-weight: 300;
    }

    /* Controles de Búsqueda y Filtro */
    .controls {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: -1.5rem;
      margin-bottom: 2rem;
      position: relative;
      z-index: 20;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 1rem;
    }

    @media (max-width: 768px) {
      .controls {
        grid-template-columns: 1fr;
      }
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    input, select {
      background-color: var(--bg-input);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-main);
      font-family: var(--font-sans);
      font-size: 1rem;
      padding: 0.75rem 1rem;
      outline: none;
      transition: all 0.2s ease;
      width: 100%;
    }

    input:focus, select:focus {
      border-color: var(--accent-indigo);
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }

    /* Tabs de navegación */
    .tabs {
      display: flex;
      gap: 1rem;
      border-bottom: 2px solid var(--border-color);
      margin-bottom: 2rem;
    }

    .tab {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: 1.1rem;
      font-weight: 500;
      padding: 1rem 1.5rem;
      position: relative;
      transition: color 0.2s ease;
    }

    .tab.active {
      color: var(--text-main);
    }

    .tab.active::after {
      content: '';
      position: absolute;
      bottom: -2px;
      left: 0;
      width: 100%;
      height: 2px;
      background-color: var(--accent-indigo);
    }

    /* Grid Layout */
    .catalog-grid {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .section-title {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Tarjetas de Servicio/Modulo */
    .service-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .service-card:hover {
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
    }

    .service-header {
      background-color: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border-color);
      padding: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .service-title-info h3 {
      font-size: 1.35rem;
      font-weight: 600;
    }

    .service-desc {
      color: var(--text-muted);
      font-size: 0.95rem;
      margin-top: 0.25rem;
    }

    .badge {
      background-color: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #A5B4FC;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
    }

    /* Endpoints list */
    .endpoints-list {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .endpoint-item {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      background-color: rgba(0, 0, 0, 0.15);
    }

    .endpoint-summary {
      display: flex;
      align-items: center;
      padding: 1rem;
      cursor: pointer;
      user-select: none;
      justify-content: space-between;
    }

    .endpoint-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .method {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      min-width: 60px;
      text-align: center;
    }

    .method.GET { background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34D399; }
    .method.POST { background-color: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #60A5FA; }
    .method.PUT { background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #FBBF24; }
    .method.DELETE { background-color: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.3); color: #FB7185; }

    .path {
      font-family: var(--font-mono);
      font-size: 0.95rem;
      font-weight: 500;
    }

    .summary-text {
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .endpoint-details {
      padding: 1.5rem;
      border-top: 1px solid var(--border-color);
      background-color: rgba(0, 0, 0, 0.25);
    }

    .endpoint-details h4 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: var(--text-muted);
    }

    /* Event layouts */
    .events-list {
      padding: 1.5rem;
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }

    .event-card {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .event-header {
      background-color: rgba(0, 0, 0, 0.2);
      padding: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
    }

    .event-title {
      font-family: var(--font-mono);
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--accent-teal);
    }

    .code-block {
      background-color: #090D16;
      border: 1px solid #1E293B;
      border-radius: 6px;
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      overflow-x: auto;
      color: #A7F3D0;
      max-height: 400px;
    }

    .no-results {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
      border: 1px dashed var(--border-color);
      border-radius: 12px;
      background-color: rgba(255, 255, 255, 0.01);
    }

    .no-results svg {
      width: 48px;
      height: 48px;
      stroke: var(--text-muted);
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>

  <header>
    <div class="container header-content">
      <h1>CIMA CRM API & Event Portal</h1>
      <div class="subtitle">Catálogo unificado de interfaces públicas y contratos de mensajería asíncrona</div>
    </div>
  </header>

  <main class="container">
    
    <section class="controls">
      <div class="input-group">
        <label for="search">Buscar</label>
        <input type="text" id="search" placeholder="Buscar por endpoint, evento, path o descripción...">
      </div>
      <div class="input-group">
        <label for="filter-service">Filtrar por Servicio</label>
        <select id="filter-service">
          <option value="all">Todos los Servicios</option>
          <option value="crm-auth">Auth</option>
          <option value="crm-collab">Collab</option>
          <option value="crm-media">Media</option>
          <option value="events">Eventos (cima-contracts)</option>
        </select>
      </div>
      <div class="input-group">
        <label for="filter-type">Tipo de Interfaz</label>
        <select id="filter-type">
          <option value="all">Cualquier tipo</option>
          <option value="http">Endpoints HTTP</option>
          <option value="events">Eventos de Bus (Redis)</option>
        </select>
      </div>
    </section>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('endpoints')">Endpoints HTTP</button>
      <button class="tab" onclick="switchTab('events')">Bus de Eventos</button>
    </div>

    <div id="tab-endpoints" class="tab-content">
      <div class="catalog-grid" id="endpoints-container">
        <!-- Renderizado dinámico de endpoints -->
      </div>
    </div>

    <div id="tab-events" class="tab-content" style="display: none;">
      <div class="catalog-grid" id="events-container">
        <!-- Renderizado dinámico de eventos -->
      </div>
    </div>

    <div id="no-results-view" class="no-results" style="display: none;">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 7.5h.008v.008H12v-.008Z" />
      </svg>
      <h3>No se encontraron resultados</h3>
      <p>Prueba ajustando los filtros o utilizando otros términos de búsqueda.</p>
    </div>

  </main>

  <script>
    // Datos inyectados
    const openapiSpecs = ${JSON.stringify(openapiData, null, 2)};
    const eventsCatalog = ${JSON.stringify(eventsData, null, 2)};

    let currentTab = 'endpoints';

    function switchTab(tabId) {
      currentTab = tabId;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      
      const activeTabButton = Array.from(document.querySelectorAll('.tab')).find(t => t.innerText.toLowerCase().includes(tabId === 'endpoints' ? 'http' : 'bus'));
      if (activeTabButton) activeTabButton.classList.add('active');
      
      document.getElementById('tab-' + tabId).style.display = 'block';
      applyFilters();
    }

    function toggleDetails(elementId) {
      const el = document.getElementById(elementId);
      if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
      }
    }

    function applyFilters() {
      const searchVal = document.getElementById('search').value.toLowerCase();
      const serviceVal = document.getElementById('filter-service').value;
      const typeVal = document.getElementById('filter-type').value;

      let hasAnyResults = false;

      if (currentTab === 'endpoints') {
        const container = document.getElementById('endpoints-container');
        container.innerHTML = '';

        openapiSpecs.forEach(spec => {
          if (serviceVal !== 'all' && serviceVal !== spec.service) return;
          if (typeVal === 'events') return; // Omitir http si filtramos solo eventos

          const paths = Object.entries(spec.paths);
          const filteredPaths = paths.filter(([pathKey, methods]) => {
            const pathMatches = pathKey.toLowerCase().includes(searchVal);
            const methodsMatch = Object.entries(methods).some(([method, detail]) => {
              return (detail.summary && detail.summary.toLowerCase().includes(searchVal)) ||
                     (detail.description && detail.description.toLowerCase().includes(searchVal)) ||
                     (detail.tags && detail.tags.some(t => t.toLowerCase().includes(searchVal)));
            });
            return pathMatches || methodsMatch;
          });

          if (filteredPaths.length === 0) return;

          hasAnyResults = true;

          const serviceCard = document.createElement('div');
          serviceCard.className = 'service-card';
          
          let endpointsHtml = '';
          filteredPaths.forEach(([pathKey, methods]) => {
            Object.entries(methods).forEach(([methodName, detail]) => {
              const methodUpper = methodName.toUpperCase();
              const safeId = 'ep-' + spec.service + '-' + pathKey.replace(/[^a-zA-Z0-9]/g, '-') + '-' + methodName;
              
              endpointsHtml += \`
                <div class="endpoint-item">
                  <div class="endpoint-summary" onclick="toggleDetails('\${safeId}')">
                    <div class="endpoint-left">
                      <span class="method \${methodUpper}">\${methodUpper}</span>
                      <span class="path">\${pathKey}</span>
                    </div>
                    <span class="summary-text">\${detail.summary || ''}</span>
                  </div>
                  <div class="endpoint-details" id="\${safeId}" style="display: none;">
                    <h4>Descripción</h4>
                    <p style="margin-bottom: 1rem; color: var(--text-muted);">\${detail.description || 'Sin descripción.'}</p>
                    \${detail.parameters ? \`
                      <h4>Parámetros</h4>
                      <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem;">
                        <thead>
                          <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                            <th style="padding: 0.5rem; color: var(--text-muted);">Nombre</th>
                            <th style="padding: 0.5rem; color: var(--text-muted);">Ubicación</th>
                            <th style="padding: 0.5rem; color: var(--text-muted);">Requerido</th>
                            <th style="padding: 0.5rem; color: var(--text-muted);">Descripción</th>
                          </tr>
                        </thead>
                        <tbody>
                          \${detail.parameters.map(p => \`
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                              <td style="padding: 0.5rem; font-family: var(--font-mono);">\${p.name}</td>
                              <td style="padding: 0.5rem;">\${p.in}</td>
                              <td style="padding: 0.5rem; color: \${p.required ? 'var(--accent-rose)' : 'var(--text-muted)'}">\${p.required ? 'Sí' : 'No'}</td>
                              <td style="padding: 0.5rem;">\${p.description || ''}</td>
                            </tr>
                          \`).join('')}
                        </tbody>
                      </table>
                    \` : ''}
                    \${detail.responses ? \`
                      <h4>Respuestas HTTP</h4>
                      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        \${Object.entries(detail.responses).map(([code, resp]) => \`
                          <div style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; background-color: rgba(255,255,255,0.02);">
                            <strong style="color: \${code.startsWith('2') ? 'var(--text-success)' : 'var(--accent-rose)'}">\${code}</strong>: \${resp.description || ''}
                          </div>
                        \`).join('')}
                      </div>
                    \` : ''}
                  </div>
                </div>
              \`;
            });
          });

          serviceCard.innerHTML = \`
            <div class="service-header">
              <div class="service-title-info">
                <h3>\${spec.title}</h3>
                <p class="service-desc">\${spec.description.split('\\n')[0]}</p>
              </div>
              <span class="badge">v\${spec.version}</span>
            </div>
            <div class="endpoints-list">
              \${endpointsHtml}
            </div>
          \`;
          container.appendChild(serviceCard);
        });
      } else {
        const container = document.getElementById('events-container');
        container.innerHTML = '';

        eventsCatalog.forEach(eventsFile => {
          if (serviceVal !== 'all' && serviceVal !== 'events') return;
          if (typeVal === 'http') return;

          const filteredEvents = eventsFile.eventTypes.filter(evt => evt.toLowerCase().includes(searchVal));
          if (filteredEvents.length === 0 && !eventsFile.file.toLowerCase().includes(searchVal)) return;

          hasAnyResults = true;

          const serviceCard = document.createElement('div');
          serviceCard.className = 'service-card';

          let eventsHtml = '';
          eventsFile.eventTypes.forEach(evt => {
            if (searchVal && !evt.toLowerCase().includes(searchVal)) return;
            const safeId = 'evt-' + evt.replace(/[^a-zA-Z0-9]/g, '-');
            eventsHtml += \`
              <div class="event-card">
                <div class="event-header">
                  <span class="event-title">\${evt}</span>
                  <span class="badge" style="background-color: rgba(20, 184, 166, 0.15); border-color: rgba(20, 184, 166, 0.3); color: #99F6E4;">evento</span>
                </div>
              </div>
            \`;
          });

          serviceCard.innerHTML = \`
            <div class="service-header">
              <div class="service-title-info">
                <h3>Dominio de Eventos: \${eventsFile.domain.toUpperCase()}</h3>
                <p class="service-desc">Definido en \${eventsFile.file}</p>
              </div>
            </div>
            <div class="events-list">
              \${eventsHtml}
              <div style="margin-top: 1rem;">
                <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: var(--text-muted);">Definiciones del Esquema (Zod)</h4>
                <pre class="code-block"><code>\${escapeHtml(eventsFile.rawCode)}</code></pre>
              </div>
            </div>
          \`;
          container.appendChild(serviceCard);
        });
      }

      document.getElementById('no-results-view').style.display = hasAnyResults ? 'none' : 'block';
    }

    function escapeHtml(text) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Event Listeners
    document.getElementById('search').addEventListener('input', applyFilters);
    document.getElementById('filter-service').addEventListener('change', applyFilters);
    document.getElementById('filter-type').addEventListener('change', applyFilters);

    // Inicializar
    applyFilters();
  </script>
</body>
</html>
`;

// Crear directorio si no existe y escribir el portal
const portalDir = path.join(projectRoot, "crm-infra/api-portal");
if (!fs.existsSync(portalDir)) {
  fs.mkdirSync(portalDir, { recursive: true });
}
const portalPath = path.join(portalDir, "index.html");
fs.writeFileSync(portalPath, htmlContent, "utf8");

console.log(`🎉 ¡Portal del catálogo compilado con éxito en ${portalPath}!`);
