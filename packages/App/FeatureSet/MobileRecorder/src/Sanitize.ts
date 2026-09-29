import {
  SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES,
  SessionReplaySignalCounts,
} from "./Contract";

export const MAX_TRAIT_KEYS: number = 20;
export const MAX_TRAIT_KEY_LENGTH: number = 40;
export const MAX_TRAIT_VALUE_LENGTH: number = 200;
export const MAX_TAG_KEYS: number = 20;
export const MAX_TAG_KEY_LENGTH: number = 32;
export const MAX_TAG_VALUE_LENGTH: number = 128;
export const MAX_CUSTOM_EVENT_NAME_LENGTH: number = 64;
export const MAX_CUSTOM_EVENT_PROPERTY_KEYS: number = 20;
export const MAX_CAPTURE_REASON_LENGTH: number = 80;
export const MAX_USER_REFERENCE_LENGTH: number = 200;

const SAFE_IDENTIFIER_PATTERN: RegExp = /^[A-Za-z0-9._:-]+$/;
const BLOCKED_KEYS: ReadonlySet<string> = new Set<string>([
  "__proto__",
  "constructor",
  "prototype",
]);
const UUID_SEGMENT: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const OBJECT_ID_SEGMENT: RegExp = /^[0-9a-f]{24}$/iu;
const EMAIL_SEGMENT: RegExp = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/u;
const LONG_DIGIT_SEGMENT: RegExp = /^\d{9,}$/u;
const OPAQUE_TOKEN_SEGMENT: RegExp = /^[A-Za-z0-9_-]{32,}$/u;
const ABSOLUTE_URL_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN: RegExp = /[\u0000-\u001F\u007F]/gu;

export function truncate(value: string, length: number): string {
  return value.slice(0, Math.max(0, length));
}

export function sanitizeIdentifier(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maximumLength ||
    !SAFE_IDENTIFIER_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function stringifyPrimitive(value: unknown): string | null {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? String(value) : null;
    case "boolean":
      return value ? "true" : "false";
    default:
      return value === null ? "null" : null;
  }
}

export function sanitizeStringMap(
  value: unknown,
  limits: {
    keys: number;
    keyLength: number;
    valueLength: number;
  },
): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }

  for (const [rawKey, rawValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (Object.keys(result).length >= limits.keys) {
      break;
    }

    const key: string = truncate(rawKey.trim(), limits.keyLength);
    const stringValue: string | null = stringifyPrimitive(rawValue);

    if (!key || BLOCKED_KEYS.has(key) || stringValue === null) {
      continue;
    }

    result[key] = truncate(stringValue, limits.valueLength);
  }

  return result;
}

export function sanitizeTraits(value: unknown): Record<string, string> {
  return sanitizeStringMap(value, {
    keys: MAX_TRAIT_KEYS,
    keyLength: MAX_TRAIT_KEY_LENGTH,
    valueLength: MAX_TRAIT_VALUE_LENGTH,
  });
}

export function sanitizeTags(value: unknown): Record<string, string> {
  return sanitizeStringMap(value, {
    keys: MAX_TAG_KEYS,
    keyLength: MAX_TAG_KEY_LENGTH,
    valueLength: MAX_TAG_VALUE_LENGTH,
  });
}

export function sanitizeEventProperties(
  value: unknown,
): Record<string, string> {
  return sanitizeStringMap(value, {
    keys: MAX_CUSTOM_EVENT_PROPERTY_KEYS,
    keyLength: MAX_TRAIT_KEY_LENGTH,
    valueLength: MAX_TRAIT_VALUE_LENGTH,
  });
}

/* Mirrors Common/Utils/Rum/Masking.maskText without a runtime dependency. */
export function maskTextValue(value: string): string {
  if (!value || value.trim().length === 0) {
    return value;
  }

  const length: number = value.trim().length;
  const maskedLength: number = length <= 8 ? 4 : length <= 32 ? 16 : 40;
  return "•".repeat(maskedLength);
}

export function maskStringMapValues(
  values: Record<string, string>,
): Record<string, string> {
  const masked: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, value] of Object.entries(values)) {
    masked[key] = maskTextValue(value);
  }
  return masked;
}

export function sanitizeRoute(route: unknown): string {
  if (typeof route !== "string") {
    return "/";
  }

  let path: string = route.trim();
  if (!path) {
    return "/";
  }

  try {
    if (ABSOLUTE_URL_PATTERN.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    path = "/";
  }

  path = path.split(/[?#]/u, 1)[0] || "/";
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  path = path
    .split("/")
    .map((segment: string): string => {
      let decoded: string = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = segment;
      }
      return UUID_SEGMENT.test(decoded) ||
        OBJECT_ID_SEGMENT.test(decoded) ||
        EMAIL_SEGMENT.test(decoded) ||
        LONG_DIGIT_SEGMENT.test(decoded) ||
        OPAQUE_TOKEN_SEGMENT.test(decoded)
        ? "[redacted]"
        : segment;
    })
    .join("/");

  return truncate(path.replace(CONTROL_CHARACTER_PATTERN, ""), 2048);
}

export function toAppUrl(mobileAppIdentifier: string, route: string): string {
  return `app://${mobileAppIdentifier}${sanitizeRoute(route)}`;
}

export function emptySignalCounts(): SessionReplaySignalCounts {
  return {
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
    clickCount: 0,
    customEventCount: 0,
  };
}

export function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }

  return unescape(encodeURIComponent(value)).length;
}

export function isPayloadWithinLimit(payload: string): boolean {
  return byteLength(payload) <= SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES;
}
