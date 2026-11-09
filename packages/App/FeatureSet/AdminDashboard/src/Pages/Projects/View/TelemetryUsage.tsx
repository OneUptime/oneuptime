import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { fetchProjectUsage } from "../../../Utils/TelemetryUsage";
import SideMenuComponent from "./SideMenu";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryUsageRange,
  TelemetryUsageSummary,
} from "Common/Types/Telemetry/TelemetryUsage";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import TelemetryUsageOverview from "Common/UI/Components/TelemetryUsage/TelemetryUsageOverview";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Projects > a project > Telemetry Usage: what the project
 * sent each day, by signal and by resource, with the retention each is kept
 * for - what its own members see under Project Settings > Telemetry & APM >
 * Usage, read as the master admin (and with the cost where billing is on).
 * Its resources have no pages here, so they are named, not linked.
 */
const ProjectTelemetryUsage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelIdString: string = Navigation.getLastParamAsString(1);

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
          title: t("breadcrumbs.telemetryUsage"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_TELEMETRY_USAGE] as Route,
            { modelId: modelId },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <TelemetryUsageOverview
        projectId={modelId.toString()}
        fetchUsage={(
          range: TelemetryUsageRange,
        ): Promise<TelemetryUsageSummary> => {
          return fetchProjectUsage({ projectId: modelId, range: range });
        }}
      />
    </ModelPage>
  );
};

export default ProjectTelemetryUsage;
