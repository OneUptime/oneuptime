import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SideMenuComponent from "./SideMenu";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const ProjectTeams: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const projectId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelPage<Project>
      modelId={projectId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectTeams.title")}
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
      ]}
      sideMenu={<SideMenuComponent modelId={projectId} />}
    >
      <Fragment>
        <ModelTable<Team>
          modelType={Team}
          modelAPI={AdminModelAPI}
          id="project-teams-table"
          name="Admin > Project > Teams"
          userPreferencesKey="admin-project-teams-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={true}
          isViewable={true}
          query={{
            projectId: projectId,
          }}
          onBeforeCreate={(item: Team): Promise<Team> => {
            if (!projectId) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.projectId = projectId;
            return Promise.resolve(item);
          }}
          cardProps={{
            title: t("pages.projectTeams.cardTitle"),
            description: t("pages.projectTeams.cardDescription"),
          }}
          noItemsMessage={t("pages.projectTeams.noItems")}
          showViewIdButton={true}
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
          showRefreshButton={true}
          onViewPage={(item: Team) => {
            return Promise.resolve(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROJECT_TEAM_VIEW] as Route,
                {
                  modelId: projectId,
                  subModelId: item.id || new ObjectID(""),
                },
              ),
            );
          }}
          filters={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.LongText,
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              noValueMessage: "-",
              title: "Description",
              type: FieldType.LongText,
            },
          ]}
        />
      </Fragment>
    </ModelPage>
  );
};

export default ProjectTeams;
