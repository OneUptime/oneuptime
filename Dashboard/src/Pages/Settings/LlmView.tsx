import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmType from "Common/Types/LLM/LlmType";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const LlmView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  return (
    <Fragment>
      {/* LLM Provider View  */}
      <CardModelDetail<LlmProvider>
        name="LLM Provider Details"
        cardProps={{
          title: "LLM Provider Details",
          description: "Here are more details for this LLM Provider configuration.",
        }}
        isEditable={true}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Provider Settings",
            id: "provider-settings",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "basic-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "My OpenAI GPT-4",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "GPT-4 for general AI features.",
          },
          {
            field: {
              llmType: true,
            },
            title: "LLM Provider",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select LLM Provider",
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(LlmType),
          },
          {
            field: {
              apiKey: true,
            },
            title: "API Key",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "sk-...",
            description:
              "Required for OpenAI and Anthropic. Not required for Ollama if self-hosted.",
          },
          {
            field: {
              modelName: true,
            },
            title: "Model Name",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "gpt-4, claude-3-opus, llama2",
            description:
              "The specific model to use (e.g., gpt-4, claude-3-opus, llama2).",
          },
          {
            field: {
              baseUrl: true,
            },
            title: "Base URL",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.URL,
            required: false,
            placeholder: "http://localhost:11434",
            description:
              "Required for Ollama. Optional for others to use custom endpoints.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this LLM configuration.",
          },
        ]}
        modelDetailProps={{
          modelType: LlmProvider,
          id: "model-detail-llm",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "LLM Provider ID",
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              placeholder: "No description provided.",
            },
            {
              field: {
                llmType: true,
              },
              title: "Provider",
            },
            {
              field: {
                modelName: true,
              },
              title: "Model Name",
              placeholder: "Not specified",
            },
            {
              field: {
                baseUrl: true,
              },
              title: "Base URL",
              placeholder: "Not specified (using default)",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Status",
              fieldType: FieldType.Boolean,
              getElement: (item: LlmProvider): ReactElement => {
                if (item.isEnabled) {
                  return <Pill text="Enabled" color={Green} />;
                }
                return <Pill text="Disabled" color={Red} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={LlmProvider}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.SETTINGS_LLMS] as Route);
        }}
      />
    </Fragment>
  );
};

export default LlmView;
