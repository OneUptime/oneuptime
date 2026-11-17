import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import LlmModelPrice from "Common/Models/DatabaseModels/LlmModelPrice";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

const LlmPricingPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="AI / LLM" />
    );
  }

  return (
    <ModelTable<LlmModelPrice>
      modelType={LlmModelPrice}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="llm-model-prices-table"
      userPreferencesKey="llm-model-prices-table"
      name="AI / LLM > Pricing"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      showRefreshButton={true}
      showViewIdButton={true}
      sortBy="modelPrefix"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: "Custom LLM Pricing",
        description:
          "Your own per-million-token prices, for negotiated rates or models the built-in catalog does not know. The longest matching model prefix wins, and your entry beats the built-in one on ties.",
      }}
      noItemsMessage={
        "No custom LLM prices yet. Spans are priced with the built-in list-price catalog."
      }
      formSteps={[
        { title: "Model", id: "model" },
        { title: "Pricing", id: "pricing" },
      ]}
      formFields={[
        {
          field: { modelPrefix: true },
          title: "Model Prefix",
          stepId: "model",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "gpt-4o or my-custom-finetune",
          description:
            "The model-name prefix this price matches, case-insensitive. The longest matching prefix wins.",
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "model",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder:
            "e.g. Negotiated OpenAI enterprise rate, or self-hosted Llama pricing.",
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: "Whether this price is used when pricing LLM spans.",
          stepId: "model",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
        },
        {
          field: { inputPricePerMillionTokensInUSD: true },
          title: "Input Price (USD per 1M tokens)",
          stepId: "pricing",
          fieldType: FormFieldSchemaType.Number,
          required: true,
          placeholder: "2.50",
          description:
            "Price of one million input (prompt) tokens in USD. Use 0 for free input tokens.",
        },
        {
          field: { outputPricePerMillionTokensInUSD: true },
          title: "Output Price (USD per 1M tokens)",
          stepId: "pricing",
          fieldType: FormFieldSchemaType.Number,
          required: true,
          placeholder: "10.00",
          description:
            "Price of one million output (completion) tokens in USD. Use 0 for models that bill input only (e.g. embeddings).",
        },
      ]}
      filters={[
        {
          field: { modelPrefix: true },
          type: FieldType.Text,
          title: "Model Prefix",
        },
        {
          field: { isEnabled: true },
          type: FieldType.Boolean,
          title: "Enabled",
        },
      ]}
      columns={[
        {
          field: { modelPrefix: true, description: true },
          title: "Model Prefix",
          type: FieldType.Element,
          getElement: (item: LlmModelPrice): ReactElement => {
            return (
              <div>
                <div className="font-medium text-gray-900 font-mono text-sm">
                  {item.modelPrefix || <TableEmptyValue />}
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
          field: { inputPricePerMillionTokensInUSD: true },
          title: "Input / 1M Tokens",
          type: FieldType.Element,
          getElement: (item: LlmModelPrice): ReactElement => {
            return (
              <span className="text-sm text-gray-900">
                {`$${(item.inputPricePerMillionTokensInUSD || 0).toFixed(2)}`}
              </span>
            );
          },
        },
        {
          field: { outputPricePerMillionTokensInUSD: true },
          title: "Output / 1M Tokens",
          type: FieldType.Element,
          getElement: (item: LlmModelPrice): ReactElement => {
            return (
              <span className="text-sm text-gray-900">
                {`$${(item.outputPricePerMillionTokensInUSD || 0).toFixed(2)}`}
              </span>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
          getElement: (item: LlmModelPrice): ReactElement => {
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

export default LlmPricingPage;
