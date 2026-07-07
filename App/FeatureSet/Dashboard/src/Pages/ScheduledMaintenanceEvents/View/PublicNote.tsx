import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Navigate } from "react-router-dom";

/*
 * Notes now live in the activity feed on the overview (viewed there and added
 * via the inline composer). This route is retained only as a deep-link fallback
 * and redirects to the overview.
 */
const ScheduledMaintenanceViewPublicNoteRedirect: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const overviewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
    { modelId },
  );

  return <Navigate to={overviewRoute.toString()} replace={true} />;
};

export default ScheduledMaintenanceViewPublicNoteRedirect;
