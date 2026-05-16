import TeamElement from "../../../Components/Team/Team";
import UserElement from "../../../Components/User/User";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DashboardOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<DashboardOwnerTeam>
        modelType={DashboardOwnerTeam}
        id="table-dashboard-owner-team"
        name="Dashboard > Owner Team"
        userPreferencesKey="dashboard-owner-team-table"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          dashboardId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: DashboardOwnerTeam,
        ): Promise<DashboardOwnerTeam> => {
          item.dashboardId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Here is the list of teams that own this dashboard. They will be notified about changes to this dashboard.",
        }}
        noItemsMessage={"No teams associated with this dashboard so far."}
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

            getElement: (item: DashboardOwnerTeam): ReactElement => {
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

      <ModelTable<DashboardOwnerUser>
        modelType={DashboardOwnerUser}
        id="table-dashboard-owner-user"
        name="Dashboard > Owner User"
        userPreferencesKey="dashboard-owner-user-table"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          dashboardId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: DashboardOwnerUser,
        ): Promise<DashboardOwnerUser> => {
          item.dashboardId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Here is the list of users that own this dashboard. They will be notified about changes to this dashboard.",
        }}
        noItemsMessage={"No users associated with this dashboard so far."}
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

            getElement: (item: DashboardOwnerUser): ReactElement => {
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
    </Fragment>
  );
};

export default DashboardOwners;
