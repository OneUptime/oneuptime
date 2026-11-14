import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import Label from "Common/Models/DatabaseModels/Label";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveLabelRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import {
  AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
  AUDIT_LOG_MAX_RETENTION_IN_DAYS,
  AUDIT_LOG_MIN_RETENTION_IN_DAYS,
} from "Common/Types/AuditLog/AuditLogRetention";
import ColumnLength from "Common/Types/Database/ColumnLength";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
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
  SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
  SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
  SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES,
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
  SLO_EVALUATION_CADENCE_MINUTES,
} from "Common/Utils/Slo/SloEvaluation";
import {
  SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
  SLO_RECOMMENDED_POLICY_TIERS,
  SloDeploymentGateChange,
  SloExistingPolicyTier,
  SloRecommendedPolicyTier,
  SloStoredDeploymentGate,
  computeSloPolicyTier,
  getMissingSloRecommendedPolicyTiers,
  getSloDeploymentGateChange,
  getSloPolicyTierExitPercentage,
  readSloPolicyTierThreshold,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import {
  SLO_FAST_BURN_RULE_NAME,
  SLO_SLOW_BURN_RULE_NAME,
  SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES,
  SLO_SLOW_LEAK_RULE_NAME,
  SloExistingBurnRateRule,
  SloRecommendedAlertSeverity,
  SloRecommendedBurnRateRule,
  getSloRecommendedBurnRateRules,
  isSloRecommendedBurnRateRulePresent,
} from "Common/Utils/Slo/SloRecommendedBurnRateRules";
import {
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  SloBulkRecommendedRulesStatus,
} from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";
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
import {
  BURN_RATE_DECLARES_ANSWERS,
  BURN_RATE_DECLARES_COPY,
  BURN_RATE_DECLARES_FIELD_TITLE,
  BurnRateDeclares,
  getBurnRateDeclares,
} from "../../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateDeclares";
import {
  APPLIES_TO_ALL_ANSWERS,
  APPLIES_TO_MATCHING_ANSWERS,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
  NOTIFICATION_RULE_DESTINATION_TITLES,
  RULE_SINGULAR_NAMES,
} from "../../../FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import { canRuleCreateChannel } from "../../../FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleOwnChannel";
import { SLO_ERROR_BUDGET_POLICY_CHANGES } from "Common/Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  getSloFeedChatMarkdown,
  getSloPolicyTierChangedFeedParts,
} from "Common/Utils/Slo/SloFeedMarkdown";
import FeedMarkdown from "Common/Utils/Markdown/FeedMarkdown";
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
  policyTierService:
    "Common/Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService.ts",
  policyTierApi:
    "Common/Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI.ts",
  policyTierModel:
    "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier.ts",
  policyTierForm: `${DASHBOARD}/Pages/Slo/Utils/ErrorBudgetPolicyTierForm.ts`,
  policyPage: `${DASHBOARD}/Pages/Slo/View/ErrorBudgetPolicy.tsx`,
  policyTierCopy: `${DASHBOARD}/Components/Slo/SloPolicyTier.ts`,
  policyTierCard: `${DASHBOARD}/Components/Slo/SloErrorBudgetPolicyTierCard.tsx`,
  recommendedPolicyModal: `${DASHBOARD}/Components/Slo/SloRecommendedPolicyTiersModal.tsx`,
  feedService: "Common/Server/Services/ServiceLevelObjectiveFeedService.ts",
  notificationSettingService:
    "Common/Server/Services/UserNotificationSettingService.ts",
  worker: "App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
  sloWorkspaceNotifications:
    "Common/Server/Utils/Slo/SloWorkspaceNotifications.ts",
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
  archiveCardWords: `${DASHBOARD}/Components/Archive/ArchiveCardWords.ts`,
  statusTiles: `${DASHBOARD}/Components/Slo/SloStatusSummaryTiles.ts`,
  monitorsPage: `${DASHBOARD}/Pages/Slo/View/Monitors.tsx`,
  monitorRulesPage: `${DASHBOARD}/Pages/Slo/View/MonitorRules.tsx`,
  monitorRuleFields: `${DASHBOARD}/Pages/Slo/View/SloMonitorRuleFormFields.ts`,
  monitorSideMenu: `${DASHBOARD}/Pages/Monitor/View/SideMenu.tsx`,
  burnRuleForm: `${DASHBOARD}/Pages/Slo/Utils/BurnRateRuleForm.ts`,
  sloRecordOutputForm: `${DASHBOARD}/Pages/Slo/Utils/SloRecordOutputForm.ts`,
  burnRulesPage: `${DASHBOARD}/Pages/Slo/View/BurnRateRules.tsx`,
  recommendedRulesModal: `${DASHBOARD}/Components/Slo/SloRecommendedBurnRateRulesModal.tsx`,
  recommendedRulesBanner: `${DASHBOARD}/Components/Slo/SloRecommendedBurnRateRulesBanner.tsx`,
  recommendedRulesBulkAction: `${DASHBOARD}/Components/Slo/useSloRecommendedRulesBulkAction.tsx`,
  recommendedRulesBulkCopy: `${DASHBOARD}/Components/Slo/SloBulkRecommendedRulesCopy.ts`,
  sloBulkActions: `${DASHBOARD}/Components/Slo/useSloBulkActions.tsx`,
  archivedSlosPage: `${DASHBOARD}/Pages/Slo/Archived.tsx`,
  burnRuleApi: "Common/Server/API/ServiceLevelObjectiveBurnRateRuleAPI.ts",
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
const ERROR_BUDGET_POLICY: string = "slo/error-budget-policy";
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
      '"Measured over a rolling {{days}}-day window, and At Risk when less than {{threshold}} of the error budget is left."',
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
    expect(readSource("sloService")).toContain(
      "getSloRecommendedBurnRateRules({",
    );
    expect(
      getSloRecommendedBurnRateRules({ windowDays: 30 }).map(
        (rule: SloRecommendedBurnRateRule): string => {
          return rule.name;
        },
      ),
    ).toEqual([
      SLO_FAST_BURN_RULE_NAME,
      SLO_SLOW_BURN_RULE_NAME,
      SLO_SLOW_LEAK_RULE_NAME,
    ]);

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
      `Burn rate rules = A **${SLO_FAST_BURN_RULE_NAME}**, a **${SLO_SLOW_BURN_RULE_NAME}** and a **${SLO_SLOW_LEAK_RULE_NAME}** rule, scaled to the window`,
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

    expect(sections["Configuration"]).toEqual(["Monitors"]);
    expect(sections["Rules"]).toEqual([
      "Monitor Rules",
      "Burn Rate Rules",
      "Error Budget Policy",
    ]);
    expect(sections["Management"]).toEqual([
      "Owners",
      "Settings",
      "Audit Logs",
      "Delete SLO",
    ]);
    expect(menu).toContain("getDeveloperSideMenuSection(");

    // In the menu's order: Configuration, then Rules, then Management.
    expect(
      Object.keys(sections).filter((title: string): boolean => {
        return ["Configuration", "Rules", "Management"].includes(title);
      }),
    ).toEqual(["Configuration", "Rules", "Management"]);

    for (const title of ["Configuration", "Rules", "Management", "Developer"]) {
      expect({ title, folded: startsFolded(title) }).toEqual({
        title,
        folded: true,
      });
    }

    expect(page).toContain(
      "**Monitors** sits in a **Configuration** section, **Monitor Rules**, **Burn Rate Rules** and **Error Budget Policy** in a **Rules** section, and **Owners**, **Settings**, **Audit Logs** and **Delete SLO** in a **Management** section. All three start folded, as does a **Developer** section",
    );
  });

  it("says where the Monitors, Monitor Rules, Burn Rate Rules and Error Budget Policy pages sit in the side menu", () => {
    const menu: string = readSource("sloViewSideMenu");
    const sections: Record<string, Array<string>> = {};

    for (const match of Array.from(menu.matchAll(SIDE_MENU_SECTION))) {
      sections[match[1] as string] = allMatches(
        match[2] as string,
        TITLE_ENTRY,
      );
    }

    expect(sections["Configuration"]).toContain("Monitors");
    expect(sections["Rules"]).toContain("Monitor Rules");
    expect(englishPage(MONITOR_RULES)).toContain(
      "This page covers an SLO's **Monitors** page, under **Configuration** in its side menu, and its **Monitor Rules** page, under **Rules**.",
    );

    /*
     * The rule form's first step sends the reader to Burn Rate Rules, which
     * is folded away under Rules until opened: the step names the section,
     * so the reader knows which title to click.
     */
    expect(sections["Rules"]).toContain("Burn Rate Rules");
    expect(section(englishPage(BURN_RATE), "Open Burn Rate Rules")).toContain(
      "go to **Burn Rate Rules** in the **Rules** section of its side menu",
    );

    // The same for the policy, whose page is folded under Rules too.
    expect(sections["Rules"]).toContain("Error Budget Policy");
    expect(
      section(englishPage(ERROR_BUDGET_POLICY), "Open Error Budget Policy"),
    ).toContain(
      "go to **Error Budget Policy** in the **Rules** section of its side menu",
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

    // Compared only with the rules an hour can speak for: up to Slow burn's 6 hours.
    expect(SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES).toBe(6 * 60);
    expect(readSource("overview")).toContain(
      "return isComparedWithCurrentBurnRate(rule.longWindowInMinutes);",
    );
    expect(readSource("rulesSummary")).toContain(
      "isComparedWithCurrentBurnRate(",
    );
    expect(page).toContain(
      `at the lowest threshold of the SLO's enabled burn rate rules that look back ${SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES / 60} hours or less.`,
    );
    expect(page).toContain(
      `each enabled rule's threshold beside the current burn rate, for rules that look back ${SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES / 60} hours or less`,
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
    // The card titles itself "Archive {{itemName}}" with the name (#7195).
    expect(archive).toContain("getArchiveCardWords(");
    expect(readSource("archiveCardWords")).toMatch(
      /translationKey\(\s*"Archive \{\{itemName\}\}",?\s*\)/,
    );
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

  // A default rule as a new SLO with this window is seeded with.
  function seeded(
    name: string,
    window: { windowType?: SloWindowType; windowDays?: number },
  ): SloRecommendedBurnRateRule {
    const rule: SloRecommendedBurnRateRule | undefined =
      getSloRecommendedBurnRateRules(window).find(
        (candidate: SloRecommendedBurnRateRule): boolean => {
          return candidate.name === name;
        },
      );

    expect({ name, seeded: Boolean(rule) }).toEqual({ name, seeded: true });

    return rule as SloRecommendedBurnRateRule;
  }

  const threshold: (value: number) => string = (value: number): string => {
    return `${value}×`;
  };

  /*
   * A window the way the page's tables write it: whole days and hours as
   * such, a tenth of a window shorter than 30 days in tenths ("2.8 days",
   * "16.8 hours", "5.6 hours"), and anything shorter in minutes.
   */
  const windowText: (minutes: number) => string = (minutes: number): string => {
    if (minutes % 1440 === 0) {
      return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
    }

    if (minutes >= 2 * 1440 && (minutes * 10) % 1440 === 0) {
      return `${minutes / 1440} days`;
    }

    if (minutes % 60 === 0) {
      return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    }

    if (minutes >= 5 * 60 && (minutes * 10) % 60 === 0) {
      return `${minutes / 60} hours`;
    }

    return `${minutes} minutes`;
  };

  it("scales the default thresholds the way new SLOs are seeded", () => {
    const service: string = readSource("sloService");
    const seed: string = blockFrom(
      service,
      "private async seedDefaultBurnRateRules(",
      "for (const defaultRule of defaultRules)",
    );

    // The service seeds exactly the shared recommendation, for the SLO's window.
    expect(seed).toContain(
      "getSloRecommendedBurnRateRules({\n        windowType: createdItem.windowType,\n        windowDays: createdItem.windowDays,\n      });",
    );

    const defaults: Array<Array<string>> = tableRows(
      section(page, "Default rules"),
    );

    expect(
      defaults.map((row: Array<string>): Array<string> => {
        return row.slice(0, 4);
      }),
    ).toEqual(
      [
        SLO_FAST_BURN_RULE_NAME,
        SLO_SLOW_BURN_RULE_NAME,
        SLO_SLOW_LEAK_RULE_NAME,
      ].map((name: string): Array<string> => {
        const rule: SloRecommendedBurnRateRule = seeded(name, {
          windowType: SloWindowType.Rolling,
          windowDays: 30,
        });

        return [
          `**${name}**`,
          threshold(rule.burnRateThreshold),
          windowText(rule.longWindowInMinutes),
          windowText(rule.shortWindowInMinutes),
        ];
      }),
    );

    const rows: Array<Array<string>> = tableRows(
      page.slice(page.indexOf("| SLO window | Fast burn threshold |")),
    );

    expect(rows).toEqual(
      [7, 28, 30, 90].map((days: number): Array<string> => {
        const window: { windowType: SloWindowType; windowDays: number } = {
          windowType: SloWindowType.Rolling,
          windowDays: days,
        };

        return [
          `${days} days`,
          threshold(seeded(SLO_FAST_BURN_RULE_NAME, window).burnRateThreshold),
          threshold(seeded(SLO_SLOW_BURN_RULE_NAME, window).burnRateThreshold),
        ];
      }),
    );

    const leaks: Array<Array<string>> = tableRows(
      page.slice(page.indexOf("| SLO window | Slow leak threshold |")),
    );

    expect(leaks).toEqual(
      [7, 28, 30, 90].map((days: number): Array<string> => {
        const leak: SloRecommendedBurnRateRule = seeded(
          SLO_SLOW_LEAK_RULE_NAME,
          { windowType: SloWindowType.Rolling, windowDays: days },
        );

        return [
          `${days} days`,
          threshold(leak.burnRateThreshold),
          windowText(leak.longWindowInMinutes),
          windowText(leak.shortWindowInMinutes),
        ];
      }),
    );

    // A calendar month is seeded as 30 days.
    for (const name of [
      SLO_FAST_BURN_RULE_NAME,
      SLO_SLOW_BURN_RULE_NAME,
      SLO_SLOW_LEAK_RULE_NAME,
    ]) {
      expect(seeded(name, { windowType: SloWindowType.CalendarMonth })).toEqual(
        seeded(name, { windowType: SloWindowType.Rolling, windowDays: 30 }),
      );
    }

    expect(page).toContain("Calendar-month SLOs get the 30-day values.");
  });

  it("says Slow leak is a ticket: the least severe severity, no incident and a day of quiet", () => {
    const leak: SloRecommendedBurnRateRule = seeded(SLO_SLOW_LEAK_RULE_NAME, {
      windowDays: 30,
    });

    expect(leak.alertSeverity).toBe(SloRecommendedAlertSeverity.LeastSevere);
    expect(
      seeded(SLO_FAST_BURN_RULE_NAME, { windowDays: 30 }).alertSeverity,
    ).toBe(SloRecommendedAlertSeverity.MostSevere);
    expect(
      seeded(SLO_SLOW_BURN_RULE_NAME, { windowDays: 30 }).alertSeverity,
    ).toBe(SloRecommendedAlertSeverity.MostSevere);
    expect(SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES).toBe(24 * 60);
    expect(leak.refireSuppressionMinutes).toBe(
      SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES,
    );

    const defaults: string = section(page, "Default rules");

    expect(defaults).toContain(
      "Fast burn and Slow burn are pages: they raise an alert at the project's most severe alert severity.",
    );
    expect(defaults).toContain(
      "Slow leak is a ticket: it raises its alert at the project's least severe alert severity.",
    );
    expect(defaults).toContain(
      "After its alert resolves, it waits 24 hours, not its 3-day long window, before it raises another.",
    );
    expect(defaults).toContain("None of them declares an incident");
    expect(section(page, "Resolution and re-fire suppression")).toContain(
      "Slow leak is created with 24 hours instead of its 3-day long window",
    );

    // A steady 3x on a 99.9% / 30-day SLO: under Slow burn's 6x, over Slow leak's 1x.
    expect(3).toBeLessThan(
      seeded(SLO_SLOW_BURN_RULE_NAME, { windowDays: 30 }).burnRateThreshold,
    );
    expect(3).toBeGreaterThanOrEqual(leak.burnRateThreshold);
    expect(defaults).toContain(
      "at 3×, a 99.9% budget is gone in 10 days, yet only Slow leak fires.",
    );
  });

  it("offers Add recommended rules as the Burn Rate Rules page draws it, and says what counts as there", () => {
    const rulesPage: string = readSource("burnRulesPage");
    const modal: string = readSource("recommendedRulesModal");
    const banner: string = readSource("recommendedRulesBanner");

    // A note above the table's rows, not a card button folded into its ⋯.
    expect(rulesPage).toContain("topContent={");
    expect(rulesPage).toContain("<SloRecommendedBurnRateRulesBanner");
    expect(rulesPage).toContain("ModelAction.Create");
    expect(rulesPage).not.toContain('title: "Add recommended rules",');
    expect(banner).toContain('title="Add recommended rules"');
    expect(banner).toContain("Not on this SLO yet: {{rules}}.");
    expect(banner).toContain(
      "A disabled rule counts as set up, so disable a rule you do not want instead of deleting it.",
    );
    expect(modal).toContain('title="Add recommended rules"');
    expect(modal).toContain('submitButtonText="Add rules"');

    const addSection: string = section(
      page,
      "Add the recommended rules to an existing SLO",
    );

    expect(addSection).toContain(
      "its **Burn Rate Rules** page names them in a note above the table. Click **Add recommended rules** in the note",
    );
    expect(addSection).toContain(
      "To stop the note offering a default rule you do not want, keep the rule and disable it instead of deleting it.",
    );
    expect(addSection).toContain(
      "It adds only the missing rules, and clicking it again adds nothing.",
    );
    expect(addSection).toContain(
      "You need permission to create SLO burn rate rules.",
    );
    expect(addSection).toContain(
      "A rule counts as there when the SLO has a rule with the same name, or one with the same long window, whether it is on or off.",
    );

    // What the page says counts as there is what the server checks.
    const leak: SloRecommendedBurnRateRule = seeded(SLO_SLOW_LEAK_RULE_NAME, {
      windowDays: 30,
    });

    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [{ name: "Slow leak", longWindowInMinutes: 10 }],
      }),
    ).toBe(true);
    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [{ name: "Renamed", longWindowInMinutes: 4320 }],
      }),
    ).toBe(true);
    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [{ name: "Renamed", longWindowInMinutes: 10 }],
      }),
    ).toBe(false);

    // A disabled rule is there too: the check never reads whether it is on.
    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [
          {
            name: "Slow leak",
            longWindowInMinutes: 4320,
            isEnabled: false,
          } as SloExistingBurnRateRule,
        ],
      }),
    ).toBe(true);

    // The rules the API adds are posted to the feed and audited like any other.
    expect(readSource("burnRuleService")).toContain(
      "const created: Model = await this.create({",
    );
    expect(addSection).toContain(
      "Each rule it adds is posted to the SLO's feed and recorded in its audit logs, like a rule you create yourself.",
    );
  });

  it("offers Add recommended rules for many SLOs at once in the SLO list's Bulk Actions, and says what it adds and what it answers", () => {
    const slosPage: string = readSource("slosPage");
    const bulkAction: string = readSource("recommendedRulesBulkAction");
    const bulkCopy: string = readSource("recommendedRulesBulkCopy");
    const routes: string = readSource("burnRuleApi");

    // In the live SLO list's Bulk Actions, by the Burn Rate Rules page's own name.
    expect(slosPage).toContain("...recommendedRulesBulkActions,");
    expect(readSource("sloBulkActions")).toContain(
      "useSloRecommendedRulesBulkAction()",
    );
    expect(readSource("archivedSlosPage")).not.toContain(
      "recommendedRulesBulkActions",
    );
    expect(bulkCopy).toMatch(
      /SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE: string = translationKey\(\s*"Add recommended rules",?\s*\)/,
    );
    expect(bulkAction).toContain(
      "title: SLO_ADD_RECOMMENDED_RULES_ACTION_TITLE,",
    );
    expect(slosPage).toContain(
      "select them in this list and choose **Add recommended rules** in **Bulk Actions**",
    );

    const bulk: string = section(page, "Add them to many SLOs at once");

    expect(bulk).toContain("Open **SLOs** and select the SLOs to update.");
    expect(bulk).toContain(
      "Open **Bulk Actions** and choose **Add recommended rules**.",
    );
    expect(bulk).toContain("Click **Add recommended rules** to add them.");

    // What the confirmation says, in its own words.
    expect(bulkCopy).toContain(
      "{{count}} SLOs get the recommended rules they are missing:",
    );
    expect(bulkCopy).toContain(
      "{{count}} SLOs already have every recommended rule and are left as they are.",
    );
    expect(bulkCopy).toContain(
      "{{count}} SLOs could not be read, so nothing is added to them.",
    );
    expect(bulk).toContain(
      "the confirmation counts how many of the selected SLOs get each rule, scaled to their own windows",
    );
    expect(bulk).toContain(
      "It also says how many already have every recommended rule, and how many could not be read.",
    );

    // Slow leak takes another shape on a 7-day SLO than on a 30-day one.
    expect(
      seeded(SLO_SLOW_LEAK_RULE_NAME, { windowDays: 7 }).longWindowInMinutes,
    ).not.toBe(
      seeded(SLO_SLOW_LEAK_RULE_NAME, { windowDays: 30 }).longWindowInMinutes,
    );
    expect(bulk).toContain("such as Slow leak on a 7-day and on a 30-day SLO");

    // The result, in the action's own words.
    expect(bulkCopy).toContain("Rules added to {{count}} SLOs");
    expect(bulkCopy).toContain(
      "{{count}} SLOs already had every recommended rule",
    );
    expect(bulkCopy).toContain("Rules not added to {{count}} SLOs");
    expect(bulk).toContain(
      "whether rules were added, it already had every recommended rule, or it was not changed and why",
    );

    // The same add as the SLO's own page: the bulk add goes through it.
    expect(readSource("burnRuleService")).toContain(
      "await this.addMissingRecommendedRules({",
    );
    expect(bulk).toContain(
      "exactly as its own **Burn Rate Rules** page would add them",
    );
    expect(bulk).toContain("running it again on the same SLOs adds nothing");
    expect(bulk).toContain("Archived SLOs are not on the list");

    // The four requests, as the API serves them.
    const route: (name: string) => string = (name: string): string => {
      const match: RegExpExecArray | null = new RegExp(
        `${name}: string =\\s*"([^"]+)"`,
      ).exec(routes);

      expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

      return (match as RegExpExecArray)[1] as string;
    };

    const crudPath: string =
      new ServiceLevelObjectiveBurnRateRule().getCrudApiPath()?.toString() ||
      "";

    expect(crudPath).toBe("/service-level-objective-burn-rate-rule");
    expect(
      tableRows(bulk.slice(bulk.indexOf("| Request | What it does |"))).map(
        (row: Array<string>): string => {
          return row[0] as string;
        },
      ),
    ).toEqual([
      `\`POST /api${crudPath}${route("SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE")}\``,
      `\`POST /api${crudPath}${route("SLO_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE")}\``,
      `\`POST /api${crudPath}${route("SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE")}\``,
      `\`POST /api${crudPath}${route("SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE")}\``,
    ]);

    // What they take and answer, and how many SLOs one names.
    expect(routes).toContain('["serviceLevelObjectiveId"]');
    expect(routes).toContain('["serviceLevelObjectiveIds"]');
    expect(bulk).toContain('`{ "serviceLevelObjectiveId": "..." }`');
    expect(bulk).toContain('`{ "serviceLevelObjectiveIds": ["..."] }`');
    expect(bulk).toContain(
      `at most ${SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS} SLOs per request`,
    );
    expect(routes.split("results: results.map(").length - 1).toBe(2);
    expect(bulk).toContain(
      "answer with one entry for each SLO in `results`, in the order asked",
    );

    for (const status of Object.values(SloBulkRecommendedRulesStatus)) {
      expect({ status, named: bulk.includes(`\`${status}\``) }).toEqual({
        status,
        named: true,
      });
    }

    // The SLO list's own page sends readers here.
    expect(section(englishPage(INTRODUCTION), "The SLO list")).toContain(
      "give them the [recommended burn rate rules](/docs/slo/burn-rate-alerts#add-them-to-many-slos-at-once) they are missing",
    );
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
      "a new SLO cannot fire its **Fast burn** rule for its first hour, its **Slow burn** rule for its first six, or its **Slow leak** rule for its first three days",
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
        "async function fireSloRecordSource",
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

    /*
     * The Alert and Incident steps fold their fields into the sections every
     * SLO record output shares (an error budget policy tier's too).
     */
    const outputForm: string = readSource("sloRecordOutputForm");

    for (const output of ["Alert", "Incident"]) {
      expect(form).toContain(
        `getSlo${output}OutputSections<ServiceLevelObjectiveBurnRateRule>()`,
      );
    }

    for (const title of ["Description", "Ownership & Labels", "On-Call"]) {
      expect(outputForm).toContain(`title: "${title}",`);
    }

    expect(outputForm).toContain("getAdvancedFormSection<TModel>({");

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

    /*
     * What the rule opens is one choice, When it fires, with three answers:
     * the page names the choice and each answer as the form draws them, the
     * default first. The two switches it replaced stay registered unseen
     * (the form loads and saves the columns through them), so the page no
     * longer names them.
     */
    expect(form).toContain("title: BURN_RATE_DECLARES_FIELD_TITLE,");
    expect(form).toContain("radioButtonOptions: getBurnRateDeclaresChoices(),");
    expect(create).toContain(`answer **${BURN_RATE_DECLARES_FIELD_TITLE}**: `);

    for (const declares of BURN_RATE_DECLARES_ANSWERS) {
      expect(create).toContain(
        `**${BURN_RATE_DECLARES_COPY[declares].title}**`,
      );
    }

    expect(create).toContain(
      `**${BURN_RATE_DECLARES_COPY[BurnRateDeclares.Alert].title}**, the default`,
    );

    for (const replaced of ["Create Alert", "Declare Incident"]) {
      expect(blockFrom(form, `title: "${replaced}",`, "stepId:")).toContain(
        "showIf: (): boolean => {\n      return false;",
      );
      expect(create).not.toContain(`**${replaced}**`);
    }

    // A new rule is on; Enabled is on its edit form only.
    expect(blockFrom(form, 'title: "Enabled",', "stepId:")).toContain(
      "doNotShowWhenCreating: true,",
    );
    expect(create).toContain(
      "A new rule is on; to stop it firing later, switch **Enabled** off on its edit form.",
    );
    expect(create).not.toContain("**Enabled** is on.");
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
    expect(page).toContain(
      "The API refuses a rule that would create no alert and declare no incident",
    );
    expect(readSource("worker")).toContain(
      "rule.refireSuppressionMinutes ?? rule.longWindowInMinutes ?? 0,",
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

    /*
     * A new rule starts on Create an alert: the answer the two columns'
     * defaults (an alert, no incident) make, and the form's first answer.
     */
    const copy: typeof BURN_RATE_DECLARES_COPY = BURN_RATE_DECLARES_COPY;

    expect(BURN_RATE_DECLARES_ANSWERS[0]).toBe(BurnRateDeclares.Alert);
    expect(getBurnRateDeclares({})).toBe(BurnRateDeclares.Alert);
    expect(section(page, "What a rule declares")).toContain(
      "|  | **Alert** | **Incident** |",
    );
    expect(byRow["Opened by"]).toEqual([
      `**${copy[BurnRateDeclares.Alert].title}**, the default, or **${copy[BurnRateDeclares.Both].title}**`,
      `**${copy[BurnRateDeclares.Incident].title}** or **${copy[BurnRateDeclares.Both].title}**`,
    ]);
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
    // The line under the incident answer of When it fires says so.
    expect(
      BURN_RATE_DECLARES_COPY[BurnRateDeclares.Incident].description,
    ).toContain("Burn rate incidents never reach status pages.");
    expect(page).toContain(
      "A burn rate incident is never shown on status pages and never notifies status page subscribers.",
    );
  });
});

describe("Error Budget Policy, against the policy, the worker and the API", () => {
  const page: string = englishPage(ERROR_BUDGET_POLICY);
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();

  // Tiers as the policy reads them: an id and a threshold each.
  function tiersAt(
    ...thresholds: Array<number>
  ): Array<{ id: string; thresholdPercentage: number }> {
    return thresholds.map(
      (threshold: number): { id: string; thresholdPercentage: number } => {
        return { id: `tier-${threshold}`, thresholdPercentage: threshold };
      },
    );
  }

  // The threshold of the tier a budget puts the SLO in, or null for none.
  function tierAfter(data: {
    budget: number;
    thresholds: Array<number>;
    current: number | null;
  }): number | null {
    const found: { thresholdPercentage: number } | null = computeSloPolicyTier({
      budgetRemainingPercentage: data.budget,
      tiers: tiersAt(...data.thresholds),
      currentTierId: data.current === null ? null : `tier-${data.current}`,
    });

    return found ? found.thresholdPercentage : null;
  }

  it("names a tier's fields as the model titles them, and the button that adds one", () => {
    const fields: Array<string> = firstCells(section(page, "How tiers work"));

    expect(fields).toEqual(
      ["name", "thresholdPercentage", "whatWeDo"].map(
        (column: string): string => {
          return `**${tier.getTableColumnMetadata(column).title as string}**`;
        },
      ),
    );
    expect(tier.getTableColumnMetadata("whatWeDo").required).toBe(true);

    const button: string = createButton(tier);

    expect(button).toBe("Create SLO Error Budget Policy Tier");
    expect(section(page, "Set up a policy")).toContain(`Click **${button}**.`);
    expect(section(page, "Set up a policy")).toContain(
      "You need permission to create SLO error budget policy tiers.",
    );
  });

  it("states the threshold range, the unique threshold and the longest What We Do the server takes", () => {
    const service: string = readSource("policyTierService");

    expect(SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE).toBe(0);
    expect(SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE).toBe(100);
    // Decimals are a threshold, a value past either end is none.
    expect(readSloPolicyTierThreshold("2.5")).toBe(2.5);
    expect(readSloPolicyTierThreshold(100.5)).toBeNull();
    expect(readSloPolicyTierThreshold(-1)).toBeNull();
    expect(service).toContain(
      "const thresholdPercentage: number | null =\n      readSloPolicyTierThreshold(value);",
    );
    expect(page).toContain(
      `From ${SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE} to ${SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE}, decimals allowed. Each tier of an SLO has a threshold of its own.`,
    );
    expect(readSource("policyTierModel")).toContain(
      '@Index(["serviceLevelObjectiveId", "thresholdPercentage"], { unique: true })',
    );
    expect(service).toContain("private async assertThresholdIsFree(");

    expect(SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH).toBe(10000);
    expect(service).toContain(
      "value.length > SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH",
    );
    expect(page).toContain(
      `Required, up to ${SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH.toLocaleString("en-US")} characters.`,
    );
  });

  it("puts the SLO in the most severe tier that applies, as the worker decides it", () => {
    const policy: Array<number> = [50, 25, 0];

    expect(tierAfter({ budget: 30, thresholds: policy, current: null })).toBe(
      50,
    );
    expect(tierAfter({ budget: 10, thresholds: policy, current: null })).toBe(
      25,
    );
    // At the threshold itself the tier applies, above every one none does.
    expect(tierAfter({ budget: 25, thresholds: policy, current: null })).toBe(
      25,
    );
    expect(tierAfter({ budget: 60, thresholds: policy, current: null })).toBe(
      null,
    );
    // A budget that falls past several thresholds goes straight to the last.
    expect(tierAfter({ budget: -1, thresholds: policy, current: 50 })).toBe(0);
    expect(readSource("worker")).toContain("computeSloPolicyTier({");

    expect(page).toContain(
      "With tiers at 50%, 25% and 0%, an SLO with 30% of its budget left is in the 50% tier, and one with 10% left is in the 25% tier.",
    );
    expect(page).toContain(
      "A budget that falls past several thresholds at once goes straight to the most severe tier.",
    );
  });

  it("leaves a tier with the status's own margins, and draws them as they are", () => {
    expect(getSloPolicyTierExitPercentage(0)).toBe(
      SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
    );
    expect(getSloPolicyTierExitPercentage(25)).toBe(
      25 + SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
    );
    // The tier stays until the exit level, and moves on at it.
    expect(tierAfter({ budget: 1.9, thresholds: [0, 25], current: 0 })).toBe(0);
    expect(tierAfter({ budget: 2, thresholds: [0, 25], current: 0 })).toBe(25);
    expect(tierAfter({ budget: 29.9, thresholds: [25, 50], current: 25 })).toBe(
      25,
    );
    expect(tierAfter({ budget: 30, thresholds: [25, 50], current: 25 })).toBe(
      50,
    );

    /*
     * Tiers at 0% and at the at-risk threshold move exactly with Budget
     * Exhausted and At Risk, along a budget that falls, overspends and
     * recovers.
     */
    const threshold: number = DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;
    let status: SloStatus = SloStatus.Healthy;
    let current: number | null = null;

    for (const budget of [
      100, 30, 20, 19, 5, 0, -3, 1, 1.9, 2, 10, 20, 24.9, 25, 26, 0.5, -1, 2,
      30, 60,
    ]) {
      status = SloUtil.computeSloStatus({
        budgetRemainingPercentage: budget,
        currentStatus: status,
        atRiskThresholdPercentage: threshold,
      });
      current = tierAfter({ budget, thresholds: [threshold, 0], current });

      expect({ budget, status, current }).toEqual({
        budget,
        status,
        current:
          status === SloStatus.BudgetExhausted
            ? 0
            : status === SloStatus.AtRisk
              ? threshold
              : null,
      });
    }

    const tiers: string = section(page, "Entering and leaving a tier");

    expect(tiers).toContain(
      `A tier at 0% is left once ${SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE}% of the budget is left again. Any other tier is left once the budget is ${SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE} points above its threshold.`,
    );
    expect(tiers).toContain(
      "So a tier at 0% moves with the **Budget Exhausted** status, and a tier at the SLO's at-risk threshold moves with **At Risk**",
    );

    // The diagram walks the recommended tiers, entering and leaving each.
    const [caution, first, exhausted] =
      SLO_RECOMMENDED_POLICY_TIERS as Array<SloRecommendedPolicyTier>;
    const exitOf: (recommended: SloRecommendedPolicyTier) => number = (
      recommended: SloRecommendedPolicyTier,
    ): number => {
      return getSloPolicyTierExitPercentage(recommended.thresholdPercentage);
    };

    for (const line of [
      `    state "${caution!.name}" as Caution`,
      `    state "${first!.name}" as First`,
      `    state "${exhausted!.name}" as Exhausted`,
      `    None --> Caution: ${caution!.thresholdPercentage}% or less left`,
      `    Caution --> First: ${first!.thresholdPercentage}% or less left`,
      `    First --> Exhausted: ${exhausted!.thresholdPercentage}% or less left`,
      `    Exhausted --> First: ${exitOf(exhausted!)}% left again`,
      `    First --> Caution: ${exitOf(first!)}% left again`,
      `    Caution --> None: ${exitOf(caution!)}% left again`,
    ]) {
      expect({ line, drawn: tiers.includes(line) }).toEqual({
        line,
        drawn: true,
      });
    }
  });

  it("lists the recommended policy exactly as Use the recommended policy adds it", () => {
    const recommended: string = section(page, "The recommended policy");

    expect(
      SLO_RECOMMENDED_POLICY_TIERS.map(
        (recommendedTier: SloRecommendedPolicyTier): number => {
          return recommendedTier.thresholdPercentage;
        },
      ),
    ).toEqual([50, 25, 0]);
    expect(recommended).toContain(
      "adds three tiers, at half the budget, a quarter and none:",
    );
    expect(tableRows(recommended)).toEqual(
      SLO_RECOMMENDED_POLICY_TIERS.map(
        (recommendedTier: SloRecommendedPolicyTier): Array<string> => {
          return [
            `**${recommendedTier.name}**`,
            `${recommendedTier.thresholdPercentage}% left or less`,
            recommendedTier.whatWeDo,
            // As the tiers table's Deployments column says it.
            recommendedTier.freezesDeployments ? "Frozen" : "Allowed",
          ];
        },
      ),
    );

    // None of them raises anything: the starter sets no output.
    expect(
      blockFrom(
        readSource("policyTierService"),
        "public buildRecommendedTier(",
        "return tier;",
      ),
    ).not.toContain("shouldCreate");
    expect(recommended).toContain(
      "None of them raises an alert or declares an incident until you switch that on.",
    );
  });

  it("adds only the recommended tiers that are missing, by name or threshold, on or off", () => {
    const names: (
      existingTiers: Array<SloExistingPolicyTier>,
    ) => Array<string> = (
      existingTiers: Array<SloExistingPolicyTier>,
    ): Array<string> => {
      return getMissingSloRecommendedPolicyTiers({ existingTiers }).map(
        (missing: SloRecommendedPolicyTier): string => {
          return missing.name;
        },
      );
    };

    const all: Array<string> = SLO_RECOMMENDED_POLICY_TIERS.map(
      (recommendedTier: SloRecommendedPolicyTier): string => {
        return recommendedTier.name;
      },
    );

    expect(names([])).toEqual(all);
    // The same name at another threshold is the team's own Caution.
    expect(names([{ name: "Caution", thresholdPercentage: 60 }])).toEqual(
      all.slice(1),
    );
    // Another name at the same threshold holds the threshold.
    expect(names([{ name: "Freeze", thresholdPercentage: 0 }])).toEqual(
      all.slice(0, 2),
    );
    // A tier switched off counts: the check never reads isEnabled.
    expect(
      names([
        {
          name: "Reliability first",
          thresholdPercentage: 25,
          isEnabled: false,
        } as SloExistingPolicyTier,
      ]),
    ).toEqual([all[0], all[2]]);
    // Asking again, once they are there, adds nothing.
    expect(names(SLO_RECOMMENDED_POLICY_TIERS.slice())).toEqual([]);

    const service: string = readSource("policyTierService");
    const adding: string = blockFrom(
      service,
      "public async addMissingRecommendedTiers(",
      "@CaptureSpan()",
    );

    // Worked out again under a lock, and created as the caller.
    expect(adding).toContain("await Semaphore.lock({");
    expect(adding).toContain("await this.getMissingRecommendedTiers(data);");
    expect(adding).toContain("props: data.props,");
    // All or nothing: a create that fails takes the tiers added before it back out.
    expect(adding).toContain("await this.removeRecommendedTiersAdded({");

    const recommended: string = section(page, "The recommended policy");

    expect(recommended).toContain(
      "It adds only the tiers the SLO does not have: a tier with the same name, or with the same threshold, counts as there, whether it is on or off.",
    );
    expect(recommended).toContain(
      "If one of the tiers cannot be added, none is: the SLO is left as it was, and you can try again.",
    );
    expect(recommended).toContain(
      "Each tier it adds is recorded in the SLO's audit logs as added by you.",
    );
  });

  it("applies a change to a tier within about a minute, and resolves what a tier that stops raising raised", () => {
    const service: string = readSource("policyTierService");

    // Create, update and delete each ask for the SLO's next evaluation now.
    expect(service.split("this.requestEvaluation(").length - 1).toBe(3);
    expect(service).toContain(
      "nextEvaluationAt: OneUptimeDate.getCurrentDate(),",
    );
    expect(readSource("worker")).toContain("schedule: EVERY_MINUTE,");

    const update: string = blockFrom(
      service,
      "protected override async onUpdateSuccess(",
      "protected override async onBeforeDelete(",
    );

    expect(update).toContain("if (isTierDisabled || areAlertsTurnedOff) {");
    expect(update).toContain("if (isTierDisabled || areIncidentsTurnedOff) {");
    expect(
      blockFrom(
        service,
        "protected override async onDeleteSuccess(",
        "public async resolveOpenAlertsForTier(",
      ),
    ).toContain("await this.resolveOpenAlertsAndIncidentsForTier({");

    expect(page).toContain(
      "Adding, editing or deleting a tier applies right away: OneUptime evaluates the SLO again within about a minute.",
    );
    expect(page).toContain(
      "Turning a tier off or deleting it resolves what it raised, and the SLO moves to the tier its budget is in. Switching off a tier's alert or incident resolves that alert or incident.",
    );

    // A tier that is gone holds nothing: the budget alone decides.
    expect(tierAfter({ budget: 10, thresholds: [50], current: 25 })).toBe(50);
  });

  it("raises nothing until an output is switched on, and resolves on recovery by default", () => {
    const defaultOf: (column: string) => unknown = (
      column: string,
    ): unknown => {
      return tier.getTableColumnMetadata(column).defaultValue;
    };

    expect({
      shouldCreateAlert: defaultOf("shouldCreateAlert"),
      shouldCreateIncident: defaultOf("shouldCreateIncident"),
      autoResolveAlert: defaultOf("autoResolveAlert"),
      autoResolveIncident: defaultOf("autoResolveIncident"),
      isAlertPrivate: defaultOf("isAlertPrivate"),
      isIncidentPrivate: defaultOf("isIncidentPrivate"),
      addSloOwnersAsOwners: defaultOf("addSloOwnersAsOwners"),
      isEnabled: defaultOf("isEnabled"),
    }).toEqual({
      shouldCreateAlert: false,
      shouldCreateIncident: false,
      autoResolveAlert: true,
      autoResolveIncident: true,
      isAlertPrivate: false,
      isIncidentPrivate: false,
      addSloOwnersAsOwners: false,
      isEnabled: true,
    });

    // The tier's outputs are the rule's, column for column.
    for (const column of [
      "alertSeverity",
      "onCallDutyPolicies",
      "alertTitleTemplate",
      "alertDescriptionTemplate",
      "alertRemediationNotes",
      "alertLabels",
      "alertOwnerTeams",
      "alertOwnerUsers",
      "incidentSeverity",
      "incidentOnCallDutyPolicies",
      "incidentTitleTemplate",
      "incidentDescriptionTemplate",
      "incidentRemediationNotes",
      "incidentLabels",
      "incidentOwnerTeams",
      "incidentOwnerUsers",
    ]) {
      expect({
        column,
        onRule: new ServiceLevelObjectiveBurnRateRule().hasColumn(column),
        onTier: tier.hasColumn(column),
      }).toEqual({ column, onRule: true, onTier: true });
    }

    const alerts: string = section(page, "Alerts and incidents");

    expect(alerts).toContain(
      "Both are off by default, so a tier pages no one until you switch one on.",
    );
    expect(alerts).toContain(
      "resolves them when the tier's auto-resolve is on, as it is by default.",
    );
  });

  it("supersedes, resolves and holds back what tiers raise, as the worker does", () => {
    const worker: string = readSource("worker");
    const outputs: string = blockFrom(
      worker,
      "async function evaluatePolicyTierOutputs(",
      "\n}\n",
    );

    // Superseded: whatever the auto-resolve switches say.
    expect(outputs).toContain(
      "currentTier && isMoreSevereSloPolicyTier(currentTier, tier),",
    );
    expect(outputs).toContain("honourAutoResolve: !isSuperseded,");
    // The tier the SLO is in raises through the rule's own path.
    expect(outputs).toContain("await fireSloRecordSource({");
    // No re-fire suppression for a tier.
    expect(
      blockFrom(worker, "function getPolicyTierSource(", "\n}\n"),
    ).toContain("refireSuppressionMinutes: 0,");
    // Scheduled maintenance holds back creation only.
    expect(
      blockFrom(
        worker,
        "async function fireSloRecordSource",
        "const refireSuppressionMinutes",
      ),
    ).toContain("isAnyMonitorUnderOngoingMaintenance()");

    const alerts: string = section(page, "Alerts and incidents");

    expect(alerts).toContain(
      "Entering a more severe tier resolves what the previous tier raised, whatever its auto-resolve setting says, because the new tier supersedes it.",
    );
    expect(alerts).toContain("There is no re-fire suppression.");
    expect(alerts).toContain(
      "While any monitor of the SLO is in scheduled maintenance, tiers raise nothing. The tier itself still changes, and what is open still resolves.",
    );
  });

  it("keeps the tier of an SLO that measures nothing, and resolves what the tiers raised when it is turned off, archived or deleted", () => {
    const worker: string = readSource("worker");
    const guard: string = blockFrom(
      worker,
      "async function setGuardStatusAndResolveOpenAlerts",
      "\n}\n",
    );

    // Paused and Misconfigured resolve the rules' records, not the tiers'.
    expect(guard).toContain("resolveOpenBurnRateAlertsAndIncidentsForSlo");
    expect(guard).not.toContain("PolicyTier");

    const sloService: string = readSource("sloService");

    expect(sloService).toContain(
      "ServiceLevelObjectiveErrorBudgetPolicyTierService.resolveOpenPolicyTierAlertsAndIncidentsForSlo(",
    );
    expect(sloService).toContain(
      "ServiceLevelObjectiveErrorBudgetPolicyTierService.resolveOpenAlertsAndIncidentsForTier(",
    );
    // A tier is deleted with its SLO.
    expect(
      blockFrom(
        readSource("policyTierModel"),
        "return ServiceLevelObjective;",
        "public serviceLevelObjective?",
      ),
    ).toContain('onDelete: "CASCADE",');

    const notMeasured: string = section(
      page,
      "When the budget is not measured",
    );

    expect(notMeasured).toContain(
      "A **Paused** or **Misconfigured** SLO measures no budget, so its tier stays where it was, and what the tier raised stays open until measuring resumes.",
    );
    expect(notMeasured).toContain(
      "Turning the SLO's evaluation off, or archiving the SLO, resolves what its tiers raised.",
    );
    expect(notMeasured).toContain(
      "Deleting the SLO deletes its tiers and resolves what they raised.",
    );
  });

  it("records tier changes as OneUptime's own, and tier edits as the person's, in the SLO's audit logs", () => {
    const sloModel: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common/Models/DatabaseModels/ServiceLevelObjective.ts",
      ),
      "utf8",
    );
    const ignored: string = blockFrom(sloModel, "ignoreColumns: [", "]");

    // The tier's name is recorded; its id and entry time are bookkeeping.
    expect(ignored).toContain('"currentErrorBudgetPolicyTierId",');
    expect(ignored).toContain('"currentErrorBudgetPolicyTierEnteredAt",');
    expect(ignored).not.toContain('"currentErrorBudgetPolicyTierName",');
    expect(readSource("policyTierModel")).toContain(
      'rootResource: {\n    resourceType: "Service Level Objective",\n    column: "serviceLevelObjectiveId",',
    );

    expect(page).toContain(
      "The SLO's **Audit Logs** record each tier change, and each time deployments are frozen or allowed again, as a change OneUptime made itself, so they show it only with **Store System Events** on",
    );
    expect(page).toContain(
      "Adding, editing and removing a tier is recorded as the person who did it.",
    );
    expect(englishPage(FEED)).toContain("- its error budget policy tiers;");
  });

  it("names the SLO's tier fields the read API returns, readable with the SLO itself", () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    const columns: Array<string> = [
      "currentErrorBudgetPolicyTierId",
      "currentErrorBudgetPolicyTierName",
      "currentErrorBudgetPolicyTierEnteredAt",
    ];

    for (const column of columns) {
      const access: { read?: Array<Permission> } | null =
        slo.getColumnAccessControlFor(column);

      expect({
        column,
        readable: Boolean(
          access?.read?.includes(Permission.ReadServiceLevelObjective) &&
            access?.read?.includes(Permission.Viewer),
        ),
      }).toEqual({ column, readable: true });
    }

    const api: string = section(page, "Read the tier from the API");

    expect(firstCells(api)).toEqual(
      columns.map((column: string): string => {
        return `\`${column}\``;
      }),
    );
    expect(slo.getCrudApiPath()?.toString()).toBe("/service-level-objective");
    expect(api).toContain(
      "curl -X POST 'https://oneuptime.com/api/service-level-objective/<slo-id>/get-item'",
    );

    // Every field the example selects is a column of the SLO.
    const selected: RegExpMatchArray | null = api.match(
      /"select": (\{[^}]+\})/,
    );

    expect(selected).not.toBeNull();

    for (const field of Object.keys(
      JSON.parse((selected as RegExpMatchArray)[1] as string),
    )) {
      expect({ field, column: slo.hasColumn(field) }).toEqual({
        field,
        column: true,
      });
    }

    expect(api).toContain(
      "They are read with the SLO's own read permission, the one its budget needs too.",
    );
  });

  it("names the tiers' own API paths and the recommended policy's requests", () => {
    const crudPath: string = tier.getCrudApiPath()?.toString() || "";
    const routes: string = readSource("policyTierApi");
    const route: (name: string) => string = (name: string): string => {
      const match: RegExpExecArray | null = new RegExp(
        `${name}: string =\\s*"([^"]+)"`,
      ).exec(routes);

      expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

      return (match as RegExpExecArray)[1] as string;
    };

    expect(crudPath).toBe("/service-level-objective-error-budget-policy-tier");

    const api: string = section(page, "Read the tier from the API");

    expect(api).toContain(`\`/api${crudPath}\``);
    expect(
      tableRows(api.slice(api.indexOf("| Request | What it does |"))).map(
        (row: Array<string>): string => {
          return row[0] as string;
        },
      ),
    ).toEqual([
      `\`POST /api${crudPath}${route("SLO_RECOMMENDED_POLICY_ROUTE")}\``,
      `\`POST /api${crudPath}${route("SLO_ADD_RECOMMENDED_POLICY_ROUTE")}\``,
    ]);

    // Both read the SLO from the body, and answer with the tiers.
    expect(
      routes.split("readServiceLevelObjectiveId(req.body)").length - 1,
    ).toBe(2);
    expect(routes.split("tiers: ").length - 1).toBe(2);
    expect(api).toContain(
      'Both take `{ "serviceLevelObjectiveId": "..." }` and answer with the tiers in `tiers`',
    );
  });

  it("names real permissions, and who has them", () => {
    const titles: Record<string, string> = {};

    for (const props of PermissionHelper.getAllPermissionProps()) {
      titles[props.permission] = props.title;
    }

    const permissions: Array<Permission> = [
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.DeleteServiceLevelObjectiveErrorBudgetPolicyTier,
    ];

    expect(firstCells(section(page, "Permissions"))).toEqual(
      permissions.map((permission: Permission): string => {
        return `**${titles[permission] as string}**`;
      }),
    );

    expect(tier.getReadPermissions()).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
      ]),
    );

    for (const permissionsOf of [
      tier.getCreatePermissions(),
      tier.getUpdatePermissions(),
      tier.getDeletePermissions(),
    ]) {
      expect(permissionsOf).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
        ]),
      );
      expect(permissionsOf).not.toContain(Permission.ProjectMember);
      expect(permissionsOf).not.toContain(Permission.Viewer);
    }

    expect(section(page, "Permissions")).toContain(
      "The Project Owner and Project Admin roles have them all, and the Project Member and Viewer roles can read tiers.",
    );
  });
});

describe("Deployment gate, against the policy, the worker and the API", () => {
  const page: string = englishPage(ERROR_BUDGET_POLICY);
  const gate: string = section(page, "Deployment gate");
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const COLUMNS: Array<string> = ["deploymentsAllowed", "deploymentsFrozenAt"];

  // The deploy gate along a run of budgets, as the worker chains evaluations.
  function allowedAlong(data: {
    budgets: Array<number>;
    tiers: Array<{
      id: string;
      thresholdPercentage: number;
      freezesDeployments: boolean;
    }>;
  }): Array<boolean> {
    let tierId: string | null = null;
    let stored: SloStoredDeploymentGate = { deploymentsAllowed: true };

    return data.budgets.map((budget: number): boolean => {
      const current: { id: string; freezesDeployments: boolean } | null =
        computeSloPolicyTier({
          budgetRemainingPercentage: budget,
          tiers: data.tiers,
          currentTierId: tierId,
        });
      const change: SloDeploymentGateChange = getSloDeploymentGateChange({
        tier: current,
        stored: stored,
        now: new Date("2026-11-09T12:00:00.000Z"),
      });

      tierId = current?.id || null;
      stored = change.gate;

      return change.gate.deploymentsAllowed;
    });
  }

  it("names the tier's switch as the model titles it, off by default, on the tier's form", () => {
    const column: { title?: string; defaultValue?: unknown } =
      tier.getTableColumnMetadata("freezesDeployments");

    expect(column.title).toBe("Freeze Deployments");
    expect(column.defaultValue).toBe(false);
    expect(
      fieldTypeOf(readSource("policyTierForm"), "Freeze Deployments"),
    ).toBe("Toggle");
    expect(gate).toContain(
      "Open the SLO's **Error Budget Policy**, edit the tier, switch on **Freeze Deployments** and save.",
    );
    expect(section(page, "Set up a policy")).toContain(
      "Switch on **Freeze Deployments** if pipelines should hold back releases while the SLO is in the tier.",
    );
  });

  it("names the tiers table's column and what it says, as the page draws them", () => {
    expect(readSource("policyPage")).toContain('title: "Deployments",');
    expect(readSource("policyTierCopy")).toContain('translationKey("Frozen")');
    expect(readSource("policyTierCopy")).toContain('translationKey("Allowed")');
    expect(gate).toContain(
      "The tier's **Deployments** column in the table says **Frozen**.",
    );
  });

  it("names the two fields the SLO answers with, read with the SLO's own permission and written by the worker alone", () => {
    expect(firstCells(gate)).toEqual(
      COLUMNS.map((column: string): string => {
        return `\`${column}\``;
      }),
    );

    for (const column of COLUMNS) {
      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } | null = slo.getColumnAccessControlFor(column);

      expect({
        column,
        create: access?.create,
        update: access?.update,
        readable: Boolean(
          access?.read?.includes(Permission.ReadServiceLevelObjective) &&
            access?.read?.includes(Permission.Viewer),
        ),
      }).toEqual({ column, create: [], update: [], readable: true });
    }

    // Allowed until a tier says otherwise: every SLO that has none.
    expect(slo.getTableColumnMetadata("deploymentsAllowed").defaultValue).toBe(
      true,
    );
    expect(gate).toContain(
      "The SLO answers with two fields, read with the SLO's own read permission:",
    );
  });

  it("checks with the request the SLO's API answers: its own get-item, selecting real columns", () => {
    const crudPath: string = slo.getCrudApiPath()?.toString() || "";
    const requests: Array<string> = allMatches(
      gate,
      /https:\/\/oneuptime\.com\/api(\/[\w-]+)\/(?:<slo-id>|\$SLO_ID)\/get-item/g,
    );

    // The shell check, the GitHub Actions step and the GitLab CI job.
    expect(requests).toEqual([crudPath, crudPath, crudPath]);

    const selects: Array<string> = allMatches(gate, /"select": (\{[^}]+\})/g);

    expect(selects).toHaveLength(3);

    for (const select of selects) {
      for (const field of Object.keys(JSON.parse(select))) {
        const access: { read?: Array<Permission> } | null =
          slo.getColumnAccessControlFor(field);

        expect({
          field,
          column: slo.hasColumn(field),
          readable: Boolean(
            access?.read?.includes(Permission.ReadServiceLevelObjective),
          ),
        }).toEqual({ field, column: true, readable: true });
      }

      expect(JSON.parse(select)["deploymentsAllowed"]).toBe(true);
    }

    /*
     * Each one prints the answer and compares it with "true", so it fails
     * closed whatever jq's version: jq 1.6 exits 0 on an empty input, which
     * an unreachable OneUptime or a proxy's empty answer would hand it, so a
     * `jq -e` pipeline would have released on no answer at all.
     */
    expect(gate.split("jq -r '.deploymentsAllowed'").length - 1).toBe(3);
    expect(gate.split('= "true"').length - 1).toBe(3);
    expect(gate).not.toContain("jq -e");
    expect(gate).toContain("The check passes only when the answer is `true`.");
  });

  it("is frozen and allowed again with the tier the worker puts the SLO in, in its one state write", () => {
    const worker: string = readSource("worker");

    expect(worker).toContain(
      "getSloDeploymentGateChange({\n      tier: policyTier,",
    );
    expect(worker).toContain("...deploymentGateChange.columns,");

    // The recommended policy: frozen at 0%, still frozen below the 2% exit, allowed again at it.
    const policy: Array<{
      id: string;
      thresholdPercentage: number;
      freezesDeployments: boolean;
    }> = SLO_RECOMMENDED_POLICY_TIERS.map(
      (
        recommended: SloRecommendedPolicyTier,
      ): {
        id: string;
        thresholdPercentage: number;
        freezesDeployments: boolean;
      } => {
        return {
          id: recommended.name,
          thresholdPercentage: recommended.thresholdPercentage,
          freezesDeployments: recommended.freezesDeployments,
        };
      },
    );

    expect(
      allowedAlong({
        budgets: [30, 0, 1.9, SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE],
        tiers: policy,
      }),
    ).toEqual([true, false, false, true]);

    // From one tier that freezes to another, they stay frozen.
    expect(
      allowedAlong({
        budgets: [20, -2, 3],
        tiers: policy.map(
          (entry: {
            id: string;
            thresholdPercentage: number;
            freezesDeployments: boolean;
          }) => {
            return {
              ...entry,
              freezesDeployments: entry.thresholdPercentage < 50,
            };
          },
        ),
      }),
    ).toEqual([false, false, false]);

    // No policy: allowed, whatever the budget.
    expect(allowedAlong({ budgets: [100, 0, -50], tiers: [] })).toEqual([
      true,
      true,
      true,
    ]);

    expect(gate).toContain(
      "Deployments are frozen by the evaluation that puts the SLO in a tier that freezes them, and allowed again by the one that takes it out, with the tier's own recovery margins",
    );
    expect(gate).toContain(
      "From one tier that freezes to another, they stay frozen, and `deploymentsFrozenAt` keeps its time.",
    );
    expect(gate).toContain(
      "Otherwise it is `true`: when the SLO has no policy, while its budget is above every tier, and in a tier that does not freeze deployments.",
    );
  });

  it("keeps the answer of an SLO that measures nothing, as it keeps its tier", () => {
    const guard: string = blockFrom(
      readSource("worker"),
      "async function setGuardStatusAndResolveOpenAlerts",
      "\n}\n",
    );

    expect(guard).not.toContain("deploymentsAllowed");
    expect(guard).not.toContain("DeploymentGate");
    expect(gate).toContain(
      "A **Paused** or **Misconfigured** SLO keeps the answer it had, as it keeps its tier",
    );
    expect(section(page, "When the budget is not measured")).toContain(
      "In each of these cases the SLO keeps the answer it gave about deployments, because it keeps its tier",
    );
  });

  it("applies a switched freeze within about a minute: the switch asks for the SLO's next evaluation", () => {
    expect(
      blockFrom(
        readSource("policyTierService"),
        "const EVALUATION_COLUMNS",
        "];",
      ),
    ).toContain('"freezesDeployments"');
    expect(gate).toContain(
      "Switching **Freeze Deployments** on or off for the tier the SLO is in applies within about a minute.",
    );
  });

  it("says the recommended policy's Budget exhausted tier freezes deployments, and only it", () => {
    expect(
      SLO_RECOMMENDED_POLICY_TIERS.filter(
        (recommended: SloRecommendedPolicyTier): boolean => {
          return recommended.freezesDeployments;
        },
      ).map((recommended: SloRecommendedPolicyTier): string => {
        return recommended.name;
      }),
    ).toEqual(["Budget exhausted"]);
    expect(gate).toContain(
      "The recommended policy's **Budget exhausted** tier freezes deployments.",
    );
    expect(section(page, "The recommended policy")).toContain(
      "**Budget exhausted** freezes deployments, as its agreement says, and the confirmation marks it so",
    );
    // The confirmation marks it, from the definition.
    expect(readSource("recommendedPolicyModal")).toContain(
      "tier.freezesDeployments ? (",
    );
    // The starter writes the freeze its definition says.
    expect(
      blockFrom(
        readSource("policyTierService"),
        "public buildRecommendedTier(",
        "return tier;",
      ),
    ).toContain(
      "tier.freezesDeployments = data.recommended.freezesDeployments === true;",
    );
  });

  it("records the answer in the audit log as OneUptime's own, but not its time", () => {
    const ignored: string = blockFrom(
      fs.readFileSync(
        path.join(
          PACKAGES_DIR,
          "Common/Models/DatabaseModels/ServiceLevelObjective.ts",
        ),
        "utf8",
      ),
      "ignoreColumns: [",
      "]",
    );

    expect(ignored).toContain('"deploymentsFrozenAt",');
    expect(ignored).not.toContain('"deploymentsAllowed",');
    expect(section(page, "Where the tier shows")).toContain(
      "The SLO's **Audit Logs** record each tier change, and each time deployments are frozen or allowed again, as a change OneUptime made itself",
    );
    expect(englishPage(FEED)).toContain(
      "The error budget policy tier the SLO is in, and whether its deployments are allowed, are the exception",
    );
  });

  it("says when deployments are frozen and allowed again in the feed, and since when on the Overview", () => {
    const worker: string = readSource("worker");

    expect(worker).toContain(
      "ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyDeploymentsAllowed",
    );
    expect(worker).toContain(
      "ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyDeploymentsFrozen",
    );
    expect(readSource("policyTierCard")).toContain(
      "DEPLOYMENTS_FROZEN_SINCE_TEMPLATE",
    );
    expect(readSource("policyTierCopy")).toContain(
      '"Deployments frozen since {{time}}"',
    );
    expect(gate).toContain(
      "While deployments are frozen, the SLO's **Overview** shows since when, and its **Feed** says when they are frozen and allowed again.",
    );
    expect(section(englishPage(FEED), "The SLO feed")).toContain(
      "| Deployments frozen or allowed again | Someone switched **Freeze Deployments** on or off for the tier the SLO is in",
    );
  });

  it("no longer lists a deployment gate as not available", () => {
    const later: string = section(page, "Not available yet");

    expect(later).not.toContain("a deployment gate");
    expect(later).toContain(
      "OneUptime does not stop a release by itself: a pipeline that checks `deploymentsAllowed` does",
    );
  });
});

describe("Error Budget Policy in Slack, Microsoft Teams and Mattermost, against the rules and the worker", () => {
  const page: string = englishPage(ERROR_BUDGET_POLICY);
  const posting: string = section(
    page,
    "Post to Slack, Microsoft Teams and Mattermost",
  );
  const SLO: NotificationRuleEventType =
    NotificationRuleEventType.ServiceLevelObjective;

  it("opens the SLOs' own Workspace section, as the SLO list's menu holds it", () => {
    const menu: string = readSource("sloListSideMenu");

    expect(menu).toContain("useWorkspaceSideMenuSection(");
    expect(menu).toContain("slack: PageMap.SLOS_WORKSPACE_CONNECTION_SLACK");
    expect(posting).toContain(
      "Go to **SLOs** → **Workspace** → **Slack**, or **Microsoft Teams**, or **Mattermost**.",
    );
  });

  it("names the rule's create button, its Conditions step and its Destination step as the rule form draws them", () => {
    expect(posting).toContain(`**Create ${RULE_SINGULAR_NAMES[SLO]}**`);
    expect(posting).toContain(
      `Under **${NOTIFICATION_RULE_CONDITIONS_TITLES[SLO]}**, keep **${APPLIES_TO_ALL_ANSWERS[SLO]}**, or pick **${APPLIES_TO_MATCHING_ANSWERS[SLO]}**`,
    );
    expect(posting).toContain(
      `Under **${NOTIFICATION_RULE_DESTINATION_TITLES[WorkspaceType.Slack]}**, name the channels`,
    );
  });

  it("lists the conditions an SLO rule offers, in the order the Filter Type lists them", () => {
    expect(firstCells(section(page, "What a rule matches"))).toEqual(
      NotificationRuleConditionUtil.getCheckOnByEventType(SLO).map(
        (checkOn: string): string => {
          return `**${checkOn}**`;
        },
      ),
    );
  });

  it("names every change a rule can pick, in the order its dropdown lists them", () => {
    expect(section(page, "What a rule matches")).toContain(
      `What changed: ${SLO_ERROR_BUDGET_POLICY_CHANGES.slice(0, -1)
        .map((change: string): string => {
          return `**${change}**`;
        })
        .join(", ")} or **${
        SLO_ERROR_BUDGET_POLICY_CHANGES[
          SLO_ERROR_BUDGET_POLICY_CHANGES.length - 1
        ]
      }**.`,
    );
  });

  it("says an SLO rule only posts, to channels and chats that exist", () => {
    expect(canRuleCreateChannel(SLO)).toBe(false);
    expect(posting).toContain(
      "An SLO gets no channel of its own, so a rule posts only to channels and chats you already have.",
    );
  });

  it("says a mention in the agreement notifies nobody, as the message breaks it", () => {
    const message: string = getSloFeedChatMarkdown(
      getSloPolicyTierChangedFeedParts({
        sloMarkdownLink: FeedMarkdown.asMarkdown("[SLO Checkout](https://x)"),
        previousTierName: null,
        newTier: {
          name: "Budget exhausted",
          thresholdPercentage: 0,
          whatWeDo: "Page <!channel> now.",
        },
        isEscalation: true,
        errorBudgetRemainingPercentage: 0,
        errorBudgetRemainingSeconds: 0,
      }),
    ).toString();

    expect(message).not.toContain("<!channel>");
    expect(posting).toContain(
      "A mention in that agreement, such as `<!channel>`, is posted as text and notifies nobody.",
    );
  });

  it("says a change is posted once, after it is saved, from the worker's one place", () => {
    const worker: string = readSource("worker");

    expect(worker).toContain("SloWorkspaceNotifications.postPolicyChange(");
    // After the one hooked state write, as the feed item is.
    expect(worker.indexOf("await postPolicyChange({")).toBeGreaterThan(
      worker.indexOf("await ServiceLevelObjectiveService.updateOneById({"),
    );
    expect(readSource("sloWorkspaceNotifications")).toContain(
      "sendWorkspaceMarkdownNotification",
    );
    expect(posting).toContain(
      "A change is posted once, after the evaluation that made it is saved.",
    );
    expect(posting).toContain(
      "Switching **Freeze Deployments** on or off for the tier the SLO is in posts a message of its own.",
    );
  });

  it("names the channels as one of the places the tier shows, and no longer lists them as not available", () => {
    expect(section(page, "Where the tier shows")).toContain(
      "The Slack, Microsoft Teams and Mattermost channels your rules name get the same post",
    );
    expect(section(page, "Not available yet")).not.toContain("Slack");
    expect(section(page, "Not available yet")).not.toContain("Microsoft Teams");
  });

  it("says how each condition matches, as the Filter Type offers its operators", () => {
    const matches: Map<string, string> = new Map(
      tableRows(section(page, "What a rule matches")).map(
        (row: Array<string>): [string, string] => {
          return [row[0] as string, row[1] as string];
        },
      ),
    );
    const operators: (checkOn: NotificationRuleConditionCheckOn) => string = (
      checkOn: NotificationRuleConditionCheckOn,
    ): string => {
      return NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn)
        .slice()
        .sort()
        .join(", ");
    };

    // Picked SLOs: any of them, or every SLO but them.
    expect(operators(NotificationRuleConditionCheckOn.Slos)).toBe(
      [ConditionType.ContainsAny, ConditionType.NotContains].sort().join(", "),
    );
    expect(matches.get("**SLOs**")).toBe(
      "The SLOs you pick, or every SLO but those.",
    );

    // Labels: any, all, or none of the ones picked.
    expect(operators(NotificationRuleConditionCheckOn.SloLabels)).toBe(
      [
        ConditionType.ContainsAny,
        ConditionType.ContainsAll,
        ConditionType.NotContains,
      ]
        .sort()
        .join(", "),
    );
    expect(matches.get("**SLO Labels**")).toBe(
      "The SLO's labels: any of the ones you pick, all of them, or none of them.",
    );

    // The name: equal or not, containing or not, starting or ending with.
    expect(operators(NotificationRuleConditionCheckOn.SloName)).toBe(
      [
        ConditionType.EqualTo,
        ConditionType.NotEqualTo,
        ConditionType.Contains,
        ConditionType.NotContains,
        ConditionType.StartsWith,
        ConditionType.EndsWith,
      ]
        .sort()
        .join(", "),
    );
    expect(matches.get("**SLO Name**")).toBe(
      "The SLO's name: equal to your text or not, containing it or not, starting or ending with it.",
    );
  });

  it("says a message that cannot be sent is logged, and the evaluation goes on without it", () => {
    const worker: string = readSource("worker");
    const poster: string = readSource("sloWorkspaceNotifications");

    // The poster catches what the workspaces throw, and says so in the log...
    expect(poster).toContain("} catch (err) {");
    expect(poster).toContain("logger.error(");
    // ...and the worker catches whatever is left, after the feed item.
    const workerPost: string = blockFrom(
      worker,
      "async function postPolicyChangeToWorkspaces(",
      "\n}\n",
    );

    expect(workerPost).toContain("} catch (err) {");
    expect(workerPost).toContain("logger.error(");
    expect(posting).toContain(
      "A message that cannot be sent is logged, and the evaluation, the SLO's feed and what the tier raises go on without it.",
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
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyTierChanged]:
      "Error budget policy tier changed",
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyAlertRaised]:
      "Error budget policy alert raised",
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyIncidentDeclared]:
      "Error budget policy incident declared",
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyAlertResolved]:
      "Error budget policy alert or incident resolved",
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyIncidentResolved]:
      "Error budget policy alert or incident resolved",
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyDeploymentsFrozen]:
      "Deployments frozen or allowed again",
    [ServiceLevelObjectiveFeedEventType.ErrorBudgetPolicyDeploymentsAllowed]:
      "Deployments frozen or allowed again",
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
    // The range the recorder, a failing export and the server read it by.
    expect([
      AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
      AUDIT_LOG_MIN_RETENTION_IN_DAYS,
      AUDIT_LOG_MAX_RETENTION_IN_DAYS,
    ]).toEqual([7, 7, 180]);
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
      "minValue: AUDIT_LOG_MIN_RETENTION_IN_DAYS,",
      "maxValue: AUDIT_LOG_MAX_RETENTION_IN_DAYS,",
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
