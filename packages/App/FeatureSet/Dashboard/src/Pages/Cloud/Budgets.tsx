import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../../Components/AppLink/AppLink";
import {
  CloudBudgetStatus,
  CloudBudgetTone,
  getCloudBudgetStatus,
} from "../../Components/Cloud/CloudBudgetStatus";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import {
  CLOUD_BUDGET_DEFAULT_THRESHOLDS,
  isCloudBudgetThresholdsText,
} from "Common/Types/Cloud/CloudCost";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Cloud > Budgets: what a month may cost - for one account or every one -
 * and an alert as its spend passes each threshold (80% and 100% unless
 * told otherwise), and one when the month is on course to pass it, before
 * it does. Each budget is checked after every read of the costs and every
 * hour (CloudBudgetEvaluator); its row says what the month has cost so far
 * against it, where it is heading, and how it is doing.
 */

export const BUDGETS_TITLE: string = translationKey("Budgets");
export const BUDGETS_DESCRIPTION: string = translationKey(
  "What a month may cost, for one account or all of them. OneUptime alerts as the month's spend passes each threshold, when the month is on course to pass the budget, and on a day that costs far more than usual.",
);
export const BUDGETS_EMPTY: string = translationKey(
  "No budgets yet. Create one to be alerted before a month costs more than it should.",
);
export const ALL_ACCOUNTS: string = translationKey("All accounts");
export const SPENT_OF_BUDGET: string = translationKey(
  "{{spent}} of {{amount}}",
);
export const ON_COURSE_FOR_AMOUNT: string = translationKey(
  "On course for {{amount}}",
);
/*
 * Alert At that is not a list of percents: said before it is saved, rather
 * than the budget quietly alerting at 80% and 100% instead.
 */
export const ALERT_AT_NOT_PERCENTS: string = translationKey(
  "Write each as a percent of the budget from 1 to 1000, such as 80, 100.",
);

// Alert At's problem as the form shows it, or null when it reads.
export function getAlertAtProblem(
  value: unknown,
  translator: Translator,
): string | null {
  if (typeof value === "string" && isCloudBudgetThresholdsText(value)) {
    return null;
  }

  return (
    translator.translateText(ALERT_AT_NOT_PERCENTS) || ALERT_AT_NOT_PERCENTS
  );
}

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

const CloudBudgets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const read: CloudAccountsRead = useCloudAccounts();
  // A new budget is in the currency most accounts are billed in.
  const currency: string = read.totals.costs.currency;
  const moreFields: FormFieldCollapsibleSection<CloudBudget> =
    getAdvancedFormSection<CloudBudget>();

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
      isViewable={false}
      showRefreshButton={true}
      rowSwitch={{ column: "isEnabled" }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: BUDGETS_TITLE,
        description: BUDGETS_DESCRIPTION,
      }}
      noItemsMessage={BUDGETS_EMPTY}
      createInitialValues={{
        currency,
        alertThresholds: CLOUD_BUDGET_DEFAULT_THRESHOLDS.join(","),
        alertOnProjection: true,
        alertOnAnomaly: true,
        isEnabled: true,
      }}
      selectMoreFields={{
        currency: true,
        description: true,
        isEnabled: true,
        alertThresholds: true,
        spentThisMonth: true,
        projectedThisMonth: true,
        lastCheckedAt: true,
        cloudAccountId: true,
      }}
      filters={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
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
          title: "Applies To",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: CloudBudget): ReactElement => {
            if (!item.cloudAccountId) {
              return (
                <span className="text-sm text-gray-700">
                  {translator.translateText(ALL_ACCOUNTS)}
                </span>
              );
            }

            return (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                  { modelId: new ObjectID(item.cloudAccountId.toString()) },
                )}
                className="break-words text-sm text-gray-900 hover:underline"
              >
                {item.cloudAccount?.name || ""}
              </AppLink>
            );
          },
        },
        {
          field: { monthlyAmount: true },
          title: "This Month",
          type: FieldType.Element,
          getElement: (item: CloudBudget): ReactElement => {
            const status: CloudBudgetStatus = getCloudBudgetStatus({
              isEnabled: item.isEnabled !== false,
              amount: Number(item.monthlyAmount) || 0,
              spent: item.spentThisMonth,
              projected: item.projectedThisMonth,
              thresholds: item.alertThresholds,
              lastCheckedAt: item.lastCheckedAt,
            });

            return (
              <div className="min-w-[10rem]" data-testid="cloud-budget-month">
                <div className="text-sm text-gray-900">
                  {translator.translateTemplate(SPENT_OF_BUDGET, {
                    spent: money(
                      Number(item.spentThisMonth) || 0,
                      item.currency,
                    ),
                    amount: money(
                      Number(item.monthlyAmount) || 0,
                      item.currency,
                    ),
                  })}
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
                 * Where the month is heading, once it has been checked. A
                 * paused budget is not checked: what it last said is old.
                 */}
                {item.lastCheckedAt && item.isEnabled !== false ? (
                  <div className="mt-1 text-xs text-gray-500">
                    {translator.translateTemplate(ON_COURSE_FOR_AMOUNT, {
                      amount: money(
                        Number(item.projectedThisMonth) || 0,
                        item.currency,
                      ),
                    })}
                  </div>
                ) : (
                  <></>
                )}
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
            const status: CloudBudgetStatus = getCloudBudgetStatus({
              isEnabled: item.isEnabled !== false,
              amount: Number(item.monthlyAmount) || 0,
              spent: item.spentThisMonth,
              projected: item.projectedThisMonth,
              thresholds: item.alertThresholds,
              lastCheckedAt: item.lastCheckedAt,
            });

            return (
              <span data-testid="cloud-budget-status" data-tone={status.tone}>
                <Pill
                  text={
                    status.threshold !== undefined
                      ? translator.translateTemplate(status.label, {
                          percent: `${translator.formatNumber(status.threshold)}%`,
                        })
                      : status.label
                  }
                  color={CLOUD_BUDGET_TONE_COLORS[status.tone]}
                />
              </span>
            );
          },
        },
      ]}
      /*
       * Two steps: what the budget is (its name, what a month may cost and
       * for which account) and when it alerts. The currency and a
       * description wait under More fields.
       */
      formSteps={[
        { title: "Budget", id: "budget" },
        { title: "Alerts", id: "alerts" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "budget",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Production",
          validation: { minLength: 2 },
        },
        {
          field: { monthlyAmount: true },
          title: "Monthly Amount",
          stepId: "budget",
          fieldType: FormFieldSchemaType.PositiveNumber,
          required: true,
          placeholder: "5000",
          description:
            "What a calendar month may cost, before credits and refunds.",
        },
        {
          field: { cloudAccount: true },
          title: "Account",
          stepId: "budget",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: CloudAccount,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "All accounts",
          description: "Leave empty for a budget over every account.",
        },
        {
          field: { currency: true },
          title: "Currency",
          stepId: "budget",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "USD",
          description:
            "The currency your accounts are billed in, as three letters: USD, EUR, GBP. Only accounts billed in it count toward the budget.",
          validation: { minLength: 3, maxLength: 3 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "budget",
          collapsibleSection: moreFields,
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this budget is for.",
        },
        {
          field: { alertThresholds: true },
          title: "Alert At",
          stepId: "alerts",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "80,100",
          description:
            "The shares of the budget to alert at, in percent, separated by commas: an alert as the month's spend passes each.",
          customValidation: (
            values: FormValues<CloudBudget>,
          ): string | null => {
            return getAlertAtProblem(values.alertThresholds, translator);
          },
        },
        {
          field: { alertOnProjection: true },
          title: "Alert When On Course To Pass",
          stepId: "alerts",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
          description:
            "Also alert, once a month, when the month is on course to cost more than the budget at the last week's pace - before it does.",
        },
        {
          field: { alertOnAnomaly: true },
          title: "Alert On Unusual Days",
          stepId: "alerts",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
          description:
            "Also alert, the next day, when a day costs far more than usual: a service at twice its usual day, or an account at one and a half times.",
        },
        {
          field: { alertSeverity: true },
          title: "Alert Severity",
          stepId: "alerts",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: AlertSeverity,
            labelField: "name",
            valueField: "_id",
            sort: { order: SortOrder.Ascending },
          },
          required: false,
          placeholder: "The project's least severe",
          description:
            "How severe the budget's alerts are. Leave empty for the project's least severe.",
        },
        {
          field: { onCallDutyPolicies: true },
          title: "On-Call Policies",
          stepId: "alerts",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: OnCallDutyPolicy,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select On-Call Policies",
          description: "Who is paged when the budget alerts.",
        },
      ]}
    />
  );
};

export default CloudBudgets;
