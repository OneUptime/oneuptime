import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * Sanitizers for the publicly-creatable attribution jsonb columns on User
 * (clickIds, firstTouchAttribution). Unauthenticated signup can submit these,
 * so — unlike the varchar(500)-bounded utm columns — they must be whitelisted
 * and size-bounded here before they are persisted, copied onto projects, and
 * forwarded to analytics.
 */

const MAX_VALUE_LENGTH: number = 500;

const CLICK_ID_KEYS: Array<string> = [
  "gclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "li_fat_id",
  "twclid",
  "rdt_cid",
];

const FIRST_TOUCH_STRING_KEYS: Array<string> = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "landingUrl",
  "referrer",
  "timestamp",
];

type SanitizeStringValueFunction = (value: JSONValue) => string | null;

const sanitizeStringValue: SanitizeStringValueFunction = (
  value: JSONValue,
): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value.slice(0, MAX_VALUE_LENGTH);
  }

  if (typeof value === "number") {
    return value.toString().slice(0, MAX_VALUE_LENGTH);
  }

  return null;
};

export default class Attribution {
  // Whitelist known ad-platform click id keys; bound each value to 500 chars.
  public static sanitizeClickIds(value: JSONValue): JSONObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const input: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const key of CLICK_ID_KEYS) {
      const sanitized: string | null = sanitizeStringValue(input[key]);
      if (sanitized) {
        result[key] = sanitized;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  // Whitelist the first-touch shape written by the marketing site.
  public static sanitizeFirstTouchAttribution(
    value: JSONValue,
  ): JSONObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const input: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const key of FIRST_TOUCH_STRING_KEYS) {
      const sanitized: string | null = sanitizeStringValue(input[key]);
      if (sanitized) {
        result[key] = sanitized;
      }
    }

    const clickIds: JSONObject | undefined = this.sanitizeClickIds(
      input["clickIds"],
    );

    if (clickIds) {
      result["clickIds"] = clickIds;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }
}
