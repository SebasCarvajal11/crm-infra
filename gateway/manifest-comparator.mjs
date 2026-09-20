import { readFileSync } from "node:fs";

export function compareManifests(oldPath, newPath) {
  const oldManifest = loadManifestSafe(oldPath, "antiguo");
  const newManifest = loadManifestSafe(newPath, "nuevo");

  const oldMap = buildEndpointMap(oldManifest.endpoints || []);
  const newMap = buildEndpointMap(newManifest.endpoints || []);

  const report = diffEndpoints(oldMap, newMap);
  const serviceName = newManifest.service || oldManifest.service || "unknown";

  printReport(serviceName, oldManifest.version, newManifest.version, report);

  if (report.breaking.length > 0) {
    process.exit(1);
  }
}

function loadManifestSafe(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`Error al leer el manifiesto ${label} en ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function buildEndpointMap(endpoints) {
  const map = new Map();
  for (const ep of endpoints) {
    map.set(`${ep.method} ${ep.endpoint}`, ep);
  }
  return map;
}

function diffEndpoints(oldMap, newMap) {
  const added = [];
  const changed = [];
  const breaking = [];
  const removed = [];

  for (const [key, ep] of newMap.entries()) {
    if (!oldMap.has(key)) {
      added.push(ep);
    } else {
      const oldEp = oldMap.get(key);
      const changes = getEndpointChanges(oldEp, ep);
      if (changes.length > 0) {
        changed.push({ endpoint: ep, changes });
        const breakings = getBreakingChanges(oldEp, ep);
        if (breakings.length > 0) {
          breaking.push({ endpoint: ep, breakingChanges: breakings });
        }
      }
    }
  }

  for (const [key, ep] of oldMap.entries()) {
    if (!newMap.has(key)) {
      removed.push(ep);
      breaking.push({
        endpoint: ep,
        breakingChanges: [`El endpoint '${ep.method} ${ep.endpoint}' fue eliminado.`],
      });
    }
  }

  return { added, changed, breaking, removed };
}

function getEndpointChanges(oldEp, newEp) {
  const changes = [];
  if (oldEp.backend_url !== newEp.backend_url) {
    changes.push(`URL backend cambió de '${oldEp.backend_url}' a '${newEp.backend_url}'`);
  }
  if (oldEp.public !== newEp.public) {
    changes.push(`Visibilidad pública cambió de '${oldEp.public}' a '${newEp.public}'`);
  }
  if (JSON.stringify(oldEp.rate_limit) !== JSON.stringify(newEp.rate_limit)) {
    changes.push("Configuración de rate limiting modificada.");
  }
  const oldQ = oldEp.input_query_strings || [];
  const newQ = newEp.input_query_strings || [];
  if (JSON.stringify(oldQ) !== JSON.stringify(newQ)) {
    changes.push("Query strings de entrada modificados.");
  }
  return changes;
}

function getBreakingChanges(oldEp, newEp) {
  const breaking = [];
  if (oldEp.public === true && newEp.public !== true) {
    breaking.push("El endpoint pasó de ser público a requerir autenticación JWT.");
  }
  return breaking;
}

function printReport(serviceName, oldVer, newVer, report) {
  console.log(`\n### Reporte de cambios de manifiesto para el servicio "${serviceName}"`);
  console.log(`Versión antigua: ${oldVer || "N/A"} -> Versión nueva: ${newVer || "N/A"}\n`);

  printBreaking(report.breaking);
  printAdded(report.added);
  printRemoved(report.removed);
  printChanged(report.changed, report.breaking);
}

function printBreaking(breaking) {
  if (breaking.length === 0) {
    console.log("✅ No se detectaron cambios incompatibles (breaking changes).\n");
    return;
  }
  console.error("⚠️  **CAMBIOS INCOMPATIBLES DETECTADOS (BREAKING CHANGES)**:");
  for (const b of breaking) {
    console.error(`- **${b.endpoint.method} ${b.endpoint.endpoint}**:`);
    for (const msg of b.breakingChanges) {
      console.error(`  - ❌ ${msg}`);
    }
  }
  console.error("");
}

function printAdded(added) {
  if (added.length === 0) return;
  console.log("➕ **Endpoints añadidos**:");
  for (const ep of added) {
    console.log(`- \`${ep.method} ${ep.endpoint}\` (Público: ${ep.public ? "Sí" : "No"})`);
  }
  console.log("");
}

function printRemoved(removed) {
  if (removed.length === 0) return;
  console.log("➖ **Endpoints eliminados**:");
  for (const ep of removed) {
    console.log(`- \`${ep.method} ${ep.endpoint}\``);
  }
  console.log("");
}

function printChanged(changed, breaking) {
  if (changed.length === 0) return;
  console.log("📝 **Endpoints modificados**:");
  for (const c of changed) {
    const isBreakingOnly = breaking.some(
      (b) => b.endpoint === c.endpoint && b.breakingChanges.length === c.changes.length
    );
    if (!isBreakingOnly) {
      console.log(`- **${c.endpoint.method} ${c.endpoint.endpoint}**:`);
      for (const msg of c.changes) {
        const isBreakingMsg = breaking.some(
          (b) => b.endpoint === c.endpoint && b.breakingChanges.some((bm) => bm.includes(msg.split(" ")[0]))
        );
        if (!isBreakingMsg) console.log(`  - ${msg}`);
      }
    }
  }
  console.log("");
}
