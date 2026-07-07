import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Navigate } from "react-router-dom";

/*
 * The incident root cause now lives inline on the overview page. This route is
 * retained only as a deep-link fallback and redirects to the overview so old
 * bookmarks and links still land on the content.
 */
const IncidentViewRootCauseRedirect: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const overviewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.INCIDENT_VIEW] as Route,
    { modelId },
  );

  return <Navigate to={overviewRoute.toString()} replace={true} />;
};

export default IncidentViewRootCauseRedirect;
