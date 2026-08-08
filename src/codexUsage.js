import { getCodexBearerAuth } from "./auth.js";

function normalizeWindow(window) {
  if (!window) return null;

  const usedPercent = Number(window.used_percent ?? 0);
  const windowSeconds = Number(window.limit_window_seconds ?? 0);
  const windowMinutes =
    window.window_minutes ??
    (Number.isFinite(windowSeconds) && windowSeconds > 0
      ? Math.ceil(windowSeconds / 60)
      : null);

  return {
    used_percent: usedPercent,
    remaining_percent: Math.max(0, 100 - usedPercent),
    window_minutes: windowMinutes,
    reset_at: window.reset_at ?? null,
    reset_after_seconds: window.reset_after_seconds ?? null,
  };
}

function normalizeWindowCandidate(rawWindow, source) {
  if (!rawWindow) return null;

  const normalized = normalizeWindow(rawWindow);
  if (!normalized) return null;

  return {
    source,
    ...normalized,
  };
}

const FIVE_HOUR_MINUTES = 300;
const WEEKLY_MINUTES = 10_080;
const FIVE_HOUR_TOLERANCE = 15;
const WEEKLY_TOLERANCE = 504;

function classifyWindow(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  if (Math.abs(minutes - FIVE_HOUR_MINUTES) <= FIVE_HOUR_TOLERANCE) {
    return "five_hour";
  }

  if (Math.abs(minutes - WEEKLY_MINUTES) <= WEEKLY_TOLERANCE) {
    return "weekly";
  }

  return null;
}

function firstSome(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function formatResetTime(epochSeconds, includeDate) {
  if (!epochSeconds) return null;

  const date = new Date(Number(epochSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;

  const time = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  if (!includeDate) return time;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} - ${time}`;
}

function normalizeLimitStatus(status) {
  if (!status) return "OK";

  if (typeof status === "string") {
    return status.toLowerCase() === "unknown" ? "OK" : status;
  }

  if (typeof status === "object") {
    const type = status.type ?? status.kind ?? status.code ?? status.state;
    const details = status.details ?? status.reason ?? status.message;
    if (!type) return "OK";
    if (!details) return String(type);
    return `${type} (${details})`;
  }

  return String(status) || "OK";
}

export function normalizeSnapshot(payload) {
  const rateLimit = payload.rate_limit ?? payload.rateLimits ?? {};
  const candidateWindows = [
    normalizeWindowCandidate(
      firstSome(rateLimit.primary_window, rateLimit.primary),
      "primary",
    ),
    normalizeWindowCandidate(
      firstSome(rateLimit.secondary_window, rateLimit.secondary),
      "secondary",
    ),
  ].filter(Boolean);

  const assigned = {
    five_hour: null,
    weekly: null,
  };
  const source = {
    five_hour: null,
    weekly: null,
  };

  for (const candidate of candidateWindows) {
    const kind = classifyWindow(candidate.window_minutes);
    if (kind === "five_hour" && !assigned.five_hour) {
      assigned.five_hour = candidate;
      source.five_hour = candidate.source;
      continue;
    }

    if (kind === "weekly" && !assigned.weekly) {
      assigned.weekly = candidate;
      source.weekly = candidate.source;
    }
  }

  return {
    source: "codex_backend",
    captured_at: new Date().toISOString(),
    plan: payload.plan_type ?? payload.planType ?? null,
    limit_id: "codex",
    primary: assigned.five_hour,
    secondary: assigned.weekly,
    five_hour_source: source.five_hour,
    weekly_source: source.weekly,
    raw_primary_window_minutes: candidateWindows[0]?.window_minutes ?? null,
    raw_secondary_window_minutes: candidateWindows[1]?.window_minutes ?? null,
    credits: payload.credits
      ? {
          has_credits: Boolean(payload.credits.has_credits),
          unlimited: Boolean(payload.credits.unlimited),
          balance: payload.credits.balance ?? null,
        }
      : null,
    additional_rate_limits:
      payload.additional_rate_limits ?? payload.additionalRateLimits ?? [],
    rate_limit_reached_type:
      payload.rate_limit_reached_type?.kind ??
      payload.rate_limit_reached_type ??
      null,
  };
}

export async function fetchCodexUsage(config) {
  const auth = await getCodexBearerAuth(config);
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "User-Agent": "codex-ha-bridge",
  };

  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

  const res = await fetch(config.backendUrl, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Codex usage request failed: HTTP ${res.status} ${body}`);
  }

  return normalizeSnapshot(await res.json());
}

export function flattenForMqtt(snapshot) {
  return {
    plan: snapshot.plan,
    captured_at: snapshot.captured_at,
    source: snapshot.source,
    primary_used_percent: snapshot.primary?.used_percent ?? null,
    primary_remaining_percent: snapshot.primary?.remaining_percent ?? null,
    primary_window_minutes: snapshot.primary?.window_minutes ?? null,
    primary_reset_at: snapshot.primary?.reset_at ?? null,
    primary_reset_time: formatResetTime(snapshot.primary?.reset_at, false),
    primary_reset_after_seconds: snapshot.primary?.reset_after_seconds ?? null,
    secondary_used_percent: snapshot.secondary?.used_percent ?? null,
    secondary_remaining_percent: snapshot.secondary?.remaining_percent ?? null,
    secondary_window_minutes: snapshot.secondary?.window_minutes ?? null,
    secondary_reset_at: snapshot.secondary?.reset_at ?? null,
    secondary_reset_time: formatResetTime(snapshot.secondary?.reset_at, true),
    secondary_reset_after_seconds:
      snapshot.secondary?.reset_after_seconds ?? null,
    credits_has_credits: snapshot.credits?.has_credits ?? false,
    credits_unlimited: snapshot.credits?.unlimited ?? false,
    credits_balance: snapshot.credits?.balance ?? null,
    rate_limit_reached_type: normalizeLimitStatus(
      snapshot.rate_limit_reached_type,
    ),
    five_hour_source: snapshot.five_hour_source ?? null,
    weekly_source: snapshot.weekly_source ?? null,
    raw_primary_window_minutes: snapshot.raw_primary_window_minutes ?? null,
    raw_secondary_window_minutes: snapshot.raw_secondary_window_minutes ?? null,
  };
}
