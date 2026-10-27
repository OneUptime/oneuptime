import TabPageId from "Common/UI/Utils/TabPageId";

/*
 * The status page this tab shows (Common/UI/Utils/TabPageId): the one its
 * address names on OneUptime's own host (/status-page/<id>/...), and on a
 * custom domain the one the master page found for the domain as the tab
 * started. Never an id kept in localStorage, which every tab on the address
 * shares: the page a second tab opened became every tab's page (#5277).
 *
 * Read through StatusPageUtil; a module of its own so that RouteMap, which
 * pages and tests read for its routes alone, needs nothing else.
 */
const StatusPageInTab: TabPageId = new TabPageId("status-page");

export default StatusPageInTab;
