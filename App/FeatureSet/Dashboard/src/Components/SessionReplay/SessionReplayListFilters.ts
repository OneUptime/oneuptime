import { JSONObject } from "Common/Types/JSON";

/*
 * The list's filter model and its two translations: UI state -> the
 * /telemetry/rum/session-replay/list endpoint's filter object, and UI
 * state <-> the URL query string.
 *
 * Plain dependency-free TypeScript, deliberately outside the table
 * component: misspell one endpoint field name here and the filter silently
 * matches nothing (the endpoint ignores unknown keys), so this has to be
 * pinned by tests that need no React and no Common/UI.
 */

export interface SessionReplayAdvancedFilters {
  browserName: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  identifiedUserKey: string;
  route: string;
  minDurationSeconds: string;
  triggerReason: string;
}

export const EMPTY_ADVANCED_FILTERS: SessionReplayAdvancedFilters = {
  browserName: "",
  osName: "",
  deviceType: "",
  countryCode: "",
  identifiedUserKey: "",
  route: "",
  minDurationSeconds: "",
  triggerReason: "",
};

export const SESSION_REPLAY_SIGNALS: Array<string> = [
  "all",
  "errors",
  "frustration",
];

/*
 * Filter state <-> URL query string keys. Persisted so back-navigation
 * from a replay restores the triage the viewer had built, and so a
 * filtered list is a shareable link.
 */
export const FILTER_URL_KEYS: Record<
  keyof SessionReplayAdvancedFilters,
  string
> = {
  browserName: "browser",
  osName: "os",
  deviceType: "device",
  countryCode: "country",
  identifiedUserKey: "userKey",
  route: "route",
  minDurationSeconds: "minDuration",
  triggerReason: "trigger",
};

export function hasAnyAdvancedFilter(
  filters: SessionReplayAdvancedFilters,
): boolean {
  return Object.values(filters).some((value: string): boolean => {
    return value.trim().length > 0;
  });
}

/*
 * Translates the signal buttons and field filters into the endpoint's
 * filter object. Every predicate is server-side — "frustration" included,
 * so the filter applies to the whole table rather than to whichever page
 * happened to be fetched.
 */
export function buildSessionReplayListFilters(
  signal: string,
  advanced?: SessionReplayAdvancedFilters,
): JSONObject {
  const filters: JSONObject = {};

  if (signal === "errors") {
    filters["hasError"] = true;
  }

  if (signal === "frustration") {
    filters["hasFrustration"] = true;
  }

  if (advanced) {
    if (advanced.browserName.trim()) {
      filters["browserNames"] = [advanced.browserName.trim()];
    }

    if (advanced.osName.trim()) {
      filters["osNames"] = [advanced.osName.trim()];
    }

    if (advanced.deviceType.trim()) {
      filters["deviceTypes"] = [advanced.deviceType.trim()];
    }

    if (advanced.countryCode.trim()) {
      filters["countryCodes"] = [advanced.countryCode.trim().toUpperCase()];
    }

    if (advanced.identifiedUserKey.trim()) {
      filters["identifiedUserKey"] = advanced.identifiedUserKey.trim();
    }

    if (advanced.route.trim()) {
      filters["route"] = advanced.route.trim();
    }

    const minDurationSeconds: number = parseFloat(advanced.minDurationSeconds);

    if (Number.isFinite(minDurationSeconds) && minDurationSeconds > 0) {
      filters["minDurationMs"] = Math.round(minDurationSeconds * 1000);
    }

    if (advanced.triggerReason.trim()) {
      filters["triggerReasons"] = [advanced.triggerReason.trim()];
    }
  }

  return filters;
}

export function readFiltersFromSearch(search: string): {
  signal: string;
  advanced: SessionReplayAdvancedFilters;
} {
  const params: URLSearchParams = new URLSearchParams(search);

  const advanced: SessionReplayAdvancedFilters = { ...EMPTY_ADVANCED_FILTERS };

  for (const field of Object.keys(FILTER_URL_KEYS) as Array<
    keyof SessionReplayAdvancedFilters
  >) {
    advanced[field] = params.get(FILTER_URL_KEYS[field]) || "";
  }

  const signal: string = params.get("signal") || "all";

  return {
    signal: SESSION_REPLAY_SIGNALS.includes(signal) ? signal : "all",
    advanced: advanced,
  };
}

/*
 * The given href with the filter state stamped into its query string.
 * Pure — the caller owns history.replaceState — so a round trip is
 * testable without a browser.
 */
export function buildFilteredUrl(
  href: string,
  signal: string,
  advanced: SessionReplayAdvancedFilters,
): string {
  const url: URL = new URL(href);

  if (signal && signal !== "all") {
    url.searchParams.set("signal", signal);
  } else {
    url.searchParams.delete("signal");
  }

  for (const field of Object.keys(FILTER_URL_KEYS) as Array<
    keyof SessionReplayAdvancedFilters
  >) {
    const value: string = advanced[field].trim();

    if (value) {
      url.searchParams.set(FILTER_URL_KEYS[field], value);
    } else {
      url.searchParams.delete(FILTER_URL_KEYS[field]);
    }
  }

  return url.toString();
}
