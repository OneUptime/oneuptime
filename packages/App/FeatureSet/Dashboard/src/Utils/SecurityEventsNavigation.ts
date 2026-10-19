import PageMap from "./PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The Security Events menu, as data.
 *
 * Security reads as one story, left to right, and the menu is that story:
 *
 *   Overview         what needs you now, and setting Security up
 *   Security Cases   what was found, grouped into things to look into
 *   Events           every security event, to search and investigate
 *   Detections       the rules and threat intel that find threats in them
 *   Playbooks        what responds when a case opens
 *   Connections      where events come from, and where they are sent
 *
 * Six entries, no sections to open or close. The pages that belong
 * together sit behind one entry as tabs across the top of the page
 * (SECURITY_EVENTS_TAB_GROUPS): Events with Entities and Correlate,
 * Detections with the Rule Library, Threat Intel and ATT&CK Coverage,
 * Playbooks with their runs, Connections with the setup guide. The menu
 * entry stays lit on every page of its group.
 *
 * Kept free of React so the menu - its order, its titles and the pages
 * each entry stands for - is pinned in a plain test, and the docs that
 * describe it are held to it.
 */

export type SecurityEventsMenuBadge = "openCases" | "runsWaitingForApproval";

export interface SecurityEventsMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
  // A live count beside the title: what is waiting for somebody.
  badge?: SecurityEventsMenuBadge | undefined;
}

export const SECURITY_EVENTS_MENU: Array<SecurityEventsMenuItem> = [
  {
    page: PageMap.SECURITY_EVENTS_OVERVIEW,
    title: "Overview",
    icon: IconProp.ChartBar,
  },
  {
    page: PageMap.SECURITY_CASES,
    title: "Security Cases",
    icon: IconProp.ShieldExclamation,
    badge: "openCases",
  },
  {
    page: PageMap.SECURITY_EVENTS,
    title: "Events",
    icon: IconProp.List,
  },
  {
    page: PageMap.SECURITY_EVENTS_DETECTION_RULES,
    title: "Detections",
    icon: IconProp.ShieldCheck,
  },
  {
    page: PageMap.SECURITY_PLAYBOOKS,
    title: "Playbooks",
    icon: IconProp.Bolt,
    badge: "runsWaitingForApproval",
  },
  {
    page: PageMap.SECURITY_EVENTS_CONNECTIONS,
    title: "Connections",
    icon: IconProp.Link,
  },
];

export interface SecurityEventsTab {
  page: PageMap;
  title: string;
  /*
   * The count the menu entry shows, on the tab where those things are: the
   * runs waiting for an approval are counted beside Playbooks and listed
   * under Playbook Runs, so that tab carries the number too.
   */
  badge?: SecurityEventsMenuBadge | undefined;
}

/*
 * Pages behind one menu entry, as tabs: the entry's own page first. A page
 * is in at most one group.
 */
export interface SecurityEventsTabGroup {
  menuPage: PageMap;
  tabs: Array<SecurityEventsTab>;
}

export const SECURITY_EVENTS_TAB_GROUPS: Array<SecurityEventsTabGroup> = [
  {
    menuPage: PageMap.SECURITY_EVENTS,
    tabs: [
      { page: PageMap.SECURITY_EVENTS, title: "Events" },
      { page: PageMap.SECURITY_EVENTS_ENTITIES, title: "Entities" },
      { page: PageMap.SECURITY_EVENTS_CORRELATE, title: "Correlate" },
    ],
  },
  {
    menuPage: PageMap.SECURITY_EVENTS_DETECTION_RULES,
    tabs: [
      {
        page: PageMap.SECURITY_EVENTS_DETECTION_RULES,
        title: "Detection Rules",
      },
      { page: PageMap.SECURITY_EVENTS_RULE_LIBRARY, title: "Rule Library" },
      { page: PageMap.SECURITY_EVENTS_THREAT_INTEL, title: "Threat Intel" },
      {
        page: PageMap.SECURITY_EVENTS_ATTACK_COVERAGE,
        title: "ATT&CK Coverage",
      },
    ],
  },
  {
    menuPage: PageMap.SECURITY_PLAYBOOKS,
    tabs: [
      { page: PageMap.SECURITY_PLAYBOOKS, title: "Playbooks" },
      {
        page: PageMap.SECURITY_PLAYBOOK_RUNS,
        title: "Playbook Runs",
        badge: "runsWaitingForApproval",
      },
    ],
  },
  {
    menuPage: PageMap.SECURITY_EVENTS_CONNECTIONS,
    tabs: [
      { page: PageMap.SECURITY_EVENTS_CONNECTIONS, title: "Connections" },
      { page: PageMap.SECURITY_EVENTS_DOCUMENTATION, title: "Setup Guide" },
    ],
  },
];

/*
 * The pages that open on their own, outside the menu's layout: a case and a
 * playbook are each worked on a full-width page, reached from their lists.
 */
export const SECURITY_EVENTS_DETAIL_PAGES: Array<PageMap> = [
  PageMap.SECURITY_CASE_VIEW,
  PageMap.SECURITY_PLAYBOOK_VIEW,
];

/*
 * Old addresses that now open somewhere else. Security Events monitors are
 * monitors like any other, listed (and filtered by type) under Monitors; a
 * detection rule already raises an alert, an incident or a case on its own.
 */
export const SECURITY_EVENTS_REDIRECTED_PAGES: Array<PageMap> = [
  PageMap.SECURITY_EVENTS_MONITORS,
];

// Where the product opens: the overview, not the raw events.
export const SECURITY_EVENTS_LANDING_PAGE: PageMap =
  PageMap.SECURITY_EVENTS_OVERVIEW;

export function getSecurityEventsTabGroup(
  page: PageMap | undefined,
): SecurityEventsTabGroup | undefined {
  if (!page) {
    return undefined;
  }

  return SECURITY_EVENTS_TAB_GROUPS.find(
    (group: SecurityEventsTabGroup): boolean => {
      return group.tabs.some((tab: SecurityEventsTab): boolean => {
        return tab.page === page;
      });
    },
  );
}

// The pages a menu entry stands for: its own, and its group's tabs.
export function getSecurityEventsMenuItemPages(
  item: SecurityEventsMenuItem,
): Array<PageMap> {
  const group: SecurityEventsTabGroup | undefined =
    SECURITY_EVENTS_TAB_GROUPS.find((candidate: SecurityEventsTabGroup) => {
      return candidate.menuPage === item.page;
    });

  if (!group) {
    return [item.page];
  }

  return group.tabs.map((tab: SecurityEventsTab): PageMap => {
    return tab.page;
  });
}

// The menu entry a page sits under, if it is in the menu at all.
export function getSecurityEventsMenuItemFor(
  page: PageMap | undefined,
): SecurityEventsMenuItem | undefined {
  if (!page) {
    return undefined;
  }

  return SECURITY_EVENTS_MENU.find((item: SecurityEventsMenuItem): boolean => {
    return getSecurityEventsMenuItemPages(item).includes(page);
  });
}

const ROOT_SEGMENT: string = "security-events";

/**
 * The segment that follows `security-events` in a path, or "" when the path
 * IS the product root (with or without a trailing slash, and with or without
 * the `/*` react-router leaves on a wildcard route).
 *
 * Returns null when the path is not a Security Events route at all, so a
 * caller can tell "the events list" apart from "not ours". Matched on path
 * segments rather than a substring, so a project id or a query string that
 * happens to contain "cases" is never taken for the Cases page.
 */
export function getSecurityEventsPathSegment(path: string): string | null {
  const withoutQuery: string = (path || "").split("?")[0] || "";
  const segments: Array<string> = withoutQuery
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0 && segment !== "*";
    });

  const rootIndex: number = segments.lastIndexOf(ROOT_SEGMENT);

  if (rootIndex === -1) {
    return null;
  }

  return segments[rootIndex + 1] || "";
}
