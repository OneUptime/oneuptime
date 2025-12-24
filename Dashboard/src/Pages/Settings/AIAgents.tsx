import AIAgentStatusElement from "../../Components/AIAgent/AIAgentStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AIAgentElement from "Common/UI/Components/AIAgent/AIAgent";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import LabelsElement from "Common/UI/Components/Label/Labels";

const AIAgentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentAIAgent, setCurrentAIAgent] = useState<AIAgent | null>(null);

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

        <Banner
          openInNewTab={true}
          title="Need help with setting up Custom AI Agents?"
          description="Here is a guide which will help you get set up"
          link={Route.fromString("/docs/ai/ai-agent")}
          hideOnMobile={true}
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
          selectMoreFields={{
            key: true,
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
          actionButtons={[
            {
              title: "Show ID and Key",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: AIAgent,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setCurrentAIAgent(item);
                  setShowKeyModal(true);

                  onCompleteAction();
                } catch (err) {
                  onCompleteAction();
                  onError(err as Error);
                }
              },
            },
          ]}
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

        {showKeyModal && currentAIAgent ? (
          <ConfirmModal
            title={`AI Agent Key`}
            description={
              <div>
                <span>
                  Here is your AI agent key. Please keep this a secret.
                </span>
                <br />
                <br />
                <span>
                  <b>AI Agent ID: </b> {currentAIAgent["_id"]?.toString()}
                </span>
                <br />
                <br />
                <span>
                  <b>AI Agent Key: </b> {currentAIAgent["key"]?.toString()}
                </span>
              </div>
            }
            submitButtonText={"Close"}
            submitButtonType={ButtonStyleType.NORMAL}
            onSubmit={async () => {
              setShowKeyModal(false);
            }}
          />
        ) : (
          <></>
        )}
      </>
    </Fragment>
  );
};

export default AIAgentsPage;
