import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import Navigation from "../../Utils/Navigation";
import IconProp from "../../../Types/Icon/IconProp";
import URL from "../../../Types/API/URL";
import type { MoreMenuItem } from "./NavBar";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface IconColorClasses {
  bg: string;
  ring: string;
}

/*
 * Icon color map carried over from the former NavBarMenuItem, extended with the
 * few colors the dashboard items use (yellow/red/teal) so every product renders
 * with its intended color. Unknown colors fall back to indigo.
 */
const ICON_COLOR_CLASSES: Record<string, IconColorClasses> = {
  purple: { bg: "bg-purple-50", ring: "ring-purple-200" },
  blue: { bg: "bg-blue-50", ring: "ring-blue-200" },
  gray: { bg: "bg-gray-100", ring: "ring-gray-300" },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200" },
  green: { bg: "bg-green-50", ring: "ring-green-200" },
  cyan: { bg: "bg-cyan-50", ring: "ring-cyan-200" },
  slate: { bg: "bg-slate-100", ring: "ring-slate-300" },
  indigo: { bg: "bg-indigo-50", ring: "ring-indigo-200" },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200" },
  violet: { bg: "bg-violet-50", ring: "ring-violet-200" },
  orange: { bg: "bg-orange-50", ring: "ring-orange-200" },
  stone: { bg: "bg-stone-100", ring: "ring-stone-300" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200" },
  emerald: { bg: "bg-emerald-50", ring: "ring-emerald-200" },
  yellow: { bg: "bg-yellow-50", ring: "ring-yellow-200" },
  red: { bg: "bg-red-50", ring: "ring-red-200" },
  teal: { bg: "bg-teal-50", ring: "ring-teal-200" },
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

const NavBarMenuModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const cellRefs: React.MutableRefObject<Array<HTMLDivElement | null>> = useRef<
    Array<HTMLDivElement | null>
  >([]);

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
   * Group filtered items by category (preserving first-seen order) and stamp
   * each item with its index in the flattened, grouped render order.
   */
  const groups: MenuGroup[] = useMemo(() => {
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

    let flatIndex: number = 0;
    return order.map((category: string) => {
      const indexed: IndexedItem[] = byCategory
        .get(category)!
        .map((item: MoreMenuItem) => {
          const entry: IndexedItem = { item, flatIndex };
          flatIndex++;
          return entry;
        });
      return { category, items: indexed };
    });
  }, [filteredItems]);

  // Flattened list in render order — used for keyboard navigation.
  const flatItems: MoreMenuItem[] = useMemo(() => {
    return groups.reduce((acc: MoreMenuItem[], group: MenuGroup) => {
      group.items.forEach((entry: IndexedItem) => {
        acc.push(entry.item);
      });
      return acc;
    }, []);
  }, [groups]);

  // Focus the search box when the modal mounts.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset the selection to the top whenever the query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active cell scrolled into view as the selection moves.
  useEffect(() => {
    cellRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /*
   * Move the selection one visual row up or down. Uses the rendered cell
   * positions so it works across category gaps and any column count.
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
        props.onClose();
        Navigation.navigate(item.route);
      }
    }
  };

  return (
    <div
      className="relative z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Products menu"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-gray-900 bg-opacity-50 backdrop-blur-sm transition-opacity" />

      {/* Scroll + click-away container */}
      <div
        className="fixed inset-0 z-50 overflow-y-auto"
        onClick={props.onClose}
      >
        <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
          <div
            className="relative mt-[6vh] flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black ring-opacity-5"
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
                value={query}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setQuery(event.target.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder={props.searchPlaceholder || "Search…"}
                className="flex-1 border-0 bg-transparent p-0 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
              />
              <kbd className="hidden items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs font-medium text-gray-400 sm:inline-flex">
                ⌘K
              </kbd>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {flatItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Icon
                    icon={IconProp.Search}
                    className="mb-3 h-8 w-8 text-gray-300"
                  />
                  <p className="text-sm text-gray-500">
                    {props.noResultsText || "No results found."}
                  </p>
                </div>
              ) : (
                groups.map((group: MenuGroup) => {
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
                          const colors: IconColorClasses =
                            ICON_COLOR_CLASSES[item.iconColor || "indigo"] ||
                            ICON_COLOR_CLASSES["indigo"]!;
                          return (
                            <div
                              key={item.title}
                              ref={(element: HTMLDivElement | null) => {
                                cellRefs.current[flatIndex] = element;
                              }}
                              onMouseEnter={() => {
                                setActiveIndex(flatIndex);
                              }}
                            >
                              <Link
                                to={item.route}
                                onClick={props.onClose}
                                className={`flex h-full flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors ${
                                  isActive
                                    ? "bg-gray-100 ring-2 ring-indigo-400"
                                    : "hover:bg-gray-50"
                                }`}
                              >
                                <div
                                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${colors.bg} ring-1 ${colors.ring}`}
                                >
                                  <Icon
                                    icon={item.icon}
                                    className="h-6 w-6 text-gray-700"
                                  />
                                </div>
                                <div className="w-full">
                                  <p className="text-sm font-medium text-gray-900">
                                    {item.title}
                                  </p>
                                  <p className="mt-0.5 text-xs leading-snug text-gray-500 line-clamp-2">
                                    {item.description}
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
                  <span className="hidden flex-shrink-0 text-xs text-gray-400 md:inline">
                    {props.keyboardHint}
                  </span>
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
