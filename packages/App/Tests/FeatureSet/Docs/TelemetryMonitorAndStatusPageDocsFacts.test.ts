import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { hasPage, readPage } from "./DocsContentSupport";
import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import SpanUtil from "../../../FeatureSet/Dashboard/src/Utils/SpanUtil";
import { getStatusPageResourceFormFields } from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourceFormFields";
import StatusPageDisplaySettingsCopy, {
  DISPLAY_SECTIONS,
  DisplaySectionDefinition,
  MAX_UPTIME_HISTORY_DAYS,
  UPTIME_PRECISION_OPTIONS,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import StatusPageBrandingCopy, {
  isDefaultBarColorChosen,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import {
  STATUS_PAGE_GROUP_CSV_COLUMNS,
  StatusPageGroupCsvParseResult,
  parseStatusPageGroupCsv,
} from "../../../FeatureSet/Dashboard/src/Utils/StatusPageGroupCsv";
import slugify from "Common/Server/Types/MarkdownSlugify";
import CompareCriteria from "Common/Server/Utils/Monitor/Criteria/CompareCriteria";
import LogMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageMonitorRule from "Common/Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { isPlanGatedColumnDefault } from "Common/Types/Billing/PlanGatedColumnDefault";
import { Green } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProfileMonitor";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import Text from "Common/Types/Text";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import CertificateReissueUtil from "Common/Utils/CertificateReissue";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import TelemetryMonitorWindow, {
  DEFAULT_TELEMETRY_MONITOR_WINDOW_MS,
} from "Common/Utils/Monitor/TelemetryMonitorWindow";
import RulePatternMatchUtil from "Common/Utils/Rules/RulePatternMatchUtil";
import { ReceivingGapReason } from "Common/Utils/Telemetry/ReceivingGaps";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 10: what the English Logs, Metrics, Traces, Exceptions
 * and Profiles monitor pages and the status page Resources & Groups and
 * Branding & Domains pages say the product does, each fact read from where
 * the product keeps it - the monitor type catalog, the criteria form, the
 * step queries, the worker, the status page models and forms - so a page
 * fails HERE when the product changes under it, rather than in front of
 * the next reader. The translations say the same things in the English
 * pages' shape (TelemetryMonitorAndStatusPageDocsTranslations), so these
 * facts hold for every language.
 *
 * The rewrite audited four recent changes, and each is pinned:
 *
 *   - #4626: a telemetry check waits while its window holds time OneUptime
 *     itself was not receiving (ReceivingCoverage.planTelemetryEvaluation).
 *   - #4636: AI / LLM is a monitor type under Telemetry, which the Traces
 *     page sends readers to for bad AI answers.
 *   - #4565: a status page's More settings are one card (pinned in
 *     StatusPageBrandingDocs; the plan gates and defaults beside it here).
 *   - #4578: the installation's product branding, which the docs never
 *     describe: no page of this group names a licence or a white label.
 *
 * Pure modules are imported and run. React views cannot be imported into
 * App's tests, so a view is read as text and only its literal titles,
 * placeholders and defaults are compared. Facts other suites already hold
 * are left to them: the Logs group-by limits (LogsMonitorGroupByDocs), the
 * span status section (TracesMonitorSpanStatusDocs), the Branding page map
 * and More settings (StatusPageBrandingDocs), the custom domain flow and its
 * Status column (StatusPageCustomDomainsDocs) and who may check and reissue
 * (CustomDomainPermissionsDocs).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");

function readSource(relativeToPackages: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativeToPackages), "utf8");
}

function dashboardSource(relative: string): string {
  return readSource(path.join("App/FeatureSet/Dashboard/src", relative));
}

// Source text with every run of whitespace as one space, to read across lines.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ");
}

const LOGS: string = readPage("en", "monitor/logs-monitor");
const METRICS: string = readPage("en", "monitor/metrics-monitor");
const TRACES: string = readPage("en", "monitor/traces-monitor");
const EXCEPTIONS: string = readPage("en", "monitor/exceptions-monitor");
const PROFILES: string = readPage("en", "monitor/profiles-monitor");
const RESOURCES: string = readPage("en", "status-pages/resources-and-groups");
const BRANDING: string = readPage("en", "status-pages/branding-and-domains");

const TELEMETRY_JOB: string = oneLine(
  readSource(
    "App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
  ),
);

const LOG_FORM: string =
  "Components/Form/Monitor/LogMonitor/LogMonitorStepFrom.tsx";
const TRACE_FORM: string =
  "Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm.tsx";
const EXCEPTION_FORM: string =
  "Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm.tsx";

// ---- reading the pages -------------------------------------------------------

const HEADING_LINE: RegExp = /^(#{1,6}) (.+)$/;
const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const FENCE_LINE: RegExp = /^\s*```/;

/*
 * The part of a page under a heading ("## Criteria"), up to the next heading
 * of the same or a higher level.
 */
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = (heading.match(HEADING_LINE) as RegExpMatchArray)[1]!
    .length;
  let end: number = lines.length;
  let inFence: boolean = false;

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING_LINE);

    if (match && match[1]!.length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n");
}

// The cells of one table row, trimmed: "| a | b |" -> ["a", "b"].
function cellsOf(line: string): Array<string> {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell: string): string => {
      return cell.trim();
    });
}

/*
 * The body rows of the first table whose header row starts with these
 * cells, each row as its cells.
 */
function tableRows(
  markdown: string,
  header: Array<string>,
): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const headerIndex: number = lines.findIndex((line: string): boolean => {
    if (!line.startsWith("|")) {
      return false;
    }

    const cells: Array<string> = cellsOf(line);

    return header.every((cell: string, index: number): boolean => {
      return cells[index] === cell;
    });
  });

  expect({ header: header, found: headerIndex >= 0 }).toEqual({
    header: header,
    found: true,
  });

  const rows: Array<Array<string>> = [];

  for (
    let index: number = headerIndex + 2;
    index < lines.length && (lines[index] as string).startsWith("|");
    index++
  ) {
    rows.push(cellsOf(lines[index] as string));
  }

  return rows;
}

function boldSpans(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD_SPAN), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
}

// A cell without its bold markers: "**Greater Than**" -> "Greater Than".
function plain(cell: string): string {
  return cell.replace(/\*\*/g, "").trim();
}

// The one line of a page that starts with this text.
function lineStartingWith(markdown: string, start: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect({ start: start, found: line !== undefined }).toEqual({
    start: start,
    found: true,
  });

  return line as string;
}

// The anchors of a page's headings, outside fenced code.
function headingAnchors(markdown: string): Array<string> {
  const anchors: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING_LINE);

    if (match) {
      anchors.push(slugify(match[2] as string));
    }
  }

  return anchors;
}

// The JSON of the first ```json block in a part of a page.
function jsonBlockOf(markdown: string): JSONObject {
  const match: RegExpMatchArray | null = markdown.match(
    /```json\n([\s\S]*?)\n```/,
  );

  expect(match).not.toBeNull();

  return JSON.parse((match as RegExpMatchArray)[1] as string) as JSONObject;
}

// "1,500" -> 1500 (the English pages' thousands separator).
function numberOf(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- reading the Dashboard's forms as text ---------------------------------------

interface SourceField {
  title: string;
  // The folded section it is drawn in, if any (its variable's name).
  section: string | null;
  defaultValue: string | null;
  placeholder: string | null;
}

/*
 * The fields of a form written as `{ field: { x: true }, title: "...", ... }`
 * objects, in order: each object runs from its `field: {` to the next one.
 */
function sourceFields(source: string): Array<SourceField> {
  return source
    .split(/\n\s*field: \{/)
    .slice(1)
    .map((block: string): SourceField => {
      const title: RegExpMatchArray | null = block.match(/\btitle: "([^"]+)"/);
      const section: RegExpMatchArray | null = block.match(
        /collapsibleSection: (\w+)/,
      );
      const defaultValue: RegExpMatchArray | null = oneLine(block).match(
        /defaultValue: ([^,]+),/,
      );
      const placeholder: RegExpMatchArray | null = block.match(
        /\bplaceholder: "([^"]+)"/,
      );

      return {
        title: title ? (title[1] as string) : "",
        section: section ? (section[1] as string) : null,
        defaultValue: defaultValue ? (defaultValue[1] as string).trim() : null,
        placeholder: placeholder ? (placeholder[1] as string) : null,
      };
    })
    .filter((field: SourceField): boolean => {
      return field.title.length > 0;
    });
}

interface DurationOption {
  label: string;
  seconds: number;
}

// The "Last N ..." window options a form offers, in order.
function durationOptions(source: string): Array<DurationOption> {
  return Array.from(
    source.matchAll(/label: "(Last [^"]+)",\s*value: (\d+)/g),
    (match: RegExpMatchArray): DurationOption => {
      return { label: match[1] as string, seconds: Number(match[2]) };
    },
  );
}

// ---- the pages this file reads --------------------------------------------------

interface TelemetryPage {
  name: string;
  markdown: string;
  monitorType: MonitorType;
  // The MonitorType key the worker names it by.
  typeKey: string;
}

const TELEMETRY_PAGES: Array<TelemetryPage> = [
  {
    name: "Logs",
    markdown: LOGS,
    monitorType: MonitorType.Logs,
    typeKey: "Logs",
  },
  {
    name: "Metrics",
    markdown: METRICS,
    monitorType: MonitorType.Metrics,
    typeKey: "Metrics",
  },
  {
    name: "Traces",
    markdown: TRACES,
    monitorType: MonitorType.Traces,
    typeKey: "Traces",
  },
  {
    name: "Exceptions",
    markdown: EXCEPTIONS,
    monitorType: MonitorType.Exceptions,
    typeKey: "Exceptions",
  },
  {
    name: "Profiles",
    markdown: PROFILES,
    monitorType: MonitorType.Profiles,
    typeKey: "Profiles",
  },
];

// Every telemetry page but Profiles, which Create Monitor does not offer.
const PICKABLE_PAGES: Array<TelemetryPage> = TELEMETRY_PAGES.filter(
  (entry: TelemetryPage): boolean => {
    return entry.monitorType !== MonitorType.Profiles;
  },
);

describe("the telemetry monitors in Create Monitor", () => {
  it("offers Logs, Metrics, Traces, Exceptions and AI / LLM under Telemetry, and Profiles nowhere", () => {
    const categories: Array<MonitorTypeCategory> =
      MonitorTypeHelper.getMonitorTypeCategories();
    const telemetry: MonitorTypeCategory | undefined = categories.find(
      (category: MonitorTypeCategory): boolean => {
        return category.label === "Telemetry";
      },
    );

    expect(telemetry?.monitorTypes).toEqual(
      expect.arrayContaining([
        MonitorType.Logs,
        MonitorType.Metrics,
        MonitorType.Traces,
        MonitorType.Exceptions,
        MonitorType.Llm,
      ]),
    );

    for (const category of categories) {
      expect({
        category: category.label,
        offersProfiles: category.monitorTypes.includes(MonitorType.Profiles),
      }).toEqual({ category: category.label, offersProfiles: false });
    }
  });

  it.each(PICKABLE_PAGES)(
    "the $name page picks **$name** under **Telemetry**, behind More monitor types, or finds it by search",
    (entry: TelemetryPage) => {
      const title: string = MonitorTypeHelper.getTitle(entry.monitorType);

      expect(title).toBe(entry.name);
      // The six common types come first; everything else is one press away.
      expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
        entry.monitorType,
      );
      expect(entry.markdown).toContain(
        `Under **Monitor Type**, click **More monitor types** and pick **${title}** under **Telemetry**, or type \`${title.toLowerCase()}\` in the search box.`,
      );
    },
  );

  // #4636
  it("sends readers who want to hear about bad AI answers to the AI / LLM type, under Telemetry, and its section", () => {
    const title: string = MonitorTypeHelper.getTitle(MonitorType.Llm);

    expect(title).toBe("AI / LLM");
    expect(MonitorTypeHelper.isTelemetryMonitor(MonitorType.Llm)).toBe(true);
    expect(TRACES).toContain(
      `pick **${title}** under **Telemetry** instead. It reads the AI calls in your traces for you, with no span filters to write.`,
    );

    const anchor: string = "get-told-when-the-ai-answers-badly";

    expect(TRACES).toContain(
      `](/docs/telemetry/ai-llm-observability#${anchor})`,
    );
    expect(
      headingAnchors(readPage("en", "telemetry/ai-llm-observability")),
    ).toContain(anchor);
  });

  it("says Create Monitor does not offer Profiles, which is still a monitor type the worker checks and whose criteria can be edited", () => {
    expect(PROFILES).toContain(
      "**Create Monitor** in the dashboard does not offer Profiles: there is no form for its filters yet.",
    );
    expect(PROFILES).toContain(
      "Once it exists, you can view and edit its criteria on the monitor's **Criteria** page in the dashboard",
    );
    expect(MonitorTypeHelper.getActiveMonitorTypes()).toContain(
      MonitorType.Profiles,
    );
    expect(MonitorTypeHelper.isTelemetryMonitor(MonitorType.Profiles)).toBe(
      true,
    );
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.Profiles),
    ).toBe(true);
    expect(TELEMETRY_JOB).toContain("MonitorType.Profiles,");
  });
});

describe("how often a telemetry monitor is checked", () => {
  it.each(TELEMETRY_PAGES)(
    "the $name page says it is checked every minute, with no interval and no Probes & Interval page",
    (entry: TelemetryPage) => {
      expect(MonitorTypeHelper.isProbableMonitor(entry.monitorType)).toBe(
        false,
      );
      expect(
        MonitorTypeHelper.doesMonitorTypeHaveInterval(entry.monitorType),
      ).toBe(false);
      expect(entry.markdown).toMatch(
        new RegExp(
          `- \\*\\*Every minute\\.\\*\\* An? ${entry.name} monitor is not checked by probes, so it has no interval to set and no \\*\\*Probes & Interval\\*\\* page\\.`,
        ),
      );
    },
  );

  it("the worker picks up every telemetry monitor and checks it again a minute later", () => {
    for (const entry of TELEMETRY_PAGES) {
      expect({
        monitorType: entry.typeKey,
        picked: TELEMETRY_JOB.includes(`MonitorType.${entry.typeKey},`),
      }).toEqual({ monitorType: entry.typeKey, picked: true });
    }

    expect(TELEMETRY_JOB).toContain(
      "let nextPing: Date = OneUptimeDate.addRemoveMinutes( OneUptimeDate.getCurrentDate(), 1, );",
    );
  });

  it("Create Monitor's Probes & Interval step and the monitor's Probes & Interval page are only for monitors probes check", () => {
    expect(oneLine(dashboardSource("Pages/Monitor/Create.tsx"))).toContain(
      'title: "Probes & Interval", id: "monitoring-interval", showIf: (values: FormValues<Monitor>) => { return MonitorTypeHelper.doesMonitorTypeHaveInterval(',
    );
    expect(
      oneLine(dashboardSource("Pages/Monitor/View/SideMenu.tsx")),
    ).toContain(
      'if (isProbeableMonitor) { configurationItems.push({ link: { title: "Probes & Interval",',
    );
  });
});

// #4626
describe("OneUptime's own downtime is not silence", () => {
  it("the worker plans each check from the monitor's own window, and skips it while that window holds a gap", () => {
    const plan: number = TELEMETRY_JOB.indexOf(
      "await ReceivingCoverage.planTelemetryEvaluation({ windowInMs: TelemetryMonitorWindow.getWindowInMs({",
    );
    const skip: number = TELEMETRY_JOB.indexOf("if (!plan.evaluate) {");
    const check: number = TELEMETRY_JOB.indexOf(
      "await MonitorResourceUtil.monitorResource(response);",
    );

    expect(plan).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(plan);
    expect(check).toBeGreaterThan(skip);
    // Skipped: no status change, nothing opened, nothing resolved.
    expect(TELEMETRY_JOB.slice(skip, check)).toContain("return; }");
  });

  it.each([
    {
      name: "Logs",
      monitorType: MonitorType.Logs,
      data: { logMonitor: { lastXSecondsOfLogs: 300 } },
    },
    {
      name: "Traces",
      monitorType: MonitorType.Traces,
      data: { traceMonitor: { lastXSecondsOfSpans: 300 } },
    },
    {
      name: "Exceptions",
      monitorType: MonitorType.Exceptions,
      data: { exceptionMonitor: { lastXSecondsOfExceptions: 300 } },
    },
    {
      name: "Profiles",
      monitorType: MonitorType.Profiles,
      data: { profileMonitor: { lastXSecondsOfProfiles: 300 } },
    },
    {
      name: "Metrics",
      monitorType: MonitorType.Metrics,
      data: { metricMonitor: { rollingTime: RollingTime.Past5Minutes } },
    },
  ])(
    "the window a $name check waits on is the one the monitor looks back over, and the last minute without one",
    (entry: { name: string; monitorType: MonitorType; data: JSONObject }) => {
      expect(
        TelemetryMonitorWindow.getWindowInMs({
          monitorType: entry.monitorType,
          monitorStep: { data: entry.data } as unknown as MonitorStep,
        }),
      ).toBe(5 * 60 * 1000);
      expect(
        TelemetryMonitorWindow.getWindowInMs({
          monitorType: entry.monitorType,
          monitorStep: { data: {} } as unknown as MonitorStep,
        }),
      ).toBe(DEFAULT_TELEMETRY_MONITOR_WINDOW_MS);
      expect(DEFAULT_TELEMETRY_MONITOR_WINDOW_MS).toBe(60 * 1000);
    },
  );

  it("waits for the three reasons the pages give: restarting or upgrading, just back, catching up", () => {
    expect(Object.values(ReceivingGapReason).sort()).toEqual([
      "CatchingUp",
      "NotReceiving",
      "Reconnecting",
    ]);
  });

  it.each(TELEMETRY_PAGES)(
    "the $name page says the check waits, and links to the page that explains it",
    (entry: TelemetryPage) => {
      expect(entry.markdown).toContain(
        "- **OneUptime's own downtime is not silence.**",
      );
      expect(entry.markdown).toContain(
        "it was restarting, being upgraded or catching up — the check waits: the status does not change, and no incident or alert is opened or resolved",
      );
      expect(entry.markdown).toContain(
        "[When OneUptime Is Not Receiving Data](/docs/monitor/when-oneuptime-is-not-receiving)",
      );
    },
  );
});

interface WindowForm {
  name: string;
  markdown: string;
  file: string;
  title: string;
  stepDefaultSeconds: number;
}

const WINDOW_FORMS: Array<WindowForm> = [
  {
    name: "Logs",
    markdown: LOGS,
    file: LOG_FORM,
    title: "Monitor Logs for (time)",
    stepDefaultSeconds:
      MonitorStepLogMonitorUtil.getDefault().lastXSecondsOfLogs,
  },
  {
    name: "Traces",
    markdown: TRACES,
    file: TRACE_FORM,
    title: "Monitor Traces for (time)",
    stepDefaultSeconds:
      MonitorStepTraceMonitorUtil.getDefault().lastXSecondsOfSpans,
  },
  {
    name: "Exceptions",
    markdown: EXCEPTIONS,
    file: EXCEPTION_FORM,
    title: "Monitor exceptions for (time)",
    stepDefaultSeconds:
      MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions,
  },
];

describe("the window a count looks back over", () => {
  it.each(WINDOW_FORMS)(
    "$name: $title offers the last 5 seconds to the last 24 hours and starts at Last 1 minute, as the page's table says",
    (form: WindowForm) => {
      const options: Array<DurationOption> = durationOptions(
        dashboardSource(form.file),
      );

      expect(options[0]).toEqual({ label: "Last 5 seconds", seconds: 5 });
      expect(options[options.length - 1]).toEqual({
        label: "Last 24 hours",
        seconds: 24 * 60 * 60,
      });

      const field: SourceField | undefined = sourceFields(
        dashboardSource(form.file),
      ).find((candidate: SourceField): boolean => {
        return candidate.title === form.title;
      });

      // The form's own default is the step's: written out, or read from it.
      expect(field?.defaultValue).toMatch(
        new RegExp(
          `^(${form.stepDefaultSeconds}|MonitorStep\\w+Util\\.getDefault\\(\\) ?\\.lastXSeconds\\w+)$`,
        ),
      );

      const startsAt: DurationOption | undefined = options.find(
        (option: DurationOption): boolean => {
          return option.seconds === form.stepDefaultSeconds;
        },
      );

      expect(startsAt?.label).toBe("Last 1 minute");

      const row: Array<string> | undefined = tableRows(form.markdown, [
        "Field",
      ]).find((cells: Array<string>): boolean => {
        return plain(cells[0] as string) === form.title;
      });

      expect(row?.[1]).toContain("the last 5 seconds up to the last 24 hours");
      expect(row?.[2]).toBe(`**${startsAt?.label}**`);
    },
  );

  it.each(WINDOW_FORMS)(
    "$name: the five-minute window the page's example uses is one of the form's options",
    (form: WindowForm) => {
      const fiveMinutes: DurationOption | undefined = durationOptions(
        dashboardSource(form.file),
      ).find((option: DurationOption): boolean => {
        return option.seconds === 300;
      });

      expect(fiveMinutes?.label).toBe("Last 5 minutes");
      // "- **Monitor Logs for (time)**: **Last 5 minutes**", or "... to ...".
      expect(form.markdown).toMatch(
        new RegExp(
          `\\*\\*${escapeRegExp(form.title)}\\*\\*(: | to )\\*\\*${fiveMinutes?.label}\\*\\*`,
        ),
      );
    },
  );

  it("a Profiles step saved without lastXSecondsOfProfiles has no window: every stored profile is counted", () => {
    const withoutWindow: MonitorStepProfileMonitor =
      MonitorStepProfileMonitorUtil.fromJSON({
        profileTypes: ["cpu"],
        telemetryServiceIds: [],
      });

    expect(withoutWindow.lastXSecondsOfProfiles).toBeUndefined();
    expect(
      MonitorStepProfileMonitorUtil.toQuery(withoutWindow).startTime,
    ).toBeUndefined();
    expect(
      MonitorStepProfileMonitorUtil.toQuery({
        ...withoutWindow,
        lastXSecondsOfProfiles: 300,
      }).startTime,
    ).toBeInstanceOf(InBetween);

    const row: Array<string> | undefined = tableRows(PROFILES, ["Field"]).find(
      (cells: Array<string>): boolean => {
        return cells[0] === "`lastXSecondsOfProfiles`";
      },
    );

    expect(row?.[2]).toBe(
      "None: always set it, or every stored profile is counted and the count never falls to 0",
    );
  });
});

describe("what each filter matches", () => {
  it("text filters are a substring search, which the analytics database runs ignoring case", () => {
    expect(
      oneLine(
        readSource(
          "Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts",
        ),
      ),
    ).toContain(
      "} else if (value instanceof Search) { whereStatement.append( SQL`AND ${columnRef(key)} ILIKE",
    );
  });

  it("Logs: the text matches the body ignoring case, a severity or a service is any of those chosen, attributes are conditions", () => {
    const query: Record<string, unknown> = MonitorStepLogMonitorUtil.toQuery({
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "terminated",
      severityTexts: [LogSeverity.Error],
      telemetryServiceIds: [ObjectID.generate()],
      attributes: { log_component: "IPSec" },
    }) as Record<string, unknown>;

    expect(query["body"]).toBeInstanceOf(Search);
    expect(query["severityText"]).toBeInstanceOf(Includes);
    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(query["attributes"]).toEqual({ log_component: "IPSec" });

    const rows: Array<Array<string>> = tableRows(LOGS, ["Field"]);

    expect(rows[0]).toEqual([
      "**Monitor Logs that include this text**",
      "Logs whose body contains this text, ignoring case.",
      "Empty: every log",
    ]);
    expect(LOGS).toContain(
      "All the filters you set must match for a log to be counted.",
    );
  });

  it("Traces: the span name matches ignoring case, and the statuses are the three the filter offers", () => {
    const query: Record<string, unknown> = MonitorStepTraceMonitorUtil.toQuery({
      ...MonitorStepTraceMonitorUtil.getDefault(),
      spanName: "POST /api/checkout",
      spanStatuses: [SpanStatus.Error],
    }) as Record<string, unknown>;

    expect(query["name"]).toBeInstanceOf(Search);
    expect(query["statusCode"]).toBeInstanceOf(Includes);

    const statuses: Array<string> = SpanUtil.getSpanStatusDropdownOptions().map(
      (option: { label: string }): string => {
        return option.label;
      },
    );
    const row: Array<string> = tableRows(TRACES, ["Field"]).find(
      (cells: Array<string>): boolean => {
        return plain(cells[0] as string) === "Filter by Span Status";
      },
    ) as Array<string>;

    expect([...boldSpans(row[1] as string)].sort()).toEqual(
      [...statuses].sort(),
    );
    expect(statuses.sort()).toEqual(["Error", "Ok", "Unset"]);
  });

  it("Exceptions: the message matches ignoring case, types and environments exactly, and an empty list is no filter", () => {
    const query: Record<string, unknown> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
        ...MonitorStepExceptionMonitorUtil.getDefault(),
        message: "timeout",
        exceptionTypes: ["TypeError"],
        environments: ["production"],
      }) as Record<string, unknown>;

    expect(query["message"]).toBeInstanceOf(Search);
    expect(query["exceptionType"]).toBeInstanceOf(Includes);
    expect(query["environment"]).toBeInstanceOf(Includes);
    expect((query["environment"] as Includes).values).toEqual(["production"]);

    // Exact and case-sensitive: trimmed and de-duplicated, never lowercased.
    expect(
      MonitorStepExceptionMonitorUtil.normalizeEnvironments([
        " production ",
        "Production",
        "production",
      ]),
    ).toEqual(["production", "Production"]);
    expect(
      (
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
          MonitorStepExceptionMonitorUtil.getDefault(),
        ) as Record<string, unknown>
      )["environment"],
    ).toBeUndefined();

    expect(EXCEPTIONS).toContain(
      "Matching is exact and case-sensitive: `production` does not match `Production` or `prod`. Exceptions with no environment are not counted when this filter is set.",
    );
  });

  it("Profiles: types exactly, a type pattern ignoring case that wins over the list", () => {
    const step: MonitorStepProfileMonitor =
      MonitorStepProfileMonitorUtil.fromJSON({
        profileTypes: ["cpu"],
        telemetryServiceIds: [],
        lastXSecondsOfProfiles: 300,
      });

    expect(
      (MonitorStepProfileMonitorUtil.toQuery(step) as Record<string, unknown>)[
        "profileType"
      ],
    ).toBeInstanceOf(Includes);
    expect(
      (
        MonitorStepProfileMonitorUtil.toQuery({
          ...step,
          profileType: "alloc",
        }) as Record<string, unknown>
      )["profileType"],
    ).toBeInstanceOf(Search);

    const rows: Array<Array<string>> = tableRows(PROFILES, ["Field"]);

    expect(rows[0]?.[1]).toBe(
      "Profiles of any of these types, matched exactly, such as `cpu`.",
    );
    expect(rows[1]?.[1]).toBe(
      "Profiles whose type contains this text, ignoring case. When it is set, `profileTypes` is ignored.",
    );
  });

  it.each([
    { name: "Logs", markdown: LOGS, file: LOG_FORM },
    { name: "Traces", markdown: TRACES, file: TRACE_FORM },
    { name: "Exceptions", markdown: EXCEPTIONS, file: EXCEPTION_FORM },
  ])(
    "$name: the fields the page puts under More fields are the ones the form folds, in its order",
    (form: { name: string; markdown: string; file: string }) => {
      const fields: Array<SourceField> = sourceFields(
        dashboardSource(form.file),
      );
      const rows: Array<Array<string>> = tableRows(form.markdown, ["Field"]);
      const folded: Array<string> = rows
        .filter((cells: Array<string>): boolean => {
          return (cells[0] as string).includes(
            `(under **${MORE_FIELDS_SECTION_TITLE}**)`,
          );
        })
        .map((cells: Array<string>): string => {
          return boldSpans(cells[0] as string)[0] as string;
        });
      const shown: Array<string> = rows
        .filter((cells: Array<string>): boolean => {
          return !(cells[0] as string).includes("(under **");
        })
        .map((cells: Array<string>): string => {
          return plain(cells[0] as string);
        });

      expect(folded).toEqual(
        fields
          .filter((field: SourceField): boolean => {
            return field.section !== null;
          })
          .map((field: SourceField): string => {
            return field.title;
          }),
      );
      expect(shown).toEqual(
        fields
          .filter((field: SourceField): boolean => {
            return field.section === null;
          })
          .map((field: SourceField): string => {
            return field.title;
          }),
      );
    },
  );
});

describe("log severities", () => {
  it("are the seven the page names, each stored from the OpenTelemetry severity numbers its table gives", () => {
    const ingest: string = readSource(
      "App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
    );
    const ranges: Array<Array<string>> = Array.from(
      ingest.matchAll(
        /severityNumber >= (\d+) && severityNumber <= (\d+)\) \{\s*return LogSeverity\.(\w+);/g,
      ),
      (match: RegExpMatchArray): Array<string> => {
        return [
          LogSeverity[match[3] as keyof typeof LogSeverity],
          `${match[1]}–${match[2]}`,
        ];
      },
    );

    expect(ranges).toHaveLength(6);
    expect(ingest).toMatch(/\}\s*return LogSeverity\.Unspecified;\s*\}/);

    const rows: Array<Array<string>> = tableRows(
      sectionOf(LOGS, "### Log severity"),
      ["Severity", "OpenTelemetry severity numbers"],
    ).map((cells: Array<string>): Array<string> => {
      return [plain(cells[0] as string), cells[1] as string];
    });

    expect(rows).toEqual([
      ...ranges,
      [LogSeverity.Unspecified, "Anything else"],
    ]);
    expect(Object.values(LogSeverity)).toHaveLength(7);
    expect(LOGS).toContain("Every log is stored with one of seven severities.");
  });

  it("the Log Severity filter offers every one of them", () => {
    expect(oneLine(dashboardSource(LOG_FORM))).toContain(
      'dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(LogSeverity), fieldType: FormFieldSchemaType.MultiSelectDropdown, title: "Log Severity",',
    );
  });
});

interface CountPage {
  name: string;
  markdown: string;
  monitorType: MonitorType;
  checkOn: CheckOn;
  header: Array<string>;
}

const COUNT_PAGES: Array<CountPage> = [
  {
    name: "Logs",
    markdown: LOGS,
    monitorType: MonitorType.Logs,
    checkOn: CheckOn.LogCount,
    header: ["Filter Condition", "Matches when the log count is…"],
  },
  {
    name: "Metrics",
    markdown: METRICS,
    monitorType: MonitorType.Metrics,
    checkOn: CheckOn.MetricValue,
    header: ["Condition", "Matches when the value is…"],
  },
  {
    name: "Traces",
    markdown: TRACES,
    monitorType: MonitorType.Traces,
    checkOn: CheckOn.SpanCount,
    header: ["Filter Condition", "Matches when the span count is…"],
  },
  {
    name: "Exceptions",
    markdown: EXCEPTIONS,
    monitorType: MonitorType.Exceptions,
    checkOn: CheckOn.ExceptionCount,
    header: ["Filter Condition", "Matches when the exception count is…"],
  },
  {
    name: "Profiles",
    markdown: PROFILES,
    monitorType: MonitorType.Profiles,
    checkOn: CheckOn.ProfileCount,
    header: ["Filter Condition", "Matches when the profile count is…"],
  },
];

function offeredConditions(checkOn: CheckOn): Array<string> {
  return CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn).map(
    (option: { value: unknown }): string => {
      return String(option.value);
    },
  );
}

const ANOMALY_CONDITIONS: Array<FilterType> = [
  FilterType.AnomalouslyHigh,
  FilterType.AnomalouslyLow,
  FilterType.Anomalous,
];

describe("criteria", () => {
  it.each(COUNT_PAGES)(
    "$name: the criteria compare one number, $checkOn, which the page names",
    (entry: CountPage) => {
      expect(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
          entry.monitorType,
        ).map((option: { value: unknown }): unknown => {
          return option.value;
        }),
      ).toEqual([entry.checkOn]);
      expect(entry.markdown).toContain(`**${entry.checkOn}**`);
    },
  );

  it.each(COUNT_PAGES)(
    "$name: the conditions table lists exactly the conditions the form offers for $checkOn",
    (entry: CountPage) => {
      const listed: Array<string> = tableRows(entry.markdown, entry.header).map(
        (cells: Array<string>): string => {
          return plain(cells[0] as string);
        },
      );

      expect([...listed].sort()).toEqual(
        [...offeredConditions(entry.checkOn)].sort(),
      );
    },
  );

  it("offers the anomaly conditions on log, span and metric criteria, and the exception and profile pages say why they have none", () => {
    for (const entry of COUNT_PAGES) {
      const hasAnomaly: boolean = offeredConditions(entry.checkOn).some(
        (condition: string): boolean => {
          return CommonCriteriaFilterUtil.isAnomalyFilterType(
            condition as FilterType,
          );
        },
      );

      expect({ page: entry.name, hasAnomaly: hasAnomaly }).toEqual({
        page: entry.name,
        hasAnomaly: [
          CheckOn.LogCount,
          CheckOn.SpanCount,
          CheckOn.MetricValue,
        ].includes(entry.checkOn),
      });
    }

    expect(EXCEPTIONS).toContain(
      "Exception counts have no anomaly conditions: there is no baseline to compare them with.",
    );
    expect(PROFILES).toContain(
      "Profile counts have no anomaly conditions: there is no baseline to compare them with.",
    );
  });

  it("the anomaly settings are the criteria form's: Low, Medium (the default) or High, over 14 (the default), 28, 60 or 90 days", () => {
    const form: string = oneLine(
      dashboardSource("Components/Form/Monitor/CriteriaFilter.tsx"),
    );
    const sensitivities: Array<string> = Array.from(
      form.matchAll(
        /value: AnomalyDetectionSensitivity\.(\w+), label: "\1 \(/g,
      ),
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
    const windows: Array<number> = Array.from(
      form.matchAll(/\{ value: (\d+), label: "\1 days/g),
      (match: RegExpMatchArray): number => {
        return Number(match[1]);
      },
    );

    expect(sensitivities).toEqual(Object.values(AnomalyDetectionSensitivity));
    expect(sensitivities).toEqual(["Low", "Medium", "High"]);
    expect(form).toContain("|| AnomalyDetectionSensitivity.Medium;");
    expect(windows).toEqual([14, 28, 60, 90]);
    expect(form).toContain('{ value: 14, label: "14 days (default)" }');
    expect(form).toContain("?.windowDays || 14;");

    const baseline: string = readSource(
      "Common/Server/Services/MetricBaselineService.ts",
    );

    expect(baseline).toContain(
      "public static readonly DEFAULT_WINDOW_DAYS: number = 14;",
    );
    expect(baseline).toContain(
      "public static readonly MAX_WINDOW_DAYS: number = 90;",
    );

    for (const markdown of [LOGS, TRACES]) {
      expect(markdown).toContain(
        "Pick a **Sensitivity** — Low, Medium (the default) or High — and a **Baseline Window** of 14 (the default), 28, 60 or 90 days.",
      );
    }

    expect(METRICS).toContain(
      "The form shows **Sensitivity** — Low, Medium (the default) or High — and **Baseline Window** — 14 days (the default), 28, 60 or 90 — instead",
    );
  });

  it("a log count's baseline is scoped by the monitor's services and severities, a span count's by its services and statuses, and nothing else", () => {
    const inputKeys: (file: string) => Array<string> = (
      file: string,
    ): Array<string> => {
      const match: RegExpMatchArray | null = readSource(file).match(
        /getBaseline\(input: \{([\s\S]*?)\}\): Promise/,
      );

      expect(match).not.toBeNull();

      return Array.from(
        ((match as RegExpMatchArray)[1] as string).matchAll(/(\w+)\??:/g),
        (key: RegExpMatchArray): string => {
          return key[1] as string;
        },
      );
    };

    expect(
      inputKeys("Common/Server/Services/LogCountBaselineService.ts"),
    ).toEqual([
      "projectId",
      "telemetryServiceIds",
      "severityTexts",
      "hourOfWeek",
      "windowDays",
      "minSamples",
    ]);
    expect(
      inputKeys("Common/Server/Services/SpanCountBaselineService.ts"),
    ).toEqual([
      "projectId",
      "telemetryServiceIds",
      "spanStatusCodes",
      "hourOfWeek",
      "windowDays",
      "minSamples",
    ]);

    expect(LOGS).toContain(
      "The baseline covers the monitor's services and severities only: its text and attribute filters are not part of it.",
    );
    expect(TRACES).toContain(
      "The baseline covers the monitor's services and span statuses only: its span name and attribute filters are not part of it.",
    );
  });

  it("an anomalous log or span count is judged as a per-minute rate", () => {
    expect(
      readSource("Common/Server/Utils/Monitor/Criteria/LogMonitorCriteria.ts"),
    ).toContain(
      "const observedPerMinute: number = (logCount * 60) / windowSeconds;",
    );
    expect(
      readSource(
        "Common/Server/Utils/Monitor/Criteria/TraceMonitorCriteria.ts",
      ),
    ).toContain(
      "const observedPerMinute: number = (spanCount * 60) / windowSeconds;",
    );

    for (const markdown of [LOGS, TRACES]) {
      expect(markdown).toContain(
        "OneUptime turns the count into a per-minute rate and compares it with the same hour of the week over that window.",
      );
    }
  });

  it("a grouped Logs monitor's anomaly conditions never match, while a threshold does for the group that meets it", async () => {
    const grouped: LogMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      logCount: 500,
      logQuery: {},
      groupByAttributes: ["con_name"],
      groupBreakdown: [
        {
          fingerprint: "hq-branch1",
          labels: { con_name: "HQ-Branch1" },
          logCount: 500,
        },
      ],
    };

    for (const filterType of ANOMALY_CONDITIONS) {
      const filter: CriteriaFilter = {
        checkOn: CheckOn.LogCount,
        filterType: filterType,
        value: undefined,
      };

      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: grouped,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    }

    expect(
      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: grouped,
        criteriaFilter: {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      }),
    ).toContain("For con_name = HQ-Branch1:");

    expect(LOGS).toContain(
      "- **Anomaly detection** (**Anomalously High**, **Anomalously Low**, **Anomalous**) is not evaluated per group - its baseline covers the whole monitor - so those filters never match on a grouped monitor.",
    );
  });
});

interface DefaultCriteriaPage {
  name: string;
  markdown: string;
  monitorType: MonitorType;
  header: Array<string>;
  // Whether the Filter cell names the filter before its condition.
  namesCheckOn: boolean;
}

const DEFAULT_CRITERIA_PAGES: Array<DefaultCriteriaPage> = [
  {
    name: "Logs",
    markdown: LOGS,
    monitorType: MonitorType.Logs,
    header: ["Criteria", "Filter", "Effect"],
    namesCheckOn: true,
  },
  {
    name: "Metrics",
    markdown: METRICS,
    monitorType: MonitorType.Metrics,
    header: ["Criteria", "Condition", "Effect"],
    namesCheckOn: false,
  },
  {
    name: "Traces",
    markdown: TRACES,
    monitorType: MonitorType.Traces,
    header: ["Criteria", "Filter", "Effect"],
    namesCheckOn: true,
  },
  {
    name: "Exceptions",
    markdown: EXCEPTIONS,
    monitorType: MonitorType.Exceptions,
    header: ["Criteria", "Filter", "Effect"],
    namesCheckOn: true,
  },
];

describe("the criteria a new monitor starts with", () => {
  it.each(DEFAULT_CRITERIA_PAGES)(
    "$name: the page's table is the pair of criteria a new monitor is given",
    (entry: DefaultCriteriaPage) => {
      const offline: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
          monitorType: entry.monitorType,
          monitorStatusId: ObjectID.generate(),
          incidentSeverityId: ObjectID.generate(),
          alertSeverityId: ObjectID.generate(),
          monitorName: "…",
          metricOptions: { metricAliases: ["a", "b"] },
        });
      const online: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: entry.monitorType,
          monitorStatusId: ObjectID.generate(),
          monitorName: "…",
          metricOptions: { metricAliases: ["a", "b"] },
        });

      expect(online).not.toBeNull();

      const rows: Array<Array<string>> = tableRows(
        entry.markdown,
        entry.header,
      );

      expect(rows).toHaveLength(2);

      const pairs: Array<[MonitorCriteriaInstance, Array<string>]> = [
        [offline, rows[0] as Array<string>],
        [online as MonitorCriteriaInstance, rows[1] as Array<string>],
      ];

      for (const [instance, row] of pairs) {
        const filter: CriteriaFilter = instance.data!
          .filters[0] as CriteriaFilter;

        expect(instance.data!.filters).toHaveLength(1);
        expect(row[0]).toBe(instance.data!.name);
        expect(row[1]).toBe(
          `${entry.namesCheckOn ? `**${filter.checkOn}** ` : ""}**${filter.filterType}** \`${filter.value}\``,
        );

        const declaresIncident: boolean = Boolean(
          instance.data!.createIncidents,
        );

        expect({ row: row[0], declaresIncident: declaresIncident }).toEqual({
          row: row[0],
          declaresIncident: (row[2] as string).includes("declares an incident"),
        });

        if (declaresIncident) {
          expect(instance.data!.incidents[0]?.autoResolveIncident).toBe(true);
          expect(row[2]).toBe(
            "Marks the monitor offline and declares an incident, resolved automatically",
          );
        } else {
          expect(row[2]).toBe("Marks the monitor online");
        }

        if (entry.monitorType === MonitorType.Metrics) {
          expect(filter.metricMonitorOptions).toEqual({
            metricAggregationType: EvaluateOverTimeType.AnyValue,
            metricAlias: "a",
          });
        }
      }
    },
  );

  it("Metrics: both start on the first query, with the Any Value aggregation, and a reported 0 is not silence", () => {
    expect(METRICS).toContain(
      `A new Metrics monitor starts with two criteria on its first query, both with the **${EvaluateOverTimeType.AnyValue}** aggregation:`,
    );
    expect(METRICS).toContain(
      "The offline criteria fires on a reported value of 0, not on silence. To alert when a metric stops arriving, set its **If No Data** to **Trigger**.",
    );
  });
});

describe("the Metrics monitor", () => {
  it("offers the twenty time ranges the page lists, starting at Past 1 Minute", () => {
    const paragraph: string = lineStartingWith(
      METRICS,
      "**Time Range** sets how far back every evaluation looks:",
    );

    expect(boldSpans(paragraph).slice(1)).toEqual(Object.values(RollingTime));
    expect(RollingTimeUtil.getDefault()).toBe(RollingTime.Past1Minute);
    expect(MonitorStepMetricMonitorUtil.getDefault().rollingTime).toBe(
      RollingTime.Past1Minute,
    );
    expect(METRICS).toContain(`It starts at **${RollingTime.Past1Minute}**.`);
  });

  it("says how wide one data point is for every time range, as the aggregate query buckets the window", () => {
    const widths: Record<AggregationInterval, string> = {
      [AggregationInterval.Minute]: "minute",
      [AggregationInterval.FiveMinutes]: "5 minutes",
      [AggregationInterval.FifteenMinutes]: "15 minutes",
      [AggregationInterval.ThirtyMinutes]: "30 minutes",
      [AggregationInterval.Hour]: "hour",
      [AggregationInterval.Day]: "day",
      [AggregationInterval.Week]: "week",
      [AggregationInterval.Month]: "month",
      [AggregationInterval.Year]: "year",
      [AggregationInterval.Total]: "total",
    };
    const order: Array<string> = Object.values(RollingTime);
    const documented: Map<string, string> = new Map<string, string>();

    for (const [ranges, width] of tableRows(METRICS, [
      "Time Range",
      "One data point per",
    ])) {
      for (const part of (ranges as string).split(", ")) {
        const [from, to] = part.split(" to ") as [string, string | undefined];
        const start: number = order.indexOf(from);
        const end: number = to ? order.indexOf(to) : start;

        expect({ part: part, known: start >= 0 && end >= start }).toEqual({
          part: part,
          known: true,
        });

        for (let index: number = start; index <= end; index++) {
          documented.set(order[index] as string, width as string);
        }
      }
    }

    expect([...documented.keys()].sort()).toEqual([...order].sort());

    for (const rollingTime of Object.values(RollingTime)) {
      const window: InBetween<Date> =
        RollingTimeUtil.convertToStartAndEndDate(rollingTime);
      const interval: AggregationInterval =
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: window.startValue,
          endDate: window.endValue,
        });

      expect({
        rollingTime: rollingTime,
        width: documented.get(rollingTime),
      }).toEqual({ rollingTime: rollingTime, width: widths[interval] });
    }

    // The worker never pins a bucket: the window decides it.
    expect(TELEMETRY_JOB).not.toContain("aggregationInterval");
  });

  it("aggregates each bucket the ways Aggregate by lists, by Avg unless told otherwise", () => {
    const row: Array<string> = tableRows(
      sectionOf(METRICS, "### Metric queries"),
      ["Field", "What it does", "Default"],
    ).find((cells: Array<string>): boolean => {
      return plain(cells[0] as string) === "Aggregate by";
    }) as Array<string>;
    const named: Array<string> =
      (row[1] as string).match(/\b(Avg|Sum|Min|Max|Count|P\d\d)\b/g) || [];

    expect([...named].sort()).toEqual(Object.values(AggregationType).sort());
    expect(row[2]).toBe(AggregationType.Avg);
    expect(TELEMETRY_JOB).toContain(
      ".aggegationType as MetricsAggregationType) || MetricsAggregationType.Avg;",
    );
  });

  it("reduces a criteria's data points the six ways the Aggregation table lists, in its order", () => {
    expect(
      tableRows(METRICS, [
        "Aggregation",
        "The condition is checked against…",
      ]).map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual(Object.values(EvaluateOverTimeType));
  });

  it("works the growing-queue example out the way the evaluator does", () => {
    const minuteRows: Array<Array<string>> = tableRows(METRICS, ["Minute"]);
    const values: Array<number> = (minuteRows[0] as Array<string>)
      .slice(1)
      .map(numberOf);

    expect(values).toEqual([640, 980, 1500, 1620, 1100]);
    expect(METRICS).toContain(
      "A criteria of **Metric** `a`, **Condition** **Greater Than**, **Threshold** `1000` gives a different answer for each **Aggregation**:",
    );

    for (const [aggregation, compared, matches] of tableRows(METRICS, [
      "Aggregation",
      "Compared with 1,000",
      "Matches?",
    ])) {
      const evaluationType: EvaluateOverTimeType =
        aggregation as EvaluateOverTimeType;
      const reduced: Array<number> = CompareCriteria.reduceWindow({
        values: values,
        evaluationType: evaluationType,
      });
      const isMet: boolean = CompareCriteria.greaterThan({
        value: values,
        evaluationType: evaluationType,
        threshold: 1000,
      });

      expect({ aggregation: aggregation, compared: compared }).toEqual({
        aggregation: aggregation,
        compared: reduced
          .map((value: number): string => {
            return value.toLocaleString("en-US");
          })
          .join(", "),
      });
      expect({ aggregation: aggregation, matches: matches }).toEqual({
        aggregation: aggregation,
        matches: expect.stringMatching(isMet ? /^Yes/ : /^No/),
      });
    }
  });

  it("treats no data as each criteria's If No Data says, Ignore unless it is set, under More fields", () => {
    expect(Object.values(NoDataPolicy)).toEqual([
      "Ignore",
      "Treat As Zero",
      "Trigger",
    ]);
    expect(
      oneLine(
        readSource(
          "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria.ts",
        ),
      ),
    ).toContain(
      "const policy: NoDataPolicy = input.criteriaFilter.metricMonitorOptions?.onNoDataPolicy || NoDataPolicy.Ignore;",
    );

    const form: string = oneLine(
      dashboardSource("Components/Form/Monitor/CriteriaFilter.tsx"),
    );

    expect(form).toContain("<FoldedSection title={MORE_FIELDS_SECTION_TITLE}");
    expect(form).toContain('title="If No Data"');
    expect(METRICS).toContain(
      "a criteria does what its **If No Data** setting says, under **More fields**: **Ignore** (the default — the criteria does not match), **Treat As Zero**, or **Trigger**.",
    );
  });

  it("formulas take the operators the page lists, with or without a $, and queries are named a, b, c in order", () => {
    const section: string = sectionOf(METRICS, "### Formulas");

    for (const operator of ["+", "-", "*", "/", "%", "^"]) {
      expect(section).toContain(`\`${operator}\``);
      expect({
        operator: operator,
        error: MetricFormulaEvaluator.validateFormula({
          formula: `(a ${operator} b) ${operator} 2`,
          availableVariables: ["a", "b"],
        }),
      }).toEqual({ operator: operator, error: null });
    }

    expect(
      MetricFormulaEvaluator.getReferencedVariables("$a / b * 100"),
    ).toEqual(["a", "b"]);
    expect(
      MetricFormulaEvaluator.validateFormula({
        formula: "a & b",
        availableVariables: ["a", "b"],
      }),
    ).not.toBeNull();

    // Every example the section gives is a formula the evaluator accepts.
    for (const example of codeSpans(section).filter((span: string) => {
      return span.includes(" ");
    })) {
      expect({
        example: example,
        error: MetricFormulaEvaluator.validateFormula({
          formula: example,
          availableVariables: ["a", "b"],
        }),
      }).toEqual({ example: example, error: null });
    }

    expect(
      [0, 1, 2].map((index: number): string => {
        return Text.getLetterFromAByNumber(index);
      }),
    ).toEqual(["a", "b", "c"]);
    expect(dashboardSource("Components/Metrics/MetricView.tsx")).toContain(
      "const candidate: string = Text.getLetterFromAByNumber(index);",
    );
    expect(METRICS).toContain(
      "Each query and formula gets a variable — `a`, `b`, `c` and so on — in the order you add them.",
    );
  });
});

describe("the Exceptions monitor", () => {
  it("leaves out resolved and archived exceptions unless told to count them, and the page's table says Off", () => {
    const step: ReturnType<typeof MonitorStepExceptionMonitorUtil.getDefault> =
      MonitorStepExceptionMonitorUtil.getDefault();

    expect(step.includeResolved).toBe(false);
    expect(step.includeArchived).toBe(false);
    expect(MonitorStepExceptionMonitorUtil.fromJSON({}).includeResolved).toBe(
      false,
    );
    expect(TELEMETRY_JOB).toContain(
      "const excludeResolved: boolean = !exceptionMonitorConfig.includeResolved;",
    );
    expect(TELEMETRY_JOB).toContain(
      "const excludeArchived: boolean = !exceptionMonitorConfig.includeArchived;",
    );
    expect(TELEMETRY_JOB).toContain(
      "countQuery.fingerprint = new IncludesNone(excludedFingerprints);",
    );

    for (const title of [
      "Include Resolved Exceptions",
      "Include Archived Exceptions",
    ]) {
      const row: Array<string> | undefined = tableRows(EXCEPTIONS, [
        "Field",
      ]).find((cells: Array<string>): boolean => {
        return boldSpans(cells[0] as string)[0] === title;
      });

      expect(row?.[2]).toBe("Off");
    }
  });

  it("un-resolves an exception when it occurs again, so it is counted again", () => {
    const upsert: string = oneLine(
      readSource("App/FeatureSet/Telemetry/Utils/Exception.ts"),
    );
    const conflict: string = upsert.slice(upsert.indexOf("DO UPDATE SET"));

    expect(conflict).toContain('"isResolved" = false,');
    expect(conflict).not.toContain('"isArchived" = false');
    expect(EXCEPTIONS).toContain(
      "When a resolved exception occurs again, it is un-resolved automatically and counted again.",
    );
  });

  it("the API example is a step the product reads back as written", () => {
    const example: JSONObject = jsonBlockOf(
      sectionOf(EXCEPTIONS, "### Environments"),
    )["exceptionMonitor"] as JSONObject;
    const keys: Array<string> = Object.keys(
      MonitorStepExceptionMonitorUtil.toJSON(
        MonitorStepExceptionMonitorUtil.getDefault(),
      ),
    );

    for (const key of Object.keys(example)) {
      expect({ key: key, known: keys.includes(key) }).toEqual({
        key: key,
        known: true,
      });
    }

    const step: ReturnType<typeof MonitorStepExceptionMonitorUtil.fromJSON> =
      MonitorStepExceptionMonitorUtil.fromJSON(example);

    expect(step.environments).toEqual(["production"]);
    expect(step.lastXSecondsOfExceptions).toBe(300);
  });

  it("counts the worked example's exceptions as the page does", () => {
    const counted: number = tableRows(EXCEPTIONS, [
      "Exceptions",
      "Environment",
      "State",
      "Counted?",
    ])
      .map((cells: Array<string>): number => {
        const yes: RegExpMatchArray | null = (cells[3] as string).match(
          /^Yes: (\d+)$/,
        );

        return yes ? Number(yes[1]) : 0;
      })
      .reduce((sum: number, count: number): number => {
        return sum + count;
      }, 0);

    expect(EXCEPTIONS).toContain(
      `The **Exception Count** is ${counted}, so **Greater Than** \`0\` matches`,
    );
  });
});

describe("the Profiles monitor", () => {
  it("the configuration example is a step the product reads, and the fields table names every field it has", () => {
    const example: JSONObject = jsonBlockOf(
      sectionOf(PROFILES, "## Create a profiles monitor"),
    )["profileMonitor"] as JSONObject;
    const keys: Array<string> = Object.keys(
      MonitorStepProfileMonitorUtil.toJSON(
        MonitorStepProfileMonitorUtil.getDefault(),
      ),
    );

    for (const key of Object.keys(example)) {
      expect({ key: key, known: keys.includes(key) }).toEqual({
        key: key,
        known: true,
      });
    }

    const step: MonitorStepProfileMonitor =
      MonitorStepProfileMonitorUtil.fromJSON(example);

    expect(step.profileTypes).toEqual(["cpu"]);
    expect(step.lastXSecondsOfProfiles).toBe(300);

    expect(
      tableRows(PROFILES, ["Field"])
        .map((cells: Array<string>): string => {
          return codeSpans(cells[0] as string)[0] as string;
        })
        .sort(),
    ).toEqual([...keys].sort());
  });

  it("is created through the API with the type Profiles, or Terraform's profile_monitor attribute", () => {
    expect(PROFILES).toContain(
      `Create a monitor with the monitor type \`${MonitorType.Profiles}\``,
    );
    expect(PROFILES).toContain(
      "In Terraform, pass the configuration as the step's `profile_monitor` attribute, written with `jsonencode()`.",
    );
    expect(
      fs.readFileSync(
        path.join(
          REPO_DIR,
          "Scripts/TerraformProvider/StaticFiles/monitorsteps.go",
        ),
        "utf8",
      ),
    ).toContain('{"profile_monitor", "profileMonitor"},');
  });
});

describe("status page resources", () => {
  const monitorFields: Array<
    ReturnType<typeof getStatusPageResourceFormFields>[number]
  > = getStatusPageResourceFormFields({ addMonitorGroup: false });
  const monitorGroupFields: Array<
    ReturnType<typeof getStatusPageResourceFormFields>[number]
  > = getStatusPageResourceFormFields({ addMonitorGroup: true });

  it("Add Monitor asks for the monitor and its display name, and folds everything else under More fields", () => {
    expect(
      monitorFields.map((field: { title?: string | undefined }): string => {
        return field.title || "";
      }),
    ).toEqual([
      "Monitor",
      "Display Name",
      "Description",
      "Tooltip",
      "Show Current Resource Status",
      "Show Uptime %",
      "Select Uptime Precision",
      "Show Status History Chart",
    ]);
    expect(
      monitorFields
        .filter((field: { collapsibleSection?: unknown }): boolean => {
          return !field.collapsibleSection;
        })
        .map((field: { title?: string | undefined }): string => {
          return field.title || "";
        }),
    ).toEqual(["Monitor", "Display Name"]);
    expect(monitorFields[0]?.placeholder).toBe("Select Monitor");
    expect(monitorGroupFields[0]?.title).toBe("Monitor Group");
    expect(monitorGroupFields[0]?.placeholder).toBe("Select Monitor Group");

    expect(RESOURCES).toContain(
      "Choose it in **Monitor** (placeholder **Select Monitor**).",
    );
    expect(RESOURCES).toContain(
      "Click it and **Monitor** becomes **Monitor Group** (**Select Monitor Group**)",
    );
    expect(RESOURCES).toContain(
      `**${MORE_FIELDS_SECTION_TITLE}** is folded. It holds **Description**`,
    );
  });

  it("the display options table gives each option's column and the default the form and the resource start with", () => {
    const described: (value: unknown) => string = (value: unknown): string => {
      if (value === undefined) {
        return "Empty";
      }

      if (value === true) {
        return "On";
      }

      if (value === false) {
        return "Off";
      }

      if (value === UptimePrecision.ONE_DECIMAL) {
        return "One decimal";
      }

      return String(value);
    };
    const rows: Array<Array<string>> = tableRows(RESOURCES, [
      "Field",
      "Default",
      "What it does",
    ]);

    expect(rows).toHaveLength(5);

    for (const [name, defaultText] of rows) {
      const title: string = boldSpans(name as string)[0] as string;
      const column: string = codeSpans(name as string)[0] as string;
      const field: (typeof monitorFields)[number] | undefined =
        monitorFields.find((candidate: { title?: string | undefined }) => {
          return candidate.title === title;
        });

      expect({ title: title, inForm: field !== undefined }).toEqual({
        title: title,
        inForm: true,
      });
      expect(Object.keys(field!.field || {})).toEqual([column]);
      expect({ title: title, default: defaultText }).toEqual({
        title: title,
        default: described(field!.defaultValue),
      });

      const columnDefault: unknown =
        new StatusPageResource().getTableColumnMetadata(column).defaultValue;

      if (typeof field!.defaultValue === "boolean") {
        expect({ column: column, default: columnDefault }).toEqual({
          column: column,
          default: field!.defaultValue,
        });
      }
    }

    for (const column of ["displayName", "displayDescription"]) {
      expect(
        new StatusPageResource().getTableColumnMetadata(column),
      ).toBeTruthy();
      expect(RESOURCES).toContain(`(\`${column}\`)`);
    }
  });

  it("names the four uptime precisions as the dropdown stores them", () => {
    expect(
      codeSpans(
        lineStartingWith(RESOURCES, "**Precision is a judgment call.**"),
      ),
    ).toEqual(Object.values(UptimePrecision));
  });

  it("uptime percentages and history charts cover 1 to 90 days, 90 unless the page says otherwise", () => {
    const uptime: DisplaySectionDefinition = DISPLAY_SECTIONS.find(
      (section: DisplaySectionDefinition): boolean => {
        return section.id === "uptime-history";
      },
    ) as DisplaySectionDefinition;
    const defaultDays: unknown = new StatusPage().getTableColumnMetadata(
      "showUptimeHistoryInDays",
    ).defaultValue;

    expect(uptime.title).toBe(StatusPageDisplaySettingsCopy.uptimeTitle);
    expect(uptime.days?.column).toBe("showUptimeHistoryInDays");
    expect(uptime.days?.maxDays).toBe(MAX_UPTIME_HISTORY_DAYS);
    expect(MAX_UPTIME_HISTORY_DAYS).toBe(90);
    expect(defaultDays).toBe(90);
    expect(StatusPageDisplaySettingsCopy.daysOutOfRange).toBe(
      "Enter a whole number of days between 1 and {{max}}.",
    );
    expect(RESOURCES).toContain(
      `That is **${StatusPageDisplaySettingsCopy.uptimeTitle}** in the **${StatusPageDisplaySettingsCopy.cardTitle}** card on **Status Pages → your page → Advanced → Advanced Settings**. It accepts 1 to ${MAX_UPTIME_HISTORY_DAYS} days and defaults to ${defaultDays}.`,
    );
    expect(BRANDING).toContain(`from 1 to ${MAX_UPTIME_HISTORY_DAYS} days`);
  });

  it("a monitor is on a page once: a second resource for it is refused with the words the page quotes", () => {
    const service: string = oneLine(
      readSource("Common/Server/Services/StatusPageResourceService.ts"),
    );

    expect(service).toContain(
      'const thing: string = target.monitorId ? "monitor" : "monitor group";',
    );
    expect(service).toContain(
      "`This ${thing} is already added to this status page.",
    );
    expect(RESOURCES).toContain(
      '*"This monitor is already added to this status page"*',
    );
    expect(RESOURCES).toContain(
      ':::details "This monitor is already added to this status page"',
    );
  });

  it("the old /groups address forwards to the Resources screen", () => {
    expect(dashboardSource("Utils/RouteMap.ts")).toContain(
      "[PageMap.STATUS_PAGE_VIEW_GROUPS]: `${RouteParams.ModelID}/groups`,",
    );

    const groups: string = oneLine(
      dashboardSource("Pages/StatusPages/View/Groups.tsx"),
    );

    expect(groups).toContain(
      "RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route,",
    );
    expect(groups).toContain(
      "<Navigate to={resourcesRoute.toString()} replace={true} />",
    );
    expect(RESOURCES).toContain(
      "the old `/groups` address now opens this screen.",
    );
  });
});

describe("status page groups", () => {
  const resourcesView: string = dashboardSource(
    "Pages/StatusPages/View/Resources.tsx",
  );
  const groupForm: Array<SourceField> = sourceFields(
    resourcesView.slice(
      resourcesView.lastIndexOf(
        "field: {",
        resourcesView.indexOf('title: "Group Name"'),
      ) - 10,
      resourcesView.indexOf(
        "The resource form, shared by every way of creating one.",
      ),
    ),
  );

  const groupField: (title: string) => SourceField = (
    title: string,
  ): SourceField => {
    const field: SourceField | undefined = groupForm.find(
      (candidate: SourceField): boolean => {
        return candidate.title === title;
      },
    );

    expect({ title: title, inForm: field !== undefined }).toEqual({
      title: title,
      inForm: true,
    });

    return field as SourceField;
  };

  it("Create New Status Page Group asks two fields, then folds Layout and More fields", () => {
    expect(
      groupForm
        .filter((field: SourceField): boolean => {
          return field.section === null;
        })
        .map((field: SourceField): string => {
          return field.title;
        }),
    ).toEqual(["Group Name", "Parent Group"]);
    expect(groupField("Parent Group").placeholder).toBe(
      "No parent group (top level)",
    );
    expect(
      groupForm
        .filter((field: SourceField): boolean => {
          return field.section === "layoutSection";
        })
        .map((field: SourceField): string => {
          return field.title;
        }),
    ).toEqual([
      "View Mode",
      "Row Axis Label",
      "Row Axis Values",
      "Column Axis Label",
      "Column Axis Values",
    ]);
    expect(
      groupForm
        .filter((field: SourceField): boolean => {
          return field.section === "advancedSection";
        })
        .map((field: SourceField): string => {
          return field.title;
        }),
    ).toEqual([
      "Group Description",
      "Expand on Status Page by Default",
      "Show Current Group Status",
      "Show Uptime %",
      "Select Uptime Precision",
    ]);

    const dialog: string = oneLine(resourcesView);

    expect(dialog).toContain(
      '? "Create New Status Page Group" : "Edit Status Page Group"',
    );
    expect(dialog).toContain('? "Create Status Page Group" : "Save Changes"');
    expect(RESOURCES).toContain(
      "**Create New Status Page Group** opens: two fields, then two folded sections.",
    );
    expect(RESOURCES).toContain(
      "The two fields are **Group Name** (`name`) and **Parent Group** (`parentStatusPageGroupId`).",
    );

    for (const column of ["name", "parentStatusPageGroupId"]) {
      expect(new StatusPageGroup().getTableColumnMetadata(column)).toBeTruthy();
    }
  });

  it("a group starts expanded, showing its status, without an uptime %, and listed rather than a grid", () => {
    const group: StatusPageGroup = new StatusPageGroup();

    for (const [title, column, on] of [
      ["Expand on Status Page by Default", "isExpandedByDefault", true],
      ["Show Current Group Status", "showCurrentStatus", true],
      ["Show Uptime %", "showUptimePercent", false],
    ] as Array<[string, string, boolean]>) {
      expect({ title: title, form: groupField(title).defaultValue }).toEqual({
        title: title,
        form: String(on),
      });
      expect({
        column: column,
        model: group.getTableColumnMetadata(column).defaultValue,
      }).toEqual({ column: column, model: on });
      expect(RESOURCES).toContain(
        `**${title}** (\`${column}\`) — ${on ? "on" : "off"} by default`,
      );
    }

    expect(groupField("Select Uptime Precision").defaultValue).toBe(
      "UptimePrecision.ONE_DECIMAL",
    );
    expect(Object.values(StatusPageGroupViewMode)).toEqual(["List", "Grid"]);
    expect(groupField("View Mode").defaultValue).toBe(
      "StatusPageGroupViewMode.List",
    );
    expect(group.getTableColumnMetadata("viewMode").defaultValue).toBe(
      StatusPageGroupViewMode.List,
    );
    expect(RESOURCES).toContain(
      `| **${StatusPageGroupViewMode.List}** (the default) |`,
    );
  });

  it("a grid's axes take the placeholders and buttons the page gives", () => {
    const rows: Array<Array<string>> = tableRows(RESOURCES, [
      "Field",
      "What to enter",
    ]);
    const view: string = oneLine(resourcesView);

    expect(
      rows.map((cells: Array<string>): string => {
        return plain(cells[0] as string);
      }),
    ).toEqual([
      "Row Axis Label",
      "Row Axis Values",
      "Column Axis Label",
      "Column Axis Values",
    ]);
    expect(rows[0]?.[1]).toContain(
      `placeholder \`${groupField("Row Axis Label").placeholder}\``,
    );
    expect(rows[2]?.[1]).toContain(
      `placeholder \`${groupField("Column Axis Label").placeholder}\``,
    );
    expect(view).toContain('placeholder="e.g. Auth" addButtonLabel="Add Row"');
    expect(view).toContain(
      'placeholder="e.g. US-East" addButtonLabel="Add Column"',
    );
    expect(rows[1]?.[1]).toBe(
      "The rows, added one at a time with **Add Row** (placeholder `e.g. Auth`).",
    );
    expect(rows[3]?.[1]).toBe(
      "The columns, added with **Add Column** (placeholder `e.g. US-East`).",
    );
  });
});

describe("status page monitor rules", () => {
  it("a rule starts enabled, and adds its monitors with Show Uptime % on", () => {
    const rule: StatusPageMonitorRule = new StatusPageMonitorRule();

    expect(rule.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
    expect(rule.getTableColumnMetadata("showUptimePercent").defaultValue).toBe(
      true,
    );
    // Unlike a resource added by hand.
    expect(
      new StatusPageResource().getTableColumnMetadata("showUptimePercent")
        .defaultValue,
    ).toBe(false);
    expect(RESOURCES).toContain(
      "On **Basic Info**, enter a **Name**. **Enabled** is on by default.",
    );
    expect(RESOURCES).toContain("on a rule, **Show Uptime %** starts on.");
  });

  it("the rule form walks the steps and fields the page names", () => {
    const view: string = dashboardSource(
      "Pages/StatusPages/View/MonitorRules.tsx",
    );

    for (const step of ["Basic Info", "Match Criteria", "Group"]) {
      expect(view).toContain(`{ title: "${step}", id: "`);
      expect(RESOURCES).toContain(`On **${step}**,`);
    }

    for (const title of [
      "Monitor Labels",
      "Monitor Name",
      "Monitor Description",
      "Add Monitors To Group",
      "Adds Monitors To",
    ]) {
      expect(view).toContain(`title: "${title}"`);
      expect(RESOURCES).toContain(`**${title}**`);
    }
  });

  it("matches names and descriptions by a case-insensitive regular expression or a * wildcard, as the page's examples show", () => {
    expect(RulePatternMatchUtil.matches("api-checkout", "^api-.*")).toBe(true);
    expect(RulePatternMatchUtil.matches("API-Checkout", "^api-.*")).toBe(true);
    expect(RulePatternMatchUtil.matches("web-api", "^api-.*")).toBe(false);
    expect(RulePatternMatchUtil.matches("eu-checkout-api", "*checkout*")).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("eu-payments", "*checkout*")).toBe(
      false,
    );
    expect(RulePatternMatchUtil.matches("anything at all", ".*")).toBe(true);
    expect(RESOURCES).toContain(
      "The two patterns take a case-insensitive regular expression (`^api-.*`) or a `*` wildcard (`*checkout*`); `.*` matches every monitor.",
    );
  });
});

describe("importing groups from CSV", () => {
  it("the columns table is the importer's columns, and only name is required", () => {
    expect(
      tableRows(RESOURCES, ["Column", "What it sets"]).map(
        (cells: Array<string>): string => {
          return codeSpans(cells[0] as string)[0] as string;
        },
      ),
    ).toEqual(STATUS_PAGE_GROUP_CSV_COLUMNS);

    const nameOnly: StatusPageGroupCsvParseResult =
      parseStatusPageGroupCsv("name\nAPI");
    const withoutName: StatusPageGroupCsvParseResult = parseStatusPageGroupCsv(
      "description\nThe API",
    );

    expect(nameOnly.errors).toEqual([]);
    expect(nameOnly.rows).toHaveLength(1);
    expect(withoutName.errors.length).toBeGreaterThan(0);
    expect(RESOURCES).toContain("Only `name` is required;");
  });

  it("downloads the template under the name the page gives, and reports each row as created, failed or skipped", () => {
    expect(
      dashboardSource("Components/StatusPage/ImportGroupsFromCsvModal.tsx"),
    ).toContain('filename: "status-page-groups-template.csv",');
    expect(dashboardSource("Utils/StatusPageGroupImportRunner.ts")).toContain(
      'export type StatusPageGroupImportRowStatus = "created" | "failed" | "skipped";',
    );
    expect(RESOURCES).toContain(
      "Click **Download CSV Template** to get `status-page-groups-template.csv`.",
    );
    expect(RESOURCES).toContain(
      "An **Import results** table lists every row as **Created**, **Failed** or **Skipped**",
    );
  });
});

describe("status page branding", () => {
  const statusPage: StatusPage = new StatusPage();

  it("the overall uptime % shows to 99%, 99.9%, 99.99% (the default) or 99.999%", () => {
    const precision: unknown = statusPage.getTableColumnMetadata(
      "overallUptimePercentPrecision",
    ).defaultValue;
    const labels: Array<string> = UPTIME_PRECISION_OPTIONS.map(
      (option: { label: string }): string => {
        return option.label;
      },
    );
    const defaultLabel: string | undefined = UPTIME_PRECISION_OPTIONS.find(
      (option: { value: unknown }): boolean => {
        return option.value === precision;
      },
    )?.label;

    expect(labels).toEqual(["99%", "99.9%", "99.99%", "99.999%"]);
    expect(defaultLabel).toBe("99.99%");
    expect(BRANDING).toContain(
      "**Precision** beside it picks how many decimals the percentage shows: `99%`, `99.9%`, `99.99%` (the default) or `99.999%`.",
    );
  });

  it("names the plan each feature needs: Scale for the overall uptime % and hiding Powered by, Growth for custom code", () => {
    const planOf: (column: string) => PlanType | undefined = (
      column: string,
    ): PlanType | undefined => {
      return statusPage.getColumnBillingAccessControl(column)?.update;
    };

    expect(planOf("showOverallUptimePercentOnStatusPage")).toBe(PlanType.Scale);
    // Its precision can be changed on every plan.
    expect(planOf("overallUptimePercentPrecision")).toBeUndefined();
    expect(planOf("hidePoweredByOneUptimeBranding")).toBe(PlanType.Scale);

    for (const column of [
      "headerHTML",
      "footerHTML",
      "customCSS",
      "customJavaScript",
    ]) {
      expect({ column: column, plan: planOf(column) }).toEqual({
        column: column,
        plan: PlanType.Growth,
      });
    }

    expect(BRANDING).toContain(
      `On OneUptime Cloud, turning the percentage on needs the **${PlanType.Scale}** plan; its precision can be changed on every plan.`,
    );
    expect(BRANDING).toContain(
      `On OneUptime Cloud, hiding it needs the **${PlanType.Scale}** plan.`,
    );
    expect(BRANDING).toContain(
      `On OneUptime Cloud, adding or changing any of them needs the **${PlanType.Growth}** plan.`,
    );
  });

  it("emptying custom code, or showing Powered by again, needs no plan", () => {
    for (const column of [
      "headerHTML",
      "footerHTML",
      "customCSS",
      "customJavaScript",
    ]) {
      const metadata: ReturnType<StatusPage["getTableColumnMetadata"]> =
        statusPage.getTableColumnMetadata(column);

      expect({
        column: column,
        empty: isPlanGatedColumnDefault(metadata, ""),
      }).toEqual({
        column: column,
        empty: true,
      });
      expect(isPlanGatedColumnDefault(metadata, null)).toBe(true);
      expect(isPlanGatedColumnDefault(metadata, "body { color: red; }")).toBe(
        false,
      );
    }

    const poweredBy: ReturnType<StatusPage["getTableColumnMetadata"]> =
      statusPage.getTableColumnMetadata("hidePoweredByOneUptimeBranding");

    expect(isPlanGatedColumnDefault(poweredBy, false)).toBe(true);
    expect(isPlanGatedColumnDefault(poweredBy, true)).toBe(false);
    expect(BRANDING).toContain(
      "Emptying one works on every plan, so custom code a trial added can always be removed.",
    );
  });

  it("custom code is served only on a verified custom domain", () => {
    for (const column of [
      "headerHTML",
      "footerHTML",
      "customCSS",
      "customJavaScript",
    ]) {
      expect({
        column: column,
        description: statusPage.getTableColumnMetadata(column).description,
      }).toEqual({
        column: column,
        description: expect.stringContaining("verified custom domain"),
      });
    }

    expect(BRANDING).toContain(
      "Custom HTML, CSS and JavaScript are served only on a verified custom domain.",
    );
  });

  // #4578: the line names the product; the switch is the page's own.
  it("Powered by OneUptime is the card's last switch, the inverse of hidePoweredByOneUptimeBranding, on by default", () => {
    const poweredBy: DisplaySectionDefinition = DISPLAY_SECTIONS[
      DISPLAY_SECTIONS.length - 1
    ] as DisplaySectionDefinition;

    expect(poweredBy.id).toBe("powered-by");
    expect(poweredBy.show?.column).toBe("hidePoweredByOneUptimeBranding");
    expect(poweredBy.show?.isInverted).toBe(true);
    expect(
      statusPage.getTableColumnMetadata("hidePoweredByOneUptimeBranding")
        .defaultValue,
    ).toBe(false);
    expect(
      oneLine(
        readSource(
          "App/FeatureSet/StatusPage/src/Components/Footer/Footer.tsx",
        ),
      ),
    ).toContain("if (!props.hidePoweredByOneUptimeBranding) {");
    expect(BRANDING).toContain(
      `It is the last switch of the **${StatusPageDisplaySettingsCopy.cardTitle}** card on **Status Pages → your page → Advanced → Advanced Settings** (\`{id}/settings\`): **${poweredBy.show?.title}**, on by default.`,
    );
  });

  it("search engines may index a new status page, and a page kept out is served noindex, nofollow", () => {
    expect(
      statusPage.getTableColumnMetadata("enableSearchEngineIndexing")
        .defaultValue,
    ).toBe(true);

    const header: string = readSource(
      "Common/Server/Utils/StatusPageSearchEngineIndexing.ts",
    );

    expect(header).toContain("X-Robots-Tag");
    expect(header).toContain("noindex, nofollow");
    expect(BRANDING).toContain(
      `One switch, **${StatusPageBrandingCopy.searchEngineIndexingSwitchTitle}**, decides whether Google, Bing and other search engines may list the page. It is on by default.`,
    );
    expect(BRANDING).toContain(
      "Switch it off and the page is served with `noindex, nofollow` (a robots meta tag and an `X-Robots-Tag` header)",
    );
  });

  it("a new status page's bars start green", () => {
    expect(
      oneLine(readSource("Common/Server/Services/StatusPageService.ts")),
    ).toContain(
      "if (!createBy.data.defaultBarColor) { createBy.data.defaultBarColor = Green;",
    );
    expect(isDefaultBarColorChosen(Green)).toBe(false);
    expect(BRANDING).toContain("Every new status page starts with green.");
  });

  it("every placeholder the page quotes is one the Dashboard draws", () => {
    const sources: Record<string, string> = {
      branding: dashboardSource("Pages/StatusPages/View/Branding.tsx"),
      customCode: dashboardSource("Pages/StatusPages/View/CustomHtmlCss.tsx"),
      domains:
        dashboardSource("Components/CustomDomain/CustomDomainCopy.ts") +
        dashboardSource("Components/CustomDomain/CustomDomainsTable.tsx"),
    };

    for (const [where, placeholders] of [
      [
        "branding",
        [
          "Upload logo",
          "Logo of My Company",
          "Upload cover image",
          "Please enter page title here.",
          "https://link.com",
          "Acme, Inc.",
          "All languages",
          "When Uptime Percent >=",
          "Then, Bar Color is",
        ],
      ],
      [
        "customCode",
        [
          "Insert Custom HTML here.",
          "Insert Custom CSS here.",
          "Insert Custom JavaScript here.",
        ],
      ],
      ["domains", ["status (leave blank for root)", "Select domain"]],
    ] as Array<[string, Array<string>]>) {
      for (const placeholder of placeholders) {
        expect({
          placeholder: placeholder,
          drawn: (sources[where] as string).includes(placeholder),
          quoted: BRANDING.includes(`\`${placeholder}\``),
        }).toEqual({ placeholder: placeholder, drawn: true, quoted: true });
      }
    }
  });
});

describe("custom domain timings", () => {
  it("unverified domains are checked every 15 minutes, as the page says", () => {
    expect(EVERY_FIFTEEN_MINUTE).toBe("*/15 * * * *");
    expect(
      oneLine(
        readSource(
          "App/FeatureSet/Workers/Jobs/StatusPageCerts/StatusPageCerts.ts",
        ),
      ),
    ).toContain(
      '"StatusPageCerts:VerifyCnameWhoseCnameisNotVerified", { schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,',
    );
    expect(BRANDING).toContain(
      "OneUptime checks every unverified domain every 15 minutes",
    );
  });

  it("Check now orders a domain's certificate at most once every 15 minutes", () => {
    expect(
      readSource("Common/Server/Utils/Greenlock/CertificateOrder.ts"),
    ).toContain(
      "public static readonly ON_DEMAND_ORDER_WINDOW_IN_MINUTES: number = 15;",
    );
    expect(BRANDING).toContain(
      "It orders at most once per domain every 15 minutes;",
    );
  });

  it("a domain can be reissued once every 24 hours", () => {
    expect(CertificateReissueUtil.COOLDOWN_IN_HOURS).toBe(24);
    expect(BRANDING).toContain(
      `A domain can be reissued only once every ${CertificateReissueUtil.COOLDOWN_IN_HOURS} hours.`,
    );
  });
});

/*
 * #4578 gave an installation its own product name and logos, behind a
 * licence. These pages document what every installation has; the licence
 * and what it unlocks are not described here in any language.
 */
describe("what these pages never describe", () => {
  const PAGES: Array<string> = [
    "monitor/logs-monitor",
    "monitor/metrics-monitor",
    "monitor/traces-monitor",
    "monitor/exceptions-monitor",
    "monitor/profiles-monitor",
    "status-pages/resources-and-groups",
    "status-pages/branding-and-domains",
  ];

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.flatMap((language: string) => {
      return PAGES.map((page: string): { language: string; page: string } => {
        return { language: language, page: page };
      });
    }),
  )(
    "$language $page names no licence and no white label",
    (entry: { language: string; page: string }) => {
      expect(hasPage(entry.language, entry.page)).toBe(true);

      const markdown: string = readPage(entry.language, entry.page);

      expect(markdown).not.toMatch(/white[\s_-]?label/i);
      expect(markdown).not.toMatch(/licen[cs]e/i);
    },
  );
});
