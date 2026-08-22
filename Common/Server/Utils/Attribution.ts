import { JSONObject, JSONValue } from "../../Types/JSON";
import { AttributionConsentState } from "../../Types/Marketing/AcquisitionAttribution";

const MAX_VALUE_LENGTH: number = 500;
const MAX_URL_LENGTH: number = 1000;

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

const TOUCH_STRING_KEYS: Array<string> = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "channel",
];

const sanitizeStringValue: (value: JSONValue, max?: number) => string | null = (
  value: JSONValue,
  max: number = MAX_VALUE_LENGTH,
): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, max);
  }
  if (typeof value === "number") {
    return value.toString().slice(0, max);
  }
  return null;
};

const sanitizeUrl: (value: JSONValue) => string | null = (
  value: JSONValue,
): string | null => {
  const candidate: string | null = sanitizeStringValue(value, MAX_URL_LENGTH);
  if (!candidate) {
    return null;
  }
  try {
    const parsed: globalThis.URL = new globalThis.URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    CLICK_ID_KEYS.concat([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ]).forEach((key: string) => {
      parsed.searchParams.delete(key);
    });
    return parsed.toString().slice(0, MAX_URL_LENGTH);
  } catch {
    return null;
  }
};

export default class Attribution {
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

  public static sanitizeTouch(value: JSONValue): JSONObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const input: JSONObject = value as JSONObject;
    const result: JSONObject = {};
    for (const key of TOUCH_STRING_KEYS) {
      const sanitized: string | null = sanitizeStringValue(input[key]);
      if (sanitized) {
        result[key] = sanitized;
      }
    }
    const landingPage: string | null = sanitizeUrl(
      input["landingPage"] || input["landingUrl"],
    );
    const referrer: string | null = sanitizeUrl(input["referrer"]);
    const timestamp: string | null = sanitizeStringValue(input["timestamp"]);
    if (landingPage) result["landingPage"] = landingPage;
    if (referrer) result["referrer"] = referrer;
    if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
      result["timestamp"] = new Date(timestamp).toISOString();
    }
    const clickIds: JSONObject | undefined = this.sanitizeClickIds(
      input["clickIds"],
    );
    if (clickIds) result["clickIds"] = clickIds;
    return Object.keys(result).length > 0 ? result : undefined;
  }

  public static sanitizeFirstTouchAttribution(
    value: JSONValue,
  ): JSONObject | undefined {
    return this.sanitizeTouch(value);
  }

  public static sanitizeAcquisitionAttribution(
    value: JSONValue,
  ): JSONObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const input: JSONObject = value as JSONObject;
    const result: JSONObject = {};
    const visitorId: string | null = sanitizeStringValue(
      input["anonymousVisitorId"],
      100,
    );
    if (visitorId && /^[a-zA-Z0-9_-]{16,100}$/.test(visitorId)) {
      result["anonymousVisitorId"] = visitorId;
    }
    const consentState: JSONValue = input["consentState"];
    if (
      consentState === AttributionConsentState.Granted ||
      consentState === AttributionConsentState.Denied ||
      consentState === AttributionConsentState.Unknown
    ) {
      result["consentState"] = consentState;
    }
    for (const key of ["firstTouch", "latestTouch", "latestPaidTouch"]) {
      const touch: JSONObject | undefined = this.sanitizeTouch(input[key]);
      if (touch) result[key] = touch;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
}
