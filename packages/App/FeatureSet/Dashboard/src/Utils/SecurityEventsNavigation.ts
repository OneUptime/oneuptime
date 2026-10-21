import PageMap from "./PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The Security Events menu, as data.
 *
 * Security reads as one story, top to bottom, and each part of it is a
 * section of the menu holding its pages:
 *
 *   Overview         what needs you now, and setting Security up
 *   Security Cases   what was found, grouped into things to look into:
 *                    Open Cases, Assigned to Me, Unassigned, Closed Cases
 *                    and All Cases
 *   Events           every security event, how they connect, and who or
 *                    what they name: Events, Entities, Correlate
 *   Detections       what finds threats in them: Detection Rules, the Rule
 *                    Library, Threat Intel and ATT&CK Coverage
 *   Playbooks        what responds when a case opens: Playbooks, the runs
 *                    Waiting for Approval, and every Playbook Run
 *   Connections      where events come from and where they are sent:
 *                    Connections, and the Setup Guide
 *
 * Every page has its own entry, address and name. The maintainer asked
 * for this in place of the tabs a page used to carry across its top (and
 * the views along the top of the case queue and the runs): "Can we create
 * side menu sections instead and have different pages for these things?"
 *
 * Detections and Connections are set up once and visited rarely, so they
 * start folded to their titles; each opens by itself on its own pages.
 *
 * Kept free of React so the menu - its sections, their order, the pages
 * and their names - is pinned in a plain test, and the breadcrumbs, Search
 * and docs that name the pages are held to it.
 */

/*
 * A live count beside an entry: what is waiting for somebody. Each counts
 * what its own page lists (SecurityEventsBadgeCount.ts).
 */
export type SecurityEventsMenuBadge =
  | "openCases"
  | "myOpenCases"
  | "runsWaitingForApproval";

export interface SecurityEventsMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
  badge?: SecurityEventsMenuBadge | undefined;
}

export interface SecurityEventsMenuSection {
  title: string;
  items: Array<SecurityEventsMenuItem>;
  /*
   * Folded to its title until someone opens it, or is on one of its pages:
   * set up once, revisited rarely.
   */
  startsCollapsed?: boolean | undefined;
}

export const SECURITY_EVENTS_MENU: Array<SecurityEventsMenuSection> = [
  {
    title: "Overview",
    items: [
      {
        page: PageMap.SECURITY_EVENTS_OVERVIEW,
        title: "Overview",
        icon: IconProp.ChartBar,
      },
    ],
  },
  {
    // The case queue, one page per question asked of it (SecurityCaseQueueViews.ts).
    title: "Security Cases",
    items: [
      {
        page: PageMap.SECURITY_CASES,
        title: "Open Cases",
        icon: IconProp.ShieldExclamation,
        badge: "openCases",
      },
      {
        page: PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
        title: "Assigned to Me",
        icon: IconProp.User,
        badge: "myOpenCases",
      },
      {
        page: PageMap.SECURITY_CASES_UNASSIGNED,
        title: "Unassigned",
        icon: IconProp.UserGroup,
      },
      {
        page: PageMap.SECURITY_CASES_CLOSED,
        title: "Closed Cases",
        icon: IconProp.CheckCircle,
      },
      {
        page: PageMap.SECURITY_CASES_ALL,
        title: "All Cases",
        icon: IconProp.RectangleStack,
      },
    ],
  },
  {
    title: "Events",
    items: [
      {
        page: PageMap.SECURITY_EVENTS,
        title: "Events",
        icon: IconProp.List,
      },
      {
        page: PageMap.SECURITY_EVENTS_ENTITIES,
        title: "Entities",
        icon: IconProp.Fingerprint,
      },
      {
        page: PageMap.SECURITY_EVENTS_CORRELATE,
        title: "Correlate",
        // Connected points: Graph draws the same bars as Overview's ChartBar.
        icon: IconProp.Share,
      },
    ],
  },
  {
    title: "Detections",
    startsCollapsed: true,
    items: [
      {
        page: PageMap.SECURITY_EVENTS_DETECTION_RULES,
        title: "Detection Rules",
        icon: IconProp.ShieldCheck,
      },
      {
        page: PageMap.SECURITY_EVENTS_RULE_LIBRARY,
        title: "Rule Library",
        icon: IconProp.SquareStack3D,
      },
      {
        page: PageMap.SECURITY_EVENTS_THREAT_INTEL,
        title: "Threat Intel",
        icon: IconProp.Bug,
      },
      {
        page: PageMap.SECURITY_EVENTS_ATTACK_COVERAGE,
        title: "ATT&CK Coverage",
        icon: IconProp.TableCells,
      },
    ],
  },
  {
    /*
     * Open, unlike the other sections set up once: a run held for an
     * approval does nothing until somebody decides, and its count must be
     * in sight.
     */
    title: "Playbooks",
    items: [
      {
        page: PageMap.SECURITY_PLAYBOOKS,
        title: "Playbooks",
        icon: IconProp.Bolt,
      },
      {
        page: PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
        title: "Waiting for Approval",
        icon: IconProp.Pause,
        badge: "runsWaitingForApproval",
      },
      {
        page: PageMap.SECURITY_PLAYBOOK_RUNS,
        title: "Playbook Runs",
        icon: IconProp.Play,
      },
    ],
  },
  {
    title: "Connections",
    startsCollapsed: true,
    items: [
      {
        page: PageMap.SECURITY_EVENTS_CONNECTIONS,
        title: "Connections",
        icon: IconProp.Link,
      },
      {
        page: PageMap.SECURITY_EVENTS_DOCUMENTATION,
        title: "Setup Guide",
        icon: IconProp.Book,
      },
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

// Every entry of the menu, in menu order.
export function getSecurityEventsMenuItems(): Array<SecurityEventsMenuItem> {
  return SECURITY_EVENTS_MENU.flatMap(
    (section: SecurityEventsMenuSection): Array<SecurityEventsMenuItem> => {
      return section.items;
    },
  );
}

// The section a page sits in, if the menu lists it.
export function getSecurityEventsMenuSectionFor(
  page: PageMap | undefined,
): SecurityEventsMenuSection | undefined {
  if (!page) {
    return undefined;
  }

  return SECURITY_EVENTS_MENU.find(
    (section: SecurityEventsMenuSection): boolean => {
      return section.items.some((item: SecurityEventsMenuItem): boolean => {
        return item.page === page;
      });
    },
  );
}

// A page's entry in the menu, if it has one.
export function getSecurityEventsMenuItemFor(
  page: PageMap | undefined,
): SecurityEventsMenuItem | undefined {
  if (!page) {
    return undefined;
  }

  return getSecurityEventsMenuItems().find(
    (item: SecurityEventsMenuItem): boolean => {
      return item.page === page;
    },
  );
}

/*
 * Where a page is, as its breadcrumbs say it: the product, the page's
 * section, and the page as the menu names it. A page named like its section
 * (Overview, Events, Playbooks, Connections) is not named twice.
 */
export function getSecurityEventsPageTrail(
  page: PageMap,
): Array<string> | undefined {
  const section: SecurityEventsMenuSection | undefined =
    getSecurityEventsMenuSectionFor(page);
  const item: SecurityEventsMenuItem | undefined =
    getSecurityEventsMenuItemFor(page);

  if (!section || !item) {
    return undefined;
  }

  return section.title === item.title
    ? ["Security Events", item.title]
    : ["Security Events", section.title, item.title];
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
