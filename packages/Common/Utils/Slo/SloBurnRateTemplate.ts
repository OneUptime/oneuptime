/**
 * Template variables for the Alerts and Incidents a burn rate rule creates.
 *
 * A burn rate rule can carry its own title, description and remediation
 * notes, and all three may reference `{{variables}}` - the SLO, the rule and
 * the numbers that made it fire. This module owns both halves of that
 * contract: the catalog the dashboard documents, and the variable map plus
 * replacer the evaluation worker renders with. Keeping them in one file (and
 * pinning `catalog keys === variable map keys` in the unit tests) is what
 * stops the help text from promising a variable the worker never fills in.
 *
 * Deliberately NOT MonitorTemplateUtil.processTemplateString:
 *   - it imports VMAPI, which pulls in VMRunner and the native isolated-vm
 *     addon, so the worker would load (and its tests would have to mock) a
 *     sandbox for what is a flat string substitution;
 *   - its variable map is built from a monitor and a probe response, none of
 *     which exist for an SLO.
 *
 * Kept free of React, the database models and anything that reads `window`,
 * so the worker, the dashboard form and plain-node tests can all import it.
 */

import ColumnLength from "../../Types/Database/ColumnLength";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import { formatDurationCompact } from "./SloDuration";

/*
 * Every variable a burn rate template may reference. Values equal the
 * `{{name}}` users type, so renaming one is a breaking change for every stored
 * template - add, never rename.
 */
export enum SloBurnRateTemplateVariable {
  SloName = "sloName",
  SloId = "sloId",
  SloLink = "sloLink",
  SloStatus = "sloStatus",
  RuleName = "ruleName",
  BurnRateThreshold = "burnRateThreshold",
  LongWindowBurnRate = "longWindowBurnRate",
  ShortWindowBurnRate = "shortWindowBurnRate",
  LongWindowInMinutes = "longWindowInMinutes",
  ShortWindowInMinutes = "shortWindowInMinutes",
  TargetPercentage = "targetPercentage",
  CurrentSliPercentage = "currentSliPercentage",
  ErrorBudgetRemainingPercentage = "errorBudgetRemainingPercentage",
  ErrorBudgetRemaining = "errorBudgetRemaining",
  ErrorBudgetRemainingMinutes = "errorBudgetRemainingMinutes",
  WindowDescription = "windowDescription",
}

/*
 * A Record over the enum rather than a loose dictionary: the builder below
 * cannot compile unless it fills in every variable, so the catalog, the enum
 * and the worker's map cannot silently drift apart.
 */
export type SloBurnRateTemplateVariables = Record<
  SloBurnRateTemplateVariable,
  string
>;

export interface SloBurnRateTemplateVariableDefinition {
  key: SloBurnRateTemplateVariable;
  description: string;
  example: string;
}

/*
 * The catalog the dashboard renders as a table. Order is the order a reader
 * scans for: identity first, then the burn that fired, then the budget.
 */
export const SLO_BURN_RATE_TEMPLATE_VARIABLES: ReadonlyArray<SloBurnRateTemplateVariableDefinition> =
  [
    {
      key: SloBurnRateTemplateVariable.SloName,
      description: "Name of the SLO.",
      example: "Checkout availability",
    },
    {
      key: SloBurnRateTemplateVariable.SloId,
      description: "ID of the SLO.",
      example: "b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d",
    },
    {
      key: SloBurnRateTemplateVariable.SloLink,
      description: "Link to the SLO in the OneUptime Dashboard.",
      // No angle brackets: the help table is markdown, which would eat them.
      example: "https://oneuptime.com/dashboard/project-id/slos/slo-id",
    },
    {
      key: SloBurnRateTemplateVariable.SloStatus,
      description: "Status of the SLO after this evaluation.",
      example: "At Risk",
    },
    {
      key: SloBurnRateTemplateVariable.RuleName,
      description: "Name of the burn rate rule that fired.",
      example: "Fast burn",
    },
    {
      key: SloBurnRateTemplateVariable.BurnRateThreshold,
      description:
        "The rule's burn rate threshold (a multiple of the sustainable pace).",
      example: "14.4",
    },
    {
      key: SloBurnRateTemplateVariable.LongWindowBurnRate,
      description: "Burn rate measured over the rule's long window.",
      example: "21.5",
    },
    {
      key: SloBurnRateTemplateVariable.ShortWindowBurnRate,
      description: "Burn rate measured over the rule's short window.",
      example: "36",
    },
    {
      key: SloBurnRateTemplateVariable.LongWindowInMinutes,
      description: "Length of the rule's long window, in minutes.",
      example: "60",
    },
    {
      key: SloBurnRateTemplateVariable.ShortWindowInMinutes,
      description: "Length of the rule's short window, in minutes.",
      example: "5",
    },
    {
      key: SloBurnRateTemplateVariable.TargetPercentage,
      description: "The SLO's target, as a percentage.",
      example: "99.9",
    },
    {
      key: SloBurnRateTemplateVariable.CurrentSliPercentage,
      description:
        "The SLI measured over the SLO's compliance window, as a percentage.",
      example: "99.87",
    },
    {
      key: SloBurnRateTemplateVariable.ErrorBudgetRemainingPercentage,
      description:
        "Share of the error budget still left, as a percentage. Negative once the budget is overspent.",
      example: "42.5",
    },
    {
      key: SloBurnRateTemplateVariable.ErrorBudgetRemaining,
      description:
        "Error budget still left, as a duration. Starts with a minus sign once the budget is overspent.",
      example: "18m 22s",
    },
    {
      key: SloBurnRateTemplateVariable.ErrorBudgetRemainingMinutes,
      description: "Error budget still left, in minutes.",
      example: "18.37",
    },
    {
      key: SloBurnRateTemplateVariable.WindowDescription,
      description: "The SLO's compliance window, in words.",
      example: "rolling 30-day window",
    },
  ];

/*
 * The longest template the rule service accepts, shared with the dashboard
 * form so the browser refuses exactly what the server would. A title is held
 * to the varchar the title columns use - on the rule and on the Alert and
 * Incident it renders into. Markdown columns are unbounded text, but a
 * template is copied into every record the rule opens and every notification
 * those send, so it gets a generous cap rather than none.
 */
export const SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH: number =
  ColumnLength.LongText;

export const SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH: number = 50000;

/*
 * The text every burn rate alert and incident carried before templates
 * existed, expressed as templates. Rendering these with the variable map
 * reproduces the old strings character for character (the worker test pins
 * the literal), so a rule with blank templates - every existing and every
 * seeded rule - raises exactly what it always did. The dashboard shows them as
 * placeholders, so the default is visible rather than implied.
 */
export const DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE: string =
  "SLO burn rate: {{sloName}} — {{ruleName}}";

export const DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE: string =
  'SLO "{{sloName}}" is burning its error budget too fast. Rule "{{ruleName}}": burn rate over the last {{longWindowInMinutes}} minutes is {{longWindowBurnRate}}x and over the last {{shortWindowInMinutes}} minutes is {{shortWindowBurnRate}}x — both at or above the threshold of {{burnRateThreshold}}x. Error budget remaining: {{errorBudgetRemainingPercentage}}% ({{errorBudgetRemainingMinutes}} minutes).';

// What the worker knows at the moment a rule fires.
export interface SloBurnRateTemplateContext {
  sloId: string;
  sloName: string | undefined;
  sloLink: string | undefined;
  sloStatus: string | undefined;
  ruleName: string | undefined;
  burnRateThreshold: number;
  longWindowBurnRate: number;
  shortWindowBurnRate: number;
  longWindowInMinutes: number;
  shortWindowInMinutes: number;
  targetPercentage: number;
  currentSliPercentage: number;
  errorBudgetRemainingPercentage: number;
  errorBudgetRemainingSeconds: number;
  windowType: SloWindowType | undefined;
  windowDays: number | undefined;
  timezone: string | undefined;
}

/*
 * Two decimals, the precision the pre-template description always used, and
 * `String(number)` so whole numbers read "60" rather than "60.00". A value
 * that is not a real number renders empty rather than "NaN" - an alert title
 * saying "burn rate NaNx" helps nobody.
 */
type FormatTemplateNumberFunction = (value: number) => string;

const formatTemplateNumber: FormatTemplateNumberFunction = (
  value: number,
): string => {
  if (typeof value !== "number" || !isFinite(value)) {
    return "";
  }

  return String(Math.round(value * 100) / 100);
};

/*
 * Signed, because an overspent budget is the single most useful number during
 * a bad month. ASCII hyphen-minus rather than the U+2212 the dashboard tiles
 * use: this text lands in alert titles, SMS and chat, where people copy it.
 */
type FormatBudgetDurationFunction = (seconds: number) => string;

const formatBudgetDuration: FormatBudgetDurationFunction = (
  seconds: number,
): string => {
  if (typeof seconds !== "number" || !isFinite(seconds)) {
    return "";
  }

  const duration: string = formatDurationCompact(seconds);

  /*
   * formatDurationCompact floors, so -0.4 seconds is "0s" - and "-0s" would
   * claim an overspend the duration itself does not show.
   */
  if (seconds < 0 && duration !== "0s") {
    return `-${duration}`;
  }

  return duration;
};

type DescribeWindowFunction = (context: SloBurnRateTemplateContext) => string;

const describeWindow: DescribeWindowFunction = (
  context: SloBurnRateTemplateContext,
): string => {
  if (context.windowType === SloWindowType.CalendarMonth) {
    return `calendar month (${context.timezone || "UTC"})`;
  }

  // The worker's own rolling default when windowDays is not set.
  const windowDays: number =
    typeof context.windowDays === "number" && context.windowDays > 0
      ? context.windowDays
      : 30;

  return `rolling ${windowDays}-day window`;
};

export type BuildSloBurnRateTemplateVariablesFunction = (
  context: SloBurnRateTemplateContext,
) => SloBurnRateTemplateVariables;

export const buildSloBurnRateTemplateVariables: BuildSloBurnRateTemplateVariablesFunction =
  (context: SloBurnRateTemplateContext): SloBurnRateTemplateVariables => {
    return {
      [SloBurnRateTemplateVariable.SloName]: context.sloName || "",
      [SloBurnRateTemplateVariable.SloId]: context.sloId,
      [SloBurnRateTemplateVariable.SloLink]: context.sloLink || "",
      [SloBurnRateTemplateVariable.SloStatus]: context.sloStatus || "",
      [SloBurnRateTemplateVariable.RuleName]: context.ruleName || "",
      [SloBurnRateTemplateVariable.BurnRateThreshold]: formatTemplateNumber(
        context.burnRateThreshold,
      ),
      [SloBurnRateTemplateVariable.LongWindowBurnRate]: formatTemplateNumber(
        context.longWindowBurnRate,
      ),
      [SloBurnRateTemplateVariable.ShortWindowBurnRate]: formatTemplateNumber(
        context.shortWindowBurnRate,
      ),
      [SloBurnRateTemplateVariable.LongWindowInMinutes]: formatTemplateNumber(
        context.longWindowInMinutes,
      ),
      [SloBurnRateTemplateVariable.ShortWindowInMinutes]: formatTemplateNumber(
        context.shortWindowInMinutes,
      ),
      [SloBurnRateTemplateVariable.TargetPercentage]: formatTemplateNumber(
        context.targetPercentage,
      ),
      [SloBurnRateTemplateVariable.CurrentSliPercentage]: formatTemplateNumber(
        context.currentSliPercentage,
      ),
      [SloBurnRateTemplateVariable.ErrorBudgetRemainingPercentage]:
        formatTemplateNumber(context.errorBudgetRemainingPercentage),
      [SloBurnRateTemplateVariable.ErrorBudgetRemaining]: formatBudgetDuration(
        context.errorBudgetRemainingSeconds,
      ),
      [SloBurnRateTemplateVariable.ErrorBudgetRemainingMinutes]:
        typeof context.errorBudgetRemainingSeconds === "number"
          ? formatTemplateNumber(context.errorBudgetRemainingSeconds / 60)
          : "",
      [SloBurnRateTemplateVariable.WindowDescription]: describeWindow(context),
    };
  };

/*
 * `{{name}}`, tolerating spaces inside the braces (`{{ sloName }}`) because
 * that is how people type it. Only identifier characters are matched, so
 * `{{#each}}` and other Handlebars-looking text is left exactly as written.
 */
const TEMPLATE_VARIABLE_PATTERN: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export type IsSloBurnRateTemplateVariableFunction = (
  name: string,
) => name is SloBurnRateTemplateVariable;

export const isSloBurnRateTemplateVariable: IsSloBurnRateTemplateVariableFunction =
  (name: string): name is SloBurnRateTemplateVariable => {
    return (
      Object.values(SloBurnRateTemplateVariable) as Array<string>
    ).includes(name);
  };

/*
 * Renders a template, or returns null for a blank one so the caller falls back
 * to the default text.
 *
 * - Single pass over the TEMPLATE: a value that itself contains `{{ruleName}}`
 *   (an SLO named that way, say) is inserted literally and never re-expanded.
 * - A function replacement, so `$&` or `$1` inside a value is taken literally
 *   rather than as a String.replace substitution pattern.
 * - An unknown variable is left intact. A typo then shows up verbatim in the
 *   alert, which is how the author finds it - silently blanking it would hide
 *   the mistake, and rejecting it would break every stored template the day a
 *   variable is added to a newer version.
 * - Lookups go through the enum, not `name in variables`, so `{{constructor}}`
 *   cannot reach Object.prototype.
 */
export type RenderSloBurnRateTemplateFunction = (
  template: string | undefined | null,
  variables: SloBurnRateTemplateVariables,
) => string | null;

export const renderSloBurnRateTemplate: RenderSloBurnRateTemplateFunction = (
  template: string | undefined | null,
  variables: SloBurnRateTemplateVariables,
): string | null => {
  if (typeof template !== "string" || template.trim() === "") {
    return null;
  }

  return template.replace(
    TEMPLATE_VARIABLE_PATTERN,
    (placeholder: string, name: string): string => {
      if (!isSloBurnRateTemplateVariable(name)) {
        return placeholder;
      }

      return variables[name];
    },
  );
};
