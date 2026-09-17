import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Navigate } from "react-router-dom";

/*
 * Status Page > Groups, which is now part of Status Page > Resources.
 *
 * Groups and the monitors inside them used to be two pages, and building a
 * status page meant navigating between them: create a section here, go there to
 * fill it, come back to create the next one. They are one screen now - the
 * hierarchy on the left, the selected group's monitors on the right - so this
 * route exists only to carry anyone holding a link to the old one across to it.
 *
 * The redirect replaces this entry in the history rather than pushing onto it:
 * a "back" out of Resources has to land wherever the operator came from, not on
 * a URL that immediately forwards them here again.
 */
const StatusPageGroups: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const resourcesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route,
    { modelId: modelId },
  );

  return <Navigate to={resourcesRoute.toString()} replace={true} />;
};

export default StatusPageGroups;
