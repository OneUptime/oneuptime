import {
  REPLAY_RAIL_TAB_KINDS,
  ReplayRailTabId,
  ReplaySignal,
  ReplaySignalKind,
} from "./ReplaySignalTypes";
import {
  REPLAY_SLOW_REQUEST_MS,
  ReplayConsoleSignalDetail,
  ReplayLogSignalDetail,
  ReplayNetworkSignalDetail,
  ReplayPerformanceSignalDetail,
  ReplayServerErrorSignalDetail,
  ReplaySpanSignalDetail,
} from "./ReplaySignals";

/*
 * The rail's filter box and chips, as pure predicates over ReplaySignal.
 *
 * QUERY LANGUAGE. Free text matches a case-insensitive substring of the
 * row's searchable text (title, subtitle, url, message, service, trace id,
 * level...). Tokens narrow by field:
 *
 *   status:500  status:>=400  status:<300  status:5xx  status:failed
 *   level:error  level:warn         console level or log severity
 *   kind:network kind:client-error  a ReplaySignalKind
 *   trace:<id>                      exact trace id (prefix ok, >= 8 chars)
 *   method:post                     request method
 *   url:/api/orders                 substring of the request url
 *   service:payment                 substring of the service name or id
 *
 * Every token and every free-text term must match (AND). Quoted phrases
 * ("card declined") are one term. Unknown tokens are treated as free text
 * so a colon in a log line ("error: timeout") does not silently filter to
 * nothing.
 *
 * CHIPS are per-tab quick filters. Chips within one tab OR together (4xx
 * or 5xx), and the chip set ANDs with the query.
 */

export type ReplayRailStatusOperator = ">=" | ">" | "<=" | "<" | "=";

export type ReplayRailQueryToken =
  | {
      field: "status";
      operator: ReplayRailStatusOperator;
      value: number;
    }
  | { field: "status"; statusClass: number }
  | { field: "status"; failed: true }
  | { field: "level"; value: string }
  | { field: "kind"; value: string }
  | { field: "trace"; value: string }
  | { field: "method"; value: string }
  | { field: "url"; value: string }
  | { field: "service"; value: string };

export interface ReplayRailParsedQuery {
  /* Lower-cased free-text terms; each must appear somewhere. */
  terms: Array<string>;
  tokens: Array<ReplayRailQueryToken>;
}

const TOKEN_FIELDS: ReadonlyArray<string> = [
  "status",
  "level",
  "kind",
  "trace",
  "method",
  "url",
  "service",
];

/* Trace ids are 32 hex chars; a shorter query still identifies one. */
const TRACE_PREFIX_MIN_LENGTH: number = 8;

function splitQuery(query: string): Array<string> {
  const parts: Array<string> = [];
  const pattern: RegExp = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null = pattern.exec(query);

  while (match) {
    const quoted: string | undefined = match[1];
    const bare: string | undefined = match[2];

    if (quoted !== undefined) {
      /* A quoted token keeps its spaces; a field prefix inside quotes is text. */
      if (quoted.trim().length > 0) {
        parts.push(quoted.trim());
      }
    } else if (bare !== undefined) {
      parts.push(bare);
    }

    match = pattern.exec(query);
  }

  return parts;
}

function parseStatusToken(raw: string): ReplayRailQueryToken | null {
  const value: string = raw.trim().toLowerCase();

  if (value === "failed" || value === "0") {
    return { field: "status", failed: true };
  }

  const classMatch: RegExpMatchArray | null = value.match(/^([1-5])xx$/);

  if (classMatch) {
    return { field: "status", statusClass: Number(classMatch[1]) };
  }

  const comparisonMatch: RegExpMatchArray | null = value.match(
    /^(>=|<=|>|<|=)?\s*(\d{3})$/,
  );

  if (comparisonMatch) {
    const operator: ReplayRailStatusOperator =
      (comparisonMatch[1] as ReplayRailStatusOperator | undefined) || "=";

    return {
      field: "status",
      operator: operator,
      value: Number(comparisonMatch[2]),
    };
  }

  return null;
}

export function parseRailQuery(query: string): ReplayRailParsedQuery {
  const parsed: ReplayRailParsedQuery = { terms: [], tokens: [] };

  if (typeof query !== "string" || query.trim().length === 0) {
    return parsed;
  }

  for (const part of splitQuery(query)) {
    const colonIndex: number = part.indexOf(":");

    if (colonIndex > 0 && colonIndex < part.length - 1) {
      const field: string = part.slice(0, colonIndex).toLowerCase();
      const rawValue: string = part.slice(colonIndex + 1);

      if (TOKEN_FIELDS.includes(field)) {
        if (field === "status") {
          const statusToken: ReplayRailQueryToken | null =
            parseStatusToken(rawValue);

          if (statusToken) {
            parsed.tokens.push(statusToken);
            continue;
          }

          /* "status:abc" is not a status filter; treat it as text. */
          parsed.terms.push(part.toLowerCase());
          continue;
        }

        const value: string = rawValue.trim().toLowerCase();

        if (value.length === 0) {
          continue;
        }

        parsed.tokens.push({
          field: field as Exclude<ReplayRailQueryToken["field"], "status">,
          value: value,
        } as ReplayRailQueryToken);
        continue;
      }
    }

    parsed.terms.push(part.toLowerCase());
  }

  return parsed;
}

/* ---- Field readers, tolerant of every kind. ---- */

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getSignalStatus(signal: ReplaySignal): number | null {
  if (signal.kind !== "network") {
    return null;
  }

  const status: unknown = (signal.detail as ReplayNetworkSignalDetail).status;

  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/* Console level or log level, lower-cased ("error", "warn", "info"...). */
export function getSignalLevel(signal: ReplaySignal): string | null {
  if (signal.kind === "console") {
    return (
      readString(
        (signal.detail as ReplayConsoleSignalDetail).level,
      )?.toLowerCase() || null
    );
  }

  if (signal.kind === "log") {
    const level: string | null = readString(
      (signal.detail as ReplayLogSignalDetail).level,
    );

    return level ? level.toLowerCase() : null;
  }

  if (signal.kind === "client-error" || signal.kind === "server-error") {
    return "error";
  }

  return null;
}

/* Level aliases people type versus what the rows carry. */
const LEVEL_ALIASES: Record<string, Array<string>> = {
  error: ["error", "fatal"],
  err: ["error", "fatal"],
  fatal: ["fatal"],
  warn: ["warn", "warning"],
  warning: ["warn", "warning"],
  info: ["info", "information", "log"],
  information: ["info", "information"],
  log: ["log", "info"],
  debug: ["debug"],
  trace: ["trace"],
};

export function getSignalMethod(signal: ReplaySignal): string | null {
  if (signal.kind !== "network") {
    return null;
  }

  return readString((signal.detail as ReplayNetworkSignalDetail).method);
}

export function getSignalUrl(signal: ReplaySignal): string | null {
  if (signal.kind === "network") {
    return readString((signal.detail as ReplayNetworkSignalDetail).url);
  }

  if (signal.kind === "performance") {
    return readString((signal.detail as ReplayPerformanceSignalDetail).url);
  }

  if (signal.kind === "navigation") {
    return readString(signal.detail["to"]);
  }

  return null;
}

export function getSignalServiceText(signal: ReplaySignal): string | null {
  if (
    signal.kind !== "log" &&
    signal.kind !== "span" &&
    signal.kind !== "server-error"
  ) {
    return null;
  }

  const detail:
    | ReplayLogSignalDetail
    | ReplaySpanSignalDetail
    | ReplayServerErrorSignalDetail = signal.detail as
    | ReplayLogSignalDetail
    | ReplaySpanSignalDetail
    | ReplayServerErrorSignalDetail;
  const parts: Array<string> = [];
  const name: string | null = readString(detail.serviceName);
  const id: string | null = readString(detail.serviceId);

  if (name) {
    parts.push(name);
  }

  if (id) {
    parts.push(id);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/*
 * Everything free text can hit. Built per call; the rail memoises the
 * filtered list per (signals, query) so this is not on the hot path.
 */
export function getSignalSearchText(signal: ReplaySignal): string {
  const parts: Array<string> = [signal.kind, signal.title];

  if (signal.subtitle) {
    parts.push(signal.subtitle);
  }

  const detail: Record<string, unknown> = signal.detail;
  const textKeys: Array<string> = [
    "message",
    "body",
    "url",
    "method",
    "level",
    "from",
    "to",
    "selector",
    "text",
    "name",
    "source",
    "location",
    "exceptionType",
    "serviceName",
    "rootName",
    "metric",
    "rating",
    "kind",
  ];

  for (const key of textKeys) {
    const value: unknown = detail[key];

    if (typeof value === "string" && value.length > 0) {
      parts.push(value);
    }
  }

  const status: number | null = getSignalStatus(signal);

  if (status !== null) {
    parts.push(String(status));
  }

  for (const link of Object.values(signal.links)) {
    if (typeof link === "string" && link.length > 0) {
      parts.push(link);
    }
  }

  return parts.join(" ").toLowerCase();
}

function matchesToken(
  signal: ReplaySignal,
  token: ReplayRailQueryToken,
): boolean {
  switch (token.field) {
    case "status": {
      const status: number | null = getSignalStatus(signal);

      if (status === null) {
        return false;
      }

      if ("failed" in token) {
        return status === 0;
      }

      /*
       * Status 0 is "no response at all", not a small number: it must not
       * satisfy status:<400, and only status:failed / status:0 select it.
       */
      if (status === 0) {
        return false;
      }

      if ("statusClass" in token) {
        return Math.floor(status / 100) === token.statusClass;
      }

      switch (token.operator) {
        case ">=":
          return status >= token.value;
        case ">":
          return status > token.value;
        case "<=":
          return status <= token.value;
        case "<":
          return status < token.value;
        default:
          return status === token.value;
      }
    }
    case "level": {
      const level: string | null = getSignalLevel(signal);

      if (!level) {
        return false;
      }

      const accepted: Array<string> = LEVEL_ALIASES[token.value] || [
        token.value,
      ];

      return accepted.includes(level);
    }
    case "kind":
      return signal.kind === token.value;
    case "trace": {
      const traceId: string | undefined = signal.links.traceId;

      if (!traceId) {
        return false;
      }

      const wanted: string = token.value;
      const actual: string = traceId.toLowerCase();

      if (actual === wanted) {
        return true;
      }

      return (
        wanted.length >= TRACE_PREFIX_MIN_LENGTH && actual.startsWith(wanted)
      );
    }
    case "method": {
      const method: string | null = getSignalMethod(signal);

      return method !== null && method.toLowerCase() === token.value;
    }
    case "url": {
      const url: string | null = getSignalUrl(signal);

      return url !== null && url.toLowerCase().includes(token.value);
    }
    case "service": {
      const service: string | null = getSignalServiceText(signal);

      return service !== null && service.toLowerCase().includes(token.value);
    }
    default:
      return true;
  }
}

/* Accepts the raw string or a pre-parsed query (the rail parses once). */
export function matchesSignal(
  signal: ReplaySignal,
  query: string | ReplayRailParsedQuery,
): boolean {
  const parsed: ReplayRailParsedQuery =
    typeof query === "string" ? parseRailQuery(query) : query;

  if (parsed.terms.length === 0 && parsed.tokens.length === 0) {
    return true;
  }

  for (const token of parsed.tokens) {
    if (!matchesToken(signal, token)) {
      return false;
    }
  }

  if (parsed.terms.length === 0) {
    return true;
  }

  const haystack: string = getSignalSearchText(signal);

  for (const term of parsed.terms) {
    if (!haystack.includes(term)) {
      return false;
    }
  }

  return true;
}

/* ---- Chips. ---- */

export type ReplayRailChipId =
  | "console-error"
  | "console-warn"
  | "network-2xx"
  | "network-3xx"
  | "network-4xx"
  | "network-5xx"
  | "network-failed"
  | "network-slow"
  | "network-with-trace"
  | "interactions-frustration"
  | "interactions-custom"
  | "performance-over-budget"
  | "errors-client"
  | "errors-server"
  | "logs-error"
  | "logs-warn"
  | "logs-info"
  | "logs-debug"
  | "traces-with-errors"
  | "traces-slow";

export interface ReplayRailChip {
  id: ReplayRailChipId;
  label: string;
}

/* A trace slower than this earns the "slow" chip on the Traces tab. */
export const REPLAY_SLOW_TRACE_MS: number = 1000;

export const REPLAY_RAIL_CHIPS: Record<
  ReplayRailTabId,
  ReadonlyArray<ReplayRailChip>
> = {
  all: [],
  console: [
    { id: "console-error", label: "error" },
    { id: "console-warn", label: "warn" },
  ],
  network: [
    { id: "network-2xx", label: "2xx" },
    { id: "network-3xx", label: "3xx" },
    { id: "network-4xx", label: "4xx" },
    { id: "network-5xx", label: "5xx" },
    { id: "network-failed", label: "failed" },
    { id: "network-slow", label: "slow (>1s)" },
    { id: "network-with-trace", label: "with trace" },
  ],
  navigation: [],
  interactions: [
    { id: "interactions-frustration", label: "frustration" },
    { id: "interactions-custom", label: "custom" },
  ],
  performance: [{ id: "performance-over-budget", label: "over budget" }],
  errors: [
    { id: "errors-client", label: "client" },
    { id: "errors-server", label: "server" },
  ],
  logs: [
    { id: "logs-error", label: "error" },
    { id: "logs-warn", label: "warn" },
    { id: "logs-info", label: "info" },
    { id: "logs-debug", label: "debug" },
  ],
  traces: [
    { id: "traces-with-errors", label: "with errors" },
    { id: "traces-slow", label: "slow (>1s)" },
  ],
};

export function matchesChip(
  signal: ReplaySignal,
  chipId: ReplayRailChipId,
): boolean {
  switch (chipId) {
    case "console-error":
      return signal.kind === "console" && getSignalLevel(signal) === "error";
    case "console-warn":
      return signal.kind === "console" && getSignalLevel(signal) === "warn";
    case "network-2xx":
    case "network-3xx":
    case "network-4xx":
    case "network-5xx": {
      const status: number | null = getSignalStatus(signal);
      const wanted: number = Number(chipId.charAt("network-".length));

      return status !== null && Math.floor(status / 100) === wanted;
    }
    case "network-failed":
      return getSignalStatus(signal) === 0;
    case "network-slow": {
      if (signal.kind !== "network") {
        return false;
      }

      const durationMs: unknown = (signal.detail as ReplayNetworkSignalDetail)
        .durationMs;

      return (
        typeof durationMs === "number" && durationMs > REPLAY_SLOW_REQUEST_MS
      );
    }
    case "network-with-trace":
      return signal.kind === "network" && Boolean(signal.links.traceId);
    case "interactions-frustration":
      return signal.kind === "frustration";
    case "interactions-custom":
      return signal.kind === "custom";
    case "performance-over-budget":
      return (
        signal.kind === "performance" &&
        (signal.detail as ReplayPerformanceSignalDetail).isOverBudget === true
      );
    case "errors-client":
      return signal.kind === "client-error";
    case "errors-server":
      return signal.kind === "server-error";
    case "logs-error":
      return (
        signal.kind === "log" &&
        ["error", "fatal"].includes(getSignalLevel(signal) || "")
      );
    case "logs-warn":
      return signal.kind === "log" && getSignalLevel(signal) === "warn";
    case "logs-info":
      return signal.kind === "log" && getSignalLevel(signal) === "info";
    case "logs-debug":
      return (
        signal.kind === "log" &&
        ["debug", "trace"].includes(getSignalLevel(signal) || "")
      );
    case "traces-with-errors":
      return (
        signal.kind === "span" &&
        (signal.detail as ReplaySpanSignalDetail).hasError === true
      );
    case "traces-slow": {
      if (signal.kind !== "span") {
        return false;
      }

      const durationMs: unknown = (signal.detail as ReplaySpanSignalDetail)
        .durationMs;

      return (
        typeof durationMs === "number" && durationMs > REPLAY_SLOW_TRACE_MS
      );
    }
    default:
      return true;
  }
}

/* ---- Tab routing and the combined filter. ---- */

export function isSignalInTab(
  signal: ReplaySignal,
  tabId: ReplayRailTabId,
): boolean {
  const kinds: ReadonlyArray<ReplaySignalKind> | undefined =
    REPLAY_RAIL_TAB_KINDS[tabId];

  return kinds ? kinds.includes(signal.kind) : false;
}

export interface ReplayRailScope {
  fromMs: number;
  toMs: number;
}

/* "+-30s around playhead" scope toggle. */
export const REPLAY_RAIL_PLAYHEAD_SCOPE_RADIUS_MS: number = 30 * 1000;

export function makePlayheadScope(
  currentTimeMs: number,
  radiusMs: number = REPLAY_RAIL_PLAYHEAD_SCOPE_RADIUS_MS,
): ReplayRailScope {
  return {
    fromMs: Math.max(0, currentTimeMs - radiusMs),
    toMs: currentTimeMs + radiusMs,
  };
}

/* A trace overlaps the scope when any part of its duration is inside it. */
export function isSignalInScope(
  signal: ReplaySignal,
  scope: ReplayRailScope,
): boolean {
  const endMs: number =
    typeof signal.endOffsetMs === "number" &&
    Number.isFinite(signal.endOffsetMs)
      ? Math.max(signal.endOffsetMs, signal.offsetMs)
      : signal.offsetMs;

  return endMs >= scope.fromMs && signal.offsetMs <= scope.toMs;
}

export interface ReplayRailFilterOptions {
  query?: string | ReplayRailParsedQuery | undefined;
  /* Active chips; those that do not belong to the tab are ignored. */
  chips?: Array<ReplayRailChipId> | undefined;
  scope?: ReplayRailScope | null | undefined;
}

/*
 * The rows a tab shows, in input order: tab kinds AND scope AND (any active
 * chip of this tab) AND the query.
 */
export function signalsForTab(
  signals: Array<ReplaySignal>,
  tabId: ReplayRailTabId,
  options?: ReplayRailFilterOptions,
): Array<ReplaySignal> {
  const parsedQuery: ReplayRailParsedQuery | null = options?.query
    ? typeof options.query === "string"
      ? parseRailQuery(options.query)
      : options.query
    : null;
  const tabChipIds: Set<ReplayRailChipId> = new Set<ReplayRailChipId>(
    REPLAY_RAIL_CHIPS[tabId].map((chip: ReplayRailChip): ReplayRailChipId => {
      return chip.id;
    }),
  );
  const activeChips: Array<ReplayRailChipId> = (options?.chips || []).filter(
    (chipId: ReplayRailChipId): boolean => {
      return tabChipIds.has(chipId);
    },
  );
  const scope: ReplayRailScope | null = options?.scope || null;

  return signals.filter((signal: ReplaySignal): boolean => {
    if (!isSignalInTab(signal, tabId)) {
      return false;
    }

    if (scope && !isSignalInScope(signal, scope)) {
      return false;
    }

    if (activeChips.length > 0) {
      const anyChip: boolean = activeChips.some(
        (chipId: ReplayRailChipId): boolean => {
          return matchesChip(signal, chipId);
        },
      );

      if (!anyChip) {
        return false;
      }
    }

    if (parsedQuery && !matchesSignal(signal, parsedQuery)) {
      return false;
    }

    return true;
  });
}

/* Row counts per tab for the tab badges (before query/chips). */
export function countSignalsByTab(
  signals: Array<ReplaySignal>,
): Record<ReplayRailTabId, number> {
  const counts: Record<ReplayRailTabId, number> = {
    all: 0,
    console: 0,
    network: 0,
    navigation: 0,
    interactions: 0,
    performance: 0,
    errors: 0,
    logs: 0,
    traces: 0,
  };

  for (const signal of signals) {
    for (const tabId of Object.keys(counts) as Array<ReplayRailTabId>) {
      if (isSignalInTab(signal, tabId)) {
        counts[tabId]++;
      }
    }
  }

  return counts;
}
