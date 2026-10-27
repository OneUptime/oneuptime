import PageMap from "./PageMap";
import { getSecurityCasePages } from "./SecurityCaseNavigation";
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
 *   Events           every security event, who is riskiest and how they
 *                    connect: Events, Campaigns (who is attacking, and
 *                    whether any of it got through), Entity Risk (every
 *                    user, host and address scored by everything found
 *                    about it, and a lookup for any value) and Correlate
 *   Detections       what finds threats in them: Detection Rules, the Rule
 *                    Library, Threat Intel and ATT&CK Coverage
 *   Playbooks        what responds when a case opens: Playbooks, the
 *                    Approvals - the runs a step holds for one - every
 *                    Playbook Run, and the Protected Entities no playbook
 *                    may contain
 *   AI               whether OneUptime AI triages each new case (Settings),
 *                    as the Incidents' and Alerts' menus have it; the
 *                    triage itself is on each case's AI card
 *   Workspace        the Slack and Microsoft Teams channels cases are
 *                    posted to (SECURITY_EVENTS_WORKSPACE_PAGES)
 *   Connections      where events come from and where they are sent:
 *                    Connections, and the Setup Guide
 *   Settings         how the project's cases are kept: its own Case
 *                    Priorities and Case Statuses, as the Incidents' and
 *                    Alerts' Settings keep their severities and states, and
 *                    Risk Scoring: when an entity's risk opens a case, and
 *                    how much each entity matters
 *
 * Every page has its own entry, address and name. The maintainer asked
 * for this in place of the tabs a page used to carry across its top (and
 * the views along the top of the case queue and the runs): "Can we create
 * side menu sections instead and have different pages for these things?"
 *
 * Detections, AI, Workspace, Connections and Settings are set up once and
 * visited rarely, so they start folded to their titles; each opens by
 * itself on its own pages.
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
  /*
   * The pages opened from this entry's page, inside the menu's layout, that
   * light it: an entity's page lights Entity Risk.
   */
  detailPages?: Array<PageMap> | undefined;
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
        icon: IconProp.Inbox,
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
        /*
         * Who is attacking: every address that sent attack requests, as one
         * row, and whether any of them got through
         * (Types/SecurityEvent/SecurityAttackCampaign).
         */
        page: PageMap.SECURITY_EVENTS_CAMPAIGNS,
        title: "Campaigns",
        icon: IconProp.Flag,
      },
      {
        /*
         * Who to look at first: every user, host and address scored by what
         * the rules, threat intel and connected products found about it this
         * week (Types/SecurityCase/SecurityEntityRisk), and Look Up an Entity
         * for any value. The product's one riskiest list: the Overview's
         * Riskiest Entities is its top. Entities, which ranked values by how
         * many findings named them, folded into it.
         */
        page: PageMap.SECURITY_EVENTS_ENTITY_RISK,
        title: "Entity Risk",
        icon: IconProp.Fire,
        detailPages: [PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW],
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
        /*
         * "Approvals", not "Waiting for Approval": beside its count, in the
         * 224px the menu has from 768 to 1023px, the longer name was cut
         * short in English - and at every width in German, French and
         * Italian. The amber count says they are waiting.
         */
        page: PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
        title: "Approvals",
        icon: IconProp.PauseCircle,
        badge: "runsWaitingForApproval",
      },
      {
        page: PageMap.SECURITY_PLAYBOOK_RUNS,
        title: "Playbook Runs",
        icon: IconProp.Play,
      },
      {
        page: PageMap.SECURITY_PROTECTED_ENTITIES,
        title: "Protected Entities",
        icon: IconProp.Lock,
      },
    ],
  },
  {
    /*
     * What OneUptime AI does on its own as cases open, like the AI section
     * of the Incidents' and Alerts' menus. Set once, so folded.
     */
    title: "AI",
    startsCollapsed: true,
    items: [
      {
        page: PageMap.SECURITY_EVENTS_SETTINGS_AI,
        title: "Settings",
        icon: IconProp.Settings,
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
  {
    /*
     * The project's own scales, as Incidents and Alerts keep their
     * severities and states under Settings: how urgent a case is, and
     * where it stands. Last, as Settings closes every product's menu.
     */
    title: "Settings",
    startsCollapsed: true,
    items: [
      {
        page: PageMap.SECURITY_EVENTS_SETTINGS_CASE_PRIORITIES,
        title: "Case Priorities",
        icon: IconProp.Signal,
      },
      {
        page: PageMap.SECURITY_EVENTS_SETTINGS_CASE_STATUSES,
        title: "Case Statuses",
        icon: IconProp.ArrowCircleRight,
      },
      {
        // When an entity's risk opens a case, and how much each entity matters.
        page: PageMap.SECURITY_EVENTS_SETTINGS_RISK_SCORING,
        title: "Risk Scoring",
        icon: IconProp.Gauge,
      },
    ],
  },
];

/*
 * THE WORKSPACE SECTION.
 *
 * The rules that post security cases to Slack and Microsoft Teams channels
 * (and Teams chats), one page per workspace, and the page that connects one.
 * The section is drawn as every product's Workspace section is
 * (useWorkspaceSideMenuSection): an entry for each workspace the project has
 * connected - "Slack", "Microsoft Teams" - or, with neither, one entry to
 * the page that connects them, "Connect Slack or Teams"; folded, as every
 * Workspace section is, and open by itself on its own pages. It is not in
 * SECURITY_EVENTS_MENU, whose entries every project has: which of these it
 * lists is known only once the project's connections are.
 *
 * It sits before Connections: the sections set up once close the menu, as
 * Workspace comes before Settings in the other products' menus.
 */
export interface SecurityEventsWorkspacePages {
  slack: PageMap;
  microsoftTeams: PageMap;
  // The page a project with nothing connected is sent to.
  connect: PageMap;
}

export const SECURITY_EVENTS_WORKSPACE_SECTION_TITLE: string = "Workspace";

export const SECURITY_EVENTS_WORKSPACE_PAGES: SecurityEventsWorkspacePages = {
  slack: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK,
  microsoftTeams: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
  connect: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS,
};

// The section the Workspace section is drawn in front of.
export const SECURITY_EVENTS_WORKSPACE_SECTION_BEFORE: string = "Connections";

/*
 * Where each Workspace page is, as its breadcrumbs say it. Slack and
 * Microsoft Teams are named as their entries are; the page that connects
 * either shows both, so it is the section's own page, named once.
 */
const WORKSPACE_PAGE_TRAILS: Array<[PageMap, Array<string>]> = [
  [
    SECURITY_EVENTS_WORKSPACE_PAGES.slack,
    ["Security Events", SECURITY_EVENTS_WORKSPACE_SECTION_TITLE, "Slack"],
  ],
  [
    SECURITY_EVENTS_WORKSPACE_PAGES.microsoftTeams,
    [
      "Security Events",
      SECURITY_EVENTS_WORKSPACE_SECTION_TITLE,
      "Microsoft Teams",
    ],
  ],
  [
    SECURITY_EVENTS_WORKSPACE_PAGES.connect,
    ["Security Events", SECURITY_EVENTS_WORKSPACE_SECTION_TITLE],
  ],
];

// The Workspace section's pages: Slack, Microsoft Teams, and the one that connects either.
export function getSecurityEventsWorkspacePages(): Array<PageMap> {
  return WORKSPACE_PAGE_TRAILS.map(
    ([page]: [PageMap, Array<string>]): PageMap => {
      return page;
    },
  );
}

export function isSecurityEventsWorkspacePage(
  page: PageMap | undefined,
): boolean {
  return Boolean(page && getSecurityEventsWorkspacePages().includes(page));
}

/*
 * The pages that open on their own, outside the menu's layout, reached from
 * their lists: a case's pages, under the case's own side menu
 * (SecurityCaseNavigation.ts), and a playbook's full-width page.
 */
export const SECURITY_EVENTS_DETAIL_PAGES: Array<PageMap> = [
  ...getSecurityCasePages(),
  PageMap.SECURITY_PLAYBOOK_VIEW,
];

/*
 * Old addresses that now open somewhere else. Security Events monitors are
 * monitors like any other, listed (and filtered by type) under Monitors; a
 * detection rule already raises an alert, an incident or a case on its own.
 * Entities ranked values by how many findings named them, beside Entity
 * Risk's scores: Entity Risk is the one ranking now, with Entities' lookup,
 * so the old address opens it.
 */
export const SECURITY_EVENTS_REDIRECTED_PAGES: Array<PageMap> = [
  PageMap.SECURITY_EVENTS_MONITORS,
  PageMap.SECURITY_EVENTS_ENTITIES,
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

/*
 * The pages inside the menu's layout that no entry names, each opened from
 * an entry's page and lit as it: an entity's page, under Entity Risk.
 */
export function getSecurityEventsMenuDetailPages(): Array<PageMap> {
  return getSecurityEventsMenuItems().flatMap(
    (item: SecurityEventsMenuItem): Array<PageMap> => {
      return item.detailPages || [];
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
 * (Overview, Events, Playbooks, Workspace, Connections) is not named twice.
 */
export function getSecurityEventsPageTrail(
  page: PageMap,
): Array<string> | undefined {
  const workspaceTrail: [PageMap, Array<string>] | undefined =
    WORKSPACE_PAGE_TRAILS.find(
      ([candidate]: [PageMap, Array<string>]): boolean => {
        return candidate === page;
      },
    );

  if (workspaceTrail) {
    return workspaceTrail[1];
  }

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
