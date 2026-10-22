import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { ThreatIntelIndicatorType } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import { classifyIndicatorValue } from "../../../../Utils/SecurityEvent/ThreatIntel/IndicatorListParser";
import { ParsedIndicatorValue } from "../../../../Utils/SecurityEvent/ThreatIntel/StixPatternParser";

/*
 * One Google SecOps IOC match (an IoCDiscoveryInfo from
 * legacySearchEnterpriseWideIoCs) -> the indicator OneUptime watches for:
 * the artifact Google SecOps's threat intelligence found in its events, how
 * sure it is, and what it is about.
 *
 *   artifactIndicator: { domain | destinationIpAddress | hashMd5 |
 *                        hashSha1 | hashSha256 }
 *   ipAndPorts.ipAddress: the address as base64 bytes (4 or 16)
 *   domainAndPorts.domain
 *   confidenceScore (0-100), confidenceBucket ("high" ...), priority
 *   (LOW, MEDIUM, HIGH, ACTIVE_BREACH), iocState (STATUS_MUTED: an analyst
 *   muted it), categories, campaigns, associationIdentifier[].name,
 *   categorization, feedName, firstSeenTimestamp, lastSeenTimestamp,
 *   activeTimerange.endTime
 *
 * https://cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacySearchEnterpriseWideIoCs
 *
 * Everything here is text Google SecOps relays from its feeds, so it is
 * read by shape and length only: no pattern runs over it.
 */

export interface GoogleSecOpsIoc {
  type: ThreatIntelIndicatorType;
  value: string;
  // 0-100; 0 when Google SecOps did not score it.
  confidence: number;
  // A short line about it: its category, campaigns and actors.
  name: string;
  labels: Array<string>;
  firstSeen: Date | null;
  lastSeen: Date | null;
  // When its feed says it stops being active, if it says.
  activeUntil: Date | null;
  // An analyst muted it in Google SecOps.
  muted: boolean;
}

export const GOOGLE_SECOPS_IOC_MAX_LABELS: number = 20;
export const GOOGLE_SECOPS_IOC_MAX_NAME_LENGTH: number = 200;
const MAX_LABEL_LENGTH: number = 100;

/*
 * Google SecOps's own words for how sure it is, when it gives a bucket and
 * no score: each the middle of OneUptime's severity bands
 * (ocsfSeverityForConfidence), so a "high" match is a High one.
 */
const CONFIDENCE_FOR_BUCKET: Record<string, number> = {
  low: 20,
  medium: 50,
  high: 80,
};

// A match Google SecOps marks as an active breach is a Critical one, a high-priority one at least High.
const CONFIDENCE_FLOOR_FOR_PRIORITY: Record<string, number> = {
  ACTIVE_BREACH: 90,
  HIGH: 70,
};

function readString(source: JSONObject | undefined, key: string): string {
  const value: JSONValue | undefined = source ? source[key] : undefined;

  return typeof value === "string" ? value.trim() : "";
}

function readObject(
  source: JSONObject | undefined,
  key: string,
): JSONObject | undefined {
  const value: JSONValue | undefined = source ? source[key] : undefined;

  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined;
}

function readStrings(source: JSONObject, key: string): Array<string> {
  const value: JSONValue | undefined = source[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const strings: Array<string> = [];

  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") {
      strings.push(item.trim().slice(0, MAX_LABEL_LENGTH));
    }
  }

  return strings;
}

function readDate(value: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed: Date = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// A bytes field, base64: 4 bytes are an IPv4 address, 16 an IPv6 one.
export function decodeGoogleSecOpsIpAddress(encoded: string): string {
  if (!encoded || encoded.length > 64) {
    return "";
  }

  const bytes: Buffer = Buffer.from(encoded, "base64");

  if (bytes.length === 4) {
    return Array.from(bytes.values()).join(".");
  }

  if (bytes.length === 16) {
    const groups: Array<string> = [];

    for (let index: number = 0; index < 16; index += 2) {
      groups.push(((bytes[index]! << 8) | bytes[index + 1]!).toString(16));
    }

    return groups.join(":");
  }

  return "";
}

// An address as Google SecOps may spell it: written out, or as base64 bytes.
function readIpAddress(value: string): ParsedIndicatorValue | null {
  const written: ParsedIndicatorValue | null = classifyIndicatorValue(value);

  if (
    written &&
    (written.type === ThreatIntelIndicatorType.Ipv4Address ||
      written.type === ThreatIntelIndicatorType.Ipv6Address)
  ) {
    return written;
  }

  const decoded: ParsedIndicatorValue | null = classifyIndicatorValue(
    decodeGoogleSecOpsIpAddress(value),
  );

  return decoded &&
    (decoded.type === ThreatIntelIndicatorType.Ipv4Address ||
      decoded.type === ThreatIntelIndicatorType.Ipv6Address)
    ? decoded
    : null;
}

function readOfType(
  value: string,
  type: ThreatIntelIndicatorType,
): ParsedIndicatorValue | null {
  const parsed: ParsedIndicatorValue | null = classifyIndicatorValue(value);

  return parsed && parsed.type === type ? parsed : null;
}

// The artifact a match is about, typed as a STIX pattern's would be.
function readArtifact(match: JSONObject): ParsedIndicatorValue | null {
  const artifact: JSONObject | undefined = readObject(
    match,
    "artifactIndicator",
  );

  const candidates: Array<() => ParsedIndicatorValue | null> = [
    (): ParsedIndicatorValue | null => {
      return readOfType(
        readString(artifact, "domain"),
        ThreatIntelIndicatorType.DomainName,
      );
    },
    (): ParsedIndicatorValue | null => {
      return readIpAddress(readString(artifact, "destinationIpAddress"));
    },
    (): ParsedIndicatorValue | null => {
      return readOfType(
        readString(artifact, "hashSha256"),
        ThreatIntelIndicatorType.FileHashSha256,
      );
    },
    (): ParsedIndicatorValue | null => {
      return readOfType(
        readString(artifact, "hashSha1"),
        ThreatIntelIndicatorType.FileHashSha1,
      );
    },
    (): ParsedIndicatorValue | null => {
      return readOfType(
        readString(artifact, "hashMd5"),
        ThreatIntelIndicatorType.FileHashMd5,
      );
    },
    (): ParsedIndicatorValue | null => {
      return readIpAddress(
        readString(readObject(match, "ipAndPorts"), "ipAddress"),
      );
    },
    (): ParsedIndicatorValue | null => {
      return readOfType(
        readString(readObject(match, "domainAndPorts"), "domain"),
        ThreatIntelIndicatorType.DomainName,
      );
    },
  ];

  for (const candidate of candidates) {
    const found: ParsedIndicatorValue | null = candidate();

    if (found) {
      return found;
    }
  }

  return null;
}

export function googleSecOpsIocConfidence(match: JSONObject): number {
  const rawScore: JSONValue | undefined = match["confidenceScore"];
  const score: number =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string"
        ? Number(rawScore)
        : NaN;

  let confidence: number =
    Number.isFinite(score) && score > 0
      ? Math.min(100, Math.trunc(score))
      : CONFIDENCE_FOR_BUCKET[
          readString(match, "confidenceBucket").toLowerCase()
        ] || 0;

  const floor: number =
    CONFIDENCE_FLOOR_FOR_PRIORITY[
      readString(match, "priority").toUpperCase()
    ] || 0;

  if (floor > confidence) {
    confidence = floor;
  }

  return confidence;
}

function uniqueCaseless(values: Array<string>, limit: number): Array<string> {
  const seen: Set<string> = new Set<string>();
  const result: Array<string> = [];

  for (const value of values) {
    const key: string = value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

// "Malware: Emotet, Cobalt Strike (campaign X)" - what the match is about.
function describeIoc(data: {
  categories: Array<string>;
  associations: Array<string>;
  campaigns: Array<string>;
}): string {
  const about: string = data.categories.slice(0, 3).join(", ");
  const whom: string = uniqueCaseless(
    [...data.associations, ...data.campaigns],
    5,
  ).join(", ");

  const name: string =
    about && whom ? `${about}: ${whom}` : about || whom || "";

  return name.length > GOOGLE_SECOPS_IOC_MAX_NAME_LENGTH
    ? `${name.slice(0, GOOGLE_SECOPS_IOC_MAX_NAME_LENGTH - 1)}…`
    : name;
}

export function readGoogleSecOpsIocMatch(
  match: JSONObject,
): GoogleSecOpsIoc | null {
  const artifact: ParsedIndicatorValue | null = readArtifact(match);

  if (!artifact) {
    return null;
  }

  const categories: Array<string> = uniqueCaseless(
    [
      readString(match, "categorization").slice(0, MAX_LABEL_LENGTH),
      ...readStrings(match, "categories"),
    ].filter((value: string): boolean => {
      return value !== "";
    }),
    GOOGLE_SECOPS_IOC_MAX_LABELS,
  );

  const associations: Array<string> = Array.isArray(
    match["associationIdentifier"],
  )
    ? (match["associationIdentifier"] as Array<JSONValue>)
        .map((association: JSONValue): string => {
          return association !== null &&
            typeof association === "object" &&
            !Array.isArray(association)
            ? readString(association as JSONObject, "name").slice(
                0,
                MAX_LABEL_LENGTH,
              )
            : "";
        })
        .filter((name: string): boolean => {
          return name !== "";
        })
    : [];

  const campaigns: Array<string> = readStrings(match, "campaigns");

  return {
    type: artifact.type,
    value: artifact.value,
    confidence: googleSecOpsIocConfidence(match),
    name: describeIoc({ categories, associations, campaigns }),
    labels: uniqueCaseless(
      [...categories, ...associations, ...campaigns],
      GOOGLE_SECOPS_IOC_MAX_LABELS,
    ),
    firstSeen:
      readDate(readString(match, "firstSeenTimestamp")) ||
      readDate(readString(match, "iocIngestTimestamp")),
    lastSeen: readDate(readString(match, "lastSeenTimestamp")),
    activeUntil: readDate(
      readString(readObject(match, "activeTimerange"), "endTime"),
    ),
    muted: readString(match, "iocState").toUpperCase() === "STATUS_MUTED",
  };
}

/*
 * The same artifact matched more than once in a window is one indicator: the
 * surest confidence, every label, the earliest first sighting and the latest
 * last one. Muted only when every match of it is.
 */
export function mergeGoogleSecOpsIocs(
  iocs: Array<GoogleSecOpsIoc>,
): Array<GoogleSecOpsIoc> {
  const byKey: Map<string, GoogleSecOpsIoc> = new Map<
    string,
    GoogleSecOpsIoc
  >();

  const earlier: (a: Date | null, b: Date | null) => Date | null = (
    a: Date | null,
    b: Date | null,
  ): Date | null => {
    if (!a || !b) {
      return a || b;
    }

    return a.getTime() <= b.getTime() ? a : b;
  };

  const later: (a: Date | null, b: Date | null) => Date | null = (
    a: Date | null,
    b: Date | null,
  ): Date | null => {
    if (!a || !b) {
      return a || b;
    }

    return a.getTime() >= b.getTime() ? a : b;
  };

  for (const ioc of iocs) {
    const key: string = `${ioc.type}|${ioc.value}`;
    const existing: GoogleSecOpsIoc | undefined = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...ioc, labels: [...ioc.labels] });
      continue;
    }

    byKey.set(key, {
      type: existing.type,
      value: existing.value,
      confidence: Math.max(existing.confidence, ioc.confidence),
      name:
        ioc.confidence > existing.confidence && ioc.name
          ? ioc.name
          : existing.name || ioc.name,
      labels: uniqueCaseless(
        [...existing.labels, ...ioc.labels],
        GOOGLE_SECOPS_IOC_MAX_LABELS,
      ),
      firstSeen: earlier(existing.firstSeen, ioc.firstSeen),
      lastSeen: later(existing.lastSeen, ioc.lastSeen),
      activeUntil: later(existing.activeUntil, ioc.activeUntil),
      muted: existing.muted && ioc.muted,
    });
  }

  return Array.from(byKey.values());
}
