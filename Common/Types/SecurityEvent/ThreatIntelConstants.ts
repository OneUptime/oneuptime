import OcsfSeverity from "./OcsfSeverity";

/*
 * The contract between the threat-intel engine and everything that watches
 * its output — the sibling of DetectionFindingConstants for IOC matches.
 * The matcher stamps every Threat Intel finding row with these attribute
 * keys, the ingest-time enricher stamps matched events with the threat.*
 * keys, and the dashboard's "create a monitor from this feed" flow builds
 * its filters from the same constants — one source, so a renamed attribute
 * cannot silently orphan every monitor and Sigma rule built on it.
 */

// Telemetry service the matcher's findings are attributed to.
export const THREAT_INTEL_SERVICE_NAME: string = "OneUptime Threat Intel";

/*
 * productName stamped on finding rows, so IOC findings are filterable
 * apart from Sigma findings ("OneUptime Detections").
 */
export const THREAT_INTEL_PRODUCT_NAME: string = "OneUptime Threat Intel";

/*
 * Flattened attributes carried by every Threat Intel finding row
 * (oneuptime.threat.*, mirroring the Sigma engine's oneuptime.detection.*).
 */
export const THREAT_FEED_ID_ATTRIBUTE: string = "oneuptime.threat.feed_id";
export const THREAT_FEED_NAME_ATTRIBUTE: string = "oneuptime.threat.feed_name";
export const THREAT_INDICATOR_ID_ATTRIBUTE: string =
  "oneuptime.threat.indicator_id";
export const THREAT_INDICATOR_TYPE_ATTRIBUTE: string =
  "oneuptime.threat.indicator_type";
export const THREAT_INDICATOR_VALUE_ATTRIBUTE: string =
  "oneuptime.threat.indicator_value";
export const THREAT_CONFIDENCE_ATTRIBUTE: string =
  "oneuptime.threat.confidence";
export const THREAT_MATCH_COUNT_ATTRIBUTE: string =
  "oneuptime.threat.match_count";

/*
 * Enrichment attributes stamped onto the MATCHED EVENT itself at ingest
 * (short threat.* keys, as Sigma rules and monitors will filter on them):
 * threat.matched is always the literal string "true" on a stamped event.
 */
export const ENRICHMENT_MATCHED_ATTRIBUTE: string = "threat.matched";
export const ENRICHMENT_INDICATOR_ID_ATTRIBUTE: string = "threat.indicator_id";
export const ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE: string =
  "threat.indicator_type";
export const ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE: string =
  "threat.indicator_value";
export const ENRICHMENT_FEED_ATTRIBUTE: string = "threat.feed";
export const ENRICHMENT_FEED_ID_ATTRIBUTE: string = "threat.feed_id";
export const ENRICHMENT_CONFIDENCE_ATTRIBUTE: string = "threat.confidence";
export const ENRICHMENT_MATCH_COUNT_ATTRIBUTE: string = "threat.match_count";
export const ENRICHMENT_MATCHED_VALUE: string = "true";

/*
 * Normalized indicator types the STIX pattern parser emits. Values are
 * stored on ThreatIntelIndicator.indicatorType and stamped into the
 * threat.indicator_type attributes, so they are part of the public
 * contract — rename only with a data migration.
 */
export enum ThreatIntelIndicatorType {
  Ipv4Address = "ipv4-addr",
  Ipv6Address = "ipv6-addr",
  DomainName = "domain-name",
  Url = "url",
  EmailAddress = "email-addr",
  FileHashSha256 = "file-hash-sha256",
  FileHashSha1 = "file-hash-sha1",
  FileHashMd5 = "file-hash-md5",
}

/*
 * STIX confidence (0-100, 0 meaning "not specified") -> OCSF severity for
 * finding rows and for alert-severity name matching. Unknown confidence
 * reads as Medium: an indicator a feed did not score is still an
 * indicator somebody curated.
 */
export function ocsfSeverityForConfidence(confidence: number): OcsfSeverity {
  if (!Number.isFinite(confidence) || confidence <= 0) {
    return OcsfSeverity.Medium;
  }

  if (confidence >= 90) {
    return OcsfSeverity.Critical;
  }

  if (confidence >= 70) {
    return OcsfSeverity.High;
  }

  if (confidence >= 40) {
    return OcsfSeverity.Medium;
  }

  return OcsfSeverity.Low;
}

/*
 * Save-time bounds for ThreatIntelFeed.minimumConfidence — one home for
 * the server validator and the dashboard form, so the two ranges cannot
 * drift apart. 0 disables the filter (and unscored indicators always
 * pass it — see ThreatIntelFeedPoller).
 */
export const THREAT_INTEL_MINIMUM_CONFIDENCE_MIN: number = 0;
export const THREAT_INTEL_MINIMUM_CONFIDENCE_MAX: number = 100;

/*
 * Indicators whose STIX object carries no valid_until stay active this
 * long after valid_from. STIX says "valid until revoked"; unbounded
 * validity would grow the IOC table forever, so a year is the ceiling.
 * The window is ANCHORED at the object's own valid_from — re-polling does
 * not extend it (an unchanged object is never re-fetched past the
 * added_after cursor, and an updated one keeps its valid_from); only a
 * producer update that moves valid_from or sets valid_until changes the
 * expiry, and objects already past the window are skipped at ingest.
 */
export const THREAT_INTEL_DEFAULT_VALID_DAYS: number = 365;
