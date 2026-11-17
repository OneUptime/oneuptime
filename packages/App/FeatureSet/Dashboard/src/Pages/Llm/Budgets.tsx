import { PillTone } from "Common/UI/Components/Pill/PillTone";
import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import Service from "Common/Models/DatabaseModels/Service";
import LlmBudgetSpendSource from "Common/Types/LlmObservability/LlmBudgetSpendSource";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const LlmBudgetsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="AI / LLM" />
    );
  }

  return (
    <ModelTable<LlmCostBudget>
      modelType={LlmCostBudget}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
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
          "Daily USD budgets for LLM spend. Spend is published as metrics every 15 minutes: alert on them from a Metrics monitor with a 30-minute rolling window.",
      }}
      noItemsMessage={"No LLM cost budgets yet."}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Budget", id: "budget" },
        { title: "Scope", id: "scope" },
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
          description: "The daily budget in USD, over the UTC day.",
        },
        /*
         * Two answers, both in view with what each counts: the same two
         * sources, in the same words, as Usage's switch.
         */
        {
          field: { spendSource: true },
          title: "Count spend from",
          stepId: "scope",
          description: "One or the other, never both, so nothing counts twice.",
          fieldType: FormFieldSchemaType.RadioButton,
          required: true,
          defaultValue: LlmBudgetSpendSource.Calls,
          radioButtonOptions: [
            {
              title: "Your AI calls",
              description: "What your apps and coding tools send",
              value: LlmBudgetSpendSource.Calls,
            },
            {
              title: "Provider accounts",
              description: "What your connected accounts were billed",
              value: LlmBudgetSpendSource.Providers,
            },
          ],
        },
        {
          field: { service: true },
          title: "Service (optional)",
          stepId: "scope",
          // A provider's bill names no service.
          showIf: (values: FormValues<LlmCostBudget>): boolean => {
            return values.spendSource !== LlmBudgetSpendSource.Providers;
          },
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
            "Only count spend from this provider: openai, anthropic, azure.ai.openai, aws.bedrock or gcp.vertex_ai. Leave empty to count every provider.",
        },
        {
          field: { llmModel: true },
          title: "LLM Model (optional)",
          stepId: "scope",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "gpt-4o",
          description:
            "Only count spend from this model, exactly as the provider names it. Leave empty to count every model.",
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
        llmSystem: true,
        llmModel: true,
        spendSource: true,
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
                  {item.name || translator.translateText("Untitled")}
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
              return <TableEmptyValue />;
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

            if (item.spendSource === LlmBudgetSpendSource.Providers) {
              return (
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {translator.translateText("Provider accounts")}
                  </span>
                  {filters.length > 0 && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {filters.join(" · ")}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div>
                {item.service?.name ? (
                  <span className="inline-flex items-center text-sm font-medium text-gray-900">
                    <span className="text-gray-500 mr-1">
                      {translator.translateText("Service:")}
                    </span>
                    {item.service.name}
                  </span>
                ) : (
                  <span className="text-sm text-gray-500">
                    {translator.translateText("Project-wide")}
                  </span>
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
            return <Pill tone={PillTone.Paused} text="Disabled" />;
          },
        },
      ]}
    />
  );
};

export default LlmBudgetsPage;
