import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DashboardViewer from "../../../Components/Dashboard/DashboardView";

const DashboardView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Dashboard View  */}
      <DashboardViewer
        dashboardId={modelId}
        // ⋯ -> Share: who can view the dashboard, and its public link.
        onShareClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default DashboardView;
