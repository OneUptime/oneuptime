import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DashboardViewer from "../../../Components/Dashboard/DashboardView";
import {
  DashboardFullScreenAddress,
  useDashboardFullScreenAddress,
} from "../../../Components/Dashboard/Utils/DashboardFullScreenAddress";

const DashboardView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  /*
   * Full screen (issue #10409) is this page's address: ?view=full-screen, so
   * a tab opened on it, a bookmark and a reload show the dashboard alone,
   * over the whole window. The board writes it back as it goes in and out.
   */
  const fullScreenAddress: DashboardFullScreenAddress =
    useDashboardFullScreenAddress();

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
        isFullScreen={fullScreenAddress.isFullScreen}
        onFullScreenChange={fullScreenAddress.setFullScreen}
        // ⋯ -> Open in New Tab: this dashboard, full screen, on what this tab shows.
        onOpenInNewTab={fullScreenAddress.openInNewTab}
      />
    </Fragment>
  );
};

export default DashboardView;
