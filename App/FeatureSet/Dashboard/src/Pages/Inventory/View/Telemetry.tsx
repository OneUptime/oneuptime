import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Navigate } from "react-router-dom";

/*
 * Compatibility route for bookmarks made before Inventory signals became
 * first-class pages. Logs is the least surprising landing page and the user
 * can move among every other signal through the standard detail side menu.
 */
const InventoryItemTelemetryRedirect: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.INVENTORY_VIEW_LOGS] as Route,
    { modelId },
  );

  return <Navigate replace={true} to={logsRoute.toString()} />;
};

export default InventoryItemTelemetryRedirect;
