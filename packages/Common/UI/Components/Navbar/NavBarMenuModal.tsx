import Icon from "../Icon/Icon";
import KeyboardShortcut, {
  KeyboardShortcutSize,
} from "../KeyboardShortcut/KeyboardShortcut";
import KeyboardKey from "../KeyboardShortcut/KeyboardKey";
import Link from "../Link/Link";
import Navigation from "../../Utils/Navigation";
import useTranslateValue from "../../Utils/Translation";
import IconProp from "../../../Types/Icon/IconProp";
import URL from "../../../Types/API/URL";
import type { MoreMenuItem } from "./NavBar";
import NavBarCategoryToggle from "./NavBarCategoryToggle";
import {
  CategoryFolds,
  groupItemsByCategory,
  isMoreMenuItemActive,
  MenuCategory,
  UNCATEGORIZED_TITLE,
  useCategoryFolds,
} from "./NavBarMenuCatalog";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";

interface IconColorClasses {
  bg: string;
  ring: string;
  text: string;
}

/*
 * Icon color map carried over from the former NavBarMenuItem, extended with the
 * few colors the dashboard items use (yellow/red/teal) plus a glyph text color
 * so every product renders in its intended color. Unknown colors fall back to
 * indigo.
 */
const ICON_COLOR_CLASSES: Record<string, IconColorClasses> = {
  purple: {
    bg: "bg-purple-50",
    ring: "ring-purple-200",
    text: "text-purple-600",
  },
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  gray: { bg: "bg-gray-100", ring: "ring-gray-300", text: "text-gray-600" },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  green: { bg: "bg-green-50", ring: "ring-green-200", text: "text-green-600" },
  cyan: { bg: "bg-cyan-50", ring: "ring-cyan-200", text: "text-cyan-600" },
  slate: { bg: "bg-slate-100", ring: "ring-slate-300", text: "text-slate-600" },
  indigo: {
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    text: "text-indigo-600",
  },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  orange: {
    bg: "bg-orange-50",
    ring: "ring-orange-200",
    text: "text-orange-600",
  },
  stone: { bg: "bg-stone-100", ring: "ring-stone-300", text: "text-stone-600" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  yellow: {
    bg: "bg-yellow-50",
    ring: "ring-yellow-200",
    text: "text-yellow-600",
  },
  red: { bg: "bg-red-50", ring: "ring-red-200", text: "text-red-600" },
  teal: { bg: "bg-teal-50", ring: "ring-teal-200", text: "text-teal-600" },
};

// Persist the handful of most-recently opened products across sessions.
const RECENT_STORAGE_KEY: string = "oneuptime-navbar-recent-products";
const RECENT_LIMIT: number = 5;

const readRecentRoutes: () => string[] = (): string[] => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }
    const raw: string | null = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value: unknown): value is string => {
      return typeof value === "string";
    });
  } catch {
    // Ignore storage access / parse errors (e.g. private mode, bad JSON).
    return [];
  }
};

const writeRecentRoute: (routeString: string) => void = (
  routeString: string,
): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const existing: string[] = readRecentRoutes().filter((route: string) => {
      return route !== routeString;
    });
    const next: string[] = [routeString, ...existing].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write errors (e.g. private mode, quota exceeded).
  }
};

export interface ComponentProps {
  items: MoreMenuItem[];
  /*
   * The categories the menu opens on. Every other category starts folded to
   * one line until the user opens it (click, or Enter on its row); search
   * ignores folding, and the category holding the current page opens by
   * itself. Leave it unset to show every category open. See
   * NavBarMenuCatalog.ts for the rules.
   */
  categoriesOpenByDefault?: Array<string> | undefined;
  footer?:
    | {
        title: string;
        description: string;
        link: URL;
      }
    | undefined;
  searchPlaceholder?: string | undefined;
  noResultsText?: string | undefined;
  /*
   * Defaults to visible for direct/legacy consumers. Dashboard hides it when
   * its command palette owns Cmd/Ctrl+K instead of this products menu.
   */
  showCommandKShortcutHint?: boolean | undefined;
  keyboardHint?: string | undefined;
  recentLabel?: string | undefined;
  onClose: () => void;
}

/*
 * One stop of the keyboard cursor, in the order the rows are on screen: a
 * product card, or the heading row of a category that folds.
 */
interface ItemEntry {
  kind: "item";
  key: string;
  flatIndex: number;
  item: MoreMenuItem;
}

interface CategoryEntry {
  kind: "category";
  key: string;
  flatIndex: number;
  category: string;
}

type MenuEntry = ItemEntry | CategoryEntry;

interface MenuGroup {
  key: string;
  title: string;
  isRecent: boolean;
  // The heading row that folds and opens the group, when it can fold.
  toggle: CategoryEntry | undefined;
  isOpen: boolean;
  // Every product in the group, on screen or folded away.
  items: Array<MoreMenuItem>;
  // The product cards on screen.
  shownEntries: Array<ItemEntry>;
}

interface RawGroup {
  title: string;
  items: Array<MoreMenuItem>;
  isRecent: boolean;
}

// The element aria-activedescendant points at for an entry.
const entryElementId: (entry: MenuEntry) => string = (
  entry: MenuEntry,
): string => {
  return entry.kind === "category"
    ? `navbar-menu-category-${entry.flatIndex}`
    : `navbar-menu-option-${entry.flatIndex}`;
};

const NavBarMenuModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [query, setQuery] = useState<string>("");
  /*
   * The entry the keyboard cursor is on, by key rather than position: opening
   * a category moves every row below it, and the cursor must stay on the
   * row the user is on. Unset means "the default": the current page's
   * product when idle, the first match while searching.
   */
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  // Drives the open transition (fade + scale-in) on the first paint.
  const [isShown, setIsShown] = useState<boolean>(false);
  // Recently opened product routes, read once when the modal opens.
  const [recentRoutes] = useState<string[]>(() => {
    return readRecentRoutes();
  });
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const cellRefs: React.MutableRefObject<Array<HTMLDivElement | null>> = useRef<
    Array<HTMLDivElement | null>
  >([]);
  const groupRefs: React.MutableRefObject<Map<string, HTMLDivElement>> = useRef<
    Map<string, HTMLDivElement>
  >(new Map());
  /*
   * The group (by key) of a category just opened, to scroll into view once
   * its products are drawn.
   */
  const groupToReveal: React.MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(undefined);

  const folds: CategoryFolds = useCategoryFolds(
    props.items,
    props.categoriesOpenByDefault,
  );

  /*
   * Callers hand us plain English literals (or omit them and take the
   * defaults). Run every user-facing string through the same flat-key lookup
   * the rest of the nav uses, so a caller that has not been wired up to i18n
   * still renders localised text instead of English.
   */
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const recentLabel: string = tx(props.recentLabel || "Recent");
  const isSearching: boolean = query.trim().length > 0;

  // Keep familiar acronyms searchable even when the displayed title is translated.
  const filteredItems: MoreMenuItem[] = useMemo(() => {
    const normalizedQuery: string = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return props.items;
    }
    return props.items.filter((item: MoreMenuItem) => {
      return [item.title, item.description, ...(item.keywords || [])].some(
        (value: string) => {
          return value.toLowerCase().includes(normalizedQuery);
        },
      );
    });
  }, [props.items, query]);

  /*
   * The "Recent" row: resolve stored routes to current items, skip the page
   * we're already on, and cap the count. Only shown while idle (no query).
   */
  const recentItems: MoreMenuItem[] = useMemo(() => {
    if (recentRoutes.length === 0) {
      return [];
    }
    const itemByRoute: Map<string, MoreMenuItem> = new Map();
    props.items.forEach((item: MoreMenuItem) => {
      itemByRoute.set(item.route.toString(), item);
    });
    const resolved: MoreMenuItem[] = [];
    recentRoutes.forEach((route: string) => {
      const item: MoreMenuItem | undefined = itemByRoute.get(route);
      if (item && !isMoreMenuItemActive(item)) {
        resolved.push(item);
      }
    });
    return resolved.slice(0, RECENT_LIMIT);
  }, [recentRoutes, props.items]);

  // Group filtered items by category, preserving first-seen order.
  const categoryGroups: Array<MenuCategory> = useMemo(() => {
    return groupItemsByCategory(filteredItems);
  }, [filteredItems]);

  /*
   * Final render order: a "Recent" group (idle only) followed by the category
   * groups. Every row the keyboard cursor can stop on gets its index in that
   * order, so arrow keys, the cursor and the cell refs stay in step: the
   * heading row of a category that folds, then the products shown under it.
   *
   * A category folds only while idle. Search ignores folding: every match is
   * shown under a plain heading, and the cursor moves over products alone.
   */
  const rawGroups: Array<RawGroup> = [];
  if (!isSearching && recentItems.length > 0) {
    rawGroups.push({ title: recentLabel, items: recentItems, isRecent: true });
  }
  categoryGroups.forEach((category: MenuCategory) => {
    rawGroups.push({
      title: category.title,
      items: category.items,
      isRecent: false,
    });
  });

  const entries: Array<MenuEntry> = [];
  const groups: Array<MenuGroup> = rawGroups.map(
    (group: RawGroup): MenuGroup => {
      const canFold: boolean =
        folds.isEnabled && !isSearching && !group.isRecent;
      const isOpen: boolean = !canFold || folds.isOpen(group.title);
      let toggle: CategoryEntry | undefined = undefined;

      if (canFold) {
        toggle = {
          kind: "category",
          key: `category:${group.title}`,
          flatIndex: entries.length,
          category: group.title,
        };
        entries.push(toggle);
      }

      const shownEntries: Array<ItemEntry> = [];

      if (isOpen) {
        group.items.forEach((item: MoreMenuItem) => {
          const entry: ItemEntry = {
            kind: "item",
            key: `${group.isRecent ? "recent" : `item:${group.title}`}:${item.route.toString()}`,
            flatIndex: entries.length,
            item,
          };
          entries.push(entry);
          shownEntries.push(entry);
        });
      }

      return {
        key: group.isRecent ? "recent" : `category:${group.title}`,
        title: group.title,
        isRecent: group.isRecent,
        toggle,
        isOpen,
        items: group.items,
        shownEntries,
      };
    },
  );

  // Index of the product matching the current page (the "you are here" item).
  const currentFlatIndex: number = entries.findIndex(
    (entry: MenuEntry): boolean => {
      return entry.kind === "item" && isMoreMenuItemActive(entry.item);
    },
  );

  /*
   * Where the cursor is. When idle the menu opens "where you are", on the
   * current page's product; while searching, on the first result. Either
   * way it starts on a product, never on a category's heading row.
   */
  const activeIndex: number = ((): number => {
    if (activeKey !== undefined) {
      const index: number = entries.findIndex((entry: MenuEntry): boolean => {
        return entry.key === activeKey;
      });
      if (index >= 0) {
        return index;
      }
    }
    if (!isSearching && currentFlatIndex >= 0) {
      return currentFlatIndex;
    }
    const firstProductIndex: number = entries.findIndex(
      (entry: MenuEntry): boolean => {
        return entry.kind === "item";
      },
    );
    return firstProductIndex >= 0 ? firstProductIndex : 0;
  })();

  const activeEntry: MenuEntry | undefined = entries[activeIndex];

  // Play the open animation and focus the search box on mount.
  useEffect(() => {
    setIsShown(true);
    inputRef.current?.focus();
  }, []);

  // Keep the active cell scrolled into view as the selection moves.
  useEffect(() => {
    cellRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /*
   * A category opened at the bottom of the list would grow below the fold,
   * and look as if nothing happened: bring its products into view.
   */
  useEffect(() => {
    const groupKey: string | undefined = groupToReveal.current;
    if (groupKey === undefined) {
      return;
    }
    groupToReveal.current = undefined;
    const group: HTMLDivElement | undefined = groupRefs.current.get(groupKey);
    if (group && typeof group.scrollIntoView === "function") {
      group.scrollIntoView({ block: "nearest" });
    }
  });

  const updateQuery: (value: string) => void = (value: string): void => {
    setQuery(value);
    // A new query puts the cursor back on its first result.
    setActiveKey(undefined);
  };

  // Record a selection and close the modal.
  const selectItem: (item: MoreMenuItem) => void = (
    item: MoreMenuItem,
  ): void => {
    writeRecentRoute(item.route.toString());
    props.onClose();
  };

  // Open a folded category or fold an open one, keeping the cursor on it.
  const toggleCategory: (entry: CategoryEntry) => void = (
    entry: CategoryEntry,
  ): void => {
    if (!folds.isOpen(entry.category)) {
      // A category's heading row and its group share the key.
      groupToReveal.current = entry.key;
    }
    folds.toggle(entry.category);
    setActiveKey(entry.key);
  };

  // Wrap the portions of text that match the query in a highlight.
  const highlightMatch: (text: string) => ReactNode = (
    text: string,
  ): ReactNode => {
    const needle: string = query.trim().toLowerCase();
    if (!needle) {
      return text;
    }
    const haystack: string = text.toLowerCase();
    const parts: ReactNode[] = [];
    let cursor: number = 0;
    let matchAt: number = haystack.indexOf(needle, cursor);
    let key: number = 0;
    while (matchAt !== -1) {
      if (matchAt > cursor) {
        parts.push(text.slice(cursor, matchAt));
      }
      parts.push(
        <mark
          key={`m-${key}`}
          className="rounded-sm bg-yellow-100 px-0.5 text-inherit"
        >
          {text.slice(matchAt, matchAt + needle.length)}
        </mark>,
      );
      key++;
      cursor = matchAt + needle.length;
      matchAt = haystack.indexOf(needle, cursor);
    }
    if (cursor < text.length) {
      parts.push(text.slice(cursor));
    }
    return parts;
  };

  const moveTo: (index: number) => void = (index: number): void => {
    const entry: MenuEntry | undefined = entries[index];
    if (entry) {
      setActiveKey(entry.key);
    }
  };

  /*
   * Up and Down move to the nearest row above or below, by where the rows
   * are drawn: a category's heading row is one row across the whole menu,
   * and the products under it are a grid of cards.
   */
  const moveVertical: (direction: "up" | "down") => void = (
    direction: "up" | "down",
  ): void => {
    const cells: Array<HTMLDivElement | null> = cellRefs.current;
    const active: HTMLDivElement | null = cells[activeIndex] || null;
    if (!active) {
      return;
    }
    const activeRect: DOMRect = active.getBoundingClientRect();
    const activeCenterX: number = activeRect.left + activeRect.width / 2;

    // Find the nearest row in the requested direction.
    let targetTop: number | null = null;
    for (let i: number = 0; i < entries.length; i++) {
      const cell: HTMLDivElement | null = cells[i] || null;
      if (!cell) {
        continue;
      }
      const top: number = cell.getBoundingClientRect().top;
      if (direction === "down" && top > activeRect.top + 1) {
        if (targetTop === null || top < targetTop) {
          targetTop = top;
        }
      }
      if (direction === "up" && top < activeRect.top - 1) {
        if (targetTop === null || top > targetTop) {
          targetTop = top;
        }
      }
    }
    if (targetTop === null) {
      return;
    }

    /*
     * Within that row, pick the cell whose horizontal center is closest. A
     * heading row spans the whole menu, so from a heading the first product
     * of the row is the one to land on, as when reading.
     */
    const isFromHeading: boolean = activeEntry?.kind === "category";
    let bestIndex: number = activeIndex;
    let bestDistance: number = Number.POSITIVE_INFINITY;
    for (let i: number = 0; i < entries.length; i++) {
      const cell: HTMLDivElement | null = cells[i] || null;
      if (!cell) {
        continue;
      }
      const rect: DOMRect = cell.getBoundingClientRect();
      if (Math.abs(rect.top - targetTop) <= 1) {
        if (isFromHeading) {
          bestIndex = i;
          break;
        }
        const centerX: number = rect.left + rect.width / 2;
        const distance: number = Math.abs(centerX - activeCenterX);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
    }
    moveTo(bestIndex);
  };

  const handleKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (entries.length === 0) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(Math.min(activeIndex + 1, entries.length - 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(Math.max(activeIndex - 1, 0));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveVertical("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveVertical("up");
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!activeEntry) {
        return;
      }
      if (activeEntry.kind === "category") {
        // Enter on a category's row opens it (or folds it again).
        toggleCategory(activeEntry);
        return;
      }
      selectItem(activeEntry.item);
      Navigation.navigate(activeEntry.item.route);
    }
  };

  return (
    <div
      className="relative z-50"
      role="dialog"
      aria-modal="true"
      aria-label={tx("Products menu")}
    >
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity duration-200 ${
          isShown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Scroll + click-away container */}
      <div
        className="fixed inset-0 z-50 overflow-y-auto"
        onClick={props.onClose}
      >
        <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
          <div
            className={`relative mt-[6vh] flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-900/5 transition-all duration-200 ease-out ${
              isShown
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-2 scale-[0.98] opacity-0"
            }`}
            style={{ maxHeight: "80vh" }}
            onClick={(event: React.MouseEvent<HTMLDivElement>) => {
              event.stopPropagation();
            }}
          >
            {/* Search header */}
            <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
              <Icon
                icon={IconProp.Search}
                className="h-5 w-5 flex-shrink-0 text-gray-400"
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={true}
                aria-controls="navbar-menu-listbox"
                aria-activedescendant={
                  activeEntry ? entryElementId(activeEntry) : undefined
                }
                aria-label={tx(props.searchPlaceholder || "Search products")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={query}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  updateQuery(event.target.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder={tx(props.searchPlaceholder || "Search…")}
                className="flex-1 border-0 bg-transparent p-0 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
              />
              {query ? (
                <button
                  type="button"
                  aria-label={tx("Clear search")}
                  onClick={() => {
                    updateQuery("");
                    inputRef.current?.focus();
                  }}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <Icon icon={IconProp.Close} className="h-4 w-4" />
                </button>
              ) : props.showCommandKShortcutHint !== false ? (
                /* OS-appropriate hint: ⌘ K on a Mac, Ctrl K elsewhere. */
                <KeyboardShortcut
                  keys={[KeyboardKey.Mod, "K"]}
                  size={KeyboardShortcutSize.Small}
                  className="max-sm:hidden sm:inline-flex"
                />
              ) : null}
            </div>

            {/* Body */}
            <div
              id="navbar-menu-listbox"
              role="listbox"
              aria-label={tx("Products")}
              className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4"
            >
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50 ring-1 ring-gray-100">
                    <Icon
                      icon={IconProp.Search}
                      className="h-5 w-5 text-gray-400"
                    />
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {tx(props.noResultsText || "No results found.")}
                  </p>
                  {query && (
                    <p className="mt-1 text-xs text-gray-500">
                      &ldquo;{query}&rdquo;
                    </p>
                  )}
                </div>
              ) : (
                groups.map((group: MenuGroup, groupIndex: number) => {
                  const headingId: string = `navbar-menu-heading-${groupIndex}`;
                  const bodyId: string = `navbar-menu-group-${groupIndex}`;
                  const title: string =
                    group.title === UNCATEGORIZED_TITLE && !group.isRecent
                      ? tx(UNCATEGORIZED_TITLE)
                      : group.title;
                  const isFolded: boolean =
                    Boolean(group.toggle) && !group.isOpen;
                  const toggle: CategoryEntry | undefined = group.toggle;

                  return (
                    <div
                      key={group.key}
                      role="group"
                      aria-labelledby={headingId}
                      ref={(element: HTMLDivElement | null) => {
                        if (element) {
                          groupRefs.current.set(group.key, element);
                        } else {
                          groupRefs.current.delete(group.key);
                        }
                      }}
                      className={isFolded ? "mb-1" : "mb-6 last:mb-1"}
                    >
                      {toggle ? (
                        <NavBarCategoryToggle
                          title={title}
                          itemTitles={group.items.map(
                            (item: MoreMenuItem): string => {
                              return item.title;
                            },
                          )}
                          isOpen={group.isOpen}
                          onToggle={() => {
                            toggleCategory(toggle);
                          }}
                          controlsId={bodyId}
                          headingId={headingId}
                          id={entryElementId(toggle)}
                          isActive={toggle.flatIndex === activeIndex}
                          rowRef={(element: HTMLDivElement | null) => {
                            cellRefs.current[toggle.flatIndex] = element;
                          }}
                          onMouseMove={() => {
                            setActiveKey(toggle.key);
                          }}
                          keepsFocusOnClick={true}
                        />
                      ) : (
                        /*
                         * In a menu that folds, a plain heading (Recent, or a
                         * category while searching) lines its text up with
                         * the heading rows around it.
                         */
                        <div
                          className={`mb-2.5 flex items-center gap-1.5 ${
                            folds.isEnabled
                              ? "border border-transparent px-2"
                              : "px-1"
                          }`}
                        >
                          {group.isRecent && (
                            <Icon
                              icon={IconProp.Clock}
                              className="h-3.5 w-3.5 text-gray-500"
                            />
                          )}
                          <h3
                            id={headingId}
                            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500"
                          >
                            {title}
                          </h3>
                        </div>
                      )}
                      {group.shownEntries.length > 0 && (
                        <div
                          id={bodyId}
                          className={`grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 ${
                            toggle ? "mt-2" : ""
                          }`}
                        >
                          {group.shownEntries.map((entry: ItemEntry) => {
                            const item: MoreMenuItem = entry.item;
                            const flatIndex: number = entry.flatIndex;
                            const isActive: boolean = flatIndex === activeIndex;
                            const isCurrent: boolean =
                              flatIndex === currentFlatIndex;
                            const colors: IconColorClasses =
                              ICON_COLOR_CLASSES[item.iconColor || "indigo"] ||
                              ICON_COLOR_CLASSES["indigo"]!;
                            return (
                              <div
                                key={entry.key}
                                id={entryElementId(entry)}
                                role="option"
                                aria-selected={isActive}
                                ref={(element: HTMLDivElement | null) => {
                                  cellRefs.current[flatIndex] = element;
                                }}
                                onMouseMove={() => {
                                  setActiveKey(entry.key);
                                }}
                              >
                                <Link
                                  to={item.route}
                                  onClick={() => {
                                    selectItem(item);
                                  }}
                                  className={`group flex h-full items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${
                                    isActive
                                      ? "border-indigo-300 bg-indigo-50 shadow-sm"
                                      : isCurrent
                                        ? "border-indigo-100 bg-indigo-50/40"
                                        : "border-transparent"
                                  }`}
                                >
                                  <div
                                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${colors.bg} ring-1 ${colors.ring}`}
                                  >
                                    <Icon
                                      icon={item.icon}
                                      className={`h-5 w-5 transition-transform duration-150 group-hover:scale-110 ${colors.text}`}
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                                      <span className="truncate">
                                        {highlightMatch(item.title)}
                                      </span>
                                      {isCurrent && (
                                        <span
                                          aria-hidden="true"
                                          className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500"
                                        />
                                      )}
                                    </p>
                                    <p className="mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-2">
                                      {highlightMatch(item.description)}
                                    </p>
                                  </div>
                                </Link>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {props.footer && (
              <div className="flex items-center justify-between gap-4 border-t border-gray-100 bg-gray-50/80 px-5 py-3">
                <Link
                  to={props.footer.link}
                  openInNewTab={true}
                  className="group flex min-w-0 items-center gap-3"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900 transition-colors group-hover:bg-gray-700">
                    <Icon
                      icon={IconProp.GitHub}
                      className="h-4 w-4 text-white"
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="flex items-center gap-1 text-sm font-medium text-gray-900">
                      <span className="truncate">{tx(props.footer.title)}</span>
                      <Icon
                        icon={IconProp.ExternalLink}
                        className="h-3 w-3 flex-shrink-0 text-gray-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {tx(props.footer.description)}
                    </p>
                  </div>
                </Link>
                {props.keyboardHint && (
                  <div
                    aria-label={tx(props.keyboardHint)}
                    className="max-md:hidden flex-shrink-0 items-center gap-2 text-xs text-gray-400 md:flex"
                  >
                    <KeyboardShortcut
                      keys={[KeyboardKey.ArrowUp, KeyboardKey.ArrowDown]}
                    />
                    <KeyboardShortcut keys={[KeyboardKey.Enter]} />
                    <KeyboardShortcut keys={[KeyboardKey.Escape]} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NavBarMenuModal;
