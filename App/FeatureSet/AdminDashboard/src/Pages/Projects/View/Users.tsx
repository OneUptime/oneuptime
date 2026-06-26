import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { Green, Yellow } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

const ProjectUsers: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const projectId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showInviteUserModal, setShowInviteUserModal] =
    useState<boolean>(false);
  const [isFilterApplied, setIsFilterApplied] = useState<boolean>(false);

  return (
    <ModelPage<Project>
      modelId={projectId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectUsers.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.projects"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECTS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.project"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_VIEW] as Route,
            { modelId: projectId },
          ),
        },
        {
          title: t("breadcrumbs.projectUsers"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_USERS] as Route,
            { modelId: projectId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={projectId} />}
    >
      <Fragment>
        <ModelTable<TeamMember>
          modelType={TeamMember}
          modelAPI={AdminModelAPI}
          id="project-users-table"
          name="Admin > Project > Users"
          userPreferencesKey="admin-project-users-table"
          isDeleteable={true}
          bulkActions={{
            buttons: [ModalTableBulkDefaultActions.Delete],
          }}
          isEditable={false}
          isCreateable={false}
          isViewable={true}
          onFilterApplied={(isApplied: boolean) => {
            setIsFilterApplied(isApplied);
          }}
          cardProps={{
            title: t("pages.projectUsers.cardTitle"),
            description: t("pages.projectUsers.cardDescription"),
            buttons: [
              {
                title: t("pages.projectUsers.inviteUser"),
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
              ? t("pages.projectUsers.noItemsFiltered")
              : t("pages.projectUsers.noItems")
          }
          query={{
            projectId: projectId,
          }}
          showRefreshButton={true}
          onViewPage={(item: TeamMember) => {
            const userId: string = item.user?.id?.toString() || "";
            return Promise.resolve(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
                { modelId: projectId, subModelId: new ObjectID(userId) },
              ),
            );
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
                projectId: projectId,
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
                },
              },
              title: "User",
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (!item.user) {
                  return <p>-</p>;
                }
                const name: string =
                  item.user.name?.toString() ||
                  item.user.email?.toString() ||
                  "-";
                return (
                  <div>
                    <p className="font-medium">{name}</p>
                    {item.user.email ? (
                      <p className="text-xs text-gray-500">
                        {item.user.email.toString()}
                      </p>
                    ) : null}
                  </div>
                );
              },
            },
            {
              field: {
                team: {
                  name: true,
                },
              },
              title: "Team",
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (!item.team) {
                  return <p>-</p>;
                }
                return <p>{item.team.name?.toString() || "-"}</p>;
              },
            },
            {
              field: {
                hasAcceptedInvitation: true,
              },
              title: "Status",
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (item.hasAcceptedInvitation) {
                  return <Pill text="Member" color={Green} />;
                }
                return <Pill text="Invitation Sent" color={Yellow} />;
              },
            },
          ]}
        />

        {showInviteUserModal && (
          <ModelFormModal<TeamMember>
            modelType={TeamMember}
            modelAPI={AdminModelAPI}
            name="Invite New User"
            title={t("pages.projectUsers.inviteUserTitle")}
            description={t("pages.projectUsers.inviteUserDescription")}
            onClose={() => {
              setShowInviteUserModal(false);
            }}
            submitButtonText={t("pages.projectUsers.inviteUserSubmit")}
            onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
              item.projectId = projectId;
              return Promise.resolve(item);
            }}
            onSuccess={(teamMember: TeamMember) => {
              const userId: string =
                teamMember.user?.id?.toString() ||
                teamMember.userId?.toString() ||
                "";
              if (userId) {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
                    {
                      modelId: projectId,
                      subModelId: new ObjectID(userId),
                    },
                  ),
                );
              }
              setShowInviteUserModal(false);
            }}
            formProps={{
              name: "Invite User",
              modelType: TeamMember,
              modelAPI: AdminModelAPI,
              id: "invite-user-form",
              fields: [
                {
                  field: {
                    user: true,
                  },
                  title: "User Name",
                  description:
                    "Enter the name of the user you would like to invite. This is optional and will only be used if this user does not already have an account.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "John Smith",
                  overrideFieldKey: "name",
                },
                {
                  field: {
                    user: true,
                  },
                  title: "User Email",
                  description:
                    "Enter the email of the user you would like to invite. We will send them an email letting them know they have been invited to the team you selected.",
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
                  fetchDropdownOptions: async (): Promise<
                    Array<DropdownOption>
                  > => {
                    const teams: ListResult<Team> =
                      await AdminModelAPI.getList<Team>({
                        modelType: Team,
                        query: { projectId: projectId },
                        limit: LIMIT_PER_PROJECT,
                        skip: 0,
                        select: {
                          _id: true,
                          name: true,
                        },
                        sort: { name: SortOrder.Ascending },
                      });
                    return teams.data.map((team: Team) => {
                      return {
                        label: team.name?.toString() || "",
                        value: team._id?.toString() || "",
                      };
                    });
                  },
                  placeholder: "Select a team",
                },
              ],
              formType: FormType.Create,
            }}
          />
        )}
      </Fragment>
    </ModelPage>
  );
};

export default ProjectUsers;
