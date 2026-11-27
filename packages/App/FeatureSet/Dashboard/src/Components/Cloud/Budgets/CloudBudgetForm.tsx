import {
  ALERT_AT_DESCRIPTION,
  AMOUNT_DESCRIPTION,
  AMOUNT_TITLE,
  APPLIES_TO_DESCRIPTION,
  APPLIES_TO_TITLE,
  FISCAL_START_DESCRIPTION,
  FISCAL_START_TITLE,
  MONTHLY_PLAN_DESCRIPTION,
  MONTHLY_PLAN_TITLE,
  NOTIFY_DESCRIPTION,
  NOTIFY_GROUP_TEAM_DESCRIPTION,
  NOTIFY_GROUP_TEAM_TITLE,
  NOTIFY_TITLE,
  ON_CALL_DESCRIPTION,
  ON_COURSE_DESCRIPTION,
  PERIOD_DESCRIPTION,
  PERIOD_TITLE,
  PLAN_DESCRIPTION,
  PLAN_NEEDS_A_MONTH,
  PLAN_TITLE,
  STEP_ALERTS,
  STEP_AMOUNT,
  STEP_BUDGET,
  STEP_WHO_HEARS,
  UNUSUAL_DAYS_DESCRIPTION,
  UNUSUAL_THRESHOLD_DESCRIPTION,
  UNUSUAL_THRESHOLD_TITLE,
  UNUSUAL_UNIT_DESCRIPTION,
  UNUSUAL_UNIT_TITLE,
  getFiscalMonthOptions,
} from "./CloudBudgetWords";
import CloudBudgetMonthlyPlanEditor, {
  toCloudBudgetPlanAmounts,
} from "./CloudBudgetMonthlyPlanEditor";
import CloudBudgetScopeTarget, {
  ACCOUNT_LABEL,
  COST_GROUP_LABEL,
  CloudBudgetScopeTargetValue,
  FILTER_LABEL,
  getCloudBudgetScopeTargetProblem,
} from "./CloudBudgetScopeTarget";
import { CloudBudgetFormContext } from "./UseCloudBudgetFormContext";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CLOUD_BUDGET_PERIODS,
  CLOUD_BUDGET_PERIOD_LABELS,
  CLOUD_BUDGET_PLAN_SPLITS,
  CLOUD_BUDGET_PLAN_SPLIT_LABELS,
  CLOUD_BUDGET_SCOPES,
  CLOUD_BUDGET_SCOPE_LABELS,
  CLOUD_BUDGET_UNUSUAL_DAY_UNITS,
  CLOUD_BUDGET_UNUSUAL_DAY_UNIT_LABELS,
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
  CloudBudgetUnusualDayUnit,
  readCloudBudgetPeriod,
  readCloudBudgetPlanSplit,
  readCloudBudgetScope,
  sumCloudBudgetPlan,
} from "Common/Types/Cloud/CloudBudget";
import {
  CLOUD_COST_BASES,
  CLOUD_COST_BASIS_LABELS,
  CloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import { CloudCostRule } from "Common/Types/Cloud/CloudCostRules";
import {
  CLOUD_BUDGET_DEFAULT_THRESHOLDS,
  isCloudBudgetThresholdsText,
} from "Common/Types/Cloud/CloudCost";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";

/*
 * A CLOUD BUDGET'S FORM (#11008), in four steps of what most people set:
 *
 *   Budget     its name, and what it counts: every account, one account, a
 *              cost group or a filter of services, Regions and tags - the
 *              pick a scope needs drawn under it. Currency, cost basis and
 *              a description fold under More fields;
 *   Amount     a month, a quarter or a year, from the fiscal year's first
 *              month, and what it may cost - or, a yearly budget, twelve
 *              equal months or one amount for each;
 *   Alerts     the thresholds, on course to pass, and unusual days, with
 *              the budget's own unusual day and the severity folded away;
 *   Who Hears  the people and teams told below 100% with no alert, the cost
 *              group's team, and the on-call policies paged from 100%.
 *
 * The pick a scope needs is one field (CloudBudgetScopeTarget) that writes
 * the budget's columns: cloudAccountId, cloudCostGroupId and filterRules,
 * each a field that is never drawn, so the form reads and sends them.
 * Every check the form makes the server makes too (CloudBudgetService).
 */

export const CLOUD_BUDGET_FORM_STEPS: Array<FormStep<CloudBudget>> = [
  { title: STEP_BUDGET, id: "budget" },
  { title: STEP_AMOUNT, id: "amount" },
  { title: STEP_ALERTS, id: "alerts" },
  { title: STEP_WHO_HEARS, id: "people" },
];

/*
 * Alert At that is not a list of percents: said before it is saved, rather
 * than the budget quietly alerting at 80% and 100% instead.
 */
export const ALERT_AT_NOT_PERCENTS: string = translationKey(
  "Write each as a percent of the budget from 1 to 1000, such as 80, 100.",
);

// The form field the pick a scope needs is kept by: no column of its own.
export const SCOPE_TARGET_FIELD_KEY: string = "scopeTarget";
// The form field the people to notify are picked in: no column of its own.
export const NOTIFY_FIELD_KEY: string = "notify";

// What a new budget starts with, as a budget made through the API does.
export function getCloudBudgetCreateInitialValues(
  currency: string,
): FormValues<CloudBudget> {
  return {
    currency,
    scope: CloudBudgetScope.AllAccounts,
    period: CloudBudgetPeriod.Month,
    fiscalYearStartMonth: 1,
    planSplit: CloudBudgetPlanSplit.None,
    alertThresholds: CLOUD_BUDGET_DEFAULT_THRESHOLDS.join(","),
    alertOnProjection: true,
    alertOnAnomaly: true,
    notifyCostGroupTeam: true,
    isEnabled: true,
  } as FormValues<CloudBudget>;
}

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

function readValues(values: FormValues<CloudBudget>): Record<string, unknown> {
  return values as Record<string, unknown>;
}

// The scope the form holds now.
export function getFormScope(
  values: FormValues<CloudBudget>,
): CloudBudgetScope {
  const data: Record<string, unknown> = readValues(values);

  return readCloudBudgetScope({
    scope: data["scope"],
    cloudAccountId: undefined,
  });
}

// Whether the form holds a yearly budget split into amounts for each month.
export function isFormPlanByMonth(values: FormValues<CloudBudget>): boolean {
  const data: Record<string, unknown> = readValues(values);

  return (
    readCloudBudgetPeriod(data["period"]) === CloudBudgetPeriod.Year &&
    readCloudBudgetPlanSplit(data["planSplit"]) === CloudBudgetPlanSplit.ByMonth
  );
}

// The pick the form holds for its scope, from the budget's columns.
export function getFormScopeTarget(
  values: FormValues<CloudBudget>,
): CloudBudgetScopeTargetValue {
  const data: Record<string, unknown> = readValues(values);
  const id: (value: unknown) => string | null = (
    value: unknown,
  ): string | null => {
    if (!value) {
      return null;
    }

    if (typeof value === "object" && value !== null) {
      const record: Record<string, unknown> = value as Record<string, unknown>;
      return record["_id"] ? String(record["_id"]) : String(value);
    }

    return String(value);
  };

  return {
    cloudAccountId: id(data["cloudAccountId"]),
    cloudCostGroupId: id(data["cloudCostGroupId"]),
    filterRules: Array.isArray(data["filterRules"])
      ? (data["filterRules"] as Array<CloudCostRule>)
      : null,
  };
}

function options<T extends string>(
  values: ReadonlyArray<T>,
  labels: Readonly<Record<T, string>>,
): Array<DropdownOption> {
  return values.map((value: T): DropdownOption => {
    return { label: labels[value], value };
  });
}

export function getCloudBudgetFormFields(data: {
  context: CloudBudgetFormContext;
  translator: Translator;
}): Array<ModelField<CloudBudget>> {
  const budgetMore: FormFieldCollapsibleSection<CloudBudget> =
    getAdvancedFormSection<CloudBudget>({ id: "cloud-budget-more-fields" });
  const alertsMore: FormFieldCollapsibleSection<CloudBudget> =
    getAdvancedFormSection<CloudBudget>({
      id: "cloud-budget-alerts-more-fields",
    });
  const isFormScope: (
    values: FormValues<CloudBudget>,
    scope: CloudBudgetScope,
  ) => boolean = (
    values: FormValues<CloudBudget>,
    scope: CloudBudgetScope,
  ): boolean => {
    return getFormScope(values) === scope;
  };

  return [
    {
      field: { name: true },
      title: "Name",
      stepId: "budget",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Payments",
      validation: { minLength: 2 },
    },
    {
      field: { scope: true },
      title: APPLIES_TO_TITLE,
      stepId: "budget",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: options(CLOUD_BUDGET_SCOPES, CLOUD_BUDGET_SCOPE_LABELS),
      required: true,
      defaultValue: CloudBudgetScope.AllAccounts,
      description: APPLIES_TO_DESCRIPTION,
    },
    {
      // The pick its scope needs: written into the never-drawn columns below.
      overrideField: { scope: true },
      overrideFieldKey: SCOPE_TARGET_FIELD_KEY,
      formOnly: true,
      title: APPLIES_TO_TITLE,
      stepId: "budget",
      fieldType: FormFieldSchemaType.CustomComponent,
      customElementDrawsOwnLabel: true,
      required: false,
      showIf: (values: FormValues<CloudBudget>): boolean => {
        return !isFormScope(values, CloudBudgetScope.AllAccounts);
      },
      getCustomElement: (
        values: FormValues<CloudBudget>,
        elementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <CloudBudgetScopeTarget
            scope={getFormScope(values)}
            value={getFormScopeTarget(values)}
            onChange={(value: CloudBudgetScopeTargetValue) => {
              elementProps.onChange?.(value);
            }}
            accounts={data.context.accounts}
            costGroups={data.context.costGroups}
            ruleNames={data.context.ruleContext.names}
            ruleOptions={data.context.ruleContext.options}
            showProblem={Boolean(elementProps.error)}
          />
        );
      },
      onChange: (
        value: unknown,
        currentValues: FormValues<CloudBudget>,
        setFormValues: (values: FormValues<CloudBudget>) => void,
      ): void => {
        const picked: CloudBudgetScopeTargetValue =
          value && typeof value === "object"
            ? (value as CloudBudgetScopeTargetValue)
            : {
                cloudAccountId: null,
                cloudCostGroupId: null,
                filterRules: null,
              };

        setFormValues({
          ...currentValues,
          cloudAccountId: picked.cloudAccountId,
          cloudCostGroupId: picked.cloudCostGroupId,
          filterRules: picked.filterRules,
        } as unknown as FormValues<CloudBudget>);
      },
      customValidation: (values: FormValues<CloudBudget>): string | null => {
        const problem: string | null = getCloudBudgetScopeTargetProblem({
          scope: getFormScope(values),
          value: getFormScopeTarget(values),
        });

        return problem
          ? data.translator.translateText(problem) || problem
          : null;
      },
    },
    /*
     * The three columns the pick writes: never drawn, here so that the form
     * reads them and sends what was picked.
     */
    {
      field: { cloudAccountId: true },
      title: ACCOUNT_LABEL,
      stepId: "budget",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      hideColumnDescription: true,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: { cloudCostGroupId: true },
      title: COST_GROUP_LABEL,
      stepId: "budget",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      hideColumnDescription: true,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: { filterRules: true },
      title: FILTER_LABEL,
      stepId: "budget",
      fieldType: FormFieldSchemaType.JSON,
      required: false,
      hideColumnDescription: true,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: { currency: true },
      title: "Currency",
      stepId: "budget",
      collapsibleSection: budgetMore,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "USD",
      description:
        "The currency your accounts are billed in, as three letters: USD, EUR, GBP. Only costs billed in it count toward the budget.",
      validation: { minLength: 3, maxLength: 3 },
    },
    {
      field: { costBasis: true },
      title: "Cost Basis",
      stepId: "budget",
      collapsibleSection: budgetMore,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: CLOUD_COST_BASES.map((basis: CloudCostBasis) => {
        return { label: CLOUD_COST_BASIS_LABELS[basis], value: basis };
      }),
      required: false,
      placeholder: "The project's cost basis",
      description:
        "The cost the budget watches: billed, amortized or net. Leave empty to follow the project's, set in Cloud settings.",
    },
    {
      field: { description: true },
      title: "Description",
      stepId: "budget",
      collapsibleSection: budgetMore,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "What this budget is for.",
    },
    {
      field: { period: true },
      title: PERIOD_TITLE,
      stepId: "amount",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: options(
        CLOUD_BUDGET_PERIODS,
        CLOUD_BUDGET_PERIOD_LABELS,
      ),
      required: true,
      defaultValue: CloudBudgetPeriod.Month,
      description: PERIOD_DESCRIPTION,
    },
    {
      field: { monthlyAmount: true },
      title: AMOUNT_TITLE,
      stepId: "amount",
      fieldType: FormFieldSchemaType.PositiveNumber,
      required: true,
      placeholder: "5000",
      description: AMOUNT_DESCRIPTION,
      // A plan by month's amount is its twelve months' total.
      showIf: (values: FormValues<CloudBudget>): boolean => {
        return !isFormPlanByMonth(values);
      },
    },
    {
      field: { fiscalYearStartMonth: true },
      title: FISCAL_START_TITLE,
      stepId: "amount",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getFiscalMonthOptions(data.translator),
      required: false,
      defaultValue: 1,
      description: FISCAL_START_DESCRIPTION,
      showIf: (values: FormValues<CloudBudget>): boolean => {
        return (
          readCloudBudgetPeriod(readValues(values)["period"]) !==
          CloudBudgetPeriod.Month
        );
      },
    },
    {
      field: { planSplit: true },
      title: PLAN_TITLE,
      stepId: "amount",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: options(
        CLOUD_BUDGET_PLAN_SPLITS,
        CLOUD_BUDGET_PLAN_SPLIT_LABELS,
      ),
      required: false,
      defaultValue: CloudBudgetPlanSplit.None,
      description: PLAN_DESCRIPTION,
      showIf: (values: FormValues<CloudBudget>): boolean => {
        return (
          readCloudBudgetPeriod(readValues(values)["period"]) ===
          CloudBudgetPeriod.Year
        );
      },
    },
    {
      field: { monthlyPlan: true },
      title: MONTHLY_PLAN_TITLE,
      stepId: "amount",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      description: MONTHLY_PLAN_DESCRIPTION,
      showIf: isFormPlanByMonth,
      getCustomElement: (
        values: FormValues<CloudBudget>,
        elementProps: CustomElementProps,
      ): ReactElement => {
        const current: Record<string, unknown> = readValues(values);

        return (
          <CloudBudgetMonthlyPlanEditor
            value={current["monthlyPlan"] as Array<number> | null}
            onChange={(plan: Array<number>) => {
              elementProps.onChange?.(plan);
            }}
            fiscalYearStartMonth={current["fiscalYearStartMonth"]}
            currency={String(current["currency"] || data.context.currency)}
            hasError={Boolean(elementProps.error)}
          />
        );
      },
      // The budget's amount follows its months: their total.
      onChange: (
        value: unknown,
        currentValues: FormValues<CloudBudget>,
        setFormValues: (values: FormValues<CloudBudget>) => void,
      ): void => {
        setFormValues({
          ...currentValues,
          monthlyAmount: sumCloudBudgetPlan(
            toCloudBudgetPlanAmounts(value as Array<number>),
          ),
        } as unknown as FormValues<CloudBudget>);
      },
      customValidation: (values: FormValues<CloudBudget>): string | null => {
        if (!isFormPlanByMonth(values)) {
          return null;
        }

        const plan: Array<number> = toCloudBudgetPlanAmounts(
          readValues(values)["monthlyPlan"] as Array<number>,
        );

        return sumCloudBudgetPlan(plan) > 0
          ? null
          : data.translator.translateText(PLAN_NEEDS_A_MONTH) ||
              PLAN_NEEDS_A_MONTH;
      },
    },
    {
      field: { alertThresholds: true },
      title: "Alert At",
      stepId: "alerts",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "80,100",
      description: ALERT_AT_DESCRIPTION,
      customValidation: (values: FormValues<CloudBudget>): string | null => {
        return getAlertAtProblem(values.alertThresholds, data.translator);
      },
    },
    {
      field: { alertOnProjection: true },
      title: "Alert When On Course To Pass",
      stepId: "alerts",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      description: ON_COURSE_DESCRIPTION,
    },
    {
      field: { alertOnAnomaly: true },
      title: "Alert On Unusual Days",
      stepId: "alerts",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      description: UNUSUAL_DAYS_DESCRIPTION,
    },
    {
      field: { unusualDayThreshold: true },
      title: UNUSUAL_THRESHOLD_TITLE,
      stepId: "alerts",
      collapsibleSection: alertsMore,
      fieldType: FormFieldSchemaType.PositiveNumber,
      required: false,
      placeholder: "250",
      description: UNUSUAL_THRESHOLD_DESCRIPTION,
      showIf: (values: FormValues<CloudBudget>): boolean => {
        return readValues(values)["alertOnAnomaly"] !== false;
      },
    },
    {
      field: { unusualDayThresholdUnit: true },
      title: UNUSUAL_UNIT_TITLE,
      stepId: "alerts",
      collapsibleSection: alertsMore,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: options(
        CLOUD_BUDGET_UNUSUAL_DAY_UNITS,
        CLOUD_BUDGET_UNUSUAL_DAY_UNIT_LABELS,
      ),
      required: false,
      defaultValue: CloudBudgetUnusualDayUnit.Amount,
      description: UNUSUAL_UNIT_DESCRIPTION,
      showIf: (values: FormValues<CloudBudget>): boolean => {
        const current: Record<string, unknown> = readValues(values);

        return (
          current["alertOnAnomaly"] !== false &&
          current["unusualDayThreshold"] !== undefined &&
          current["unusualDayThreshold"] !== null &&
          current["unusualDayThreshold"] !== ""
        );
      },
    },
    {
      field: { alertSeverity: true },
      title: "Alert Severity",
      stepId: "alerts",
      collapsibleSection: alertsMore,
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
      // People and teams in one picker: their picks are notifyUsers and notifyTeams.
      field: {
        [NOTIFY_FIELD_KEY]: true,
      } as unknown as SelectFormFields<CloudBudget>,
      title: NOTIFY_TITLE,
      stepId: "people",
      fieldType: FormFieldSchemaType.PeoplePicker,
      formOnly: true,
      required: false,
      description: NOTIFY_DESCRIPTION,
      peoplePicker: {
        kinds: [
          { kind: PeoplePickerKind.User, valueKey: "notifyUsers" },
          { kind: PeoplePickerKind.Team, valueKey: "notifyTeams" },
        ],
        addButtonText: "Add people or teams",
        searchPlaceholder: "Search people or teams...",
        emptyText: "No people or teams available.",
      },
    },
    {
      field: { notifyCostGroupTeam: true },
      title: NOTIFY_GROUP_TEAM_TITLE,
      stepId: "people",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      description: NOTIFY_GROUP_TEAM_DESCRIPTION,
      showIf: (values: FormValues<CloudBudget>): boolean => {
        return isFormScope(values, CloudBudgetScope.CostGroup);
      },
    },
    {
      field: { onCallDutyPolicies: true },
      title: "On-Call Policies",
      stepId: "people",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: OnCallDutyPolicy,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select On-Call Policies",
      description: ON_CALL_DESCRIPTION,
    },
  ];
}
