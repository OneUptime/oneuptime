import Dictionary from "Common/Types/Dictionary";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * A WORKSPACE PAGE'S SUMMARY TAB, OPENED FROM A LINK (#11020).
 *
 * Incidents' and Alerts' Slack, Microsoft Teams and Mattermost pages keep
 * a workspace's notification summaries under their Summary tab. A link to
 * one summary - the duplicate-name warning's, or Project Settings' list of
 * the names a project holds twice (UniqueNames/RecordPages) - opens its
 * page on that tab, ?tab=summary, rather than on the page's first tab,
 * where nothing says where the summary is.
 */

export const WORKSPACE_PAGE_TAB_PARAM: string = "tab";

export const WORKSPACE_SUMMARY_TAB: string = "summary";

// The tab's own name, as each of the six pages names it.
export const WORKSPACE_SUMMARY_TAB_NAME: string = "Summary";

// The address's query that opens the Summary tab.
export const getWorkspaceSummaryTabQuery: () => Dictionary<string> =
  (): Dictionary<string> => {
    return { [WORKSPACE_PAGE_TAB_PARAM]: WORKSPACE_SUMMARY_TAB };
  };

/*
 * The tab a workspace page opens on: Summary when its address asks for it,
 * else the page's first (undefined).
 */
export const getWorkspacePageInitialTabName: () => string | undefined = ():
  | string
  | undefined => {
  return Navigation.getQueryStringByName(WORKSPACE_PAGE_TAB_PARAM) ===
    WORKSPACE_SUMMARY_TAB
    ? WORKSPACE_SUMMARY_TAB_NAME
    : undefined;
};
