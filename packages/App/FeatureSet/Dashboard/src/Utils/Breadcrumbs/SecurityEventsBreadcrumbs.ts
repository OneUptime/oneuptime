import PageMap from "../PageMap";
import RouteMap, { RouteUtil } from "../RouteMap";
import {
  SECURITY_EVENTS_LANDING_PAGE,
  SECURITY_EVENTS_WORKSPACE_PAGES,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
  getSecurityEventsMenuItems,
  getSecurityEventsMenuSectionFor,
  getSecurityEventsPageTrail,
  getSecurityEventsWorkspacePages,
  isSecurityEventsWorkspacePage,
} from "../SecurityEventsNavigation";
import {
  getSecurityCasePageTrail,
  getSecurityCasePages,
  isSecurityCasePage,
} from "../SecurityCaseNavigation";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";

/*
 * Each Security Events page's trail names it as the side menu does: the
 * product, the page's section, and the page - Project > Security Events >
 * Security Cases > Assigned to Me. A page named like its section
 * (Overview, Events, Playbooks, Workspace, Connections) is not named twice.
 * The trails are read from the menu (SecurityEventsNavigation.ts), so a page
 * renamed or moved there is named the same here.
 *
 * Each crumb opens what its name says, as the menus do: Security Events
 * opens the product where the Products menu opens it, the Overview, and a
 * section opens its first page - Security Cases its Open Cases, Playbooks
 * its playbooks. Workspace, whose entries depend on what the project has
 * connected, opens the page that shows Slack and Microsoft Teams side by
 * side. Following the address instead would have sent Security Events to
 * the raw events, and Playbooks on a run's page to the runs waiting for
 * approval. The crumb of the page you are on is not a link.
 *
 * A case's pages sit under Security Cases, the case, then the page, as the
 * case's side menu names it (SecurityCaseNavigation.ts): Project > Security
 * Events > Security Cases > CASE-142 > Detections. The case's crumb opens
 * its Overview, and is named for the case once it is read - its layout does
 * that through nameRecordInTrail, as an incident's ModelPage does. An
 * entity's page is named for its entity the same way (nameEntityInTrail).
 */

/*
 * A playbook's page, which opens on its own, and an entity's page, a
 * watchlist's page and a hunt's page, under the section their lists are in.
 * A watchlist's crumb and a hunt's are named for the record once its page
 * has read it (nameRecordInTrail, as a playbook's is).
 */
const DETAIL_TRAILS: Array<[PageMap, Array<string>]> = [
  [
    PageMap.SECURITY_PLAYBOOK_VIEW,
    ["Security Events", "Playbooks", "View Playbook"],
  ],
  [
    PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW,
    ["Security Events", "Events", "Entity Risk", "Entity"],
  ],
  [
    PageMap.SECURITY_EVENTS_WATCHLIST_VIEW,
    ["Security Events", "Detections", "Watchlists", "Watchlist"],
  ],
  [
    PageMap.SECURITY_EVENTS_HUNT_VIEW,
    ["Security Events", "Events", "Hunts", "Hunt"],
  ],
];

/*
 * The pages with a trail of their own: every menu page, the Workspace
 * section's, a case's pages and a playbook.
 */
export function getSecurityEventsBreadcrumbPages(): Array<PageMap> {
  return [
    ...getSecurityEventsMenuItems().map(
      (item: SecurityEventsMenuItem): PageMap => {
        return item.page;
      },
    ),
    ...getSecurityEventsWorkspacePages(),
    ...getSecurityCasePages(),
    ...DETAIL_TRAILS.map(([page]: [PageMap, Array<string>]): PageMap => {
      return page;
    }),
  ];
}

/*
 * The list a detail page is opened from, when its trail names that list
 * after the section: an entity's page sits under Entity Risk, and that crumb
 * opens the list. The trail's order is not the address's - Events, the
 * section, is no part of the address - so it is not found by address.
 */
const DETAIL_LISTS: Array<[PageMap, PageMap]> = [
  [
    PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW,
    PageMap.SECURITY_EVENTS_ENTITY_RISK,
  ],
  [PageMap.SECURITY_EVENTS_WATCHLIST_VIEW, PageMap.SECURITY_EVENTS_WATCHLISTS],
  [PageMap.SECURITY_EVENTS_HUNT_VIEW, PageMap.SECURITY_EVENTS_HUNTS],
];

function getDetailListOf(page: PageMap): PageMap | undefined {
  const entry: [PageMap, PageMap] | undefined = DETAIL_LISTS.find(
    ([candidate]: [PageMap, PageMap]): boolean => {
      return candidate === page;
    },
  );

  return entry ? entry[1] : undefined;
}

// The page a route pattern (as the layout matches it) belongs to.
function getPageForPath(path: string): PageMap | undefined {
  return getSecurityEventsBreadcrumbPages().find((page: PageMap): boolean => {
    return RouteUtil.getRouteString(page) === path;
  });
}

// Where a page's trail says it is, after "Project".
function getTrail(page: PageMap): Array<string> | undefined {
  if (isSecurityCasePage(page)) {
    const caseTrail: Array<string> | undefined = getSecurityCasePageTrail(page);

    return caseTrail
      ? ["Security Events", "Security Cases", ...caseTrail]
      : undefined;
  }

  const detail: [PageMap, Array<string>] | undefined = DETAIL_TRAILS.find(
    ([candidate]: [PageMap, Array<string>]): boolean => {
      return candidate === page;
    },
  );

  return detail ? detail[1] : getSecurityEventsPageTrail(page);
}

// The section a page's trail names: its own, or its list's for a case or a playbook.
function getSectionOf(page: PageMap): SecurityEventsMenuSection | undefined {
  if (isSecurityCasePage(page)) {
    return getSecurityEventsMenuSectionFor(PageMap.SECURITY_CASES);
  }

  switch (page) {
    case PageMap.SECURITY_PLAYBOOK_VIEW:
      return getSecurityEventsMenuSectionFor(PageMap.SECURITY_PLAYBOOKS);
    case PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW:
      return getSecurityEventsMenuSectionFor(
        PageMap.SECURITY_EVENTS_ENTITY_RISK,
      );
    case PageMap.SECURITY_EVENTS_WATCHLIST_VIEW:
      return getSecurityEventsMenuSectionFor(
        PageMap.SECURITY_EVENTS_WATCHLISTS,
      );
    case PageMap.SECURITY_EVENTS_HUNT_VIEW:
      return getSecurityEventsMenuSectionFor(PageMap.SECURITY_EVENTS_HUNTS);
    default:
      return getSecurityEventsMenuSectionFor(page);
  }
}

/*
 * The page a section's crumb opens: its first page, or, for Workspace, the
 * page that shows both workspaces, which every project can open.
 */
function getSectionLandingOf(page: PageMap): PageMap | undefined {
  if (isSecurityEventsWorkspacePage(page)) {
    return SECURITY_EVENTS_WORKSPACE_PAGES.connect;
  }

  const section: SecurityEventsMenuSection | undefined = getSectionOf(page);

  return section?.items[0]?.page;
}

function routeOf(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

/*
 * An entity's page names its entity in the trail and the browser's tab -
 * "Entity Risk > k.morgan@acme-commerce.example", not "Entity Risk > Entity"
 * whichever entity it is - as a case's page names its case. The entity is
 * in the page's query, not its address, so the layout hands it over; the
 * crumb shows it as written (Link.recordName), never looked up as words.
 * Any other page's trail, or a page that names no entity, is left as it is.
 */
export function nameEntityInTrail(data: {
  links: Array<Link> | undefined;
  path: string;
  entityValue: string | null | undefined;
}): Array<Link> | undefined {
  const value: string = (data.entityValue || "").trim();
  const links: Array<Link> | undefined = data.links;

  if (
    !links ||
    links.length === 0 ||
    !value ||
    getPageForPath(data.path) !== PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW
  ) {
    return links;
  }

  return links.map((link: Link, index: number): Link => {
    return index === links.length - 1 ? { ...link, recordName: value } : link;
  });
}

export function getSecurityEventsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const page: PageMap | undefined = getPageForPath(path);
  const trail: Array<string> | undefined = page ? getTrail(page) : undefined;

  if (!page || !trail) {
    return undefined;
  }

  // Project, the page's own crumb and anything between, resolved by address.
  const links: Array<Link> | undefined = BuildBreadcrumbLinksByTitles(page, [
    "Project",
    ...trail,
  ])[path];

  if (!links) {
    return undefined;
  }

  const sectionLanding: PageMap | undefined = getSectionLandingOf(page);
  const detailList: PageMap | undefined = getDetailListOf(page);

  return links.map((link: Link, index: number): Link => {
    const isLast: boolean = index === links.length - 1;

    // A detail page's list: the crumb before its own, after the section.
    if (detailList && index === links.length - 2 && index > 2) {
      return { ...link, to: routeOf(detailList) };
    }

    // "Security Events": the product, where the Products menu opens it.
    if (index === 1 && !isLast) {
      return { ...link, to: routeOf(SECURITY_EVENTS_LANDING_PAGE) };
    }

    // The section: its first page.
    if (index === 2 && !isLast && sectionLanding) {
      return { ...link, to: routeOf(sectionLanding) };
    }

    return link;
  });
}
