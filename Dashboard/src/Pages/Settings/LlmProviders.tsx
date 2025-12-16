import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Banner from "Common/UI/Components/Banner/Banner";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmType from "Common/Types/LLM/LlmType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const LlmPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <>
        <Card
          title="What Can LLM Providers Do?"
          description="LLM Providers help you automate and enhance your incident management workflow with AI-powered features."
        >
          <div className="mt-4 space-y-3">
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Incident Notes</span>
                <span className="text-gray-500">
                  {" "}
                  - Automatically generate detailed incident notes and updates
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Alert Notes</span>
                <span className="text-gray-500">
                  {" "}
                  - Create meaningful alert descriptions and context
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Scheduled Maintenance Notes</span>
                <span className="text-gray-500">
                  {" "}
                  - Generate maintenance event notes automatically
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Incident Postmortems</span>
                <span className="text-gray-500">
                  {" "}
                  - Automatically draft comprehensive incident postmortem
                  reports
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">Code Improvements</span>
                <span className="text-gray-500">
                  {" "}
                  - Analyze telemetry data (logs, traces, metrics, exceptions)
                  and suggest code improvements when connected to your code
                  repository
                </span>
              </div>
            </div>
          </div>
        </Card>

        <ModelTable<LlmProvider>
          modelType={LlmProvider}
          id="global-llms-table"
          name="Settings > Global LLM Providers"
          userPreferencesKey={"settings-global-llms-table"}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          cardProps={{
            title: "Global LLM Providers",
            description:
              "Global LLM Providers are pre-configured. These will be used automatically for AI features when you haven't set up your own custom LLM provider below.",
          }}
          fetchRequestOptions={{
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/llm-provider/global-llms",
            ),
          }}
          noItemsMessage={"No global LLM Providers configured."}
          showRefreshButton={true}
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
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
              noValueMessage: "-",
            },
            ...(BILLING_ENABLED
              ? [
                  {
                    field: {
                      costPerMillionTokensInUSDCents: true,
                    },
                    title: "Cost per Million Tokens",
                    type: FieldType.Text,
                    getElement: (item: LlmProvider): ReactElement => {
                      const costInCents: number =
                        item.costPerMillionTokensInUSDCents || 0;
                      const costInUSD: number = costInCents / 100;
                      return <span>${costInUSD.toFixed(2)} USD</span>;
                    },
                  },
                ]
              : []),
          ]}
        />

        <Banner
          openInNewTab={true}
          title="Need help with setting up Custom LLM Providers?"
          description="Here is a guide which will help you get set up with your own LLM Provider configurations."
          link={Route.fromString("/docs/ai/llm-provider")}
          hideOnMobile={true}
        />

        <ModelTable<LlmProvider>
          modelType={LlmProvider}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="project-llms-table"
          userPreferencesKey={"settings-project-llms-table"}
          name="Settings > LLM Providers"
          isDeleteable={true}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
          cardProps={{
            title: "Bring Your Own Large Language Model",
            description: BILLING_ENABLED
              ? "Configure LLM Providers for AI features. Connect to OpenAI, Anthropic, Ollama, or other providers. You will not be charged for AI usage when you bring your own models."
              : "Configure LLM Providers for AI features. Connect to OpenAI, Anthropic, Ollama, or other providers.",
          }}
          selectMoreFields={{
            apiKey: true,
          }}
          noItemsMessage={
            "No LLM Providers configured. Add an LLM Provider to enable AI features for your project."
          }
          viewPageRoute={Navigation.getCurrentRoute()}
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
          showRefreshButton={true}
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
              type: FieldType.Text,
            },
            {
              field: {
                isDefault: true,
              },
              title: "Default",
              type: FieldType.Boolean,
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
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
              noValueMessage: "-",
            },
            {
              field: {
                isDefault: true,
              },
              title: "Default",
              type: FieldType.Boolean,
              getElement: (item: LlmProvider): ReactElement => {
                if (item.isDefault) {
                  return <Pill text="Default" color={Green} />;
                }
                return <span className="text-gray-400">-</span>;
              },
            },
          ]}
        />
      </>
    </Fragment>
  );
};

export default LlmPage;
