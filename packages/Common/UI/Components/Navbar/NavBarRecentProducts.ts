import type { MoreMenuItem } from "./NavBar";

/*
 * The products menu's "Recently visited" row (NavBarMenuModal): the products
 * someone opened from the menu, the most recent first, remembered on their
 * browser.
 *
 * The row shows six. The menu draws its cards three to a row on a desktop
 * and two to a row on a narrower screen, so six is two full rows, or three.
 * It used to show five at most, and four whenever one of them was the page
 * the user was on: a full row and one card alone under it. A customer asked
 * for six, "since you have the real-estate and 4 items shown now take up 2
 * rows anyway". The dialog only opens from 768px up; a phone gets the menu
 * toggle's list, which has no recent row.
 *
 * More are remembered than shown, because the row leaves some of them out:
 * the product of the page the user is on (they are already there), products
 * of other projects (a product's address names its project, so each project
 * fills a row of its own from the same list), and the Admin Dashboard's
 * pages, which it keeps in the same browser storage. Twenty fills the row
 * for a few projects and keeps the stored list small.
 */
export const RECENT_PRODUCTS_STORAGE_KEY: string =
  "oneuptime-navbar-recent-products";

// How many recent products the row shows: two rows of three cards.
export const RECENT_PRODUCTS_SHOWN: number = 6;

// How many product addresses the browser keeps, the most recent first.
export const RECENT_PRODUCTS_REMEMBERED: number = 20;

/*
 * The remembered addresses, the most recent first, each once. It is a
 * convenience, so a private window, blocked storage or a damaged value just
 * means no recent products. A list stored before the row grew (five
 * addresses) reads as it is.
 */
export function readRecentProductRoutes(): Array<string> {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }

    const raw: string | null = window.localStorage.getItem(
      RECENT_PRODUCTS_STORAGE_KEY,
    );

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const routes: Array<string> = [];

    for (const value of parsed) {
      if (typeof value !== "string" || routes.includes(value)) {
        continue;
      }

      routes.push(value);

      if (routes.length === RECENT_PRODUCTS_REMEMBERED) {
        break;
      }
    }

    return routes;
  } catch {
    // Storage blocked (private mode, a sandboxed frame) or bad JSON.
    return [];
  }
}

/*
 * Put a product first in the list, once, and forget the oldest past the
 * limit. Storage that refuses the write is ignored: the menu works the same,
 * it just remembers nothing.
 */
export function rememberRecentProductRoute(route: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    const others: Array<string> = readRecentProductRoutes().filter(
      (remembered: string): boolean => {
        return remembered !== route;
      },
    );

    window.localStorage.setItem(
      RECENT_PRODUCTS_STORAGE_KEY,
      JSON.stringify([route, ...others].slice(0, RECENT_PRODUCTS_REMEMBERED)),
    );
  } catch {
    // Storage blocked or full.
  }
}

/*
 * The products the row shows: the remembered addresses that are products of
 * this menu, in the order they were opened, the most recent first, without
 * the product of the page the user is on, each once, at most six.
 */
export function pickRecentProducts(
  routes: ReadonlyArray<string>,
  items: ReadonlyArray<MoreMenuItem>,
  isCurrentPage: (item: MoreMenuItem) => boolean,
): Array<MoreMenuItem> {
  const itemByRoute: Map<string, MoreMenuItem> = new Map();

  for (const item of items) {
    itemByRoute.set(item.route.toString(), item);
  }

  const picked: Array<MoreMenuItem> = [];

  for (const route of routes) {
    const item: MoreMenuItem | undefined = itemByRoute.get(route);

    if (!item || picked.includes(item) || isCurrentPage(item)) {
      continue;
    }

    picked.push(item);

    if (picked.length === RECENT_PRODUCTS_SHOWN) {
      break;
    }
  }

  return picked;
}
