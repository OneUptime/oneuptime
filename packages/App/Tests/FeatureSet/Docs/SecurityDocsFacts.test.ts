import {
  SECURITY_EVENT_FACETS,
  SecurityEventFacetDefinition,
  applySecurityEventFacetFiltersToQuery,
  toSecurityEventExcludeFacetKey,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";
import {
  SECURITY_EVENT_SEARCH_SUGGESTIONS,
  SecurityEventSearchFilters,
  parseSecurityEventSearch,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSearchQuery";
import { DEFAULT_SECURITY_EVENTS_TIME_RANGE } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsTimeRange";
import {
  DETECTION_FINDING_MONITOR_WINDOW_SECONDS,
  buildDetectionRuleMonitorPrefill,
  buildThreatIntelFeedMonitorPrefill,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsMonitorPrefill";
import {
  SECURITY_EVENTS,
  THREAT_INTELLIGENCE,
} from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import OutboundUserAgent from "Common/Server/Utils/OutboundUserAgent";
import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
  resolveSigmaField,
} from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import ThreatIntelFeedPoller, {
  StixIndicatorParseResult,
  StixParseContext,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepSecurityEventsMonitor from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  DETECTION_DISTINCT_COUNT_ATTRIBUTE,
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
  DETECTION_MAX_GROUPS_PER_EVALUATION,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SIGMA_ID_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  normalizeOcsfSeverity,
} from "Common/Types/SecurityEvent/OcsfSeverity";
import SecurityEventFormat from "Common/Types/SecurityEvent/SecurityEventFormat";
import SigmaRule, {
  SIGMA_DEFAULT_LEVEL,
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
  SIGMA_SUPPORTED_MODIFIERS,
  SigmaLevel,
  isSevereSigmaLevel,
} from "Common/Types/SecurityEvent/SigmaRule";
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
import TimeRange from "Common/Types/Time/TimeRange";
import GenericNormalizer from "Common/Utils/SecurityEvent/GenericNormalizer";
import SecurityEventNormalizer from "Common/Utils/SecurityEvent/SecurityEventNormalizer";
import SigmaRuleParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleParser";
import StixPatternParser, {
  ParsedIndicatorValue,
} from "Common/Utils/SecurityEvent/ThreatIntel/StixPatternParser";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 24b: what the Security Events (SIEM) and Threat
 * Intelligence (STIX/TAXII) pages say about OneUptime, held to the code that
 * does it - the ingest route, its formats and their aliases, how each format
 * is read, the connectors, the explorer's search, facets and window, the
 * Sigma parser and compiler, the detection engine, the Security Events
 * monitor, the threat intel feed form, poller, parser, enricher and matcher,
 * and the monitors a rule or a feed pre-fills. The translations are held to
 * these English pages by AiToolingAndSecurityDocsTranslations.
 *
 * Where the code is pure (Common's types, the normalizers, the Sigma parser
 * and compiler, the STIX parsers, the Dashboard's search, facet and monitor
 * pre-fill helpers) it is imported and run on the pages' own examples. Where
 * it reaches a database or is a React page (the ingest service, the
 * evaluators, the matcher's queries, the Dashboard's forms and menus) it is
 * read as text.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const SECURITY: string = "packages/Common/Server/Utils/SecurityEvent";

const SOURCES: Record<string, string> = {
  navTabs: `${DASHBOARD}/Components/SecurityEvents/SecurityEventsNavTabs.tsx`,
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  connectionsTable: `${DASHBOARD}/Components/SecurityEvents/SecurityEventConnectionsTable.tsx`,
  detectionRules: `${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`,
  threatIntel: `${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`,
  monitorForm: `${DASHBOARD}/Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx`,
  telemetrySettings: `${DASHBOARD}/Pages/Settings/TelemetrySettings.tsx`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  setupGuide: `${DASHBOARD}/Components/SecurityEvents/SecurityEventsSetupGuide.tsx`,
  ingestRoute: "packages/App/FeatureSet/Telemetry/API/SecurityEventsIngest.ts",
  ingestService:
    "packages/App/FeatureSet/Telemetry/Services/SecurityEventsIngestService.ts",
  otelIngestBase:
    "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
  genericNormalizer: "packages/Common/Utils/SecurityEvent/GenericNormalizer.ts",
  securityEventModel: "packages/Common/Models/AnalyticsModels/SecurityEvent.ts",
  securityEventService:
    "packages/Common/Server/Services/SecurityEventService.ts",
  indicatorService:
    "packages/Common/Server/Services/ThreatIntelIndicatorService.ts",
  connectionPoller: `${SECURITY}/Connectors/SecurityEventConnectionPoller.ts`,
  detectionEvaluator: `${SECURITY}/DetectionRuleEvaluator.ts`,
  alerting: `${SECURITY}/SecurityEventAlerting.ts`,
  taxiiClient: `${SECURITY}/ThreatIntel/TaxiiClient.ts`,
  feedPoller: `${SECURITY}/ThreatIntel/ThreatIntelFeedPoller.ts`,
  enricher: `${SECURITY}/ThreatIntel/ThreatIntelEnricher.ts`,
  matcher: `${SECURITY}/ThreatIntel/ThreatIntelMatcher.ts`,
  httpFetch: "packages/Common/Server/Utils/DataSource/HttpFetch.ts",
  detectionJob:
    "packages/App/FeatureSet/Workers/Jobs/DetectionRules/EvaluateDetectionRules.ts",
  matchJob:
    "packages/App/FeatureSet/Workers/Jobs/ThreatIntel/MatchThreatIntelIndicators.ts",
  pollJob:
    "packages/App/FeatureSet/Workers/Jobs/ThreatIntel/PollThreatIntelFeeds.ts",
  foldTitles:
    "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
};

const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const LINE_BREAK: RegExp = /\n/;
const WHITESPACE: RegExp = /\s+/g;
const NUMBERED_STEP: RegExp = /^\d\. /;
// A tab of a product's header: `label: "Events",`.
const TAB_LABEL: RegExp = /label: "([^"]+)",/g;
// One option of the monitor's window dropdown: `label: "Last 5 seconds",`.
const WINDOW_OPTION: RegExp = /label: "(Last [^"]+)",/g;
// A string array of a source read as text: `const NAME: Array<string> = [ ... ];`.
const STRING_ARRAY: RegExp = /const ([A-Z_]+): Array<string> = \[([^\]]*)\];/g;
const QUOTED: RegExp = /"([^"]+)"/g;
// The JSON a curl example posts: `-d '{ ... }'`.
const CURL_BODY: RegExp = /-d '(\{.*\})'/;
// The finding class a connector's Imports cell names: ", as Detection Findings".
const IMPORTED_AS: RegExp = /, as ([A-Za-z ]+) Findings$/;
// The user agent the threat page names: `OneUptime/<version> (+...)`.
const NAMED_USER_AGENT: RegExp = /`(OneUptime\/<version> [^`]+)`/;
const DAY_IN_MILLISECONDS: number = 24 * 60 * 60 * 1000;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function allMatches(
  text: string,
  pattern: RegExp,
  group: number,
): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[group] as string;
    },
  );
}

function codeSpans(text: string): Array<string> {
  return allMatches(text, INLINE_CODE, 1);
}

function boldSpans(text: string): Array<string> {
  return allMatches(text, BOLD, 1);
}

function flat(text: string): string {
  return text.replace(WHITESPACE, " ");
}

function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The one line of a section that starts with these words.
function lineStarting(
  markdown: string,
  heading: string,
  start: string,
): string {
  const line: string | undefined = section(markdown, heading)
    .split(LINE_BREAK)
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect({ start, found: line !== undefined }).toEqual({ start, found: true });

  return line as string;
}

function numberedSteps(markdown: string, heading: string): Array<string> {
  return section(markdown, heading)
    .split(LINE_BREAK)
    .filter((line: string): boolean => {
      return NUMBERED_STEP.test(line);
    });
}

function rowsOf(
  markdown: string,
  heading: string,
  which: number = 0,
): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(section(markdown, heading));

  expect(found.length).toBeGreaterThan(which);

  return (found[which] as Array<Array<string>>).slice(1);
}

function firstCells(rows: Array<Array<string>>): Array<string> {
  return rows.map((row: Array<string>): string => {
    return row[0] as string;
  });
}

function rowNamed(rows: Array<Array<string>>, name: string): Array<string> {
  const row: Array<string> | undefined = rows.find(
    (cells: Array<string>): boolean => {
      return cells[0] === name;
    },
  );

  expect({ name, found: row !== undefined }).toEqual({ name, found: true });

  return row as Array<string>;
}

// The string arrays a source declares, by constant name.
function stringArrays(text: string): Map<string, Array<string>> {
  return new Map(
    Array.from(text.matchAll(STRING_ARRAY)).map(
      (match: RegExpMatchArray): [string, Array<string>] => {
        return [match[1] as string, allMatches(match[2] as string, QUOTED, 1)];
      },
    ),
  );
}

// Whether `list` appears in `of`, in the same order, perhaps with gaps.
function isOrderedSubsequence(list: Array<string>, of: Array<string>): boolean {
  let at: number = 0;

  for (const entry of of) {
    if (entry === list[at]) {
      at++;
    }
  }

  return at === list.length;
}

// The code of a fenced block whose info string carries this title.
function codeBlockTitled(markdown: string, title: string): string {
  const fence: { code: string } | undefined = scanMarkdown(
    markdown,
  ).fences.find((candidate: { info: string }): boolean => {
    return candidate.info.includes(`title="${title}"`);
  });

  expect({ title, found: fence !== undefined }).toEqual({
    title,
    found: true,
  });

  return (fence as { code: string }).code;
}

// The code of each fenced block of a section, in order.
function codeBlocksOf(markdown: string): Array<string> {
  return scanMarkdown(markdown).fences.map(
    (fence: { code: string }): string => {
      return fence.code;
    },
  );
}

// The first event each curl example of "Post your events" posts.
function examplePayloads(page: string): Array<JSONObject> {
  return codeBlocksOf(section(page, "Post your events")).map(
    (block: string): JSONObject => {
      const body: JSONObject = JSON.parse(
        (block.match(CURL_BODY) as RegExpMatchArray)[1] as string,
      ) as JSONObject;

      return (body["events"] as Array<JSONObject>)[0] as JSONObject;
    },
  );
}

// Every scalar value of a JSON payload, as text.
function leafValues(value: JSONValue): Array<string> {
  if (Array.isArray(value)) {
    return value.flatMap((item: JSONValue): Array<string> => {
      return leafValues(item);
    });
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value as JSONObject).flatMap(
      (item: JSONValue): Array<string> => {
        return leafValues(item);
      },
    );
  }

  return [String(value)];
}

function securityEventsStepOf(
  prefill: JSONObject,
): MonitorStepSecurityEventsMonitor {
  const steps: MonitorSteps = MonitorSteps.fromJSON(
    prefill["monitorSteps"] as JSONObject,
  );
  const step: MonitorStep | undefined =
    steps.data?.monitorStepsInstanceArray[0];

  expect(step?.data?.securityEventsMonitor).toBeDefined();

  return step!.data!.securityEventsMonitor!;
}

function permissionTitled(title: string): PermissionProps {
  const found: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (props: PermissionProps): boolean => {
        return props.title === title;
      },
    );

  expect({ title, found: found !== undefined }).toEqual({
    title,
    found: true,
  });

  return found as PermissionProps;
}

// A Sigma rule of one selection and that condition.
function sigmaRule(selection: string): string {
  return `title: t\ndetection:\n  selection:\n${selection}\n  condition: selection\n`;
}

function compiledSql(ruleYaml: string): Statement {
  return SigmaClickhouseCompiler.compileYaml(ruleYaml);
}

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("the Security Events page", () => {
  const page: string = englishPage(SECURITY_EVENTS);

  it("opens the product from Products → Security Events, which the Products menu lists under Observability", () => {
    const items: string = source("navigationItems");
    const entry: string = items.slice(
      items.indexOf('t("navbar.items.securityEventsTitle", "Security Events")'),
    );

    expect(entry.length).toBeLessThan(items.length);
    expect(entry.slice(0, entry.indexOf("category:") + 40)).toContain(
      "category: observabilityCategory",
    );
    expect(page).toContain(
      "Open **Products → Security Events**, under **Observability**. Its tabs:",
    );
  });

  it("names the product's tabs in the order the product draws them", () => {
    const labels: Array<string> = allMatches(source("navTabs"), TAB_LABEL, 1);

    expect(labels).toEqual([
      "Events",
      "Correlate",
      "Detection Rules",
      "Threat Intel",
      "Monitors",
      "Connections",
      "Setup Guide",
    ]);
    expect(firstCells(rowsOf(page, "How it works"))).toEqual(
      labels.map((label: string): string => {
        return `**${label}**`;
      }),
    );
  });

  it("says only Project Owner, Project Admin and the three Security roles read security data, as the event model allows", () => {
    const model: string = flat(source("securityEventModel"));

    expect(model).toContain(
      "const readPermissions: Array<Permission> = [ Permission.ProjectOwner, Permission.ProjectAdmin, Permission.SecurityAdmin, Permission.SecurityMember, Permission.SecurityViewer, Permission.ReadSecurityEvent, ];",
    );
    expect(page).toContain(
      "Security data is read only by the Project Owner and Project Admin roles and by the three Security roles; other roles see nothing in Security Events.",
    );
  });

  it("says what each Security role may do, as the roles describe themselves", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Before you begin");

    expect(firstCells(rows)).toEqual([
      "Security Admin",
      "Security Member",
      "Security Viewer",
    ]);
    expect(permissionTitled("Security Admin").description).toContain(
      "Full control over the SIEM: security events, Sigma detection rules, threat intelligence feeds and their indicators, and security event connections",
    );
    expect(permissionTitled("Security Member").description).toContain(
      "creates, changes and deletes detection rules and threat intel feeds. Cannot configure security event connections or delete security data.",
    );
    expect(rowNamed(rows, "Security Member")[1]).toBe(
      "Read events and threat intel, and create, change and delete detection rules and feeds. It can't set up connections or delete security data.",
    );
    expect(permissionTitled("Security Viewer").description).toBe(
      "Read-only access to security events, detection rules, threat intelligence feeds and indicators, and security event connections.",
    );
    expect(rowNamed(rows, "Security Viewer")[1]).toBe(
      "Read events, rules, feeds, indicators and connections",
    );
  });

  it("posts to the route ingest serves, with the ingestion key header, billed as Security Events", () => {
    const route: string = source("ingestRoute");

    expect(route).toContain('"/security-events/v1/ingest",');
    expect(route).toContain(
      "(req as TelemetryRequest).productType = ProductType.SecurityEvents;",
    );
    expect(page).toContain(
      "Send JSON to `/security-events/v1/ingest` with the key in `x-oneuptime-token`:",
    );
    expect(page).toContain(
      "Open **Project Settings → Telemetry & APM → Ingestion Keys** and click **Create Ingestion Key**. Security events use the same keys as the rest of your telemetry.",
    );
  });

  it("answers 200 only once the events are queued", () => {
    const service: string = flat(source("ingestService"));
    const queued: number = service.indexOf(
      "await SecurityEventsQueueService.addSecurityEventsIngestJob(",
    );
    const answered: number = service.indexOf(
      "Response.sendEmptySuccessResponse(req, res);",
    );

    expect(queued).toBeGreaterThan(0);
    expect(answered).toBeGreaterThan(queued);
    expect(page).toContain(
      "The endpoint answers `200` once the events are queued.",
    );
  });

  it("lists the formats ingest knows and the aliases it accepts for them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Formats");
    const formats: Array<string> = rows.map((row: Array<string>): string => {
      return codeSpans(row[0] as string)[0] as string;
    });

    expect(formats).toEqual(Object.values(SecurityEventFormat));

    for (const row of rows) {
      const format: string = codeSpans(row[0] as string)[0] as string;
      const aliases: Array<string> = codeSpans(row[2] as string);

      expect(SecurityEventNormalizer.parseFormat(format)).toBe(format);

      for (const alias of aliases) {
        expect({
          alias,
          format: SecurityEventNormalizer.parseFormat(alias),
        }).toEqual({
          alias,
          format,
        });
      }
    }
  });

  it("names the format by query, header or body field, and works it out per event when none is named", () => {
    const service: string = flat(source("ingestService"));

    expect(service).toContain(
      'const fromQuery: string = String(req.query?.["format"] || "");',
    );
    expect(service).toContain(
      'req.headers?.["x-oneuptime-security-event-format"] || "",',
    );
    expect(service).toContain(
      'String((req.body as JSONObject)["format"] || "")',
    );
    expect(service).toContain("fromQuery || fromHeader || fromBody");
    expect(page).toContain(
      'Name the format with `?format=`, with the `x-oneuptime-security-event-format` header, or with a top-level `"format"` field. Leave it out, and each event\'s format is worked out on its own, so one webhook can mix detections with raw events.',
    );
  });

  it("recognises each of the page's three examples as the format its tab names", () => {
    const payloads: Array<JSONObject> = examplePayloads(page);
    const expected: Array<SecurityEventFormat> = [
      SecurityEventFormat.Ocsf,
      SecurityEventFormat.Udm,
      SecurityEventFormat.Generic,
    ];

    expect(payloads.length).toBe(expected.length);

    payloads.forEach((payload: JSONObject, index: number) => {
      expect(SecurityEventNormalizer.detectFormat(payload)).toBe(
        expected[index],
      );
    });
  });

  it("reads each example with the severity, class, user, host and IP address the next step promises", () => {
    for (const payload of examplePayloads(page)) {
      const event: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(payload);

      expect(event).not.toBeNull();
      expect({
        severity: event!.severityName,
        hasClass: event!.className.length > 0,
        hasUser: event!.principalUser.length > 0,
        hasHost: event!.principalHost.length > 0,
        hasIp: event!.principalIp.length > 0,
      }).toEqual({
        severity: OcsfSeverity.High,
        hasClass: true,
        hasUser: true,
        hasHost: true,
        hasIp: true,
      });
    }

    expect(page).toContain(
      "Open **Products → Security Events → Events**. The events show within a few seconds, with their severity, class, user, host and IP addresses filled in.",
    );
  });

  it("sends the examples without a time, so they land in the explorer's past day at the moment they arrive", () => {
    for (const payload of examplePayloads(page)) {
      const before: number = Date.now();
      const event: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(payload);
      const after: number = Date.now();

      expect(event!.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(event!.time.getTime()).toBeLessThanOrEqual(after);
    }

    expect(DEFAULT_SECURITY_EVENTS_TIME_RANGE.range).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(page).toContain(
      "An event sent without a time, like these, is placed at the moment it arrives.",
    );
  });

  it("keeps every field of each example in the event's attributes, under dotted keys", () => {
    for (const payload of examplePayloads(page)) {
      const event: NormalizedSecurityEvent | null =
        SecurityEventNormalizer.normalize(payload);
      const stored: Array<string> = Object.values(event!.attributes).map(
        (value: unknown): string => {
          return String(value);
        },
      );

      for (const value of leafValues(payload)) {
        expect({ value, kept: stored.includes(value) }).toEqual({
          value,
          kept: true,
        });
      }
    }

    expect(
      Object.keys(
        SecurityEventNormalizer.normalize(examplePayloads(page)[0]!)!
          .attributes,
      ),
    ).toContain("actor.user.name");
    expect(page).toContain(
      "- Nothing is dropped because it didn't map: every field of the source arrives in the event's attributes.",
    );
  });

  it("takes one event, an array of them, or { events: [...] }", () => {
    expect(source("ingestService")).toContain(
      'Send a JSON object, an array of objects, or { "events": [...] }.',
    );
    expect(page).toContain(
      '- The body can be one event, an array of events, or `{ "events": [...] }`.',
    );
  });

  it("files events under the header's service, else the first event's product or vendor, else Security Events", () => {
    const service: string = flat(source("ingestService"));

    expect(service).toContain(
      'private static readonly DEFAULT_SERVICE_NAME: string = "Security Events";',
    );
    expect(service).toContain(
      "normalizedEvents[0]!.productName || normalizedEvents[0]!.vendorName || this.DEFAULT_SERVICE_NAME,",
    );
    expect(source("otelIngestBase")).toContain(
      'req.headers["x-oneuptime-service-name"]',
    );
    expect(page).toContain(
      "Without it, they belong to the service named after the first event's product or vendor, or to `Security Events`.",
    );
  });

  it("reads a generic event's fields from the names the normalizer tries, in its order", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Generic JSON fields");
    const lists: Map<string, Array<string>> = stringArrays(
      source("genericNormalizer"),
    );
    const listFor: Record<string, string> = {
      message: "MESSAGE_FIELDS",
      severityName: "SEVERITY_FIELDS",
      time: "TIME_FIELDS",
      principalUser: "USER_FIELDS",
      principalHost: "HOST_FIELDS",
      principalIp: "SOURCE_IP_FIELDS",
      targetIp: "TARGET_IP_FIELDS",
      className: "TYPE_FIELDS",
      ruleName: "RULE_NAME_FIELDS",
      productName: "PRODUCT_FIELDS",
    };

    expect(
      rows.map((row: Array<string>): string => {
        return codeSpans(row[0] as string)[0] as string;
      }),
    ).toEqual(Object.keys(listFor));

    for (const row of rows) {
      const field: string = codeSpans(row[0] as string)[0] as string;
      const listed: Array<string> = codeSpans(row[1] as string);
      const tried: Array<string> = lists.get(listFor[field] as string) || [];

      // The page names the snake_case spellings, the first of them first.
      expect({ field, first: listed[0] }).toEqual({ field, first: tried[0] });
      expect({ field, inOrder: isOrderedSubsequence(listed, tried) }).toEqual({
        field,
        inOrder: true,
      });
    }
  });

  it("reads each listed name, and the earlier of two, as the page says", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Generic JSON fields");
    const values: Record<string, [string, string]> = {
      message: ["first message", "second message"],
      severityName: ["critical", "low"],
      time: ["2026-08-21T10:00:00Z", "2026-08-22T11:00:00Z"],
      principalUser: ["alice", "bob"],
      principalHost: ["web-01", "web-02"],
      principalIp: ["203.0.113.7", "198.51.100.9"],
      targetIp: ["192.0.2.1", "192.0.2.2"],
      className: ["ssh_login", "file_access"],
      ruleName: ["rule one", "rule two"],
      productName: ["Falco", "auditd"],
    };

    function read(field: string, event: NormalizedSecurityEvent): string {
      const value: unknown = (event as unknown as JSONObject)[field];

      return value instanceof Date ? value.toISOString() : String(value);
    }

    function expectedOf(field: string, raw: string): string {
      if (field === "time") {
        return new Date(raw).toISOString();
      }

      if (field === "severityName") {
        return normalizeOcsfSeverity(raw) as string;
      }

      if (field === "className") {
        // A free-form event type is title-cased: ssh_login -> Ssh Login.
        return raw
          .split("_")
          .map((word: string): string => {
            return word.charAt(0).toUpperCase() + word.slice(1);
          })
          .join(" ");
      }

      return raw;
    }

    for (const row of rows) {
      const field: string = codeSpans(row[0] as string)[0] as string;
      const listed: Array<string> = codeSpans(row[1] as string);
      const [first, second] = values[field] as [string, string];

      for (const name of listed) {
        expect({
          field,
          name,
          read: read(field, GenericNormalizer.normalize({ [name]: first })),
        }).toEqual({ field, name, read: expectedOf(field, first) });
      }

      for (let index: number = 1; index < listed.length; index++) {
        const earlier: string = listed[index - 1] as string;
        const later: string = listed[index] as string;

        expect({
          field,
          earlier,
          later,
          read: read(
            field,
            GenericNormalizer.normalize({ [later]: second, [earlier]: first }),
          ),
        }).toEqual({ field, earlier, later, read: expectedOf(field, first) });
      }
    }
  });

  it("maps the severity words it names onto the OCSF levels it names", () => {
    const expected: Record<string, OcsfSeverity> = {
      info: OcsfSeverity.Informational,
      warning: OcsfSeverity.Low,
      error: OcsfSeverity.Medium,
      alert: OcsfSeverity.Critical,
      emergency: OcsfSeverity.Fatal,
    };

    for (const [word, level] of Object.entries(expected)) {
      expect({ word, level: normalizeOcsfSeverity(word) }).toEqual({
        word,
        level,
      });
      expect(page).toContain(
        `\`${word}\` ${word === "info" ? "reads as" : "as"} ${level}`,
      );
    }
  });

  it("forwards Fluent Bit to the ingest route, dated by the first time field a generic event is read from", () => {
    const settings: Array<[string, string]> = codeBlockTitled(
      page,
      "fluent-bit.conf",
    )
      .split(LINE_BREAK)
      .slice(1)
      .filter((line: string): boolean => {
        return line.trim().length > 0;
      })
      .map((line: string): [string, string] => {
        const [key, ...rest] = line.trim().split(WHITESPACE);

        return [key as string, rest.join(" ")];
      });
    const valueOf: (key: string) => Array<string> = (
      key: string,
    ): Array<string> => {
      return settings
        .filter((setting: [string, string]): boolean => {
          return setting[0] === key;
        })
        .map((setting: [string, string]): string => {
          return setting[1];
        });
    };
    const timeFields: Array<string> =
      stringArrays(source("genericNormalizer")).get("TIME_FIELDS") || [];

    expect(valueOf("Name")).toEqual(["http"]);
    expect(valueOf("URI")).toEqual(["/security-events/v1/ingest"]);
    expect(valueOf("Format")).toEqual(["json"]);
    expect(valueOf("Json_date_key")).toEqual([timeFields[0]]);
    expect(valueOf("Header")).toEqual([
      "x-oneuptime-token YOUR_INGESTION_TOKEN",
      "x-oneuptime-service-name my-security-source",
    ]);
  });

  it("lists every security product a connection can poll, each with its setup guide", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Connect a security product",
    );

    expect(rows.length).toBe(SecurityEventConnectorCatalog.length);

    for (const connector of SecurityEventConnectorCatalog as Array<SecurityEventConnectorDefinition>) {
      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return (cells[0] as string).startsWith(connector.title);
        },
      );

      expect({ connector: connector.title, listed: row !== undefined }).toEqual(
        {
          connector: connector.title,
          listed: true,
        },
      );
      expect(row?.[2]).toBe(`[${connector.title}](${connector.docsPath})`);

      // "Alerts, as Detection Findings": the class the connector says it imports.
      const importedAs: RegExpMatchArray | null = (row?.[1] as string).match(
        IMPORTED_AS,
      );

      if (importedAs) {
        expect({
          connector: connector.title,
          imports: connector.description.endsWith(
            `as ${importedAs[1]} Finding events.`,
          ),
        }).toEqual({ connector: connector.title, imports: true });
      }
    }
  });

  it("says a new connection's first poll looks back 24 hours", () => {
    expect(flat(source("connectionPoller"))).toContain(
      "export const DEFAULT_INITIAL_LOOKBACK_IN_MINUTES: number = 24 * 60;",
    );
    expect(page).toContain(
      "- The first poll looks back 24 hours, so a new connection shows recent records at once.",
    );
  });

  it("names a connection's row actions, Test connection and Run now", () => {
    const table: string = source("connectionsTable");

    expect(table).toContain('title: "Test connection",');
    expect(table).toContain('title: "Run now",');
    expect(page).toContain(
      "**Test connection**, in the connection's row, checks access to the product and that OneUptime's own workers are running, and imports nothing. **Run now** polls straight away.",
    );
  });

  it("names every typed field an event holds, and the severity levels it can take, as OCSF's", () => {
    const rows: Array<Array<string>> = rowsOf(page, "What an event holds");
    const named: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return codeSpans(row[1] as string);
      },
    );
    const event: NormalizedSecurityEvent = GenericNormalizer.normalize({
      message: "m",
    });

    // The time and the attributes are named in words, not as fields.
    expect([...named, "time", "attributes"].sort()).toEqual(
      Object.keys(event).sort(),
    );
    expect(rowNamed(rows, "Severity")[1]).toBe(
      `\`severityName\`, one of ${Object.values(OcsfSeverity).slice(0, -1).join(", ")} or ${OcsfSeverity.Other}, and \`severityId\``,
    );
  });

  it("lists the search's short names as the search suggests them, each a typed field, and reads any other name as an attribute", () => {
    const named: Array<string> = codeSpans(
      lineStarting(page, "Search", "A field is either a short name"),
    );
    const shortNames: Array<string> = named.slice(
      0,
      SECURITY_EVENT_SEARCH_SUGGESTIONS.length,
    );

    expect(shortNames).toEqual([...SECURITY_EVENT_SEARCH_SUGGESTIONS]);
    expect(named.slice(SECURITY_EVENT_SEARCH_SUGGESTIONS.length)).toEqual([
      "severityName",
      "principalHost",
      "observable:<value>",
    ]);

    for (const name of [...shortNames, "severityName", "principalHost"]) {
      const filters: SecurityEventSearchFilters = parseSecurityEventSearch(
        `${name}:x`,
      );

      expect({
        name,
        typed: Object.keys(filters.fields).length,
        attributes: Object.keys(filters.attributes),
      }).toEqual({ name, typed: 1, attributes: [] });
    }

    expect(parseSecurityEventSearch("severityName:High").fields).toEqual({
      severityName: "High",
    });
    expect(parseSecurityEventSearch("zone:dmz").attributes).toEqual({
      zone: "dmz",
    });
    expect(
      parseSecurityEventSearch("observable:203.0.113.7").fields["observables"],
    ).toStrictEqual(new Search("203.0.113.7"));
  });

  it("does what the syntax table says for each of its examples", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Search");
    const expected: Record<
      string,
      (filters: SecurityEventSearchFilters) => void
    > = {
      "failed logon": (filters: SecurityEventSearchFilters): void => {
        expect(filters).toEqual({
          freeText: "failed logon",
          fields: {},
          attributes: {},
        });
      },
      '"brute force"': (filters: SecurityEventSearchFilters): void => {
        expect(filters.freeText).toBe("brute force");
      },
      "severity:Critical": (filters: SecurityEventSearchFilters): void => {
        expect(filters.fields).toEqual({ severityName: "Critical" });
      },
      "@threat.matched:true": (filters: SecurityEventSearchFilters): void => {
        expect(filters.attributes).toEqual({ "threat.matched": "true" });
      },
      "-severity:Informational": (
        filters: SecurityEventSearchFilters,
      ): void => {
        expect(filters.fields["severityName"]).toStrictEqual(
          new NotEqual("Informational"),
        );
      },
      "severity:(High OR Critical)": (
        filters: SecurityEventSearchFilters,
      ): void => {
        expect(filters.fields["severityName"]).toStrictEqual(
          new Includes(["High", "Critical"]),
        );
      },
      "host:web-*": (filters: SecurityEventSearchFilters): void => {
        expect(filters.fields["principalHost"]).toBeInstanceOf(Wildcard);
      },
      "@threat.indicator_id:*": (filters: SecurityEventSearchFilters): void => {
        expect(filters.attributes["threat.indicator_id"]).toBeInstanceOf(
          NotNull,
        );
      },
      "@finding_info.title:~ransom": (
        filters: SecurityEventSearchFilters,
      ): void => {
        expect(filters.attributes["finding_info.title"]).toStrictEqual(
          new Search("ransom"),
        );
      },
    };
    const examples: Array<string> = rows.map((row: Array<string>): string => {
      return codeSpans(row[2] as string)[0] as string;
    });

    expect(examples).toEqual(Object.keys(expected));

    for (const example of examples) {
      (expected[example] as (filters: SecurityEventSearchFilters) => void)(
        parseSecurityEventSearch(example),
      );
    }
  });

  it("names the facets in the sidebar's order, and a value keeps or leaves out its events", () => {
    const titles: Array<string> = [...SECURITY_EVENT_FACETS]
      .sort(
        (
          a: SecurityEventFacetDefinition,
          b: SecurityEventFacetDefinition,
        ): number => {
          return a.priority - b.priority;
        },
      )
      .map((facet: SecurityEventFacetDefinition): string => {
        return facet.title;
      });
    const kept: Query<SecurityEvent> = applySecurityEventFacetFiltersToQuery({
      query: {},
      filters: new Map([["severityName", new Set(["High"])]]),
    });
    const leftOut: Query<SecurityEvent> = applySecurityEventFacetFiltersToQuery(
      {
        query: {},
        filters: new Map([
          [toSecurityEventExcludeFacetKey("severityName"), new Set(["Low"])],
        ]),
      },
    );

    expect(
      boldSpans(lineStarting(page, "Facets", "The sidebar counts")),
    ).toEqual(titles);
    expect((kept as JSONObject)["severityName"]).toBe("High");
    expect((leftOut as JSONObject)["severityName"]).toStrictEqual(
      new NotEqual("Low"),
    );
    expect(page).toContain(
      "Click a value to keep only its events, or the minus beside it to leave them out.",
    );
  });

  it("creates a rule in the form's four steps, with its fields and defaults", () => {
    const form: string = flat(source("detectionRules"));
    const steps: Array<string> = numberedSteps(page, "Create a rule");

    expect(form).toContain(
      'formSteps={[ { title: "Basic Info", id: "basic-info" }, { title: "Sigma Rule", id: "sigma-rule" }, { title: "Evaluation", id: "evaluation" }, { title: "On Match", id: "on-match" }, ]}',
    );
    expect(
      steps.slice(1).map((step: string): string => {
        return boldSpans(step)[0] as string;
      }),
    ).toEqual(["Basic Info", "Sigma Rule", "Evaluation", "On Match"]);
    expect(form).toContain(
      "createInitialValues={{ isEnabled: true, evaluationIntervalInMinutes: 5,",
    );
    expect(form).toContain(
      "shouldCreateAlert: true, shouldWriteDetectionFinding: true, shouldCreateIncident: false, matchCountThreshold: 1, }}",
    );

    for (const title of [
      "Name",
      "Enabled",
      "Sigma Rule (YAML)",
      "Create Alert on Match",
      "Create Incident on Match",
      "Write Detection Finding on Match",
      "Alert Severity",
      "Incident Severity",
    ]) {
      expect(form).toContain(`title: "${title}",`);
      expect(boldSpans(steps.join("\n"))).toContain(title);
    }

    expect(steps[4]).toContain(
      "**Create Alert on Match** (on), **Create Incident on Match** (off) and **Write Detection Finding on Match** (on)",
    );
    expect(page).toContain(
      "Open **Products → Security Events → Detection Rules** and click **Create Detection Rule**.",
    );
  });

  it("parses the page's first rule: its level, its ATT&CK tags and its selections, and compiles it", () => {
    const yaml: string = codeBlockTitled(page, "failed-logon-burst.yml");
    const rule: SigmaRule = SigmaRuleParser.parse(yaml);

    expect(rule.title).toBe("Failed logon burst");
    expect(rule.level).toBe(SigmaLevel.High);
    expect(
      rule.mitreTechniques.map((id: string): string => {
        return id.toUpperCase();
      }),
    ).toEqual(["T1110"]);
    expect(
      rule.mitreTactics.map((id: string): string => {
        return id.toUpperCase();
      }),
    ).toEqual(["TA0006"]);
    expect(
      rule.selections.map((selection: { name: string }): string => {
        return selection.name;
      }),
    ).toEqual(["selection", "filter_internal"]);
    // `principalIp|startswith: '10.'` keeps 10.x.x.x out.
    expect(boundValues(compiledSql(yaml))).toContain("10.%");
  });

  it("combines selections with the conditions it lists", () => {
    const words: Array<string> = codeSpans(
      lineStarting(page, "What a rule can say", "- Conditions combine"),
    );
    const detection: string =
      "detection:\n  selection_logon:\n    className: Authentication\n  selection_admin:\n    principalUser: admin\n  filter_internal:\n    principalIp|startswith: '10.'\n";
    const conditions: Array<string> = [
      "selection_logon and selection_admin",
      "selection_logon or selection_admin",
      "selection_logon and not filter_internal",
      "(selection_logon or selection_admin) and not filter_internal",
      ...words.slice(3),
    ];

    expect(words.slice(0, 3)).toEqual(["and", "or", "not"]);
    expect(words.slice(3)).toEqual([
      "1 of selection_*",
      "all of selection_*",
      "any of them",
      "all of them",
    ]);

    for (const condition of conditions) {
      expect(() => {
        return compiledSql(`title: t\n${detection}  condition: ${condition}\n`);
      }).not.toThrow();
    }
  });

  it("matches a field map on every field and any listed value, and a keyword list in the message", () => {
    const map: string = compiledSql(
      sigmaRule(
        "    className: Authentication\n    statusName:\n      - Failure\n      - Blocked",
      ),
    ).query;
    const keywords: Statement = compiledSql(
      "title: t\ndetection:\n  keywords:\n    - mimikatz\n  condition: keywords\n",
    );

    expect(map).toContain("className");
    expect(map).toContain(" AND ");
    expect(map).toContain(" OR ");
    expect(keywords.query).toContain("message ILIKE");
    expect(boundValues(keywords)).toContain("%mimikatz%");
    expect(page).toContain(
      "- Selections are field maps (every field must match; a list of values matches any of them) or keyword lists, which match anywhere in the message.",
    );
  });

  it("lists exactly the field modifiers the parser accepts, and each one compiles", () => {
    const named: Array<string> = codeSpans(
      lineStarting(page, "What a rule can say", "- Field modifiers:"),
    );
    const uses: Record<string, string> = {
      contains: "    principalUser|contains: adm",
      startswith: "    principalUser|startswith: adm",
      endswith: "    principalUser|endswith: adm",
      all: "    principalUser|contains|all:\n      - adm\n      - in",
      re: "    principalUser|re: '^adm.*'",
      cased: "    principalUser|cased: Admin",
      gt: "    targetPort|gt: 1024",
      gte: "    targetPort|gte: 1024",
      lt: "    targetPort|lt: 1024",
      lte: "    targetPort|lte: 1024",
      cidr: "    principalIp|cidr: 10.0.0.0/8",
      exists: "    principalHost|exists: true",
      windash: "    principalProcess|windash|contains: ' -enc '",
    };

    expect(named.slice(0, SIGMA_SUPPORTED_MODIFIERS.length)).toEqual([
      ...SIGMA_SUPPORTED_MODIFIERS,
    ]);
    expect(Object.keys(uses)).toEqual([...SIGMA_SUPPORTED_MODIFIERS]);

    for (const modifier of SIGMA_SUPPORTED_MODIFIERS) {
      expect(() => {
        return compiledSql(sigmaRule(uses[modifier] as string));
      }).not.toThrow();
    }

    // windash matches the flag in both spellings.
    expect(boundValues(compiledSql(sigmaRule(uses["windash"]!)))).toEqual(
      expect.arrayContaining(["% -enc %", "% /enc %"]),
    );
  });

  it("compares text ignoring case unless the rule adds cased, and a plain value against the whole field", () => {
    // A plain value: the whole field, compared lowercased.
    const plain: Statement = compiledSql(sigmaRule("    principalUser: ADM"));
    const plainCased: Statement = compiledSql(
      sigmaRule("    principalUser|cased: ADM"),
    );
    const contains: Statement = compiledSql(
      sigmaRule("    principalUser|contains: ADM"),
    );
    const containsCased: Statement = compiledSql(
      sigmaRule("    principalUser|contains|cased: ADM"),
    );
    const wildcard: Statement = compiledSql(
      sigmaRule("    principalUser: adm*"),
    );

    expect(plain.query).toContain("lowerUTF8(principalUser) = ");
    expect(boundValues(plain)).toEqual(["adm"]);
    expect(plainCased.query).not.toContain("lowerUTF8");
    expect(boundValues(plainCased)).toEqual(["ADM"]);
    expect(contains.query).toContain(" ILIKE ");
    expect(containsCased.query).toContain(" LIKE ");
    expect(containsCased.query).not.toContain("ILIKE");
    expect(boundValues(contains)).toEqual(["%ADM%"]);
    expect(boundValues(wildcard)).toEqual(["adm%"]);
    expect(page).toContain(
      "Text is compared ignoring case, unless you add `cased`.",
    );
    expect(page).toContain(
      "a plain value must equal the whole field, so use `contains` or `*` for part of one.",
    );
  });

  it("reads a field as a typed field, a common Sigma spelling of one, or an attribute key spelled as in the event", () => {
    expect(resolveSigmaField("principalUser")).toEqual({
      kind: "textColumn",
      column: "principalUser",
    });
    expect(resolveSigmaField("CommandLine")).toEqual({
      kind: "textColumn",
      column: "principalProcess",
    });
    expect(resolveSigmaField("src_ip")).toEqual({
      kind: "textColumn",
      column: "principalIp",
    });
    expect(resolveSigmaField("Hostname")).toEqual({
      kind: "textColumn",
      column: "principalHost",
    });
    expect(resolveSigmaField("threat.matched")).toEqual({
      kind: "attribute",
      attributeKey: "threat.matched",
    });
    expect(page).toContain(
      "- A field is a typed field (`principalUser`), a common Sigma spelling of one (`CommandLine`, `src_ip`, `Hostname`), or any attribute key, spelled as it is in the event (`threat.matched`).",
    );
    expect(page).toContain(
      "An attribute is named as it is in the event (`threat.matched`, not `attributes.threat.matched`).",
    );
  });

  it("sets the level as the parser and the finding do: medium when missing", () => {
    expect(SIGMA_DEFAULT_LEVEL).toBe(SigmaLevel.Medium);
    expect(
      SigmaRuleParser.parse(sigmaRule("    className: Authentication")).level,
    ).toBe(SigmaLevel.Medium);
    expect(Object.values(SigmaLevel)).toEqual([
      "informational",
      "low",
      "medium",
      "high",
      "critical",
    ]);
    expect(page).toContain(
      "- `level` sets the severity: `informational`, `low`, `medium`, `high` or `critical`, and `medium` when missing.",
    );
  });

  it("refuses an aggregation when the rule is saved, and lets logsource and timeframe narrow nothing", () => {
    const bare: Statement = compiledSql(
      sigmaRule("    className: Authentication"),
    );
    const withLogsource: Statement = compiledSql(
      `logsource:\n  product: windows\n  service: security\n${sigmaRule("    className: Authentication")}`,
    );
    const withTimeframe: Statement = compiledSql(
      sigmaRule("    className: Authentication").replace(
        "  condition: selection\n",
        "  timeframe: 5m\n  condition: selection\n",
      ),
    );

    expect(() => {
      return SigmaRuleParser.parse(
        sigmaRule("    className: Authentication").replace(
          "condition: selection",
          "condition: selection | count() by principalIp > 5",
        ),
      );
    }).toThrow("aggregation expressions");
    expect(page).toContain(
      "Aggregations such as `| count() by principalIp > 5` are refused when you save",
    );

    for (const statement of [withLogsource, withTimeframe]) {
      expect(statement.query).toBe(bare.query);
      expect(boundValues(statement)).toEqual(boundValues(bare));
    }

    expect(page).toContain(
      "`logsource` is informational only and narrows nothing: put that filter in a selection, such as `className: Authentication`. A `timeframe` is ignored, because the rule's interval sets its window.",
    );
  });

  it("states the evaluation ranges and the new rule's interval as the form and the server hold them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Evaluation settings");

    expect(DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES).toBe(1);
    expect(DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES).toBe(1440);
    expect(rowNamed(rows, "**Evaluation Interval (Minutes)**")[1]).toBe(
      "How often the rule runs: whole minutes, 1 to 1440. A new rule's form starts at 5.",
    );
    expect(DETECTION_MATCH_COUNT_THRESHOLD_MIN).toBe(1);
    expect(DETECTION_MATCH_COUNT_THRESHOLD_MAX).toBe(1000000);
    expect(rowNamed(rows, "**Match Count Threshold**")[1]).toContain(
      "1 to 1000000, and 1 fires on any match.",
    );
    expect(firstCells(rows)).toEqual([
      "**Evaluation Interval (Minutes)**",
      "**Group By Field**",
      "**Distinct Count Field**",
      "**Match Count Threshold**",
    ]);
  });

  it("groups and counts on the typed fields its goals name, and leaves empty values out of a distinct count", () => {
    const goals: Array<Array<string>> = rowsOf(page, "Evaluation settings", 1);
    const fields: Array<string> = goals.flatMap(
      (row: Array<string>): Array<string> => {
        return [...codeSpans(row[1] as string), ...codeSpans(row[2] as string)];
      },
    );

    expect([...new Set(fields)].sort()).toEqual([
      "principalHost",
      "principalIp",
      "principalUser",
      "targetPort",
    ]);

    for (const field of fields) {
      expect({ field, kind: resolveSigmaField(field).kind }).not.toEqual({
        field,
        kind: "attribute",
      });
    }

    expect(buildSigmaFieldExpression("principalHost").query).toBe(
      "principalHost",
    );
    expect(buildSigmaDistinctCountExpression("targetPort").query).toBe(
      "toString(nullIf(targetPort, 0))",
    );
    expect(flat(source("securityEventService"))).toContain(
      'statement.append("uniqExact(nullIf("); statement.append(data.distinctCountExpression); statement.append(", \'\'))");',
    );
  });

  it("runs the rules every minute over back-to-back windows, at most 24 hours back, firing at most the 100 highest groups", () => {
    const job: string = source("detectionJob");
    const evaluator: string = flat(source("detectionEvaluator"));
    const service: string = flat(source("securityEventService"));

    expect(job).toContain("schedule: EVERY_MINUTE,");
    expect(job).toContain("DetectionRuleEvaluator.evaluateAllDueRules()");
    expect(evaluator).toContain(
      "let startTime: Date = rule.lastEvaluatedAt ? rule.lastEvaluatedAt : OneUptimeDate.addRemoveMinutes(endTime, -intervalInMinutes); if (OneUptimeDate.isBefore(startTime, earliestAllowed)) { startTime = earliestAllowed; }",
    );
    expect(evaluator).toContain(
      "maxGroups: DETECTION_MAX_GROUPS_PER_EVALUATION,",
    );
    expect(service).toContain(
      "AND time >= ${{ type: TableColumnType.DateTime64, value: data.startTime, }} AND time < ${{ type: TableColumnType.DateTime64, value: data.endTime, }}",
    );
    expect(service).toContain(
      "statement.append(` ORDER BY ${effectiveCountColumn} DESC LIMIT `);",
    );
    expect(DETECTION_MAX_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(DETECTION_MAX_GROUPS_PER_EVALUATION).toBe(100);
    expect(page).toContain(
      "OneUptime checks every minute for enabled rules whose interval has passed since their last run.",
    );
    expect(page).toContain(
      "the next run covers the whole gap, up to the last 24 hours.",
    );
    expect(page).toContain(
      "- At most 100 groups fire per run: the ones with the highest counts.",
    );
  });

  it("picks the alert's severity in the order the engine does", () => {
    const alerting: string = flat(source("alerting"));
    const picker: string = alerting.slice(
      alerting.indexOf("export function pickSeverityByPrecedence"),
    );
    const explicitAt: number = picker.indexOf("if (explicitSeverityId) {");
    const namedAt: number = picker.indexOf(
      '(severity.name || "").toLowerCase() === severityLabel.toLowerCase()',
    );
    const rankedAt: number = picker.indexOf(
      "const chosen: TSeverity = isSevere ? severities[0]! : severities[severities.length - 1]!;",
    );
    const evaluator: string = flat(source("detectionEvaluator"));

    expect(explicitAt).toBeGreaterThan(0);
    expect(namedAt).toBeGreaterThan(explicitAt);
    expect(rankedAt).toBeGreaterThan(namedAt);
    // Severities arrive most severe first.
    expect(alerting).toContain("sort: { order: SortOrder.Ascending, },");

    for (const kind of ["alert", "incident"]) {
      expect(evaluator).toContain(
        `explicitSeverityId: data.rule.${kind}SeverityId, severityLabel: data.parsedRule.level, isSevere: isSevereSigmaLevel(data.parsedRule.level),`,
      );
    }

    expect(
      Object.values(SigmaLevel).filter((level: SigmaLevel): boolean => {
        return isSevereSigmaLevel(level);
      }),
    ).toEqual([SigmaLevel.High, SigmaLevel.Critical]);
    expect(numberedSteps(page, "Severity")).toEqual([
      "1. The rule's **Alert Severity** (or **Incident Severity**), when set.",
      "2. Your severity named after the level, such as High, whatever its case.",
      "3. By rank: `critical` and `high` rules take your most severe severity, the others your least severe.",
    ]);
  });

  it("maps each Sigma level onto the finding's OCSF severity as it says", () => {
    expect(
      Object.values(SigmaLevel).map((level: SigmaLevel): OcsfSeverity => {
        return SIGMA_LEVEL_TO_OCSF_SEVERITY[level];
      }),
    ).toEqual([
      OcsfSeverity.Informational,
      OcsfSeverity.Low,
      OcsfSeverity.Medium,
      OcsfSeverity.High,
      OcsfSeverity.Critical,
    ]);
    expect(page).toContain(
      "`informational`, `low`, `medium`, `high` and `critical` become Informational, Low, Medium, High and Critical.",
    );
  });

  it("titles a rule's alerts as the engine does, one open alert per rule and group value", () => {
    const evaluator: string = source("detectionEvaluator");

    expect(evaluator).toContain(
      "? `[Detection] ${rule.name} — ${matchGroup.groupValue}`",
    );
    expect(evaluator).toContain(": `[Detection] ${rule.name}`;");
    expect(flat(evaluator)).toContain(
      "fingerprint: this.buildFingerprint(rule.id!, matchGroup.groupValue),",
    );
    expect(evaluator).toContain("return openDedupedAlerts({");
    expect(evaluator).toContain(
      "has no alert severities; skipping alert creation for rule",
    );
    expect(page).toContain(
      "Each firing group opens an alert titled `[Detection] <rule name> — <group value>`, or `[Detection] <rule name>` for a rule without a Group By Field. While it is open, more matches for that group don't open another.",
    );
    expect(page).toContain(
      "A project needs at least one alert severity for rules to open alerts.",
    );
  });

  it("writes a Detection Finding of the class, product and attributes it names", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Alerts and findings");

    expect(DETECTION_FINDING_CLASS_NAME).toBe("Detection Finding");
    expect(DETECTION_FINDING_CLASS_UID).toBe(2004);
    expect(source("detectionEvaluator")).toContain(
      'productName: "OneUptime Detections",',
    );
    expect(page).toContain(
      "A Detection Finding is a security event of class `Detection Finding` (OCSF class 2004) from the product `OneUptime Detections`",
    );
    expect(
      rows.map((row: Array<string>): string => {
        return codeSpans(row[0] as string)[0] as string;
      }),
    ).toEqual([
      DETECTION_RULE_ID_ATTRIBUTE,
      DETECTION_RULE_NAME_ATTRIBUTE,
      DETECTION_MATCH_COUNT_ATTRIBUTE,
      DETECTION_DISTINCT_COUNT_ATTRIBUTE,
      DETECTION_GROUP_VALUE_ATTRIBUTE,
      DETECTION_SIGMA_ID_ATTRIBUTE,
    ]);
  });

  it("builds the Security Events monitor in the form the product has", () => {
    const form: string = source("monitorForm");
    const options: Array<string> = allMatches(form, WINDOW_OPTION, 1);

    for (const title of [
      "Monitor events that include this text",
      "Monitor Security Events for (time)",
      "Event Severity",
      "Event Class",
      "Filter by Telemetry Service",
      "Filter by Attributes",
    ]) {
      expect(form).toContain(`title: "${title}",`);
      expect(boldSpans(page)).toContain(title);
    }

    expect(options[0]).toBe("Last 5 seconds");
    expect(options[options.length - 1]).toBe("Last 24 hours");
    expect(
      form.split("collapsibleSection: MORE_SECURITY_EVENT_FILTERS,").length - 1,
    ).toBe(2);
    expect(source("foldTitles")).toContain('translationKey("More fields")');
    expect(CheckOn.SecurityEventCount).toBe("Security Event Count");
    expect(MonitorType.SecurityEvents).toBe("Security Events");
    expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
      MonitorType.SecurityEvents,
    );
    expect(
      rowNamed(rowsOf(page, "Security Events monitors"), "Window")[2],
    ).toBe("Rolling: the last 5 seconds to 24 hours");
    expect(page).toContain(
      "**Filter by Telemetry Service** and **Filter by Attributes** wait under **More fields**",
    );
    expect(page).toContain("Its criteria check **Security Event Count**.");
  });

  it("pre-fills a rule's monitor as it says: the Detection Finding class, the rule's id, the last hour", () => {
    const prefill: JSONObject = buildDetectionRuleMonitorPrefill({
      ruleId: "11111111-2222-4333-8444-555555555555",
      ruleName: "Failed logon burst",
      operationalStatusId: new ObjectID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
    });
    const step: MonitorStepSecurityEventsMonitor =
      securityEventsStepOf(prefill);

    expect(prefill["monitorType"]).toBe(MonitorType.SecurityEvents);
    expect(step.classNames).toEqual([DETECTION_FINDING_CLASS_NAME]);
    expect(step.attributes).toEqual({
      [DETECTION_RULE_ID_ATTRIBUTE]: "11111111-2222-4333-8444-555555555555",
    });
    expect(step.lastXSecondsOfEvents).toBe(60 * 60);
    expect(DETECTION_FINDING_MONITOR_WINDOW_SECONDS).toBe(3600);
    expect(source("detectionRules")).toContain('title: "Create Monitor",');
    expect(page).toContain(
      "The **Create Monitor** action in a rule's row opens a new monitor already set up this way: the `Detection Finding` class, the rule's id (never its name, which a rename would change), and the last hour.",
    );
  });

  it("keeps events for the project's Default Retention (Days), set under Data Retention", () => {
    const settings: string = source("settingsSideMenu");
    const telemetry: string = settings.slice(
      settings.indexOf('title: "Telemetry & APM",'),
    );

    expect(source("telemetrySettings")).toContain(
      'title: "Default Retention (Days)",',
    );
    expect(telemetry.slice(0, 600)).toContain('title: "Data Retention",');
    expect(flat(source("ingestService"))).toContain(
      'resolveTelemetryRetentionInDays({ pillar: "securityEvents",',
    );
    expect(page).toContain(
      "the project's **Default Retention (Days)**, under **Project Settings → Telemetry & APM → Data Retention**, or a retention set on the telemetry service they belong to.",
    );
  });

  it("names the Setup Guide tab, where the snippets carry the reader's own key", () => {
    expect(source("setupGuide")).toContain("/security-events/v1/ingest");
    expect(page).toContain(
      "The **Setup Guide** tab has these snippets with your own host and key filled in.",
    );
  });
});

describe("the Threat Intelligence page", () => {
  const page: string = englishPage(THREAT_INTELLIGENCE);
  const now: Date = new Date("2026-08-27T12:00:00.000Z");
  const context: StixParseContext = {
    projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    feedId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    feedName: "Docs feed",
    minimumConfidence: 0,
  };

  function stixIndicator(overrides: JSONObject = {}): JSONObject {
    return {
      type: "indicator",
      id: "indicator--0001",
      pattern: "[ipv4-addr:value = '198.51.100.7']",
      pattern_type: "stix",
      created: "2026-08-20T00:00:00.000Z",
      valid_from: "2026-08-20T00:00:00.000Z",
      confidence: 80,
      ...overrides,
    };
  }

  function ingest(
    overrides: JSONObject = {},
    minimumConfidence: number = 0,
  ): StixIndicatorParseResult {
    return ThreatIntelFeedPoller.parseStixIndicator(
      stixIndicator(overrides),
      { ...context, minimumConfidence },
      now,
    );
  }

  function clickhouseDate(value: unknown): number {
    return new Date(`${String(value).replace(" ", "T")}Z`).getTime();
  }

  it("opens the feeds from Products → Security Events → Threat Intel", () => {
    expect(source("navTabs")).toContain('label: "Threat Intel",');
    expect(page).toContain(
      "Open **Products → Security Events → Threat Intel**.",
    );
  });

  it("creates a feed in the form's four steps, with its fields", () => {
    const form: string = flat(source("threatIntel"));
    const rows: Array<Array<string>> = rowsOf(page, "Subscribe a feed");

    expect(form).toContain(
      'formSteps={[ { title: "Basic Info", id: "basic-info" }, { title: "TAXII Server", id: "taxii-server" }, { title: "Authentication", id: "authentication" }, { title: "On Match", id: "matching" }, ]}',
    );
    expect(page).toContain(
      "Click **Create Threat Intel Feed** and fill in its four steps: **Basic Info**, **TAXII Server**, **Authentication** and **On Match**.",
    );

    for (const row of rows) {
      for (const title of boldSpans(row[0] as string)) {
        expect(form).toContain(`title: "${title}",`);
      }
    }
  });

  it("names the feed's columns the first poll fills, and the Indicators table", () => {
    const form: string = source("threatIntel");

    for (const title of [
      "Last Polled",
      "Last Poll Summary",
      "Last Error",
      "Last Evaluated",
      "Last Match Error",
      "Indicators",
      "Status",
    ]) {
      expect(form).toContain(`title: "${title}",`);
    }

    expect(page).toContain(
      "Within a minute or two the feed's row shows **Last Polled**, and **Last Poll Summary** says what the poll fetched. Indicators appear in the **Indicators** table under the feeds.",
    );
  });

  it("states the poll interval's and the minimum confidence's ranges and defaults as the server holds them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Subscribe a feed");
    const form: string = flat(source("threatIntel"));

    expect(THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES).toBe(1);
    expect(THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES).toBe(1440);
    expect(THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES).toBe(60);
    expect(form).toContain(
      "pollIntervalInMinutes: THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,",
    );
    expect(rowNamed(rows, "**Poll Interval (Minutes)**")[1]).toBe(
      "How often to fetch new objects: 1 to 1440 minutes, 60 by default.",
    );
    expect(THREAT_INTEL_MINIMUM_CONFIDENCE_MIN).toBe(0);
    expect(THREAT_INTEL_MINIMUM_CONFIDENCE_MAX).toBe(100);
    expect(form).toContain("minimumConfidence: 0,");
    expect(rowNamed(rows, "**Minimum Confidence**")[1]).toBe(
      "Indicators with a lower STIX `confidence` are skipped: 0 to 100, 0 keeps everything. Indicators with no confidence always pass.",
    );
  });

  it("skips indicators below the minimum confidence, keeps everything at 0, and always passes unscored ones", () => {
    expect(ingest({ confidence: 69 }, 70).outcome).toBe("filtered");
    expect(ingest({ confidence: 70 }, 70).outcome).toBe("ingested");
    expect(ingest({ confidence: 1 }, 0).outcome).toBe("ingested");
    expect(ingest({ confidence: undefined }, 70).outcome).toBe("ingested");
  });

  it("says which match actions are on by default, as the form starts them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Subscribe a feed");
    const form: string = flat(source("threatIntel"));

    expect(form).toContain(
      "shouldCreateAlert: true, shouldWriteDetectionFinding: true, shouldCreateIncident: false,",
    );
    expect(rowNamed(rows, "**Create Alert on Match**")[1]).toMatch(
      /^On by default/,
    );
    expect(rowNamed(rows, "**Create Incident on Match**")[1]).toMatch(
      /^Off by default/,
    );
    expect(rowNamed(rows, "**Write Detection Finding on Match**")[1]).toMatch(
      /^On by default/,
    );
  });

  it("keeps tokens and passwords encrypted and unreadable, and replaces the whole sign-in on Update Credentials", () => {
    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    const form: string = flat(source("threatIntel"));

    for (const secret of ["apiToken", "basicAuthPassword"]) {
      expect(feed.getEncryptedColumns().columns).toContain(secret);
      expect(feed.getColumnAccessControlFor(secret)?.read).toEqual([]);
    }

    for (const label of [
      "API Token (Bearer)",
      "Basic Auth",
      "Anonymous (clear stored credentials)",
    ]) {
      expect(form).toContain(`label: "${label}"`);
    }

    expect(form).toContain('title: "Update Credentials",');
    expect(form).toContain(
      'if (mode === "api-token" && data["apiToken"]) { update = { apiToken: data["apiToken"], basicAuthUsername: null, basicAuthPassword: null, };',
    );
    expect(form).toContain(
      '} else if (mode === "basic-auth" && data["basicAuthPassword"]) { update = { apiToken: null,',
    );
    expect(form).toContain(
      '} else if (mode === "anonymous") { update = { apiToken: null, basicAuthUsername: null, basicAuthPassword: null, };',
    );
    expect(page).toContain(
      "Tokens and passwords are encrypted and never shown again after you save them. To change them, pick **Update Credentials** in the feed's row and choose **API Token (Bearer)**, **Basic Auth** or **Anonymous (clear stored credentials)**: your choice replaces the feed's sign-in, so saving a token clears a stored password, and the other way round.",
    );
  });

  it("polls with TAXII's added_after cursor, up to 10 pages of 500 objects, and says when more pages remain", () => {
    const poller: string = flat(source("feedPoller"));

    expect(poller).toContain("export const TAXII_PAGE_SIZE: number = 500;");
    expect(poller).toContain("export const MAX_PAGES_PER_POLL: number = 10;");
    expect(poller).toContain(
      '"more pages remain; the next poll continues from the cursor",',
    );
    expect(source("taxiiClient")).toContain(
      'searchParams.set("added_after", params.addedAfter);',
    );
    expect(page).toContain(
      "Each poll asks for the objects added since the previous one, through TAXII's `added_after` cursor, and reads up to 10 pages of 500 objects. A large collection therefore syncs over several polls: **Last Poll Summary** says when more pages remain.",
    );
  });

  it("names the user agent polls send, as the outbound user agent builds it", () => {
    const named: string = (
      page.match(NAMED_USER_AGENT) as RegExpMatchArray
    )[1] as string;

    expect(named.replace("<version>", "9.1.2")).toBe(
      OutboundUserAgent.build("9.1.2"),
    );
    expect(source("taxiiClient")).toContain("import DataSourceHttpFetch, {");
    expect(source("httpFetch")).toContain("OutboundUserAgent.withDefault(");
  });

  it("neither polls nor matches a disabled feed", () => {
    expect(flat(source("feedPoller"))).toContain("isEnabled: true,");
    expect(flat(source("matcher"))).toContain("isEnabled: true,");
    expect(page).toContain("A disabled feed is neither polled nor matched.");
  });

  it("keeps only STIX indicator objects", () => {
    expect(ingest({ type: "attack-pattern" }).outcome).toBe("not-indicator");
    expect(ingest().outcome).toBe("ingested");
    expect(page).toContain(
      "OneUptime keeps STIX `indicator` objects whose pattern is plain equality on one of these types:",
    );
  });

  it("reads each example pattern of the types table as one indicator of its type", () => {
    const rows: Array<Array<string>> = rowsOf(page, "What gets ingested");

    expect(rows.length).toBe(Object.values(ThreatIntelIndicatorType).length);

    for (const row of rows) {
      const type: string = codeSpans(row[0] as string)[0] as string;
      const pattern: string = codeSpans(row[1] as string)[0] as string;
      const parsed: Array<ParsedIndicatorValue> | null =
        StixPatternParser.parse(pattern);

      expect({
        type,
        parsed: parsed?.map((value: ParsedIndicatorValue): string => {
          return value.type;
        }),
      }).toEqual({
        type,
        parsed: [type],
      });
    }
  });

  it("takes OR-joined comparisons as one indicator each, and skips anything else whole, counting it as unsupported", () => {
    const examples: Array<string> = codeBlocksOf(
      section(page, "What gets ingested"),
    )[0]!
      .split(LINE_BREAK)
      .filter((line: string): boolean => {
        return line.trim().length > 0;
      });

    expect(examples.length).toBe(2);

    for (const example of examples) {
      expect(StixPatternParser.parse(example)?.length).toBe(2);
      expect(ingest({ pattern: example }).rows.length).toBe(2);
    }

    for (const pattern of [
      "[ipv4-addr:value = '198.51.100.7' AND domain-name:value = 'evil.example']",
      "[ipv4-addr:value = '198.51.100.7'] FOLLOWEDBY [url:value = 'http://evil.example/x']",
      "[ipv4-addr:value != '198.51.100.7']",
      "[url:value LIKE 'http://evil%']",
      "[url:value MATCHES '^http://evil']",
      "[ipv4-addr:value = '198.51.100.7'] WITHIN 300 SECONDS",
      "[process:name = 'evil.exe']",
    ]) {
      expect({ pattern, parsed: StixPatternParser.parse(pattern) }).toEqual({
        pattern,
        parsed: null,
      });
      expect({ pattern, outcome: ingest({ pattern }).outcome }).toEqual({
        pattern,
        outcome: "unsupported",
      });
    }

    expect(flat(source("feedPoller"))).toContain(
      "parts.push(`skipped ${result.unsupportedPatterns} unsupported patterns`);",
    );
  });

  it("stores values in lowercase", () => {
    expect(
      StixPatternParser.parse("[domain-name:value = 'Evil.EXAMPLE']"),
    ).toEqual([
      { type: ThreatIntelIndicatorType.DomainName, value: "evil.example" },
    ]);
    expect(
      ingest({ pattern: "[domain-name:value = 'Evil.EXAMPLE']" }).rows[0]![
        "indicatorValue"
      ],
    ).toBe("evil.example");
    expect(flat(source("indicatorService"))).toContain(
      ") AS i ON lowerUTF8(matchedObservable) = i.indicatorValue",
    );
    expect(page).toContain(
      "- Values are stored in lowercase and matched whatever their case.",
    );
  });

  it("keeps an indicator without valid_until active for 365 days from valid_from, and a revoked or lapsed one inactive", () => {
    const row: JSONObject = ingest().rows[0] as JSONObject;

    expect(THREAT_INTEL_DEFAULT_VALID_DAYS).toBe(365);
    expect(
      clickhouseDate(row["validUntil"]) - clickhouseDate(row["validFrom"]),
    ).toBe(365 * DAY_IN_MILLISECONDS);
    expect(clickhouseDate(row["validFrom"])).toBe(
      new Date("2026-08-20T00:00:00.000Z").getTime(),
    );
    expect(ingest({ revoked: true }).deadOnArrival).toBe(true);
    expect(
      ingest({ valid_until: "2026-08-21T00:00:00.000Z" }).deadOnArrival,
    ).toBe(true);
    expect(ingest().deadOnArrival).toBe(false);
    expect(page).toContain(
      "With no `valid_until`, it stays active for 365 days from `valid_from`, and polling it again doesn't extend that.",
    );
    expect(page).toContain(
      "- A revoked indicator, or one updated with a `valid_until` in the past, stops matching as soon as the update is polled.",
    );
  });

  it("shows an indicator's Status as Active, Expired or Revoked, as the table draws it", () => {
    const form: string = source("threatIntel");

    for (const status of ["Revoked", "Expired", "Active"]) {
      expect(form).toContain(`text="${status}"`);
    }

    expect(page).toContain(
      "with a **Status** of **Active**, **Expired** or **Revoked**.",
    );
  });

  it("stamps a matched event with the threat.* attributes it lists, the highest confidence winning", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Tagged as events arrive");

    expect(
      rows.flatMap((row: Array<string>): Array<string> => {
        return codeSpans(row[0] as string);
      }),
    ).toEqual([
      ENRICHMENT_MATCHED_ATTRIBUTE,
      ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
      ENRICHMENT_INDICATOR_TYPE_ATTRIBUTE,
      ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
      ENRICHMENT_FEED_ATTRIBUTE,
      ENRICHMENT_FEED_ID_ATTRIBUTE,
      ENRICHMENT_CONFIDENCE_ATTRIBUTE,
      ENRICHMENT_MATCH_COUNT_ATTRIBUTE,
    ]);
    expect(rowNamed(rows, "`threat.matched`")[1]).toBe(
      `Always \`"${ENRICHMENT_MATCHED_VALUE}"\` on a tagged event`,
    );
    expect(source("enricher")).toContain(
      "if (!best || indicator.confidence > best.confidence) {",
    );
    expect(page).toContain(
      "When several indicators match one event, the one with the highest confidence fills in these values.",
    );
  });

  it("compiles the page's rule on threat.* attributes, as attributes", () => {
    const yaml: string = codeBlockTitled(page, "threat-intel-logon.yml");
    const rule: SigmaRule = SigmaRuleParser.parse(yaml);
    const statement: Statement = compiledSql(yaml);

    expect(rule.level).toBe(SigmaLevel.Critical);
    expect(boundValues(statement)).toEqual(
      expect.arrayContaining([
        ENRICHMENT_MATCHED_ATTRIBUTE,
        ENRICHMENT_CONFIDENCE_ATTRIBUTE,
      ]),
    );
    expect(statement.query).toContain(">=");
  });

  it("matches every minute: 15 minutes first, at most 24 hours back, at most the 100 values seen in the most events", () => {
    const matcher: string = flat(source("matcher"));
    const indicators: string = flat(source("indicatorService"));

    expect(source("matchJob")).toContain("schedule: EVERY_MINUTE,");
    expect(source("pollJob")).toContain("schedule: EVERY_MINUTE,");
    expect(THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES).toBe(15);
    expect(THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION).toBe(100);
    expect(matcher).toContain(
      "let startTime: Date = feed.lastEvaluatedAt ? feed.lastEvaluatedAt : OneUptimeDate.addRemoveMinutes( endTime, -THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES, ); if (OneUptimeDate.isBefore(startTime, earliestAllowed)) { startTime = earliestAllowed; }",
    );
    expect(indicators).toContain(
      "AS e ARRAY JOIN e.observables AS matchedObservable",
    );
    expect(indicators).toContain(
      "GROUP BY i.indicatorValue ORDER BY matchCount DESC LIMIT",
    );
    expect(page).toContain(
      "- The first check covers the last 15 minutes. After an outage, the next check catches up on at most the last 24 hours.",
    );
    expect(page).toContain(
      "- Each check matches at most 100 indicator values per feed: the ones seen in the most events.",
    );
    expect(page).toContain(
      "Matching compares an indicator's value with an event's observables, not with every field",
    );
  });

  it("never matches a finding, so one match can't set off another", () => {
    expect(flat(source("indicatorService"))).toContain(
      `AND e.classUid != \${{ type: TableColumnType.Number, value: ${DETECTION_FINDING_CLASS_UID}, }}`,
    );
    expect(page).toContain(
      "Findings are never matched themselves, so one match can't set off another.",
    );
  });

  it("titles a match's alert as the matcher does, one per feed and value, and writes a finding of the product it names", () => {
    const rows: Array<Array<string>> = rowsOf(page, "What a match does");
    const matcher: string = source("matcher");

    expect(matcher).toContain(
      "title: `[Threat Intel] ${feed.name} — ${matchGroup.indicatorValue}`,",
    );
    expect(matcher).toContain("return `threat-intel:${feedId.toString()}:");
    expect(matcher).toContain(
      "has no alert severities; skipping alert creation for feed",
    );
    expect(THREAT_INTEL_PRODUCT_NAME).toBe("OneUptime Threat Intel");
    expect(page).toContain(
      "- An alert, titled `[Threat Intel] <feed name> — <indicator value>`, one per feed and value while it stays open.",
    );
    expect(page).toContain(
      "a `Detection Finding` event (OCSF class 2004) from the product `OneUptime Threat Intel`",
    );
    expect(page).toContain(
      "A project needs at least one alert severity for a feed to open alerts.",
    );
    expect(
      rows.flatMap((row: Array<string>): Array<string> => {
        return codeSpans(row[0] as string);
      }),
    ).toEqual([
      THREAT_FEED_ID_ATTRIBUTE,
      THREAT_FEED_NAME_ATTRIBUTE,
      THREAT_INDICATOR_ID_ATTRIBUTE,
      THREAT_INDICATOR_TYPE_ATTRIBUTE,
      THREAT_INDICATOR_VALUE_ATTRIBUTE,
      THREAT_CONFIDENCE_ATTRIBUTE,
      THREAT_MATCH_COUNT_ATTRIBUTE,
    ]);
  });

  it("bands confidence into threat levels exactly as the code does", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Threat levels");

    for (const row of rows.slice(0, 4)) {
      const [low, high] = (row[0] as string).split(" to ").map(Number) as [
        number,
        number,
      ];
      const level: string = row[1] as string;

      for (const confidence of [low, high]) {
        expect({
          confidence,
          level: ocsfSeverityForConfidence(confidence),
        }).toEqual({
          confidence,
          level,
        });
      }

      // One below the band's floor is in the band beneath.
      expect(ocsfSeverityForConfidence(low - 1)).not.toBe(level);
    }

    expect(rowNamed(rows, "Not scored (0 or missing)")[1]).toBe(
      OcsfSeverity.Medium,
    );
    expect(ocsfSeverityForConfidence(0)).toBe(OcsfSeverity.Medium);
    expect(ocsfSeverityForConfidence(Number.NaN)).toBe(OcsfSeverity.Medium);
  });

  it("keeps only High and Critical indicators at a minimum of 70", () => {
    for (let confidence: number = 1; confidence <= 100; confidence++) {
      const level: OcsfSeverity = ocsfSeverityForConfidence(confidence);

      expect({
        confidence,
        severe: level === OcsfSeverity.High || level === OcsfSeverity.Critical,
      }).toEqual({ confidence, severe: confidence >= 70 });
    }

    expect(page).toContain(
      "a minimum of 70 keeps only High and Critical indicators, plus unscored ones, which always pass.",
    );
  });

  it("picks the alert's severity in the order the matcher does, per indicator", () => {
    const matcher: string = flat(source("matcher"));

    for (const kind of ["alert", "incident"]) {
      expect(matcher).toContain(
        `explicitSeverityId: feed.${kind}SeverityId, severityLabel: severity, isSevere: this.isSevereSeverity(severity),`,
      );
    }

    expect(matcher).toContain(
      "return severity === OcsfSeverity.Critical || severity === OcsfSeverity.High;",
    );
    expect(matcher).toContain("this.partitionBySeverity(");
    expect(numberedSteps(page, "Threat levels")).toEqual([
      "1. The feed's **Alert Severity** (or **Incident Severity**), when set: it applies to every match from the feed.",
      "2. Your severity named after the threat level, such as High, whatever its case.",
      "3. By rank: Critical and High take your most severe severity, Medium and Low your least severe.",
    ]);
  });

  it("pre-fills a feed's monitor as it says: the Detection Finding class, the feed's id, the last hour", () => {
    const prefill: JSONObject = buildThreatIntelFeedMonitorPrefill({
      feedId: "66666666-7777-4888-8999-000000000000",
      feedName: "Abuse feed",
      operationalStatusId: null,
    });
    const step: MonitorStepSecurityEventsMonitor =
      securityEventsStepOf(prefill);

    expect(prefill["monitorType"]).toBe(MonitorType.SecurityEvents);
    expect(step.classNames).toEqual([DETECTION_FINDING_CLASS_NAME]);
    expect(step.attributes).toEqual({
      [THREAT_FEED_ID_ATTRIBUTE]: "66666666-7777-4888-8999-000000000000",
    });
    expect(step.lastXSecondsOfEvents).toBe(60 * 60);
    expect(source("threatIntel")).toContain('title: "Create Monitor",');
    expect(page).toContain(
      "event class `Detection Finding`, filtered by the feed's id in `oneuptime.threat.feed_id` (never its name, which a rename would change), over the last hour.",
    );
  });

  it("reads Last Poll Summary in the words the poller writes", () => {
    const poller: string = flat(source("feedPoller"));

    for (const words of [
      "below minimum confidence",
      "already inactive (revoked or expired)",
      "unsupported patterns",
    ]) {
      expect(poller).toContain(words);
    }

    expect(page).toContain(
      "Read **Last Poll Summary**. No objects fetched: the collection is empty or publishes no indicators. Unsupported patterns: the provider uses pattern features this page lists as skipped. Below minimum confidence: lower **Minimum Confidence**. Already inactive: the provider sent indicators that were already revoked or expired.",
    );
  });
});
