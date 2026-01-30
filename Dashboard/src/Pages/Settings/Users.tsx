import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import UserElement from "../../Components/User/User";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import Team from "Common/Models/DatabaseModels/Team";
import TeamElement from "../../Components/Team/Team";
import Route from "Common/Types/API/Route";
import { RouteUtil } from "../../Utils/RouteMap";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Banner from "Common/UI/Components/Banner/Banner";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import TeamMemberCustomFields from "./TeamMemberCustomFields";

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [showInviteUserModal, setShowInviteUserModal] =
    React.useState<boolean>(false);
  const [showScimErrorModal, setShowScimErrorModal] =
    React.useState<boolean>(false);
  const [isFilterApplied, setIsFilterApplied] = React.useState<boolean>(false);
  const [isPushGroupsManaged, setIsPushGroupsManaged] =
    React.useState<boolean>(false);

  React.useEffect(() => {
    const checkScim: () => Promise<void> = async () => {
      if (!props.currentProject || !props.currentProject._id) {
        return;
      }
      try {
        const scimCount: number = await ModelAPI.count<ProjectSCIM>({
          modelType: ProjectSCIM,
          query: {
            projectId: props.currentProject._id,
            enablePushGroups: true,
          },
        });
        setIsPushGroupsManaged(scimCount > 0);
      } catch {
        // ignore
      }
    };
    checkScim();
  }, [props.currentProject]);

  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Users",
            children: (
              <Fragment>
                {isPushGroupsManaged && (
                  <Banner
                    title="Users are managed by SCIM Push Groups"
                    description="Invite or remove users from your identity provider or disable Push Groups in Settings > SCIM to manage them here."
                  />
                )}

                <ModelTable<TeamMember>
        modelType={TeamMember}
        id="teams-table"
        name="Settings > Users"
        userPreferencesKey="users-table"
        isDeleteable={!isPushGroupsManaged}
        bulkActions={
          !isPushGroupsManaged
            ? {
                buttons: [ModalTableBulkDefaultActions.Delete],
              }
            : undefined
        }
        isEditable={false}
        isCreateable={false}
        onFilterApplied={(isApplied: boolean) => {
          setIsFilterApplied(isApplied);
        }}
        isViewable={true}
        onBeforeDelete={async (item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot remove team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          return item;
        }}
        cardProps={{
          title: "Users",
          description:
            "Here is a list of all the team members in this project.",
          buttons: [
            {
              title: "Invite User",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Add,
              onClick: () => {
                if (isPushGroupsManaged) {
                  setShowScimErrorModal(true);
                } else {
                  setShowInviteUserModal(true);
                }
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
        onViewPage={(item: TeamMember) => {
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
              team: {
                name: true,
              },
            },
            title: "Team",
            type: FieldType.Entity,
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
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Boolean,
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
            getElement: (item: TeamMember) => {
              if (!item.user) {
                return <p>User not found</p>;
              }
              return <UserElement user={item.user!} />;
            },
          },
          {
            field: {
              team: {
                name: true,
                _id: true,
              },
            },
            title: "Team",
            type: FieldType.Element,
            getElement: (item: TeamMember) => {
              if (!item.team) {
                return <p>No team assigned</p>;
              }
              return <TeamElement team={item.team!} />;
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: TeamMember) => {
              if (item.hasAcceptedInvitation) {
                return <Pill text="Member" color={Green} />;
              }
              return <Pill text="Invitation Sent" color={Yellow} />;
            },
          },
        ]}
                />
                {showInviteUserModal && !isPushGroupsManaged && (
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
                          RouteUtil.populateRouteParams(
                            props.pageRoute,
                          ).toString() +
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
                {showScimErrorModal && (
                  <ConfirmModal
                    title="Users are managed by SCIM Push Groups"
                    description="Team membership is being managed by your identity provider. Disable Push Groups in Settings > SCIM if you need to invite or promote users from OneUptime."
                    onSubmit={() => {
                      setShowScimErrorModal(false);
                    }}
                    submitButtonText="Close"
                  />
                )}
              </Fragment>
            ),
          },
          {
            name: "Custom Fields",
            children: <TeamMemberCustomFields {...props} />,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default Teams;
