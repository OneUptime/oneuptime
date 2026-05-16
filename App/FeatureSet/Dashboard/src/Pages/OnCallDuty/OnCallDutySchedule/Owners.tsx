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
import OnCallDutyPolicyScheduleOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const OnCallDutyScheduleOwners: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<OnCallDutyPolicyScheduleOwnerTeam>
        modelType={OnCallDutyPolicyScheduleOwnerTeam}
        id="table-on-call-schedule-owner-team"
        userPreferencesKey="on-call-schedule-owner-team-table"
        name="On-Call Schedule > Owner Team"
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          onCallDutyPolicyScheduleId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: OnCallDutyPolicyScheduleOwnerTeam,
        ): Promise<OnCallDutyPolicyScheduleOwnerTeam> => {
          item.onCallDutyPolicyScheduleId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Here is list of teams that own this on-call schedule. They will be alerted when this on-call schedule is created or updated.",
        }}
        noItemsMessage={
          "No teams associated with this on-call schedule so far."
        }
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
            getElement: (
              item: OnCallDutyPolicyScheduleOwnerTeam,
            ): ReactElement => {
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

      <ModelTable<OnCallDutyPolicyScheduleOwnerUser>
        modelType={OnCallDutyPolicyScheduleOwnerUser}
        id="table-on-call-schedule-owner-user"
        userPreferencesKey="on-call-schedule-owner-user-table"
        name="On-Call Schedule > Owner User"
        isDeleteable={true}
        singularName="User"
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createVerb={"Add"}
        query={{
          onCallDutyPolicyScheduleId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: OnCallDutyPolicyScheduleOwnerUser,
        ): Promise<OnCallDutyPolicyScheduleOwnerUser> => {
          item.onCallDutyPolicyScheduleId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Here is list of users that own this on-call schedule. They will be alerted when this on-call schedule is created or updated.",
        }}
        noItemsMessage={
          "No users associated with this on-call schedule so far."
        }
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
            getElement: (
              item: OnCallDutyPolicyScheduleOwnerUser,
            ): ReactElement => {
              if (!item["user"]) {
                return <p>-</p>;
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

export default OnCallDutyScheduleOwners;
