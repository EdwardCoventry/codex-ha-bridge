import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("loads MQTT connection values from Homeberry mqtt.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-ha-bridge-config-"));
  const appDir = path.join(root, "codex-ha-bridge");
  const tokensDir = path.join(root, "homeberry-tokens");
  await fs.mkdir(appDir);
  await fs.mkdir(tokensDir);
  await fs.writeFile(
    path.join(tokensDir, "mqtt.json"),
    JSON.stringify({
      MQTT_BROKER: "mqtt.test.local",
      MQTT_PORT: 1884,
      MQTT_USERNAME: "bridge-user",
      MQTT_PASSWORD: "test-password",
    }),
  );

  const previousCwd = process.cwd();
  const previousTokensDir = process.env.HOMEBERRY_TOKENS_DIR;
  const previousMqttUrl = process.env.MQTT_URL;
  const previousUsername = process.env.MQTT_USERNAME;
  const previousPassword = process.env.MQTT_PASSWORD;
  try {
    process.chdir(appDir);
    delete process.env.HOMEBERRY_TOKENS_DIR;
    delete process.env.MQTT_URL;
    delete process.env.MQTT_USERNAME;
    delete process.env.MQTT_PASSWORD;
    const config = loadConfig();
    assert.equal(config.mqtt.url, "mqtt://mqtt.test.local:1884");
    assert.equal(config.mqtt.username, "bridge-user");
    assert.equal(config.mqtt.password, "test-password");
  } finally {
    process.chdir(previousCwd);
    for (const [name, value] of [
      ["HOMEBERRY_TOKENS_DIR", previousTokensDir],
      ["MQTT_URL", previousMqttUrl],
      ["MQTT_USERNAME", previousUsername],
      ["MQTT_PASSWORD", previousPassword],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
