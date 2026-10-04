import slugify from "Common/Server/Types/MarkdownSlugify";
import SessionReplayBudgetMetrics from "Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  RumAlertTemplate,
  RumAlertTemplateArgs,
  RumAlertTemplateContext,
  getAllRumAlertTemplates,
  getRumAlertTemplates,
} from "Common/Types/Monitor/RumAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import {
  DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayBudgetMetricType from "Common/Types/Rum/SessionReplayBudgetMetricType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { formatBytesForCopy } from "Common/Utils/Rum/SessionReplayHealth";
import SessionReplayBudgetMetricTypeUtil, {
  SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES,
  SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
  SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE,
  SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE,
  SESSION_REPLAY_METRIC_NAME_PREFIX,
} from "Common/Utils/SessionReplay/SessionReplayBudgetMetricType";
import ValueFormatter from "Common/Utils/ValueFormatter";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The session replay storage budget alerts, as the docs describe them,
 * against the code that makes each sentence true.
 *
 * "### Storage budget alerts" (telemetry/session-replay.md) is where a
 * customer learns what the oneuptime.rum.session.replay.budget.* series hold,
 * which recommendations watch them and when each is offered, when a point is
 * missing, how to build a monitor of their own, and when an alert opens and
 * resolves. Those facts live in half a dozen places - the metric catalog, the
 * sweep that writes the rows, the RUM alert templates and their gate, the
 * Health page, the monitor form, billing, ingest and the Helm chart - and
 * markdown is not compiled, so nothing else notices when one of them moves.
 * Each test reads the source of truth and checks the page still tells the
 * same story, the way SloDocs.test.ts does for the oneuptime.slo.* series.
 */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
// HelmChart/ and the compose files sit one level above packages/.
const CHECKOUT_ROOT: string = path.resolve(REPO_ROOT, "..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const SESSION_REPLAY_PAGE: string = "en/telemetry/session-replay.md";
const APPLICATIONS_PAGE: string = "en/rum/applications.md";
const OWNED_PAGES: Array<string> = [SESSION_REPLAY_PAGE, APPLICATIONS_PAGE];

const SECTION_HEADING: string = "### Storage budget alerts";
const SECTION_ANCHOR: string = "storage-budget-alerts";
const SECTION_LINK: string = `/docs/telemetry/session-replay#${SECTION_ANCHOR}`;

const SWEEP_FILE: string =
  "Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics.ts";
const JOB_FILE: string =
  "App/FeatureSet/Workers/Jobs/Rum/PublishSessionReplayBudgetMetrics.ts";

const FENCE_LINE: RegExp = /^\s*```/;
// A paragraph that opens with a bold sentence: "**The metrics.**".
const LEAD_IN_LINE: RegExp = /^\*\*[^*]+\.\*\*/;
const HEADING_LINE: RegExp = /^#{1,6}\s/;

const GIB: number = 1024 * 1024 * 1024;

// The page spells small counts out ("There are four", "All four").
const NUMBER_WORDS: Array<string> = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

const ALL_METRICS: Array<SessionReplayBudgetMetricType> = Object.values(
  SessionReplayBudgetMetricType,
);

const DAILY_METRICS: Array<SessionReplayBudgetMetricType> = ALL_METRICS.filter(
  (metricType: SessionReplayBudgetMetricType): boolean => {
    return SessionReplayBudgetMetricTypeUtil.isProjectScoped(metricType);
  },
);

const MONTHLY_METRICS: Array<SessionReplayBudgetMetricType> =
  ALL_METRICS.filter((metricType: SessionReplayBudgetMetricType): boolean => {
    return !SessionReplayBudgetMetricTypeUtil.isProjectScoped(metricType);
  });

function readContent(relative: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relative), "utf8");
}

function readRepo(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readCheckout(relative: string): string {
  return fs.readFileSync(path.join(CHECKOUT_ROOT, relative), "utf8");
}

/*
 * Heading ids through the renderer's own slugify, so an anchor that passes
 * here resolves on the rendered page too. Fenced blocks are skipped: a
 * "# comment" in a code sample is not a heading.
 */
function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.+?)\s*$/);

    if (match) {
      slugs.add(slugify(match[1] as string));
    }
  }

  return slugs;
}

/* The body of one heading's section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

function budgetSection(): string {
  return section(readContent(SESSION_REPLAY_PAGE), SECTION_HEADING);
}

/*
 * One bold-lead-in paragraph of the section ("**When no point is
 * written.**") with the lists and tables under it, up to the next lead-in.
 */
function leadInBlock(markdown: string, leadIn: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(leadIn);
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const body: Array<string> = [lines[start] as string];

  for (const line of lines.slice(start + 1)) {
    if (LEAD_IN_LINE.test(line) || HEADING_LINE.test(line)) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableRowStartingWith(
  markdown: string,
  firstCell: string,
): string | undefined {
  const pattern: RegExp = new RegExp(
    `^\\|\\s*${escapeRegExp(firstCell)}\\s*\\|`,
  );

  return markdown.split("\n").find((line: string): boolean => {
    return pattern.test(line);
  });
}

// cells[0] is the empty string before the leading pipe, so cells[1] is the first column.
function cellsOf(row: string): Array<string> {
  return row.split("|").map((cell: string): string => {
    return cell.trim();
  });
}

// The first cell of every table row whose first cell matches `pattern` (one capture group).
function firstCells(markdown: string, pattern: RegExp): Array<string> {
  return Array.from(markdown.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

function stripTrailingDots(text: string): string {
  return text.replace(/\.+$/, "");
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function numberWord(value: number): string {
  return NUMBER_WORDS[value] || String(value);
}

function buildArgs(): RumAlertTemplateArgs {
  return {
    rumApplicationId: RUM_APPLICATION_ID.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Storefront",
  };
}

function metricMonitorOf(step: MonitorStep): MonitorStepMetricMonitor {
  const metricMonitor: MonitorStepMetricMonitor | undefined =
    step.data?.metricMonitor;

  expect(metricMonitor).toBeDefined();

  return metricMonitor as MonitorStepMetricMonitor;
}

// The metric names a template's Metrics queries read; none for other monitor types.
function watchedMetricNames(template: RumAlertTemplate): Array<string> {
  if (template.monitorType !== MonitorType.Metrics) {
    return [];
  }

  const queryConfigs: Array<MetricQueryConfigData> = metricMonitorOf(
    template.getMonitorStep(buildArgs()),
  ).metricViewConfig.queryConfigs;

  const names: Array<string> = [];

  for (const query of queryConfigs) {
    const metricName: unknown = query.metricQueryData.filterData.metricName;

    if (typeof metricName === "string") {
      names.push(metricName);
    }
  }

  return names;
}

/*
 * The recommendations the section is about: every RUM template that watches
 * a budget metric, found by what it reads rather than by name or category,
 * so a renamed or re-categorised template is still held to the page.
 */
function getBudgetTemplates(): Array<RumAlertTemplate> {
  return getAllRumAlertTemplates().filter(
    (template: RumAlertTemplate): boolean => {
      return watchedMetricNames(template).some(
        (metricName: string): boolean => {
          return SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
            metricName,
          );
        },
      );
    },
  );
}

function templateNames(templates: Array<RumAlertTemplate>): Array<string> {
  return templates.map((template: RumAlertTemplate): string => {
    return template.name;
  });
}

function offeredNames(context?: RumAlertTemplateContext): Array<string> {
  return sorted(templateNames(getRumAlertTemplates(context)));
}

function criteriaFiltersOf(step: MonitorStep): Array<CriteriaFilter> {
  const instances: Array<MonitorCriteriaInstance> =
    step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
  const filters: Array<CriteriaFilter> = [];

  for (const instance of instances) {
    filters.push(...(instance.data?.filters || []));
  }

  return filters;
}

function breachThresholdOf(step: MonitorStep): number {
  const breach: CriteriaFilter | undefined = criteriaFiltersOf(step).find(
    (filter: CriteriaFilter): boolean => {
      return filter.filterType === FilterType.GreaterThanOrEqualTo;
    },
  );

  expect(typeof breach?.value).toBe("number");

  return breach?.value as number;
}

// The criteria instance that opens something when it is met: the breach, not "Healthy".
function breachInstanceOf(step: MonitorStep): MonitorCriteriaInstance {
  const breach: MonitorCriteriaInstance | undefined = (
    step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
  ).find((instance: MonitorCriteriaInstance): boolean => {
    return Boolean(
      instance.data?.createIncidents || instance.data?.createAlerts,
    );
  });

  expect(breach).toBeDefined();

  return breach as MonitorCriteriaInstance;
}

function windowInMinutes(step: MonitorStep): number {
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    metricMonitorOf(step).rollingTime,
  );

  return Math.round(
    (window.endValue.getTime() - window.startValue.getTime()) / 60000,
  );
}

// The rows one sweep writes for one application, from the sweep's own pure row builder.
function sweepRows(data: {
  name?: string | undefined;
  monthlyBudgetInBytes: number | null;
  projectDailyUsedBytes: number | null;
  applicationMonthlyUsedBytes: number | null;
}): Array<JSONObject> {
  const now: Date = new Date();

  return SessionReplayBudgetMetrics.buildApplicationRows({
    application: {
      rumApplicationId: RUM_APPLICATION_ID,
      projectId: PROJECT_ID,
      name: data.name === undefined ? "Storefront" : data.name,
      monthlyBudgetInBytes: data.monthlyBudgetInBytes,
    },
    projectDailyUsedBytes: data.projectDailyUsedBytes,
    applicationMonthlyUsedBytes: data.applicationMonthlyUsedBytes,
    dailyByteLimit: DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
    ingestionDate: now,
    retentionDate: now,
  });
}

function rowNames(rows: Array<JSONObject>): Array<string> {
  return sorted(
    rows.map((row: JSONObject): string => {
      return row["name"] as string;
    }),
  );
}

describe("Session replay storage budget alerts docs", (): void => {
  describe("the section", (): void => {
    it("sits inside Recording health, under the anchor the other pages link to", (): void => {
      const page: string = readContent(SESSION_REPLAY_PAGE);

      expect(slugify(SECTION_HEADING.replace(/^#+\s*/, ""))).toBe(
        SECTION_ANCHOR,
      );
      expect(headingSlugs(page).has(SECTION_ANCHOR)).toBe(true);
      expect(section(page, "## Recording health")).toContain(SECTION_HEADING);
    });

    it("is linked from the budget-paused row, the self-hosted notes and the RUM applications page", (): void => {
      const page: string = readContent(SESSION_REPLAY_PAGE);

      const pausedRow: string | undefined = page
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("| `budget-paused` |");
        });

      expect(pausedRow).toBeDefined();
      expect(pausedRow).toContain(`(#${SECTION_ANCHOR})`);

      const limitBullet: string | undefined = section(
        page,
        "## Self-hosted notes",
      )
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(
            "- Set `SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY`",
          );
        });

      expect(limitBullet).toBeDefined();
      expect(limitBullet).toContain(`(#${SECTION_ANCHOR})`);

      const alerting: string = section(
        readContent(APPLICATIONS_PAGE),
        "## Alerting on RUM data",
      );

      expect(alerting).toContain(`](${SECTION_LINK})`);
      expect(alerting).toContain("**Recommendations**");
    });
  });

  describe("the metrics", (): void => {
    it("documents every budget metric with its unit and aggregation", (): void => {
      const markdown: string = leadInBlock(budgetSection(), "**The metrics.**");

      /*
       * The sweep, billing and the templates all walk getAll(); a member of
       * the enum missing from it would be a series nobody writes.
       */
      expect(sorted(SessionReplayBudgetMetricTypeUtil.getAll())).toEqual(
        sorted(ALL_METRICS),
      );

      for (const metricType of ALL_METRICS) {
        const row: string | undefined = tableRowStartingWith(
          markdown,
          `\`${metricType}\``,
        );

        expect({ metricType: metricType, documented: Boolean(row) }).toEqual({
          metricType: metricType,
          documented: true,
        });

        const cells: Array<string> = cellsOf(row as string);

        expect({
          metricType: metricType,
          unit: cells[2],
          aggregation: cells[3],
        }).toEqual({
          metricType: metricType,
          unit: `\`${SessionReplayBudgetMetricTypeUtil.getUnit(metricType)}\``,
          aggregation:
            SessionReplayBudgetMetricTypeUtil.getAggregationType(metricType),
        });
      }
    });

    /*
     * Detection ignores case (ingest lowercases names, and so does the
     * reservation), but a documented name must match a posted one exactly:
     * a customer copies it into a metric query as written. The reserved
     * prefix itself may be named - the page says it is refused at ingest.
     */
    it("documents no oneuptime.rum.session.replay name the sweep does not post, on either page", (): void => {
      const allowed: Set<string> = new Set<string>([
        ...ALL_METRICS,
        stripTrailingDots(SESSION_REPLAY_METRIC_NAME_PREFIX),
      ]);

      for (const relative of OWNED_PAGES) {
        const undocumented: Array<string> = Array.from(
          readContent(relative).matchAll(
            /oneuptime\.rum\.session\.replay\.[a-z0-9_.*-]*/gi,
          ),
        )
          .map((match: RegExpMatchArray): string => {
            return stripTrailingDots(match[0]);
          })
          .filter((mention: string): boolean => {
            return !allowed.has(mention);
          });

        expect({ page: relative, undocumented: undocumented }).toEqual({
          page: relative,
          undocumented: [],
        });
      }
    });

    it("describes the percentages the way the sweep computes them", (): void => {
      const limit: number =
        DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;

      // Rounded down: one byte short of the limit is not yet 100.
      expect(
        SessionReplayBudgetMetrics.computePercentUsed({
          usedBytes: limit - 1,
          limitBytes: limit,
        }),
      ).toBe(99.99);
      expect(
        SessionReplayBudgetMetrics.computePercentUsed({
          usedBytes: limit,
          limitBytes: limit,
        }),
      ).toBe(100);

      /*
       * Not capped: the gate refuses the request that crosses the limit but
       * keeps it charged, so a spent counter rests up to one request over -
       * "a little over 100" - and a lowered budget reads far over.
       */
      const crossed: number | null =
        SessionReplayBudgetMetrics.computePercentUsed({
          usedBytes: limit + MAX_SESSION_REPLAY_CHUNK_BYTES,
          limitBytes: limit,
        });

      expect(crossed).toBeGreaterThan(100);
      expect(crossed).toBeLessThan(101);
      expect(
        SessionReplayBudgetMetrics.computePercentUsed({
          usedBytes: 3 * GIB,
          limitBytes: GIB,
        }),
      ).toBe(300);

      const metrics: string = leadInBlock(budgetSection(), "**The metrics.**");

      expect(metrics).toContain(
        "rounded down to 0.01, so 100 or more means exactly what the upload gate means by spent",
      );
      expect(metrics).toContain("They are not capped");
      expect(metrics).toContain("can read a little over 100");
      expect(metrics).toContain(
        "a monthly budget lowered below what was already used reads well over it",
      );
    });

    it("keeps the attribute table in step with the keys the sweep stamps", (): void => {
      const rows: Array<JSONObject> = sweepRows({
        monthlyBudgetInBytes: 10 * GIB,
        projectDailyUsedBytes: GIB / 2,
        applicationMonthlyUsedBytes: GIB,
      });

      // One point per metric, every one filed under the application.
      expect(rowNames(rows)).toEqual(sorted(ALL_METRICS));

      for (const row of rows) {
        expect(row["primaryEntityId"]).toBe(RUM_APPLICATION_ID.toString());
        expect(row["primaryEntityType"]).toBe(ServiceType.RealUserMonitor);
      }

      // Attribute key -> the metrics whose points carry it.
      const carriers: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();

      for (const row of rows) {
        for (const key of Object.keys(row["attributes"] as JSONObject)) {
          carriers.set(key, [
            ...(carriers.get(key) || []),
            row["name"] as string,
          ]);
        }
      }

      expect(sorted(Array.from(carriers.keys()))).toEqual(
        sorted([
          SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
          SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE,
          SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE,
        ]),
      );

      const metrics: string = leadInBlock(budgetSection(), "**The metrics.**");

      /*
       * The attribute rows are the table rows whose first cell is code but
       * not a metric name - exactly the keys the sweep stamps, no more.
       */
      const documentedKeys: Array<string> = firstCells(
        metrics,
        /^\|\s*`([^`]+)`\s*\|/gm,
      ).filter((cell: string): boolean => {
        return !SessionReplayBudgetMetricTypeUtil.isReservedMetricName(cell);
      });

      expect(sorted(documentedKeys)).toEqual(
        sorted(Array.from(carriers.keys())),
      );

      // The "On" column says which series carry each key.
      for (const [key, names] of carriers) {
        let expectedOn: string = "(no documented group)";

        if (sorted(names).join() === sorted(ALL_METRICS).join()) {
          expectedOn = `All ${numberWord(ALL_METRICS.length)}`;
        } else if (sorted(names).join() === sorted(MONTHLY_METRICS).join()) {
          expectedOn = "The monthly pair";
        } else if (sorted(names).join() === sorted(DAILY_METRICS).join()) {
          expectedOn = "The daily pair";
        }

        const row: string | undefined = tableRowStartingWith(
          metrics,
          `\`${key}\``,
        );

        expect({ key: key, on: cellsOf(row as string)[2] }).toEqual({
          key: key,
          on: expectedOn,
        });
      }

      expect(metrics).toContain(
        `The daily pair carries only \`${SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE}\``,
      );
      expect(metrics).toContain(
        "Every point is filed under the RUM application it was written for",
      );
      expect(metrics).toContain(
        "written once for every application that records, with the same value on each",
      );

      // A blank application name is left out, as its row says.
      const unnamed: Array<JSONObject> = sweepRows({
        name: "   ",
        monthlyBudgetInBytes: 10 * GIB,
        projectDailyUsedBytes: GIB / 2,
        applicationMonthlyUsedBytes: GIB,
      });

      expect(unnamed).toHaveLength(ALL_METRICS.length);

      for (const row of unnamed) {
        expect(Object.keys(row["attributes"] as JSONObject)).not.toContain(
          SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE,
        );
      }

      expect(
        tableRowStartingWith(
          metrics,
          `\`${SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE}\``,
        ),
      ).toContain("left out when it is blank");
    });

    it("writes no point where the page says there is none", (): void => {
      const block: string = leadInBlock(
        budgetSection(),
        "**When no point is written.**",
      );

      expect(block).toContain(
        "A missing point is a gap in the chart, never a 0",
      );

      // Nothing counted yet: no point at all, not a 0.
      expect(
        sweepRows({
          monthlyBudgetInBytes: 10 * GIB,
          projectDailyUsedBytes: 0,
          applicationMonthlyUsedBytes: 0,
        }),
      ).toEqual([]);
      expect(block).toContain("No upload has been counted yet today");

      // An unreadable counter is unknown, which is never written as 0.
      expect(
        sweepRows({
          monthlyBudgetInBytes: 10 * GIB,
          projectDailyUsedBytes: null,
          applicationMonthlyUsedBytes: null,
        }),
      ).toEqual([]);
      expect(block).toContain("cannot be read from Valkey");
      expect(block).toContain("never written as 0");
      expect(block).toContain(
        "Open alerts resolve once their window holds no point",
      );

      // A negative count (a refund that straddled 00:00 UTC) is no point either.
      expect(
        sweepRows({
          monthlyBudgetInBytes: 10 * GIB,
          projectDailyUsedBytes: -5,
          applicationMonthlyUsedBytes: -5,
        }),
      ).toEqual([]);

      // No budget: the daily pair only, whatever a stale monthly counter holds.
      expect(
        rowNames(
          sweepRows({
            monthlyBudgetInBytes: null,
            projectDailyUsedBytes: GIB / 2,
            applicationMonthlyUsedBytes: GIB,
          }),
        ),
      ).toEqual(sorted(DAILY_METRICS));
      expect(SessionReplayBudgetMetrics.getMonthlyBudgetInBytes(0)).toBeNull();
      expect(
        SessionReplayBudgetMetrics.getMonthlyBudgetInBytes(null),
      ).toBeNull();
      expect(SessionReplayBudgetMetrics.getMonthlyBudgetInBytes(10)).toBe(
        10 * GIB,
      );
      expect(block).toContain("The application has no monthly budget");
      expect(block).toContain(
        "Removing the budget silences its monthly monitors",
      );
      expect(block).toContain(
        "one first set mid-month counts from that moment",
      );

      /*
       * The month's counter is keyed by project, application and UTC month
       * alone, and nothing clears it when a budget is removed: a budget set
       * again in the same month picks up where the month's count stood.
       */
      expect(block).toContain(
        "one removed and set again in the same month picks up that month's earlier count",
      );
      expect(
        readRepo("Common/Server/Utils/SessionReplay/SessionReplayUsage.ts"),
      ).toContain(
        "return `${MONTHLY_APP_BYTE_KEY_PREFIX}${data.projectId.toString()}:${data.rumApplicationId.toString()}:${this.getUtcMonthBucket()}`;",
      );

      /*
       * Which applications are swept at all: replay on for the application
       * and the project, and at least one replay ever recorded.
       */
      const sweep: string = readRepo(SWEEP_FILE);

      expect(sweep).toContain("isSessionReplayEnabled: true");
      expect(sweep).toContain(
        "sessionReplayLastChunkReceivedAt: QueryHelper.notNull()",
      );
      expect(sweep).toContain("isSessionReplayAllowed: true");
      expect(block).toContain("Session Replay is off for the application");
      expect(block).toContain("or for the whole project");
      expect(block).toContain("The application has never recorded a replay");
    });
  });

  describe("the recommendations", (): void => {
    it("names every recommendation that watches a budget metric, with its severity and threshold", (): void => {
      const templates: Array<RumAlertTemplate> = getBudgetTemplates();

      expect(templates.length).toBeGreaterThan(0);

      const setup: string = leadInBlock(
        budgetSection(),
        "**Setting them up.**",
      );

      for (const template of templates) {
        const row: string | undefined = tableRowStartingWith(
          setup,
          `**${template.name}**`,
        );

        expect({ name: template.name, documented: Boolean(row) }).toEqual({
          name: template.name,
          documented: true,
        });

        const cells: Array<string> = cellsOf(row as string);

        expect({ name: template.name, severity: cells[2] }).toEqual({
          name: template.name,
          severity: template.severity,
        });

        const threshold: number = breachThresholdOf(
          template.getMonitorStep(buildArgs()),
        );

        if (threshold === 100) {
          expect({ name: template.name, alertsWhen: cells[3] }).toEqual({
            name: template.name,
            alertsWhen: expect.stringContaining("is spent"),
          });
        } else {
          expect({ name: template.name, alertsWhen: cells[3] }).toEqual({
            name: template.name,
            alertsWhen: expect.stringContaining(`${threshold}%`),
          });
        }

        expect(setup).toContain(`under **${template.category}**`);

        // "the incident and alert it opens": a breach opens one of each.
        const breach: MonitorCriteriaInstance = breachInstanceOf(
          template.getMonitorStep(buildArgs()),
        );

        expect({
          name: template.name,
          createsIncident: breach.data?.createIncidents,
          createsAlert: breach.data?.createAlerts,
          incidents: breach.data?.incidents.length,
          alerts: breach.data?.alerts.length,
        }).toEqual({
          name: template.name,
          createsIncident: true,
          createsAlert: true,
          incidents: 1,
          alerts: 1,
        });
      }

      expect(setup).toContain("the incident and alert it opens say what to do");

      // No stale row for a recommendation that no longer exists.
      expect(sorted(firstCells(setup, /^\|\s*\*\*([^*]+)\*\*\s*\|/gm))).toEqual(
        sorted(templateNames(templates)),
      );

      const count: string = numberWord(templates.length);

      expect(setup).toContain(
        `${count.charAt(0).toUpperCase()}${count.slice(1)} ready-made alerts watch these budgets`,
      );
    });

    it("offers the daily pair once the application has recorded, and the monthly pair once it has a budget", (): void => {
      const base: Array<string> = offeredNames();
      const recording: Array<string> = offeredNames({
        sessionReplayEnabled: true,
        sessionReplayHasRecorded: true,
      });
      const budgeted: Array<string> = offeredNames({
        sessionReplayEnabled: true,
        sessionReplayHasRecorded: true,
        sessionReplayMonthlyBudgetInGB: 10,
      });

      const dailyPair: Array<string> = recording.filter(
        (name: string): boolean => {
          return !base.includes(name);
        },
      );
      const monthlyPair: Array<string> = budgeted.filter(
        (name: string): boolean => {
          return !recording.includes(name);
        },
      );

      expect(dailyPair.length).toBeGreaterThan(0);
      expect(monthlyPair.length).toBeGreaterThan(0);
      expect(sorted([...dailyPair, ...monthlyPair])).toEqual(
        sorted(templateNames(getBudgetTemplates())),
      );

      /*
       * "The daily pair" is the one that watches the project's series and
       * "the monthly pair" the application's - which is what the gate's two
       * tiers must line up with for the page's wording to hold.
       */
      for (const template of getBudgetTemplates()) {
        const watchesProjectSeries: boolean = watchedMetricNames(
          template,
        ).every((metricName: string): boolean => {
          return (
            ALL_METRICS.includes(metricName as SessionReplayBudgetMetricType) &&
            SessionReplayBudgetMetricTypeUtil.isProjectScoped(
              metricName as SessionReplayBudgetMetricType,
            )
          );
        });

        expect({
          name: template.name,
          pair: dailyPair.includes(template.name) ? "daily" : "monthly",
        }).toEqual({
          name: template.name,
          pair: watchesProjectSeries ? "daily" : "monthly",
        });
        expect(template.name).toContain(
          watchesProjectSeries ? "Daily" : "Monthly",
        );
      }

      // Replay switched off, or no replay recorded yet: neither pair, budget or not.
      expect(
        offeredNames({
          sessionReplayEnabled: false,
          sessionReplayHasRecorded: true,
          sessionReplayMonthlyBudgetInGB: 10,
        }),
      ).toEqual(base);
      expect(
        offeredNames({
          sessionReplayEnabled: true,
          sessionReplayHasRecorded: false,
          sessionReplayMonthlyBudgetInGB: 10,
        }),
      ).toEqual(base);

      const markdown: string = budgetSection();

      expect(markdown).toContain(
        "While Session Replay is on for the application, the daily pair is offered once it has recorded a replay, and the monthly pair once it also has a **Monthly budget (GB)**",
      );
      expect(
        readRepo(
          "App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplaySettings.tsx",
        ),
      ).toContain('title: "Monthly budget (GB)"');
      expect(markdown).toContain(
        "dismiss the daily cards on the others; otherwise one spent day alerts once per application",
      );
      const alerting: string = section(
        readContent(APPLICATIONS_PAGE),
        "## Alerting on RUM data",
      );

      expect(alerting).toContain(
        "Offered on the **Recommendations** tab once the application has recorded a replay; the monthly ones once it also has a monthly budget",
      );
    });

    it("reaches them the way the dashboard does", (): void => {
      const healthPage: string = readRepo(
        "App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthDashboard.tsx",
      );

      expect(healthPage).toContain('title="Storage budget"');
      expect(healthPage).toContain('label="Set up alerts"');

      const card: string = readRepo(
        "App/FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthCard.tsx",
      );
      const routeHelper: string =
        card
          .split("export function getBudgetAlertRecommendationsRoute(")[1]
          ?.split("\n}")[0] || "";

      expect(routeHelper).toContain(
        "PageMap.RUM_APPLICATION_VIEW_RECOMMENDATIONS",
      );

      // The link pre-fills the tab's search; every budget alert has to match it.
      const searchText: string | undefined =
        routeHelper.match(/search: "([^"]+)"/)?.[1];

      expect(searchText).toBeDefined();

      for (const template of getBudgetTemplates()) {
        expect(template.name.toLowerCase()).toContain(
          (searchText as string).toLowerCase(),
        );
      }

      // "the ones you have already created included" is the All status.
      expect(routeHelper).toContain("status: RecommendationStatusFilter.All");

      const sideMenu: string = readRepo(
        "App/FeatureSet/Dashboard/src/Pages/Rum/View/SideMenu.tsx",
      );

      expect(sideMenu).toContain('title: "Recommendations"');
      expect(sideMenu).toContain('title: "Health"');

      const setup: string = leadInBlock(
        budgetSection(),
        "**Setting them up.**",
      );

      for (const label of [
        "**Health**",
        "**Set up alerts**",
        "**Storage budget**",
        "**Recommendations**",
      ]) {
        expect(setup).toContain(label);
      }

      /*
       * "Once the daily pair is offered": the Health page shows the link on
       * the same fact the daily pair's gate reads - replay on for the
       * application and a replay recorded. The condition is found by what
       * it reads rather than by its name.
       */
      const gate: RegExpMatchArray | undefined = Array.from(
        healthPage.matchAll(/const (\w+): boolean =([^;]+);/g),
      ).find((match: RegExpMatchArray): boolean => {
        const condition: string = match[2] as string;

        return (
          condition.includes("isApplicationEnabled") &&
          condition.includes("lastChunkReceivedAt")
        );
      });

      expect(gate).toBeDefined();

      const gatedLink: string =
        healthPage
          .split(`{${(gate as RegExpMatchArray)[1] as string} && (`)[1]
          ?.split("/>")[0] || "";

      expect(gatedLink).toContain('label="Set up alerts"');
      expect(setup).toContain(
        "Once the daily pair is offered, **Set up alerts** in the **Storage budget** panel of the **Health** page opens the tab filtered to the budget alerts, the ones you have already created included.",
      );
    });
  });

  describe("building your own monitor", (): void => {
    it("tells you to copy the settings the recommendations use", (): void => {
      const own: string = leadInBlock(
        budgetSection(),
        "**Building your own monitor.**",
      );

      for (const template of getBudgetTemplates()) {
        const step: MonitorStep = template.getMonitorStep(buildArgs());
        const metricMonitor: MonitorStepMetricMonitor = metricMonitorOf(step);

        // Scoped to the application its points are filed under.
        expect(
          (metricMonitor.telemetryServiceIds || []).map(
            (id: ObjectID): string => {
              return id.toString();
            },
          ),
        ).toEqual([RUM_APPLICATION_ID.toString()]);

        expect(own).toContain(`to ${windowInMinutes(step)} minutes or more`);

        for (const query of metricMonitor.metricViewConfig.queryConfigs) {
          expect(query.metricQueryData.filterData.aggegationType).toBe(
            AggregationType.Max,
          );
        }

        for (const filter of criteriaFiltersOf(step)) {
          expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
            EvaluateOverTimeType.MaximumValue,
          );
          // Unset reads as Ignore in the evaluator, as it does in the form.
          expect(
            filter.metricMonitorOptions?.onNoDataPolicy || NoDataPolicy.Ignore,
          ).toBe(NoDataPolicy.Ignore);
        }
      }

      // Max is also the aggregation the catalog util names for every series.
      for (const metricType of ALL_METRICS) {
        expect(
          SessionReplayBudgetMetricTypeUtil.getAggregationType(metricType),
        ).toBe(AggregationType.Max);
      }

      expect(own).toContain(
        `Set the query's aggregation to **${AggregationType.Max}** and the criterion's to **${EvaluateOverTimeType.MaximumValue}**`,
      );
      // The two choices that multiply the figure, by the labels the form shows them under.
      expect(own).toContain(`**${AggregationType.Sum}** adds readings up`);
      expect(own).toContain(`**${AggregationType.Count}** counts the readings`);
      expect(own).toContain(`on **${NoDataPolicy.Ignore}**`);
      expect(own).toContain(`**${NoDataPolicy.Trigger}** would alert`);
      expect(own).toContain(
        `Filter the monthly pair on \`${SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE}\``,
      );
      expect(own).toContain("The daily pair needs no filter");
    });

    it("names the monitor form's own labels and the place the metrics are listed", (): void => {
      const form: string = readRepo(
        "App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter.tsx",
      );

      /*
       * A metric criterion's If No Data sits in its folded More fields
       * section and sets the metric options' own policy - the one the
       * evaluator reads. (The form has a second If No Data, for
       * evaluate-over-time checks, outside it.)
       */
      const advanced: string =
        form
          .split("title={MORE_FIELDS_SECTION_TITLE}")[1]
          ?.split("</FoldedSection>")[0] || "";

      expect(advanced).toContain('title="If No Data"');
      expect(advanced).toContain("metricMonitorOptions?.onNoDataPolicy");

      const own: string = leadInBlock(
        budgetSection(),
        "**Building your own monitor.**",
      );

      expect(own).toContain("**If No Data**");
      expect(own).toContain("**More fields**");

      /*
       * The application's own Metrics tab lists the metric types linked to
       * the application as a service; the sweep registers the budget names
       * with no services at all, so they only show in the project explorer.
       */
      expect(
        readRepo("App/FeatureSet/Dashboard/src/Pages/Rum/View/Metrics.tsx"),
      ).toContain("serviceIds={[modelId]}");
      expect(readRepo(SWEEP_FILE)).not.toMatch(/\.services\s*=/);
      expect(own).toContain("project's metrics explorer");
      expect(own).toContain(
        "not listed on the application's own **Metrics** tab",
      );
    });

    it("tells the Health page's units and the charts' apart with the numbers each shows", (): void => {
      const limit: number =
        DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;

      expect(limit).toBe(GIB);

      const healthCopy: string = formatBytesForCopy(limit);
      const chartCopy: string = ValueFormatter.formatValue(
        limit,
        SessionReplayBudgetMetricTypeUtil.getUnit(
          SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
        ),
      );

      expect(chartCopy).not.toBe(healthCopy);

      const own: string = leadInBlock(
        budgetSection(),
        "**Building your own monitor.**",
      );

      expect(own).toContain("Alert on the percent, not the bytes");
      expect(own).toContain('the Health page\'s "GB" is 1024³ bytes');
      expect(own).toContain(
        `a day that spends the default ${healthCopy} limit charts as about ${chartCopy}`,
      );
    });
  });

  describe("timing, retention and usage", (): void => {
    it("quotes the cadence and window the worker and the templates use", (): void => {
      const interval: number = SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES;

      expect(EVERY_FIVE_MINUTE).toBe(`*/${interval} * * * *`);
      expect(readRepo(JOB_FILE)).toContain("schedule: EVERY_FIVE_MINUTE");

      const windows: Set<number> = new Set<number>(
        getBudgetTemplates().map((template: RumAlertTemplate): number => {
          return windowInMinutes(template.getMonitorStep(buildArgs()));
        }),
      );

      expect(windows.size).toBe(1);

      const window: number = Array.from(windows)[0] as number;

      // Three sweeps fit the window, so one late sweep cannot empty it.
      expect(window).toBeGreaterThanOrEqual(3 * interval);

      const markdown: string = budgetSection();

      expect(markdown).toContain(`as metrics every ${interval} minutes`);
      expect(markdown).toContain(`A point arrives every ${interval} minutes`);

      const timing: string = leadInBlock(
        markdown,
        "**When alerts open and resolve.**",
      );

      /*
       * A crossing waits up to one interval for the sweep to write it, then
       * up to a minute for the monitor's next evaluation. Recovery waits for
       * the last high point to leave the window: window - interval to
       * window minutes after the value falls, so 00:10-00:15 UTC for a
       * daily budget that resets at midnight.
       */
      expect(timing).toContain(`at the next ${interval}-minute sweep`);
      expect(timing).toContain(`within about ${interval + 1} minutes`);
      expect(timing).toContain(
        `resolves ${window - interval}–${window} minutes after the value falls back below the threshold`,
      );
      expect(timing).toContain(`the ${window}-minute window`);
      expect(timing).toContain(
        `at about 00:${twoDigits(window - interval)}–00:${twoDigits(window)} UTC`,
      );
      expect(timing).toContain("before 00:00 UTC may not alert at all");
    });

    it("states the retention default the sweep stamps, which is the monitor metrics' own", (): void => {
      const defaultDaysOf: (relative: string) => string = (
        relative: string,
      ): string => {
        const match: RegExpMatchArray | null = readRepo(relative).match(
          /DEFAULT_RETENTION_DAYS:\s*number\s*=\s*(\d+)/,
        );

        expect(match).not.toBeNull();

        return (match as RegExpMatchArray)[1] as string;
      };

      const sweepDays: string = defaultDaysOf(SWEEP_FILE);

      expect(sweepDays).toBe(
        defaultDaysOf("Common/Server/Utils/Monitor/MonitorMetricUtil.ts"),
      );
      expect(readRepo(SWEEP_FILE)).toContain("monitorMetricRetentionInDays");
      expect(
        readRepo(
          "App/FeatureSet/AdminDashboard/src/Pages/Settings/DataRetention/Index.tsx",
        ),
      ).toContain('title: "Monitor Metric Retention (Days)"');

      const retention: string = leadInBlock(
        budgetSection(),
        "**Retention and usage.**",
      );

      expect(retention).toContain("kept as long as monitor metrics");
      expect(retention).toContain(`**${sweepDays} days**`);
      expect(retention).toContain("**Monitor Metric Retention (Days)**");
    });

    /*
     * The same rule as "only promises recorder capabilities on the Health
     * page while the API carries them" in SessionReplayDocs.test.ts: a
     * promise about billing or ingest holds only while the code keeps it.
     */
    it("only promises the billing exclusion and the ingest reservation while the code enforces them", (): void => {
      const billing: string = readRepo(
        "Common/Server/Services/TelemetryUsageBillingService.ts",
      );

      expect(billing).toMatch(
        /TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES:\s*ReadonlyArray<string>\s*=\s*SessionReplayBudgetMetricTypeUtil\.getAll\(\)/,
      );
      expect(billing).toMatch(
        /excludeNames:[^\n]*TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES/,
      );

      // Checked on arrival, and again after the customer's metric pipeline rules rename a row.
      const ingest: string = readRepo(
        "App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
      );

      expect(
        ingest.split("SessionReplayBudgetMetricTypeUtil.isReservedMetricName(")
          .length - 1,
      ).toBeGreaterThanOrEqual(2);

      // In any letter case, and nothing wider than the prefix.
      expect(
        SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
          SessionReplayBudgetMetricType.ProjectDailyUsedPercent.toUpperCase(),
        ),
      ).toBe(true);
      expect(
        SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
          "oneuptime.rum.application.id",
        ),
      ).toBe(false);

      const retention: string = leadInBlock(
        budgetSection(),
        "**Retention and usage.**",
      );

      expect(retention).toContain("They are not counted as telemetry usage");
      expect(retention).toContain(
        `Metric names that start with \`${SESSION_REPLAY_METRIC_NAME_PREFIX}\`, in any letter case, are reserved`,
      );
      expect(retention).toContain(
        "or rename to one with a metric pipeline rule",
      );
      expect(retention).toContain("are dropped at ingest");

      // Recording rules write past ingest; their services refuse the prefix.
      expect(retention).toContain(
        "a recording rule cannot be saved with one as its output",
      );

      for (const service of [
        "MetricRecordingRuleService",
        "TraceRecordingRuleService",
      ]) {
        const code: string = readRepo(`Common/Server/Services/${service}.ts`);

        expect([
          service,
          code.includes("assertOutputMetricNameAllowed("),
        ]).toEqual([service, true]);
        expect(code).toContain("protected override async onBeforeCreate(");
        expect(code).toContain("protected override async onBeforeUpdate(");
      }
    });
  });

  describe("self-hosted notes", (): void => {
    it("tells operators to give the worker the limit the app enforces, the way the chart wires it", (): void => {
      // The worker reads the limit from its own environment, through the gate's own Config.
      const job: string = readRepo(JOB_FILE);

      expect(job).toContain('from "../../../Telemetry/Config"');
      expect(job).toContain(
        "dailyByteLimit: SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY",
      );
      expect(readRepo("App/FeatureSet/Telemetry/Config.ts")).toContain(
        '"SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY"',
      );

      /*
       * `default <chart-wide> <component>`: a component's own non-empty
       * extraEnv wins outright - the two lists are not merged.
       */
      for (const component of ["app", "worker"]) {
        expect(
          readCheckout(
            `HelmChart/Public/oneuptime/templates/${component}.yaml`,
          ),
        ).toContain(`default $.Values.extraEnv $.Values.${component}.extraEnv`);
      }

      /*
       * Valkey keeps nothing across a restart, on either install path:
       * neither an append-only file nor RDB snapshots.
       */
      const composeCommand: string =
        readCheckout("docker-compose.base.yml").match(
          /command: (valkey-server[^\n]*)/,
        )?.[1] || "";

      expect(composeCommand).toContain("--appendonly no");
      expect(composeCommand).toContain('--save ""');

      // The block scalar's own lines: those indented deeper than its key.
      const helmConfiguration: string =
        readCheckout("HelmChart/Public/oneuptime/values.yaml").match(
          /^([ \t]*)commonConfiguration: \|-\n((?:\1[ \t]+\S[^\n]*\n)+)/m,
        )?.[2] || "";

      expect(helmConfiguration).toMatch(/^\s*appendonly no\s*$/m);
      expect(helmConfiguration).toMatch(/^\s*save ""\s*$/m);

      const bullet: string =
        section(readContent(SESSION_REPLAY_PAGE), "## Self-hosted notes")
          .split("\n")
          .find((line: string): boolean => {
            return line.startsWith(
              "- Set `SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY`",
            );
          }) || "";

      for (const phrase of [
        "from its own copy of the variable",
        "On Docker Compose, set it in `config.env`: one `app` container runs both.",
        "set it in the chart-wide `extraEnv`, and also in `app.extraEnv` or `worker.extraEnv` if you set either",
        "replaces the chart-wide list instead of adding to it",
        "which runs without persistence by default, so a Valkey restart resets them",
      ]) {
        expect([phrase, bullet.includes(phrase)]).toEqual([phrase, true]);
      }
    });

    /*
     * "Set it in config.env" only holds if compose hands it on: the app
     * service lists its variables one by one and has no env_file. Unset, it
     * arrives empty, which parseBatchSize (and the Health API) read as the
     * 1 GiB default - so forwarding it changes nothing for anyone who does
     * not set it.
     */
    it("compose passes the daily limit to the app container, empty when unset", (): void => {
      const compose: string = readCheckout("docker-compose.base.yml");
      const appService: string =
        compose.split(/^ {2}app:\n/m)[1]?.split(/^ {2}\S[^\n]*:\n/m)[0] || "";

      expect(appService).toContain(
        "SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY: ${SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY:-}",
      );

      const telemetryConfig: string = readRepo(
        "App/FeatureSet/Telemetry/Config.ts",
      );

      // parseBatchSize: an empty value is the default, not 0 or NaN.
      expect(telemetryConfig).toContain(
        "if (!value) {\n    return defaultValue;",
      );
      expect(telemetryConfig).toContain(
        'parseBatchSize(\n    "SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY",',
      );
    });
  });
});
