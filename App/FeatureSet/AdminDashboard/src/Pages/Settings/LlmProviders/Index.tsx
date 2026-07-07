import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmTypeDropdownOptions from "Common/UI/Utils/LlmTypeDropdownOptions";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import TestLLMProvider, {
  LLMProviderTestResult,
} from "Common/UI/Utils/TestLLMProvider";
import { BILLING_ENABLED } from "Common/UI/Config";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string>("");

  const runTest: (item: LlmProvider) => Promise<void> = async (
    item: LlmProvider,
  ): Promise<void> => {
    setIsTesting(true);
    setTestError("");
    setTestMessage("");

    const result: LLMProviderTestResult = await TestLLMProvider.test({
      llmProviderId: item["_id"]?.toString() || "",
      headers: AdminModelAPI.getCommonHeaders(),
    });

    if (result.success) {
      setTestMessage(result.message);
    } else {
      setTestError(result.message);
    }

    setIsTesting(false);
  };

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.globalLlmProviders"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* LLM Provider Settings View  */}

      <Banner
        openInNewTab={true}
        title={t("pages.settings.llmProviders.bannerTitle")}
        description={t("pages.settings.llmProviders.bannerDescription")}
        link={Route.fromString("/docs/ai/llm-provider")}
        hideOnMobile={true}
      />

      <ModelTable<LlmProvider>
        userPreferencesKey={"admin-llms-table"}
        modelType={LlmProvider}
        id="llms-table"
        name="Settings > Global LLM Providers"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        actionButtons={[
          {
            title: "Test",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: async (
              item: LlmProvider,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setShowTestModal(true);
                await runTest(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        cardProps={{
          title: t("pages.settings.llmProviders.cardTitle"),
          description: t("pages.settings.llmProviders.cardDescription"),
        }}
        query={{
          projectId: new IsNull(),
          isGlobalLlm: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={t("pages.settings.llmProviders.noItems")}
        showRefreshButton={true}
        onBeforeCreate={(item: LlmProvider) => {
          item.isGlobalLlm = true;
          return Promise.resolve(item);
        }}
        formSteps={[
          {
            title: t("pages.settings.llmProviders.stepBasicInfo"),
            id: "basic-info",
          },
          {
            title: t("pages.settings.llmProviders.stepProviderSettings"),
            id: "provider-settings",
          },
          ...(BILLING_ENABLED
            ? [
                {
                  title: t("pages.settings.llmProviders.stepCostSettings"),
                  id: "cost-settings",
                },
              ]
            : []),
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
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
              "Required for OpenAI, Azure OpenAI, Anthropic, Groq, and Mistral. Optional for Ollama and OpenAI-compatible servers (e.g. vLLM) that don't require authentication.",
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
              "The specific model or deployment name to use (e.g., gpt-4o for OpenAI, your deployment name for Azure OpenAI, llama-3.3-70b-versatile for Groq, mistral-large-latest for Mistral). Required for OpenAI-compatible providers — it must match a model your server exposes.",
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
              "Required for Azure OpenAI, Ollama, and OpenAI-compatible providers (e.g. vLLM, LocalAI — use your server's /v1 endpoint). For Azure OpenAI use your deployment endpoint (e.g. https://<resource>.openai.azure.com/openai/deployments/<deployment>). The api-version query parameter is added automatically if you don't include one. Optional for others to override the default endpoint.",
          },
          ...(BILLING_ENABLED
            ? [
                {
                  field: {
                    costPerMillionTokensInUSDCents: true,
                  },
                  title: "Cost Per Million Tokens (USD Cents)",
                  stepId: "cost-settings",
                  fieldType: FormFieldSchemaType.Number,
                  required: false,
                  placeholder: "0",
                  description:
                    "Cost per million tokens in USD cents. For example, if the cost is $0.01 per 1M tokens, enter 1.",
                },
              ]
            : []),
        ]}
        selectMoreFields={{
          apiKey: true,
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              llmType: true,
            },
            title: "Provider",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              llmType: true,
            },
            title: "Provider",
            type: FieldType.Text,
          },
          {
            field: {
              modelName: true,
            },
            title: "Model",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          ...(BILLING_ENABLED
            ? [
                {
                  field: {
                    costPerMillionTokensInUSDCents: true,
                  },
                  title: "Cost (cents/1M)",
                  type: FieldType.Number,
                  noValueMessage: "0",
                },
              ]
            : []),
        ]}
      />

      {showTestModal ? (
        <ConfirmModal
          title={"Test LLM Provider"}
          error={testError}
          description={
            isTesting
              ? "Sending a test prompt to the LLM provider…"
              : testMessage ||
                "Testing the connection to this global LLM provider. This sends a small prompt using its configured API key, model, and base URL."
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={async () => {
            setShowTestModal(false);
            setTestError("");
            setTestMessage("");
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
