import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CloudBudgetRowFigures,
  CloudBudgetStatus,
  CloudBudgetTone,
  getCloudBudgetRowFigures,
  getCloudBudgetStatus,
} from "../../Components/Cloud/CloudBudgetStatus";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import {
  CloudCostBasisChoice,
  useCloudCostBasis,
} from "../../Components/Cloud/CloudCostBasis";
import {
  ALERT_AT_NOT_PERCENTS,
  CLOUD_BUDGET_FORM_STEPS,
  getAlertAtProblem,
  getCloudBudgetCreateInitialValues,
  getCloudBudgetFormFields,
} from "../../Components/Cloud/Budgets/CloudBudgetForm";
import CloudBudgetScopeCell from "../../Components/Cloud/Budgets/CloudBudgetScopeCell";
import {
  ALL_ACCOUNTS_LABEL,
  APPLIES_TO_TITLE,
  BUDGETS_PERIOD_COLUMN,
  BUDGETS_THIS_PERIOD_COLUMN,
  THIS_MONTH_OF_SHARE,
  THIS_YEAR_OF_AMOUNT,
  getCloudBudgetPeriodLine,
} from "../../Components/Cloud/Budgets/CloudBudgetWords";
import useCloudBudgetFormContext, {
  CloudBudgetFormContext,
} from "../../Components/Cloud/Budgets/UseCloudBudgetFormContext";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import {
  CLOUD_BUDGET_PERIOD_LABELS,
  CLOUD_BUDGET_PERIODS,
  CloudBudgetPeriod,
} from "Common/Types/Cloud/CloudBudget";
import {
  CLOUD_COST_BASIS_LABELS,
  resolveCloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";

/*
 * Cloud > Budgets (#11008): what a month, a quarter or a year may cost -
 * for every account, one account, a cost group, or a filter of services,
 * Regions and tags - and who hears as its spend passes each threshold:
 * below 100% the people it names are told and nobody is paged; at 100%,
 * and when the period is on course to pass it, an alert pages its on-call
 * policies. Each budget is checked after every read of the costs and every
 * hour (CloudBudgetEvaluator); its row says what it counts, its period,
 * what the period has cost so far against it, where it is heading and how
 * it is doing - a yearly budget split by month, this month against its
 * share. A row opens the budget's own page.
 */

export const BUDGETS_TITLE: string = translationKey("Budgets");
export const BUDGETS_DESCRIPTION: string = translationKey(
  "What a month, quarter or year may cost: for every account, one, a cost group, or services and tags. Its people hear at each threshold, and it alerts when spent.",
);
export const BUDGETS_EMPTY: string = translationKey(
  "No budgets yet. Create one to be told before a month, a quarter or a year costs more than it should.",
);
export const ALL_ACCOUNTS: string = ALL_ACCOUNTS_LABEL;
export const SPENT_OF_BUDGET: string = translationKey(
  "{{spent}} of {{amount}}",
);
export const ON_COURSE_FOR_AMOUNT: string = translationKey(
  "On course for {{amount}}",
);

export { ALERT_AT_NOT_PERCENTS, getAlertAtProblem };

export const CLOUD_BUDGET_TONE_COLORS: Readonly<
  Record<CloudBudgetTone, Color>
> = {
  danger: Red,
  warning: Yellow,
  positive: Green,
  neutral: Gray500,
};

const BAR_CLASS_NAMES: Readonly<Record<CloudBudgetTone, string>> = {
  danger: "bg-red-500",
  warning: "bg-amber-500",
  positive: "bg-emerald-500",
  neutral: "bg-gray-300",
};

// A budget's row figures, from what the server last worked out for it.
export function getBudgetRowFigures(
  item: CloudBudget,
  now: Date,
): CloudBudgetRowFigures {
  return getCloudBudgetRowFigures({
    period: item.period,
    fiscalYearStartMonth: item.fiscalYearStartMonth,
    monthlyAmount: item.monthlyAmount,
    planSplit: item.planSplit,
    monthlyPlan: item.monthlyPlan,
    spentThisMonth: item.spentThisMonth,
    projectedThisMonth: item.projectedThisMonth,
    spentThisPeriod: item.spentThisPeriod,
    projectedThisPeriod: item.projectedThisPeriod,
    now,
  });
}

// How a budget is doing, as its row says it: its window's figures.
export function getBudgetRowStatus(
  item: CloudBudget,
  figures: CloudBudgetRowFigures,
): CloudBudgetStatus {
  return getCloudBudgetStatus({
    isEnabled: item.isEnabled !== false,
    amount: figures.amount,
    spent: figures.spent,
    projected: figures.projected,
    thresholds: item.alertThresholds,
    lastCheckedAt: item.lastCheckedAt,
  });
}

const CloudBudgets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const context: CloudBudgetFormContext = useCloudBudgetFormContext();
  // The project's cost basis: what a budget with none of its own watches.
  const basisChoice: CloudCostBasisChoice = useCloudCostBasis();
  // A new budget is in the currency most accounts are billed in.
  const currency: string = context.currency;
  const now: Date = OneUptimeDate.getCurrentDate();

  /*
   * A budget's figures: its amount as it was set ("$500", not "$500.00"),
   * nothing spent as "$0", any other spend to the cent.
   */
  const money: (
    amount: number,
    budgetCurrency: string | undefined,
  ) => string = (
    amount: number,
    budgetCurrency: string | undefined,
  ): string => {
    return formatCloudMoney({
      amount,
      currency: budgetCurrency || currency,
      translator,
      wholeWhenRound: true,
    });
  };

  return (
    <ModelTable<CloudBudget>
      modelType={CloudBudget}
      id="cloud-budgets-table"
      userPreferencesKey="cloud-budgets-table"
      name="Cloud > Budgets"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={true}
      onViewPage={async (item: CloudBudget): Promise<Route> => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_BUDGET_VIEW] as Route,
          { modelId: item.id! },
        );
      }}
      showRefreshButton={true}
      rowSwitch={{ column: "isEnabled" }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: BUDGETS_TITLE,
        description: BUDGETS_DESCRIPTION,
      }}
      noItemsMessage={BUDGETS_EMPTY}
      createInitialValues={getCloudBudgetCreateInitialValues(currency)}
      selectMoreFields={{
        currency: true,
        description: true,
        isEnabled: true,
        alertThresholds: true,
        scope: true,
        filterRules: true,
        cloudCostGroupId: true,
        cloudCostGroup: { name: true, cloudCostViewId: true },
        period: true,
        fiscalYearStartMonth: true,
        planSplit: true,
        monthlyPlan: true,
        spentThisMonth: true,
        projectedThisMonth: true,
        spentThisPeriod: true,
        projectedThisPeriod: true,
        lastCheckedAt: true,
        cloudAccountId: true,
        costBasis: true,
      }}
      filters={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { period: true },
          title: BUDGETS_PERIOD_COLUMN,
          type: FieldType.Dropdown,
          filterDropdownOptions: CLOUD_BUDGET_PERIODS.map(
            (period: CloudBudgetPeriod) => {
              return {
                label: CLOUD_BUDGET_PERIOD_LABELS[period],
                value: period,
              };
            },
          ),
        },
        {
          field: { cloudAccount: { name: true } },
          title: "Account",
          type: FieldType.Entity,
          filterEntityType: CloudAccount,
          filterDropdownField: { label: "name", value: "_id" },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          // Each of its lines already reads its own way.
          getLineText: drawsItsOwnLines,
          getElement: (item: CloudBudget): ReactElement => {
            /*
             * The team's own words, each in its own direction (bdi): an
             * English description on a Persian page keeps its full stop at
             * its end, where the page's words start.
             */
            return (
              <div className="min-w-0">
                <div className="break-words text-sm font-medium text-gray-900">
                  <bdi>{item.name}</bdi>
                </div>
                {item.description ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                    <bdi>{item.description}</bdi>
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { cloudAccount: { name: true } },
          title: APPLIES_TO_TITLE,
          type: FieldType.Element,
          hideOnMobile: true,
          disableSort: true,
          getElement: (item: CloudBudget): ReactElement => {
            return (
              <CloudBudgetScopeCell
                budget={item}
                ruleNames={context.ruleContext.names}
              />
            );
          },
        },
        {
          field: { period: true },
          title: BUDGETS_PERIOD_COLUMN,
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudBudget): ReactElement => {
            return (
              <span
                className="text-sm text-gray-700"
                data-testid="cloud-budget-period"
              >
                {getCloudBudgetPeriodLine({
                  period: item.period,
                  fiscalYearStartMonth: item.fiscalYearStartMonth,
                  planSplit: item.planSplit,
                  translator,
                  labels: CLOUD_BUDGET_PERIOD_LABELS,
                })}
              </span>
            );
          },
        },
        {
          field: { monthlyAmount: true },
          title: BUDGETS_THIS_PERIOD_COLUMN,
          type: FieldType.Element,
          getElement: (item: CloudBudget): ReactElement => {
            const figures: CloudBudgetRowFigures = getBudgetRowFigures(
              item,
              now,
            );
            const status: CloudBudgetStatus = getBudgetRowStatus(item, figures);
            const values: { spent: string; amount: string } = {
              spent: money(figures.spent, item.currency),
              amount: money(figures.amount, item.currency),
            };

            return (
              <div className="min-w-[10rem]" data-testid="cloud-budget-month">
                <div className="text-sm text-gray-900">
                  {figures.isPlanMonth
                    ? translator.translateTemplate(THIS_MONTH_OF_SHARE, values)
                    : translator.translateTemplate(SPENT_OF_BUDGET, values)}
                </div>
                <div
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                  role="presentation"
                >
                  <div
                    className={`h-full rounded-full ${BAR_CLASS_NAMES[status.tone]}`}
                    style={{
                      width: `${Math.min(100, Math.max(0, status.percentSpent))}%`,
                    }}
                  />
                </div>
                {/*
                 * Where the window is heading, once it has been checked. A
                 * paused budget is not checked: what it last said is old.
                 */}
                {item.lastCheckedAt && item.isEnabled !== false ? (
                  <div className="mt-1 text-xs text-gray-500">
                    {translator.translateTemplate(ON_COURSE_FOR_AMOUNT, {
                      amount: money(figures.projected, item.currency),
                    })}
                  </div>
                ) : (
                  <></>
                )}
                {figures.isPlanMonth && item.lastCheckedAt ? (
                  <div
                    className="mt-0.5 text-xs text-gray-500"
                    data-testid="cloud-budget-year-line"
                  >
                    {translator.translateTemplate(THIS_YEAR_OF_AMOUNT, {
                      spent: money(figures.periodSpent, item.currency),
                      amount: money(figures.periodAmount, item.currency),
                    })}
                  </div>
                ) : (
                  <></>
                )}
                {/*
                 * Which cost the figures are: the budget's own basis, else
                 * the project's - a budget never reads as billed when it
                 * watches amortized spend.
                 */}
                <div
                  className="mt-1 text-xs text-gray-500"
                  data-testid="cloud-budget-basis"
                  data-basis={resolveCloudCostBasis(
                    item.costBasis,
                    basisChoice.projectBasis,
                  )}
                >
                  {translator.translateText(
                    CLOUD_COST_BASIS_LABELS[
                      resolveCloudCostBasis(
                        item.costBasis,
                        basisChoice.projectBasis,
                      )
                    ],
                  )}
                </div>
              </div>
            );
          },
        },
        {
          field: { lastCheckedAt: true },
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getElement: (item: CloudBudget): ReactElement => {
            const status: CloudBudgetStatus = getBudgetRowStatus(
              item,
              getBudgetRowFigures(item, now),
            );

            return (
              <span data-testid="cloud-budget-status" data-tone={status.tone}>
                <Pill
                  // Worded here either way: drawn as given (#8067).
                  text={
                    status.threshold !== undefined
                      ? translator.translateTemplate(status.label, {
                          percent: `${translator.formatNumber(status.threshold)}%`,
                        })
                      : translator.translateText(status.label) || status.label
                  }
                  isUserContent={true}
                  color={CLOUD_BUDGET_TONE_COLORS[status.tone]}
                />
              </span>
            );
          },
        },
      ]}
      /*
       * Four steps of what most people set: what the budget counts, what it
       * may cost and for how long, when it tells someone, and who hears
       * (CloudBudgetForm). The rest folds under More fields.
       */
      formSteps={CLOUD_BUDGET_FORM_STEPS}
      formFields={getCloudBudgetFormFields({ context, translator })}
    />
  );
};

export default CloudBudgets;
