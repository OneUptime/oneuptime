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
 * The maintainer asked for "collapsing things in the side menu that are not
 * used frequently", in every side menu, so that people are not met with a
 * wall of choices: on the Incidents menu, Overview and Episodes open, and
 * AI, Workspace, Rules and Settings folded away.
 *
 * So a side menu shows, open, the sections that hold what people come to it
 * for: the lists and overviews of a product, and the views of the resource
 * whose page this is. Every other section is folded down to its title: still
 * there to be found and opened with one click, and open by itself on any page
 * inside it, but not one more row of choices on every visit. These titles
 * name that kind of section in every menu that has one:
 *
 *  - what most visits never need: "Advanced" (settings, audit logs, owners,
 *    custom fields, the Delete page) and "Developer" (Terraform, API, AI
 *    Assistants: managing a resource from code rather than the dashboard);
 *  - setting things up, done once and revisited rarely: settings, rules,
 *    chat workspaces, AI, owners, branding, security, notification setup;
 *  - records looked at when something needs checking: logs and reports;
 *  - reading for a first visit rather than every visit: help;
 *  - deleting things: the danger zone.
 *
 * A section whose title is not here starts open. A menu with a section that
 * is rarely used but titled for its own subject (the "Calendar" feed in a
 * person's User Settings, say) sets `defaultCollapsed` on it; one whose
 * section here is an everyday one (a workflow's run history, in "Logs")
 * keeps it open with `defaultCollapsed: false`. The guard
 * Common/Tests/App/RarelyUsedMenuSectionsCollapsed.test.tsx renders every
 * side menu and holds each of them to this.
 *
 * The match is on the title a menu passes in (English, before translation).
 * A menu that passes an already translated title, as the Admin Dashboard
 * does, sets `defaultCollapsed` on those sections itself.
 */
export const SECTION_TITLES_COLLAPSED_BY_DEFAULT: ReadonlyArray<string> = [
  // What most visits never need.
  "Advanced",
  "Developer",
  // Setting things up: done once, revisited rarely.
  "Settings",
  "Configuration",
  "Manage",
  "Management",
  "Rules",
  "Workspace",
  "AI",
  "Owners",
  "Ownership",
  "Branding",
  "Security",
  "Notifications",
  // Records, looked at when something needs checking.
  "Logs",
  "Notification Logs",
  "Audit Logs",
  "On-Call Logs",
  "Reports",
  // Reading for a first visit, not every visit.
  "Help",
  // Deleting things.
  "Danger Zone",
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
  /*
   * What the person last chose for this section of this menu by hand: true
   * for open, false for folded, undefined when they never toggled it
   * (readRememberedSectionFold).
   */
  rememberedOpen?: boolean | undefined;
}

/*
 * Whether a section starts collapsed when it mounts.
 *
 * A section that holds the current page always starts open, because
 * collapsing must never hide where the user is - not even a fold the person
 * chose. A section that cannot collapse never starts collapsed: it has no
 * toggle to open it again. Then what the person last chose for it by hand
 * (#6816: Settings under Incidents, opened every day, stays open); then an
 * explicit `defaultCollapsed`, either way; without one, the title decides.
 */
export function startsCollapsed(section: SectionCollapseSettings): boolean {
  if (section.collapsible === false || section.isActive) {
    return false;
  }

  if (section.rememberedOpen !== undefined) {
    return !section.rememberedOpen;
  }

  return section.defaultCollapsed ?? isTitleCollapsedByDefault(section.title);
}

/*
 * REMEMBERED FOLDS (#6816).
 *
 * A section the person folds or opens by hand stays that way on their next
 * visit, in that menu: the products menu remembers its categories the same
 * way (NavBarMenuCatalog). It is a convenience kept in the browser, so a
 * private window or blocked storage just means the defaults, every time.
 *
 * Only a choice made by hand is remembered. A section that opened by itself
 * for the page the person arrived on is not, and every section never
 * toggled keeps following the rule above, so a later change to the defaults
 * still reaches it.
 */
export const SIDE_MENU_FOLDS_STORAGE_KEY: string = "oneuptime-side-menu-folds";

/*
 * How many menus the browser remembers folds for, the most recently changed
 * first. A person changes a handful; the oldest beyond this are forgotten so
 * the stored value stays small.
 */
export const SIDE_MENU_FOLDS_MENUS_REMEMBERED: number = 50;

/*
 * A path segment that names one record or project rather than a page: an
 * ObjectID (hex, with or without the dashes of a UUID) or a number.
 */
const RECORD_SEGMENT: RegExp = /^(?:[0-9a-f]{8,}(?:-[0-9a-f]+)*|\d+)$/i;

/*
 * Which menu a remembered fold belongs to: the address of the menu's first
 * entry, with every record and project id taken out. So every monitor's own
 * menu shares one memory ("/dashboard/:id/monitors/:id"), in every project,
 * while the Incidents and Alerts menus - whose sections have the same
 * titles - each have their own. A menu with no entry to read is named by its
 * section titles.
 */
export function getSideMenuFoldMemoryKey(data: {
  firstRoute?: MenuRoute | undefined;
  sectionTitles: ReadonlyArray<string>;
}): string {
  const route: string = data.firstRoute ? data.firstRoute.toString() : "";
  const path: string = route.split(/[?#]/)[0] || "";

  if (path) {
    return path
      .split("/")
      .map((segment: string): string => {
        return RECORD_SEGMENT.test(segment) ? ":id" : segment;
      })
      .join("/");
  }

  return `sections:${data.sectionTitles.join("|")}`;
}

type RememberedMenuFolds = Array<[string, Record<string, boolean>]>;

const readAllRememberedFolds: () => RememberedMenuFolds =
  (): RememberedMenuFolds => {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return [];
      }

      const raw: string | null = window.localStorage.getItem(
        SIDE_MENU_FOLDS_STORAGE_KEY,
      );

      if (!raw) {
        return [];
      }

      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      const menus: RememberedMenuFolds = [];

      for (const entry of parsed) {
        if (
          !Array.isArray(entry) ||
          typeof entry[0] !== "string" ||
          !entry[1] ||
          typeof entry[1] !== "object" ||
          Array.isArray(entry[1])
        ) {
          continue;
        }

        const folds: Record<string, boolean> = {};

        for (const [title, isOpen] of Object.entries(
          entry[1] as Record<string, unknown>,
        )) {
          if (typeof isOpen === "boolean") {
            folds[title] = isOpen;
          }
        }

        menus.push([entry[0], folds]);
      }

      return menus;
    } catch {
      // Storage blocked (private mode, a sandboxed frame) or bad JSON.
      return [];
    }
  };

/*
 * What the person last chose for a section of a menu by hand: true for
 * open, false for folded, undefined when they never toggled it.
 */
export function readRememberedSectionFold(
  menuKey: string,
  sectionTitle: string,
): boolean | undefined {
  const menu: [string, Record<string, boolean>] | undefined =
    readAllRememberedFolds().find(
      (entry: [string, Record<string, boolean>]): boolean => {
        return entry[0] === menuKey;
      },
    );

  return menu ? menu[1][sectionTitle] : undefined;
}

/*
 * Remember a section the person folded or opened by hand. Its menu moves to
 * the front, and the oldest menus past the limit are forgotten. Storage that
 * refuses the write is ignored: the section still folds, it just is not
 * remembered.
 */
export function rememberSectionFold(
  menuKey: string,
  sectionTitle: string,
  isOpen: boolean,
): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    const menus: RememberedMenuFolds = readAllRememberedFolds();
    const existing: [string, Record<string, boolean>] | undefined = menus.find(
      (entry: [string, Record<string, boolean>]): boolean => {
        return entry[0] === menuKey;
      },
    );
    const others: RememberedMenuFolds = menus.filter(
      (entry: [string, Record<string, boolean>]): boolean => {
        return entry[0] !== menuKey;
      },
    );

    const folds: Record<string, boolean> = {
      ...(existing ? existing[1] : {}),
      [sectionTitle]: isOpen,
    };

    window.localStorage.setItem(
      SIDE_MENU_FOLDS_STORAGE_KEY,
      JSON.stringify(
        [[menuKey, folds], ...others].slice(
          0,
          SIDE_MENU_FOLDS_MENUS_REMEMBERED,
        ),
      ),
    );
  } catch {
    // Storage blocked or full.
  }
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
 * Every entry a block of hand-written menu JSX draws: its link, the route
 * that lights it and its sub-item.
 *
 * It reads the shape of the props rather than component identity, the same
 * way SideMenu finds the active entry for its phone summary: an element with
 * a `link` is a menu entry, and anything with children is looked into. So
 * SideMenuItem, CountModelSideMenuItem and the per-feature items built on
 * them are all found, and a fragment or a wrapper div is simply walked
 * through.
 */
export function entriesInMenuChildren(
  children: ReactNode,
): Array<MenuEntryRoutes> {
  const entries: Array<MenuEntryRoutes> = [];

  React.Children.forEach(children, (child: ReactNode) => {
    if (!React.isValidElement(child)) {
      return;
    }

    const childProps: MenuElementProps = (child as ReactElement)
      .props as MenuElementProps;

    if (childProps.link) {
      entries.push({
        link: childProps.link,
        activeRoute: childProps.activeRoute,
        subItemLink: childProps.subItemLink,
      });
    }

    if (childProps.children) {
      entries.push(...entriesInMenuChildren(childProps.children));
    }
  });

  return entries;
}

// Every route a block of hand-written menu JSX links to (see above).
export function routesInMenuChildren(children: ReactNode): Array<MenuRoute> {
  return entriesInMenuChildren(children).flatMap(routesOfMenuEntry);
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
