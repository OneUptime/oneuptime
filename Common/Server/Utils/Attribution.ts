import crypto from "crypto";
import {
  AdClickIdKeys,
  FirstTouchStringKeys,
  MaxAttributionValueLength,
  UtmPropertyKeys,
  UtmUrlPropertyKey,
  UtmWireKeyToPropertyKey,
} from "../../Types/Marketing/Attribution";
import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * Sanitizers for attribution submitted by unauthenticated callers — the signup
 * form and the enterprise licence request form.
 *
 * Everything here is a whitelist, never a denylist. Form bodies are free-form
 * caller content (names, notes, free-text answers), and only the keys named in
 * Common/Types/Marketing/Attribution.ts may be copied into a row that is later
 * forwarded to an ad platform.
 *
 * This file also owns email normalisation and hashing. Meta and Reddit each
 * used to carry a private copy of the hash, and MarketingConversion.emailHash
 * has to agree with all of them or the demo-to-signup identity join silently
 * matches nothing — so there is exactly one definition, tested once.
 */

type SanitizeStringValueFunction = (value: JSONValue) => string | null;

const sanitizeStringValue: SanitizeStringValueFunction = (
  value: JSONValue,
): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value.slice(0, MaxAttributionValueLength);
  }

  if (typeof value === "number") {
    return value.toString().slice(0, MaxAttributionValueLength);
  }

  return null;
};

export interface UtmAttribution {
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  utmTerm?: string | undefined;
  utmContent?: string | undefined;
  utmUrl?: string | undefined;
}

export default class Attribution {
  // Whitelist known ad-platform click id keys; bound each value.
  public static sanitizeClickIds(value: JSONValue): JSONObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const input: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const key of AdClickIdKeys) {
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

    for (const key of FirstTouchStringKeys) {
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

  /*
   * UTM values out of an arbitrary object, accepting either spelling.
   *
   * A URL carries `utm_source`; a JSON body posted by the signup page carries
   * `utmSource`. Both arrive at server doors that write the same columns, so
   * both are read here rather than making each caller remember which shape it
   * is holding. camelCase wins when a caller
   * somehow sends both, because that is the spelling the browser writes
   * deliberately and the snake_case one is the raw URL echo.
   */
  public static sanitizeUtm(value: JSONValue): UtmAttribution {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const input: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const wireKey of Object.keys(UtmWireKeyToPropertyKey)) {
      const propertyKey: string = UtmWireKeyToPropertyKey[wireKey]!;

      const sanitized: string | null =
        sanitizeStringValue(input[propertyKey]) ??
        sanitizeStringValue(input[wireKey]);

      if (sanitized) {
        result[propertyKey] = sanitized;
      }
    }

    const utmUrl: string | null =
      sanitizeStringValue(input[UtmUrlPropertyKey]) ??
      sanitizeStringValue(input["utm_url"]) ??
      sanitizeStringValue(input["landingUrl"]) ??
      sanitizeStringValue(input["landing_url"]);

    if (utmUrl) {
      result[UtmUrlPropertyKey] = utmUrl;
    }

    return result as UtmAttribution;
  }

  // True when anything at all identifies where this visitor came from.
  public static hasAnyAttribution(data: {
    clickIds?: JSONObject | undefined;
    utm?: UtmAttribution | undefined;
  }): boolean {
    if (data.clickIds && Object.keys(data.clickIds).length > 0) {
      return true;
    }

    if (!data.utm) {
      return false;
    }

    return UtmPropertyKeys.some((key: string) => {
      return Boolean((data.utm as JSONObject)[key]);
    });
  }

  /*
   * The form an email is compared and hashed in.
   *
   * Trim and lowercase only — deliberately NOT gmail dot/plus folding. Every
   * ad platform specifies exactly this normalisation before SHA-256, so
   * folding further would produce a digest none of them can match, and the
   * same value is used for OneUptime's own identity join so the two must not
   * diverge.
   */
  public static normalizeEmail(email: string | undefined): string | null {
    if (typeof email !== "string") {
      return null;
    }

    const normalized: string = email.trim().toLowerCase();

    return normalized.length > 0 ? normalized : null;
  }

  /*
   * SHA-256 of the normalised email, hex encoded — the identifier every ad
   * platform's enhanced matching expects, and the key a receiver joins one
   * person's conversions on.
   */
  public static hashEmail(email: string | undefined): string | null {
    const normalized: string | null = this.normalizeEmail(email);

    if (!normalized) {
      return null;
    }

    return crypto.createHash("sha256").update(normalized).digest("hex");
  }
}
