import { SECURITY_EVENTS } from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  NOISY,
  PERIOD_LAST_DAY,
  PERIOD_LAST_MONTH,
  PERIOD_LAST_WEEK,
  RUN_ON_PAST_EVENTS,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import {
  ADD_EXCEPTION_ACTION,
  ENDS_AT_FIELD_TITLE,
  EXPIRES_AT_FIELD_TITLE,
  KIND_ENTITY_TITLE,
  KIND_VALUE_TITLE,
  KIND_WINDOW_TITLE,
  REASON_FIELD_TITLE,
  RULE_EXCEPTIONS_TABLE_TITLE,
  RULE_EXCEPTION_SINGULAR,
  STARTS_AT_FIELD_TITLE,
  STATUS_COLUMN_TITLE,
  VIEW_EXCEPTIONS_ACTION,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import { INTERACTIVE_READ_TIME_LIMIT } from "Common/Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { buildDetectionRuleExceptionMatch } from "Common/Server/Utils/SecurityEvent/DetectionRuleExceptions";
import { resolveSigmaField } from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import Permission from "Common/Types/Permission";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  DETECTION_RETROHUNT_MAX_GROUPS,
  DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY,
  DETECTION_RETROHUNT_PERIODS_IN_HOURS,
  isDetectionRetrohuntNoisy,
} from "Common/Types/SecurityEvent/DetectionRetrohunt";
import {
  DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX,
  DETECTION_RULE_EXCEPTION_ENTITY_FIELDS,
  DETECTION_RULE_EXCEPTION_ENTITY_TYPES,
  DETECTION_RULE_EXCEPTION_KINDS,
  DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS,
  DetectionRuleExceptionKind,
  DetectionRuleExceptionProblem,
  DetectionRuleExceptionShape,
  DetectionRuleExceptionStatus,
  doesDetectionRuleExceptionApply,
  getDetectionRuleExceptionProblems,
  getDetectionRuleExceptionStatus,
} from "Common/Types/SecurityEvent/DetectionRuleException";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Security Events page says about detection rule exceptions and
 * Run on Past Events, held to the code that does it: the kinds and what each
 * matches, the wildcard and the address range, the limits, the statuses and
 * when an exception skips anything, who may change them, where the runs
 * leave skipped events out, and Run on Past Events' periods, list, noise
 * line and time limit. Every bold name is the Dashboard's own word (the
 * copy modules), so a renamed label fails here until the page follows.
 *
 * Its other languages are held line for line to this page by
 * AiToolingAndSecurityDocsTranslations.
 */

const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const SECURITY: string = "Common/Server/Utils/SecurityEvent";

const SOURCES: Record<string, string> = {
  ruleExceptionsPage: `${DASHBOARD}/Pages/SecurityEvents/RuleExceptions.tsx`,
  detectionRulesPage: `${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`,
  caseDetections: `${DASHBOARD}/Components/SecurityCase/SecurityCaseDetections.tsx`,
  evaluator: `${SECURITY}/DetectionRuleEvaluator.ts`,
  retrohunt: `${SECURITY}/DetectionRuleRetrohunt.ts`,
  detectionRuleApi: "Common/Server/API/DetectionRuleAPI.ts",
};

const LINE_BREAK: RegExp = /\n/;
const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

function source(name: string): string {
  return fs
    .readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8")
    .replace(/\s+/g, " ");
}

function englishPage(): string {
  return readPage("en", SECURITY_EVENTS);
}

function matches(text: string, pattern: RegExp): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// A section of the page, from its heading to the next heading of its level or above.
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

// A Troubleshooting entry's text, by its title.
function troubleshooting(markdown: string, title: string): string {
  const lines: Array<string> = section(markdown, "Troubleshooting").split(
    LINE_BREAK,
  );
  const index: number = lines.indexOf(`:::details ${title}`);

  expect({ title, found: index >= 0 }).toEqual({ title, found: true });

  return lines[index + 1] as string;
}

function bold(text: string): Array<string> {
  return matches(text, BOLD);
}

function code(text: string): Array<string> {
  return matches(text, INLINE_CODE);
}

function permissionSet(permissions: Array<Permission>): Array<string> {
  return [...new Set(permissions.map(String))].sort();
}

function exception(
  values: Partial<DetectionRuleExceptionShape>,
): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: SecurityEntityType.User,
    value: "svc-backup",
    reason: "The nightly backup job.",
    ...values,
  };
}

// The SQL an exception skips events with, and the values it binds.
function sqlOf(shape: DetectionRuleExceptionShape): {
  query: string;
  values: Array<unknown>;
} {
  const statement: Statement | null = buildDetectionRuleExceptionMatch(shape);

  expect(statement).not.toBeNull();

  return {
    query: statement!.query,
    values: Object.values(statement!.query_params),
  };
}

describe("the Security Events page on rule exceptions", () => {
  const page: string = englishPage();
  const exceptions: string = section(page, "Exceptions");

  it("lists Rule Exceptions under Detections, after Detection Rules, as the side menu does", () => {
    const detections: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find((entry: SecurityEventsMenuSection): boolean => {
        return entry.title === "Detections";
      });
    const titles: Array<string> = (detections?.items || []).map(
      (item: SecurityEventsMenuItem): string => {
        return item.title;
      },
    );

    expect(titles.slice(0, 2)).toEqual([
      "Detection Rules",
      RULE_EXCEPTIONS_TABLE_TITLE,
    ]);
    expect(page).toContain(
      `| **${RULE_EXCEPTIONS_TABLE_TITLE}** | Detections | What your rules skip on purpose, such as a scanner or a planned test, each with who added it and why |`,
    );
  });

  it("opens the list from the path the product draws, and adds one from the three places it names", () => {
    expect(exceptions).toContain(
      `Every exception is listed under **Products → Security Events → Detections → ${RULE_EXCEPTIONS_TABLE_TITLE}**: add one there with **Add ${RULE_EXCEPTION_SINGULAR}**, with **${ADD_EXCEPTION_ACTION}** in a rule's row, or with **${ADD_EXCEPTION_ACTION}** in a detection's row on a case`,
    );
    // The list's create button: its verb, and the row it adds.
    expect(source("ruleExceptionsPage")).toContain(
      'singularName={RULE_EXCEPTION_SINGULAR} pluralName={RULE_EXCEPTION_PLURAL} createVerb="Add"',
    );
    expect(source("detectionRulesPage")).toContain(
      "title: ADD_EXCEPTION_ACTION,",
    );
    expect(source("caseDetections")).toContain("title: ADD_EXCEPTION_ACTION,");
    // A detection's Add Exception is only on a rule's detection, started with its group's value.
    expect(source("caseDetections")).toContain(
      "isVisible: (item: SecurityDetection): boolean => { return Boolean(item.detectionRuleId); },",
    );
  });

  it("names the three kinds in the form's order, and the fields each one matches", () => {
    const rows: Array<Array<string>> = (
      tables(exceptions)[0] as Array<Array<string>>
    ).slice(1);

    expect(DETECTION_RULE_EXCEPTION_KINDS).toEqual([
      DetectionRuleExceptionKind.Entity,
      DetectionRuleExceptionKind.Value,
      DetectionRuleExceptionKind.TimeWindow,
    ]);
    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      `**${KIND_ENTITY_TITLE}**`,
      `**${KIND_VALUE_TITLE}**`,
      `**${KIND_WINDOW_TITLE}**`,
    ]);

    // An entity: the users, hosts and addresses, in every field they are read from.
    expect(DETECTION_RULE_EXCEPTION_ENTITY_TYPES).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
    ]);
    expect((rows[0] as Array<string>)[1]).toMatch(
      /^A user, host or IP address wherever an event names it: /,
    );
    const fields: Array<string> = DETECTION_RULE_EXCEPTION_ENTITY_TYPES.flatMap(
      (type: SecurityEntityType): Array<string> => {
        return [...(DETECTION_RULE_EXCEPTION_ENTITY_FIELDS[type] || [])];
      },
    );
    expect(code((rows[0] as Array<string>)[1] as string).sort()).toEqual(
      [...fields, "observables"].sort(),
    );
    expect(
      sqlOf(
        exception({
          entityType: SecurityEntityType.Host,
          value: "web-03",
        }),
      ).query,
    ).toContain("observables");

    // A value: the field named as a rule names it, a typed field or an attribute.
    expect(code((rows[1] as Array<string>)[1] as string)).toEqual([
      "processName",
      "principalUser",
      "http.user_agent",
    ]);
    expect(resolveSigmaField("processName").kind).not.toBe("attribute");
    expect(resolveSigmaField("http.user_agent")).toMatchObject({
      kind: "attribute",
      attributeKey: "http.user_agent",
    });

    // A time window: its two times, at most 30 days apart.
    expect((rows[2] as Array<string>)[1]).toBe(
      `Every event from **${STARTS_AT_FIELD_TITLE}** to **${ENDS_AT_FIELD_TITLE}**, at most ${DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS} days apart`,
    );
    const tooLong: Array<DetectionRuleExceptionProblem> =
      getDetectionRuleExceptionProblems(
        {
          kind: DetectionRuleExceptionKind.TimeWindow,
          startsAt: NOW,
          endsAt: new Date(
            NOW.getTime() +
              (DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS + 1) * DAY_IN_MS,
          ),
          reason: "A planned test.",
        },
        { now: NOW, isExpiryNew: true },
      );
    expect(
      tooLong.map((problem: DetectionRuleExceptionProblem): string => {
        return problem.field;
      }),
    ).toEqual(["endsAt"]);
  });

  it("matches the page's own examples as it says: whatever the case, * for any run, an address as a range", () => {
    const line: string = lineStarting(page, "Exceptions", "- Values match");

    expect(line).toBe(
      "- Values match whatever their case, and `*` stands for any run of characters: `svc-*` skips every service account, and `*.lab.example.com` every host of a domain. An IP address can be a range, such as `10.20.0.0/16`. A value of only `*` is refused: to stop a rule, turn it off.",
    );

    // Whatever the case: the value and the field are both lowered.
    const plain: { query: string; values: Array<unknown> } = sqlOf(
      exception({ value: "SVC-Backup" }),
    );
    expect(plain.query).toContain("lowerUTF8(principalUser)");
    expect(plain.values).toContain("svc-backup");

    // svc-* is a LIKE with the star as any run; the rest of it literal.
    const star: { query: string; values: Array<unknown> } = sqlOf(
      exception({ value: "svc-*" }),
    );
    expect(star.query).toContain("LIKE");
    expect(star.values).toContain("svc-%");

    const domain: { query: string; values: Array<unknown> } = sqlOf(
      exception({
        entityType: SecurityEntityType.Host,
        value: "*.lab.example.com",
      }),
    );
    expect(domain.values).toContain("%.lab.example.com");

    // An address range is read as one: in range, not as text.
    const range: { query: string; values: Array<unknown> } = sqlOf(
      exception({
        entityType: SecurityEntityType.IpAddress,
        value: "10.20.0.0/16",
      }),
    );
    expect(range.query).toContain("isIPAddressInRange");
    expect(range.values).toContain("10.20.0.0/16");

    // A lone * is refused when saved, in the words the page gives, and never skips anything.
    expect(
      getDetectionRuleExceptionProblems(exception({ value: "*" }), {
        now: NOW,
        isExpiryNew: true,
      }).map((problem: DetectionRuleExceptionProblem): string => {
        return problem.message;
      }),
    ).toEqual([
      "A value of only * would skip everything. To stop the rule, turn it off.",
    ]);
    expect(buildDetectionRuleExceptionMatch(exception({ value: "*" }))).toBe(
      null,
    );
  });

  it("keeps why and who with each one; an entity or a value can expire, a window ends by itself", () => {
    const line: string = lineStarting(
      page,
      "Exceptions",
      "- Each exception says why",
    );

    expect(line).toBe(
      `- Each exception says why in its **${REASON_FIELD_TITLE}**, which everyone who reads the list sees, and keeps who added it and when. An entity or a value can have an **${EXPIRES_AT_FIELD_TITLE}**, after which the rule sees it again; a time window ends by itself.`,
    );

    // No reason, no exception.
    expect(
      getDetectionRuleExceptionProblems(exception({ reason: "" }), {
        now: NOW,
        isExpiryNew: true,
      }).map((problem: DetectionRuleExceptionProblem): string => {
        return problem.field;
      }),
    ).toEqual(["reason"]);

    // Past its expiry, an entity skips nothing: the rule sees it again.
    const expired: DetectionRuleExceptionShape = exception({
      expiresAt: new Date(NOW.getTime() - HOUR_IN_MS),
    });
    expect(getDetectionRuleExceptionStatus(expired, NOW)).toBe(
      DetectionRuleExceptionStatus.Expired,
    );
    expect(
      doesDetectionRuleExceptionApply(expired, {
        from: new Date(NOW.getTime() - HOUR_IN_MS),
        until: NOW,
        now: NOW,
      }),
    ).toBe(false);

    // Who added it is the record's own: the list reads it with the reason.
    expect(source("ruleExceptionsPage")).toContain(
      "field: { reason: true, createdByUser: { name: true, email: true, profilePictureId: true }, },",
    );
  });

  it("names the four statuses the list draws, and when each one skips", () => {
    const line: string = lineStarting(
      page,
      "Exceptions",
      `- **${STATUS_COLUMN_TITLE}** says`,
    );

    expect(bold(line).slice(1, 5).sort()).toEqual(
      Object.values(DetectionRuleExceptionStatus).sort(),
    );
    expect(line).toContain(
      `**${DetectionRuleExceptionStatus.Upcoming}** for a window that has not started`,
    );
    expect(line).toContain(
      `and **${VIEW_EXCEPTIONS_ACTION}** in the rule's row opens the list filtered to it.`,
    );

    const window: DetectionRuleExceptionShape = {
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: new Date(NOW.getTime() + HOUR_IN_MS),
      endsAt: new Date(NOW.getTime() + 3 * HOUR_IN_MS),
      reason: "The red team exercise.",
    };
    expect(getDetectionRuleExceptionStatus(window, NOW)).toBe(
      DetectionRuleExceptionStatus.Upcoming,
    );
    expect(
      getDetectionRuleExceptionStatus(
        window,
        new Date(NOW.getTime() + 4 * HOUR_IN_MS),
      ),
    ).toBe(DetectionRuleExceptionStatus.Ended);

    /*
     * A window skips the events between its two times, and only those: an
     * ended one still skips its own events in a run over them.
     */
    expect(
      doesDetectionRuleExceptionApply(window, {
        from: NOW,
        until: new Date(NOW.getTime() + 2 * HOUR_IN_MS),
        now: new Date(NOW.getTime() + 7 * DAY_IN_MS),
      }),
    ).toBe(true);
    expect(
      doesDetectionRuleExceptionApply(window, {
        from: new Date(NOW.getTime() - 2 * HOUR_IN_MS),
        until: NOW,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      troubleshooting(page, "An exception doesn't skip what it should"),
    ).toContain(
      `Check its **${STATUS_COLUMN_TITLE}** in **${RULE_EXCEPTIONS_TABLE_TITLE}**: an **${DetectionRuleExceptionStatus.Expired}** one skips nothing, and a time window skips only the events between its two times.`,
    );
  });

  it("leaves skipped events out before anything is counted, in every run and Run on Past Events, but never in a test attack", () => {
    const evaluator: string = source("evaluator");
    const retrohunt: string = source("retrohunt");

    expect(lineStarting(page, "Exceptions", "- Skipped events")).toBe(
      `- Skipped events are left out before the rule counts anything, so they never count toward its **Match Count Threshold** and open no case, alert, incident or finding. Exceptions apply to every run of the rule, correlations included, and to **${RUN_ON_PAST_EVENTS}**, but never to a test attack, which checks that events get through.`,
    );
    // A test attack reads none.
    expect(evaluator).toContain(
      "const exceptions: Array<DetectionRuleExceptionShape> = setupTest ? [] :",
    );
    // A correlation's reads and a single rule's both AND the filter in.
    expect(evaluator).toContain(
      "restrictTo: andRestrictions(setupTest?.restrictTo, exceptionsFilter),",
    );
    expect(evaluator).toContain(
      "matchedGroups = await this.findSingleRuleMatches({ rule, parsedRule, startTime, endTime, setupTest, exceptionsFilter, });",
    );
    // Run on Past Events: a saved rule's exceptions, a rule not saved yet none.
    expect(retrohunt).toContain(
      "const exceptions: Array<DetectionRuleExceptionShape> = request.rule.id ? await DetectionRuleExceptions.loadForRule({",
    );
  });

  it("keeps at most 100 a rule; whoever edits detection rules changes them, every Security role reads them, and every change is audited", () => {
    const model: DetectionRuleException = new DetectionRuleException();
    const rule: DetectionRule = new DetectionRule();

    expect(DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX).toBe(100);
    expect(lineStarting(page, "Exceptions", "- A rule has at most")).toBe(
      `- A rule has at most ${DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX} exceptions. Whoever may edit detection rules adds, changes and removes them, every Security role can read them, and each change is kept in the project's audit log.`,
    );

    for (const permissions of [
      model.getCreatePermissions(),
      model.getUpdatePermissions(),
      model.getDeletePermissions(),
    ]) {
      expect(permissionSet(permissions)).toEqual(
        permissionSet(rule.getUpdatePermissions()),
      );
    }

    for (const role of [
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ]) {
      expect(model.getReadPermissions()).toContain(role);
    }

    expect(model.enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
    });
  });
});

describe("the Security Events page on Run on Past Events", () => {
  const page: string = englishPage();
  const run: string = section(page, RUN_ON_PAST_EVENTS);

  it("is in a rule's row and under the form's YAML, over the periods the panel offers, writing nothing", () => {
    const rules: string = source("detectionRulesPage");

    expect(
      lineStarting(page, RUN_ON_PAST_EVENTS, `**${RUN_ON_PAST_EVENTS}** shows`),
    ).toBe(
      `**${RUN_ON_PAST_EVENTS}** shows what a rule would have found had it been running, without opening, sending or writing anything. It is in a rule's row, for the rule as saved, and under **Sigma Rule (YAML)** in the rule's form, for the rule as it stands there, before you save it. Pick **${PERIOD_LAST_DAY}**, **${PERIOD_LAST_WEEK}** or **${PERIOD_LAST_MONTH}**.`,
    );
    expect(DETECTION_RETROHUNT_PERIODS_IN_HOURS).toEqual([24, 24 * 7, 24 * 30]);
    expect([PERIOD_LAST_DAY, PERIOD_LAST_WEEK, PERIOD_LAST_MONTH]).toEqual([
      "Last 24 hours",
      "Last 7 days",
      "Last 30 days",
    ]);
    expect(DETECTION_RETROHUNT_DEFAULT_PERIOD_IN_HOURS).toBe(24 * 7);

    // The row's action, and the run under the YAML field of the form.
    expect(rules).toContain("title: RUN_ON_PAST_EVENTS,");
    const yamlField: string = rules.slice(
      rules.indexOf('title: "Sigma Rule (YAML)",'),
    );
    expect(yamlField.indexOf("<DetectionRuleRetrohuntInForm")).toBeGreaterThan(
      0,
    );
    expect(yamlField.indexOf("<DetectionRuleRetrohuntInForm")).toBeLessThan(
      yamlField.indexOf("title:", 30),
    );
  });

  it("counts a rule as its runs do, in windows as long as its interval, against its threshold", () => {
    const retrohunt: string = source("retrohunt");

    expect(run).toContain(
      "- A rule is counted as its runs count it: in windows as long as its **Evaluation Interval (Minutes)**, a group firing in a window when its count there reaches the **Match Count Threshold**.",
    );
    expect(retrohunt).toContain(
      "SELECT toStartOfInterval(time, toIntervalMinute(${{ type: TableColumnType.Number, value: counting.windowInMinutes, }})) AS __window,",
    );
    expect(retrohunt).toContain(
      "(__kept > 0 AND __keptDistinct >= ${{ type: TableColumnType.Number, value: counting.threshold, }}) AS __fired,",
    );
  });

  it("lists the 50 groups that fired most, and says what the exceptions kept out", () => {
    expect(DETECTION_RETROHUNT_MAX_GROUPS).toBe(50);
    expect(run).toContain(
      `The ${DETECTION_RETROHUNT_MAX_GROUPS} groups that fired most are listed, each with its events and when it last fired.`,
    );
    expect(run).toContain(
      "- A saved rule's exceptions apply, and the answer says how many events they skipped and how many firings they prevented.",
    );
    expect(source("retrohunt")).toContain(
      "countIf(__firedWithout AND NOT __fired) AS preventedCount, sum(__all - __kept) AS skippedCount,",
    );
  });

  it("calls more than 20 firings a day more than a person can look at", () => {
    expect(DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY).toBe(20);
    expect(run).toContain(
      `- A rule that would fire more than ${DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY} times a day fires more than a person can look at, and the answer says so, with ways to make it quieter.`,
    );
    expect(NOISY).toContain("more than {{count}} a day");
    // 21 a day over a week is noisy; 20 is not.
    expect(
      isDetectionRetrohuntNoisy({ firedCount: 21 * 7, periodInHours: 24 * 7 }),
    ).toBe(true);
    expect(
      isDetectionRetrohuntNoisy({ firedCount: 20 * 7, periodInHours: 24 * 7 }),
    ).toBe(false);
  });

  it("reads only the sources the reader may read, and stops a run after 45 seconds", () => {
    expect(INTERACTIVE_READ_TIME_LIMIT.maxExecutionTimeInSeconds).toBe(45);
    expect(run).toContain(
      `- It reads only the sources you can read. A run that takes longer than ${INTERACTIVE_READ_TIME_LIMIT.maxExecutionTimeInSeconds} seconds is stopped and says so: pick a shorter period.`,
    );
    expect(source("retrohunt")).toContain(
      "statement.append(getQuerySettings(INTERACTIVE_READ_TIME_LIMIT));",
    );
    expect(source("detectionRuleApi")).toContain(
      "const serviceFilter: TelemetryServiceFilter = await TelemetryReadAccess.getServiceFilter({ modelType: SecurityEvent, props, });",
    );
  });

  it("answers a rule that finds nothing with how many events matched, and where to look", () => {
    expect(troubleshooting(page, "Run on Past Events finds nothing")).toBe(
      "It reads only the period you pick and the sources you can read. When events matched but no group reached the **Match Count Threshold** in one window, the answer says how many matched: lower the threshold, or count over a longer **Evaluation Interval (Minutes)**.",
    );
    expect(
      troubleshooting(page, "A rule fires on something you expect"),
    ).toContain(
      `**${ADD_EXCEPTION_ACTION}** in the detection's row on its case starts with the rule and what it fired for.`,
    );
  });
});
