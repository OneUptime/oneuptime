import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OpenStackBudget from "Common/Models/DatabaseModels/OpenStackBudget";
import OpenStackProjectUsage from "Common/Models/DatabaseModels/OpenStackProjectUsage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CLOUD_BUDGET_DEFAULT_THRESHOLDS } from "Common/Types/Cloud/CloudCost";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";
import {
  CloudBudgetStatus,
  getCloudBudgetStatus,
} from "../Cloud/CloudBudgetStatus";
import {
  ALERT_AT_NOT_PERCENTS,
  CLOUD_BUDGET_TONE_COLORS,
  getAlertAtProblem,
} from "../../Pages/Cloud/Budgets";
import { formatOpenStackSpendMoney } from "../../Pages/OpenStack/Utils/OpenStackSpendView";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";

/*
 * WHAT A PROJECT MAY COME TO IN A MONTH.
 *
 * The same pattern as Cloud > Budgets: an amount, the shares of it to alert at, and an alert when the
 * month is on course to pass it. Checked every time this cloud's usage is read. In the currency of
 * this cloud's prices, and with nothing priced there's nothing to compare, which a row says. A budget
 * is only ever an alert: it stops nothing, and it isn't anybody's bill.
 */

export const OPENSTACK_BUDGET_NOT_CHECKED_TEXT: string = translationKey(
  "Budgets compare against estimates, so they need prices or CloudKitty's figures first.",
);

// The most projects a form offers: the largest first, which on a large cloud are the ones budgeted.
const PROJECT_OPTIONS: number = 1000;

export interface ComponentProps {
  openStackCloudId: ObjectID;
  month: string;
  currency: string | null;
  isPriced: boolean;
}

const OpenStackBudgetsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const projects: OpenStackRead<Array<DropdownOption>> = useOpenStackRead<
    Array<DropdownOption>
  >(async () => {
    const rows: ListResult<OpenStackProjectUsage> =
      await ModelAPI.getList<OpenStackProjectUsage>({
        modelType: OpenStackProjectUsage,
        query: {
          openStackCloudId: props.openStackCloudId,
          period: props.month,
        },
        select: { openStackProjectId: true, name: true },
        sort: { sortValue: SortOrder.Descending },
        skip: 0,
        limit: PROJECT_OPTIONS,
      });

    return rows.data.map((row: OpenStackProjectUsage): DropdownOption => {
      return {
        value: row.openStackProjectId || "",
        label: row.name || row.openStackProjectId || "",
      };
    });
  }, [props.openStackCloudId.toString(), props.month]);

  const nameOfProject: (id: string | undefined) => string = (
    id: string | undefined,
  ): string => {
    if (!id) {
      return translator.translateText(translationKey("The whole cloud")) || "";
    }

    const option: DropdownOption | undefined = projects.data?.find(
      (entry: DropdownOption): boolean => {
        return entry.value === id;
      },
    );

    return option?.label || id;
  };

  return (
    <div data-testid="openstack-budgets">
      <ModelTable<OpenStackBudget>
        modelType={OpenStackBudget}
        id="openstack-budgets-table"
        userPreferencesKey="openstack-budgets-table"
        name="OpenStack > Spend > Budgets"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        rowSwitch={{ column: "isEnabled" }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        query={{ openStackCloudId: props.openStackCloudId }}
        onBeforeCreate={(item: OpenStackBudget): Promise<OpenStackBudget> => {
          item.openStackCloudId = props.openStackCloudId;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: translationKey("Budgets"),
          description: props.isPriced
            ? translationKey(
                "What a project, or the whole cloud, may come to in a month. OneUptime alerts as the estimate passes each share of it, and when the month is on course to pass it.",
              )
            : OPENSTACK_BUDGET_NOT_CHECKED_TEXT,
        }}
        noItemsMessage={translationKey(
          "No budgets yet. Create one to be alerted before a project's month comes to more than it should.",
        )}
        createInitialValues={{
          alertThresholds: CLOUD_BUDGET_DEFAULT_THRESHOLDS.join(","),
          alertOnProjection: true,
          isEnabled: true,
        }}
        selectMoreFields={{
          isEnabled: true,
          alertThresholds: true,
          spentThisMonth: true,
          projectedThisMonth: true,
          lastCheckedAt: true,
          openStackProjectId: true,
        }}
        filters={[]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            // Each of its lines already reads its own way.
            getLineText: drawsItsOwnLines,
            getElement: (item: OpenStackBudget): ReactElement => {
              return (
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-gray-900">
                    <bdi>{item.name}</bdi>
                  </div>
                  <div className="mt-0.5 break-words text-xs text-gray-500">
                    <bdi>{nameOfProject(item.openStackProjectId)}</bdi>
                  </div>
                </div>
              );
            },
          },
          {
            field: { monthlyAmount: true },
            title: "This Month",
            type: FieldType.Element,
            getElement: (item: OpenStackBudget): ReactElement => {
              return (
                <div
                  className="min-w-[10rem] text-sm text-gray-900"
                  data-testid="openstack-budget-month"
                >
                  {translator.translateTemplate("{{spent}} of {{amount}}", {
                    spent: formatOpenStackSpendMoney({
                      amount: Number(item.spentThisMonth) || 0,
                      currency: props.currency,
                      translator,
                    }),
                    amount: formatOpenStackSpendMoney({
                      amount: Number(item.monthlyAmount) || 0,
                      currency: props.currency,
                      translator,
                    }),
                  })}
                  {item.lastCheckedAt ? (
                    <div className="mt-1 text-xs text-gray-500">
                      {translator.translateTemplate(
                        "On course for {{amount}}",
                        {
                          amount: formatOpenStackSpendMoney({
                            amount: Number(item.projectedThisMonth) || 0,
                            currency: props.currency,
                            translator,
                          }),
                        },
                      )}
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
            getElement: (item: OpenStackBudget): ReactElement => {
              const status: CloudBudgetStatus = getCloudBudgetStatus({
                isEnabled: item.isEnabled !== false,
                amount: Number(item.monthlyAmount) || 0,
                spent: item.spentThisMonth,
                projected: item.projectedThisMonth,
                thresholds: item.alertThresholds,
                lastCheckedAt: item.lastCheckedAt,
              });

              return (
                <span
                  data-testid="openstack-budget-status"
                  data-tone={status.tone}
                >
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
            placeholder: "Payments team",
            validation: { minLength: 2 },
          },
          {
            field: { monthlyAmount: true },
            title: "Monthly Amount",
            stepId: "budget",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: true,
            placeholder: "500",
            description:
              "What this may come to in a calendar month, in the currency of this cloud's prices.",
          },
          {
            field: { openStackProjectId: true },
            title: "Project",
            stepId: "budget",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: projects.data || [],
            required: false,
            placeholder: "The whole cloud",
            description: "Leave empty for a budget over this whole cloud.",
          },
          {
            field: { alertThresholds: true },
            title: "Alert At",
            stepId: "alerts",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "80,100",
            description:
              "The shares of the budget to alert at, in percent, separated by commas: an alert as the month's estimate passes each.",
            customValidation: (
              values: FormValues<OpenStackBudget>,
            ): string | null => {
              return (
                getAlertAtProblem(values.alertThresholds, translator) &&
                (translator.translateText(ALERT_AT_NOT_PERCENTS) ||
                  ALERT_AT_NOT_PERCENTS)
              );
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
              "Also alert, once a month, when holding what's held now would pass the budget before the month ends.",
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
    </div>
  );
};

export default OpenStackBudgetsCard;
