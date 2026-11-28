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
 * A STIX indicator's id (indicator--<uuid>), which a TAXII feed's
 * indicators carry; a list's or Google SecOps's carry their source's name
 * instead, and are not called STIX indicators.
 */
export function isStixIndicatorId(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith("indicator--");
}

/*
 * WHAT STANDS IN PLACE OF A FEED'S INDICATOR ONCE THE PERSON IT MATCHED IS
 * ERASED (#11230).
 *
 * A feed can list a person's email address. The finding about the match,
 * the events the ingest-time enricher stamped, the case detection and the
 * case it opened, and the alert or incident it opened, each named the
 * feed's indicator: by its id (a STIX indicator's "indicator--<uuid>"), and
 * by the indicator's own name. The feed keeps the address in clear beside
 * both for as long as it lists it - and a public feed lists it for anyone -
 * so following either named the person an erasure had taken out, with
 * nothing to guess.
 *
 * So an erasure puts this in the indicator id's place: "[INDICATOR:", the
 * keyed fingerprint of the match once the person is out of it - the one
 * the feed's alert and case detection are deduped by, a key of the
 * project's own over the token (Server/Utils/SecurityEvent/
 * DetectionFingerprint) - and "]". It says that one of the feed's
 * indicators matched, and the feed is still named beside it, but not which
 * indicator. The same match says the same token in each place, so the
 * finding, its events, its case detection and its alert still point at
 * each other. It never holds sixteen digits, a card number's shape.
 */
export const ERASED_INDICATOR_ID_PREFIX: string = "[INDICATOR:";
export const ERASED_INDICATOR_ID_SUFFIX: string = "]";

// "[INDICATOR:" and 16 lowercase hex characters: a detection fingerprint's.
export const ERASED_INDICATOR_ID_PATTERN: RegExp =
  /^\[INDICATOR:[0-9a-f]{16}\]$/;

// The id that takes a feed indicator's place, made of the match's keyed fingerprint.
export function toErasedIndicatorId(fingerprint: string): string {
  return `${ERASED_INDICATOR_ID_PREFIX}${fingerprint}${ERASED_INDICATOR_ID_SUFFIX}`;
}

// Whether an indicator id is one an erasure put in place of the feed's own.
export function isErasedIndicatorId(id: string | undefined | null): boolean {
  return typeof id === "string" && ERASED_INDICATOR_ID_PATTERN.test(id);
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
 * WHAT AN ERASED PERSON'S THREAT INTEL MATCH KEEPS OF THE INDICATOR'S
 * CONFIDENCE (#11447): nothing.
 *
 * A feed scores each of its indicators, and keeps the score beside the
 * address it lists in clear. In a small feed whose few email addresses
 * each have their own score - an internal STIX feed of a handful of
 * accounts - the feed, the indicator's type and the score left an erased
 * person's match pointing at one address. A coarser band of the score
 * (low, medium, high) does the same whenever each address's score falls in
 * a band of its own, and the severity a match takes from its score is
 * exactly such a band (ocsfSeverityForConfidence). So an erasure drops the
 * score from the person's records - the Detection Finding's
 * oneuptime.threat.confidence, the events' threat.confidence stamp, the
 * "confidence 80" of a description - and gives the person's finding and
 * detection the severity a match on an unscored indicator reads: the same
 * for every erased match, so it narrows nothing. The feed and the
 * indicator's type stay.
 */
export const ERASED_THREAT_INTEL_SEVERITY: OcsfSeverity =
  ocsfSeverityForConfidence(0);

/*
 * Save-time bounds for ThreatIntelFeed.minimumConfidence — one home for
 * the server validator and the dashboard form, so the two ranges cannot
 * drift apart. 0 disables the filter (and unscored indicators always
 * pass it — see ThreatIntelFeedPoller).
 */
export const THREAT_INTEL_MINIMUM_CONFIDENCE_MIN: number = 0;
export const THREAT_INTEL_MINIMUM_CONFIDENCE_MAX: number = 100;

/*
 * Save-time bounds and default for ThreatIntelFeed.pollIntervalInMinutes —
 * shared by the server validator, the poller's fallback and the dashboard
 * form, so the three cannot drift apart.
 */
export const THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES: number = 1;
export const THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES: number = 1440;
export const THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES: number = 60;

// Cap on one match evaluation's scan, whatever lastEvaluatedAt says.
export const THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

// First-ever match evaluation window for a feed.
export const THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES: number = 15;

/*
 * The indicator values one check opens alerts, incidents and cases for, at
 * most: the ones seen in the most events. A check that matches more records
 * every value as a finding (up to THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION)
 * and opens one case about the rest, so none goes unseen.
 */
export const THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION: number = 100;

/*
 * The indicator values one check records as findings, at most. Past it the
 * feed's lastMatchError and its overflow case say there were more.
 */
export const THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION: number = 10000;

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
