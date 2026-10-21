import PageMap from "../PageMap";
import RouteMap, { RouteUtil } from "../RouteMap";
import {
  SECURITY_EVENTS_LANDING_PAGE,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
  getSecurityEventsMenuItems,
  getSecurityEventsMenuSectionFor,
  getSecurityEventsPageTrail,
} from "../SecurityEventsNavigation";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";

/*
 * Each Security Events page's trail names it as the side menu does: the
 * product, the page's section, and the page - Project > Security Events >
 * Security Cases > Assigned to Me. A page named like its section
 * (Overview, Events, Playbooks, Connections) is not named twice. The trails
 * are read from the menu (SecurityEventsNavigation.ts), so a page renamed
 * or moved there is named the same here.
 *
 * Each crumb opens what its name says, as the menus do: Security Events
 * opens the product where the Products menu opens it, the Overview, and a
 * section opens its first page - Security Cases its Open Cases, Playbooks
 * its playbooks. Following the address instead would have sent Security
 * Events to the raw events, and Playbooks on a run's page to the runs
 * waiting for approval. The crumb of the page you are on is not a link.
 */

// The two pages that open on their own, under the section their lists are in.
const DETAIL_TRAILS: Array<[PageMap, Array<string>]> = [
  [
    PageMap.SECURITY_CASE_VIEW,
    ["Security Events", "Security Cases", "View Case"],
  ],
  [
    PageMap.SECURITY_PLAYBOOK_VIEW,
    ["Security Events", "Playbooks", "View Playbook"],
  ],
];

// The pages with a trail of their own: every menu page, a case and a playbook.
export function getSecurityEventsBreadcrumbPages(): Array<PageMap> {
  return [
    ...getSecurityEventsMenuItems().map(
      (item: SecurityEventsMenuItem): PageMap => {
        return item.page;
      },
    ),
    ...DETAIL_TRAILS.map(([page]: [PageMap, Array<string>]): PageMap => {
      return page;
    }),
  ];
}

// The page a route pattern (as the layout matches it) belongs to.
function getPageForPath(path: string): PageMap | undefined {
  return getSecurityEventsBreadcrumbPages().find((page: PageMap): boolean => {
    return RouteUtil.getRouteString(page) === path;
  });
}

// Where a page's trail says it is, after "Project".
function getTrail(page: PageMap): Array<string> | undefined {
  const detail: [PageMap, Array<string>] | undefined = DETAIL_TRAILS.find(
    ([candidate]: [PageMap, Array<string>]): boolean => {
      return candidate === page;
    },
  );

  return detail ? detail[1] : getSecurityEventsPageTrail(page);
}

// The section a page's trail names: its own, or its list's for a case or a playbook.
function getSectionOf(page: PageMap): SecurityEventsMenuSection | undefined {
  switch (page) {
    case PageMap.SECURITY_CASE_VIEW:
      return getSecurityEventsMenuSectionFor(PageMap.SECURITY_CASES);
    case PageMap.SECURITY_PLAYBOOK_VIEW:
      return getSecurityEventsMenuSectionFor(PageMap.SECURITY_PLAYBOOKS);
    default:
      return getSecurityEventsMenuSectionFor(page);
  }
}

function routeOf(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
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

  const section: SecurityEventsMenuSection | undefined = getSectionOf(page);

  return links.map((link: Link, index: number): Link => {
    const isLast: boolean = index === links.length - 1;

    // "Security Events": the product, where the Products menu opens it.
    if (index === 1 && !isLast) {
      return { ...link, to: routeOf(SECURITY_EVENTS_LANDING_PAGE) };
    }

    // The section: its first page.
    if (index === 2 && !isLast && section?.items[0]) {
      return { ...link, to: routeOf(section.items[0].page) };
    }

    return link;
  });
}
