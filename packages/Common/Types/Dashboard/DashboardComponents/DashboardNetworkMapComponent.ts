import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * The dashboard-embeddable half of the Network Map: a world map of this
 * project's NetworkSites, each pinned at its own coordinates and colored by
 * the monitor status rolled up onto it.
 *
 * It is deliberately NOT the drill-down map from Pages/NetworkSite/NetworkMap
 * — that one navigates, and a dashboard tile is a picture rather than a
 * place you walk around in. This widget answers one question at a glance:
 * where is the network, and what is red right now.
 */
export default interface DashboardNetworkMapComponent extends BaseComponent {
  componentType: DashboardComponentType.NetworkMap;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    /*
     * How many sites the widget will draw. Sites past the cap are dropped
     * rather than silently merged, and the footer says so — a count that
     * quietly disagrees with the Sites page is how somebody concludes a
     * site has disappeared.
     */
    maxSites?: number | undefined;
    // Restrict the map to sites of these NetworkSiteType rows.
    networkSiteTypeIds?: Array<string> | undefined;
    /*
     * "" / undefined  — every site with coordinates.
     * "down"          — only sites whose rolled-up status is not operational.
     * "operational"   — only sites whose rolled-up status is operational.
     */
    statusFilter?: string | undefined;
    // "map" (default) draws the world map; "list" falls back to a table.
    viewMode?: "map" | "list" | undefined;
    // Print each marker's site name under it when the map is not too busy.
    showLabels?: boolean | undefined;
  };
}
