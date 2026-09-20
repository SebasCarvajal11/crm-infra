import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function serviceEndpointsUrl(serviceName, defaultHost) {
  const envName = `KRAKEND_${serviceName.toUpperCase()}_ENDPOINTS_URL`;
  const fallback = `${defaultHost}/api/v1/_gateway/gateway.manifest.json`;
  return (process.env[envName]?.trim() || fallback).replace(/\/+$/, "");
}

export async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function loadServiceEndpointsFromFile(service, defaultHost, baseDir) {
  const hostPath = resolve(baseDir, "..", "..", service.manifestPath);
  const dockerPath = resolve(baseDir, "..", service.manifestPath);

  let rawData;
  try {
    rawData = readFileSync(hostPath, "utf-8");
  } catch {
    try {
      rawData = readFileSync(dockerPath, "utf-8");
    } catch (err) {
      const msg = `No se pudo leer gateway.manifest.json para crm-${service.name} en ${hostPath} ni en ${dockerPath}: ${err.message}`;
      throw new Error(msg);
    }
  }

  const data = JSON.parse(rawData);
  return {
    host: data.service || data.host || defaultHost,
    endpoints: data.endpoints || [],
  };
}

export async function loadServiceEndpoints(service, defaultHost, opts) {
  const { source = "auto", timeoutMs = 5000, baseDir } = opts;

  if (source !== "file") {
    const url = serviceEndpointsUrl(service.name, defaultHost);
    try {
      const data = await fetchJsonWithTimeout(url, timeoutMs);
      return {
        host: data.service || data.host || defaultHost,
        endpoints: data.endpoints || [],
      };
    } catch (err) {
      if (source === "http") {
        throw new Error(`No se pudo descargar gateway.manifest.json de crm-${service.name} desde ${url}: ${err.message}`);
      }
      console.warn(`No se pudo descargar gateway.manifest.json de crm-${service.name} desde ${url}. Se usara fallback por archivo: ${err.message}`);
    }
  }

  return loadServiceEndpointsFromFile(service, defaultHost, baseDir);
}
