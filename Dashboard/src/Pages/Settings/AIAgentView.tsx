import LabelsElement from "Common/UI/Components/Label/Labels";
import UserElement from "../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import AIAgentOwnerTeam from "Common/Models/DatabaseModels/AIAgentOwnerTeam";
import AIAgentOwnerUser from "Common/Models/DatabaseModels/AIAgentOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import TeamElement from "../../Components/Team/Team";
import Team from "Common/Models/DatabaseModels/Team";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import AIAgentStatusElement from "../../Components/AIAgent/AIAgentStatus";
import CustomAIAgentDocumentation from "../../Components/AIAgent/CustomAIAgentDocumentation";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const AIAgentView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  const [aiAgentKey, setAIAgentKey] = useState<string | null>(null);

  return (
    <Fragment>
      {/* AI Agent View  */}
      <CardModelDetail<AIAgent>
        name="AI Agent Details"
        cardProps={{
          title: "AI Agent Details",
          description: "Here are more details for this AI agent.",
        }}
        isEditable={true}
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
            required: false,
            placeholder: "This AI agent handles incident triage and response.",
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
        modelDetailProps={{
          onItemLoaded: (item: AIAgent) => {
            if (item.key) {
              setAIAgentKey(item.key);
            }
          },
          modelType: AIAgent,
          id: "model-detail-ai-agent",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "AI Agent ID",
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
            },
            {
              field: {
                key: true,
              },
              title: "AI Agent Key",
              fieldType: FieldType.HiddenText,
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: AIAgent): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<AIAgent>
        name="AI Agent Status"
        cardProps={{
          title: "AI Agent Status",
          description:
            "Here is more details on the connection status for this AI agent.",
        }}
        isEditable={false}
        modelDetailProps={{
          modelType: AIAgent,
          id: "model-detail-ai-agent-status",
          fields: [
            {
              field: {
                lastAlive: true,
              },
              title: "Last Ping Time",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                connectionStatus: true,
              },
              title: "Connection Status",
              fieldType: FieldType.Element,
              getElement: (item: AIAgent): ReactElement => {
                return <AIAgentStatusElement aiAgent={item} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {aiAgentKey && (
        <CustomAIAgentDocumentation aiAgentKey={aiAgentKey} aiAgentId={modelId} />
      )}

      <ModelTable<AIAgentOwnerTeam>
        modelType={AIAgentOwnerTeam}
        id="table-ai-agent-owner-team"
        userPreferencesKey="ai-agent-owner-team-table"
        name="AI Agent > Owner Team"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          aiAgentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: AIAgentOwnerTeam): Promise<AIAgentOwnerTeam> => {
          item.aiAgentId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Here is list of teams that own this AI agent. They will be alerted when this AI agent status changes.",
        }}
        noItemsMessage={"No teams associated with this AI agent so far."}
        formFields={[
          {
            field: {
              team: true,
            },
            title: "Team",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Team",
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              team: true,
            },
            type: FieldType.Entity,
            title: "Team",
            filterEntityType: Team,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
              },
            },
            title: "Team",
            type: FieldType.Entity,
            getElement: (item: AIAgentOwnerTeam): ReactElement => {
              if (!item["team"]) {
                throw new BadDataException("Team not found");
              }

              return <TeamElement team={item["team"] as Team} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelTable<AIAgentOwnerUser>
        modelType={AIAgentOwnerUser}
        id="table-ai-agent-owner-user"
        name="AI Agent > Owner User"
        userPreferencesKey="ai-agent-owner-user-table"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          aiAgentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: AIAgentOwnerUser): Promise<AIAgentOwnerUser> => {
          item.aiAgentId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Here is list of users that own this AI agent. They will be alerted when this AI agent status changes.",
        }}
        noItemsMessage={"No users associated with this AI agent so far."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select User",
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              user: true,
            },
            title: "User",
            type: FieldType.Entity,
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Entity,
            getElement: (item: AIAgentOwnerUser): ReactElement => {
              if (!item["user"]) {
                throw new BadDataException("User not found");
              }

              return <UserElement user={item["user"] as User} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ResetObjectID<AIAgent>
        modelType={AIAgent}
        onUpdateComplete={async () => {
          Navigation.reload();
        }}
        fieldName={"key"}
        title={"Reset AI Agent Key"}
        description={
          <p className="mt-2">
            Resetting the secret key will generate a new key. Secret is used to
            authenticate AI agent requests.
          </p>
        }
        modelId={modelId}
      />

      {/* Delete AI Agent */}
      <ModelDelete
        modelType={AIAgent}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route);
        }}
      />
    </Fragment>
  );
};

export default AIAgentView;
