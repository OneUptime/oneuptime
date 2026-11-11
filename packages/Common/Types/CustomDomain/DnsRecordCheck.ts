import { JSONArray, JSONObject } from "../JSON";

/*
 * WHAT ONE DNS RECORD CHECK LOOKED UP, AND WHAT CAME BACK.
 *
 * A custom domain needs two records: a TXT record on the project's domain
 * (example.com), which proves the project owns it, and a CNAME record on the
 * custom domain itself (status.example.com), which points it at this
 * installation. A check that failed used to say only "CNAME is not
 * verified", so nobody could tell whether OneUptime saw no record, the wrong
 * record, or no answer at all (#1521, #1664). Every check now answers with
 * this: the record it looked for, at which name, with which value, and what
 * it found there.
 *
 * Small on purpose, and free of React and of the server: the Dashboard's
 * DNS Setup draws it record by record (each with its own status), the
 * server's messages say it in English (DnsRecordCheckWords), and an
 * installation health check (#6826) can print it.
 */

export enum DnsRecordType {
  CNAME = "CNAME",
  TXT = "TXT",
}

export enum DnsRecordCheckOutcome {
  // The record is there, with the value OneUptime looks for.
  Found = "Found",
  // A record of this type is there, but with another value.
  WrongValue = "WrongValue",
  // The name exists, but has no record of this type.
  NotFound = "NotFound",
  // The name does not exist in DNS at all (NXDOMAIN).
  NameNotFound = "NameNotFound",
  // The lookup got no answer: a timeout, or a DNS server that failed.
  LookupFailed = "LookupFailed",
  /*
   * Not looked up yet: the CNAME of a custom domain is checked once the TXT
   * of its project domain is found, because the custom domain cannot be
   * added before that.
   */
  NotCheckedYet = "NotCheckedYet",
}

export interface DnsRecordCheck {
  type: DnsRecordType;
  // The name OneUptime looked up, such as status.example.com.
  name: string;
  // The value it looked for there.
  expectedValue: string;
  /*
   * What came back, in order: a CNAME chain hop by hop (status.example.com
   * -> alias.example.com -> the target), or every TXT value of the name.
   */
  foundValues: Array<string>;
  outcome: DnsRecordCheckOutcome;
  /*
   * A CNAME that was not found: the addresses the name answered with
   * instead. A name with addresses and no CNAME is usually proxied or
   * flattened by its DNS provider (Cloudflare's orange cloud), which hides
   * the CNAME from everybody who looks it up.
   */
  addresses?: Array<string> | undefined;
  /*
   * A CNAME: whether a request to the name reached this OneUptime (its
   * verification address answered). A name that reaches OneUptime is
   * verified even when its DNS provider hides the CNAME.
   */
  reachedOneUptime?: boolean | undefined;
  /*
   * A CNAME whose request did not reach OneUptime: the HTTP status the name
   * answered with instead (404 from a proxy that does not pass the name
   * on), or undefined when nothing answered.
   */
  httpStatus?: number | undefined;
  // The resolver's code when the lookup failed: ETIMEOUT, ESERVFAIL.
  lookupError?: string | undefined;
  // When it was looked up.
  checkedAt?: Date | undefined;
}

// Whether the record is in place: the one thing a caller decides on.
export const isDnsRecordFound: (check: DnsRecordCheck) => boolean = (
  check: DnsRecordCheck,
): boolean => {
  return check.outcome === DnsRecordCheckOutcome.Found;
};

/*
 * DNS names are compared without case and without the root's trailing dot:
 * a CNAME typed as "statuspage.oneuptime.com." at a DNS provider is the same
 * target as "statuspage.oneuptime.com".
 */
export const normalizeDnsName: (name: string | undefined | null) => string = (
  name: string | undefined | null,
): string => {
  let normalized: string = (name || "").trim().toLowerCase();

  while (normalized.endsWith(".")) {
    normalized = normalized.substring(0, normalized.length - 1);
  }

  return normalized;
};

const OUTCOMES: Array<string> = Object.values(DnsRecordCheckOutcome);
const TYPES: Array<string> = Object.values(DnsRecordType);

export default class DnsRecordCheckJSON {
  public static toJSON(check: DnsRecordCheck): JSONObject {
    const json: JSONObject = {
      type: check.type,
      name: check.name,
      expectedValue: check.expectedValue,
      foundValues: [...check.foundValues],
      outcome: check.outcome,
    };

    if (check.addresses && check.addresses.length > 0) {
      json["addresses"] = [...check.addresses];
    }

    if (check.reachedOneUptime !== undefined) {
      json["reachedOneUptime"] = check.reachedOneUptime;
    }

    if (check.httpStatus !== undefined) {
      json["httpStatus"] = check.httpStatus;
    }

    if (check.lookupError) {
      json["lookupError"] = check.lookupError;
    }

    if (check.checkedAt) {
      json["checkedAt"] = check.checkedAt.toISOString();
    }

    return json;
  }

  /*
   * Reads one check. Anything that is not a check - no known type or
   * outcome, no name - reads as undefined rather than as a guess: a record
   * OneUptime cannot say anything true about is not drawn.
   */
  public static fromJSON(json: unknown): DnsRecordCheck | undefined {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return undefined;
    }

    const item: JSONObject = json as JSONObject;

    const type: unknown = item["type"];
    const outcome: unknown = item["outcome"];
    const name: unknown = item["name"];

    if (
      typeof type !== "string" ||
      !TYPES.includes(type) ||
      typeof outcome !== "string" ||
      !OUTCOMES.includes(outcome) ||
      typeof name !== "string" ||
      !name
    ) {
      return undefined;
    }

    const check: DnsRecordCheck = {
      type: type as DnsRecordType,
      name: name,
      expectedValue:
        typeof item["expectedValue"] === "string"
          ? (item["expectedValue"] as string)
          : "",
      foundValues: DnsRecordCheckJSON.readStrings(item["foundValues"]),
      outcome: outcome as DnsRecordCheckOutcome,
    };

    const addresses: Array<string> = DnsRecordCheckJSON.readStrings(
      item["addresses"],
    );

    if (addresses.length > 0) {
      check.addresses = addresses;
    }

    if (typeof item["reachedOneUptime"] === "boolean") {
      check.reachedOneUptime = item["reachedOneUptime"] as boolean;
    }

    if (
      typeof item["httpStatus"] === "number" &&
      Number.isFinite(item["httpStatus"])
    ) {
      check.httpStatus = item["httpStatus"] as number;
    }

    if (typeof item["lookupError"] === "string" && item["lookupError"]) {
      check.lookupError = item["lookupError"] as string;
    }

    const checkedAt: unknown = item["checkedAt"];

    if (checkedAt instanceof Date && !isNaN(checkedAt.getTime())) {
      check.checkedAt = checkedAt;
    } else if (typeof checkedAt === "string" && checkedAt) {
      const date: Date = new Date(checkedAt);

      if (!isNaN(date.getTime())) {
        check.checkedAt = date;
      }
    }

    return check;
  }

  public static toJSONArray(checks: Array<DnsRecordCheck>): JSONArray {
    return checks.map((check: DnsRecordCheck): JSONObject => {
      return DnsRecordCheckJSON.toJSON(check);
    });
  }

  // Reads a list of checks, leaving out what is not one.
  public static fromJSONArray(json: unknown): Array<DnsRecordCheck> {
    if (!Array.isArray(json)) {
      return [];
    }

    const checks: Array<DnsRecordCheck> = [];

    for (const entry of json) {
      const check: DnsRecordCheck | undefined =
        DnsRecordCheckJSON.fromJSON(entry);

      if (check) {
        checks.push(check);
      }
    }

    return checks;
  }

  private static readStrings(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry: unknown): entry is string => {
      return typeof entry === "string";
    });
  }
}
