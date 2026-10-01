import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Navigation from "../../Utils/Navigation";
import React, { ReactElement, ReactNode } from "react";

/*
 * Which side-menu sections start open, and which one holds the page the user
 * is on.
 *
 * Kept out of the components so the rules can be read, and tested, in one
 * place: SideMenu decides which section holds the current page, and
 * SideMenuSection decides whether it starts collapsed.
 */

/*
 * Section titles that start collapsed in every menu, unless the menu says
 * otherwise with an explicit `defaultCollapsed`.
 *
 * "Advanced" holds what most visits never need: settings, audit logs, owners,
 * custom fields and the Delete page. Left open, it puts all of that beside
 * the pages people came for, and the menu reads as a wall of choices. So it
 * folds away by default, everywhere, including in menus written after this
 * rule, and still opens by itself on any page inside it.
 *
 * The match is on the title a menu passes in (English, before translation).
 * A menu that passes an already translated title, as the Admin Dashboard
 * does, sets `defaultCollapsed` on its Advanced section itself.
 */
export const SECTION_TITLES_COLLAPSED_BY_DEFAULT: ReadonlyArray<string> = [
  "Advanced",
];

export function isTitleCollapsedByDefault(title: string): boolean {
  const normalizedTitle: string = title.trim().toLowerCase();

  return SECTION_TITLES_COLLAPSED_BY_DEFAULT.some(
    (collapsedTitle: string): boolean => {
      return collapsedTitle.toLowerCase() === normalizedTitle;
    },
  );
}

export interface SectionCollapseSettings {
  title: string;
  defaultCollapsed?: boolean | undefined;
  collapsible?: boolean | undefined;
  isActive?: boolean | undefined;
}

/*
 * Whether a section starts collapsed when it mounts.
 *
 * An explicit `defaultCollapsed` wins either way; without one, the title
 * decides. A section that holds the current page always starts open, because
 * collapsing must never hide where the user is. A section that cannot
 * collapse never starts collapsed: it has no toggle to open it again.
 */
export function startsCollapsed(section: SectionCollapseSettings): boolean {
  if (section.collapsible === false || section.isActive) {
    return false;
  }

  return section.defaultCollapsed ?? isTitleCollapsedByDefault(section.title);
}

export type MenuRoute = Link["to"];

export interface MenuEntryRoutes {
  link?: Link | undefined;
  activeRoute?: MenuRoute | undefined;
  subItemLink?: Link | undefined;
}

/*
 * The routes a menu entry stands for: the route that marks it active (its
 * `activeRoute`, else where it links), and the sub-item drawn under it, such
 * as On-Call's "Execution Logs" > "Timeline", which links to the page the
 * user is on.
 */
export function routesOfMenuEntry(entry: MenuEntryRoutes): Array<MenuRoute> {
  const routes: Array<MenuRoute> = [];
  const mainRoute: MenuRoute | undefined = entry.activeRoute || entry.link?.to;

  if (mainRoute) {
    routes.push(mainRoute);
  }

  if (entry.subItemLink?.to) {
    routes.push(entry.subItemLink.to);
  }

  return routes;
}

interface MenuElementProps extends MenuEntryRoutes {
  children?: ReactNode;
}

/*
 * Every route a block of hand-written menu JSX links to.
 *
 * It reads the shape of the props rather than component identity, the same
 * way SideMenu finds the active entry for its phone summary: an element with
 * a `link` is a menu entry, and anything with children is looked into. So
 * SideMenuItem, CountModelSideMenuItem and the per-feature items built on
 * them are all found, and a fragment or a wrapper div is simply walked
 * through.
 */
export function routesInMenuChildren(children: ReactNode): Array<MenuRoute> {
  const routes: Array<MenuRoute> = [];

  React.Children.forEach(children, (child: ReactNode) => {
    if (!React.isValidElement(child)) {
      return;
    }

    const childProps: MenuElementProps = (child as ReactElement)
      .props as MenuElementProps;

    if (childProps.link) {
      routes.push(...routesOfMenuEntry(childProps));
    }

    if (childProps.children) {
      routes.push(...routesInMenuChildren(childProps.children));
    }
  });

  return routes;
}

/*
 * How deep a menu route reaches into the current page's path when the page is
 * BELOW it: one API key's page sits under API Keys, a schedule's timeline
 * under its schedule. 0 when the route is not an ancestor of the current page
 * (or is an external URL, which has no place in the app's path).
 */
export function ancestorDepthOfCurrentPage(route: MenuRoute): number {
  if (!(route instanceof Route)) {
    return 0;
  }

  const segments: Array<string> = route
    .toString()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (segments.length === 0 || !Navigation.isStartWith(route)) {
    return 0;
  }

  return segments.length;
}

/*
 * Which sections hold the page the user is on, given the routes of each
 * section's entries, in menu order.
 *
 * A section holds the page when one of its entries IS the page. When no entry
 * anywhere in the menu is the page (one API key, a single run, a timeline the
 * menu does not list), the page belongs under the entry whose route is its
 * deepest ancestor, so that section counts as holding it. Without that, a
 * collapsed section would hide the very place the user navigated into.
 */
export function sectionsHoldingCurrentPage(
  sectionRoutes: ReadonlyArray<ReadonlyArray<MenuRoute>>,
): Array<boolean> {
  const holdsPage: Array<boolean> = sectionRoutes.map(
    (routes: ReadonlyArray<MenuRoute>): boolean => {
      return routes.some((route: MenuRoute): boolean => {
        return Navigation.isOnThisPage(route);
      });
    },
  );

  if (holdsPage.includes(true)) {
    return holdsPage;
  }

  const depths: Array<number> = sectionRoutes.map(
    (routes: ReadonlyArray<MenuRoute>): number => {
      return routes.reduce((deepest: number, route: MenuRoute): number => {
        return Math.max(deepest, ancestorDepthOfCurrentPage(route));
      }, 0);
    },
  );

  const deepestAncestor: number = Math.max(0, ...depths);

  return depths.map((depth: number): boolean => {
    return deepestAncestor > 0 && depth === deepestAncestor;
  });
}
