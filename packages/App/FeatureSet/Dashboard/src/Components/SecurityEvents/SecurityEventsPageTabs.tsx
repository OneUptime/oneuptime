import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENTS_TAB_GROUPS,
  SecurityEventsTab,
  SecurityEventsTabGroup,
} from "../../Utils/SecurityEventsNavigation";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import { Link } from "react-router-dom";

export const SECURITY_EVENTS_TABS_ID: string = "security-events-tabs";

// What a screen reader calls the row of tabs.
export const SECURITY_EVENTS_TABS_LABEL: string = translationKey(
  "Pages in this section",
);

function routeOf(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

// The tab group of the page the person is on, and which tab it is.
export function getCurrentSecurityEventsTab():
  | { group: SecurityEventsTabGroup; current: SecurityEventsTab }
  | undefined {
  for (const group of SECURITY_EVENTS_TAB_GROUPS) {
    const current: SecurityEventsTab | undefined = group.tabs.find(
      (tab: SecurityEventsTab): boolean => {
        return Navigation.isOnThisPage(routeOf(tab.page));
      },
    );

    if (current) {
      return { group, current };
    }
  }

  return undefined;
}

/*
 * The pages behind one Security Events menu entry, as tabs across the top
 * of the page: Events, Entities and Correlate; Detection Rules, Rule
 * Library, Threat Intel and ATT&CK Coverage; Playbooks and Playbook Runs;
 * Connections and the Setup Guide. Each tab is a link to its own page, so
 * every page keeps its address and its place in the browser's history.
 *
 * Drawn like the product's other tabs (Common Tabs): a quiet pill for the
 * page you are on. On a phone the row scrolls sideways inside itself, never
 * the page.
 */
const SecurityEventsPageTabs: FunctionComponent = (): ReactElement => {
  const { translateString } = useTranslateValue();
  const found:
    | { group: SecurityEventsTabGroup; current: SecurityEventsTab }
    | undefined = getCurrentSecurityEventsTab();

  if (!found) {
    return <></>;
  }

  return (
    <nav
      id={SECURITY_EVENTS_TABS_ID}
      data-testid={SECURITY_EVENTS_TABS_ID}
      aria-label={
        translateString(SECURITY_EVENTS_TABS_LABEL) ||
        SECURITY_EVENTS_TABS_LABEL
      }
      className="-mb-2 flex max-w-full gap-1 overflow-x-auto"
    >
      {found.group.tabs.map((tab: SecurityEventsTab): ReactElement => {
        const isCurrent: boolean = tab.page === found.current.page;

        return (
          <Link
            key={tab.page}
            to={routeOf(tab.page).toString()}
            data-testid={`security-events-tab-${tab.page}`}
            aria-current={isCurrent ? "page" : undefined}
            className={`inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              isCurrent
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            {translateString(tab.title) || tab.title}
          </Link>
        );
      })}
    </nav>
  );
};

export default SecurityEventsPageTabs;
