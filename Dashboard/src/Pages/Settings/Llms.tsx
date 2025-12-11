import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Banner from "Common/UI/Components/Banner/Banner";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import Llm from "Common/Models/DatabaseModels/Llm";
import LlmType from "Common/Types/LLM/LlmType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const LlmPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <>
        <ModelTable<Llm>
          modelType={Llm}
          id="global-llms-table"
          name="Settings > Global LLMs"
          userPreferencesKey={"settings-global-llms-table"}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          cardProps={{
            title: "Global LLMs",
            description:
              "Global LLMs are configured by your administrator and are available to all projects for AI features.",
          }}
          fetchRequestOptions={{
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/llm/global-llms",
            ),
          }}
          noItemsMessage={"No global LLMs configured."}
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
          ]}
        />

        <Banner
          openInNewTab={true}
          title="Need help with setting up Custom LLMs?"
          description="Here is a guide which will help you get set up with your own LLM configurations."
          link={Route.fromString("/docs/ai/llm")}
          hideOnMobile={true}
        />

        <ModelTable<Llm>
          modelType={Llm}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="project-llms-table"
          userPreferencesKey={"settings-project-llms-table"}
          name="Settings > LLMs"
          isDeleteable={true}
          isEditable={true}
          isViewable={true}
          isCreateable={true}
          cardProps={{
            title: "Project LLMs",
            description:
              "Configure LLMs (Large Language Models) for AI features. Connect to OpenAI, Anthropic, Ollama, or other providers.",
          }}
          selectMoreFields={{
            apiKey: true,
          }}
          noItemsMessage={
            "No LLMs configured. Add an LLM to enable AI features for your project."
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
                isEnabled: true,
              },
              title: "Enabled",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description: "Enable or disable this LLM configuration.",
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
                llmType: true,
              },
              title: "Provider",
              type: FieldType.Text,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
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
                isEnabled: true,
              },
              title: "Status",
              type: FieldType.Boolean,
              getElement: (item: Llm): ReactElement => {
                if (item.isEnabled) {
                  return <Pill text="Enabled" color={Green} />;
                }
                return <Pill text="Disabled" color={Red} />;
              },
            },
          ]}
        />
      </>
    </Fragment>
  );
};

export default LlmPage;
