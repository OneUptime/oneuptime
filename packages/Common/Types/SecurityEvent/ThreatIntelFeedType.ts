/*
 * Where a threat-intel feed's indicators come from (ThreatIntelFeed.feedType).
 *
 *   - taxii: a TAXII 2.1 collection of STIX indicators - a vendor's or a
 *     sharing community's (MISP, OpenCTI, an ISAC).
 *   - list: a list at an https address, one IP address, domain, URL or
 *     file hash a line - the free blocklists most teams start with.
 *   - google-secops: the indicators Google SecOps's threat intelligence
 *     found in the events it holds, read through a Google SecOps
 *     connection, so OneUptime watches the rest of the project's events
 *     for them too.
 */
enum ThreatIntelFeedType {
  Taxii = "taxii",
  List = "list",
  GoogleSecOps = "google-secops",
}

export default ThreatIntelFeedType;

export const THREAT_INTEL_FEED_TYPES: ReadonlyArray<ThreatIntelFeedType> = [
  ThreatIntelFeedType.Taxii,
  ThreatIntelFeedType.List,
  ThreatIntelFeedType.GoogleSecOps,
];

export function isThreatIntelFeedType(
  value: unknown,
): value is ThreatIntelFeedType {
  return (
    typeof value === "string" &&
    (THREAT_INTEL_FEED_TYPES as ReadonlyArray<string>).includes(value)
  );
}

// A feed saved before there were sources is a TAXII collection.
export function readThreatIntelFeedType(value: unknown): ThreatIntelFeedType {
  return isThreatIntelFeedType(value) ? value : ThreatIntelFeedType.Taxii;
}

export interface ThreatIntelFeedTypeDefinition {
  type: ThreatIntelFeedType;
  title: string;
  description: string;
}

// In the order the feed form offers them.
export const THREAT_INTEL_FEED_TYPE_DEFINITIONS: ReadonlyArray<ThreatIntelFeedTypeDefinition> =
  [
    {
      type: ThreatIntelFeedType.List,
      title: "List of indicators",
      description:
        "A list at an https address, one IP address, domain, URL or file hash a line.",
    },
    {
      type: ThreatIntelFeedType.Taxii,
      title: "TAXII collection",
      description:
        "A TAXII 2.1 collection of STIX indicators, such as MISP, OpenCTI or an ISAC.",
    },
    {
      type: ThreatIntelFeedType.GoogleSecOps,
      title: "Google SecOps",
      description:
        "The indicators Google SecOps found in your events, read through a Google SecOps connection.",
    },
  ];

export function getThreatIntelFeedTypeDefinition(
  type: unknown,
): ThreatIntelFeedTypeDefinition {
  const known: ThreatIntelFeedType = readThreatIntelFeedType(type);

  return (
    THREAT_INTEL_FEED_TYPE_DEFINITIONS.find(
      (definition: ThreatIntelFeedTypeDefinition): boolean => {
        return definition.type === known;
      },
    ) || THREAT_INTEL_FEED_TYPE_DEFINITIONS[0]!
  );
}

/*
 * A list is downloaded whole on every poll: polled at most this often, so a
 * free list's provider is not asked more than it asks (abuse.ch: at least
 * every 15 minutes; Emerging Threats: at most once an hour).
 */
export const THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES: number = 15;

// The most indicators one list holds; the rest of a longer list is left out, and the feed says so.
export const THREAT_INTEL_LIST_MAX_INDICATORS: number = 50000;

/*
 * A list's indicators stay active this long after the poll that last saw
 * them, so an address dropped from the list is let go within two days and
 * one poll that fails changes nothing.
 */
export const THREAT_INTEL_LIST_VALID_DAYS: number = 2;

/*
 * A Google SecOps feed's indicators stay active this long after Google
 * SecOps last saw them in its events.
 */
export const THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS: number = 30;

// IOC matches one Google SecOps poll reads, at most.
export const THREAT_INTEL_GOOGLE_SECOPS_MAX_MATCHES: number = 10000;

/*
 * The window of match time one Google SecOps poll reads, at most: a feed's
 * first poll reads the last week, and a feed that has not polled for longer
 * starts again from a week ago.
 */
export const THREAT_INTEL_GOOGLE_SECOPS_MAX_WINDOW_IN_DAYS: number = 7;

/*
 * The indicator id (ThreatIntelIndicator.stixId) of every value a list feed
 * or a Google SecOps feed holds: one identity a value per feed, so a value
 * read again is a newer version of the same indicator. A TAXII feed's
 * indicators carry their STIX object's id (indicator--...).
 */
export const THREAT_INTEL_LIST_INDICATOR_ID: string = "list";
export const THREAT_INTEL_GOOGLE_SECOPS_INDICATOR_ID: string = "google-secops";

/*
 * Free lists a project adds in one click, from the Threat Intel page. Each
 * provider's terms allow it (linked), and each is polled no more often than
 * its provider asks.
 */
export interface RecommendedThreatIntelList {
  // Stable key: a project's feed with the same list URL is "this one, added".
  id: string;
  title: string;
  provider: string;
  description: string;
  url: string;
  // The confidence its indicators get: how sure the list is.
  indicatorConfidence: number;
  pollIntervalInMinutes: number;
  termsUrl: string;
  /*
   * Whether a match also opens an alert, as well as a case. A list whose
   * entries are worth a look rather than a page (the Tor exit nodes) opens
   * cases only.
   */
  raisesAlerts: boolean;
}

export const RECOMMENDED_THREAT_INTEL_LISTS: ReadonlyArray<RecommendedThreatIntelList> =
  [
    {
      id: "feodo-tracker",
      title: "Feodo Tracker botnet C2 servers",
      provider: "abuse.ch",
      description:
        "Command-and-control servers of active botnets (Dridex, Emotet, QakBot and others), checked by abuse.ch. Free for any use (CC0).",
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt",
      indicatorConfidence: 90,
      pollIntervalInMinutes: 60,
      termsUrl: "https://abuse.ch/terms-of-use/",
      raisesAlerts: true,
    },
    {
      id: "emerging-threats-compromised",
      title: "Emerging Threats compromised hosts",
      provider: "Proofpoint Emerging Threats",
      description:
        "Hosts known to be compromised and attacking others, from Proofpoint's free ET OPEN blocklists. Updated daily.",
      url: "https://rules.emergingthreats.net/blockrules/compromised-ips.txt",
      indicatorConfidence: 70,
      pollIntervalInMinutes: 1440,
      // The list's BSD licence is printed at the top of its rule file.
      termsUrl:
        "https://rules.emergingthreats.net/blockrules/emerging-compromised.rules",
      raisesAlerts: true,
    },
    {
      id: "tor-exit-nodes",
      title: "Tor exit nodes",
      provider: "The Tor Project",
      description:
        "Addresses traffic leaves the Tor network from. Not malicious in itself, but a sign-in through Tor is worth a look.",
      url: "https://check.torproject.org/torbulkexitlist",
      indicatorConfidence: 30,
      pollIntervalInMinutes: 60,
      termsUrl: "https://www.torproject.org/",
      raisesAlerts: false,
    },
  ];
