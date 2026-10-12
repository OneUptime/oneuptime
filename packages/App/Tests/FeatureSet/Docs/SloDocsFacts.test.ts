import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import Label from "Common/Models/DatabaseModels/Label";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveLabelRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import ColumnLength from "Common/Types/Database/ColumnLength";
import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import MetricResourceAttributeUtil from "Common/Utils/Metrics/MetricResourceAttributeUtil";
import {
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import { formatErrorBudgetRemainingOfTotal } from "Common/Utils/Slo/SloDuration";
import {
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
  SLO_EVALUATION_CADENCE_MINUTES,
} from "Common/Utils/Slo/SloEvaluation";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
  SloNotice,
  getSloNotice,
} from "Common/Utils/Slo/SloHealth";
import { getSloBudgetRemainingText } from "Common/Utils/Slo/SloOverviewText";
import {
  SloBudgetRunway,
  SloBudgetRunwayKind,
  SloProjectionTone,
  SloRollingWindowFill,
  getRollingWindowFill,
  getSloBudgetRunway,
} from "Common/Utils/Slo/SloProjection";
import SloUtil from "Common/Utils/Slo/SloUtil";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The English SLO pages against the product they describe (docs overhaul
 * task 18a).
 *
 * Markdown is not compiled, so nothing else notices when a button is
 * renamed, a card leaves the Overview, a default moves or the worker's
 * thresholds change while the pages keep the old words. Each test reads the
 * source of truth - a model's names and defaults, the worker's constants, a
 * Dashboard page's titles (read as text: an App test must not import a React
 * page), or the pure SLO utilities the pages and the worker share - and
 * checks the page still says the same. SloDocs holds the metric catalog, the
 * template variables and the side menu's pages; SloDocsTranslations holds the
 * other sixteen languages to these pages.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const COMMON_UI: string = "Common/UI/Components";

const SOURCES: Record<string, string> = {
  sloService: "Common/Server/Services/ServiceLevelObjectiveService.ts",
  burnRuleService:
    "Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
  feedService: "Common/Server/Services/ServiceLevelObjectiveFeedService.ts",
  notificationSettingService:
    "Common/Server/Services/UserNotificationSettingService.ts",
  worker: "App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
  sloHistory: "Common/Models/AnalyticsModels/SloHistory.ts",
  projectModel: "Common/Models/DatabaseModels/Project.ts",
  dashboardTemplates: "Common/Types/Dashboard/DashboardTemplates.ts",
  ruleRunPermission: "Common/Server/Utils/Rules/RuleRun/RuleRunPermission.ts",
  sloFormFields: `${DASHBOARD}/Pages/Slo/SloFormFields.ts`,
  slosPage: `${DASHBOARD}/Pages/Slo/Slos.tsx`,
  sloListSideMenu: `${DASHBOARD}/Pages/Slo/SideMenu.tsx`,
  sloViewSideMenu: `${DASHBOARD}/Pages/Slo/View/SideMenu.tsx`,
  overview: `${DASHBOARD}/Pages/Slo/View/Index.tsx`,
  hero: `${DASHBOARD}/Components/Slo/SloOverviewHero.tsx`,
  kpiStrip: `${DASHBOARD}/Components/Slo/SloKpiStrip.tsx`,
  burnDown: `${DASHBOARD}/Components/Slo/SloBudgetBurnDownCard.tsx`,
  activeEvents: `${DASHBOARD}/Components/Slo/SloActiveBurnEventsCard.tsx`,
  rulesSummary: `${DASHBOARD}/Components/Slo/SloBurnRateRulesSummaryCard.tsx`,
  gettingStarted: `${DASHBOARD}/Components/Slo/SloOverviewGettingStartedCard.tsx`,
  feedCard: `${DASHBOARD}/Components/Slo/SloFeed.tsx`,
  settings: `${DASHBOARD}/Pages/Slo/View/Settings.tsx`,
  settingsFields: `${DASHBOARD}/Pages/Slo/SloSettingsFormFields.ts`,
  evaluationCopy: `${DASHBOARD}/Components/Slo/SloEvaluationSwitchCopy.ts`,
  archiveCard: `${DASHBOARD}/Components/TelemetryResource/ArchiveResourceCard.tsx`,
  statusTiles: `${DASHBOARD}/Components/Slo/SloStatusSummaryTiles.ts`,
  monitorsPage: `${DASHBOARD}/Pages/Slo/View/Monitors.tsx`,
  monitorRulesPage: `${DASHBOARD}/Pages/Slo/View/MonitorRules.tsx`,
  monitorRuleFields: `${DASHBOARD}/Pages/Slo/View/SloMonitorRuleFormFields.ts`,
  monitorSideMenu: `${DASHBOARD}/Pages/Monitor/View/SideMenu.tsx`,
  burnRuleForm: `${DASHBOARD}/Pages/Slo/Utils/BurnRateRuleForm.ts`,
  notificationSettings: `${DASHBOARD}/Pages/UserSettings/NotificationSettings.tsx`,
  metricsQueryConfig: `${DASHBOARD}/Components/Slo/SloMetricsQueryConfig.ts`,
  labelRulesPage: `${DASHBOARD}/Pages/Slo/Settings/LabelRules.tsx`,
  ownerRulesPage: `${DASHBOARD}/Pages/Slo/Settings/OwnerRules.tsx`,
  resourceRuleForm: `${DASHBOARD}/Utils/Form/ResourceRuleForm.ts`,
  ruleCriteriaFields: `${COMMON_UI}/RuleCriteria/RuleCriteriaFields.ts`,
  ruleTable: `${COMMON_UI}/RuleRun/RuleTable.tsx`,
  sideMenuState: `${COMMON_UI}/SideMenu/SideMenuSectionState.ts`,
  ownersFormField: `${COMMON_UI}/PeoplePicker/OwnersFormField.tsx`,
};

const INTRODUCTION: string = "slo/introduction";
const MONITOR_RULES: string = "slo/monitor-rules";
const ERROR_BUDGET: string = "slo/error-budget";
const BURN_RATE: string = "slo/burn-rate-alerts";
const METRICS: string = "slo/metrics";
const FEED: string = "slo/feed-and-audit-logs";
const LABEL_RULES: string = "slo/label-and-owner-rules";

const SECONDS_PER_DAY: number = 24 * 60 * 60;

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const TABLE_ROW: RegExp = /^\|.*\|$/;
// A "title: "..."" entry of a source file.
const TITLE_ENTRY: RegExp = /title: "([^"]+)"/g;
// A stat tile's label="..." attribute.
const LABEL_ATTRIBUTE: RegExp = /label="([^"]+)"/g;
const COLLAPSED_TITLES_LIST: RegExp =
  /SECTION_TITLES_COLLAPSED_BY_DEFAULT: ReadonlyArray<string> = \[([\s\S]*?)\];/;
const SIDE_MENU_SECTION: RegExp =
  /<SideMenuSection title="([^"]+)">([\s\S]*?)<\/SideMenuSection>/g;

function readSource(name: string): string {
  const relative: string | undefined = SOURCES[name];

  expect({ name, known: Boolean(relative) }).toEqual({ name, known: true });

  return fs.readFileSync(path.join(PACKAGES_DIR, relative as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// Every match of a pattern's first group, in order.
function allMatches(source: string, pattern: RegExp): Array<string> {
  return Array.from(source.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The bold spans of a piece of Markdown, in order (repeats kept).
function boldIn(markdown: string): Array<string> {
  return allMatches(markdown, BOLD);
}

// A "## " (or deeper) section of a page: its heading line to the next heading at its level or above.
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.replace(/^#+ /, "") === heading && line.startsWith("#");
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (lines[start] as string).indexOf(" ");
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;
    const hashes: number = line.startsWith("#") ? line.indexOf(" ") : 0;

    if (hashes > 0 && hashes <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The rows of the first table in a piece of Markdown, as trimmed cells.
function tableRows(markdown: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let seenTable: boolean = false;

  for (const line of markdown.split("\n")) {
    if (TABLE_ROW.test(line.trim())) {
      seenTable = true;
      rows.push(
        line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((cell: string): string => {
            return cell.trim();
          }),
      );
      continue;
    }

    if (seenTable) {
      break;
    }
  }

  // Minus the header and the delimiter row.
  return rows.slice(2);
}

// The first cell of each row of the first table in a piece of Markdown.
function firstCells(markdown: string): Array<string> {
  return tableRows(markdown).map((row: Array<string>): string => {
    return row[0] as string;
  });
}

// A source block: from a marker to the first end marker after it.
function blockFrom(source: string, marker: string, end: string): string {
  const start: number = source.indexOf(marker);

  expect({ marker, found: start >= 0 }).toEqual({ marker, found: true });

  const stop: number = source.indexOf(end, start + marker.length);

  return source.slice(start, stop === -1 ? undefined : stop);
}

// The number a "NAME: number = 123;" constant of a source file holds.
function numberConstant(source: string, name: string): number {
  const match: RegExpExecArray | null = new RegExp(
    `${escapeRegExp(name)}: number =\\s*([\\d.]+)`,
  ).exec(source);

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return Number((match as RegExpExecArray)[1]);
}

// The field type a form field with this title declares, in a source file.
function fieldTypeOf(source: string, title: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `title: "${escapeRegExp(title)}",[\\s\\S]*?fieldType: FormFieldSchemaType\\.(\\w+)`,
  ).exec(source);

  expect({ title, found: Boolean(match) }).toEqual({ title, found: true });

  return (match as RegExpExecArray)[1] as string;
}

// The operator labels the condition builder offers for a field type.
function operatorsFor(fieldType: string): Array<string> {
  const criteria: string = readSource("ruleCriteriaFields");
  const listName: string =
    fieldType === "MultiSelectDropdown"
      ? "RULE_CRITERIA_ARRAY_OPERATORS"
      : fieldType === "Text"
        ? "RULE_CRITERIA_TEXT_OPERATORS"
        : "RULE_CRITERIA_SCALAR_OPERATORS";
  const list: string = blockFrom(criteria, `export const ${listName}`, "];");
  const operators: Array<string> = allMatches(
    list,
    /RuleCriteriaOperator\.(\w+)/g,
  );

  return operators.map((operator: string): string => {
    const label: RegExpExecArray | null = new RegExp(
      `\\[RuleCriteriaOperator\\.${operator}\\]: "([^"]+)"`,
    ).exec(criteria);

    expect({ operator, labelled: Boolean(label) }).toEqual({
      operator,
      labelled: true,
    });

    return (label as RegExpExecArray)[1] as string;
  });
}

// What the condition builder calls one of its own controls.
function criteriaCopy(key: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `\\n  ${key}: "([^"]+)"`,
  ).exec(readSource("ruleCriteriaFields"));

  expect({ key, found: Boolean(match) }).toEqual({ key, found: true });

  return (match as RegExpExecArray)[1] as string;
}

// A table create button, as ModelTable names it: "Create" and the model's singular name.
function createButton(model: {
  singularName?: string | null | undefined;
}): string {
  expect(model.singularName).toBeTruthy();

  return `Create ${model.singularName as string}`;
}

// Whether a side menu section with this title starts folded.
function startsFolded(title: string): boolean {
  const list: string =
    COLLAPSED_TITLES_LIST.exec(readSource("sideMenuState"))?.[1] || "";

  return list.includes(`"${title}"`);
}

/*
 * A duration the way the budget table writes it: hours and minutes, and
 * seconds unless the hours make them noise; to the nearest second.
 */
function budgetDuration(totalSeconds: number): string {
  const seconds: number = Math.round(totalSeconds);
  const hours: number = Math.floor(seconds / 3600);
  const minutes: number = Math.floor((seconds % 3600) / 60);
  const rest: number = seconds % 60;

  if (hours > 0) {
    return rest > 0
      ? `${hours}h ${minutes}m ${rest}s`
      : `${hours}h ${minutes}m`;
  }

  return `${minutes}m ${rest}s`;
}

function budgetSeconds(targetPercentage: number, days: number): number {
  return ((100 - targetPercentage) / 100) * days * SECONDS_PER_DAY;
}

function runway(
  data: Partial<Parameters<typeof getSloBudgetRunway>[0]>,
): SloBudgetRunway {
  return getSloBudgetRunway({
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    multiMonitorMode: SloMultiMonitorMode.AnyDown,
    errorBudgetRemainingSeconds: 2000,
    currentBurnRate: 1,
    now: new Date("2026-06-10T12:00:00.000Z"),
    ...data,
  });
}

describe("SLOs Overview, against the product", () => {
  const page: string = englishPage(INTRODUCTION);

  it("names the create button the SLO table draws, never a shorter one", () => {
    const button: string = createButton(new ServiceLevelObjective());

    expect(button).toBe("Create Service Level Objective");
    // The list's button opens the form, and the form's button saves it.
    expect(page.split(`**${button}**`).length - 1).toBe(2);
    expect(page).not.toContain("**Create SLO**");
    expect(readSource("slosPage")).toContain("isCreateable={true}");
  });

  it("opens SLOs from the Products menu", () => {
    expect(
      readSource("sloListSideMenu").includes('title: "SLOs"') &&
        page.includes(
          "Open **SLOs** from the **Products** menu in the top bar.",
        ),
    ).toBe(true);
  });

  it("states the target's range and the form's starting target", () => {
    const service: string = readSource("sloService");
    const form: string = readSource("sloFormFields");

    expect(service).toContain("targetPercentage <= 0 ||");
    expect(service).toContain("targetPercentage > 99.999");
    expect(numberConstant(form, "SLO_SUGGESTED_TARGET_PERCENTAGE")).toBe(99.9);
    expect(page).toContain(
      "The target starts at `99.9`. It must be greater than 0 and at most 99.999",
    );
  });

  it("lists every field folded under More fields, in the form's order, with its default", () => {
    const form: string = readSource("sloFormFields");
    const fields: string = blockFrom(
      form,
      "export const getSloFormFields",
      "export type PickSloFormFieldsFunction",
    );
    const titles: Array<string> = allMatches(fields, TITLE_ENTRY);

    // The open fields, then the folded ones, then the shared Labels field.
    expect(titles.slice(0, 2)).toEqual(["Name", "Target (%)"]);
    expect(fields).toContain("getLabelsFormField<ServiceLevelObjective>({");

    const folded: Array<string> = [...titles.slice(2), "Labels"];
    const table: string = page.slice(
      page.indexOf("The fields under **More fields**:"),
    );

    expect(firstCells(table)).toEqual(
      folded.map((title: string): string => {
        return `**${title}**`;
      }),
    );

    const defaults: Record<string, string> = {};

    for (const row of tableRows(table)) {
      defaults[row[0] as string] = row[2] as string;
    }

    expect(defaults["**At-Risk Threshold (%)**"]).toBe(
      String(DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE),
    );
    expect(defaults["**Window (Days)**"]).toBe(
      String(DEFAULT_ROLLING_WINDOW_DAYS),
    );
    expect(defaults["**Window Type**"]).toBe(`**${SloWindowType.Rolling}**`);
    expect(defaults["**Timezone**"]).toBe("UTC");
    expect(form).toContain(
      '"Decides when each calendar month starts and ends. Defaults to UTC."',
    );
  });

  it("states the window and threshold ranges the server enforces", () => {
    const service: string = readSource("sloService");

    expect(service).toContain("windowDays < 1 || windowDays > 366");
    expect(service).toContain(
      "atRiskThresholdPercentage < 0 ||\n      atRiskThresholdPercentage > 100",
    );
    expect(page).toContain("how many days to look back, from 1 to 366");
    expect(page).toContain("A whole number from 0 to 100.");
  });

  it("says what the folded section's line says while it is at its defaults", () => {
    expect(readSource("sloFormFields")).toContain(
      '"Measured over a rolling {{days}}-day window, and At Risk when less than {{threshold}}% of the error budget is left."',
    );
    expect(page).toContain(
      `the SLO is measured over a rolling ${DEFAULT_ROLLING_WINDOW_DAYS}-day window and turns At Risk when less than ${DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE}% of its error budget is left`,
    );
  });

  it("names the card a new SLO opens on, and its two actions", () => {
    const card: string = readSource("gettingStarted");

    for (const text of [
      "Choose what this SLO measures",
      'title="Create a monitor rule"',
      'title="Add monitors"',
    ]) {
      expect(card).toContain(text);
    }

    expect(page).toContain("shows **Choose what this SLO measures**");
    expect(page).toContain(
      "Click **Create a monitor rule** to attach every monitor that matches",
    );
    expect(page).toContain("or **Add monitors** to pick them by hand");
  });

  it("states how often SLOs are evaluated", () => {
    expect(SLO_EVALUATION_CADENCE_MINUTES).toBe(5);
    expect(page).toContain(
      `OneUptime evaluates enabled SLOs every ${SLO_EVALUATION_CADENCE_MINUTES} minutes.`,
    );
    expect(page).toContain(
      `every ${SLO_EVALUATION_CADENCE_MINUTES} minutes, so instead`,
    );
  });

  it("says what a new SLO starts with, as the server and the model default it", () => {
    const model: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common/Models/DatabaseModels/ServiceLevelObjective.ts",
      ),
      "utf8",
    );

    expect(model).toContain("default: SloMultiMonitorMode.AnyDown,");
    expect(readSource("sloService")).toContain(
      "return !monitorStatus.isOperationalState;",
    );
    expect(readSource("sloService")).toContain('name: "Fast burn",');
    expect(readSource("sloService")).toContain('name: "Slow burn",');

    const table: string = page.slice(
      page.indexOf("| Setting | A new SLO starts with | Change it on |"),
    );
    const rows: Array<Array<string>> = tableRows(table);

    expect(
      rows.map((row: Array<string>): string => {
        return `${row[0]} = ${row[1]}`;
      }),
    ).toEqual([
      "Monitors = None",
      "Downtime statuses = Every non-operational status in the project",
      `Multi-monitor mode = **${SloMultiMonitorMode.AnyDown}**`,
      "Evaluation = On",
      "Burn rate rules = A **Fast burn** and a **Slow burn** rule, scaled to the window",
    ]);
  });

  it("names the window types and multi-monitor modes as the dropdowns do", () => {
    const windows: string = section(page, "Compliance windows");
    const modes: string = section(page, "Several monitors on one SLO");

    expect(firstCells(windows)).toEqual(
      Object.values(SloWindowType).map((value: string): string => {
        return `**${value}**`;
      }),
    );
    expect(firstCells(modes)).toEqual(
      Object.values(SloMultiMonitorMode).map((value: string): string => {
        return `**${value}**`;
      }),
    );
  });

  it("lists every status the worker gives an SLO, and no other", () => {
    expect(firstCells(section(page, "SLO status"))).toEqual(
      Object.values(SloStatus).map((status: string): string => {
        return `**${status}**`;
      }),
    );
  });

  it("names the status tiles above the SLO list, in their order", () => {
    const tiles: Array<string> = allMatches(
      blockFrom(readSource("statusTiles"), 'label: "Healthy"', "];"),
      /label: "([^"]+)"/g,
    );

    expect(tiles).toEqual([
      "Healthy",
      "At Risk",
      "Budget Exhausted",
      "Misconfigured",
      "Paused",
      "Disabled",
    ]);
    expect(section(page, "The SLO list")).toContain(
      `count SLOs by status: ${tiles
        .slice(0, -1)
        .map((tile: string): string => {
          return `**${tile}**`;
        })
        .join(", ")} and **${tiles[tiles.length - 1]}**.`,
    );
  });

  it("puts Label Rules and Owner Rules under a folded Settings, and Archived under Advanced", () => {
    const menu: string = readSource("sloListSideMenu");

    expect(blockFrom(menu, 'title: "Settings"', 'title: "Advanced"')).toContain(
      "defaultCollapsed: true",
    );
    expect(blockFrom(menu, 'title: "Settings"', 'title: "Advanced"')).toContain(
      'title: "Label Rules"',
    );
    expect(
      blockFrom(menu, 'title: "Advanced"', "addDeveloperSideMenuSection"),
    ).toContain('title: "Archived"');
    expect(startsFolded("Advanced")).toBe(true);

    const list: string = section(page, "The SLO list");

    expect(list).toContain(
      "The side menu's **Settings** section holds **Label Rules** and **Owner Rules**",
    );
    expect(list).toContain(
      "The side menu's **Advanced** section holds **Archived**",
    );
    expect(page).toContain(
      "on the **Archived** page, under **Advanced** in the SLO list's side menu",
    );
  });

  it("says which side menu sections hold which pages, and that they start folded", () => {
    const menu: string = readSource("sloViewSideMenu");
    const sections: Record<string, Array<string>> = {};

    for (const match of Array.from(menu.matchAll(SIDE_MENU_SECTION))) {
      sections[match[1] as string] = allMatches(
        match[2] as string,
        TITLE_ENTRY,
      );
    }

    expect(sections["Configuration"]).toEqual([
      "Monitors",
      "Monitor Rules",
      "Burn Rate Rules",
    ]);
    expect(sections["Management"]).toEqual([
      "Owners",
      "Settings",
      "Audit Logs",
      "Delete SLO",
    ]);
    expect(menu).toContain("getDeveloperSideMenuSection(");

    for (const title of ["Configuration", "Management", "Developer"]) {
      expect({ title, folded: startsFolded(title) }).toEqual({
        title,
        folded: true,
      });
    }

    expect(page).toContain(
      "**Monitors**, **Monitor Rules** and **Burn Rate Rules** sit in a **Configuration** section, and **Owners**, **Settings**, **Audit Logs** and **Delete SLO** in a **Management** section. Both start folded, as does a **Developer** section",
    );
  });

  it("walks the Overview's cards in the order the page draws them, and no card it no longer has", () => {
    const overview: string = readSource("overview");
    const kpi: string = readSource("kpiStrip");
    const tiles: Array<string> = allMatches(kpi, LABEL_ATTRIBUTE);

    expect(tiles).toEqual([
      "SLI",
      "Error budget left",
      "Burn rate",
      "Budget runway",
    ]);

    const cards: Array<string> = [
      blockFrom(
        readSource("burnDown"),
        'title="Error budget burn-down"',
        "\n",
      ).includes("Error budget burn-down")
        ? "Error budget burn-down"
        : "",
      overview.includes('title="Recent activity"') ? "Recent activity" : "",
      overview.includes('title: "SLO Details"') ? "SLO Details" : "",
      readSource("activeEvents").includes('title="Open alerts & incidents"')
        ? "Open alerts & incidents"
        : "",
      readSource("rulesSummary").includes('title="Burn rate rules"')
        ? "Burn rate rules"
        : "",
    ];

    // The page draws them in this order: the burn-down and the feed in the wide column, then the side column.
    const order: Array<number> = [
      overview.indexOf("<SloBudgetBurnDownCard"),
      overview.indexOf("<SloFeed"),
      overview.indexOf('name="SLO Details"'),
      overview.indexOf("<SloActiveBurnEventsCard"),
      overview.indexOf("<SloBurnRateRulesSummaryCard"),
    ];

    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);

    const overviewSection: string = section(page, "The Overview");
    const named: Array<string> = boldIn(overviewSection);

    for (const name of [...tiles, ...cards]) {
      expect({ name, described: named.includes(name) }).toEqual({
        name,
        described: true,
      });
    }

    const positions: Array<number> = [...tiles, ...cards].map(
      (name: string): number => {
        return overviewSection.indexOf(`**${name}**`);
      },
    );

    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);

    // The cards that left the Overview stay out of its description.
    expect(overview).not.toContain("SloMonitorsSummaryCard");
    expect(overview).not.toContain("SloConfigurationSummaryCard");
    expect(overviewSection).not.toContain("**Monitors**:");
    expect(overviewSection).not.toContain("**Configuration**:");
  });

  it("describes the summary's controls and the burn rate tile's colours", () => {
    const hero: string = readSource("hero");
    const kpi: string = readSource("kpiStrip");

    expect(hero).toContain('title="Refresh"');
    expect(hero).toContain("Compliance window");
    expect(kpi).toContain('text="Rule threshold reached"');
    expect(kpi).toContain('burnRateClassName = "text-amber-700"');
    expect(kpi).toContain('burnRateClassName = "text-red-700"');
    expect(SLO_CURRENT_BURN_RATE_WINDOW_MINUTES).toBe(60);
    expect(page).toContain(
      `how fast the budget is being spent over the last ${SLO_CURRENT_BURN_RATE_WINDOW_MINUTES} minutes`,
    );
    expect(page).toContain(
      "It turns amber above 1× and red, with **Rule threshold reached**",
    );
  });

  it("names the Settings cards, the fields their edit buttons open, and the Evaluation switch", () => {
    const settings: string = readSource("settings");
    const copy: string = readSource("evaluationCopy");
    const archive: string = readSource("archiveCard");
    const cards: Array<string> = allMatches(
      settings,
      /cardProps=\{\{\s*title: "([^"]+)"/g,
    );

    expect(cards).toEqual([
      "Objective",
      "Compliance Period",
      "Downtime Calculation",
    ]);
    expect(allMatches(settings, /editButtonText="([^"]+)"/g)).toEqual([
      "Edit Objective",
      "Edit Period",
      "Edit Downtime Calculation",
    ]);
    expect(copy).toContain('cardTitle: translationKey("Evaluation")');
    expect(copy).toContain('switchTitle: translationKey("Evaluate this SLO")');
    expect(copy).toContain(
      'turnOnButton: translationKey("Turn evaluation on")',
    );
    expect(archive).toContain("`Archive ${singularName}`");
    expect(settings).toContain('singularName="SLO"');

    const fields: string = readSource("settingsFields");

    expect(fields).toContain(
      '"targetPercentage",\n  "atRiskThresholdPercentage",',
    );
    expect(fields).toContain('title: "Multi Monitor Mode"');
    expect(fields).toContain('title: "Downtime Monitor Statuses"');

    const table: string = section(page, "Settings");

    expect(firstCells(table)).toEqual([
      "**Objective**",
      "**Compliance Period**",
      "**Downtime Calculation**",
      "**Evaluation**",
      "**Archive SLO**",
    ]);
    expect(table).toContain(
      "**Target (%)** and **At-Risk Threshold (%)**, with **Edit Objective**",
    );
    expect(table).toContain(
      "**Window Type**, **Window (Days)** and **Timezone**, with **Edit Period**",
    );
    expect(table).toContain(
      "**Multi Monitor Mode** and **Downtime Monitor Statuses**, with **Edit Downtime Calculation**",
    );
    expect(table).toContain("The **Evaluate this SLO** switch");
  });

  it("names every banner an SLO's pages can show, with the same titles", () => {
    const base: {
      isArchived: boolean;
      isEnabled: boolean;
      sliType: SliType;
      monitorCount: number;
      targetPercentage: number;
      lastEvaluatedAt: Date;
    } = {
      isArchived: false,
      isEnabled: true,
      sliType: SliType.MonitorUptime,
      monitorCount: 2,
      targetPercentage: 99.9,
      lastEvaluatedAt: new Date(),
    };
    const notices: Array<SloNotice | null> = [
      getSloNotice({
        ...base,
        monitorCount: 0,
        sloStatus: SloStatus.Misconfigured,
      }),
      getSloNotice({ ...base, sloStatus: SloStatus.Misconfigured }),
      getSloNotice({ ...base, sloStatus: SloStatus.Paused }),
      getSloNotice({
        ...base,
        targetPercentage: 100,
        sloStatus: SloStatus.Misconfigured,
      }),
      getSloNotice({ ...base, isEnabled: false }),
      getSloNotice({ ...base, isArchived: true }),
      getSloNotice({ ...base, lastEvaluatedAt: undefined as unknown as Date }),
    ];

    const titles: Array<string> = notices.map(
      (notice: SloNotice | null): string => {
        return notice?.title || "";
      },
    );

    expect(firstCells(section(page, "Troubleshooting"))).toEqual(
      titles.map((title: string): string => {
        return `**${title}**`;
      }),
    );

    /*
     * The one notice the table leaves out: an SLI type other than monitor
     * uptime, which nothing in the product can set.
     */
    expect(
      getSloNotice({
        ...base,
        sliType: SliType.Metric,
        sloStatus: SloStatus.Misconfigured,
      })?.title,
    ).toBe("This SLO cannot be evaluated");
  });

  it("says a monitor's side menu lists the SLOs that measure it", () => {
    expect(readSource("monitorSideMenu")).toContain('title: "SLOs"');
    expect(page).toContain(
      "A monitor's own side menu has an **SLOs** page too",
    );
  });

  it("quotes the window-fill chip as the Overview words it", () => {
    const full: number = budgetSeconds(99.9, 30);
    const quarter: SloRollingWindowFill | null = getRollingWindowFill({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      targetPercentage: 99.9,
      errorBudgetTotalSeconds: full * 0.234,
      multiMonitorMode: SloMultiMonitorMode.AnyDown,
    });
    const firstDay: SloRollingWindowFill | null = getRollingWindowFill({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      targetPercentage: 99.9,
      errorBudgetTotalSeconds: full * 0.004,
      multiMonitorMode: SloMultiMonitorMode.AnyDown,
    });

    expect(quarter?.label).toBe("Window 23% full");
    expect(firstDay?.label).toBe("Window under 1% full");
    expect(page).toContain(
      `a **${quarter?.label}** chip (**${firstDay?.label}** on the first day)`,
    );
    // No hint where the idea does not apply.
    expect(
      getRollingWindowFill({
        windowType: SloWindowType.CalendarMonth,
        targetPercentage: 99.9,
        errorBudgetTotalSeconds: 10,
      }),
    ).toBeNull();
    expect(
      getRollingWindowFill({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
        targetPercentage: 99.9,
        errorBudgetTotalSeconds: 10,
        multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
      }),
    ).toBeNull();
  });
});

describe("Monitors and Monitor Rules, against the product", () => {
  const page: string = englishPage(MONITOR_RULES);

  it("lists every status the Monitors page can show for a monitor", () => {
    const monitors: string = readSource("monitorsPage");
    const statuses: Array<string> = allMatches(
      blockFrom(monitors, 'title: "Current Status"', 'title: "Source"'),
      /text=\{"([^"]+)"\}/g,
    );

    expect(statuses).toEqual([
      "Archived",
      "Disabled",
      "Probes Not Enabled",
      "Probes Disconnected",
      "Unknown",
    ]);

    const row: string = (page.split("\n").find((line: string): boolean => {
      return line.startsWith("| **Current Status** |");
    }) || "") as string;

    expect(boldIn(row).slice(1)).toEqual(statuses);
  });

  it("names the Source pills and the page's buttons", () => {
    const monitors: string = readSource("monitorsPage");

    expect(monitors).toContain('text="Rule"');
    expect(monitors).toContain('text="Manual"');
    expect(monitors).toContain('title: "Add Monitors"');
    expect(monitors).toContain('submitButtonText="Add Monitors"');
    expect(monitors).toContain('title: "Remove"');
    expect(page).toContain(
      "| **Source** | **Rule** if one of the SLO's monitor rules attached it, **Manual** if someone attached it by hand. |",
    );
  });

  it("names the banner and the link shown while rules manage the monitors", () => {
    const monitors: string = readSource("monitorsPage");

    expect(monitors).toContain(
      'title="This SLO\'s monitors are managed by its monitor rules"',
    );
    expect(monitors).toContain('"Manage Monitor Rules"');
    expect(page).toContain(
      "a banner says **This SLO's monitors are managed by its monitor rules**, with a **Manage Monitor Rules** link",
    );
  });

  it("walks the rule form's two steps, with Enabled on the edit form only", () => {
    const rules: string = readSource("monitorRulesPage");
    const fields: string = readSource("monitorRuleFields");

    expect(rules).toContain('{ title: "Basic Info", id: "basic-info" }');
    expect(rules).toContain(
      '{ title: "Match Criteria", id: "match-criteria" }',
    );
    expect(rules).toContain("<RuleTable<ServiceLevelObjectiveMonitorRule>");
    expect(readSource("ruleTable")).toContain(
      "withRuleEnabledOnEditOnly<TBaseModel>(tableProps.formFields)",
    );
    expect(allMatches(fields, TITLE_ENTRY).slice(0, 2)).toEqual([
      "Name",
      "Description",
    ]);

    const button: string = createButton(new ServiceLevelObjectiveMonitorRule());

    expect(button).toBe("Create SLO Monitor Rule");
    expect(page).toContain(`click **${button}**`);
    expect(page).toContain(
      "On **Basic Info**, enter a **Name** and, optionally, a **Description**",
    );
    expect(page).toContain("On **Match Criteria**, click **Add condition**");
    expect(page).toContain("switch **Enabled** off on its edit form");
    expect(page).not.toContain("on by default). |");
  });

  it("names the condition builder's own controls", () => {
    expect(page).toContain(`click **${criteriaCopy("addCondition")}**`);
    expect(page).toContain(
      `choose **${criteriaCopy("matchAll")}** or **${criteriaCopy("matchAny")}**`,
    );
    expect(page).not.toContain("Match all (AND)");
  });

  it("lists each field's operators as the condition builder offers them", () => {
    const fields: string = readSource("monitorRuleFields");
    const table: Array<Array<string>> = tableRows(
      section(page, "Match criteria"),
    );
    const titles: Array<string> = [
      "Monitor Labels",
      "Monitor Type",
      "Monitor Name",
      "Monitor Description",
    ];

    expect(
      table.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      titles.map((title: string): string => {
        return `**${title}**`;
      }),
    );

    for (const row of table.slice(0, 3)) {
      const title: string = (row[0] as string).slice(2, -2);

      expect({ title, operators: boldIn(row[2] as string) }).toEqual({
        title,
        operators: operatorsFor(fieldTypeOf(fields, title)),
      });
    }

    // The description field takes the name field's operators.
    expect(fieldTypeOf(fields, "Monitor Description")).toBe(
      fieldTypeOf(fields, "Monitor Name"),
    );
    expect((table[3] as Array<string>)[2]).toBe("The same as **Monitor Name**");
  });

  it("requires a condition, as the server does for SLO monitor rules", () => {
    const registry: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common/Types/Rules/RuleCriteriaFieldRegistry.ts",
      ),
      "utf8",
    );

    expect(
      blockFrom(registry, "RULE_CRITERIA_MODELS_REQUIRING_A_CONDITION", "];"),
    ).toContain('"ServiceLevelObjectiveMonitorRule"');
    expect(page).toContain("A monitor rule needs at least one condition.");
  });

  it("says when monitor changes re-run the rules, as MonitorService does", () => {
    const monitorService: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "Common/Server/Services/MonitorService.ts"),
      "utf8",
    );
    const labelService: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "Common/Server/Services/LabelService.ts"),
      "utf8",
    );

    for (const column of ["labels", "monitorType", "name", "description"]) {
      expect(monitorService).toContain(
        `onUpdate.updateBy.data.${column} !== undefined`,
      );
    }

    expect(labelService).toContain(
      "ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo",
    );
    expect(page).toContain(
      "When a monitor is created, or its labels, name or description change, every monitor rule in the project checks it",
    );
    expect(page).toContain(
      "When a label is deleted, the SLOs whose rules used it are re-evaluated.",
    );
  });

  it("names the monitor page that lists a monitor's SLOs", () => {
    expect(readSource("monitorSideMenu")).toContain('title: "SLOs"');
    expect(section(page, "The SLOs a monitor counts toward")).toContain(
      "go to **SLOs** in its side menu",
    );
  });
});

describe("Error Budgets, against the math the worker does", () => {
  const page: string = englishPage(ERROR_BUDGET);

  it("computes every budget in the table from the formula", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "How the budget is calculated"),
    );
    const days: Array<number> = [7, 28, 30, 90];

    expect(rows.length).toBe(5);

    for (const row of rows) {
      const target: number = Number((row[0] as string).replace("%", ""));

      expect({
        target,
        budgets: row.slice(1),
      }).toEqual({
        target,
        budgets: days.map((windowDays: number): string => {
          return budgetDuration(budgetSeconds(target, windowDays));
        }),
      });
    }
  });

  it("states the 31-day month's and the three-monitor SLO's budgets", () => {
    expect(budgetDuration(budgetSeconds(99.9, 31))).toBe("44m 38s");
    expect(page).toContain(
      "a 99.9% SLO in a 31-day month has all of its 44m 38s on the 1st",
    );
    expect(Math.floor((3 * budgetSeconds(99.9, 30)) / 60)).toBe(129);
    expect(page).toContain(
      "a three-monitor 99.9% SLO over 30 days has about 129 minutes of budget rather than 43",
    );
  });

  it("quotes the tile's words for a spent and an overspent budget", () => {
    expect(getSloBudgetRemainingText(0)).toBe("No budget left");
    expect(getSloBudgetRemainingText(-0.5)).toBe("Budget exceeded");
    // The worker stores whole seconds (Math.round), as the tile reads them.
    expect(readSource("worker")).toContain(
      "errorBudgetTotalSeconds: Math.round(budget.budgetTotalSeconds),",
    );
    expect(
      formatErrorBudgetRemainingOfTotal({
        remainingSeconds: 31 * 60 + 4,
        totalSeconds: Math.round(budgetSeconds(99.9, 30)),
      }),
    ).toBe("31m 4s left of 43m 12s");
    expect(
      formatErrorBudgetRemainingOfTotal({
        remainingSeconds: -(4 * SECONDS_PER_DAY + 23 * 60),
        totalSeconds: 5 * 60 + 47,
      }),
    ).toBe("4d 23m over budget · 5m 47s allowed");

    const budgetLeft: string = section(page, "Budget left");

    expect(budgetLeft).toContain('"31m 4s left of 43m 12s"');
    expect(budgetLeft).toContain("the tile says **No budget left**");
    expect(budgetLeft).toContain(
      'the tile says **Budget exceeded** and shows the overage as time, for example "4d 23m over budget · 5m 47s allowed"',
    );
  });

  it("lists every runway the tile can show, in the tile's words", () => {
    const now: Date = new Date("2026-06-10T12:00:00.000Z");
    const table: Array<string> = firstCells(section(page, "Budget runway"));
    const runsOut: SloBudgetRunway = runway({
      errorBudgetRemainingSeconds: budgetSeconds(99.9, 30),
      currentBurnRate: 100,
    });

    expect(runsOut.kind).toBe(SloBudgetRunwayKind.RunsOut);
    expect(runsOut.value.startsWith("~")).toBe(true);
    expect(runway({ errorBudgetRemainingSeconds: 0.01 }).value).toBe(
      "Under 1m",
    );
    expect(runway({ currentBurnRate: 0 }).value).toBe("Not burning");
    expect(
      runway({ errorBudgetRemainingSeconds: budgetSeconds(99.9, 30) }).value,
    ).toBe("Sustainable");
    expect(
      runway({
        windowType: SloWindowType.CalendarMonth,
        timezone: "UTC",
        currentBurnRate: 0.1,
        now: now,
      }).value,
    ).toBe("Lasts until reset");
    expect(runway({ errorBudgetRemainingSeconds: -10 }).value).toBe(
      "Overspent",
    );

    expect(table).toEqual([
      "A duration, such as **~2d 5h**",
      "**Not burning**",
      "**Sustainable**",
      "**Lasts until reset**",
      "**Overspent**",
    ]);
    expect(section(page, "Budget runway")).toContain(
      "**Under 1m** means less than a minute.",
    );
  });

  it("turns the runway red at a day or less, and amber before that", () => {
    // 2592 s of budget at 99.9%: 25.92 / burn rate days.
    const twoDays: SloBudgetRunway = runway({
      errorBudgetRemainingSeconds: 2592,
      currentBurnRate: 12,
    });
    const halfADay: SloBudgetRunway = runway({
      errorBudgetRemainingSeconds: 2592,
      currentBurnRate: 60,
    });

    expect(twoDays.tone).toBe(SloProjectionTone.Warning);
    expect(halfADay.tone).toBe(SloProjectionTone.Danger);
    expect(readSource("kpiStrip")).toContain("RUNWAY_TONE_TEXT_CLASS");
    expect(section(page, "Budget runway")).toContain(
      "Amber, and red once it is a day or less.",
    );
    expect(section(page, "Budget runway")).toContain(
      `It divides the budget left by the burn rate of the last ${SLO_CURRENT_BURN_RATE_WINDOW_MINUTES} minutes`,
    );
  });

  it("states the hysteresis the worker applies to the status", () => {
    const status: (remaining: number, current: SloStatus) => SloStatus = (
      remaining: number,
      current: SloStatus,
    ): SloStatus => {
      return SloUtil.computeSloStatus({
        budgetRemainingPercentage: remaining,
        currentStatus: current,
        atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
      });
    };

    // At Risk stays until 5 points above the threshold.
    expect(status(24.9, SloStatus.AtRisk)).toBe(SloStatus.AtRisk);
    expect(status(25, SloStatus.AtRisk)).toBe(SloStatus.Healthy);
    // Budget Exhausted stays until 2% is back.
    expect(status(1.9, SloStatus.BudgetExhausted)).toBe(
      SloStatus.BudgetExhausted,
    );
    expect(status(2, SloStatus.BudgetExhausted)).toBe(SloStatus.AtRisk);
    // Entering is at the boundary itself.
    expect(status(20, SloStatus.Healthy)).toBe(SloStatus.AtRisk);
    expect(status(0, SloStatus.Healthy)).toBe(SloStatus.BudgetExhausted);

    const statusSection: string = section(
      page,
      "Status changes and the at-risk threshold",
    );

    expect(statusSection).toContain(
      "AtRisk --> Healthy: 5 points above the threshold",
    );
    expect(statusSection).toContain(
      "Exhausted --> AtRisk: 2% of the budget back",
    );
    expect(statusSection).toContain(
      `With the default threshold of ${DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE}%, an At Risk SLO turns Healthy again at ${
        DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE + 5
      }% left, and a Budget Exhausted SLO turns At Risk again at 2% left.`,
    );
  });

  it("states who is notified, how and how often, as the worker does it", () => {
    const worker: string = readSource("worker");
    const settings: string = readSource("notificationSettings");
    const notifications: string = section(page, "Owner notifications");

    expect(
      numberConstant(worker, "STATUS_NOTIFICATION_MIN_INTERVAL_MINUTES"),
    ).toBe(60);
    expect(worker).toContain("isEscalationToExhausted ||");
    expect(worker).toContain(
      "owners = await ProjectService.getOwners(slo.projectId);",
    );
    expect(worker).toContain(
      "const subject: string = `[SLO ${newStatus}] ${sloName}`;",
    );
    expect(readSource("sloService")).toContain(
      "TeamMemberService.filterUsersToProjectMembers",
    );
    expect(readSource("notificationSettingService")).toContain(
      "item.alertByEmail = true;",
    );
    expect(settings).toContain('label: "SLO status changed"');
    expect(
      blockFrom(settings, "const monitoring: Array<SectionDef>", "];"),
    ).toContain("SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION");
    expect(settings).toContain('name: "Monitoring"');

    expect(notifications).toContain(
      "An SLO with no owners notifies the project owners instead.",
    );
    expect(notifications).toContain(
      "Each owner gets an email by default, and the notification on every other channel they turn on for **SLO status changed** in **User Settings** → **Notification Settings** → **Monitoring**.",
    );
    expect(notifications).toContain("`[SLO At Risk] API Availability`");
    expect(notifications).toContain("notified at most once an hour");
    expect(notifications).toContain(
      "A change to **Budget Exhausted** is always sent, even within that hour.",
    );
  });

  it("says how far back the error budget history goes", () => {
    expect(readSource("sloHistory")).toContain(
      'ttlExpression: "bucketStart + INTERVAL 400 DAY"',
    );
    expect(page).toContain(
      "whose **Error Budget History** tab goes back up to 400 days",
    );
  });

  it("names the burn-down card, its link and its zoom", () => {
    const card: string = readSource("burnDown");

    expect(card).toContain('title="Error budget burn-down"');
    expect(card).toContain('title="Open metrics"');
    expect(card).toContain("<ResetTimeRangeZoomButton />");

    const burnDown: string = section(page, "Error budget burn-down");

    expect(burnDown).toContain("The **Error budget burn-down** chart");
    expect(burnDown).toContain(
      "**Open metrics** opens the SLO's **Metrics** page",
    );
    expect(burnDown).toContain("click **Reset zoom**");
    expect(burnDown).toContain(
      `A point is recorded at every evaluation, every ${SLO_EVALUATION_CADENCE_MINUTES} minutes`,
    );
  });
});

describe("Burn Rate Alerts and Incidents, against the worker and the form", () => {
  const page: string = englishPage(BURN_RATE);

  it("scales the default thresholds the way new SLOs are seeded", () => {
    const service: string = readSource("sloService");
    const seed: string = blockFrom(
      service,
      "const defaultRules: Array<{",
      "for (const defaultRule of defaultRules)",
    );

    expect(seed).toContain('name: "Fast burn",');
    expect(seed).toContain("this.roundToTwoDecimals((0.02 * windowHours) / 1)");
    expect(seed).toContain(
      "longWindowInMinutes: 60,\n        shortWindowInMinutes: 5,",
    );
    expect(seed).toContain('name: "Slow burn",');
    expect(seed).toContain("this.roundToTwoDecimals((0.05 * windowHours) / 6)");
    expect(seed).toContain(
      "longWindowInMinutes: 360,\n        shortWindowInMinutes: 30,",
    );
    // A calendar month seeds as 30 days.
    expect(service).toContain(
      "? 720\n        : (createdItem.windowDays || 30) * 24;",
    );

    const threshold: (value: number) => string = (value: number): string => {
      return `${Math.round(value * 100) / 100}×`;
    };
    const rows: Array<Array<string>> = tableRows(
      page.slice(page.indexOf("| SLO window | Fast burn threshold |")),
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return row;
      }),
    ).toEqual(
      [7, 28, 30, 90].map((days: number): Array<string> => {
        return [
          `${days} days`,
          threshold(0.02 * days * 24),
          threshold((0.05 * days * 24) / 6),
        ];
      }),
    );

    expect(page).toContain("Calendar-month SLOs get the 30-day values.");
  });

  it("states how long a 99.9% budget lasts at each burn rate", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "What burn rate means"),
    );

    expect(rows.slice(0, 3)).toEqual(
      [1, 2, 6].map((rate: number): Array<string> => {
        return [String(rate), `${30 / rate} days`];
      }),
    );
    expect(rows[3]).toEqual(["14.4", `about 2 days (${720 / 14.4} hours)`]);
  });

  it("says a rule waits for a full long window, and resolves on Paused or Misconfigured", () => {
    const worker: string = readSource("worker");

    expect(worker).toContain("const hasFullLongWindow: boolean = Boolean(");
    expect(worker).toContain(
      "burnRateLong >= threshold && burnRateShort >= threshold",
    );
    expect(
      blockFrom(
        worker,
        "async function setGuardStatusAndResolveOpenAlerts",
        "\n}\n",
      ),
    ).toContain("resolveOpenBurnRateAlertsAndIncidentsForSlo");
    expect(worker).toContain("status: SloStatus.Paused,");
    expect(page).toContain(
      "a new SLO cannot fire its **Fast burn** rule for its first hour, or its **Slow burn** rule for its first six",
    );
    expect(page).toContain(
      "the SLO turning **Paused** or **Misconfigured**, because it then measures nothing;",
    );
    expect(page).toContain(
      `each time it evaluates the SLO, every ${SLO_EVALUATION_CADENCE_MINUTES} minutes`,
    );
  });

  it("suppresses firing during scheduled maintenance, creation only", () => {
    const worker: string = readSource("worker");

    expect(
      blockFrom(
        worker,
        "async function fireBurnRateRule",
        "const refireSuppressionMinutes",
      ),
    ).toContain("isAnyMonitorUnderOngoingMaintenance()");
    expect(section(page, "Scheduled maintenance")).toContain(
      "What the rules already have open still resolves as usual.",
    );
  });

  it("walks the rule form's steps and folded sections", () => {
    const form: string = readSource("burnRuleForm");
    const steps: Array<string> = allMatches(
      blockFrom(form, "export const BURN_RATE_RULE_FORM_STEPS", "];"),
      TITLE_ENTRY,
    );

    expect(steps).toEqual([
      "Rule",
      "Burn Window",
      "What It Declares",
      "Alert",
      "Incident",
    ]);

    for (const title of ["Description", "Ownership & Labels", "On-Call"]) {
      expect(form).toContain(`title: "${title}",`);
    }

    expect(form).toContain(
      "getAdvancedFormSection<ServiceLevelObjectiveBurnRateRule>({",
    );

    const create: string = section(page, "Create or edit a rule");
    const button: string = createButton(
      new ServiceLevelObjectiveBurnRateRule(),
    );

    expect(button).toBe("Create SLO Burn Rate Rule");
    expect(create).toContain(`click **${button}**`);

    for (const step of steps.slice(0, 3)) {
      expect(create).toContain(`On **${step}**,`);
    }

    expect(create).toContain(
      "The **Alert** and **Incident** steps appear only for what the rule declares.",
    );
    expect(create).toContain(
      "**Description**, **Ownership & Labels**, **On-Call** and **More fields**",
    );

    for (const field of [
      "Burn Rate Threshold",
      "Long Window (Minutes)",
      "Short Window (Minutes)",
      "Re-fire Suppression (Minutes)",
      "Create Alert",
      "Declare Incident",
      "Add SLO Owners as Owners",
    ]) {
      expect({ field, onForm: form.includes(`title: "${field}",`) }).toEqual({
        field,
        onForm: true,
      });
      expect({ field, named: create.includes(`**${field}**`) }).toEqual({
        field,
        named: true,
      });
    }
  });

  it("states the rules a rule's numbers must keep, as the server checks them", () => {
    const service: string = readSource("burnRuleService");

    expect(service).toContain('"Burn rate threshold must be greater than 0."');
    expect(service).toContain('"Short window must be greater than 0 minutes."');
    expect(service).toContain(
      '"Long window must be greater than the short window."',
    );
    expect(service).toContain(
      '"Re-fire suppression must be a number of minutes greater than or equal to 0."',
    );
    expect(service).toContain(
      '"A burn rate rule must create an alert, declare an incident, or both."',
    );
    expect(readSource("worker")).toContain(
      "rule.refireSuppressionMinutes ?? rule.longWindowInMinutes!",
    );

    expect(
      tableRows(page.slice(page.indexOf("| Setting | Must be |"))),
    ).toEqual([
      ["**Burn Rate Threshold**", "Greater than 0."],
      ["**Short Window (Minutes)**", "Greater than 0."],
      ["**Long Window (Minutes)**", "Longer than the short window."],
      [
        "**Re-fire Suppression (Minutes)**",
        "0 or more. Empty means the length of the long window.",
      ],
    ]);
  });

  it("states each output's defaults as the model sets them", () => {
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();
    const model: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule.ts",
      ),
      "utf8",
    );
    const defaultOf: (title: string) => string = (title: string): string => {
      const match: RegExpExecArray | null = new RegExp(
        `title: "${escapeRegExp(title)}",[\\s\\S]*?defaultValue: (\\w+),`,
      ).exec(model);

      expect({ title, found: Boolean(match) }).toEqual({ title, found: true });

      return (match as RegExpExecArray)[1] as string;
    };

    expect(rule.tableName).toBe("ServiceLevelObjectiveBurnRateRule");
    expect(defaultOf("Create Alert")).toBe("true");
    expect(defaultOf("Declare Incident")).toBe("false");
    expect(defaultOf("Auto Resolve Alert")).toBe("true");
    expect(defaultOf("Auto Resolve Incident")).toBe("true");
    expect(defaultOf("Private Alert")).toBe("false");
    expect(defaultOf("Private Incident")).toBe("false");
    expect(defaultOf("Add SLO Owners As Owners")).toBe("false");

    const declares: Array<Array<string>> = tableRows(
      section(page, "What a rule declares"),
    );
    const byRow: Record<string, Array<string>> = {};

    for (const row of declares) {
      byRow[row[0] as string] = row.slice(1);
    }

    expect(byRow["Starts"]).toEqual(["On", "Off"]);
    expect(byRow["Private"]).toEqual(["Off", "Off"]);
    expect(byRow["Auto-resolve"]).toEqual(["On", "On"]);
    expect(section(page, "Owners, labels and privacy")).toContain(
      "It is off by default.",
    );
  });

  it("states the template limits the form and the server enforce", () => {
    expect(SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH).toBe(500);
    expect(SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH).toBe(50000);
    expect(page).toContain(
      "Titles can be 500 characters long, and descriptions and remediation notes 50,000.",
    );
  });

  it("names the incidents a rule declares as staying off status pages", () => {
    const form: string = readSource("burnRuleForm");

    expect(form).toContain(
      "Burn rate incidents are never published to status pages and never notify subscribers.",
    );
    expect(page).toContain(
      "A burn rate incident is never shown on status pages and never notifies status page subscribers.",
    );
  });
});

describe("SLO Metrics and Dashboards, against the emitter and the Metrics page", () => {
  const page: string = englishPage(METRICS);

  it("writes a label attribute the way the emitter does", () => {
    const tierOne: Label = new Label();
    tierOne.name = "Tier 1";
    const product: Label = new Label();
    product.name = "product:checkout";

    const attributes: Record<string, unknown> =
      MetricResourceAttributeUtil.getLabelAttributes([tierOne, product]);

    expect(attributes).toEqual({
      "oneuptime.label.tier_1": "true",
      "oneuptime.label.product": "checkout",
    });
    expect(page).toContain(
      "A label named `Tier 1` becomes `oneuptime.label.tier_1` = `true`, and a label named `product:checkout` becomes `oneuptime.label.product` = `checkout`.",
    );
  });

  it("names the Metrics page's tabs, cards and time ranges", () => {
    const config: string = readSource("metricsQueryConfig");
    const tabs: Array<string> = allMatches(
      blockFrom(config, "export enum SloMetricsTab", "}"),
      / = "([^"]+)"/g,
    );

    expect(tabs).toEqual([
      "SLO Metrics",
      "Error Budget History",
      "Incident Metrics",
      "Alert Metrics",
    ]);
    expect(firstCells(section(page, "The Metrics page"))).toEqual(
      tabs.map((tab: string): string => {
        return `**${tab}**`;
      }),
    );

    for (const card of ["Objective", "Burn", "Status"]) {
      expect(config).toContain(`title: "${card}",`);
      expect(section(page, "The Metrics page")).toContain(`**${card}**`);
    }

    expect(config).toContain("range: TimeRange.PAST_ONE_DAY,");
    expect(config).toContain("range: TimeRange.PAST_ONE_WEEK,");
    expect(section(page, "The Metrics page")).toContain(
      "the past day by default",
    );
    expect(section(page, "The Metrics page")).toContain(
      "the past week by default",
    );
  });

  it("names the SLO Dashboard template, its bands and widgets", () => {
    const templates: string = readSource("dashboardTemplates");

    expect(templates).toContain('name: "SLO Dashboard",');

    for (const title of [
      "Lowest Error Budget Remaining",
      "Least Error Budget Time Left",
      "Peak Burn Rate",
      "Error Budget Remaining by SLO",
      "Burn Rate by SLO",
      "Error Budget Remaining",
      "Burn Rate",
      "Error Budget History",
      "Burn Rate History",
    ]) {
      expect({
        title,
        inTemplate: templates.includes(`title: "${title}",`),
      }).toEqual({
        title,
        inTemplate: true,
      });
      expect({ title, named: page.includes(`**${title}**`) }).toEqual({
        title,
        named: true,
      });
    }
  });

  it("states the evaluation cadence and the history's length", () => {
    expect(page).toContain(
      `Every time OneUptime evaluates an SLO, every ${SLO_EVALUATION_CADENCE_MINUTES} minutes,`,
    );
    expect(readSource("sloHistory")).toContain("INTERVAL 400 DAY");
    expect(page).toContain(
      "That history is stored separately and kept for 400 days.",
    );
  });
});

describe("SLO Feed and Audit Logs, against the feed and the audit log settings", () => {
  const page: string = englishPage(FEED);

  /*
   * Every event the feed can post, by the row of the page's table that
   * describes it. A new event type fails here until the page describes it.
   */
  const ROW_OF_EVENT: Record<ServiceLevelObjectiveFeedEventType, string> = {
    [ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveCreated]:
      "SLO created",
    [ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveUpdated]:
      "SLO updated",
    [ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled]:
      "SLO enabled or disabled",
    [ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled]:
      "SLO enabled or disabled",
    [ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveArchived]:
      "SLO archived or restored",
    [ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveRestored]:
      "SLO archived or restored",
    [ServiceLevelObjectiveFeedEventType.StatusChanged]: "Status changed",
    [ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised]:
      "Burn rate alert raised",
    [ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared]:
      "Burn rate incident declared",
    [ServiceLevelObjectiveFeedEventType.BurnRateAlertResolved]:
      "Burn rate alert or incident resolved",
    [ServiceLevelObjectiveFeedEventType.BurnRateIncidentResolved]:
      "Burn rate alert or incident resolved",
    [ServiceLevelObjectiveFeedEventType.BurnRateRuleAdded]:
      "Burn rate rule added, changed or removed",
    [ServiceLevelObjectiveFeedEventType.BurnRateRuleChanged]:
      "Burn rate rule added, changed or removed",
    [ServiceLevelObjectiveFeedEventType.BurnRateRuleRemoved]:
      "Burn rate rule added, changed or removed",
    [ServiceLevelObjectiveFeedEventType.MonitorRuleAdded]:
      "Monitor rule added, changed or removed",
    [ServiceLevelObjectiveFeedEventType.MonitorRuleChanged]:
      "Monitor rule added, changed or removed",
    [ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved]:
      "Monitor rule added, changed or removed",
    [ServiceLevelObjectiveFeedEventType.MonitorsAttached]:
      "Monitors attached or detached",
    [ServiceLevelObjectiveFeedEventType.MonitorsDetached]:
      "Monitors attached or detached",
    [ServiceLevelObjectiveFeedEventType.OwnerUserAdded]:
      "Owner added or removed",
    [ServiceLevelObjectiveFeedEventType.OwnerUserRemoved]:
      "Owner added or removed",
    [ServiceLevelObjectiveFeedEventType.OwnerTeamAdded]:
      "Owner added or removed",
    [ServiceLevelObjectiveFeedEventType.OwnerTeamRemoved]:
      "Owner added or removed",
    [ServiceLevelObjectiveFeedEventType.LabelRuleExecuted]:
      "Label rule applied",
    [ServiceLevelObjectiveFeedEventType.OwnerRuleExecuted]:
      "Owner rule applied",
  };

  it("describes every event the feed can post, one row each kind", () => {
    const rows: Array<string> = firstCells(section(page, "The SLO feed"));
    const described: Array<string> = Array.from(
      new Set(Object.values(ROW_OF_EVENT)),
    );

    expect(
      Object.values(ServiceLevelObjectiveFeedEventType).every(
        (type: string): boolean => {
          return Boolean(
            ROW_OF_EVENT[type as ServiceLevelObjectiveFeedEventType],
          );
        },
      ),
    ).toBe(true);
    expect([...rows].sort()).toEqual([...described].sort());
  });

  it("states how long feed items are kept on OneUptime Cloud", () => {
    const service: string = readSource("feedService");

    expect(service).toContain("if (IsBillingEnabled) {");
    expect(service).toContain(
      'this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);',
    );
    expect(page).toContain(
      "On OneUptime Cloud, items older than three years are removed.",
    );
    expect(page).toContain("| Kept | Three years on OneUptime Cloud |");
  });

  it("states the audit log retention range and default the project stores", () => {
    const project: string = readSource("projectModel");
    const column: string = blockFrom(
      project,
      'title: "Audit Log Retention (days)",',
      "public auditLogsRetentionInDays",
    );

    expect(project).toContain(
      'defaultValue: 7,\n    title: "Audit Log Retention (days)",',
    );
    expect(column).toContain("Minimum 7, maximum 180.");
    expect(page).toContain("| 7 days by default, up to 180 |");
    expect(page).toContain(
      "Set **Retention (days)**, from 7 (the default) to 180, and turn on **Store System Events**",
    );
  });

  it("walks the audit log settings as the settings page draws them, where the build has it", () => {
    const settingsFile: string = path.join(
      PACKAGES_DIR,
      "../ee/Dashboard/AuditLogs/AuditLogsSettings.tsx",
    );
    const tableFile: string = path.join(
      PACKAGES_DIR,
      "../ee/Dashboard/AuditLogs/AuditLogsTable.tsx",
    );

    // Core CI runs without ee/: the page is held to it wherever it is present.
    if (!fs.existsSync(settingsFile)) {
      return;
    }

    const settings: string = fs.readFileSync(settingsFile, "utf8");

    for (const text of [
      'editButtonText="Edit Audit Log Settings"',
      'title: "Enable Audit Logs",',
      'title: "Retention (days)",',
      'title: "Store System Events",',
      "minValue: 7,",
      "maxValue: 180,",
    ]) {
      expect({ text, inSettings: settings.includes(text) }).toEqual({
        text,
        inSettings: true,
      });
    }

    expect(fs.readFileSync(tableFile, "utf8")).toContain(
      "Audit logging is off",
    );
    expect(page).toContain(
      "Click **Edit Audit Log Settings** and turn on **Enable Audit Logs**.",
    );
    expect(page).toContain(
      "the SLO's **Audit Logs** page says **Audit logging is off**",
    );
  });
});

describe("Label and Owner Rules, against the rule forms and the run's permissions", () => {
  const page: string = englishPage(LABEL_RULES);

  it("names the create buttons the two rule tables draw", () => {
    const label: string = createButton(new ServiceLevelObjectiveLabelRule());
    const owner: string = createButton(new ServiceLevelObjectiveOwnerRule());

    expect([label, owner]).toEqual([
      "Create SLO Label Rule",
      "Create SLO Owner Rule",
    ]);
    expect(page).toContain(`click **${label}** or **${owner}**`);
    expect(page).toContain(
      `Click **${label}** or **${owner}** again on the last step.`,
    );
  });

  it("fills the rule's name the way the form does", () => {
    const form: string = readSource("resourceRuleForm");

    expect(form).toContain('allPicks: translationKey("Add {{labels}}"),');
    expect(form).toContain(
      'allPicks: translationKey("Add {{owners}} as owners"),',
    );
    expect(page).toContain(
      `_${"Add {{labels}}".replace("{{labels}}", "Checkout, Production")}_`,
    );
    expect(page).toContain(
      `_${"Add {{owners}} as owners".replace("{{owners}}", "Checkout team")}_`,
    );
  });

  it("lists the SLO fields a condition can compare, with their operators", () => {
    const labels: string = readSource("labelRulesPage");
    const owners: string = readSource("ownerRulesPage");
    const table: Array<Array<string>> = tableRows(
      section(page, "Match criteria"),
    );

    expect(
      table.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["**SLO Labels**", "**SLO Name**", "**SLO Description**"]);

    for (const title of ["SLO Labels", "SLO Name", "SLO Description"]) {
      // Both kinds of rule match on the same fields.
      expect(fieldTypeOf(owners, title)).toBe(fieldTypeOf(labels, title));
    }

    expect(boldIn((table[0] as Array<string>)[2] as string)).toEqual(
      operatorsFor(fieldTypeOf(labels, "SLO Labels")),
    );
    expect(boldIn((table[1] as Array<string>)[2] as string)).toEqual(
      operatorsFor(fieldTypeOf(labels, "SLO Name")),
    );
    expect((table[2] as Array<string>)[2]).toBe("The same as **SLO Name**");
    expect(page).toContain(
      "A new name or description condition starts on **Contains**.",
    );
  });

  it("puts the rules in the SLO list's folded Settings section", () => {
    const menu: string = readSource("sloListSideMenu");

    expect(blockFrom(menu, 'title: "Settings"', 'title: "Advanced"')).toContain(
      "defaultCollapsed: true",
    );
    expect(page).toContain(
      "Find them in the SLO list's side menu, under **Settings**: **Label Rules** and **Owner Rules**. The **Settings** section starts folded",
    );
  });

  it("runs label rules before owner rules when an SLO is created", () => {
    const service: string = readSource("sloService");
    const labelRules: number = service.indexOf(
      "ServiceLevelObjectiveLabelRuleEngineService.applyRulesToServiceLevelObjective(",
    );
    const ownerRules: number = service.indexOf(
      "ServiceLevelObjectiveOwnerRuleEngineService.applyRulesToServiceLevelObjective(",
    );

    expect(labelRules).toBeGreaterThan(-1);
    expect(ownerRules).toBeGreaterThan(labelRules);
    expect(page).toContain(
      "Label rules run first, so an owner rule can match a label that a label rule has just attached.",
    );
  });

  it("names real permissions, and the ones a run needs", () => {
    const titles: Array<string> = PermissionHelper.getAllPermissionProps().map(
      (props: PermissionProps): string => {
        return props.title;
      },
    );
    const permissions: Array<string> = boldIn(section(page, "Permissions"));

    expect(permissions.length).toBeGreaterThan(0);

    for (const permission of permissions) {
      expect({ permission, real: titles.includes(permission) }).toEqual({
        permission,
        real: true,
      });
    }

    const run: string = readSource("ruleRunPermission");

    expect(run).toContain(
      '"You do not have permission to edit this rule, which running it requires."',
    );
    expect(run).toContain("modelType: definition.resourceModelType,");
    expect(run).toContain(
      "for (const ownerModelType of definition.ownerModelTypes || [])",
    );
    expect(run).toContain("projectWideOnly: true,");
  });
});
