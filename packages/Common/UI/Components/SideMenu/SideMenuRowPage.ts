import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Navigation from "../../Utils/Navigation";
import { pageOfLink } from "./SideMenuEntryState";
import {
  MenuEntryRoutes,
  MenuRoute,
  routesOfMenuEntry,
} from "./SideMenuSectionState";
import React from "react";

/*
 * The list a page is one row of, in a side menu that has no entry for the
 * page itself.
 *
 * A list's rows open pages of their own: one node of a Docker Swarm under
 * Nodes, one guest of a Proxmox cluster under Guests, one volume of a
 * storage array under Volumes, one API key under API Keys. The menu has an
 * entry for the list, never for each row, so on a row's page nothing in it
 * was lit, a screen reader heard nothing marked, and on a phone the menu's
 * button could only borrow the trail's last crumb ("Node Detail") instead
 * of naming where the reader is ("Infrastructure / Nodes"). Kubernetes, a
 * vCenter and an app platform each lit their lists by hand, one detail page
 * at a time, and every other menu did not.
 *
 * So the menu itself works it out, for every menu at once: on a page none
 * of its entries is for, an entry that leads to the page's parent - the
 * page's address less its last part - holds the page as one of its rows.
 * It is lit there, says so to a screen reader (aria-current="true": it
 * holds the page, while its link leads elsewhere), opens its section, and
 * names the phone's button.
 *
 * Only a list with no entries of its own below it: an entry that leads to
 * a resource's Overview (/monitors/<id>) has the resource's other pages
 * below it (/monitors/<id>/logs), so a page beside them that the menu does
 * not list - a manual monitor's Criteria, an OpenShift-only page on another
 * cluster - is one of those pages, not a row, and lights nothing. So does a
 * list whose filtered views live below it, as Open Cases' Assigned to Me
 * does under /security-events/cases: a case's page there is not told apart
 * from another view of the list.
 *
 * Only a page one step below the list: a row's own sub-pages (a pod's logs
 * under /pods/<pod>/logs) are not rows of the list.
 */

function segmentsOf(route: Route): Array<string> {
  return pageOfLink(route)
    .toString()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    })
    .map((segment: string): string => {
      // Paths are matched without case, as React Router matches them.
      return segment.toLowerCase();
    });
}

// Where an entry leads, and where its sub-item does.
function leadsOfEntry(entry: MenuEntryRoutes): Array<Route> {
  return [entry.link?.to, entry.subItemLink?.to].filter(
    (route: MenuRoute | undefined): route is Route => {
      return route instanceof Route;
    },
  );
}

function isBelow(data: {
  route: Array<string>;
  ancestor: Array<string>;
}): boolean {
  return (
    data.route.length > data.ancestor.length &&
    data.ancestor.every((segment: string, index: number): boolean => {
      return data.route[index] === segment;
    })
  );
}

/*
 * The route of the list the page the user is on is one row of, or undefined
 * when the menu lists the page itself, or no entry of the menu holds it as
 * a row (see above).
 */
export function getRowListRoute(
  entries: ReadonlyArray<MenuEntryRoutes>,
): Route | undefined {
  const isListed: boolean = entries.some((entry: MenuEntryRoutes): boolean => {
    return routesOfMenuEntry(entry).some((route: MenuRoute): boolean => {
      return Navigation.isOnThisPage(route);
    });
  });

  if (isListed) {
    return undefined;
  }

  const currentDepth: number = segmentsOf(Navigation.getCurrentRoute()).length;
  const leads: Array<Route> = entries.flatMap(leadsOfEntry);
  const leadSegments: Array<Array<string>> = leads.map(segmentsOf);

  for (let index: number = 0; index < leads.length; index++) {
    const lead: Route = leads[index]!;
    const segments: Array<string> = leadSegments[index]!;

    if (
      segments.length === 0 ||
      segments.length !== currentDepth - 1 ||
      !Navigation.isStartWith(pageOfLink(lead) as Route)
    ) {
      continue;
    }

    const hasEntriesBelow: boolean = leadSegments.some(
      (other: Array<string>): boolean => {
        return isBelow({ route: other, ancestor: segments });
      },
    );

    if (!hasEntriesBelow) {
      return pageOfLink(lead) as Route;
    }
  }

  return undefined;
}

/*
 * Whether a link leads to the list the page is one row of: the entry that
 * holds the page.
 */
export function isRowListLink(
  link: Link | undefined,
  rowList: Route | null | undefined,
): boolean {
  if (!link || !rowList || !(link.to instanceof Route)) {
    return false;
  }

  const linkSegments: Array<string> = segmentsOf(link.to);
  const listSegments: Array<string> = segmentsOf(rowList);

  return (
    linkSegments.length === listSegments.length &&
    linkSegments.every((segment: string, index: number): boolean => {
      return listSegments[index] === segment;
    })
  );
}

/*
 * The list a SideMenu worked out the page is a row of, for the entries it
 * draws (SideMenuItem). Outside a SideMenu, or on a page the menu lists,
 * there is none.
 */
const SideMenuRowListContext: React.Context<Route | null> =
  React.createContext<Route | null>(null);

export default SideMenuRowListContext;
