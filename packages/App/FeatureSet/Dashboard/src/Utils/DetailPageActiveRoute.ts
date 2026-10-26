import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * The `activeRoute` of a side-menu entry for a list whose rows open a page
 * of their own: one pod's page under Pods, one node's under Nodes.
 *
 * Such a page is one of the rows the list shows, but the menu has no entry
 * for it, so nothing in the menu was lit there, and on a phone the menu's
 * button could not say where the reader was ("Navigate to / Navigation",
 * later the trail's "Pod Detail"). With this the list's entry stays lit on
 * a row's page, says so to a screen reader (aria-current="true": it holds
 * the page), and the phone's button reads "Workloads / Pods".
 *
 * It is the detail page's route while that page is open, and nothing
 * otherwise, so on the list's own page the entry is lit by its link, as
 * before. The record's id (`modelId`, a cluster's) is filled in; the row's
 * own id stays a placeholder, which matches any row.
 */
export function getDetailPageActiveRoute(data: {
  detailPage: PageMap;
  modelId: ObjectID;
}): Route | undefined {
  const detailRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[data.detailPage] as Route,
    { modelId: data.modelId },
  );

  return Navigation.isOnThisPage(detailRoute) ? detailRoute : undefined;
}
