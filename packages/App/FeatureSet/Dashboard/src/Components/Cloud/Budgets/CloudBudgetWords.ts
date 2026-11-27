import {
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  readCloudBudgetFiscalYearStartMonth,
  readCloudBudgetPeriod,
  readCloudBudgetPlanSplit,
} from "Common/Types/Cloud/CloudBudget";
import {
  ReaderDateTimeFormat,
  getDateLocale,
  getDateTimeFormat,
} from "Common/Types/DateLanguage";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE BUDGET AND FORECAST PAGES SAY (#11008), in English as keys the
 * reader's language words, and the months they name - "April", "Nov
 * 2026" - written by the reader's language on the Gregorian calendar the
 * clouds bill by, at UTC, where a cost month starts.
 */

// The Budgets list.
export const ALL_ACCOUNTS_LABEL: string = translationKey("All accounts");
export const BUDGETS_PERIOD_COLUMN: string = translationKey("Period");
export const BUDGETS_THIS_PERIOD_COLUMN: string = translationKey("This Period");
export const COST_GROUP_GONE: string = translationKey("Cost group deleted");
export const FILTERED_COSTS: string = translationKey("Filtered costs");

// A budget's period, as its row and its page say it.
export const PERIOD_FROM_MONTH: string = translationKey(
  "{{period}} from {{month}}",
);
export const PERIOD_BY_MONTH: string = translationKey("{{period}}, by month");
export const PERIOD_FROM_MONTH_BY_MONTH: string = translationKey(
  "{{period}} from {{month}}, by month",
);

// A split year's row: this month against its share.
export const THIS_MONTH_OF_SHARE: string = translationKey(
  "This month: {{spent}} of {{amount}}",
);
export const THIS_YEAR_OF_AMOUNT: string = translationKey(
  "This year: {{spent}} of {{amount}}",
);

// The form's steps.
export const STEP_BUDGET: string = translationKey("Budget");
export const STEP_AMOUNT: string = translationKey("Amount");
export const STEP_ALERTS: string = translationKey("Alerts");
export const STEP_WHO_HEARS: string = translationKey("Who Hears");

// The Applies To choice.
export const APPLIES_TO_TITLE: string = translationKey("Applies To");
export const APPLIES_TO_DESCRIPTION: string = translationKey(
  "The costs the budget counts: every account, one, a cost group as its rules sort the spend, or services, Regions and tags.",
);
export const PICK_ACCOUNT: string = translationKey("Choose an account");
export const PICK_COST_GROUP: string = translationKey("Choose a cost group");
export const NO_COST_GROUPS: string = translationKey(
  "No cost groups yet. Make one under Cloud > Spend > Cost Groups, or count services, Regions or tags instead.",
);
export const FILTER_HELP: string = translationKey(
  "A cost counts when any rule matches it, and a rule matches when all its conditions do.",
);
export const ACCOUNT_REQUIRED: string = translationKey(
  "Choose the account this budget is for.",
);
export const COST_GROUP_REQUIRED: string = translationKey(
  "Choose the cost group this budget is for.",
);
export const FILTER_REQUIRED: string = translationKey(
  "Add a condition: the services, Regions or tags this budget counts.",
);

// The Amount step.
export const PERIOD_TITLE: string = translationKey("Period");
export const PERIOD_DESCRIPTION: string = translationKey(
  "How long the amount is for. Quarters and years start in the fiscal year's first month, in UTC as the clouds bill.",
);
export const AMOUNT_TITLE: string = translationKey("Amount");
export const AMOUNT_DESCRIPTION: string = translationKey(
  "What each period may cost: a month's, a quarter's or a year's, on the budget's cost basis.",
);
export const FISCAL_START_TITLE: string = translationKey(
  "First Month of the Year",
);
export const FISCAL_START_DESCRIPTION: string = translationKey(
  "The month your fiscal year starts in. Quarters start every three months from it.",
);
export const PLAN_TITLE: string = translationKey("Budget Plan");
export const PLAN_DESCRIPTION: string = translationKey(
  "Split by month, each month is held to its own share, so a quiet month is never warned for a busy month's spend.",
);
export const MONTHLY_PLAN_TITLE: string = translationKey("Monthly Plan");
export const MONTHLY_PLAN_DESCRIPTION: string = translationKey(
  "What each month of the year may cost. Their total is the budget's amount.",
);
export const PLAN_TOTAL: string = translationKey("Total: {{amount}}");
export const PLAN_MONTH_AMOUNT: string = translationKey("{{month}} amount");
export const PLAN_NEEDS_A_MONTH: string = translationKey(
  "Give at least one month an amount above zero.",
);

// The Alerts and Who Hears steps.
export const NOTIFY_TITLE: string = translationKey("Notify");
export const NOTIFY_DESCRIPTION: string = translationKey(
  "Below 100% they are told by email and chat, and nobody is paged. From 100% they own the alert.",
);
export const NOTIFY_GROUP_TEAM_TITLE: string = translationKey(
  "Notify the Cost Group's Team",
);
export const NOTIFY_GROUP_TEAM_DESCRIPTION: string = translationKey(
  "Also tell the team the cost group belongs to, as it is linked now.",
);
export const ALERT_AT_DESCRIPTION: string = translationKey(
  "Shares of the budget, in percent, separated by commas. Below 100% the people to notify are told; from 100% an alert is raised.",
);
export const ON_COURSE_DESCRIPTION: string = translationKey(
  "Also alert, once a period, when it is on course to cost more than the budget: this month at the last week's pace, later months as forecast.",
);
export const UNUSUAL_DAYS_DESCRIPTION: string = translationKey(
  "Also alert, the next day, when a day costs far more than usual.",
);
export const UNUSUAL_THRESHOLD_TITLE: string = translationKey(
  "Unusual Day Threshold",
);
export const UNUSUAL_THRESHOLD_DESCRIPTION: string = translationKey(
  "How far above its usual a day of what the budget counts must be. Leave empty for the project-wide rule.",
);
export const UNUSUAL_UNIT_TITLE: string = translationKey("Threshold Unit");
export const UNUSUAL_UNIT_DESCRIPTION: string = translationKey(
  "An amount in the budget's currency, or a percentage of the usual day with at least 10 more.",
);
export const ON_CALL_DESCRIPTION: string = translationKey(
  "Who is paged when the budget raises an alert: at 100%, and when on course to pass.",
);

// A budget's page.
export const BUDGET_TITLE: string = translationKey("Budget");
export const EDIT_BUDGET: string = translationKey("Edit Budget");
export const THIS_MONTH: string = translationKey("This Month");
export const THIS_QUARTER: string = translationKey("This Quarter");
export const THIS_YEAR: string = translationKey("This Year");
export const ON_COURSE_FOR: string = translationKey("On Course For");
export const LEFT_TO_SPEND: string = translationKey("Left to Spend");
export const OVER_BY: string = translationKey("Over By");
export const OF_AMOUNT: string = translationKey("of {{amount}}");
export const PLANNED_SO_FAR: string = translationKey(
  "{{amount}} planned so far",
);
export const AT_PERIOD_END: string = translationKey("by {{day}}");
export const MONTHS_TITLE: string = translationKey("Month by Month");
export const MONTHS_DESCRIPTION: string = translationKey(
  "What each month of the period cost or is on course to cost, beside its share of the plan.",
);
export const DAYS_TITLE: string = translationKey("This Month, Day by Day");
export const DAYS_DESCRIPTION: string = translationKey(
  "Each day's spend of what the budget counts, as your cloud has reported it.",
);
export const TOP_SERVICES_TITLE: string = translationKey("What Cost the Most");
export const TOP_SERVICES_DESCRIPTION: string = translationKey(
  "The services that cost the most this period.",
);
export const TOP_SERVICES_EMPTY: string = translationKey(
  "Nothing spent this period yet.",
);
export const WHO_HEARS_TITLE: string = translationKey("Who Hears");
export const WHO_HEARS_DESCRIPTION: string = translationKey(
  "Who is told as the spend passes each threshold, and who is paged.",
);
export const TOLD_BELOW_100: string = translationKey(
  "Told below 100%, with no alert",
);
export const PAGED_FROM_100: string = translationKey(
  "Paged from 100%, and when on course to pass",
);
export const NOBODY_TO_TELL: string = translationKey(
  "Nobody to tell: every threshold raises an alert.",
);
export const NOBODY_PAGED: string = translationKey(
  "No on-call policy: alerts page nobody.",
);
export const THRESHOLDS_PASSED: string = translationKey(
  "Passed this period: {{thresholds}}",
);
export const NO_THRESHOLD_PASSED: string = translationKey(
  "No threshold passed this period yet.",
);
export const MONTH_COLUMN: string = translationKey("Month");
export const PLANNED_COLUMN: string = translationKey("Planned");
export const SPENT_COLUMN: string = translationKey("Spent");
export const MONTH_ON_COURSE_FOR: string = translationKey(
  "{{spent}} so far, on course for {{amount}}",
);
export const MONTH_FORECAST: string = translationKey("Forecast {{amount}}");
export const MONTH_OVER_SHARE: string = translationKey("Over by {{amount}}");
export const MONTH_UNDER_SHARE: string = translationKey("{{amount}} under");
export const MONTH_ON_COURSE_OVER: string = translationKey(
  "On course to pass its share",
);
export const SAVE_FORECAST_AS_PLAN: string = translationKey(
  "Save Forecast as Plan",
);
export const PLAN_SAVED: string = translationKey(
  "Plan saved. Each month is now held to its forecast share.",
);
export const OPEN_FORECAST: string = translationKey("Open Forecast");

// The Forecast page.
export const FORECAST_TITLE: string = translationKey("Forecast");
export const FORECAST_DESCRIPTION: string = translationKey(
  "What your cloud spend is on course to cost in the months ahead, and how that is worked out.",
);
export const FORECAST_FOR: string = translationKey("Forecast for");
export const FORECAST_PICK_FIRST: string = translationKey(
  "Choose what to forecast.",
);
export const FORECAST_EVERYTHING: string = translationKey("Everything");
export const FORECAST_AN_ACCOUNT: string = translationKey("An account");
export const FORECAST_A_COST_GROUP: string = translationKey("A cost group");
export const FORECAST_A_SERVICE: string = translationKey("A service");
export const PICK_SERVICE: string = translationKey("Choose a service");
export const NEXT_12_MONTHS: string = translationKey("Next 12 Months");
export const NEXT_MONTH: string = translationKey("Next Month");
export const SPENT_SO_FAR: string = translationKey("{{amount}} so far");
export const TREND_TILE: string = translationKey("Trend");
export const TREND_PER_MONTH: string = translationKey("{{amount}} a month");
export const LIKELY_RANGE: string = translationKey("Likely range");
export const RANGE_OF: string = translationKey("{{low}} to {{high}}");
export const NO_RANGE: string = translationKey("No range: too little history");
export const MADE_FROM_MONTHS: PluralTemplate = {
  one: "Made from {{count}} full month",
  other: "Made from {{count}} full months",
};
export const HOW_MADE_TITLE: string = translationKey(
  "How This Forecast Is Made",
);
export const BY_MONTH_TITLE: string = translationKey("By Month");
export const BY_MONTH_DESCRIPTION: string = translationKey(
  "The months behind the forecast as they cost, this month on course, and each month ahead with its likely range.",
);
export const WHAT_IF_TITLE: string = translationKey("What If");
// One sentence, its two values the percent typed and the month picked.
export const WHAT_IF_SENTENCE: string = translationKey(
  "Every month from {{month}} on grows by {{percent}}%",
);
export const WHAT_IF_MONTH: string = translationKey("First month that grows");
export const WHAT_IF_PERCENT: string = translationKey("Percent of growth");
export const WHAT_IF_CLEAR: string = translationKey("Clear What-If");
export const WHAT_IF_APPLIED: string = translationKey(
  "With {{percent}} from {{month}}",
);
export const SAVE_AS_BUDGET_PLAN: string = translationKey(
  "Save as Budget Plan",
);
export const SAVE_PLAN_DESCRIPTION: string = translationKey(
  "Make the next twelve months of this forecast a yearly budget's plan, each month held to its forecast share.",
);
export const SAVE_PLAN_NEW: string = translationKey("A new yearly budget");
export const SAVE_PLAN_EXISTING: string = translationKey(
  "An existing yearly budget",
);
export const SAVE_PLAN_BUDGET: string = translationKey("Budget to Plan");
export const SAVE_PLAN_NAME: string = translationKey("Budget Name");
export const SAVE_PLAN_CREATED: string = translationKey(
  "Budget saved with the forecast as its plan.",
);
export const FORECAST_SERIES_SPENT: string = translationKey("Spent");
export const FORECAST_SERIES_ON_COURSE: string = translationKey("On course");
export const FORECAST_SERIES_FORECAST: string = translationKey("Forecast");
export const FORECAST_NOTHING_YET: string = translationKey(
  "No costs read yet for what this forecast is of. A forecast starts once your cloud reports its first days.",
);

// The months, January first: what a fiscal year's first month is picked from.
const MONTH_NUMBERS: Array<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function monthFormat(
  translator: Translator,
  options: Intl.DateTimeFormatOptions,
): ReaderDateTimeFormat | null {
  return getDateTimeFormat({
    locale: getDateLocale(translator.language || "en"),
    timezones: ["UTC"],
    options,
  });
}

// A month of the year by its number, 1 to 12: "April", in the reader's language.
export function formatCalendarMonthName(
  monthNumber: number,
  translator: Translator,
  length: "long" | "short" = "long",
): string {
  const format: ReaderDateTimeFormat | null = monthFormat(translator, {
    month: length,
  });
  const date: Date = new Date(Date.UTC(2026, monthNumber - 1, 1));

  return format ? format.format(date) : String(monthNumber);
}

/*
 * A cost month, "2026-11", in the reader's language: "November 2026", or
 * "Nov 2026" short.
 */
export function formatCloudMonth(
  month: string,
  translator: Translator,
  length: "long" | "short" = "long",
): string {
  const [year, monthNumber] = month.split("-").map(Number);

  if (!year || !monthNumber) {
    return month;
  }

  const format: ReaderDateTimeFormat | null = monthFormat(translator, {
    month: length,
    year: "numeric",
  });

  return format
    ? format.format(new Date(Date.UTC(year, monthNumber - 1, 1)))
    : month;
}

// The twelve months a fiscal year can start in, in the reader's language.
export function getFiscalMonthOptions(
  translator: Translator,
): Array<DropdownOption> {
  return MONTH_NUMBERS.map((monthNumber: number): DropdownOption => {
    return {
      label: formatCalendarMonthName(monthNumber, translator),
      value: monthNumber,
    };
  });
}

/*
 * A plan's months in the fiscal year's order, by number: from April,
 * [4, 5, ..., 12, 1, 2, 3].
 */
export function getFiscalMonthNumbers(
  fiscalYearStartMonth: unknown,
): Array<number> {
  const start: number =
    readCloudBudgetFiscalYearStartMonth(fiscalYearStartMonth);

  return MONTH_NUMBERS.map((index: number): number => {
    return ((start - 1 + index - 1) % 12) + 1;
  });
}

/*
 * A budget's period in a few words, in the reader's language: "Monthly",
 * "Quarterly from April", "Yearly from April, by month".
 */
export function getCloudBudgetPeriodLine(data: {
  period: unknown;
  fiscalYearStartMonth: unknown;
  planSplit: unknown;
  translator: Translator;
  labels: Readonly<Record<CloudBudgetPeriod, string>>;
}): string {
  const period: CloudBudgetPeriod = readCloudBudgetPeriod(data.period);
  const periodWord: string =
    data.translator.translateText(data.labels[period]) || data.labels[period];
  const isSplit: boolean =
    period === CloudBudgetPeriod.Year &&
    readCloudBudgetPlanSplit(data.planSplit) !== CloudBudgetPlanSplit.None;
  const fiscalStart: number = readCloudBudgetFiscalYearStartMonth(
    data.fiscalYearStartMonth,
  );
  const namesMonth: boolean =
    period !== CloudBudgetPeriod.Month && fiscalStart !== 1;

  if (!namesMonth) {
    return isSplit
      ? data.translator.translateTemplate(PERIOD_BY_MONTH, {
          period: periodWord,
        })
      : periodWord;
  }

  const month: string = formatCalendarMonthName(fiscalStart, data.translator);

  return data.translator.translateTemplate(
    isSplit ? PERIOD_FROM_MONTH_BY_MONTH : PERIOD_FROM_MONTH,
    { period: periodWord, month },
  );
}
