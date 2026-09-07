import { getAlertsBreadcrumbs } from "../../../Utils/Breadcrumbs/AlertBreadcrumbs";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const AlertViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const isOverview: boolean = path === RouteMap[PageMap.ALERT_VIEW]?.toString();
  return (
    <ModelPage
      title="Alert"
      modelType={Alert}
      modelId={modelId}
      modelNameField="title"
      hideTitle={isOverview}
      breadcrumbLinks={getAlertsBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default AlertViewLayout;
