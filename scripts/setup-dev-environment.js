#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const net = require("net");

const PROJECT_ROOT = path.join(__dirname, "..");
const PORTS_FILE = path.join(PROJECT_ROOT, ".dev-ports.json");
const DEV_ASSETS_SEED = path.join(PROJECT_ROOT, "dev_assets_seed");
const DEV_ASSETS = path.join(PROJECT_ROOT, "dev_assets");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");
const ENV_EXAMPLE_FILE = path.join(PROJECT_ROOT, ".env.example");

/**
 * Parse a single env file for a key, return the value or null.
 */
function readEnvFromFile(filePath, key) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const k = trimmed.slice(0, eqIdx).trim();
      if (k === key) return trimmed.slice(eqIdx + 1).replace(/^["']|["']$/g, "");
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * Read a port value: process.env → .env → .env.example → fallback.
 */
function envInt(key, fallback) {
  // 1. Already set in environment (e.g. via CLI)
  if (process.env[key]) return parseInt(process.env[key], 10);

  // 2. User's personal .env (not committed)
  const envVal = readEnvFromFile(ENV_FILE, key);
  if (envVal) return parseInt(envVal, 10);

  // 3. Project template .env.example (committed)
  const exampleVal = readEnvFromFile(ENV_EXAMPLE_FILE, key);
  if (exampleVal) return parseInt(exampleVal, 10);

  return fallback;
}

// Port defaults — edit .env to customize, NOT this file.
const DEFAULT_FRONTEND = envInt("FRONTEND_PORT", 3001);
const DEFAULT_BACKEND = envInt("BACKEND_PORT", 3002);
const DEFAULT_PREVIEW_PROXY = envInt("PREVIEW_PROXY_PORT", 3003);

/**
 * Check if a port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "localhost" });
    sock.on("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
  });
}

/**
 * Ensure a port is available, throw if not.
 */
async function requirePort(port, label) {
  if (!(await isPortAvailable(port))) {
    const msg = `Port ${port} (${label}) is already in use. Stop the conflicting process and try again.`;
    console.error(msg);
    throw new Error(msg);
  }
  return port;
}

/**
 * Load existing ports from file
 */
function loadPorts() {
  try {
    if (fs.existsSync(PORTS_FILE)) {
      const data = fs.readFileSync(PORTS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("Failed to load existing ports:", error.message);
  }
  return null;
}

/**
 * Save ports to file
 */
function savePorts(ports) {
  try {
    fs.writeFileSync(PORTS_FILE, JSON.stringify(ports, null, 2));
  } catch (error) {
    console.error("Failed to save ports:", error.message);
    throw error;
  }
}

/**
 * Allocate ports for development (fixed defaults, fail on conflict).
 */
async function allocatePorts() {
  // PORT env override: PORT for frontend, +1 for backend, +2 for preview
  if (process.env.PORT) {
    const frontendPort = parseInt(process.env.PORT, 10);
    const backendPort = frontendPort + 1;
    const previewProxyPort = backendPort + 1;

    await requirePort(frontendPort, "frontend");
    await requirePort(backendPort, "backend");
    await requirePort(previewProxyPort, "preview proxy");

    const ports = {
      frontend: frontendPort,
      backend: backendPort,
      preview_proxy: previewProxyPort,
      timestamp: new Date().toISOString(),
    };

    savePorts(ports);
    return ports;
  }

  // Reuse saved ports if still available
  const existingPorts = loadPorts();
  if (existingPorts) {
    const frontOk = await isPortAvailable(existingPorts.frontend);
    const backOk = await isPortAvailable(existingPorts.backend);
    const proxyOk = await isPortAvailable(existingPorts.preview_proxy);

    if (frontOk && backOk && proxyOk) {
      return existingPorts;
    }

    const taken = [];
    if (!frontOk) taken.push(`frontend:${existingPorts.frontend}`);
    if (!backOk) taken.push(`backend:${existingPorts.backend}`);
    if (!proxyOk) taken.push(`preview_proxy:${existingPorts.preview_proxy}`);
    console.error(
      `Saved ports are no longer available: ${taken.join(", ")}. ` +
      `Stop the conflicting process(es) or run "node scripts/setup-dev-environment.js clear" to reset.`
    );
    throw new Error("Port conflict");
  }

  // First run: use fixed defaults
  await requirePort(DEFAULT_FRONTEND, "frontend");
  await requirePort(DEFAULT_BACKEND, "backend");
  await requirePort(DEFAULT_PREVIEW_PROXY, "preview proxy");

  const ports = {
    frontend: DEFAULT_FRONTEND,
    backend: DEFAULT_BACKEND,
    preview_proxy: DEFAULT_PREVIEW_PROXY,
    timestamp: new Date().toISOString(),
  };

  savePorts(ports);

  return ports;
}

/**
 * Get ports (allocate if needed)
 */
async function getPorts() {
  const ports = await allocatePorts();
  copyDevAssets();
  return ports;
}

/**
 * Copy dev_assets_seed to dev_assets
 */
function copyDevAssets() {
  try {
    if (!fs.existsSync(DEV_ASSETS)) {
      // Copy dev_assets_seed to dev_assets
      fs.cpSync(DEV_ASSETS_SEED, DEV_ASSETS, { recursive: true });

      if (process.argv[2] === "get") {
        console.log("Copied dev_assets_seed to dev_assets");
      }
    }
  } catch (error) {
    console.error("Failed to copy dev assets:", error.message);
  }
}

/**
 * Clear saved ports
 */
function clearPorts() {
  try {
    if (fs.existsSync(PORTS_FILE)) {
      fs.unlinkSync(PORTS_FILE);
      console.log("Cleared saved dev ports");
    } else {
      console.log("No saved ports to clear");
    }
  } catch (error) {
    console.error("Failed to clear ports:", error.message);
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case "get":
      getPorts()
        .then((ports) => {
          console.log(JSON.stringify(ports));
        })
        .catch(console.error);
      break;

    case "clear":
      clearPorts();
      break;

    case "frontend":
      getPorts()
        .then((ports) => {
          console.log(JSON.stringify(ports.frontend, null, 2));
        })
        .catch(console.error);
      break;

    case "backend":
      getPorts()
        .then((ports) => {
          console.log(JSON.stringify(ports.backend, null, 2));
        })
        .catch(console.error);
      break;

    case "preview_proxy":
      getPorts()
        .then((ports) => {
          console.log(JSON.stringify(ports.preview_proxy, null, 2));
        })
        .catch(console.error);
      break;

    default:
      console.log("Usage:");
      console.log(
        "  node setup-dev-environment.js get           - Setup dev environment (ports + assets)"
      );
      console.log(
        "  node setup-dev-environment.js frontend      - Get frontend port only"
      );
      console.log(
        "  node setup-dev-environment.js backend       - Get backend port only"
      );
      console.log(
        "  node setup-dev-environment.js preview_proxy - Get preview proxy port only"
      );
      console.log(
        "  node setup-dev-environment.js clear         - Clear saved ports"
      );
      break;
  }
}

module.exports = { getPorts, clearPorts };
