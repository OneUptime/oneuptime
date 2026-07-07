import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestLLMProvider, {
  LLMProviderTestResult,
} from "Common/UI/Utils/TestLLMProvider";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmType from "Common/Types/LLM/LlmType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const LlmProviderView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string>("");

  const runTest: () => Promise<void> = async (): Promise<void> => {
    setIsTesting(true);
    setTestError("");
    setTestMessage("");

    const result: LLMProviderTestResult = await TestLLMProvider.test({
      llmProviderId: modelId.toString(),
      headers: ModelAPI.getCommonHeaders(),
    });

    if (result.success) {
      setTestMessage(result.message);
    } else {
      setTestError(result.message);
    }

    setIsTesting(false);
  };

  return (
    <Fragment>
      {/* LLM Provider View  */}
      <CardModelDetail<LlmProvider>
        name="LLM Provider Details"
        cardProps={{
          title: "LLM Provider Details",
          description:
            "Here are more details for this LLM Provider configuration.",
          buttons: [
            {
              title: "Test",
              icon: IconProp.Play,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                setShowTestModal(true);
                runTest().catch(() => {
                  // errors are surfaced via the test result modal
                });
              },
            },
          ],
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
              "Required for OpenAI, Azure OpenAI, Anthropic, Groq, and Mistral. Not required for Ollama if self-hosted.",
          },
          {
            field: {
              modelName: true,
            },
            title: "Model Name",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "gpt-4o, claude-3-opus, llama-3.3-70b-versatile",
            description:
              "The specific model or deployment name to use (e.g., gpt-4o for OpenAI, your deployment name for Azure OpenAI, llama-3.3-70b-versatile for Groq, mistral-large-latest for Mistral).",
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
              "Required for Azure OpenAI and Ollama. For Azure OpenAI use your deployment endpoint (e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>). The api-version query parameter is added automatically if you don't include one. Optional for others to override the default endpoint.",
          },
          {
            field: {
              isDefault: true,
            },
            title: "Set as Default",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Set this as the default LLM provider for the project. When a default is set, the global LLM provider will not be used.",
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
              fieldType: FieldType.ObjectID,
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
                isDefault: true,
              },
              title: "Default",
              fieldType: FieldType.Boolean,
              getElement: (item: LlmProvider): ReactElement => {
                if (item.isDefault) {
                  return <Pill text="Default" color={Green} />;
                }
                return <span className="text-gray-400">-</span>;
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
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENTS_LLM_PROVIDERS] as Route,
              { modelId },
            ),
          );
        }}
      />

      {showTestModal ? (
        <ConfirmModal
          title={"Test LLM Provider"}
          error={testError}
          description={
            isTesting
              ? "Sending a test prompt to your LLM provider…"
              : testMessage ||
                "Testing the connection to your LLM provider. This sends a small prompt using your configured API key, model, and base URL."
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={async () => {
            setShowTestModal(false);
            setTestError("");
            setTestMessage("");
          }}
        />
      ) : null}
    </Fragment>
  );
};

export default LlmProviderView;
