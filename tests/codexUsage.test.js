import assert from "node:assert/strict";
import test from "node:test";

import {
  flattenForMqtt,
  normalizeSnapshot,
} from "../src/codexUsage.js";

const WINDOW_5H = 300;
const WINDOW_WEEKLY = 10_080;

function makeWindow(overrides = {}) {
  return {
    used_percent: 0,
    reset_after_seconds: 60,
    reset_at: 1_786_163_518,
    ...overrides,
  };
}

function withWindowMinutes(windowMinutes, usedPercent = 10) {
  return makeWindow({
    used_percent: usedPercent,
    limit_window_seconds: windowMinutes * 60,
  });
}

function payloadFromWindow(primaryWindow, secondaryWindow, rateLimitReachedType = null) {
  return {
    plan_type: "pro",
    rate_limit_reached_type: rateLimitReachedType,
    rate_limit: {
      primary_window: primaryWindow,
      secondary_window: secondaryWindow,
    },
    credits: { has_credits: true, unlimited: false, balance: "3" },
  };
}

test("normal two-window response maps primary to five-hour and secondary to weekly", () => {
  const snapshot = normalizeSnapshot(
    payloadFromWindow(
      withWindowMinutes(WINDOW_5H + 3, 42),
      withWindowMinutes(WINDOW_WEEKLY, 17),
      { type: "rate_limit_reached", details: "default" },
    ),
  );

  assert.equal(snapshot.five_hour_source, "primary");
  assert.equal(snapshot.weekly_source, "secondary");
  assert.equal(snapshot.primary.used_percent, 42);
  assert.equal(snapshot.secondary.used_percent, 17);
  assert.equal(snapshot.primary.remaining_percent, 58);
  assert.equal(snapshot.secondary.remaining_percent, 83);
  assert.equal(snapshot.raw_primary_window_minutes, WINDOW_5H + 3);
  assert.equal(snapshot.raw_secondary_window_minutes, WINDOW_WEEKLY);
  assert.equal(snapshot.primary.window_minutes, WINDOW_5H + 3);
  assert.equal(snapshot.secondary.window_minutes, WINDOW_WEEKLY);
});

test("disabled 5h response keeps five-hour fields null and maps weekly from raw primary", () => {
  const snapshot = normalizeSnapshot(
    payloadFromWindow(
      withWindowMinutes(WINDOW_WEEKLY, 60),
      null,
      "rate_limit_reached",
    ),
  );

  assert.equal(snapshot.five_hour_source, null);
  assert.equal(snapshot.weekly_source, "primary");
  assert.equal(snapshot.primary, null);
  assert.equal(snapshot.secondary.window_minutes, WINDOW_WEEKLY);
  assert.equal(snapshot.secondary.used_percent, 60);
  assert.equal(snapshot.secondary.remaining_percent, 40);
});

test("weekly window in raw secondary maps to secondary output", () => {
  const snapshot = normalizeSnapshot(
    payloadFromWindow(
      withWindowMinutes(WINDOW_5H, 34),
      withWindowMinutes(WINDOW_WEEKLY + 20, 87),
      null,
    ),
  );

  assert.equal(snapshot.five_hour_source, "primary");
  assert.equal(snapshot.weekly_source, "secondary");
  assert.equal(snapshot.primary.window_minutes, WINDOW_5H);
  assert.equal(snapshot.secondary.window_minutes, WINDOW_WEEKLY + 20);
  assert.equal(snapshot.secondary.used_percent, 87);
  assert.equal(snapshot.secondary.remaining_percent, 13);
});

test("unknown duration is not mapped to five-hour or weekly", () => {
  const snapshot = normalizeSnapshot(
    payloadFromWindow(
      withWindowMinutes(120),
      withWindowMinutes(240),
      undefined,
    ),
  );

  assert.equal(snapshot.five_hour_source, null);
  assert.equal(snapshot.weekly_source, null);
  assert.equal(snapshot.primary, null);
  assert.equal(snapshot.secondary, null);
});

test("derive duration from limit_window_seconds when window_minutes is missing", () => {
  const snapshot = normalizeSnapshot({
    plan_type: "pro",
    rate_limit: {
      primary_window: {
        used_percent: 57,
        limit_window_seconds: 300 * 60,
        reset_after_seconds: 42,
      },
      secondary_window: {
        used_percent: 13,
        limit_window_seconds: 10_080 * 60,
        reset_after_seconds: 42,
      },
    },
  });

  assert.equal(snapshot.five_hour_source, "primary");
  assert.equal(snapshot.weekly_source, "secondary");
  assert.equal(snapshot.primary.window_minutes, WINDOW_5H);
  assert.equal(snapshot.secondary.window_minutes, WINDOW_WEEKLY);
  assert.equal(snapshot.primary.used_percent, 57);
  assert.equal(snapshot.secondary.used_percent, 13);
});

test("object-valued rate limit status flattens to readable string", () => {
  const state = flattenForMqtt(
    normalizeSnapshot(
      payloadFromWindow(
        withWindowMinutes(WINDOW_5H),
        withWindowMinutes(WINDOW_WEEKLY),
        { type: "rate_limit_reached", details: "default" },
      ),
    ),
  );

  assert.equal(state.rate_limit_reached_type, "rate_limit_reached (default)");
});

test("null rate limit status flattens to OK", () => {
  const state = flattenForMqtt(
    normalizeSnapshot(payloadFromWindow(withWindowMinutes(WINDOW_5H), null)),
  );

  assert.equal(state.rate_limit_reached_type, "OK");
});

test("remaining percentage equals 100 - used but not below zero", () => {
  const state = flattenForMqtt(
    normalizeSnapshot(
      payloadFromWindow(
        {
          ...withWindowMinutes(WINDOW_5H),
          used_percent: 130,
        },
        {
          ...withWindowMinutes(WINDOW_WEEKLY),
          used_percent: -12,
        },
      ),
    ),
  );

  assert.equal(state.primary_used_percent, 130);
  assert.equal(state.primary_remaining_percent, 0);
  assert.equal(state.secondary_used_percent, -12);
  assert.equal(state.secondary_remaining_percent, 112);
});
