import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Yellow } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

const ProjectUserView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const userId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const projectId: ObjectID = Navigation.getLastParamAsObjectID(2);

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const teamMembers: ListResult<TeamMember> =
        await AdminModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: userId,
            projectId: projectId,
          },
          select: {
            user: {
              _id: true,
              name: true,
              email: true,
            },
          },
          sort: {},
          skip: 0,
          limit: 1,
        });

      if (teamMembers.data.length === 0 || !teamMembers.data[0]?.user) {
        setError("User not found in this project.");
        return;
      }

      setUser(teamMembers.data[0].user);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUser().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Exception));
    });
  }, []);

  return (
    <ModelPage<Project>
      modelId={projectId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectUserView.title")}
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
        {
          title: t("breadcrumbs.projectUser"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_USER_VIEW] as Route,
            { modelId: projectId, subModelId: userId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={projectId} />}
    >
      <Fragment>
        {isLoading && <PageLoader isVisible={true} />}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && user && (
          <Fragment>
            <Card
              title={
                user.name?.toString() ||
                user.email?.toString() ||
                t("pages.projectUserView.cardTitle")
              }
              description={t("pages.projectUserView.cardDescription")}
            >
              <Detail<User>
                item={user}
                fields={[
                  {
                    key: "name",
                    title: "Name",
                    fieldType: FieldType.Name,
                    placeholder: "-",
                  },
                  {
                    key: "email",
                    title: "Email",
                    fieldType: FieldType.Email,
                    placeholder: "-",
                  },
                  {
                    key: "_id",
                    title: "User ID",
                    fieldType: FieldType.ObjectID,
                  },
                ]}
              />
            </Card>

            <ModelTable<TeamMember>
              modelType={TeamMember}
              modelAPI={AdminModelAPI}
              id="project-user-teams-table"
              userPreferencesKey="admin-project-user-teams-table"
              isDeleteable={true}
              name="Admin > Project > User > Teams"
              createVerb="Add to Team"
              isCreateable={true}
              isEditable={false}
              isViewable={false}
              query={{
                userId: userId,
                projectId: projectId,
              }}
              onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
                if (!projectId) {
                  throw new BadDataException("Project ID cannot be null");
                }
                item.userId = userId;
                item.projectId = projectId;
                return Promise.resolve(item);
              }}
              cardProps={{
                title: t("pages.projectUserView.teamsCardTitle"),
                description: t("pages.projectUserView.teamsCardDescription"),
              }}
              noItemsMessage={t("pages.projectUserView.teamsNoItems")}
              formFields={[
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
                  placeholder: "Select Team",
                },
              ]}
              showRefreshButton={true}
              deleteButtonText="Remove"
              filters={[
                {
                  field: {
                    team: {
                      name: true,
                    },
                  },
                  type: FieldType.Entity,
                  title: "Team",
                  filterEntityType: Team,
                  filterQuery: {
                    projectId: projectId,
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
          </Fragment>
        )}
      </Fragment>
    </ModelPage>
  );
};

export default ProjectUserView;
