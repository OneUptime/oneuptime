import AIAgentStatusElement from "../../Components/AIAgent/AIAgentStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AIAgentElement from "Common/UI/Components/AIAgent/AIAgent";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";

const AIAgentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <>
        <ModelTable<AIAgent>
          modelType={AIAgent}
          id="ai-agents-table"
          name="Settings > Global AI Agents"
          userPreferencesKey={"admin-ai-agents-table"}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          cardProps={{
            title: "Global AI Agents",
            description:
              "Global AI Agents help you automate incident management with AI-powered responses from OneUptime's infrastructure.",
          }}
          fetchRequestOptions={{
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/ai-agent/global-ai-agents",
            ),
          }}
          noItemsMessage={"No AI agents found."}
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

              getElement: (item: AIAgent): ReactElement => {
                return <AIAgentElement aiAgent={item} />;
              },
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
                connectionStatus: true,
              },
              title: "AI Agent Status",
              type: FieldType.Text,

              getElement: (item: AIAgent): ReactElement => {
                return <AIAgentStatusElement aiAgent={item} />;
              },
            },
          ]}
        />

        <ModelTable<AIAgent>
          modelType={AIAgent}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="ai-agents-table"
          userPreferencesKey={"ai-agents-table"}
          name="Settings > AI Agents"
          isDeleteable={false}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
          cardProps={{
            title: "Self-Hosted AI Agents",
            description:
              "Self-Hosted AI Agents run on your infrastructure and can be customized for your specific incident management needs.",
          }}
          documentationLink={Route.fromString("/docs/ai/ai-agent")}
          selectMoreFields={{
            iconFileId: true,
          }}
          noItemsMessage={"No AI agents found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formSteps={[
            {
              title: "Basic Info",
              id: "basic-info",
            },
            {
              title: "More",
              id: "more",
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
              placeholder: "my-ai-agent",
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
              required: true,
              placeholder:
                "This AI agent handles incident triage and response.",
            },

            {
              field: {
                iconFile: true,
              },
              title: "AI Agent Logo",
              stepId: "basic-info",
              fieldType: FormFieldSchemaType.ImageFile,
              required: false,
              placeholder: "Upload logo",
            },
            {
              field: {
                isDefault: true,
              },
              title: "Set as Default",
              stepId: "more",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "Set this as the default AI Agent for the project. When a default is set, this agent will be used for automated tasks.",
            },
            {
              field: {
                labels: true,
              },

              title: "Labels ",
              stepId: "more",
              description:
                "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Label,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Labels",
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
            {
              title: "Labels",
              type: FieldType.EntityArray,
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              filterEntityType: Label,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,

              getElement: (item: AIAgent): ReactElement => {
                return <AIAgentElement aiAgent={item} />;
              },
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
                connectionStatus: true,
              },
              title: "Status",
              type: FieldType.Element,

              getElement: (item: AIAgent): ReactElement => {
                return <AIAgentStatusElement aiAgent={item} />;
              },
            },
            {
              field: {
                isDefault: true,
              },
              title: "Default",
              type: FieldType.Boolean,
              getElement: (item: AIAgent): ReactElement => {
                if (item.isDefault) {
                  return <Pill text="Default" color={Green} />;
                }
                return <span className="text-gray-400">-</span>;
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              type: FieldType.EntityArray,

              getElement: (item: AIAgent): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ]}
        />
      </>
    </Fragment>
  );
};

export default AIAgentsPage;
