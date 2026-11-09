import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getDailyBudgetDetailFields,
  getDailyBudgetFormFields,
  getRateLimitDetailFields,
  getRateLimitFormFields,
  IngestionBudgetLevel,
} from "../../../Utils/IngestionBudgetFormFields";
import { fetchProjectIngestionBudgetStatus } from "../../../Utils/TelemetryIngestionBudget";
import SideMenuComponent from "./SideMenu";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryIngestionBudgetStatus } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import TelemetryIngestionBudgetStatusCard from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetStatusCard";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Projects > a project > Ingestion Budgets: what the
 * project used of its budgets today, and the budgets and rates the instance
 * admin set for it alone. An empty field takes the instance default
 * (Settings > Ingestion Budgets); 0 lifts it, for a project that should have
 * no limit. Only a master admin can write these: the project's own admins see
 * them on their Usage page but cannot raise them.
 */
const ProjectIngestionBudgets: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelIdString: string = Navigation.getLastParamAsString(1);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  // The id by its route param: a new ObjectID each render would refetch.
  const modelId: ObjectID = useMemo(() => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  return (
    <ModelPage<Project>
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectView.title")}
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
            { modelId: modelId },
          ),
        },
        {
          title: t("breadcrumbs.ingestionBudgets"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_INGESTION_BUDGETS] as Route,
            { modelId: modelId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <Fragment>
        {/* Keyed on the saves below, so a changed budget reads again. */}
        <TelemetryIngestionBudgetStatusCard
          key={refreshToken}
          fetchStatus={(): Promise<TelemetryIngestionBudgetStatus> => {
            return fetchProjectIngestionBudgetStatus(modelId);
          }}
        />

        <CardModelDetail<Project>
          name="Project Daily Ingestion Budgets"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.projectView.ingestionBudgets.dailyCardTitle"),
            description: t(
              "pages.projectView.ingestionBudgets.dailyCardDescription",
            ),
          }}
          isEditable={true}
          editButtonText={t(
            "pages.projectView.ingestionBudgets.dailyEditButton",
          )}
          editModalTitle={t(
            "pages.projectView.ingestionBudgets.dailyEditButton",
          )}
          onSaveSuccess={() => {
            setRefreshToken(refreshToken + 1);
          }}
          formFields={getDailyBudgetFormFields<Project>(
            IngestionBudgetLevel.Project,
          )}
          modelDetailProps={{
            modelType: Project,
            modelAPI: AdminModelAPI,
            id: "model-detail-project-ingestion-budgets",
            showDetailsInNumberOfColumns: 2,
            fields: getDailyBudgetDetailFields<Project>(
              IngestionBudgetLevel.Project,
            ),
            modelId: modelId,
          }}
        />

        <CardModelDetail<Project>
          name="Project Ingestion Rate Limits"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.projectView.ingestionBudgets.rateCardTitle"),
            description: t(
              "pages.projectView.ingestionBudgets.rateCardDescription",
            ),
          }}
          isEditable={true}
          editButtonText={t(
            "pages.projectView.ingestionBudgets.rateEditButton",
          )}
          editModalTitle={t(
            "pages.projectView.ingestionBudgets.rateEditButton",
          )}
          onSaveSuccess={() => {
            setRefreshToken(refreshToken + 1);
          }}
          formFields={getRateLimitFormFields<Project>(
            IngestionBudgetLevel.Project,
          )}
          modelDetailProps={{
            modelType: Project,
            modelAPI: AdminModelAPI,
            id: "model-detail-project-ingestion-rate-limits",
            showDetailsInNumberOfColumns: 2,
            fields: getRateLimitDetailFields<Project>(
              IngestionBudgetLevel.Project,
            ),
            modelId: modelId,
          }}
        />
      </Fragment>
    </ModelPage>
  );
};

export default ProjectIngestionBudgets;
