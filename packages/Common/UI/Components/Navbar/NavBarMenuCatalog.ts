import Route from "../../../Types/API/Route";
import Navigation from "../../Utils/Navigation";
import type { MoreMenuItem } from "./NavBar";
import { useState } from "react";

/*
 * The products menu's catalog rules: which product is the page the user is
 * on, how products group into categories, and which categories are open.
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

// Looks an English text up in the reader's language.
export type MenuWordLookup = (text: string) => string;

/*
 * THE WORDS A PRODUCT IS DRAWN WITH, LOOKED UP ONCE (#8075).
 *
 * An item's title, description and category are English, looked up where
 * they are drawn - the Admin Dashboard hands its menu over so ("Users",
 * "Management") - unless the item says each is in the reader's words
 * already (isTitleTranslated, isDescriptionTranslated,
 * isCategoryTranslated), as the Dashboard's keyed ones are: those are
 * drawn as given. The products menu drew all three as given, so the Admin
 * Dashboard's menu read English in every language; the bar, its
 * breadcrumb, a pin and the phone's rows already followed the rule
 * (#7790).
 */
export function getItemTitle(
  item: MoreMenuItem,
  lookUp: MenuWordLookup,
): string {
  return item.isTitleTranslated ? item.title : lookUp(item.title);
}

export function getItemDescription(
  item: MoreMenuItem,
  lookUp: MenuWordLookup,
): string {
  return item.isDescriptionTranslated
    ? item.description
    : lookUp(item.description);
}

/*
 * A category's heading. The items of one category share its words, and
 * say alike whether they are translated. A product without a category is
 * under the menu's own "Other", looked up.
 */
export function getCategoryHeading(
  category: MenuCategory,
  lookUp: MenuWordLookup,
): string {
  const first: MoreMenuItem | undefined = category.items[0];

  if (!first?.category) {
    return lookUp(UNCATEGORIZED_TITLE);
  }

  return first.isCategoryTranslated ? category.title : lookUp(category.title);
}

/*
 * Whether a product matches what was typed into the menu's search: its
 * words as drawn - so a German admin finds Users by typing "Benutzer" - and
 * as handed over, with its keywords, so the familiar English names and
 * acronyms still find it whatever the language.
 */
export function doesItemMatchSearch(
  item: MoreMenuItem,
  query: string,
  lookUp: MenuWordLookup,
): boolean {
  const normalizedQuery: string = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    getItemTitle(item, lookUp),
    getItemDescription(item, lookUp),
    item.title,
    item.description,
    ...(item.keywords || []),
  ].some((value: string): boolean => {
    return value.toLowerCase().includes(normalizedQuery);
  });
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
 * Which categories are open.
 *
 * The maintainer asked to "reduce decision / choice paralysis as much as
 * possible: show people as few options as possible". The Dashboard's products
 * menu used to open on every one of its 40-odd products, each a card with a
 * two-line description, so someone looking for Incidents read past
 * Kubernetes, Proxmox and Ceph to find it.
 *
 * So a menu that names the categories it opens on (the Dashboard names
 * Essentials) draws every category as a row that folds: its name, how many
 * products it holds and what they are called. One click, or Enter, opens it
 * or folds it again. Nothing is removed: search ignores folding and finds
 * every product, and the category holding the page the user is on opens by
 * itself, so the menu always shows where they are.
 *
 * The categories a menu names open with it, every time. The maintainer asked
 * to "always have Essentials expanded by default": they are the products a
 * problem flows through, and the reason most people open the menu. Then to
 * have Essentials "in this group as well and have it open by default and not
 * collapsed": a row of the same list as every other category, which folds
 * like the others. Folding it lasts until the menu closes. It is never
 * remembered, so one stray click does not hide the essentials on every later
 * visit, and a fold of them remembered from before, when a fold of Essentials
 * was remembered like any other, is ignored.
 *
 * Every other category starts folded. What someone opens or folds among them
 * is remembered on their browser, so a team that lives in Infrastructure
 * does not open it again on every visit. A menu that names no categories
 * (the Admin Dashboard's six entries) shows every category open, with
 * nothing to fold, as before.
 */
export interface CategoryFoldState {
  // The categories that open with the menu. Every other one starts folded.
  openByDefault: ReadonlyArray<string>;
  // The categories holding the page the user is on.
  holdingCurrentPage: ReadonlyArray<string>;
  // What this person opened or folded before, on this browser.
  remembered: ReadonlyMap<string, boolean>;
  // What they opened or folded since this menu was opened.
  chosenNow: ReadonlyMap<string, boolean>;
}

/*
 * Whether opening or folding the category is remembered on the browser: not
 * for the categories the menu opens on, which open with the next menu
 * whatever was done to them in this one.
 */
export function isCategoryFoldRemembered(
  category: string,
  state: CategoryFoldState,
): boolean {
  return !state.openByDefault.includes(category);
}

/*
 * A choice made in this menu wins, for every category. Otherwise a category
 * the menu opens on is open, whatever was remembered; so is the category of
 * the page the user is on, which must never be folded away when the menu
 * opens; then what they chose last time holds; otherwise it is folded.
 */
export function isCategoryOpen(
  category: string,
  state: CategoryFoldState,
): boolean {
  const chosenNow: boolean | undefined = state.chosenNow.get(category);

  if (chosenNow !== undefined) {
    return chosenNow;
  }

  if (state.openByDefault.includes(category)) {
    return true;
  }

  if (state.holdingCurrentPage.includes(category)) {
    return true;
  }

  const remembered: boolean | undefined = state.remembered.get(category);

  if (remembered !== undefined) {
    return remembered;
  }

  return false;
}

/*
 * Category title -> open (true) or folded (false), for the categories the
 * person opened or folded themselves (never the ones the menu opens on). Per
 * browser: it is a convenience, so a private window, blocked storage or a
 * damaged value just means the defaults.
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
  /*
   * Whether categories fold at all, each with a row that folds and opens
   * it: false for a menu that names no categories to open on.
   */
  isEnabled: boolean;
  isOpen: (category: string) => boolean;
  /*
   * Open a folded category, or fold an open one. The choice is remembered,
   * but for the categories the menu opens on: those open with the next menu
   * again. In a menu that folds nothing, it does nothing.
   */
  toggle: (category: string) => void;
}

/*
 * The fold state of one open menu. Call it in the component that mounts when
 * the menu opens, so each opening starts from the categories it opens on,
 * the remembered choices and the page the user is on now.
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

    if (isCategoryFoldRemembered(category, state)) {
      rememberCategoryFold(category, nextIsOpen);
    }
  };

  return { isEnabled, isOpen, toggle };
}

// The heading of the hidden products' row when the caller names none.
export const DEFAULT_HIDDEN_PRODUCTS_TITLE: string = "More products";

/*
 * The hidden products as the list holds them: each under the hidden row's
 * title in place of its own category, after every listed product, so the
 * row is the list's last one and folds, opens, searches and moves the
 * keyboard cursor the way a category does. The row's title is English
 * (NavBar's moreMenuHiddenTitle), looked up where it is drawn, whatever
 * the product's own category said of its words.
 */
export const getMenuItemsWithHidden: (data: {
  items: ReadonlyArray<MoreMenuItem>;
  hiddenItems?: ReadonlyArray<MoreMenuItem> | undefined;
  hiddenTitle: string;
}) => Array<MoreMenuItem> = (data: {
  items: ReadonlyArray<MoreMenuItem>;
  hiddenItems?: ReadonlyArray<MoreMenuItem> | undefined;
  hiddenTitle: string;
}): Array<MoreMenuItem> => {
  return [
    ...data.items,
    ...(data.hiddenItems || []).map((item: MoreMenuItem): MoreMenuItem => {
      return {
        ...item,
        category: data.hiddenTitle,
        isCategoryTranslated: false,
      };
    }),
  ];
};
