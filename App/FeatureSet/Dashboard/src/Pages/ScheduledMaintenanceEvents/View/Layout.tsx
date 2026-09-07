import { getScheduleMaintenanceBreadcrumbs } from "../../../Utils/Breadcrumbs";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const ScheduledMaintenanceViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const isOverview: boolean =
    path === RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW]?.toString();
  return (
    <ModelPage
      title="Scheduled Event"
      modelType={ScheduledMaintenance}
      modelId={modelId}
      modelNameField="title"
      hideTitle={isOverview}
      breadcrumbLinks={getScheduleMaintenanceBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default ScheduledMaintenanceViewLayout;
