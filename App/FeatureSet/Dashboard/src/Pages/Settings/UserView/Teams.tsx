import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUser from "../../../Utils/ProjectUser";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Team from "Common/Models/DatabaseModels/Team";
import TeamElement from "../../../Components/Team/Team";

const UserViewTeams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-User-member"
        userPreferencesKey="user-member-table"
        saveFilterProps={{
          tableId: "settings-user-view-members-table",
        }}
        isDeleteable={true}
        name="Settings > User > Member"
        createVerb={"Invite"}
        isCreateable={true}
        isViewable={false}
        query={{
          userId: userId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.userId = userId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        singularName=" "
        pluralName=" "
        cardProps={{
          title: "Teams",
          description: "See a list of teams this user is a members of.",
        }}
        noItemsMessage={"This user is not a member of any team."}
        formFields={[
          {
            field: {
              team: true,
            },
            title: "Team",
            description: "Select the team you would like to add this user to.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Team",
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove"
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              team: true,
            },
            type: FieldType.Entity,
            title: "Team",
            filterEntityType: Team,
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
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
                _id: true,
              },
            },
            title: "Team",
            type: FieldType.Element,
            getElement: (item: TeamMember): ReactElement => {
              if (item["team"]) {
                return <TeamElement team={item["team"]!} />;
              }

              return <></>;
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: TeamMember): ReactElement => {
              if (item["hasAcceptedInvitation"]) {
                return <Pill text="Member" color={Green} />;
              }
              return <Pill text="Invitation Sent" color={Yellow} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default UserViewTeams;
