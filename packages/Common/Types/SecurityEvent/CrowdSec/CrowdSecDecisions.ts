/*
 * HOW ONEUPTIME'S OWN BANS LOOK IN CROWDSEC (#11158), and the words of
 * CrowdSec's Local API (LAPI) they are written in. Read by what bans
 * (Server/Utils/SecurityBlocklist/Destinations/CrowdSecBlockDestination)
 * and by what reads CrowdSec's alerts back (CrowdSecNormalizer): a ban
 * OneUptime made comes back through CrowdSec's notification plugin as an
 * alert like any other, and is known by these.
 *
 * A ban is written as `cscli decisions add` writes one - an alert holding
 * one decision - with:
 *
 *   origin    cscli, as a manual decision's. CrowdSec shares an alert with
 *             its Central API unless it is a manual decision and
 *             share_manual_decisions is off (its default); an alert of any
 *             other origin, with no scenario hash, counts as a custom
 *             scenario's, which share_custom (on by default) sends. A
 *             project's blocklist is its own, so it is sent nowhere.
 *   scenario  oneuptime/blocklist: what `cscli decisions list` shows as its
 *             reason, and what `cscli decisions delete --scenario` takes;
 *   meta      the connection that made it, the block it holds and when the
 *             block ends, so OneUptime reads and removes its own decisions
 *             alone, never a person's or another project's.
 *
 * Built against CrowdSec v1.8.2 (its swagger and pkg/apiserver).
 */

export const CROWDSEC_ONEUPTIME_SCENARIO: string = "oneuptime/blocklist";

export const CROWDSEC_ONEUPTIME_ORIGIN: string = "cscli";

// The alert's kind, as cscli's own manual decisions say it.
export const CROWDSEC_ONEUPTIME_ALERT_KIND: string = "cscli";

// The alert meta that marks a ban as one connection's.
export const CROWDSEC_META_CONNECTION: string = "oneuptime_connection";
export const CROWDSEC_META_BLOCK: string = "oneuptime_block";

/*
 * When the block ends, as OneUptime asked (an ISO time), or "lifted" for a
 * block that stays until it is lifted: what the decision's own end is read
 * against (a block until lifted is a renewed decision of a week).
 */
export const CROWDSEC_META_ENDS: string = "oneuptime_ends";
export const CROWDSEC_ENDS_WHEN_LIFTED: string = "lifted";

// The scenario `cscli notifications test` sends its generic alert as.
export const CROWDSEC_TEST_ALERT_SCENARIO: string = "test alert";

// Decision types LAPI and its remediation components know.
export const CROWDSEC_DECISION_BAN: string = "ban";
export const CROWDSEC_DECISION_CAPTCHA: string = "captcha";

// Where a decision came from (pkg/types/constants.go).
export enum CrowdSecOrigin {
  Cscli = "cscli",
  CrowdSec = "crowdsec",
  Console = "console",
  CscliImport = "cscli-import",
  Lists = "lists",
  Capi = "CAPI",
  RemediationSync = "remediation_sync",
}

// What raised an alert (pkg/types/alert_kind.go).
export enum CrowdSecAlertKind {
  CrowdSec = "crowdsec",
  Waf = "waf",
  BotDetection = "bot-detection",
  Capi = "capi",
  Papi = "papi",
  Cscli = "cscli",
}

// The decision scopes OneUptime bans in.
export enum CrowdSecScope {
  Ip = "Ip",
  Range = "Range",
}
