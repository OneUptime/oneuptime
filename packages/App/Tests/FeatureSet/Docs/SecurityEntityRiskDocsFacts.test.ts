import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  ACTIVITY_CARD_TITLE,
  CASES_CARD_TITLE,
  CRITICALITY_SINGULAR,
  CRITICALITY_TABLE_TITLE,
  CRITICALITY_WEIGHT_LABELS,
  ENTITY_LOOKUP_DESCRIPTION,
  ENTITY_LOOKUP_HOURS,
  ENTITY_LOOKUP_TITLE,
  HISTORY_CARD_TITLE,
  OPEN_IN_CORRELATE,
  RISKIEST_ENTITIES_TITLE,
  RESET_RISK,
  RESET_RISK_CONFIRM_DESCRIPTION,
  RISK_BREAKDOWN,
  RISK_CASES_CARD_TITLE,
  RISK_POINTS_FIELD_DESCRIPTION,
  RISK_POINTS_FIELD_TITLE,
  RISK_THRESHOLD_CARD_TITLE,
  RISK_THRESHOLD_FIELD_DESCRIPTION,
  SEARCH_ITS_EVENTS,
  SOURCES_CARD_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import PageMap from "../../../FeatureSet/Dashboard/src/Utils/PageMap";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Project from "Common/Models/DatabaseModels/Project";
import SecurityDetection from "Common/Models/DatabaseModels/SecurityDetection";
import SecurityEntityCriticalityEntry from "Common/Models/DatabaseModels/SecurityEntityCriticality";
import SecurityEntityRisk from "Common/Models/DatabaseModels/SecurityEntityRisk";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import ProjectService from "Common/Server/Services/ProjectService";
import { DetectionMatchGroup } from "Common/Server/Services/SecurityEventService";
import { IndicatorMatchGroup } from "Common/Server/Services/ThreatIntelIndicatorService";
import { SecurityDetectionSignal } from "Common/Server/Utils/SecurityCase/SecurityCaseIngest";
import { buildEntityRiskSignal } from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskCases";
import {
  SecurityRiskFinding,
  importedAlertRiskEntities,
  riskFindingsForIndicatorMatches,
  riskFindingsForRuleMatches,
} from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import SigmaRule from "Common/Types/SecurityEvent/SigmaRule";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  SecurityEntityType,
  securityEntityTypeForField,
} from "Common/Types/SecurityCase/SecurityEntity";
import {
  DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
  ENTITY_RISK_CASE_THRESHOLD_MAX,
  ENTITY_RISK_CASE_THRESHOLD_MIN,
  ENTITY_RISK_EXPLAINED_SEVERITIES,
  ENTITY_RISK_HISTORY_IN_DAYS,
  ENTITY_RISK_POINTS_BY_SEVERITY,
  ENTITY_RISK_POINTS_MAX,
  ENTITY_RISK_POINTS_MIN,
  ENTITY_RISK_WINDOW_IN_DAYS,
  RISK_DETECTION_SOURCES,
  RISK_ENTITY_TYPES,
  SECURITY_ENTITY_CRITICALITIES,
  SECURITY_ENTITY_CRITICALITY_WEIGHTS,
  SECURITY_ENTITY_RISK_LEVELS,
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
  SecurityEntityRiskLevel,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import { ENTITY_RISK_MARKDOWN_SOURCE_LIMIT } from "Common/Utils/SecurityCase/SecurityCaseMarkdown";
import {
  ENTITY_RISK_WINDOW_IN_MS,
  SecurityEntityCriticalityRule,
  SecurityEntityRiskSummary,
  addRiskObservation,
  computeEntityRisk,
  findEntityCriticalityRule,
  getCriticalityWeight,
  getEntityRiskLevel,
  getRiskCaseThresholdError,
  getRiskDetectionSeverity,
  getRiskPointsForSeverity,
  getRiskSinceLastCase,
  resolveRiskPoints,
  shouldRaiseRiskCase,
  weightRiskScore,
} from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import SigmaRuleParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Entity Risk page, held to the product it describes: the points each
 * severity adds, the week a source counts for, how often scores are
 * checked, the levels against the threshold and the threshold's range, the
 * criticality weights, a rule's Risk Points, the parts of an entity's page
 * and who may change or reset what are the code's own constants and
 * arithmetic, and every name it puts in bold is the Dashboard's own word.
 * A change to any of them fails here until the page says so too.
 *
 * Its other languages are held line for line to this one by
 * AiToolingAndSecurityDocsTranslations.
 */

const PAGE: string = "telemetry/security-entity-risk";

const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

const LINE_BREAK: RegExp = /\n/;
const RANGE: RegExp = /^(\d+) to (\d+)$/;
const OPEN_RANGE: RegExp = /^(\d+) or more$/;
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function englishPage(): string {
  return readPage("en", PAGE);
}

function source(relative: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relative), "utf8");
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function bold(text: string): string {
  return `**${text}**`;
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

// The rows of a section's first table, under its header row.
function rowsOf(heading: string): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(
    section(englishPage(), heading),
  );

  expect(found.length).toBeGreaterThan(0);

  return (found[0] as Array<Array<string>>).slice(1);
}

function column(rows: Array<Array<string>>, index: number): Array<string> {
  return rows.map((row: Array<string>): string => {
    return row[index] as string;
  });
}

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_IN_MS).toISOString();
}

function contribution(
  overrides: Partial<SecurityEntityRiskContribution>,
): SecurityEntityRiskContribution {
  return {
    sourceKey: "rule:1",
    source: SecurityDetectionSource.DetectionRule,
    sourceName: "Brute force",
    severity: OcsfSeverity.High,
    points: ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.High],
    hits: 1,
    firstSeenAt: hoursAgo(5),
    lastSeenAt: hoursAgo(1),
    mitreTactics: [],
    mitreTechniques: [],
    ...overrides,
  };
}

function menuSection(title: string): SecurityEventsMenuSection {
  const found: SecurityEventsMenuSection | undefined =
    SECURITY_EVENTS_MENU.find((menu: SecurityEventsMenuSection): boolean => {
      return menu.title === title;
    });

  expect(found).toBeDefined();

  return found as SecurityEventsMenuSection;
}

function menuItem(
  menu: SecurityEventsMenuSection,
  title: string,
): SecurityEventsMenuItem {
  const found: SecurityEventsMenuItem | undefined = menu.items.find(
    (item: SecurityEventsMenuItem): boolean => {
      return item.title === title;
    },
  );

  expect(found).toBeDefined();

  return found as SecurityEventsMenuItem;
}

function sigma(level: string): SigmaRule {
  return SigmaRuleParser.parse(`
title: Brute force from one address
level: ${level}
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`);
}

function rule(overrides: Partial<DetectionRule> = {}): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  model._id = "11111111-1111-4111-8111-111111111111";
  model.projectId = PROJECT_ID;
  model.name = "Brute force";
  model.groupByField = "principalUser";
  Object.assign(model, overrides);
  return model;
}

function matchGroup(groupValue: string): DetectionMatchGroup {
  return {
    groupValue,
    matchCount: 12,
    distinctCount: 0,
    sampleMessage: "",
    sampleObservables: [],
  };
}

function entitiesOf(findings: Array<SecurityRiskFinding>): Array<string> {
  return findings.flatMap((finding: SecurityRiskFinding): Array<string> => {
    return finding.entities.map((entity: SecurityEntity): string => {
      return `${entity.type}: ${entity.value}`;
    });
  });
}

function criticalityRule(
  value: string,
  criticality: SecurityEntityCriticality,
  entityType?: SecurityEntityType,
): SecurityEntityCriticalityRule {
  return { value, criticality, entityType: entityType || null };
}

describe("Entity Risk docs", () => {
  const page: string = englishPage();

  it("opens Entity Risk where the menu has it, and an entity's page from it", () => {
    const entityRisk: SecurityEventsMenuItem = menuItem(
      menuSection("Events"),
      "Entity Risk",
    );

    expect(entityRisk.page).toBe(PageMap.SECURITY_EVENTS_ENTITY_RISK);
    expect(entityRisk.detailPages).toEqual([
      PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW,
    ]);
    expect(page).toContain(
      `Open ${bold("Products → Security Events → Entity Risk")}: every user, host and IP address with risk now, the riskiest first`,
    );

    // The users, hosts and addresses: the only kinds that carry risk.
    expect(RISK_ENTITY_TYPES).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
    ]);

    // Click View on a row, or the risk beside an entity on a case's Entities.
    const list: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/EntityRisk.tsx`),
    );

    expect(list).toContain('viewButtonText="View"');
    expect(list).toContain('sortBy="riskScore"');
    expect(list).toContain("riskScore: new GreaterThan(0)");
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityCase/SecurityCaseEntitiesCard.tsx`,
        ),
      ),
    ).toContain("to={getEntityRiskRoute(props.entityValue, props.entityType)}");
    expect(page).toContain(
      `Click ${bold("View")} on a row of ${bold("Entity Risk")}, or the risk beside an entity on a case's ${bold("Entities")} page:`,
    );
  });

  /*
   * One riskiest list: the Overview's Riskiest Entities is the top of this
   * one, read with the overview (SecurityRiskiestEntities), and Look Up an
   * Entity - any value, of any kind, over 30 days - sits under it, since
   * the Entities page folded into Entity Risk.
   */
  it("says the Overview's Riskiest Entities is the top of this list, and Look Up an Entity is under it", () => {
    expect(page).toContain(
      `Each one opens on a page of its own. The Overview's ${bold(RISKIEST_ENTITIES_TITLE)} shows the top of this list, and ${bold(ENTITY_LOOKUP_TITLE)}, under it, looks any value up across 30 days of events, a domain or a file hash too.`,
    );

    // 30 days, of any kind: what the lookup reads and says.
    expect(ENTITY_LOOKUP_HOURS).toBe(30 * 24);
    expect(ENTITY_LOOKUP_DESCRIPTION).toContain("domain or file hash");
    expect(ENTITY_LOOKUP_DESCRIPTION).toContain("over the last 30 days");

    // The Overview's card reads Entity Risk's own rows, the riskiest first.
    const reader: string = flat(
      source(
        "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities.ts",
      ),
    );
    expect(reader).toContain("riskScore: QueryHelper.greaterThan(0)");
    expect(reader).toContain(
      "sort: { riskScore: SortOrder.Descending, lastRiskAt: SortOrder.Descending, }",
    );
    expect(reader).toContain("SecurityEntityRiskService.findBy(");

    // The lookup is drawn under the list.
    const list: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/EntityRisk.tsx`),
    );
    expect(list.indexOf("<EntityLookupCard />")).toBeGreaterThan(
      list.indexOf("<ModelTable<SecurityEntityRisk>"),
    );
  });

  it("names the points of each severity as the score counts them", () => {
    const rows: Array<Array<string>> = rowsOf("How a score is counted");

    expect(rows).toEqual(
      ENTITY_RISK_EXPLAINED_SEVERITIES.map(
        (severity: OcsfSeverity): Array<string> => {
          return [severity, `${getRiskPointsForSeverity(severity)} points`];
        },
      ),
    );

    // Informational adds nothing; unknown (or unreadable) counts as Medium.
    expect(getRiskPointsForSeverity(OcsfSeverity.Informational)).toBe(0);
    expect(getRiskPointsForSeverity(OcsfSeverity.Unknown)).toBe(
      getRiskPointsForSeverity(OcsfSeverity.Medium),
    );
    expect(getRiskPointsForSeverity("not a severity")).toBe(
      getRiskPointsForSeverity(OcsfSeverity.Medium),
    );
    expect(page).toContain(
      "An informational finding adds nothing, and a finding of unknown severity counts as Medium.",
    );

    // The rule form's field says the same points, in the same order.
    expect(RISK_POINTS_FIELD_DESCRIPTION).toContain(
      `by its level - ${ENTITY_RISK_EXPLAINED_SEVERITIES.map(
        (severity: OcsfSeverity): string => {
          return `${severity} ${ENTITY_RISK_POINTS_BY_SEVERITY[severity]}`;
        },
      ).join(", ")}.`,
    );
  });

  it("says where each source's points go: the grouped value, the indicator's address, the alert's user and host", () => {
    // A rule's points go to the value it groups by, typed by its field.
    expect(
      entitiesOf(
        riskFindingsForRuleMatches({
          rule: rule(),
          parsedRule: sigma("high"),
          matchedGroups: [matchGroup("k.morgan@acme-commerce.example")],
          seenAt: NOW,
        }),
      ),
    ).toEqual(["User: k.morgan@acme-commerce.example"]);

    // A rule that groups by nothing names nobody, and adds no risk.
    expect(
      riskFindingsForRuleMatches({
        rule: rule({ groupByField: "" }),
        parsedRule: sigma("high"),
        matchedGroups: [matchGroup("")],
        seenAt: NOW,
      }),
    ).toEqual([]);

    // The fields the page names, as the rule form's Group By Field takes them.
    expect(securityEntityTypeForField("principalUser")).toBe(
      SecurityEntityType.User,
    );
    expect(securityEntityTypeForField("principalHost")).toBe(
      SecurityEntityType.Host,
    );
    expect(securityEntityTypeForField("principalIp")).toBe(
      SecurityEntityType.IpAddress,
    );
    expect(flat(section(page, "Before you begin"))).toContain(
      `${bold("Group By Field")}, such as \`principalUser\`, \`principalHost\` or \`principalIp\`, or the fields a correlation groups by. A rule that groups by nothing adds no risk.`,
    );

    // A threat intel match adds to the address the indicator names, only.
    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    feed._id = "99999999-9999-4999-8999-999999999999";
    feed.projectId = PROJECT_ID;
    feed.name = "Abuse feed";

    const indicator: (value: string) => IndicatorMatchGroup = (
      value: string,
    ): IndicatorMatchGroup => {
      return {
        indicatorValue: value,
        stixId: "indicator--1",
        indicatorType: "ipv4-addr",
        indicatorName: "Known scanner",
        confidence: 80,
        matchCount: 3,
        sampleMessage: "",
        sampleObservables: [],
      };
    };

    expect(
      entitiesOf(
        riskFindingsForIndicatorMatches({
          feed,
          matchedGroups: [
            indicator("203.0.113.7"),
            indicator("evil.example.com"),
          ],
          seenAt: NOW,
        }),
      ),
    ).toEqual(["IP Address: 203.0.113.7"]);

    // A product's alert: the user and the host it names, or else its address.
    expect(
      importedAlertRiskEntities({
        principalUser: "k.morgan",
        principalHost: "web-01",
        principalIp: "203.0.113.7",
      } as NormalizedSecurityEvent).map((entity: SecurityEntity): string => {
        return `${entity.type}: ${entity.value}`;
      }),
    ).toEqual(["User: k.morgan", "Host: web-01"]);
    expect(
      importedAlertRiskEntities({
        principalIp: "203.0.113.7",
      } as NormalizedSecurityEvent).map((entity: SecurityEntity): string => {
        return `${entity.type}: ${entity.value}`;
      }),
    ).toEqual(["IP Address: 203.0.113.7"]);

    expect(page).toContain(
      "A detection rule's points go to the value it groups by. A threat intelligence match adds to the IP address the indicator names. A connected product's alert adds to the user and the host it names, or else to its IP address.",
    );
  });

  it("counts each source once a week at the most it added, and lets it go after a quiet week", () => {
    expect(ENTITY_RISK_WINDOW_IN_DAYS).toBe(7);
    expect(page).toContain(
      `counts once in ${ENTITY_RISK_WINDOW_IN_DAYS} days, at the most it added, however often it fires`,
    );
    expect(page).toContain(
      `A source that has found nothing for ${ENTITY_RISK_WINDOW_IN_DAYS} days stops counting, and the score falls.`,
    );

    // One rule firing three times, at High then Medium: once, at 50.
    let sources: Array<SecurityEntityRiskContribution> = [];

    for (const [severity, hoursBefore] of [
      [OcsfSeverity.High, 30],
      [OcsfSeverity.Medium, 20],
      [OcsfSeverity.Medium, 10],
    ] as Array<[OcsfSeverity, number]>) {
      const seenAt: Date = new Date(NOW.getTime() - hoursBefore * HOUR_IN_MS);

      sources = addRiskObservation(
        sources,
        {
          sourceKey: "rule:1",
          source: SecurityDetectionSource.DetectionRule,
          sourceName: "Brute force",
          severity,
          points: getRiskPointsForSeverity(severity),
          seenAt,
          mitreTactics: [],
          mitreTechniques: [],
        },
        seenAt,
      );
    }

    expect(sources).toHaveLength(1);
    expect(sources[0]?.hits).toBe(3);
    expect(computeEntityRisk({ contributions: sources, now: NOW }).score).toBe(
      ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.High],
    );

    // A week after its last finding it no longer counts.
    const lastSeen: number = new Date(sources[0]!.lastSeenAt).getTime();

    expect(
      computeEntityRisk({
        contributions: sources,
        now: new Date(lastSeen + ENTITY_RISK_WINDOW_IN_MS + 1),
      }).score,
    ).toBe(0);
  });

  it("checks scores every 15 minutes", () => {
    const worker: string = flat(
      source("App/FeatureSet/Workers/Jobs/SecurityEvents/EntityRisk.ts"),
    );

    expect(worker).toContain(
      'RunCron( "SecurityEntityRisk:Refresh", { schedule: EVERY_FIFTEEN_MINUTE,',
    );
    expect(worker).toContain("await SecurityEntityRiskRecorder.refreshDue();");
    expect(EVERY_FIFTEEN_MINUTE).toBe("*/15 * * * *");
    expect(page).toContain(
      "Scores are checked every 15 minutes, so a score falls on time without a new finding.",
    );
  });

  it("adds no risk from the test attack or a case opened by hand", () => {
    expect(RISK_DETECTION_SOURCES).toEqual([
      SecurityDetectionSource.DetectionRule,
      SecurityDetectionSource.ThreatIntel,
      SecurityDetectionSource.ConnectedProduct,
    ]);
    expect(
      flat(
        source("Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator.ts"),
      ),
    ).toContain(
      "if (!setupTest) { await SecurityEntityRiskRecorder.record( riskFindingsForRuleMatches({",
    );
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityOverview/SecuritySetupTest.tsx`,
        ),
      ),
    ).toContain('title="Send a test attack"');
    expect(page).toContain(
      `The test attack from ${bold("Send a test attack")}, and a case someone opens by hand, add no risk.`,
    );
  });

  it("reads each score as a level against the threshold, as the levels table says", () => {
    const threshold: number = DEFAULT_ENTITY_RISK_CASE_THRESHOLD;
    const rows: Array<Array<string>> = rowsOf("Risk levels and cases");

    expect(threshold).toBe(100);
    expect(
      new Project().getTableColumnMetadata("securityRiskCaseThreshold")
        .defaultValue,
    ).toBe(threshold);
    expect(page).toContain(
      `Each score reads as a level against the project's threshold, ${threshold} unless you change it:`,
    );

    // The least risky first.
    expect(column(rows, 1)).toEqual([...SECURITY_ENTITY_RISK_LEVELS].reverse());

    for (const row of rows) {
      const [range, level, outcome] = row as [string, string, string];
      const closed: RegExpMatchArray | null = range.match(RANGE);
      const open: RegExpMatchArray | null = range.match(OPEN_RANGE);
      const from: number = Number((closed || open)?.[1]);
      const to: number = closed ? Number(closed[2]) : from * 1000;

      expect({ range, from: Number.isFinite(from) }).toEqual({
        range,
        from: true,
      });

      // The whole range reads as the row's level, and the next score up does not.
      expect(getEntityRiskLevel(from, threshold)).toBe(level);
      expect(getEntityRiskLevel(to, threshold)).toBe(level);
      expect(getEntityRiskLevel(from - 1, threshold)).not.toBe(level);

      if (closed) {
        expect(getEntityRiskLevel(to + 1, threshold)).not.toBe(level);
      }

      const opensCase: boolean = shouldRaiseRiskCase({
        isEnabled: true,
        threshold,
        riskSinceLastCase: from,
      });

      if (outcome === "Listed under Entity Risk") {
        expect(opensCase).toBe(false);
        expect(
          shouldRaiseRiskCase({
            isEnabled: true,
            threshold,
            riskSinceLastCase: to,
          }),
        ).toBe(false);
      } else {
        expect(outcome).toBe(`A case opens, at ${level}`);
        expect(opensCase).toBe(true);
        // The detection, and so the case's priority, at the row's level.
        expect(getRiskDetectionSeverity(from, threshold)).toBe(level);
      }
    }

    // Nothing at all reads as no level, and is not listed.
    expect(getEntityRiskLevel(0, threshold)).toBe(SecurityEntityRiskLevel.None);
  });

  it("titles the risk case after the entity and lists the sources that added most, up to 10", () => {
    const entity: SecurityEntity = {
      type: SecurityEntityType.User,
      value: "k.morgan@acme-commerce.example",
    };
    const sources: Array<SecurityEntityRiskContribution> = [
      contribution({ sourceKey: "rule:1", sourceName: "Brute force" }),
      contribution({
        sourceKey: "intel:1",
        source: SecurityDetectionSource.ThreatIntel,
        sourceName: "Abuse feed",
        hits: 4,
      }),
    ];
    const signal: SecurityDetectionSignal = buildEntityRiskSignal({
      projectId: PROJECT_ID,
      entity,
      summary: computeEntityRisk({ contributions: sources, now: NOW }),
      threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
      now: NOW,
    });

    expect(signal.source).toBe(SecurityDetectionSource.EntityRisk);
    expect(page).toContain(
      `a detection from the source ${SecurityDetectionSource.EntityRisk} is raised about it`,
    );
    expect(signal.groupValue).toBe(entity.value);
    expect(page).toContain(`such as \`${signal.title}\``);
    expect(signal.title).toBe("High risk — k.morgan@acme-commerce.example");

    // Each source, with its points, how often it fired and when it last did.
    expect(signal.description).toContain(
      "**Brute force** (Detection Rule, High): 50 points, fired once, last",
    );
    expect(signal.description).toContain(
      "**Abuse feed** (Threat Intel, High): 50 points, fired 4 times, last",
    );

    // The most first, up to the limit; the rest are on the entity's page.
    const many: Array<SecurityEntityRiskContribution> = Array.from(
      { length: ENTITY_RISK_MARKDOWN_SOURCE_LIMIT + 2 },
      (_: unknown, index: number): SecurityEntityRiskContribution => {
        return contribution({
          sourceKey: `rule:${index}`,
          sourceName: `Rule ${index}`,
          points: index + 1,
        });
      },
    );
    const crowded: SecurityDetectionSignal = buildEntityRiskSignal({
      projectId: PROJECT_ID,
      entity,
      summary: computeEntityRisk({ contributions: many, now: NOW }),
      threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
      now: NOW,
    });

    expect(ENTITY_RISK_MARKDOWN_SOURCE_LIMIT).toBe(10);
    expect(crowded.description).toContain(
      `**Rule ${ENTITY_RISK_MARKDOWN_SOURCE_LIMIT + 1}**`,
    );
    expect(crowded.description).not.toContain("**Rule 0**");
    expect(crowded.description).toContain("And 2 more, on the entity's page.");
    expect(page).toContain(
      `it lists the sources that added the most to the risk, up to ${ENTITY_RISK_MARKDOWN_SOURCE_LIMIT}, with their points, how often each fired and when it last did.`,
    );
  });

  it("opens the next case only from what is new since the last one", () => {
    const sources: Array<SecurityEntityRiskContribution> = [
      contribution({ sourceKey: "rule:1", firstSeenAt: hoursAgo(50) }),
      contribution({ sourceKey: "rule:2", firstSeenAt: hoursAgo(40) }),
      contribution({ sourceKey: "rule:3", firstSeenAt: hoursAgo(2) }),
    ];
    const riskCaseAt: Date = new Date(NOW.getTime() - 30 * HOUR_IN_MS);
    const sinceLastCase: number = getRiskSinceLastCase({
      contributions: sources,
      riskCaseAt,
      now: NOW,
    });

    expect(computeEntityRisk({ contributions: sources, now: NOW }).score).toBe(
      150,
    );
    expect(sinceLastCase).toBe(50);
    expect(
      shouldRaiseRiskCase({
        isEnabled: true,
        threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
        riskSinceLastCase: sinceLastCase,
      }),
    ).toBe(false);
    expect(page).toContain(
      "Once a case opens about an entity's risk, what was behind it is not counted again: another case opens only when sources new since then add up to the threshold again.",
    );
  });

  it("takes a threshold from 10 to 10000, with Medium at half of it and Critical at twice it", () => {
    expect(page).toContain(
      `Change the threshold under ${bold(`Products → Security Events → Settings → Risk Scoring → ${RISK_THRESHOLD_CARD_TITLE}`)}: a whole number from ${ENTITY_RISK_CASE_THRESHOLD_MIN} to ${ENTITY_RISK_CASE_THRESHOLD_MAX}. Medium starts at half of it and Critical at twice it, on every page.`,
    );
    expect(RISK_THRESHOLD_FIELD_DESCRIPTION).toContain(
      `A whole number from ${ENTITY_RISK_CASE_THRESHOLD_MIN} to ${ENTITY_RISK_CASE_THRESHOLD_MAX}.`,
    );

    expect(getRiskCaseThresholdError(ENTITY_RISK_CASE_THRESHOLD_MIN)).toBe(
      null,
    );
    expect(getRiskCaseThresholdError(ENTITY_RISK_CASE_THRESHOLD_MAX)).toBe(
      null,
    );
    expect(
      getRiskCaseThresholdError(ENTITY_RISK_CASE_THRESHOLD_MIN - 1),
    ).not.toBe(null);
    expect(
      getRiskCaseThresholdError(ENTITY_RISK_CASE_THRESHOLD_MAX + 1),
    ).not.toBe(null);
    expect(getRiskCaseThresholdError(150.5)).not.toBe(null);

    for (const threshold of [ENTITY_RISK_CASE_THRESHOLD_MIN, 300, 5000]) {
      expect(getEntityRiskLevel(threshold / 2, threshold)).toBe(
        SecurityEntityRiskLevel.Medium,
      );
      expect(getEntityRiskLevel(threshold / 2 - 1, threshold)).toBe(
        SecurityEntityRiskLevel.Low,
      );
      expect(getEntityRiskLevel(threshold, threshold)).toBe(
        SecurityEntityRiskLevel.High,
      );
      expect(getEntityRiskLevel(threshold * 2, threshold)).toBe(
        SecurityEntityRiskLevel.Critical,
      );
      expect(getEntityRiskLevel(threshold * 2 - 1, threshold)).toBe(
        SecurityEntityRiskLevel.High,
      );
    }

    // Settings > Risk Scoring, where the menu has it.
    expect(menuItem(menuSection("Settings"), "Risk Scoring").page).toBe(
      PageMap.SECURITY_EVENTS_SETTINGS_RISK_SCORING,
    );
  });

  it("opens risk cases on new projects, and keeps them off on projects from before", () => {
    const created: { enableSecurityRiskCases?: boolean | null } = {};

    ProjectService.applyNewProjectSecurityDefaults(created);
    expect(created.enableSecurityRiskCases).toBe(true);

    const refused: { enableSecurityRiskCases?: boolean | null } = {
      enableSecurityRiskCases: false,
    };

    ProjectService.applyNewProjectSecurityDefaults(refused);
    expect(refused.enableSecurityRiskCases).toBe(false);

    // The column, and the migration that adds it, default to off.
    expect(
      new Project().getTableColumnMetadata("enableSecurityRiskCases")
        .defaultValue,
    ).toBe(false);
    expect(
      source(
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1807600000000-AddSecurityEntityRisk.ts",
      ),
    ).toContain(
      'ALTER TABLE "Project" ADD "enableSecurityRiskCases" boolean NOT NULL DEFAULT false',
    );

    // Off, risk is scored either way, and Entity Risk says so above its list.
    expect(
      shouldRaiseRiskCase({
        isEnabled: false,
        threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
        riskSinceLastCase: ENTITY_RISK_CASE_THRESHOLD_MAX,
      }),
    ).toBe(false);
    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/EntityRisk.tsx`)),
    ).toContain("settings.isRiskCaseEnabled === false ? ( <div className=");
    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/EntityRisk.tsx`)),
    ).toContain("{translator.translateText(RISK_CASES_OFF_TITLE)}");

    expect(flat(section(page, "Turn risk cases on or off"))).toContain(
      `${bold(RISK_CASES_CARD_TITLE)}, under ${bold("Settings → Risk Scoring")}, decides whether risk opens cases, and saves as you flip it. New projects start with it on. A project created before Entity Risk keeps it off until someone turns it on, and ${bold("Entity Risk")} says so above its list. Risk is scored and listed either way.`,
    );

    // Security Cases and Playbooks says the same where it lists the sources.
    expect(readPage("en", "telemetry/security-cases")).toContain(
      `Every source opens cases by default, except entity risk on projects created before it existed, which turn on ${bold(RISK_CASES_CARD_TITLE)} first ([Entity Risk](/docs/${PAGE})).`,
    );
  });

  it("weighs a score by its entity's criticality, as the criticality table says", () => {
    const rows: Array<Array<string>> = rowsOf("Entity criticality");
    const byWeight: Array<SecurityEntityCriticality | null> = [
      ...SECURITY_ENTITY_CRITICALITIES,
      null,
    ].sort(
      (
        a: SecurityEntityCriticality | null,
        b: SecurityEntityCriticality | null,
      ): number => {
        return getCriticalityWeight(a) - getCriticalityWeight(b);
      },
    );

    expect(rows).toEqual(
      byWeight.map(
        (criticality: SecurityEntityCriticality | null): Array<string> => {
          return [
            criticality || "Not listed",
            `×${getCriticalityWeight(criticality)}`,
          ];
        },
      ),
    );

    // The Dashboard's choices carry the same weights.
    for (const criticality of SECURITY_ENTITY_CRITICALITIES) {
      expect(
        (CRITICALITY_WEIGHT_LABELS as Record<string, string>)[criticality],
      ).toBe(
        `${criticality} (×${SECURITY_ENTITY_CRITICALITY_WEIGHTS[criticality]})`,
      );
    }

    expect(CRITICALITY_TABLE_TITLE).toBe("Entity Criticality");
    expect(CRITICALITY_SINGULAR).toBe("Entity");

    const settings: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/Settings/RiskScoring.tsx`),
    );

    expect(settings).toContain(
      'singularName={CRITICALITY_SINGULAR} pluralName={CRITICALITY_PLURAL} createVerb="Add"',
    );
    expect(settings).toContain("title: CRITICALITY_TABLE_TITLE,");
    expect(page).toContain(
      `List them under ${bold(`Settings → Risk Scoring → ${CRITICALITY_TABLE_TITLE}`)} with ${bold(`Add ${CRITICALITY_SINGULAR}`)}:`,
    );

    /*
     * The breakdown on an entity's page: what its sources add up to, the
     * weight of its criticality and the score they make, as the page draws
     * them (EntityRiskModel.getEntityRiskBreakdown, read as source: it
     * imports the Dashboard's routes, which need a browser).
     */
    const risk: SecurityEntityRiskSummary = computeEntityRisk({
      contributions: [
        contribution({ sourceKey: "rule:1" }),
        contribution({ sourceKey: "rule:2" }),
      ],
      criticality: SecurityEntityCriticality.Extreme,
      now: NOW,
    });
    const weight: number = getCriticalityWeight(
      SecurityEntityCriticality.Extreme,
    );

    expect(risk.baseScore).toBe(100);
    expect(risk.score).toBe(
      weightRiskScore(100, SecurityEntityCriticality.Extreme),
    );
    expect(risk.score).toBe(200);
    expect(page).toContain(
      `The entity's page shows the sum of its sources and the weight, such as ${fill(
        RISK_BREAKDOWN,
        {
          base: String(risk.baseScore),
          weight: String(weight),
          score: String(risk.score),
        },
      )}.`,
    );

    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityRiskModel.ts`,
        ),
      ),
    ).toContain(
      "baseScore, criticality, weight: getCriticalityWeight(criticality), sources,",
    );
    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/EntityRiskView.tsx`)),
    ).toContain(
      "translator.translateTemplate(RISK_BREAKDOWN, { base: translator.formatNumber(breakdown.baseScore), weight: translator.formatNumber(breakdown.weight), score: translator.formatNumber(breakdown.score), })",
    );
  });

  it("matches an entry by value or pattern, whatever its case, the most specific first", () => {
    const host: (value: string) => SecurityEntity = (
      value: string,
    ): SecurityEntity => {
      return { type: SecurityEntityType.Host, value };
    };
    const user: (value: string) => SecurityEntity = (
      value: string,
    ): SecurityEntity => {
      return { type: SecurityEntityType.User, value };
    };

    // dc-* names every domain controller; *@contractors.example every contractor.
    const rules: Array<SecurityEntityCriticalityRule> = [
      criticalityRule("dc-*", SecurityEntityCriticality.Extreme),
      criticalityRule("*@contractors.example", SecurityEntityCriticality.Low),
    ];

    expect(
      findEntityCriticalityRule({ entity: host("DC-01"), rules })?.value,
    ).toBe("dc-*");
    expect(
      findEntityCriticalityRule({
        entity: user("Sam@Contractors.example"),
        rules,
      })?.value,
    ).toBe("*@contractors.example");
    expect(page).toContain(
      "An entry is a value or a `*` pattern, matched whatever its case: `dc-*` names every domain controller, and `*@contractors.example` every contractor.",
    );

    // Type narrows an entry to one kind; empty matches any.
    expect(
      findEntityCriticalityRule({
        entity: user("dc-01"),
        rules: [
          criticalityRule(
            "dc-*",
            SecurityEntityCriticality.Extreme,
            SecurityEntityType.Host,
          ),
        ],
      }),
    ).toBeUndefined();
    expect(page).toContain(
      `${bold("Type")} narrows it to users, hosts or IP addresses; empty matches any of them.`,
    );

    // A value written out over a pattern, a longer pattern over a shorter one.
    expect(
      findEntityCriticalityRule({
        entity: host("dc-01"),
        rules: [
          criticalityRule("dc-*", SecurityEntityCriticality.Extreme),
          criticalityRule("dc-01", SecurityEntityCriticality.Low),
        ],
      })?.value,
    ).toBe("dc-01");
    expect(
      findEntityCriticalityRule({
        entity: host("dc-02"),
        rules: [
          criticalityRule("*", SecurityEntityCriticality.Extreme),
          criticalityRule("dc-*", SecurityEntityCriticality.Low),
        ],
      })?.value,
    ).toBe("dc-*");
    expect(page).toContain(
      "When several entries name an entity, the most specific counts: a value written out over a pattern, and a longer pattern over a shorter one.",
    );

    // A change to the list weighs every entity anew, in the background.
    const service: string = flat(
      source("Common/Server/Services/SecurityEntityCriticalityService.ts"),
    );

    expect(service).toContain(
      "await queueSecurityEntityRiskRecompute(createdItem.projectId);",
    );
    expect(service).toContain(
      "await this.recomputeProjects(onUpdate.carryForward);",
    );
    expect(service).toContain(
      "await this.recomputeProjects(onDelete.carryForward);",
    );
    expect(page).toContain(
      "A change reaches every entity's score within minutes.",
    );
  });

  it("names the parts of an entity's page as the page draws them, in its order", () => {
    const rows: Array<Array<string>> = rowsOf("An entity's page");

    expect(column(rows, 0)).toEqual([
      "The header",
      bold(ACTIVITY_CARD_TITLE),
      bold(SOURCES_CARD_TITLE),
      bold(HISTORY_CARD_TITLE),
      bold(CASES_CARD_TITLE),
    ]);

    const view: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/EntityRiskView.tsx`),
    );
    const order: Array<number> = [
      view.indexOf("<Card title={ACTIVITY_CARD_TITLE}>"),
      view.indexOf("<EntityRiskSources "),
      view.indexOf("<EntityRiskHistory "),
      view.indexOf("<EntityRiskCases "),
    ];

    expect(
      order.every((at: number): boolean => {
        return at > 0;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);

    // Each card under its own title.
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityRiskSources.tsx`,
        ),
      ),
    ).toContain("<Card title={SOURCES_CARD_TITLE}");
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityRiskHistory.tsx`,
        ),
      ),
    ).toContain("<Card title={HISTORY_CARD_TITLE}");
    expect(
      flat(
        source(
          `${DASHBOARD}/Components/SecurityEvents/EntityRisk/EntityRiskCases.tsx`,
        ),
      ),
    ).toContain("title: CASES_CARD_TITLE,");

    // The activity of the week risk counts over, and a month of history.
    expect(view).toContain(
      "export const ENTITY_ACTIVITY_HOURS: number = ENTITY_RISK_WINDOW_IN_DAYS * 24;",
    );
    expect(rows[1]?.[1]).toBe(
      `Its security events and findings over the last ${ENTITY_RISK_WINDOW_IN_DAYS} days`,
    );
    expect(ENTITY_RISK_HISTORY_IN_DAYS).toBe(30);
    expect(HISTORY_CARD_TITLE).toBe(
      `Risk Over the Last ${ENTITY_RISK_HISTORY_IN_DAYS} Days`,
    );
  });

  it("says what the entity page's buttons do, and that a reset takes the right to delete security data and is audited", () => {
    expect(page).toContain(
      `${bold(OPEN_IN_CORRELATE)} draws a graph of its events, and ${bold(SEARCH_ITS_EVENTS)} opens ${bold("Events")} on its week. ${bold(RESET_RISK)} clears its score and its sources, after a planned test for instance: what is found next counts from zero, and its cases are not changed.`,
    );
    expect(RESET_RISK_CONFIRM_DESCRIPTION).toContain(
      "what is found next counts from zero",
    );
    expect(RESET_RISK_CONFIRM_DESCRIPTION).toContain(
      "Its cases are not changed.",
    );

    // Who may delete security data may reset; the reset is in the audit log.
    expect(new SecurityEntityRisk().getDeletePermissions().sort()).toEqual(
      new SecurityDetection().getDeletePermissions().sort(),
    );
    expect(new SecurityEntityRisk().getDeletePermissions()).not.toContain(
      Permission.SecurityMember,
    );
    expect(new SecurityEntityRisk().enableAuditLogOn).toEqual({
      create: false,
      update: false,
      delete: true,
    });
    expect(
      flat(source(`${DASHBOARD}/Pages/SecurityEvents/EntityRiskView.tsx`)),
    ).toContain(
      "PermissionGate.check( new SecurityEntityRisk(), ModelAction.Delete, );",
    );
    expect(page).toContain(
      "Resetting takes a role that can delete security data, and the [audit log](/docs/configuration/audit-logs) records it.",
    );
  });

  it("says the triage reads the risk of a case's entities", () => {
    expect(
      flat(
        source(
          "Common/Server/Utils/AI/Security/SecurityCaseAIContextBuilder.ts",
        ),
      ),
    ).toContain(
      'entityRisks: await this.readEnrichment( "the risk of its entities",',
    );
    expect(page).toContain(
      "OneUptime AI reads the risk of a case's entities when it triages the case.",
    );
  });

  it("gives a rule Risk Points from 0 to 100 under On Match, More fields", () => {
    expect(RISK_POINTS_FIELD_TITLE).toBe("Risk Points");
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");

    const form: string = flat(
      source(`${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`),
    );

    expect(form).toContain('{ title: "On Match", id: "on-match" }');
    expect(form).toContain(
      'title: RISK_POINTS_FIELD_TITLE, stepId: "on-match", description: RISK_POINTS_FIELD_DESCRIPTION, fieldType: FormFieldSchemaType.Number, required: false,',
    );
    expect(form).toContain(
      "validation: { minValue: ENTITY_RISK_POINTS_MIN, maxValue: ENTITY_RISK_POINTS_MAX, }, collapsibleSection: advancedSection,",
    );
    expect(form).toContain(
      "const advancedSection: FormFieldCollapsibleSection<DetectionRule> = getAdvancedFormSection<DetectionRule>();",
    );

    // 0 adds nothing; empty takes the level's points; the level is Sigma's.
    expect(
      resolveRiskPoints({ severity: OcsfSeverity.High, riskPoints: 0 }),
    ).toBe(0);
    expect(
      riskFindingsForRuleMatches({
        rule: rule({ riskScore: 0 }),
        parsedRule: sigma("high"),
        matchedGroups: [matchGroup("k.morgan")],
        seenAt: NOW,
      }),
    ).toEqual([]);
    expect(
      resolveRiskPoints({ severity: OcsfSeverity.High, riskPoints: null }),
    ).toBe(ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.High]);
    expect(
      riskFindingsForRuleMatches({
        rule: rule(),
        parsedRule: sigma("critical"),
        matchedGroups: [matchGroup("k.morgan")],
        seenAt: NOW,
      })[0]?.points,
    ).toBe(ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Critical]);
    expect(
      resolveRiskPoints({
        severity: OcsfSeverity.Low,
        riskPoints: ENTITY_RISK_POINTS_MAX,
      }),
    ).toBe(ENTITY_RISK_POINTS_MAX);

    expect(flat(section(page, "Risk points on a detection rule"))).toContain(
      `A detection rule adds the points of its level, from its Sigma \`level\`. To give it a say of its own, open the rule's form, go to ${bold("On Match")}, open ${bold(MORE_FIELDS_SECTION_TITLE)} and set ${bold(RISK_POINTS_FIELD_TITLE)}, from ${ENTITY_RISK_POINTS_MIN}, which adds no risk, to ${ENTITY_RISK_POINTS_MAX}. Leave it empty for the points of its level.`,
    );
  });

  it("names who may change Risk Scoring, and that Security Viewer reads it", () => {
    for (const columnName of [
      "enableSecurityRiskCases",
      "securityRiskCaseThreshold",
    ]) {
      expect(
        new Project().getColumnAccessControlFor(columnName)?.update,
      ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    }

    // The list of entities is kept as the detection rules are.
    expect(
      new SecurityEntityCriticalityEntry().getCreatePermissions().sort(),
    ).toEqual(new DetectionRule().getCreatePermissions().sort());
    expect(new SecurityEntityCriticalityEntry().getReadPermissions()).toContain(
      Permission.SecurityViewer,
    );
    expect(new SecurityEntityRisk().getReadPermissions()).toContain(
      Permission.SecurityViewer,
    );

    expect(flat(section(page, "Before you begin"))).toContain(
      `To change ${bold("Risk Scoring")}: Project Owner or Project Admin for its switch and its threshold, and a role that can create detection rules for its list of entities. Security Viewer reads all of it.`,
    );
  });
});
