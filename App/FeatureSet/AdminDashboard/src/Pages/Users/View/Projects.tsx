import AdminModelAPI from "../../../Utils/ModelAPI";
import AdminUserProjectsModelAPI from "../../../Utils/UserProjectsModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import ProjectScopedTeamsPicker, {
  resolveProjectIdFromFormValue,
  selectedTeamIdsFromFormValue,
} from "../../../Components/GlobalProvider/ProjectScopedTeamsPicker";
import Route from "Common/Types/API/Route";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { UserProjectRow } from "Common/UI/Utils/ModelAPI/UserProjectsModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Everything this user belongs to, across every project on the instance.
 *
 * Two tables, because a row means two different things and conflating them is
 * what makes a "remove" button ambiguous:
 *
 *  - Projects: one row per project, carrying every team the user is on there.
 *    Removing a row removes them from the whole project.
 *  - Team memberships: one row per (project, team). Removing a row removes them
 *    from that one team and leaves the rest alone.
 *
 * Adding is a single flow - pick a project, then a team of that project -
 * because a TeamMember cannot exist without both.
 */
const UserProjects: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showAddToProjectModal, setShowAddToProjectModal] =
    useState<boolean>(false);

  /*
   * Both tables read the same memberships, so any write to one has to refresh
   * the other: removing a user from their last team in a project must drop the
   * project row too, and adding them to a new project must add both rows.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>("0");

  type RefreshFunction = () => void;

  const refreshTables: RefreshFunction = (): void => {
    setRefreshToggle((current: string) => {
      return (Number(current) + 1).toString();
    });
  };

  type TeamPillsFunction = (teams: Array<Team>) => ReactElement;

  const getTeamPills: TeamPillsFunction = (
    teams: Array<Team>,
  ): ReactElement => {
    if (!teams || teams.length === 0) {
      return <p>{t("pages.userProjects.noTeams")}</p>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {teams.map((team: Team, index: number) => {
          return (
            <Pill
              key={team._id?.toString() || index.toString()}
              text={team.name?.toString() || "-"}
              color={Green}
            />
          );
        })}
      </div>
    );
  };

  return (
    <ModelPage<User>
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      modelAPI={AdminModelAPI}
      title={t("pages.userProjects.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: t("breadcrumbs.user"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_VIEW] as Route,
            {
              modelId: modelId,
            },
          ),
        },
        {
          title: t("breadcrumbs.userProjects"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_PROJECTS] as Route,
            {
              modelId: modelId,
            },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <Fragment>
        <ModelTable<TeamMember>
          modelType={TeamMember}
          /*
           * One row per project, not per team membership - see
           * UserProjectsModelAPI. The plain API would list a user who is on
           * three teams of one project as three rows of the same project.
           */
          modelAPI={AdminUserProjectsModelAPI}
          singularName="Project"
          pluralName="Projects"
          id="user-projects-table"
          name="Admin > User > Projects"
          userPreferencesKey="admin-user-projects-table"
          isDeleteable={true}
          deleteButtonText={t("pages.userProjects.removeFromProject")}
          isEditable={false}
          isCreateable={false}
          isViewable={true}
          refreshToggle={refreshToggle}
          onItemDeleted={() => {
            refreshTables();
          }}
          cardProps={{
            title: t("pages.userProjects.cardTitle"),
            description: t("pages.userProjects.cardDescription"),
            buttons: [
              {
                title: t("pages.userProjects.addToProject"),
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Add,
                onClick: () => {
                  setShowAddToProjectModal(true);
                },
              },
            ],
          }}
          noItemsMessage={t("pages.userProjects.noItems")}
          query={{
            userId: modelId,
          }}
          showRefreshButton={true}
          onViewPage={(item: TeamMember) => {
            const projectId: string =
              item.projectId?.toString() || item.project?._id?.toString() || "";

            if (!projectId) {
              /*
               * Nothing to view without a project. Stay where we are rather
               * than navigating to a route with an empty id in it.
               */
              return Promise.resolve(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.USER_PROJECTS] as Route,
                  {
                    modelId: modelId,
                  },
                ),
              );
            }

            /*
             * The project's own view of this user, where their teams in that
             * project are managed alongside the rest of the project.
             */
            return Promise.resolve(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
                {
                  modelId: new ObjectID(projectId),
                  subModelId: modelId,
                },
              ),
            );
          }}
          filters={[]}
          columns={[
            {
              field: {
                project: {
                  name: true,
                },
              },
              title: t("pages.userProjects.columnProject"),
              type: FieldType.Element,
              /*
               * The endpoint sorts by project name and pages over the grouped
               * list, so a sort control here would do nothing. Better no
               * control than one that visibly does not sort.
               */
              disableSort: true,
              getElement: (item: TeamMember): ReactElement => {
                if (!item.project) {
                  return <p>-</p>;
                }

                return (
                  <div>
                    <p className="font-medium">
                      {item.project.name?.toString() || "-"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.projectId?.toString() ||
                        item.project._id?.toString() ||
                        ""}
                    </p>
                  </div>
                );
              },
              getExportValue: (item: TeamMember): string => {
                return item.project?.name?.toString() || "";
              },
            },
            {
              field: {
                team: {
                  name: true,
                },
              },
              title: t("pages.userProjects.columnTeams"),
              type: FieldType.Element,
              disableSort: true,
              getElement: (item: TeamMember): ReactElement => {
                return getTeamPills((item as UserProjectRow).teamsForProject);
              },
              /*
               * Without this the CSV exporter falls back to the column's
               * `field` and writes `item.team` - which a grouped row does not
               * carry - so the export would disagree with the cell next to it.
               */
              getExportValue: (item: TeamMember): string => {
                return ((item as UserProjectRow).teamsForProject || [])
                  .map((team: Team) => {
                    return team.name?.toString() || "";
                  })
                  .filter((name: string) => {
                    return Boolean(name);
                  })
                  .join("; ");
              },
            },
            {
              field: {
                hasAcceptedInvitation: true,
              },
              title: t("pages.userProjects.columnStatus"),
              type: FieldType.Element,
              disableSort: true,
              getElement: (item: TeamMember): ReactElement => {
                if (!item.hasAcceptedInvitation) {
                  return (
                    <Pill
                      text={t("pages.userProjects.statusInvited")}
                      color={Yellow}
                    />
                  );
                }

                /*
                 * Accepted on at least one team makes them a member of the
                 * project. Any team they have not accepted yet is called out
                 * next to it, because that state is otherwise invisible on a
                 * row that no longer shows one team at a time.
                 */
                const pendingTeamCount: number =
                  (item as UserProjectRow).pendingTeamCountForProject || 0;

                return (
                  <div className="flex space-x-2">
                    <Pill
                      text={t("pages.userProjects.statusMember")}
                      color={Green}
                    />
                    {pendingTeamCount > 0 && (
                      <Pill
                        text={t("pages.userProjects.pendingInvitations", {
                          pending: pendingTeamCount,
                        })}
                        color={Yellow}
                      />
                    )}
                  </div>
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: t("pages.userProjects.columnJoinedAt"),
              type: FieldType.DateTime,
              disableSort: true,
              hideOnMobile: true,
            },
          ]}
        />

        <ModelTable<TeamMember>
          modelType={TeamMember}
          modelAPI={AdminModelAPI}
          singularName="Team Membership"
          pluralName="Team Memberships"
          id="user-team-memberships-table"
          name="Admin > User > Team Memberships"
          userPreferencesKey="admin-user-team-memberships-table"
          isDeleteable={true}
          deleteButtonText={t("pages.userProjects.removeFromTeam")}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          refreshToggle={refreshToggle}
          onItemDeleted={() => {
            refreshTables();
          }}
          cardProps={{
            title: t("pages.userProjects.teamsCardTitle"),
            description: t("pages.userProjects.teamsCardDescription"),
          }}
          noItemsMessage={t("pages.userProjects.teamsNoItems")}
          query={{
            userId: modelId,
          }}
          showRefreshButton={true}
          filters={[
            {
              field: {
                project: {
                  name: true,
                },
              },
              title: t("pages.userProjects.columnProject"),
              type: FieldType.Entity,
              filterEntityType: Project,
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                hasAcceptedInvitation: true,
              },
              title: t("pages.userProjects.columnStatus"),
              type: FieldType.Boolean,
            },
          ]}
          columns={[
            {
              field: {
                project: {
                  name: true,
                },
              },
              title: t("pages.userProjects.columnProject"),
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                return <p>{item.project?.name?.toString() || "-"}</p>;
              },
            },
            {
              field: {
                team: {
                  name: true,
                },
              },
              title: t("pages.userProjects.columnTeam"),
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                return <p>{item.team?.name?.toString() || "-"}</p>;
              },
            },
            {
              field: {
                hasAcceptedInvitation: true,
              },
              title: t("pages.userProjects.columnStatus"),
              type: FieldType.Element,
              getElement: (item: TeamMember): ReactElement => {
                if (item.hasAcceptedInvitation) {
                  return (
                    <Pill
                      text={t("pages.userProjects.statusMember")}
                      color={Green}
                    />
                  );
                }

                return (
                  <Pill
                    text={t("pages.userProjects.statusInvited")}
                    color={Yellow}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: t("pages.userProjects.columnInvitedAt"),
              type: FieldType.DateTime,
              hideOnMobile: true,
            },
          ]}
        />

        {showAddToProjectModal && (
          <ModelFormModal<TeamMember>
            modelType={TeamMember}
            modelAPI={AdminModelAPI}
            name="Add User to Project"
            title={t("pages.userProjects.addToProjectTitle")}
            description={t("pages.userProjects.addToProjectDescription")}
            onClose={() => {
              setShowAddToProjectModal(false);
            }}
            submitButtonText={t("pages.userProjects.addToProjectSubmit")}
            onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
              /*
               * The form only knows the project and team it was given. The user
               * is the page's subject, and projectId has to be set explicitly:
               * a master admin sends no tenant header, so nothing else on the
               * way to the server can fill in the project column.
               */
              const projectId: string | undefined =
                item.projectId?.toString() || item.project?._id?.toString();

              if (!projectId) {
                throw new BadDataException("Please select a project.");
              }

              if (!item.teamId && !item.team?._id) {
                throw new BadDataException("Please select a team.");
              }

              item.userId = modelId;
              item.projectId = new ObjectID(projectId);

              return Promise.resolve(item);
            }}
            onSuccess={() => {
              setShowAddToProjectModal(false);
              refreshTables();
            }}
            formProps={{
              name: "Add User to Project",
              modelType: TeamMember,
              modelAPI: AdminModelAPI,
              id: "add-user-to-project-form",
              steps: [
                {
                  id: "project",
                  title: t("pages.userProjects.stepProject"),
                },
                {
                  id: "team",
                  title: t("pages.userProjects.stepTeam"),
                },
              ] as Array<FormStep<TeamMember>>,
              fields: [
                {
                  field: {
                    project: true,
                  },
                  stepId: "project",
                  title: t("pages.userProjects.fieldProject"),
                  description: t("pages.userProjects.fieldProjectDescription"),
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: Project,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: true,
                  placeholder: t("pages.userProjects.fieldProjectPlaceholder"),
                },
                {
                  field: {
                    team: true,
                  },
                  stepId: "team",
                  title: t("pages.userProjects.fieldTeam"),
                  description: t("pages.userProjects.fieldTeamDescription"),
                  /*
                   * A custom element rather than `fetchDropdownOptions`: the
                   * teams to offer depend on the project chosen in the previous
                   * step, and fetchDropdownOptions only re-runs when the form's
                   * fields change, so it would fetch before a project exists.
                   */
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: true,
                  getCustomElement: (
                    values: FormValues<TeamMember>,
                    elementProps: CustomElementProps,
                  ): ReactElement => {
                    return (
                      <ProjectScopedTeamsPicker
                        isMultiSelect={false}
                        projectId={resolveProjectIdFromFormValue(
                          (values as { project?: unknown }).project,
                        )}
                        selectedTeamIds={selectedTeamIdsFromFormValue([
                          (values as { team?: unknown }).team,
                        ])}
                        placeholder={t(
                          "pages.userProjects.fieldTeamPlaceholder",
                        )}
                        noProjectMessage={t(
                          "pages.userProjects.selectProjectFirst",
                        )}
                        onChange={(teamIds: Array<string>) => {
                          elementProps.onChange?.(teamIds[0] || "");
                        }}
                      />
                    );
                  },
                },
                {
                  field: {
                    hasAcceptedInvitation: true,
                  },
                  stepId: "team",
                  title: t("pages.userProjects.fieldAutoAccept"),
                  description: t(
                    "pages.userProjects.fieldAutoAcceptDescription",
                  ),
                  fieldType: FormFieldSchemaType.Checkbox,
                  required: false,
                  defaultValue: false,
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

export default UserProjects;
