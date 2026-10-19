import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENTS_TAB_GROUPS,
  SecurityEventsMenuBadge,
  SecurityEventsTab,
  SecurityEventsTabGroup,
} from "../../Utils/SecurityEventsNavigation";
import {
  SecurityEventsBadgeCount,
  getSecurityEventsBadgeCount,
} from "./SecurityEventsBadgeCount";
import Route from "Common/Types/API/Route";
import Badge from "Common/UI/Components/Badge/Badge";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Link } from "react-router-dom";

export const SECURITY_EVENTS_TABS_ID: string = "security-events-tabs";

// What a screen reader calls the row of tabs.
export const SECURITY_EVENTS_TABS_LABEL: string = translationKey(
  "Pages in this section",
);

function routeOf(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

// What a screen reader hears for a tab's count; the number itself is drawn aria-hidden.
export const SECURITY_EVENTS_TAB_BADGE_LABELS: Record<
  SecurityEventsMenuBadge,
  PluralTemplate
> = {
  openCases: { one: "{{count}} open case", other: "{{count}} open cases" },
  runsWaitingForApproval: {
    one: "{{count}} run waiting for approval",
    other: "{{count}} runs waiting for approval",
  },
};

/*
 * The count beside a tab, read the way the side menu reads it. Nothing is
 * drawn while it loads, at zero, or when the count cannot be read.
 */
const SecurityEventsTabBadge: FunctionComponent<{
  badge: SecurityEventsMenuBadge;
  tabPage: PageMap;
}> = (props: {
  badge: SecurityEventsMenuBadge;
  tabPage: PageMap;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [count, setCount] = useState<number>(0);
  const badgeCount: SecurityEventsBadgeCount | undefined =
    getSecurityEventsBadgeCount(props.badge);

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!badgeCount) {
      return undefined;
    }

    ModelAPI.count({
      modelType: badgeCount.modelType,
      query: badgeCount.countQuery,
    })
      .then((value: number) => {
        if (isCurrent) {
          setCount(value);
        }
      })
      .catch(() => {
        // No number is better than a wrong one; the menu says it too.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.badge]);

  if (!badgeCount || count <= 0) {
    return <></>;
  }

  return (
    <span
      className="ml-2 inline-flex"
      data-testid={`security-events-tab-badge-${props.tabPage}`}
    >
      <Badge badgeCount={count} badgeType={badgeCount.badgeType} />
      <span className="sr-only">
        {translator.translatePlural(
          SECURITY_EVENTS_TAB_BADGE_LABELS[props.badge],
          count,
        )}
      </span>
    </span>
  );
};

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
            {tab.badge ? (
              <SecurityEventsTabBadge badge={tab.badge} tabPage={tab.page} />
            ) : (
              <></>
            )}
          </Link>
        );
      })}
    </nav>
  );
};

export default SecurityEventsPageTabs;
