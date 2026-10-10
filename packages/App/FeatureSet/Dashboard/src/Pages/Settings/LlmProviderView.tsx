import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ColumnLength from "Common/Types/Database/ColumnLength";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestLLMProvider, {
  LLMProviderTestResult,
} from "Common/UI/Utils/TestLLMProvider";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmTypeDropdownOptions from "Common/UI/Utils/LlmTypeDropdownOptions";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

// Set as Default and Additional Parameters, folded at the end of Provider Settings.
const advancedSection: FormFieldCollapsibleSection<LlmProvider> =
  getAdvancedFormSection<LlmProvider>();

const LlmProviderView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  /*
   * The Additional Parameters are read like the API key, by project owners
   * and admins alone (LlmProvider.additionalParams). Everyone else who reads
   * the provider is shown whether any are saved (hasAdditionalParams), never
   * what they are.
   */
  const canReadAdditionalParams: boolean = PermissionGate.canReadColumn(
    new LlmProvider(),
    "additionalParams",
  );

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
        /*
         * Fetched again when whether the parameters may be read changes: the
         * permission snapshot can land after the first paint.
         */
        key={canReadAdditionalParams ? "with-parameters" : "without-parameters"}
        name="LLM Provider Details"
        cardProps={{
          title: "LLM Provider Details",
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
        // As on the create form: Advanced is folded into Provider Settings.
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
            dropdownOptions: LlmTypeDropdownOptions,
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
              "Required for OpenAI, Azure OpenAI / Microsoft Foundry (one of your resource's keys), Anthropic, Groq, and Mistral. Optional for Ollama and OpenAI-compatible servers (e.g. vLLM) that don't require authentication.",
          },
          {
            field: {
              modelName: true,
            },
            title: "Model Name",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "gpt-5.1, claude-sonnet-5-5, llama-3.3-70b-versatile",
            description:
              "The specific model or deployment name to use (e.g., gpt-5.1 for OpenAI, claude-sonnet-5-5 for Anthropic, your deployment's name for Azure OpenAI / Microsoft Foundry, llama-3.3-70b-versatile for Groq, mistral-large-latest for Mistral). Required for OpenAI-compatible providers — it must match a model your server exposes.",
          },
          {
            field: {
              baseUrl: true,
            },
            title: "Base URL",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.URL,
            required: false,
            placeholder: "http://ollama:11434",
            // The column holds 100 characters; see LlmProviders.tsx.
            validation: {
              maxLength: ColumnLength.ShortURL,
            },
            description:
              "Required for Azure OpenAI / Microsoft Foundry, Ollama, and OpenAI-compatible providers (e.g. vLLM, LocalAI — use your server's /v1 endpoint). For Azure OpenAI / Microsoft Foundry use your resource's endpoint, e.g. https://<resource>.openai.azure.com/openai/v1, or https://<resource>.services.ai.azure.com/anthropic for Claude. Optional for others to override the default endpoint. Everyone who can see this project's settings can read it, so never put a key, a token or a password in it: use the API Key.",
          },
          {
            field: {
              isDefault: true,
            },
            title: "Set as Default",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: advancedSection,
            description:
              "Set this as the default LLM provider for the project. When a default is set, the global LLM provider will not be used.",
          },
          {
            field: {
              additionalParams: true,
            },
            title: "Additional Parameters",
            stepId: "provider-settings",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            collapsibleSection: advancedSection,
            description:
              'Optional JSON object with extra parameters sent directly to the provider API. These override any defaults. Leave empty unless you need model-specific parameters. Presets — OpenAI / Azure OpenAI (gpt-5 family): {"max_completion_tokens": 2048} | OpenAI o1/o3 reasoning models: {"reasoning_effort": "high", "max_completion_tokens": 10000} | Override temperature: {"temperature": 0.2} | Top-p sampling: {"top_p": 0.9}',
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
            canReadAdditionalParams
              ? {
                  field: {
                    additionalParams: true,
                  },
                  title: "Additional Parameters",
                  fieldType: FieldType.JSON,
                  placeholder: "None",
                }
              : {
                  field: {
                    hasAdditionalParams: true,
                  },
                  title: "Additional Parameters",
                  description:
                    "Only project owners and admins can read them, like the API key.",
                  fieldType: FieldType.Boolean,
                  getElement: (item: LlmProvider): ReactElement => {
                    return (
                      <span>
                        {item.hasAdditionalParams
                          ? translator.translateText("Saved")
                          : translator.translateText("None")}
                      </span>
                    );
                  },
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
              RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
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
