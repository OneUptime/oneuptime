import PageMap from "./PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The Security Events menu, as data.
 *
 * The product began as an events explorer, and carried its seven
 * destinations as header tabs the way Logs, Traces and Metrics do. It is a
 * security operations product now - cases to work, playbooks that respond,
 * rules and threat intelligence that detect - and fourteen destinations do
 * not fit in a tab bar. So it has a side menu like Incidents and Alerts, the
 * other products people work in, and the menu reads as the work does:
 *
 *   Overview      how the SOC is doing, and the case queue: what was
 *                 detected, grouped by what it is about
 *   Investigate   the raw events, how they connect, and who they involve
 *   Detect        what turns events into cases
 *   Respond       what happens to a case by itself
 *   Sources       where the events come from
 *
 * Kept free of React so the menu - its order, its titles and the page each
 * entry opens - is pinned in a plain test, and the docs that describe it are
 * held to it.
 */

export type SecurityEventsMenuBadge = "openCases" | "runsWaitingForApproval";

export interface SecurityEventsMenuItem {
  page: PageMap;
  title: string;
  icon: IconProp;
  // A live count beside the title: what is waiting for somebody.
  badge?: SecurityEventsMenuBadge | undefined;
}

export interface SecurityEventsMenuSection {
  title: string;
  items: Array<SecurityEventsMenuItem>;
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
      {
        page: PageMap.SECURITY_CASES,
        title: "Cases",
        icon: IconProp.ShieldExclamation,
        badge: "openCases",
      },
    ],
  },
  {
    title: "Investigate",
    items: [
      {
        page: PageMap.SECURITY_EVENTS,
        title: "Events",
        icon: IconProp.List,
      },
      {
        page: PageMap.SECURITY_EVENTS_CORRELATE,
        title: "Correlate",
        icon: IconProp.Graph,
      },
      {
        page: PageMap.SECURITY_EVENTS_ENTITIES,
        title: "Entities",
        icon: IconProp.Fingerprint,
      },
    ],
  },
  {
    title: "Detect",
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
        page: PageMap.SECURITY_EVENTS_ATTACK_COVERAGE,
        title: "ATT&CK Coverage",
        icon: IconProp.TableCells,
      },
      {
        page: PageMap.SECURITY_EVENTS_THREAT_INTEL,
        title: "Threat Intel",
        icon: IconProp.Bug,
      },
      {
        page: PageMap.SECURITY_EVENTS_MONITORS,
        title: "Monitors",
        icon: IconProp.AltGlobe,
      },
    ],
  },
  {
    title: "Respond",
    items: [
      {
        page: PageMap.SECURITY_PLAYBOOKS,
        title: "Playbooks",
        icon: IconProp.Bolt,
      },
      {
        page: PageMap.SECURITY_PLAYBOOK_RUNS,
        title: "Playbook Runs",
        icon: IconProp.Play,
        badge: "runsWaitingForApproval",
      },
    ],
  },
  {
    title: "Sources",
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

// Where the product opens: the overview, not the raw events.
export const SECURITY_EVENTS_LANDING_PAGE: PageMap =
  PageMap.SECURITY_EVENTS_OVERVIEW;

export function getSecurityEventsMenuItems(): Array<SecurityEventsMenuItem> {
  return SECURITY_EVENTS_MENU.flatMap(
    (section: SecurityEventsMenuSection): Array<SecurityEventsMenuItem> => {
      return section.items;
    },
  );
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
