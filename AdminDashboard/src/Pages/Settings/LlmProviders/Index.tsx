import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Banner from "Common/UI/Components/Banner/Banner";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmType from "Common/Types/LLM/LlmType";
import React, { FunctionComponent, ReactElement } from "react";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const Settings: FunctionComponent = (): ReactElement => {
  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Global LLM Providers",
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
        title="Need help with setting up LLM Providers?"
        description="LLM Providers enable AI features. You can configure global LLM Providers that are available to all projects."
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
        cardProps={{
          title: "Global LLM Providers",
          description:
            "Global LLM Providers are available to all projects for AI features. Configure OpenAI, Anthropic, Ollama, or other LLM providers.",
        }}
        query={{
          projectId: new IsNull(),
          isGlobalLlm: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={
          "No LLM Providers configured. Add an LLM Provider to enable AI features."
        }
        showRefreshButton={true}
        onBeforeCreate={(item: LlmProvider) => {
          item.isGlobalLlm = true;
          return Promise.resolve(item);
        }}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Provider Settings",
            id: "provider-settings",
          },
          {
            title: "Cost Settings",
            id: "cost-settings",
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
          {
            field: {
              costPerMillionTokensInUSDCents: true,
            },
            title: "Cost (cents/1M)",
            type: FieldType.Number,
            noValueMessage: "0",
          },
        ]}
      />
    </Page>
  );
};

export default Settings;
