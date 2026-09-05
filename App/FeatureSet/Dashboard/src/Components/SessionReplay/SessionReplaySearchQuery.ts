import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH } from "Common/Types/Rum/SessionReplay";
import {
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
  normalizeUrlPrefix,
  parseTagFilter,
  stringifyTagFilter,
} from "./SessionReplayListFilters";

/*
 * The search box grammar: one line of text <-> SessionReplayAdvancedFilters.
 *
 *   user:jane@acme.com  url:/checkout  tag:build=1.4.2  browser:Chrome
 *   os:macOS  device:mobile  country:DE  trigger:error  min:2m  id:<sessionId>
 *
 * Bare text is routed by shape: "/checkout" or "https://..." is a URL
 * prefix, anything with "@" is a user reference, everything else is the
 * server's free-text search (session id prefix, entry/exit URL and route
 * substring, exact trace id, and the user label when the caller may read
 * it). Pure and dependency-free so the whole grammar is pinned by tests
 * that need no React.
 *
 * A URL prefix is anchored before it leaves the box (normalizeUrlPrefix):
 * the endpoint matches it from the START of each address, so "checkout"
 * would silently match nothing. What was applied is reported in warnings.
 *
 * id: is special: it is the one token that is an INTENT rather than a
 * filter. While typing, the id narrows the list by prefix like any other
 * text; on Enter the bar navigates straight to the player. The parser only
 * reports the intent - acting on it is the bar's decision, so a keystroke
 * can never navigate.
 */

export const SESSION_REPLAY_SEARCH_TOKEN_KEYS: ReadonlyArray<string> = [
  "user",
  "url",
  "page",
  "tag",
  "browser",
  "os",
  "device",
  "country",
  "trigger",
  "min",
  "id",
];

/* The recorder mints hex ids; the server's own id checks accept 8-64. */
const SESSION_ID_PATTERN: RegExp = /^[a-f0-9]{16,64}$/i;

const DEVICE_TYPES: ReadonlyArray<string> = ["desktop", "mobile", "tablet"];

const WHOLE_SECONDS_PATTERN: RegExp = /^\d+$/;
const WHITESPACE_PATTERN: RegExp = /\s/;
const ABSOLUTE_URL_PATTERN: RegExp = /^https?:\/\//i;

/*
 * Human spellings of the trigger reasons, so "trigger:slow" and
 * "trigger:always" work. The canonical values are the enum's.
 */
const TRIGGER_ALIASES: Record<string, SessionReplayTriggerReason> = {
  error: SessionReplayTriggerReason.Error,
  errors: SessionReplayTriggerReason.Error,
  frustration: SessionReplayTriggerReason.Frustration,
  rage: SessionReplayTriggerReason.Frustration,
  performance: SessionReplayTriggerReason.Performance,
  slow: SessionReplayTriggerReason.Performance,
  sampled: SessionReplayTriggerReason.Sampled,
  always: SessionReplayTriggerReason.Sampled,
  sample: SessionReplayTriggerReason.Sampled,
  manual: SessionReplayTriggerReason.Manual,
};

/*
 * The one field the grammar does not cover. `route` (exact match against
 * the routes array) predates the box and stays modal-only: it is rare, and
 * a token for it would be indistinguishable from url: to a reader.
 */
export const SEARCH_BOX_UNCOVERED_FIELDS: ReadonlyArray<
  keyof SessionReplayAdvancedFilters
> = ["route"];

export interface SessionReplaySearchParseResult {
  advanced: SessionReplayAdvancedFilters;
  /* Set when an id: token names a plausible session id. Acted on by Enter only. */
  navigateToSessionId: string | null;
  /* One sentence per token that was dropped or rewritten, for the hint line. */
  warnings: Array<string>;
}

export function isLikelySessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value.trim());
}

/*
 * "2m", "90s", "1h30m", "1:30", "120" (seconds) -> seconds, or null when
 * the text is not a duration. Whole seconds: the endpoint takes ms and
 * the list shows nothing finer.
 */
export function parseDurationToken(value: string): number | null {
  const text: string = value.trim().toLowerCase();

  if (!text) {
    return null;
  }

  if (WHOLE_SECONDS_PATTERN.test(text)) {
    return parseInt(text, 10);
  }

  const clockMatch: RegExpMatchArray | null = text.match(/^(\d+):(\d{1,2})$/);

  if (clockMatch) {
    return (
      parseInt(clockMatch[1] as string, 10) * 60 +
      parseInt(clockMatch[2] as string, 10)
    );
  }

  const unitPattern: RegExp = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let total: number = 0;
  let consumed: string = "";
  let match: RegExpExecArray | null = unitPattern.exec(text);

  while (match) {
    const amount: number = parseFloat(match[1] as string);
    const unit: string = match[2] as string;

    total += unit === "h" ? amount * 3600 : unit === "m" ? amount * 60 : amount;
    consumed += match[0];
    match = unitPattern.exec(text);
  }

  if (!consumed || consumed.replace(/\s+/g, "") !== text.replace(/\s+/g, "")) {
    return null;
  }

  return Math.round(total);
}

/* Seconds -> the shortest token that parses back to the same number. */
export function formatDurationToken(seconds: number): string {
  const whole: number = Math.max(0, Math.round(seconds));

  if (whole < 60) {
    return `${whole}s`;
  }

  const hours: number = Math.floor(whole / 3600);
  const minutes: number = Math.floor((whole % 3600) / 60);
  const remaining: number = whole % 60;
  let text: string = "";

  if (hours > 0) {
    text += `${hours}h`;
  }

  if (minutes > 0) {
    text += `${minutes}m`;
  }

  if (remaining > 0) {
    text += `${remaining}s`;
  }

  return text;
}

/* Splits on whitespace, keeping "quoted phrases" together. */
function tokenize(query: string): Array<string> {
  const tokens: Array<string> = [];
  const pattern: RegExp = /(?:[^\s"]+|"[^"]*"?)+/g;
  let match: RegExpExecArray | null = pattern.exec(query);

  while (match) {
    tokens.push(match[0]);
    match = pattern.exec(query);
  }

  return tokens;
}

function unquote(value: string): string {
  const trimmed: string = value.trim();

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.substring(1, trimmed.length - 1);
  }

  if (trimmed.startsWith('"')) {
    return trimmed.substring(1);
  }

  return trimmed;
}

function quoteIfNeeded(value: string): string {
  return WHITESPACE_PATTERN.test(value)
    ? `"${value.replace(/"/g, "")}"`
    : value;
}

function isUrlLike(value: string): boolean {
  return value.startsWith("/") || ABSOLUTE_URL_PATTERN.test(value);
}

/*
 * Parses the box. `base` seeds the fields the box cannot express (see
 * SEARCH_BOX_UNCOVERED_FIELDS) so a keystroke never silently clears a
 * filter that was applied in the modal.
 */
export function parseSessionReplaySearch(
  query: string,
  base?: SessionReplayAdvancedFilters,
): SessionReplaySearchParseResult {
  const advanced: SessionReplayAdvancedFilters = {
    ...EMPTY_ADVANCED_FILTERS,
    ...(base ?? {}),
  };

  /* Every field the grammar covers is rebuilt from the text. */
  for (const key of Object.keys(EMPTY_ADVANCED_FILTERS) as Array<
    keyof SessionReplayAdvancedFilters
  >) {
    if (!SEARCH_BOX_UNCOVERED_FIELDS.includes(key)) {
      advanced[key] = "";
    }
  }

  const warnings: Array<string> = [];
  const searchWords: Array<string> = [];
  const tags: Record<string, string> = {};
  let navigateToSessionId: string | null = null;

  const setOnce: (
    field: keyof SessionReplayAdvancedFilters,
    value: string,
    label: string,
  ) => void = (
    field: keyof SessionReplayAdvancedFilters,
    value: string,
    label: string,
  ): void => {
    if (advanced[field] && advanced[field] !== value) {
      warnings.push(
        `Only one ${label} filter applies at a time; using "${value}".`,
      );
    }

    advanced[field] = value;
  };

  /*
   * The endpoint compares urlPrefix from the START of every route and of
   * the entry URL (and, since the path fix, of their paths), so a value
   * that anchors nowhere - "checkout" - can only ever come back empty.
   * normalizeUrlPrefix anchors it and the box says out loud what it
   * applied, rather than leaving the viewer to conclude the page was never
   * recorded.
   */
  const setUrlPrefix: (value: string) => void = (value: string): void => {
    const normalized: string = normalizeUrlPrefix(value);

    if (normalized !== value.trim()) {
      warnings.push(
        `A URL filter matches from the start of the address, so "${value.trim()}" was applied as "${normalized}". Type a path like /checkout, or paste a full URL to pin one origin.`,
      );
    }

    setOnce("urlPrefix", normalized, "URL");
  };

  for (const rawToken of tokenize(query)) {
    const token: string = rawToken.trim();

    if (!token) {
      continue;
    }

    const separatorIndex: number = token.indexOf(":");
    const key: string =
      separatorIndex > 0
        ? token.substring(0, separatorIndex).toLowerCase()
        : "";
    const isKnownKey: boolean = SESSION_REPLAY_SEARCH_TOKEN_KEYS.includes(key);

    if (!isKnownKey) {
      if (key === "error") {
        /* error:<text> is not a filter the endpoint has; say so, drop it. */
        warnings.push(
          'error: is not a filter. Use the "Errors" quick filter, then search the error text inside the replay.',
        );
        continue;
      }

      const bare: string = unquote(token);

      if (!bare) {
        continue;
      }

      if (isUrlLike(bare)) {
        setUrlPrefix(bare);
      } else if (bare.includes("@")) {
        setOnce("identifiedUserRef", bare, "user");
      } else {
        searchWords.push(bare);
      }

      continue;
    }

    const value: string = unquote(token.substring(separatorIndex + 1));

    if (!value) {
      warnings.push(`${key}: needs a value.`);
      continue;
    }

    switch (key) {
      case "user":
        setOnce("identifiedUserRef", value, "user");
        break;
      case "url":
      case "page":
        setUrlPrefix(value);
        break;
      case "tag": {
        const pair: Record<string, string> = parseTagFilter(value);

        if (Object.keys(pair).length === 0) {
          warnings.push(`tag: takes key=value, not "${value}".`);
          break;
        }

        Object.assign(tags, pair);
        break;
      }
      case "browser":
        setOnce("browserName", value, "browser");
        break;
      case "os":
        setOnce("osName", value, "OS");
        break;
      case "device": {
        const device: string = value.toLowerCase();

        if (!DEVICE_TYPES.includes(device)) {
          warnings.push(
            `device: takes ${DEVICE_TYPES.join(", ")}, not "${value}".`,
          );
          break;
        }

        setOnce("deviceType", device, "device");
        break;
      }
      case "country":
        setOnce("countryCode", value.toUpperCase(), "country");
        break;
      case "trigger": {
        const reason: SessionReplayTriggerReason | undefined =
          TRIGGER_ALIASES[value.toLowerCase()];

        if (!reason) {
          warnings.push(
            `trigger: takes error, frustration, slow, sampled or manual, not "${value}".`,
          );
          break;
        }

        setOnce("triggerReason", reason, "trigger");
        break;
      }
      case "min": {
        const seconds: number | null = parseDurationToken(value);

        if (seconds === null || seconds <= 0) {
          warnings.push(
            `min: takes a duration like 90s or 2m, not "${value}".`,
          );
          break;
        }

        setOnce("minDurationSeconds", String(seconds), "minimum duration");
        break;
      }
      case "id":
        /*
         * A prefix search while typing; a navigation intent once the value
         * is a whole id. Both, so a half-typed id still narrows the list.
         */
        searchWords.push(value);

        if (isLikelySessionId(value)) {
          navigateToSessionId = value.toLowerCase();
        }

        break;
      default:
        break;
    }
  }

  if (Object.keys(tags).length > 0) {
    advanced.tags = stringifyTagFilter(tags);
  }

  const search: string = searchWords.join(" ").trim();

  if (search.length > SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH) {
    warnings.push(
      `Search text is capped at ${SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH} characters.`,
    );
  }

  advanced.search = search.substring(0, SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH);

  return {
    advanced: advanced,
    navigateToSessionId: navigateToSessionId,
    warnings: warnings,
  };
}

/*
 * The box text for a filter state. parse(stringify(x)) yields x for every
 * field the grammar covers, which is what keeps the modal and the box in
 * step: apply in the modal, and the box rewrites itself.
 */
export function stringifySessionReplaySearch(
  advanced: SessionReplayAdvancedFilters,
): string {
  const parts: Array<string> = [];

  if (advanced.identifiedUserRef.trim()) {
    parts.push(`user:${quoteIfNeeded(advanced.identifiedUserRef.trim())}`);
  }

  if (advanced.urlPrefix.trim()) {
    parts.push(`url:${quoteIfNeeded(advanced.urlPrefix.trim())}`);
  }

  const tags: Record<string, string> = parseTagFilter(advanced.tags);

  for (const key of Object.keys(tags)) {
    parts.push(`tag:${quoteIfNeeded(`${key}=${tags[key]}`)}`);
  }

  if (advanced.browserName.trim()) {
    parts.push(`browser:${quoteIfNeeded(advanced.browserName.trim())}`);
  }

  if (advanced.osName.trim()) {
    parts.push(`os:${quoteIfNeeded(advanced.osName.trim())}`);
  }

  if (advanced.deviceType.trim()) {
    parts.push(`device:${advanced.deviceType.trim()}`);
  }

  if (advanced.countryCode.trim()) {
    parts.push(`country:${advanced.countryCode.trim().toUpperCase()}`);
  }

  if (advanced.triggerReason.trim()) {
    parts.push(`trigger:${advanced.triggerReason.trim()}`);
  }

  const minSeconds: number = parseFloat(advanced.minDurationSeconds);

  if (Number.isFinite(minSeconds) && minSeconds > 0) {
    parts.push(`min:${formatDurationToken(minSeconds)}`);
  }

  if (advanced.search.trim()) {
    parts.push(advanced.search.trim());
  }

  return parts.join(" ");
}

/*
 * Merge the box's parse over filters applied elsewhere, so the modal-only
 * field survives a keystroke.
 */
export function mergeSearchIntoFilters(
  parsed: SessionReplayAdvancedFilters,
  existing: SessionReplayAdvancedFilters,
): SessionReplayAdvancedFilters {
  const merged: SessionReplayAdvancedFilters = { ...parsed };

  for (const field of SEARCH_BOX_UNCOVERED_FIELDS) {
    merged[field] = existing[field];
  }

  return merged;
}
