import TabPageId from "Common/UI/Utils/TabPageId";

/*
 * The dashboard this tab shows (Common/UI/Utils/TabPageId): the one its
 * address names on OneUptime's own host (/public-dashboard/<id>/...), and on
 * a custom domain the one the app found for the domain as the tab started.
 * Never an id kept in localStorage, which every tab on the address shares:
 * the dashboard a second tab opened became every tab's (#5277).
 *
 * Read through PublicDashboardUtil; a module of its own so that RouteMap
 * needs nothing else.
 */
const DashboardInTab: TabPageId = new TabPageId("public-dashboard");

export default DashboardInTab;
