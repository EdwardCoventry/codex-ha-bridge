import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadHomeberryMqttTokens() {
  const tokensDir = process.env.HOMEBERRY_TOKENS_DIR || path.resolve(process.cwd(), "..", "homeberry-tokens");
  const tokensPath = path.join(tokensDir, "mqtt.json");
  if (!fs.existsSync(tokensPath)) return {};

  const payload = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  const broker = String(payload.MQTT_BROKER || "").trim();
  const port = String(payload.MQTT_PORT || "1883").trim();
  return {
    url: broker ? `mqtt://${broker}:${port}` : undefined,
    username: payload.MQTT_USERNAME || undefined,
    password: payload.MQTT_PASSWORD || undefined,
  };
}

function defaultCodexHome() {
  return path.join(os.homedir(), ".codex");
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));
  const mqttTokens = loadHomeberryMqttTokens();

  return {
    mqtt: {
      url: process.env.MQTT_URL || mqttTokens.url || "mqtt://homeassistant.local:1883",
      username: process.env.MQTT_USERNAME || mqttTokens.username,
      password: process.env.MQTT_PASSWORD || mqttTokens.password,
      baseTopic: process.env.MQTT_BASE_TOPIC || "codex/usage",
      discoveryPrefix: process.env.HA_DISCOVERY_PREFIX || "homeassistant",
    },
    codex: {
      home: process.env.CODEX_HOME || defaultCodexHome(),
      accessToken: process.env.CODEX_ACCESS_TOKEN || undefined,
      accountId: process.env.CHATGPT_ACCOUNT_ID || undefined,
      backendUrl:
        process.env.CODEX_BACKEND_URL ||
        "https://chatgpt.com/backend-api/wham/usage",
      refreshUrl:
        process.env.CODEX_REFRESH_TOKEN_URL ||
        "https://auth.openai.com/oauth/token",
    },
    device: {
      id: process.env.DEVICE_ID || "codex_usage",
      name: process.env.DEVICE_NAME || "Codex Usage",
    },
    pollSeconds: intEnv("POLL_SECONDS", 60),
  };
}
