import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import {
  ENRICHMENT_CONFIDENCE_ATTRIBUTE,
  ENRICHMENT_FEED_ATTRIBUTE,
  ENRICHMENT_FEED_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
  ENRICHMENT_MATCHED_ATTRIBUTE,
  ENRICHMENT_MATCHED_VALUE,
  ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
  THREAT_CONFIDENCE_ATTRIBUTE,
  THREAT_FEED_ID_ATTRIBUTE,
  THREAT_FEED_NAME_ATTRIBUTE,
  THREAT_INDICATOR_ID_ATTRIBUTE,
  THREAT_INDICATOR_TYPE_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_DEFAULT_VALID_DAYS,
  THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES,
  THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES,
  THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
  THREAT_INTEL_PRODUCT_NAME,
  THREAT_MATCH_COUNT_ATTRIBUTE,
  ThreatIntelIndicatorType,
  ocsfSeverityForConfidence,
} from "Common/Types/SecurityEvent/ThreatIntelConstants";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  markdownTable,
} from "./SecurityEventsGuide";

/*
 * What a customer needs to know to trust a threat intel feed: what is
 * polled, which indicators are kept, how they reach events, what a match
 * opens, and how an indicator's confidence becomes a threat level. Every
 * claim mirrors ThreatIntelFeedPoller, StixPatternParser,
 * ThreatIntelEnricher and ThreatIntelMatcher; numbers come from the
 * constants those files run on, and the example patterns, confidence
 * bands and Sigma rule are exported so tests can check them against the
 * real parser and severity mapping.
 */

const LOOKBACK_IN_HOURS: number =
  THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES / 60;

export interface ThreatLevelBand {
  minimumConfidence: number;
  maximumConfidence: number;
}

/*
 * The confidence ranges the guide tabulates. The threat level of each is
 * NOT written here — it is read from ocsfSeverityForConfidence, the
 * function the matcher uses — and a test walks every confidence 0–100 to
 * prove each band maps to exactly one level.
 */
export const THREAT_LEVEL_BANDS: Array<ThreatLevelBand> = [
  { minimumConfidence: 90, maximumConfidence: 100 },
  { minimumConfidence: 70, maximumConfidence: 89 },
  { minimumConfidence: 40, maximumConfidence: 69 },
  { minimumConfidence: 1, maximumConfidence: 39 },
];

// STIX says 0 means "not specified"; the matcher reads it the same way.
export const UNSCORED_CONFIDENCE: number = 0;

export function threatLevelForBand(band: ThreatLevelBand): OcsfSeverity {
  return ocsfSeverityForConfidence(band.minimumConfidence);
}

export function formatBand(band: ThreatLevelBand): string {
  return `${band.minimumConfidence}–${band.maximumConfidence}`;
}

const UNSCORED_THREAT_LEVEL: OcsfSeverity =
  ocsfSeverityForConfidence(UNSCORED_CONFIDENCE);

export interface IndicatorTypeDoc {
  label: string;
  // A STIX pattern that produces exactly this indicator type.
  examplePattern: string;
}

/*
 * Keyed by the enum so a new indicator type fails to compile until it is
 * documented; a test runs every example through StixPatternParser.
 */
export const INDICATOR_TYPE_DOCS: Record<
  ThreatIntelIndicatorType,
  IndicatorTypeDoc
> = {
  [ThreatIntelIndicatorType.Ipv4Address]: {
    label: "IPv4 address",
    examplePattern: "[ipv4-addr:value = '198.51.100.7']",
  },
  [ThreatIntelIndicatorType.Ipv6Address]: {
    label: "IPv6 address",
    examplePattern: "[ipv6-addr:value = '2001:db8::7']",
  },
  [ThreatIntelIndicatorType.DomainName]: {
    label: "Domain name",
    examplePattern: "[domain-name:value = 'evil.example']",
  },
  [ThreatIntelIndicatorType.Url]: {
    label: "URL",
    examplePattern: "[url:value = 'http://evil.example/payload']",
  },
  [ThreatIntelIndicatorType.EmailAddress]: {
    label: "Email address",
    examplePattern: "[email-addr:value = 'billing@evil.example']",
  },
  [ThreatIntelIndicatorType.FileHashSha256]: {
    label: "File hash (SHA-256)",
    examplePattern:
      "[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']",
  },
  [ThreatIntelIndicatorType.FileHashSha1]: {
    label: "File hash (SHA-1)",
    examplePattern:
      "[file:hashes.'SHA-1' = 'da39a3ee5e6b4b0d3255bfef95601890afd80709']",
  },
  [ThreatIntelIndicatorType.FileHashMd5]: {
    label: "File hash (MD5)",
    examplePattern: "[file:hashes.MD5 = 'd41d8cd98f00b204e9800998ecf8427e']",
  },
};

// OR-combined patterns the guide says are supported.
export const SUPPORTED_COMBINED_PATTERN_EXAMPLES: Array<string> = [
  "[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']",
  "[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']",
];

// Patterns the guide says are skipped whole.
export const UNSUPPORTED_PATTERN_EXAMPLES: Array<string> = [
  "[ipv4-addr:value = '198.51.100.7' AND domain-name:value = 'evil.example']",
  "[ipv4-addr:value = '198.51.100.7'] FOLLOWEDBY [domain-name:value = 'evil.example']",
  "[domain-name:value LIKE '%.evil.example']",
  "[ipv4-addr:value = '198.51.100.7'] WITHIN 300 SECONDS",
  "[process:name = 'mimikatz.exe']",
];

/*
 * A detection rule that builds on ingest-time enrichment. Exported so a
 * test can prove it parses, compiles, and reads the threat.* keys as
 * attributes.
 */
export const THREAT_INTEL_SIGMA_EXAMPLE_YAML: string = `title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    ${ENRICHMENT_MATCHED_ATTRIBUTE}: '${ENRICHMENT_MATCHED_VALUE}'
    ${ENRICHMENT_CONFIDENCE_ATTRIBUTE}|gte: 80
    className: Authentication
    statusName: Success
  condition: selection`;

const indicatorTypeRows: Array<Array<string>> = (
  Object.keys(INDICATOR_TYPE_DOCS) as Array<ThreatIntelIndicatorType>
).map((type: ThreatIntelIndicatorType): Array<string> => {
  const doc: IndicatorTypeDoc = INDICATOR_TYPE_DOCS[type];
  return [`${doc.label} (\`${type}\`)`, `\`${doc.examplePattern}\``];
});

const overviewMarkdown: string = `
A threat intel feed subscribes one **TAXII 2.1** collection — your own MISP or OpenCTI instance, or a commercial provider's — and turns its **STIX 2.1** indicators (known-bad IP addresses, domains, URLs, email addresses and file hashes) into matches against your security events. OneUptime ships no feed content of its own: you bring the collections, the same way you bring the Sigma rules.

#### From indicator to alert

1. **Poll.** Every *Poll Interval* minutes (default ${THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES}), OneUptime fetches the objects added to the collection since the last poll.
2. **Keep the indicators.** Supported indicator patterns become indicators — one per value — each with its confidence and an expiry date. Indicators below the feed's *Minimum Confidence* are skipped.
3. **Check events.** New events that mention an active indicator are tagged with \`threat.*\` attributes as they arrive, and every minute a matcher checks recent events against the feed.
4. **Act on matches.** A match records a **Threat Intel finding** in the event stream and opens one alert per indicator value (deduplicated while it stays open), optionally an incident.

#### Reading the table

The columns split into the **polling** side and the **matching** side, so a broken TAXII server and a broken match are easy to tell apart.

| Column | What it tells you |
| --- | --- |
| **Last Polled** | When the collection was last fetched. |
| **Last Poll Summary** | What that poll did: objects fetched, indicator values stored, and how many were skipped as unsupported, below minimum confidence, or already inactive. It says so when more pages remain. |
| **Last Error** | Why the last poll failed — the failing step and the start of the server's response. It clears on the next successful poll. |
| **Last Evaluated** | When the feed's indicators were last matched against events. |
| **Last Match** | The last check that found at least one match. |
| **Last Match Error** | Why the last match check failed. It clears on the next successful check. |

The **Indicators** table below the feeds lists every indicator that has been ingested — see **Indicators**.
`;

const feedsAndPollingMarkdown: string = `
#### Subscribing a collection

| Field | What to enter |
| --- | --- |
| **TAXII API Root URL** | The collection server's TAXII 2.1 API root, e.g. \`https://taxii.example.com/api1/\`. |
| **Collection ID** | The collection that publishes indicators. |
| **API Token** or **Basic Auth** | Only if the collection requires them. Leave both empty for public collections. |
| **Poll Interval (Minutes)** | How often to fetch new objects: ${THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES}–${THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES}, default ${THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES}. |
| **Minimum Confidence** | ${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN}–${THREAT_INTEL_MINIMUM_CONFIDENCE_MAX}. See **Indicators**. |

Any TAXII 2.1 server that publishes STIX 2.1 \`indicator\` objects works — MISP, OpenCTI, OpenTAXII, or a commercial provider's collection. Servers that require a TLS client certificate (mutual TLS) are not supported. MITRE's public ATT&CK TAXII server publishes techniques and groups rather than indicators, so a feed pointed at it stays empty.

#### Credentials

Tokens and passwords are encrypted and are never shown again after you save them. To change them, use the row's **Update Credentials** action. Choosing a method there replaces the feed's authentication: saving a token clears a stored basic-auth password and vice versa, and **Anonymous** clears both.

#### Polling

Each poll picks up where the last one stopped, so only new objects are fetched. A large collection syncs over several polls — **Last Poll Summary** says when more pages remain. To finish a big first sync sooner, shorten the poll interval (down to ${THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES} minute) until it catches up.

Polls identify themselves with the user agent \`OneUptime/<version> (+https://oneuptime.com)\`. If your provider's firewall answers \`403\`, ask them to allow it.

#### Disabling a feed

A disabled feed is neither polled nor matched on a schedule. Indicators it already ingested keep tagging new events at ingest until they expire.
`;

const indicatorsMarkdown: string = `
#### What gets ingested

STIX \`indicator\` objects whose pattern is plain equality on one of these types:

${markdownTable(["Type", "Example pattern"], indicatorTypeRows)}

Several comparisons joined with \`OR\` — inside one \`[...]\` or across several — are fine:

\`\`\`
${SUPPORTED_COMBINED_PATTERN_EXAMPLES.join("\n")}
\`\`\`

Anything else — \`AND\`, \`FOLLOWEDBY\`, \`NOT\`, \`LIKE\`, \`MATCHES\`, time qualifiers such as \`WITHIN\`, or other object types — is **skipped whole** and counted as unsupported in **Last Poll Summary**. Translating only part of an \`AND\` pattern would match far more than the feed's author intended.

#### Minimum Confidence

Indicators whose STIX \`confidence\` is below the feed's Minimum Confidence are skipped when they are fetched. \`${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN}\` keeps everything. Indicators that carry no confidence always pass, so an unscored feed does not go quiet when you set a minimum. Raising the minimum does not remove indicators that were already stored.

#### How long an indicator stays active

- An indicator matches from its \`valid_from\` until its \`valid_until\`. With no \`valid_until\`, it stays active for ${THREAT_INTEL_DEFAULT_VALID_DAYS} days from \`valid_from\` — polling it again does not extend that.
- A revoked indicator, or one updated with a \`valid_until\` in the past, stops matching as soon as the update is polled. So does a value the provider removes from an updated pattern.
- Values are stored in lowercase and matched regardless of case.

#### The Indicators table

It lists the indicator rows as stored. A re-polled indicator can briefly appear twice, and expired or revoked rows stay listed for a while until storage cleanup removes them. That is cosmetic: matching always checks validity and revocation, so a stale row is never matched. The **Status** column shows whether each row is Active, Expired or Revoked.
`;

const enrichmentAndMatchingMarkdown: string = `
Indicators reach your events in two ways.

#### 1. Tagging at ingest

Every incoming event — from the ingest API or a connection — is checked against your active indicators before it is stored. When any of its **observables** (the IPs, hosts, domains, hashes and users extracted from the event) equals an indicator value, the event is stamped with these attributes:

${markdownTable(
  ["Attribute", "Value"],
  [
    [
      `\`${ENRICHMENT_MATCHED_ATTRIBUTE}\``,
      `Always \`"${ENRICHMENT_MATCHED_VALUE}"\` on a tagged event.`,
    ],
    [`\`${ENRICHMENT_INDICATOR_ID_ATTRIBUTE}\``, "The STIX indicator id."],
    [
      `\`${ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE}\``,
      "The indicator type, e.g. `ipv4-addr` or `file-hash-sha256`.",
    ],
    [
      `\`${ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE}\``,
      "The matched value, in lowercase.",
    ],
    [
      `\`${ENRICHMENT_FEED_ATTRIBUTE}\` / \`${ENRICHMENT_FEED_ID_ATTRIBUTE}\``,
      "The feed the indicator came from.",
    ],
    [
      `\`${ENRICHMENT_CONFIDENCE_ATTRIBUTE}\``,
      "The indicator's STIX confidence.",
    ],
    [
      `\`${ENRICHMENT_MATCH_COUNT_ATTRIBUTE}\``,
      "How many of the event's observables matched an indicator.",
    ],
  ],
)}

When several indicators match one event, the one with the highest confidence fills in these values.

They are ordinary attributes, so you can filter on them in **Events**, in Security Events monitors, and in detection rules:

\`\`\`yaml
${THREAT_INTEL_SIGMA_EXAMPLE_YAML}
\`\`\`

Tagging only knows the indicators that exist when an event arrives — events are never re-tagged later.

#### 2. Matching every minute

Every minute, each enabled feed's active indicators are matched against the events whose **event time** falls since the feed's previous check. This catches intel that arrived after an event was tagged but before its window closed.

- The first check covers the last ${THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES} minutes. After an outage, the next check catches up on at most the last ${LOOKBACK_IN_HOURS} hours.
- Each window is checked once. Intel that arrives after a window has been checked only applies to future events.
- An event that arrives late, with a timestamp from before the previous check, is still tagged at ingest but is not matched.
- Each check matches at most ${THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION} indicator values per feed — the ones seen in the most events.

#### What a match does

- **An alert**, titled \`[Threat Intel] <feed name> — <indicator value>\`: one per feed and indicator value while it stays open. Once it is resolved, the next match opens a new one. Alerts are not resolved automatically.
- **An incident**, only with **Create Incident on Match** (off by default). Deduplicated the same way.
- **A Threat Intel finding**, with **Write Detection Finding on Match** (the default): a \`${DETECTION_FINDING_CLASS_NAME}\` event (OCSF ${DETECTION_FINDING_CLASS_UID}) from product \`${THREAT_INTEL_PRODUCT_NAME}\`, with the indicator's threat level as its severity and these attributes:

${markdownTable(
  ["Attribute", "Value"],
  [
    [
      `\`${THREAT_FEED_ID_ATTRIBUTE}\` / \`${THREAT_FEED_NAME_ATTRIBUTE}\``,
      "The feed.",
    ],
    [`\`${THREAT_INDICATOR_ID_ATTRIBUTE}\``, "The STIX indicator id."],
    [
      `\`${THREAT_INDICATOR_TYPE_ATTRIBUTE}\` / \`${THREAT_INDICATOR_VALUE_ATTRIBUTE}\``,
      "What matched.",
    ],
    [`\`${THREAT_CONFIDENCE_ATTRIBUTE}\``, "The indicator's confidence."],
    [
      `\`${THREAT_MATCH_COUNT_ATTRIBUTE}\``,
      "How many events are behind this finding.",
    ],
  ],
)}

Findings are never matched themselves, so one match cannot set off another. Use the **Create Monitor** row action to watch a feed's findings over time — a sudden burst of matches, or a normally busy feed going quiet.
`;

const threatLevelsMarkdown: string = `
Indicators have no Sigma level. Their STIX \`confidence\` (${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN}–${THREAT_INTEL_MINIMUM_CONFIDENCE_MAX}) sets the **threat level** instead:

${markdownTable(
  ["Indicator confidence", "Threat level"],
  [
    ...THREAT_LEVEL_BANDS.map((band: ThreatLevelBand): Array<string> => {
      return [formatBand(band), threatLevelForBand(band)];
    }),
    [`Not scored (${UNSCORED_CONFIDENCE} or missing)`, UNSCORED_THREAT_LEVEL],
  ],
)}

An unscored indicator reads as ${UNSCORED_THREAT_LEVEL}: somebody still chose to put it in a feed.

#### What the threat level decides

1. **The severity of the Threat Intel finding**, shown in **Events**.
2. **The severity of the alert and incident**, picked from *your* project's severities in this order:
   1. The feed's **Alert Severity** (or **Incident Severity**), if set — it applies to every match from the feed.
   2. Your severity named after the threat level, e.g. *High* (case-insensitive).
   3. By rank: Critical and High use your **most severe** severity; Medium and Low your **least severe**.

The threat level belongs to each indicator, not to the feed, so one feed can open a Critical alert and a Low alert in the same minute.

#### Combining it with Minimum Confidence

Minimum Confidence filters on the same number. For example, a minimum of 70 keeps only High and Critical indicators — plus unscored ones, which always pass.
`;

const troubleshootingMarkdown: string = `
#### Last Error is set after a poll

- \`401\` or \`403\`: the credentials are wrong or missing — replace them with **Update Credentials**. A \`403\` can also be the provider's firewall blocking the user agent (see **Feeds & Polling**).
- \`404\`: check the API Root URL — it usually ends in a path such as \`/api1/\` — and the Collection ID.
- The error clears on the next successful poll.

#### The feed polls, but no indicators appear

Read **Last Poll Summary**:

- *Fetched 0 STIX objects*: the collection is empty, or it publishes no \`indicator\` objects.
- *Skipped N unsupported patterns*: the provider uses pattern features listed as unsupported under **Indicators**.
- *N below minimum confidence*: lower the feed's Minimum Confidence.
- *N already inactive*: the provider sent indicators that were already revoked or expired.

#### Indicators exist, but nothing matches

- Matching compares indicator values with an event's **observables**, not with every field. Open an event you expected to match in **Events** and check its observables contain the value.
- Only **Active** indicators match — check the Status column in the Indicators table.
- Check **Last Match Error** on the feed.
- Events whose timestamps fall before the feed's previous check are not matched on schedule.

#### A match did not open an alert

- **Create Alert on Match** is off.
- An alert for the same feed and indicator value is still open — further matches are deduplicated into it.
- The project has no alert severities. Feeds need at least one to open alerts.
`;

const threatLevels: Array<SecurityEventsGuideLevel> = [
  ...THREAT_LEVEL_BANDS.map(
    (band: ThreatLevelBand): SecurityEventsGuideLevel => {
      return {
        label: `Confidence ${formatBand(band)}`,
        severity: threatLevelForBand(band),
      };
    },
  ),
  { label: "Not scored", severity: UNSCORED_THREAT_LEVEL },
];

const ThreatIntelGuide: SecurityEventsGuide = {
  id: "threat-intel",
  title: "How threat intel works",
  summary:
    "Threat intel feeds bring in known-bad IPs, domains, URLs, email addresses and file hashes from STIX/TAXII collections, and alert when your security events mention them.",
  steps: [
    {
      title: "Poll the feed",
      icon: IconProp.CloudArrowDown,
      description: `Every ${THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES}–${THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES} minutes (default ${THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES}), OneUptime fetches new STIX 2.1 indicators from your TAXII 2.1 collection.`,
    },
    {
      title: "Keep the indicators",
      icon: IconProp.Fingerprint,
      description:
        "Each IP, domain, URL, email address or file hash becomes an indicator with a confidence score and an expiry date.",
    },
    {
      title: "Check your events",
      icon: IconProp.MagnifyingGlass,
      description:
        "New events that mention an active indicator are tagged with threat.* attributes, and every minute recent events are matched against the feed.",
    },
    {
      title: "Alert on matches",
      icon: IconProp.BellAlert,
      description:
        "Each matched indicator opens one alert (deduplicated while it is open), optionally an incident, and records a Threat Intel finding.",
    },
  ],
  levels: {
    title: "Threat levels",
    description:
      "An indicator's STIX confidence sets its threat level: the severity of its findings, and the alert severity when the feed does not set one.",
    items: threatLevels,
    sectionId: "threat-levels",
  },
  guideTitle: "Threat Intel Guide",
  guideDescription:
    "How feeds are polled, how indicators reach your events, and how confidence becomes a threat level.",
  sections: [
    { id: "overview", title: "Overview", markdown: overviewMarkdown },
    {
      id: "feeds-and-polling",
      title: "Feeds & Polling",
      markdown: feedsAndPollingMarkdown,
    },
    { id: "indicators", title: "Indicators", markdown: indicatorsMarkdown },
    {
      id: "enrichment-and-matching",
      title: "Enrichment & Matching",
      markdown: enrichmentAndMatchingMarkdown,
    },
    {
      id: "threat-levels",
      title: "Threat Levels",
      markdown: threatLevelsMarkdown,
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      markdown: troubleshootingMarkdown,
    },
  ],
  documentationPath: "/telemetry/threat-intelligence",
};

export default ThreatIntelGuide;
