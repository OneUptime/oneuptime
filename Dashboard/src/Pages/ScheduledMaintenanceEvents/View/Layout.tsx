import { getScheduleMaintenanceBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "CommonUI/src/Components/Page/ModelPage";
import Navigation from "CommonUI/src/Utils/Navigation";
import ScheduledMaintenance from "Model/Models/ScheduledMaintenance";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const ScheduledMaintenanceViewLayout: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Scheduled Event"
      modelType={ScheduledMaintenance}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getScheduleMaintenanceBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default ScheduledMaintenanceViewLayout;
