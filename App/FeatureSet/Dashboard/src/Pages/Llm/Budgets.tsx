import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import Service from "Common/Models/DatabaseModels/Service";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const LlmBudgetsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <ModelTable<LlmCostBudget>
      modelType={LlmCostBudget}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="llm-cost-budgets-table"
      userPreferencesKey="llm-cost-budgets-table"
      name="AI / LLM > Budgets"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      showRefreshButton={true}
      showViewIdButton={true}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: "LLM Cost Budgets",
        description:
          "Daily USD budgets for LLM spend. A worker sums each UTC day's LLM span cost and raises alerts at the warning threshold and at 100%.",
      }}
      noItemsMessage={"No LLM cost budgets found."}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Budget", id: "budget" },
        { title: "Scope", id: "scope" },
        { title: "Alerting", id: "alerting" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Daily OpenAI spend",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this budget covers and why.",
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: "Whether this budget is evaluated.",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
        },
        {
          field: { dailyBudgetInUSD: true },
          title: "Daily Budget (USD)",
          stepId: "budget",
          fieldType: FormFieldSchemaType.Number,
          required: true,
          placeholder: "100",
          description: "Daily budget in USD, evaluated over the UTC day.",
        },
        {
          field: { warningThresholdPercent: true },
          title: "Warning Threshold (%)",
          stepId: "budget",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "80",
          description:
            "Raise a warning alert at this percent of the budget (1-99). A breach alert always fires at 100%.",
        },
        {
          field: { service: true },
          title: "Service (optional)",
          stepId: "scope",
          description:
            "Scope this budget to a single telemetry service. Leave empty for a project-wide budget.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: false,
          dropdownModal: {
            type: Service,
            labelField: "name",
            valueField: "_id",
          },
        },
        {
          field: { llmSystem: true },
          title: "LLM Provider (optional)",
          stepId: "scope",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "openai",
          description:
            "Only count spend from this provider (matches the span's gen_ai provider). Leave empty to count every provider.",
        },
        {
          field: { llmModel: true },
          title: "LLM Model (optional)",
          stepId: "scope",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "gpt-4o",
          description:
            "Only count spend from this model (matches the span's requested model exactly). Leave empty to count every model.",
        },
        {
          field: { alertSeverity: true },
          title: "Alert Severity (optional)",
          stepId: "alerting",
          description:
            "Severity of the alerts created when this budget crosses a threshold.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: false,
          dropdownModal: {
            type: AlertSeverity,
            labelField: "name",
            valueField: "_id",
          },
        },
        {
          field: { onCallDutyPolicies: true },
          title: "On-Call Duty Policies (optional)",
          stepId: "alerting",
          description:
            "On-call duty policies to execute when this budget raises an alert.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          required: false,
          dropdownModal: {
            type: OnCallDutyPolicy,
            labelField: "name",
            valueField: "_id",
          },
        },
      ]}
      filters={[
        {
          field: { name: true },
          type: FieldType.Text,
          title: "Name",
        },
        {
          field: { isEnabled: true },
          type: FieldType.Boolean,
          title: "Enabled",
        },
      ]}
      selectMoreFields={{
        warningThresholdPercent: true,
        llmSystem: true,
        llmModel: true,
        currentDaySpendInUSD: true,
        dailyBudgetInUSD: true,
      }}
      columns={[
        {
          field: { name: true, description: true },
          title: "Name",
          type: FieldType.Element,
          getElement: (item: LlmCostBudget): ReactElement => {
            return (
              <div>
                <div className="font-medium text-gray-900">
                  {item.name || "Untitled"}
                </div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.description}
                  </div>
                )}
              </div>
            );
          },
        },
        {
          field: { dailyBudgetInUSD: true },
          title: "Daily Budget",
          type: FieldType.Element,
          getElement: (item: LlmCostBudget): ReactElement => {
            return (
              <span className="text-sm text-gray-900">
                {`$${(item.dailyBudgetInUSD || 0).toFixed(2)}`}
              </span>
            );
          },
        },
        {
          field: { currentDaySpendInUSD: true },
          title: "Today's Spend",
          type: FieldType.Element,
          getElement: (item: LlmCostBudget): ReactElement => {
            if (
              item.currentDaySpendInUSD === undefined ||
              item.currentDaySpendInUSD === null
            ) {
              return <span className="text-sm text-gray-500">—</span>;
            }

            const spend: number = item.currentDaySpendInUSD;
            const budget: number = item.dailyBudgetInUSD || 0;

            return (
              <span className="text-sm text-gray-900">
                {`$${spend.toFixed(2)}`}
                {budget > 0 && (
                  <span className="text-xs text-gray-500 ml-1">
                    {`${Math.floor((spend / budget) * 100)}%`}
                  </span>
                )}
              </span>
            );
          },
        },
        {
          field: { service: { name: true } },
          title: "Scope",
          type: FieldType.Element,
          getElement: (item: LlmCostBudget): ReactElement => {
            const filters: Array<string> = [];

            if (item.llmSystem) {
              filters.push(`Provider: ${item.llmSystem}`);
            }

            if (item.llmModel) {
              filters.push(`Model: ${item.llmModel}`);
            }

            return (
              <div>
                {item.service?.name ? (
                  <span className="inline-flex items-center text-sm font-medium text-gray-900">
                    <span className="text-gray-400 mr-1">Service:</span>
                    {item.service.name}
                  </span>
                ) : (
                  <span className="text-sm text-gray-500">Project-wide</span>
                )}
                {filters.length > 0 && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {filters.join(" · ")}
                  </div>
                )}
              </div>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
          getElement: (item: LlmCostBudget): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
      ]}
    />
  );
};

export default LlmBudgetsPage;
