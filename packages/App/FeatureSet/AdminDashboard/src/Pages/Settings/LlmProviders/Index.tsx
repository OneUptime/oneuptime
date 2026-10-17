import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TestLlmProviderModal from "Common/UI/Components/AI/TestLlmProviderModal";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import ColumnLength from "Common/Types/Database/ColumnLength";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmTypeDropdownOptions from "Common/UI/Utils/LlmTypeDropdownOptions";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { BILLING_ENABLED } from "Common/UI/Config";

/*
 * Additional Parameters and, where projects are billed for AI, the cost per
 * million tokens: folded at the end of Provider Settings, as on the
 * Dashboard's own LLM provider form. Each used to be a wizard step of its
 * own that every new provider had to walk through.
 */
const advancedSection: FormFieldCollapsibleSection<LlmProvider> =
  getAdvancedFormSection<LlmProvider>();

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  // The global provider whose Test dialog is open.
  const [testedProviderId, setTestedProviderId] = useState<string | null>(null);

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
            onClick: (item: LlmProvider, onCompleteAction: VoidFunction) => {
              setTestedProviderId(item.id?.toString() || null);
              onCompleteAction();
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
        /*
         * What the provider is, then how to reach it - with the rarely
         * changed options folded under Advanced at the end of the second.
         */
        formSteps={[
          {
            title: t("pages.settings.llmProviders.stepBasicInfo"),
            id: "basic-info",
          },
          {
            title: t("pages.settings.llmProviders.stepProviderSettings"),
            id: "provider-settings",
          },
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
              "Required for OpenAI, Azure OpenAI / Microsoft Foundry, Anthropic, Groq and Mistral. Optional for Ollama and OpenAI-compatible servers.",
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
              "The model to use, such as gpt-5.1 or claude-sonnet-5-5. For Azure OpenAI / Microsoft Foundry, your deployment's name.",
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
            /*
             * The column holds 100 characters. Said at the field, before the
             * save: a deployment's whole Target URI with its api-version runs
             * longer, and the resource's endpoint is short.
             */
            validation: {
              maxLength: ColumnLength.ShortURL,
            },
            description:
              "Your Azure resource's endpoint, or your server's /v1 endpoint. Required for Azure OpenAI / Microsoft Foundry, Ollama and OpenAI-compatible servers.",
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
              'Extra JSON parameters sent to the provider with every request, such as {"temperature": 0.2}. Leave empty unless your model needs them.',
          },
          ...(BILLING_ENABLED
            ? [
                {
                  field: {
                    costPerMillionTokensInUSDCents: true,
                  },
                  title: "Cost Per Million Tokens (USD Cents)",
                  stepId: "provider-settings",
                  fieldType: FormFieldSchemaType.Number,
                  required: false,
                  collapsibleSection: advancedSection,
                  /*
                   * The column's default: a provider that is free to use.
                   * Written here too so its Edit form, which does not start
                   * from column defaults, reads 0 as nothing set rather than
                   * "Configured".
                   */
                  defaultValue: 0,
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

      {testedProviderId ? (
        <TestLlmProviderModal
          llmProviderId={testedProviderId}
          // No project: a global provider is the instance's own.
          headers={AdminModelAPI.getCommonHeaders()}
          onClose={() => {
            setTestedProviderId(null);
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
