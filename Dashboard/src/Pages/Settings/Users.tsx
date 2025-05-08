import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUser from "Common/Models/DatabaseModels/ProjectUser";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import UserElement from "../../Components/User/User";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Team from "Common/Models/DatabaseModels/Team";
import TeamsElement from "../../Components/Team/TeamsElement";
import Route from "Common/Types/API/Route";
import { RouteUtil } from "../../Utils/RouteMap";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [showInviteUserModal, setShowInviteUserModal] =
    React.useState<boolean>(false);
  const [isFilterApplied, setIsFilterApplied] = React.useState<boolean>(false);

  return (
    <Fragment>
      <ModelTable<ProjectUser>
        modelType={ProjectUser}
        id="teams-table"
        name="Settings > Users"
        userPreferencesKey="users-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        onFilterApplied={(isApplied: boolean) => {
          setIsFilterApplied(isApplied);
        }}
        isViewable={true}
        cardProps={{
          title: "Users",
          description: "Here is a list of all the users in this project.",
          buttons: [
            {
              title: "Invite User",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Add,
              onClick: () => {
                setShowInviteUserModal(true);
              },
            },
          ],
        }}
        noItemsMessage={
          isFilterApplied
            ? "No users found"
            : "Please wait, we are refreshing the list of users for this project. Please try again in sometime."
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showRefreshButton={true}
        onViewPage={(item: ProjectUser) => {
          const viewPageRoute: string =
            RouteUtil.populateRouteParams(props.pageRoute).toString() +
            "/" +
            item.user?.id?.toString();
          // add user id to the route
          return Promise.resolve(new Route(viewPageRoute));
        }}
        filters={[
          {
            field: {
              acceptedTeams: {
                name: true,
              },
            },
            title: "Teams member of",
            type: FieldType.EntityArray,
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
              invitedTeams: {
                name: true,
              },
            },
            title: "Teams invited to",
            type: FieldType.EntityArray,
            filterEntityType: Team,
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
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Element,
            getElement: (item: ProjectUser) => {
              if (!item.user) {
                return <p>User not found</p>;
              }
              return <UserElement user={item.user!} />;
            },
          },
          {
            field: {
              acceptedTeams: {
                name: true,
              },
            },
            title: "Teams member of",
            type: FieldType.Element,
            getElement: (item: ProjectUser) => {
              return <TeamsElement teams={item.acceptedTeams || []} />;
            },
          },
          {
            field: {
              invitedTeams: {
                name: true,
              },
            },
            title: "Teams invited to",
            type: FieldType.Element,
            getElement: (item: ProjectUser) => {
              return <TeamsElement teams={item.invitedTeams || []} />;
            },
          },
        ]}
      />
      {showInviteUserModal && (
        <ModelFormModal<TeamMember>
          modelType={TeamMember}
          name="Invite New User"
          title="Invite New User"
          description="Invite new user to this project."
          onClose={() => {
            setShowInviteUserModal(false);
          }}
          submitButtonText="Invite"
          onSuccess={(teamMember: TeamMember | null) => {
            // go to users page.
            if (teamMember) {
              const userId: string =
                teamMember.user?.id?.toString() ||
                teamMember.userId?.toString() ||
                "";
              const viewPageRoute: string =
                RouteUtil.populateRouteParams(props.pageRoute).toString() +
                "/" +
                userId;
              Navigation.navigate(new Route(viewPageRoute));
            }
            setShowInviteUserModal(false);
          }}
          formProps={{
            name: "Create New Project",
            modelType: TeamMember,
            id: "create-project-from",
            fields: [
              {
                field: {
                  user: true,
                },
                title: "User Email",
                description:
                  "Please enter the email of the user you would like to invite. We will send them an email to let them know they have been invited to team you have selected.",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                placeholder: "member@company.com",
                overrideFieldKey: "email",
              },
              {
                field: {
                  team: true,
                },
                title: "Team",
                description:
                  "Select the team you would like to add this user to.",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownModal: {
                  type: Team,
                  labelField: "name",
                  valueField: "_id",
                },
                placeholder: "Select a team",
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
    </Fragment>
  );
};

export default Teams;
