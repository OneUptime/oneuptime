import { JSONObject } from "../JSON";

/*
 * A security advisory OneUptime published on GitHub for OneUptime/oneuptime,
 * as this installation keeps it (GlobalConfig.securityAdvisories): only what
 * the Admin Dashboard's notice, the footer and the email show, and what is
 * needed to tell whether the running version is affected. The daily update
 * check (Workers/Jobs/InstanceUpdate) reads GitHub's answer into this shape,
 * so nothing GitHub sends is stored or shown as it came.
 *
 * Every value is checked and capped on the way in and again on the way out
 * (fromJSON), since the stored JSON is read back by the API that the
 * frontends render: an advisory's link is only ever an https://github.com
 * address, its identifiers have GitHub's shape, and its text is plain and
 * short.
 */

export enum SecurityAdvisorySeverity {
  Critical = "critical",
  High = "high",
  Medium = "medium",
  Low = "low",
  // GitHub left the severity out.
  Unknown = "unknown",
}

export interface SecurityAdvisoryVulnerability {
  /*
   * The versions it affects, exactly as GitHub writes them: "< 12.0.34",
   * ">= 6.0.1, < 12.0.34", "10.0.23". Null when GitHub gives none.
   */
  vulnerableVersionRange: string | null;
  // The versions that fix it, as GitHub writes them: "12.0.34", ">= 12.0.14".
  patchedVersions: string | null;
}

export interface SecurityAdvisory {
  // "GHSA-xxxx-xxxx-xxxx".
  ghsaId: string;
  // "CVE-2026-12345", or null when none was assigned.
  cveId: string | null;
  summary: string;
  severity: SecurityAdvisorySeverity;
  // The advisory on github.com, or null.
  url: string | null;
  // ISO 8601, or null.
  publishedAt: string | null;
  vulnerabilities: Array<SecurityAdvisoryVulnerability>;
}

// GitHub's advisory identifier: GHSA and three groups of four.
const GHSA_ID: RegExp = /^GHSA(-[0-9a-z]{4}){3}$/i;

const CVE_ID: RegExp = /^CVE-\d{4}-\d{4,10}$/i;

// Where an advisory may link: GitHub's own pages, over HTTPS.
const GITHUB_ADVISORY_URL_PREFIX: string = "https://github.com/";

export const MAX_SUMMARY_LENGTH: number = 300;
export const MAX_VERSION_TEXT_LENGTH: number = 256;
export const MAX_VULNERABILITIES_PER_ADVISORY: number = 20;
// Longer than GitHub's longest repository URL; anything longer is not a link to keep.
const MAX_URL_LENGTH: number = 512;

// Severity, most severe first: how notices and emails order advisories.
export const SEVERITY_ORDER: ReadonlyArray<SecurityAdvisorySeverity> = [
  SecurityAdvisorySeverity.Critical,
  SecurityAdvisorySeverity.High,
  SecurityAdvisorySeverity.Medium,
  SecurityAdvisorySeverity.Low,
  SecurityAdvisorySeverity.Unknown,
];

export default class SecurityAdvisoryUtil {
  public static parseSeverity(value: unknown): SecurityAdvisorySeverity {
    if (typeof value !== "string") {
      return SecurityAdvisorySeverity.Unknown;
    }

    const lowered: string = value.trim().toLowerCase();

    // GitHub's own API spelled "medium" as "moderate" in places.
    if (lowered === "moderate") {
      return SecurityAdvisorySeverity.Medium;
    }

    return (Object.values(SecurityAdvisorySeverity) as Array<string>).includes(
      lowered,
    )
      ? (lowered as SecurityAdvisorySeverity)
      : SecurityAdvisorySeverity.Unknown;
  }

  // 0 for critical, rising to Unknown: sorts the most severe first.
  public static severityRank(severity: SecurityAdvisorySeverity): number {
    const rank: number = SEVERITY_ORDER.indexOf(severity);
    return rank === -1 ? SEVERITY_ORDER.length : rank;
  }

  public static isGhsaId(value: unknown): value is string {
    return (
      typeof value === "string" && value.length <= 32 && GHSA_ID.test(value)
    );
  }

  // As GitHub writes it: "GHSA-" then lower-case groups ("GHSA-9q6r-9h5m-572w").
  public static normalizeGhsaId(value: string): string {
    return `GHSA${value.substring(4).toLowerCase()}`;
  }

  public static parseCveId(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 32) {
      return null;
    }

    const trimmed: string = value.trim();

    return CVE_ID.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  // An https://github.com/ address, or null for anything else.
  public static parseUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
      return null;
    }

    const trimmed: string = value.trim();

    if (!trimmed.startsWith(GITHUB_ADVISORY_URL_PREFIX)) {
      return null;
    }

    try {
      const url: globalThis.URL = new globalThis.URL(trimmed);

      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        return null;
      }

      return url.toString();
    } catch {
      return null;
    }
  }

  // An ISO date string, or null for anything that is not a date.
  public static parseDate(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 64) {
      return null;
    }

    const date: Date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  /*
   * Plain text on one line, capped: an advisory's summary. Control characters
   * and runs of whitespace become one space.
   */
  public static parseText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") {
      return null;
    }

    let text: string = "";
    let lastWasSpace: boolean = false;

    // A loop, not a regular expression: the value is not capped yet.
    for (const character of value.substring(0, maxLength * 4)) {
      const code: number = character.codePointAt(0) || 0;
      const isSpace: boolean =
        code <= 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x2028 ||
        code === 0x2029;

      if (isSpace) {
        if (!lastWasSpace && text.length > 0) {
          text += " ";
        }

        lastWasSpace = true;
        continue;
      }

      text += character;
      lastWasSpace = false;
    }

    text = text.trim();

    if (!text) {
      return null;
    }

    if (text.length > maxLength) {
      return `${text.substring(0, maxLength - 1).trimEnd()}…`;
    }

    return text;
  }

  public static parseVersionText(value: unknown): string | null {
    if (typeof value !== "string" || value.length > MAX_VERSION_TEXT_LENGTH) {
      return null;
    }

    return this.parseText(value, MAX_VERSION_TEXT_LENGTH);
  }

  /*
   * An advisory as it is stored (toJSON's shape), or null when it is not
   * one. Used to read the stored list back, never trusting it.
   */
  public static fromJSON(value: unknown): SecurityAdvisory | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;

    if (!this.isGhsaId(json["ghsaId"])) {
      return null;
    }

    const vulnerabilities: Array<SecurityAdvisoryVulnerability> = Array.isArray(
      json["vulnerabilities"],
    )
      ? (json["vulnerabilities"] as Array<unknown>)
          .slice(0, MAX_VULNERABILITIES_PER_ADVISORY)
          .map((item: unknown): SecurityAdvisoryVulnerability | null => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return null;
            }

            const vulnerability: JSONObject = item as JSONObject;

            return {
              vulnerableVersionRange: this.parseVersionText(
                vulnerability["vulnerableVersionRange"],
              ),
              patchedVersions: this.parseVersionText(
                vulnerability["patchedVersions"],
              ),
            };
          })
          .filter(
            (
              item: SecurityAdvisoryVulnerability | null,
            ): item is SecurityAdvisoryVulnerability => {
              return item !== null;
            },
          )
      : [];

    return {
      ghsaId: this.normalizeGhsaId(json["ghsaId"] as string),
      cveId: this.parseCveId(json["cveId"]),
      summary:
        this.parseText(json["summary"], MAX_SUMMARY_LENGTH) ||
        (json["ghsaId"] as string),
      severity: this.parseSeverity(json["severity"]),
      url: this.parseUrl(json["url"]),
      publishedAt: this.parseDate(json["publishedAt"]),
      vulnerabilities: vulnerabilities,
    };
  }

  // Every advisory of a stored list that is one; anything else is dropped.
  public static fromJSONArray(value: unknown): Array<SecurityAdvisory> {
    if (!Array.isArray(value)) {
      return [];
    }

    const advisories: Array<SecurityAdvisory> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      const advisory: SecurityAdvisory | null = this.fromJSON(item);

      if (advisory && !seen.has(advisory.ghsaId)) {
        seen.add(advisory.ghsaId);
        advisories.push(advisory);
      }
    }

    return advisories;
  }

  public static toJSON(advisory: SecurityAdvisory): JSONObject {
    return {
      ghsaId: advisory.ghsaId,
      cveId: advisory.cveId,
      summary: advisory.summary,
      severity: advisory.severity,
      url: advisory.url,
      publishedAt: advisory.publishedAt,
      vulnerabilities: advisory.vulnerabilities.map(
        (vulnerability: SecurityAdvisoryVulnerability): JSONObject => {
          return {
            vulnerableVersionRange: vulnerability.vulnerableVersionRange,
            patchedVersions: vulnerability.patchedVersions,
          };
        },
      ),
    };
  }
}
