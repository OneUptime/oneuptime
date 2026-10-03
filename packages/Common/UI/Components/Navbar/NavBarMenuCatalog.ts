import Route from "../../../Types/API/Route";
import Navigation from "../../Utils/Navigation";
import type { MoreMenuItem } from "./NavBar";
import { useState } from "react";

/*
 * The products menu's catalog rules: which product is the page the user is
 * on, how products group into categories, and which categories start folded.
 *
 * Kept out of the components so the desktop products menu (NavBarMenuModal)
 * and the phone menu (NavBar) answer these questions the same way, and so the
 * rules can be read and tested in one place, like the side menu's
 * SideMenuSectionState.ts.
 */

/*
 * One menu item can own several route prefixes (e.g. a merged "Network" item
 * spanning /network-devices and /network-sites) — check them all.
 */
export function isMoreMenuItemActive(item: MoreMenuItem): boolean {
  const routesToCheck: Array<Route> = [
    item.activeRoute || item.route,
    ...(item.additionalActiveRoutes || []),
  ];
  return routesToCheck.some((route: Route) => {
    return Navigation.isStartWith(route);
  });
}

// The heading a product without a category is listed under.
export const UNCATEGORIZED_TITLE: string = "Other";

export function categoryOf(item: MoreMenuItem): string {
  return item.category || UNCATEGORIZED_TITLE;
}

export interface MenuCategory {
  title: string;
  items: Array<MoreMenuItem>;
}

/*
 * Products grouped by category, in the order each category first appears in
 * the catalog: the catalog's own order is the order people see.
 */
export function groupItemsByCategory(
  items: ReadonlyArray<MoreMenuItem>,
): Array<MenuCategory> {
  const categories: Array<MenuCategory> = [];
  const byTitle: Map<string, MenuCategory> = new Map();

  for (const item of items) {
    const title: string = categoryOf(item);
    let category: MenuCategory | undefined = byTitle.get(title);

    if (!category) {
      category = { title, items: [] };
      byTitle.set(title, category);
      categories.push(category);
    }

    category.items.push(item);
  }

  return categories;
}

/*
 * Which categories start folded.
 *
 * The maintainer asked to "reduce decision / choice paralysis as much as
 * possible: show people as few options as possible". The Dashboard's products
 * menu used to open on every one of its 40-odd products, each a card with a
 * two-line description, so someone looking for Incidents read past
 * Kubernetes, Proxmox and Ceph to find it.
 *
 * So a menu that names the categories it opens on (the Dashboard names
 * Essentials) folds every other category down to one line: its name, how
 * many products it holds and what they are called. One click, or Enter,
 * opens it. Nothing is removed: search ignores folding and finds every
 * product, and the category holding the page the user is on opens by itself,
 * so the menu always shows where they are.
 *
 * What someone opens or folds is remembered on their browser, so a team that
 * lives in Infrastructure does not open it again on every visit. A menu that
 * names no categories (the Admin Dashboard's six entries) shows every
 * category open, as before.
 */
export interface CategoryFoldState {
  // The categories the menu opens on. Every other one starts folded.
  openByDefault: ReadonlyArray<string>;
  // The categories holding the page the user is on.
  holdingCurrentPage: ReadonlyArray<string>;
  // What this person opened or folded before, on this browser.
  remembered: ReadonlyMap<string, boolean>;
  // What they opened or folded since this menu was opened.
  chosenNow: ReadonlyMap<string, boolean>;
}

/*
 * A choice made in this menu wins; then the page the user is on, which must
 * never be folded away when the menu opens; then what they chose last time;
 * then the menu's default.
 */
export function isCategoryOpen(
  category: string,
  state: CategoryFoldState,
): boolean {
  const chosenNow: boolean | undefined = state.chosenNow.get(category);

  if (chosenNow !== undefined) {
    return chosenNow;
  }

  if (state.holdingCurrentPage.includes(category)) {
    return true;
  }

  const remembered: boolean | undefined = state.remembered.get(category);

  if (remembered !== undefined) {
    return remembered;
  }

  return state.openByDefault.includes(category);
}

/*
 * Category title -> open (true) or folded (false), for the categories the
 * person opened or folded themselves. Per browser: it is a convenience, so a
 * private window, blocked storage or a damaged value just means the defaults.
 */
export const CATEGORY_FOLDS_STORAGE_KEY: string =
  "oneuptime-navbar-product-categories";

export function readRememberedCategoryFolds(): Map<string, boolean> {
  const folds: Map<string, boolean> = new Map();

  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return folds;
    }

    const raw: string | null = window.localStorage.getItem(
      CATEGORY_FOLDS_STORAGE_KEY,
    );

    if (!raw) {
      return folds;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return folds;
    }

    for (const [category, isOpen] of Object.entries(parsed)) {
      if (typeof isOpen === "boolean") {
        folds.set(category, isOpen);
      }
    }
  } catch {
    // Storage blocked (private mode, a sandboxed frame) or bad JSON.
    return new Map();
  }

  return folds;
}

export function rememberCategoryFold(category: string, isOpen: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    const folds: Map<string, boolean> = readRememberedCategoryFolds();
    folds.set(category, isOpen);

    window.localStorage.setItem(
      CATEGORY_FOLDS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(folds)),
    );
  } catch {
    // Storage blocked or full: the choice still holds while the menu is open.
  }
}

export interface CategoryFolds {
  // False for a menu that names no categories to open on: nothing folds.
  isEnabled: boolean;
  isOpen: (category: string) => boolean;
  // Open a folded category, or fold an open one, and remember it.
  toggle: (category: string) => void;
}

/*
 * The fold state of one open menu. Call it in the component that mounts when
 * the menu opens, so each opening starts from the remembered choices and from
 * the page the user is on now.
 */
export function useCategoryFolds(
  items: ReadonlyArray<MoreMenuItem>,
  categoriesOpenByDefault: ReadonlyArray<string> | undefined,
): CategoryFolds {
  const isEnabled: boolean = Boolean(categoriesOpenByDefault);

  const [remembered] = useState<Map<string, boolean>>(() => {
    return isEnabled ? readRememberedCategoryFolds() : new Map();
  });

  const [chosenNow, setChosenNow] = useState<Map<string, boolean>>(() => {
    return new Map();
  });

  const holdingCurrentPage: Array<string> = items
    .filter((item: MoreMenuItem): boolean => {
      return isMoreMenuItemActive(item);
    })
    .map(categoryOf);

  const state: CategoryFoldState = {
    openByDefault: categoriesOpenByDefault || [],
    holdingCurrentPage,
    remembered,
    chosenNow,
  };

  const isOpen: (category: string) => boolean = (category: string): boolean => {
    return !isEnabled || isCategoryOpen(category, state);
  };

  const toggle: (category: string) => void = (category: string): void => {
    if (!isEnabled) {
      return;
    }

    const nextIsOpen: boolean = !isCategoryOpen(category, state);

    setChosenNow((previous: Map<string, boolean>) => {
      const next: Map<string, boolean> = new Map(previous);
      next.set(category, nextIsOpen);
      return next;
    });

    rememberCategoryFold(category, nextIsOpen);
  };

  return { isEnabled, isOpen, toggle };
}
