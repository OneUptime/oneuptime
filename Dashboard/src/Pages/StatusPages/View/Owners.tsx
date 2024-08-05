import TeamElement from "../../../Components/Team/Team";
import UserElement from "../../../Components/User/User";
import DashboardNavigation from "../../../Utils/Navigation";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import StatusPageOwnerTeam from "Common/AppModels/Models/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/AppModels/Models/StatusPageOwnerUser";
import Team from "Common/AppModels/Models/Team";
import User from "Common/AppModels/Models/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<StatusPageOwnerTeam>
        modelType={StatusPageOwnerTeam}
        id="table-statusPage-owner-team"
        name="StatusPage > Owner Team"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          statusPageId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(
          item: StatusPageOwnerTeam,
        ): Promise<StatusPageOwnerTeam> => {
          item.statusPageId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Here is list of teams that own this status page. They will be alerted when this status page is created or updated.",
        }}
        noItemsMessage={"No teams associated with this status page so far."}
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
              projectId: DashboardNavigation.getProjectId()?.toString(),
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

            getElement: (item: StatusPageOwnerTeam): ReactElement => {
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

      <ModelTable<StatusPageOwnerUser>
        modelType={StatusPageOwnerUser}
        id="table-statusPage-owner-team"
        name="StatusPage > Owner Team"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          statusPageId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(
          item: StatusPageOwnerUser,
        ): Promise<StatusPageOwnerUser> => {
          item.statusPageId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Here is list of users that own this status page. They will be alerted when this status page is created or updated.",
        }}
        noItemsMessage={"No users associated with this status page so far."}
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
                DashboardNavigation.getProjectId()!,
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
                DashboardNavigation.getProjectId()!,
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

            getElement: (item: StatusPageOwnerUser): ReactElement => {
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

export default StatusPageOwners;
