import RunbookAgentInstallInstructions from "../../Components/RunbookAgent/InstallInstructions";
import TeamElement from "../../Components/Team/Team";
import UserElement from "../../Components/User/User";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import RunbookAgent, {
  RunbookAgentConnectionStatus,
} from "Common/Models/DatabaseModels/RunbookAgent";
import RunbookAgentOwnerTeam from "Common/Models/DatabaseModels/RunbookAgentOwnerTeam";
import RunbookAgentOwnerUser from "Common/Models/DatabaseModels/RunbookAgentOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const RunbookAgentView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());
  const [agentKey, setAgentKey] = useState<string | null>(null);

  return (
    <Fragment>
      <CardModelDetail<RunbookAgent>
        name="Runbook Agent Details"
        cardProps={{
          title: "Runbook Agent Details",
          description: "Here are more details for this runbook agent.",
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-eu-runbook-agent",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Runs inside the production EU cluster. Can reach internal services.",
          },
          {
            field: { labels: true },
            title: "Labels",
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
          onItemLoaded: (item: RunbookAgent) => {
            if (item.key) {
              setAgentKey(item.key as string);
            }
          },
          modelType: RunbookAgent,
          id: "model-detail-runbook-agent",
          fields: [
            {
              field: { _id: true },
              title: "Runbook Agent ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: { name: true },
              title: "Name",
            },
            {
              field: { description: true },
              title: "Description",
            },
            {
              field: { key: true },
              title: "Agent Key",
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
              getElement: (item: RunbookAgent): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<RunbookAgent>
        name="Runbook Agent Status"
        cardProps={{
          title: "Runbook Agent Status",
          description:
            "Here is more details on the connection status for this runbook agent.",
        }}
        isEditable={false}
        modelDetailProps={{
          modelType: RunbookAgent,
          id: "model-detail-runbook-agent-status",
          fields: [
            {
              field: { connectionStatus: true },
              title: "Connection Status",
              fieldType: FieldType.Element,
              getElement: (item: RunbookAgent): ReactElement => {
                const isConnected: boolean =
                  item.connectionStatus ===
                  RunbookAgentConnectionStatus.Connected;
                return (
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        isConnected ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />
                    <span
                      className={`text-sm font-medium ${
                        isConnected ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {isConnected ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                );
              },
            },
            {
              field: { lastAlive: true },
              title: "Last Heartbeat",
              fieldType: FieldType.DateTime,
            },
            {
              field: { agentVersion: true },
              title: "Agent Version",
              fieldType: FieldType.Text,
            },
          ],
          modelId: modelId,
        }}
      />

      {agentKey && (
        <Card
          title="Setup Instructions"
          description={
            <div className="mt-5">
              <RunbookAgentInstallInstructions
                agentId={modelId}
                agentKey={agentKey}
              />
            </div>
          }
        />
      )}

      <ModelTable<RunbookAgentOwnerTeam>
        modelType={RunbookAgentOwnerTeam}
        id="table-runbook-agent-owner-team"
        userPreferencesKey="runbook-agent-owner-team-table"
        name="Runbook Agent > Owner Team"
        saveFilterProps={{
          tableId: "runbook-agent-owner-team-table",
        }}
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          runbookAgentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: RunbookAgentOwnerTeam,
        ): Promise<RunbookAgentOwnerTeam> => {
          item.runbookAgentId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Here is the list of teams that own this runbook agent. They will be alerted when this runbook agent's status changes.",
        }}
        noItemsMessage={"No teams associated with this runbook agent so far."}
        formFields={[
          {
            field: { team: true },
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
            field: { team: true },
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
            field: { createdAt: true },
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
            getElement: (item: RunbookAgentOwnerTeam): ReactElement => {
              if (!item["team"]) {
                throw new BadDataException("Team not found");
              }
              return <TeamElement team={item["team"] as Team} />;
            },
          },
          {
            field: { createdAt: true },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelTable<RunbookAgentOwnerUser>
        modelType={RunbookAgentOwnerUser}
        id="table-runbook-agent-owner-user"
        userPreferencesKey="runbook-agent-owner-user-table"
        name="Runbook Agent > Owner User"
        saveFilterProps={{
          tableId: "runbook-agent-owner-user-table",
        }}
        singularName="User"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          runbookAgentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: RunbookAgentOwnerUser,
        ): Promise<RunbookAgentOwnerUser> => {
          item.runbookAgentId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Here is the list of users that own this runbook agent. They will be alerted when this runbook agent's status changes.",
        }}
        noItemsMessage={"No users associated with this runbook agent so far."}
        formFields={[
          {
            field: { user: true },
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
            field: { user: true },
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
            field: { createdAt: true },
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
            getElement: (item: RunbookAgentOwnerUser): ReactElement => {
              if (!item["user"]) {
                throw new BadDataException("User not found");
              }
              return <UserElement user={item["user"] as User} />;
            },
          },
          {
            field: { createdAt: true },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ResetObjectID<RunbookAgent>
        modelType={RunbookAgent}
        onUpdateComplete={async () => {
          Navigation.reload();
        }}
        fieldName={"key"}
        title={"Reset Runbook Agent Key"}
        description={
          <p className="mt-2">
            Resetting the secret key will generate a new key. The secret is used
            to authenticate runbook agent requests. Existing agents will stop
            connecting until the new key is configured on them.
          </p>
        }
        modelId={modelId}
      />

      <ModelDelete
        modelType={RunbookAgent}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_AGENTS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default RunbookAgentView;
