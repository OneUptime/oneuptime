import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { useUserEmailRegistrationStatus } from "Common/UI/Utils/UserEmailRegistrationStatus";
import { JSONObject } from "Common/Types/JSON";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const ProjectTeamView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const teamId: ObjectID = Navigation.getLastParamAsObjectID(0);
  const projectId: ObjectID = Navigation.getLastParamAsObjectID(2);

  const { isEmailRegistered, checkEmail } = useUserEmailRegistrationStatus({
    getRequestHeaders: () => {
      return AdminModelAPI.getCommonHeaders();
    },
  });

  return (
    <ModelPage<Project>
      modelId={projectId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectTeamView.title")}
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
          title: t("breadcrumbs.projectTeams"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_TEAMS] as Route,
            { modelId: projectId },
          ),
        },
        {
          title: t("breadcrumbs.projectTeam"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_TEAM_VIEW] as Route,
            { modelId: projectId, subModelId: teamId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={projectId} />}
    >
      <Fragment>
        <CardModelDetail<Team>
          name="Team Details"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.projectTeamView.cardTitle"),
            description: t("pages.projectTeamView.cardDescription"),
          }}
          isEditable={true}
          editButtonText={t("pages.projectTeamView.editButton")}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Team Name",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              placeholder: "Team Description",
            },
          ]}
          modelDetailProps={{
            modelType: Team,
            id: "model-detail-team",
            fields: [
              {
                field: {
                  _id: true,
                },
                title: "Team ID",
                fieldType: FieldType.ObjectID,
              },
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                fieldType: FieldType.LongText,
              },
            ],
            modelId: teamId,
          }}
        />

        <ModelTable<TeamMember>
          modelType={TeamMember}
          modelAPI={AdminModelAPI}
          id="project-team-members-table"
          userPreferencesKey="admin-project-team-members-table"
          isDeleteable={true}
          bulkActions={{
            buttons: [ModalTableBulkDefaultActions.Delete],
          }}
          name="Admin > Project > Team > Members"
          createVerb="Invite"
          isCreateable={true}
          isViewable={false}
          query={{
            teamId: teamId,
            projectId: projectId,
          }}
          onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
            if (!projectId) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.teamId = teamId;
            item.projectId = projectId;
            return Promise.resolve(item);
          }}
          cardProps={{
            title: t("pages.projectTeamView.membersCardTitle"),
            description: t("pages.projectTeamView.membersCardDescription"),
          }}
          noItemsMessage={t("pages.projectTeamView.membersNoItems")}
          formFields={[
            {
              field: {
                user: true,
              },
              title: "Email",
              description:
                "Enter the email of the user you would like to invite. We will send them an email letting them know they have been invited to this team.",
              fieldType: FormFieldSchemaType.Email,
              required: true,
              placeholder: "member@company.com",
              overrideFieldKey: "email",
              onChange: (value: string) => {
                checkEmail(value);
              },
            },
            {
              field: {
                user: true,
              },
              title: "Name",
              description:
                "This email is not registered on OneUptime yet. Enter the name of the user you would like to invite — we will use it to set up their new account.",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "John Smith",
              overrideFieldKey: "name",
              showIf: (values: FormValues<TeamMember>): boolean => {
                return (
                  Boolean((values as JSONObject)["email"]) &&
                  isEmailRegistered === false
                );
              },
            },
          ]}
          showRefreshButton={true}
          deleteButtonText="Remove Member"
          filters={[
            {
              field: {
                hasAcceptedInvitation: true,
              },
              type: FieldType.Boolean,
              title: "Accepted Invite",
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

        <ModelDelete
          modelType={Team}
          modelId={teamId}
          modelAPI={AdminModelAPI}
          onDeleteSuccess={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_TEAMS] as Route,
                { modelId: projectId },
              ),
            );
          }}
        />
      </Fragment>
    </ModelPage>
  );
};

export default ProjectTeamView;
