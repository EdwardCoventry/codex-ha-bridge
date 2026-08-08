import { loadConfig } from "./config.js";
import { fetchCodexUsage, flattenForMqtt } from "./codexUsage.js";
import {
  createMqttClient,
  publishAvailability,
  publishDiscovery,
  publishState,
} from "./mqttHa.js";

const config = loadConfig();
console.log(`Connecting to MQTT: ${config.mqtt.url}`);
console.log("If the connection succeeds, you will see 'MQTT connected.'.");

const client = createMqttClient(config.mqtt);

let discoveryPublished = false;
let running = false;

client.on("connect", async () => {
  console.log("MQTT connected.");
  try {
    await publishAvailability(client, config, "online");
    await publishDiscovery(client, config);
    discoveryPublished = true;
    await pollOnce();
  } catch (error) {
    console.error(error.message);
  }
});

client.on("error", (error) => {
  console.error(`MQTT error: ${error.message}`);
});

async function pollOnce() {
  if (running) return;
  running = true;

  try {
    if (!discoveryPublished) {
      await publishDiscovery(client, config);
      discoveryPublished = true;
    }

    const usage = await fetchCodexUsage(config.codex);
    const state = flattenForMqtt(usage);
    await publishAvailability(client, config, "online");
    await publishState(client, config, state);
    const fiveHourStatus =
      state.primary_used_percent === null
        ? "5h unavailable"
        : `${state.primary_used_percent}% used`;
    const weeklyStatus =
      state.secondary_used_percent === null
        ? "weekly unavailable"
        : `${state.secondary_used_percent}% used`;

    console.log(`Published Codex usage: ${fiveHourStatus}, weekly ${weeklyStatus}.`);
  } catch (error) {
    await publishAvailability(client, config, "offline").catch(() => {});
    console.error(`Poll failed: ${error.message}`);
  } finally {
    running = false;
  }
}

setInterval(pollOnce, config.pollSeconds * 1000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await publishAvailability(client, config, "offline").catch(() => {});
    client.end();
    process.exit(0);
  });
}
