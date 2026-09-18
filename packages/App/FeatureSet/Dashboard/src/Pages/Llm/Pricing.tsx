import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import LlmModelPrice from "Common/Models/DatabaseModels/LlmModelPrice";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const LlmPricingPage: FunctionComponent<PageComponentProps> = (
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
    <ModelTable<LlmModelPrice>
      modelType={LlmModelPrice}
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
          "Custom per-million-token prices for this project — negotiated rates, self-hosted models, or fine-tunes the built-in catalog does not know. When a span reports tokens but no cost, the longest matching model prefix wins across your entries and the built-in catalog; your entry beats the built-in one on ties.",
      }}
      noItemsMessage={
        "No custom LLM prices found. Spans are priced with the built-in list-price catalog."
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
            "Model-name prefix this price matches (case-insensitive). The longest matching prefix wins, so gpt-4o also matches gpt-4o-2024-08-06 unless a longer entry exists.",
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
                  {item.modelPrefix || "-"}
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
