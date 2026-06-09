import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import Navigation from "../../Utils/Navigation";
import IconProp from "../../../Types/Icon/IconProp";
import URL from "../../../Types/API/URL";
import type { MoreMenuItem } from "./NavBar";
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
  footer?:
    | {
        title: string;
        description: string;
        link: URL;
      }
    | undefined;
  searchPlaceholder?: string | undefined;
  noResultsText?: string | undefined;
  keyboardHint?: string | undefined;
  recentLabel?: string | undefined;
  onClose: () => void;
}

interface IndexedItem {
  item: MoreMenuItem;
  flatIndex: number;
}

interface MenuGroup {
  category: string;
  items: IndexedItem[];
}

interface RawGroup {
  category: string;
  items: MoreMenuItem[];
}

const NavBarMenuModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);
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

  const recentLabel: string = props.recentLabel || "Recent";

  // Show the OS-appropriate shortcut hint (⌘K on macOS, Ctrl K elsewhere).
  const shortcutLabel: string = useMemo(() => {
    if (typeof navigator === "undefined") {
      return "⌘K";
    }
    const platform: string = (
      navigator.platform ||
      navigator.userAgent ||
      ""
    ).toLowerCase();
    const isApplePlatform: boolean =
      platform.includes("mac") ||
      platform.includes("iphone") ||
      platform.includes("ipad") ||
      platform.includes("ipod");
    return isApplePlatform ? "⌘K" : "Ctrl K";
  }, []);

  // Filter items by the search query (title + description + category).
  const filteredItems: MoreMenuItem[] = useMemo(() => {
    const normalizedQuery: string = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return props.items;
    }
    return props.items.filter((item: MoreMenuItem) => {
      const haystack: string = `${item.title} ${item.description} ${
        item.category || ""
      }`.toLowerCase();
      return haystack.includes(normalizedQuery);
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
      if (item && !Navigation.isStartWith(item.activeRoute || item.route)) {
        resolved.push(item);
      }
    });
    return resolved.slice(0, RECENT_LIMIT);
  }, [recentRoutes, props.items]);

  // Group filtered items by category, preserving first-seen order.
  const categoryGroups: RawGroup[] = useMemo(() => {
    const order: string[] = [];
    const byCategory: Map<string, MoreMenuItem[]> = new Map();
    filteredItems.forEach((item: MoreMenuItem) => {
      const category: string = item.category || "Other";
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        order.push(category);
      }
      byCategory.get(category)!.push(item);
    });
    return order.map((category: string) => {
      return { category, items: byCategory.get(category)! };
    });
  }, [filteredItems]);

  /*
   * Final render order: a "Recent" group (idle only) followed by the category
   * groups, with every item stamped with its index in the flattened order so
   * keyboard navigation and cell refs stay in sync.
   */
  const displayGroups: MenuGroup[] = useMemo(() => {
    const raw: RawGroup[] = [];
    if (!query.trim() && recentItems.length > 0) {
      raw.push({ category: recentLabel, items: recentItems });
    }
    raw.push(...categoryGroups);

    let flatIndex: number = 0;
    return raw.map((group: RawGroup) => {
      const items: IndexedItem[] = group.items.map((item: MoreMenuItem) => {
        const entry: IndexedItem = { item, flatIndex };
        flatIndex++;
        return entry;
      });
      return { category: group.category, items };
    });
  }, [query, recentItems, categoryGroups, recentLabel]);

  // Flattened list in render order — used for keyboard navigation.
  const flatItems: MoreMenuItem[] = useMemo(() => {
    return displayGroups.reduce((acc: MoreMenuItem[], group: MenuGroup) => {
      group.items.forEach((entry: IndexedItem) => {
        acc.push(entry.item);
      });
      return acc;
    }, []);
  }, [displayGroups]);

  // Index of the product matching the current page (the "you are here" item).
  const currentFlatIndex: number = useMemo(() => {
    return flatItems.findIndex((item: MoreMenuItem) => {
      return Navigation.isStartWith(item.activeRoute || item.route);
    });
  }, [flatItems]);

  // Play the open animation and focus the search box on mount.
  useEffect(() => {
    setIsShown(true);
    inputRef.current?.focus();
  }, []);

  /*
   * When idle, pre-select the current page so the modal opens "where you are";
   * while searching, snap the selection to the first result.
   */
  useEffect(() => {
    if (query) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex(currentFlatIndex >= 0 ? currentFlatIndex : 0);
  }, [query, currentFlatIndex]);

  // Keep the active cell scrolled into view as the selection moves.
  useEffect(() => {
    cellRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Record a selection and close the modal.
  const selectItem: (item: MoreMenuItem) => void = (
    item: MoreMenuItem,
  ): void => {
    writeRecentRoute(item.route.toString());
    props.onClose();
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
    for (let i: number = 0; i < flatItems.length; i++) {
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

    // Within that row, pick the cell whose horizontal center is closest.
    let bestIndex: number = activeIndex;
    let bestDistance: number = Number.POSITIVE_INFINITY;
    for (let i: number = 0; i < flatItems.length; i++) {
      const cell: HTMLDivElement | null = cells[i] || null;
      if (!cell) {
        continue;
      }
      const rect: DOMRect = cell.getBoundingClientRect();
      if (Math.abs(rect.top - targetTop) <= 1) {
        const centerX: number = rect.left + rect.width / 2;
        const distance: number = Math.abs(centerX - activeCenterX);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
    }
    setActiveIndex(bestIndex);
  };

  const handleKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (flatItems.length === 0) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((index: number) => {
        return Math.min(index + 1, flatItems.length - 1);
      });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((index: number) => {
        return Math.max(index - 1, 0);
      });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveVertical("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveVertical("up");
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item: MoreMenuItem | undefined = flatItems[activeIndex];
      if (item) {
        selectItem(item);
        Navigation.navigate(item.route);
      }
    }
  };

  const keycapClass: string =
    "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-gray-200 bg-white px-1 text-[11px] font-medium text-gray-500 shadow-sm";

  return (
    <div
      className="relative z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Products menu"
    >
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-gray-900 bg-opacity-50 backdrop-blur-sm transition-opacity duration-200 ${
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
            className={`relative mt-[6vh] flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black ring-opacity-5 transition-all duration-200 ease-out ${
              isShown ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
            style={{ maxHeight: "80vh" }}
            onClick={(event: React.MouseEvent<HTMLDivElement>) => {
              event.stopPropagation();
            }}
          >
            {/* Search header */}
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
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
                  flatItems.length > 0
                    ? `navbar-menu-option-${activeIndex}`
                    : undefined
                }
                aria-label={props.searchPlaceholder || "Search products"}
                value={query}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setQuery(event.target.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder={props.searchPlaceholder || "Search…"}
                className="flex-1 border-0 bg-transparent p-0 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
              />
              <kbd className="hidden items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs font-medium text-gray-400 sm:inline-flex">
                {shortcutLabel}
              </kbd>
            </div>

            {/* Body */}
            <div
              id="navbar-menu-listbox"
              role="listbox"
              aria-label="Products"
              className="flex-1 overflow-y-auto px-4 py-4"
            >
              {flatItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Icon
                    icon={IconProp.Search}
                    className="mb-3 h-8 w-8 text-gray-300"
                  />
                  <p className="text-sm text-gray-500">
                    {props.noResultsText || "No results found."}
                  </p>
                  {query && (
                    <p className="mt-1 text-xs text-gray-400">
                      &ldquo;{query}&rdquo;
                    </p>
                  )}
                </div>
              ) : (
                displayGroups.map((group: MenuGroup) => {
                  return (
                    <div key={group.category} className="mb-6 last:mb-1">
                      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {group.category}
                      </h3>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {group.items.map((entry: IndexedItem) => {
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
                              key={entry.flatIndex}
                              id={`navbar-menu-option-${flatIndex}`}
                              role="option"
                              aria-selected={isActive}
                              ref={(element: HTMLDivElement | null) => {
                                cellRefs.current[flatIndex] = element;
                              }}
                              onMouseEnter={() => {
                                setActiveIndex(flatIndex);
                              }}
                              className="relative"
                            >
                              {isCurrent && (
                                <span
                                  aria-hidden="true"
                                  className="absolute right-2 top-2 z-10 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white"
                                />
                              )}
                              <Link
                                to={item.route}
                                onClick={() => {
                                  selectItem(item);
                                }}
                                className={`flex h-full flex-col items-center gap-2 rounded-xl p-3 text-center transition-all duration-150 ${
                                  isActive
                                    ? "scale-[1.03] bg-indigo-50 shadow-sm ring-2 ring-indigo-400"
                                    : isCurrent
                                      ? "bg-indigo-50/60 ring-1 ring-indigo-200 hover:bg-indigo-50"
                                      : "hover:bg-gray-50"
                                }`}
                              >
                                <div
                                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${colors.bg} ring-1 ${colors.ring}`}
                                >
                                  <Icon
                                    icon={item.icon}
                                    className={`h-6 w-6 ${colors.text}`}
                                  />
                                </div>
                                <div className="w-full">
                                  <p className="text-sm font-medium text-gray-900">
                                    {highlightMatch(item.title)}
                                  </p>
                                  <p className="mt-0.5 text-xs leading-snug text-gray-500 line-clamp-2">
                                    {highlightMatch(item.description)}
                                  </p>
                                </div>
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {props.footer && (
              <div className="flex items-center justify-between gap-4 border-t border-gray-100 bg-gray-50 px-4 py-3">
                <Link
                  to={props.footer.link}
                  openInNewTab={true}
                  className="group flex min-w-0 items-center gap-3"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 ring-1 ring-gray-200 transition-all group-hover:bg-gray-200">
                    <Icon
                      icon={IconProp.GitHub}
                      className="h-4 w-4 text-gray-700"
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {props.footer.title}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {props.footer.description}
                    </p>
                  </div>
                </Link>
                {props.keyboardHint && (
                  <div
                    aria-label={props.keyboardHint}
                    className="hidden flex-shrink-0 items-center gap-2 text-xs text-gray-400 md:flex"
                  >
                    <span className="flex items-center gap-1">
                      <kbd className={keycapClass}>↑</kbd>
                      <kbd className={keycapClass}>↓</kbd>
                    </span>
                    <kbd className={keycapClass}>↵</kbd>
                    <kbd className={keycapClass}>esc</kbd>
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
