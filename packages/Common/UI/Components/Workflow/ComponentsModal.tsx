/*
 * The Add Component and Add Trigger picker.
 *
 * About two thousand steps can be added to a workflow, and all but some
 * twenty of them are the eight actions and three triggers generated for each
 * database model. This panel used to list every one of them, a card each,
 * grouped by model in registration order, and re-rendered the lot on every
 * keystroke; it took seconds to open on a slow machine, froze while typing,
 * and drew a search's results model by model in that same order, so
 * "incident" showed Incident State above Incident.
 *
 * Now it leads with what people use and asks one small question at a time:
 *
 *   - Popular: the handful of steps most workflows are built from.
 *   - More: the rest of the hand-written steps.
 *   - OneUptime resources: pick Incident, then what to do with it. The
 *     common resources are shown; every other one is behind "Browse all".
 *
 * Search covers everything (ComponentPicker/ComponentSearch.ts): every word
 * counts, the resource named comes first, plurals and typos are forgiven,
 * and only the best results are drawn. It runs on a deferred copy of what
 * was typed, so typing never waits for the list.
 *
 * Picking is one click (or Enter): the panel exists to choose a step, so
 * there is no second "Add to Workflow" button to find at the bottom.
 */
import KeyboardShortcut, {
  KeyboardKey,
  KeyboardShortcutSize,
} from "../KeyboardShortcut/KeyboardShortcut";
import Icon from "../Icon/Icon";
import SideOver from "../SideOver/SideOver";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../Types/Workflow/Component";
import {
  ComponentSearchOutcome,
  ComponentSearchResult,
  getComponentSearchIndex,
  getHighlightSegments,
  getSearchTokens,
  searchComponents,
} from "./ComponentPicker/ComponentSearch";
import {
  PickerBuiltInGroup,
  PickerCatalog,
  PickerResource,
  getPickerCatalog,
} from "./ComponentPicker/PickerCatalog";
import {
  ALL_RESOURCES_ITEM_KEY,
  BackButton,
  ComponentTile,
  HighlightedText,
  IconBox,
  PICKER_ITEM_ATTRIBUTE,
  ResourceRow,
  ResourceTile,
  SectionHeading,
  getPickerItemProps,
  resourceItemKey,
} from "./ComponentPicker/PickerItems";
import { translatableTerm, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import React, {
  FunctionComponent,
  ReactElement,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  componentsType: ComponentType;
  onCloseModal: () => void;
  // Called once, with the step that was picked.
  onComponentClick: (componentMetadata: ComponentMetadata) => void;
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
}

// How many search results are drawn at first, and added by "Show more".
export const SEARCH_RESULTS_PAGE_SIZE: number = 50;

export const SEARCH_INPUT_ID: string = "workflow-component-search";
export const SEARCH_RESULTS_ID: string = "workflow-component-results";

export type SearchOptionIdFunction = (index: number) => string;

export const getSearchOptionId: SearchOptionIdFunction = (
  index: number,
): string => {
  return `workflow-component-option-${index}`;
};

export enum PickerViewKind {
  Home = "Home",
  AllResources = "AllResources",
  Resource = "Resource",
}

interface PickerView {
  kind: PickerViewKind;
  resourceKey?: string | undefined;
}

interface ViewEntry {
  view: PickerView;
  // What had the focus, and how far the panel was scrolled, when it was left.
  returnFocusKey: string | null;
  scrollTop: number;
}

type PendingFocus =
  | { kind: "first-item" }
  | { kind: "restore"; key: string | null; scrollTop: number }
  | { kind: "search" };

const EMPTY_OUTCOME: ComponentSearchOutcome = {
  tokens: [],
  typoTokens: [],
  results: [],
};

const HOME_ENTRY: ViewEntry = {
  view: { kind: PickerViewKind.Home },
  returnFocusKey: null,
  scrollTop: 0,
};

type IsTypingTargetFunction = (target: EventTarget | null) => boolean;

const isTypingTarget: IsTypingTargetFunction = (
  target: EventTarget | null,
): boolean => {
  const element: HTMLElement | null = target as HTMLElement | null;

  return Boolean(
    element &&
      (element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.isContentEditable ||
        element.getAttribute?.("contenteditable") === "true"),
  );
};

type PrefersTouchFunction = () => boolean;

/*
 * On a phone, focusing the search box on open throws the keyboard over half
 * of what the panel offers. There the panel opens for browsing; a tap on the
 * box searches.
 */
const prefersTouch: PrefersTouchFunction = (): boolean => {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches,
    );
  } catch {
    return false;
  }
};

const ComponentsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Every sentence below comes in a trigger and a component version, so a
   * locale words each one whole rather than slotting the noun in.
   */
  const isTrigger: boolean = props.componentsType === ComponentType.Trigger;

  const catalog: PickerCatalog = useMemo(() => {
    return getPickerCatalog({
      components: props.components,
      categories: props.categories,
      componentsType: props.componentsType,
    });
  }, [props.components, props.categories, props.componentsType]);

  const [query, setQuery] = useState<string>("");
  // What was typed, a render behind while the list catches up.
  const deferredQuery: string = useDeferredValue(query);

  const outcome: ComponentSearchOutcome = useMemo(() => {
    if (getSearchTokens(deferredQuery).length === 0) {
      return EMPTY_OUTCOME;
    }

    return searchComponents(getComponentSearchIndex(catalog), deferredQuery);
  }, [catalog, deferredQuery]);

  const isSearching: boolean = outcome.tokens.length > 0;
  // The list is a render behind what was typed, for a moment.
  const isCatchingUp: boolean = query !== deferredQuery;

  // How many results are drawn, and which one Enter adds, for this search.
  const [shown, setShown] = useState<{ query: string; count: number }>({
    query: "",
    count: SEARCH_RESULTS_PAGE_SIZE,
  });
  const shownCount: number =
    shown.query === deferredQuery ? shown.count : SEARCH_RESULTS_PAGE_SIZE;
  const visibleResults: Array<ComponentSearchResult> = outcome.results.slice(
    0,
    shownCount,
  );

  const [active, setActive] = useState<{ query: string; index: number }>({
    query: "",
    index: 0,
  });
  const activeIndex: number =
    active.query === deferredQuery
      ? Math.min(active.index, Math.max(visibleResults.length - 1, 0))
      : 0;
  // Only keyboard moves scroll the list; a pointer resting on it must not.
  const scrollActiveIntoViewRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const [viewStack, setViewStack] = useState<Array<ViewEntry>>([HOME_ENTRY]);
  const currentEntry: ViewEntry = viewStack[viewStack.length - 1] || HOME_ENTRY;
  const pendingFocusRef: React.MutableRefObject<PendingFocus | null> =
    useRef<PendingFocus | null>(null);

  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  type GetScrollContainerFunction = () => HTMLElement | null;

  // The SideOver's scrolling body, which the sticky search box sits in.
  const getScrollContainer: GetScrollContainerFunction =
    (): HTMLElement | null => {
      return (
        (rootRef.current?.closest(
          "[data-testid='side-over-content']",
        ) as HTMLElement | null) || null
      );
    };

  const openedResource: PickerResource | undefined =
    currentEntry.view.kind === PickerViewKind.Resource &&
    currentEntry.view.resourceKey
      ? catalog.resourcesByKey.get(currentEntry.view.resourceKey)
      : undefined;

  // A resource that is no longer in the catalog cannot stay open.
  const view: PickerViewKind =
    currentEntry.view.kind === PickerViewKind.Resource && !openedResource
      ? PickerViewKind.Home
      : currentEntry.view.kind;

  useEffect(() => {
    if (!prefersTouch()) {
      searchInputRef.current?.focus();
    }
  }, []);

  /*
   * Index the catalog while the panel sits idle, so the first key typed does
   * not wait for it. It is kept per catalog, so this happens once a page.
   */
  useEffect(() => {
    let isCancelled: boolean = false;

    const build: () => void = (): void => {
      if (!isCancelled) {
        getComponentSearchIndex(catalog);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle: number = window.requestIdleCallback(build, {
        timeout: 1500,
      });

      return () => {
        isCancelled = true;
        window.cancelIdleCallback?.(handle);
      };
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(build, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [catalog]);

  // "/" jumps to the search box from anywhere in the panel.
  useEffect(() => {
    const handleKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // A new search starts at the top of the panel.
  useEffect(() => {
    if (isSearching) {
      const container: HTMLElement | null = getScrollContainer();

      if (container) {
        container.scrollTop = 0;
      }
    }
  }, [deferredQuery]);

  // Keep the option Enter would add in sight while the arrows move it.
  useEffect(() => {
    if (!scrollActiveIntoViewRef.current) {
      return;
    }

    scrollActiveIntoViewRef.current = false;
    const option: HTMLElement | null = document.getElementById(
      getSearchOptionId(activeIndex),
    );
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // Focus and scroll for a view that was just opened or returned to.
  useEffect(() => {
    const pending: PendingFocus | null = pendingFocusRef.current;
    pendingFocusRef.current = null;

    if (!pending) {
      return;
    }

    const container: HTMLElement | null = getScrollContainer();

    if (pending.kind === "search") {
      searchInputRef.current?.focus();
      return;
    }

    if (pending.kind === "first-item") {
      if (container) {
        container.scrollTop = 0;
      }

      rootRef.current
        ?.querySelector<HTMLElement>(`[${PICKER_ITEM_ATTRIBUTE}]`)
        ?.focus({ preventScroll: true });
      return;
    }

    if (container) {
      container.scrollTop = pending.scrollTop;
    }

    const returnTo: HTMLElement | undefined = pending.key
      ? Array.from(
          rootRef.current?.querySelectorAll<HTMLElement>(
            `[${PICKER_ITEM_ATTRIBUTE}]`,
          ) || [],
        ).find((element: HTMLElement): boolean => {
          return element.getAttribute(PICKER_ITEM_ATTRIBUTE) === pending.key;
        })
      : undefined;

    (returnTo || searchInputRef.current)?.focus({ preventScroll: true });
  }, [viewStack]);

  type OpenViewFunction = (view: PickerView, fromKey: string) => void;

  const openView: OpenViewFunction = (
    nextView: PickerView,
    fromKey: string,
  ): void => {
    const scrollTop: number = getScrollContainer()?.scrollTop || 0;

    pendingFocusRef.current = { kind: "first-item" };
    setViewStack((stack: Array<ViewEntry>): Array<ViewEntry> => {
      const top: ViewEntry = stack[stack.length - 1] || HOME_ENTRY;

      return [
        ...stack.slice(0, -1),
        { ...top, returnFocusKey: fromKey, scrollTop: scrollTop },
        { view: nextView, returnFocusKey: null, scrollTop: 0 },
      ];
    });
  };

  type GoBackFunction = (focusSearch: boolean) => void;

  const goBack: GoBackFunction = (focusSearch: boolean): void => {
    if (viewStack.length <= 1) {
      return;
    }

    const previous: ViewEntry = viewStack[viewStack.length - 2] || HOME_ENTRY;

    pendingFocusRef.current = focusSearch
      ? { kind: "search" }
      : {
          kind: "restore",
          key: previous.returnFocusKey,
          scrollTop: previous.scrollTop,
        };
    setViewStack((stack: Array<ViewEntry>): Array<ViewEntry> => {
      return stack.length > 1 ? stack.slice(0, -1) : stack;
    });
  };

  type OpenResourceFunction = (resource: PickerResource) => void;

  const openResource: OpenResourceFunction = (
    resource: PickerResource,
  ): void => {
    openView(
      { kind: PickerViewKind.Resource, resourceKey: resource.key },
      resourceItemKey(resource),
    );
  };

  type PickFunction = (componentMetadata: ComponentMetadata) => void;

  const pick: PickFunction = (componentMetadata: ComponentMetadata): void => {
    props.onComponentClick(componentMetadata);
  };

  type ClearSearchFunction = () => void;

  const clearSearch: ClearSearchFunction = (): void => {
    setQuery("");
    searchInputRef.current?.focus();
  };

  type MoveActiveFunction = (delta: number) => void;

  const moveActive: MoveActiveFunction = (delta: number): void => {
    if (visibleResults.length === 0) {
      return;
    }

    scrollActiveIntoViewRef.current = true;
    setActive({
      query: deferredQuery,
      index: Math.min(
        Math.max(activeIndex + delta, 0),
        visibleResults.length - 1,
      ),
    });
  };

  type OnSearchKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void;

  const onSearchKeyDown: OnSearchKeyDownFunction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Escape") {
      if (query.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
      } else if (viewStack.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        goBack(true);
      }

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (isSearching) {
        moveActive(1);
      } else {
        rootRef.current
          ?.querySelector<HTMLElement>(`[${PICKER_ITEM_ATTRIBUTE}]`)
          ?.focus();
      }

      return;
    }

    if (event.key === "ArrowUp") {
      if (isSearching) {
        event.preventDefault();
        moveActive(-1);
      }

      return;
    }

    if (event.key === "Enter") {
      if (getSearchTokens(query).length === 0) {
        return;
      }

      event.preventDefault();

      /*
       * Typed and entered faster than the list caught up: add the best match
       * for what is in the box, not for what the list still shows.
       */
      const result: ComponentSearchResult | undefined =
        query === deferredQuery
          ? visibleResults[activeIndex]
          : searchComponents(getComponentSearchIndex(catalog), query)
              .results[0];

      if (result) {
        pick(result.component);
      }
    }
  };

  type OnBrowseKeyDownFunction = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;

  /*
   * Arrow keys move between the entries of a browse view, the first one up
   * goes back to the search box, Escape goes back a view, and typing a
   * letter on an entry starts a search with it.
   */
  const onBrowseKeyDown: OnBrowseKeyDownFunction = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.defaultPrevented) {
      return;
    }

    const items: Array<HTMLElement> = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        `[${PICKER_ITEM_ATTRIBUTE}]`,
      ),
    );
    const position: number = items.indexOf(event.target as HTMLElement);

    if (event.key === "Escape" && viewStack.length > 1) {
      event.preventDefault();
      event.stopPropagation();
      goBack(false);
      return;
    }

    if (position === -1) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      items[Math.min(position + 1, items.length - 1)]?.focus();
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();

      if (position === 0) {
        searchInputRef.current?.focus();
      } else {
        items[position - 1]?.focus();
      }

      return;
    }

    if (
      event.key.length === 1 &&
      event.key !== " " &&
      event.key !== "/" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      setQuery((current: string): string => {
        return current + event.key;
      });
      searchInputRef.current?.focus();
    }
  };

  const searchHasMore: boolean = outcome.results.length > visibleResults.length;

  let statusText: string = "";

  if (isSearching) {
    if (outcome.results.length === 0) {
      statusText =
        translator.translateText(
          isTrigger ? "No triggers match." : "No components match.",
        ) || "";
    } else if (searchHasMore) {
      statusText = translator.translateTemplate(
        "Best {{shown}} of {{total}} matches.",
        {
          shown: translator.formatNumber(visibleResults.length),
          total: translator.formatNumber(outcome.results.length),
        },
      );
    } else {
      statusText = translator.translatePlural(
        { one: "{{count}} match.", other: "{{count}} matches." },
        outcome.results.length,
      );
    }
  }

  const renderSearchResults: () => ReactElement = (): ReactElement => {
    if (outcome.results.length === 0) {
      return (
        <div className="px-4 py-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.Search} className="h-5 w-5 text-gray-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-900">
            {translator.translateTemplate(
              isTrigger
                ? "No triggers match “{{search}}”"
                : "No components match “{{search}}”",
              { search: deferredQuery.trim() },
            )}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            {translator.translateText(
              props.componentsType === ComponentType.Trigger
                ? "Check the spelling, or try fewer or different words. To start this workflow from another tool, use the Webhook trigger."
                : "Check the spelling, or try fewer or different words. For anything that is not here, the API components and Run Custom JavaScript can work with any service.",
            )}
          </p>
          <button
            type="button"
            onClick={clearSearch}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            {translator.translateText("Clear search")}
          </button>
        </div>
      );
    }

    return (
      <>
        <ul
          id={SEARCH_RESULTS_ID}
          role="listbox"
          aria-label={translator.translateText(
            isTrigger ? "Matching triggers" : "Matching components",
          )}
          className="space-y-0.5"
        >
          {visibleResults.map(
            (result: ComponentSearchResult, index: number): ReactElement => {
              const componentMetadata: ComponentMetadata = result.component;
              const isActive: boolean = index === activeIndex;
              const resource: PickerResource | undefined =
                componentMetadata.tableName
                  ? catalog.resourcesByKey.get(componentMetadata.tableName)
                  : undefined;
              const optionId: string = getSearchOptionId(index);
              const label: string = resource
                ? resource.disambiguation || resource.name
                : componentMetadata.category;

              return (
                <li
                  key={componentMetadata.id}
                  id={optionId}
                  role="option"
                  aria-selected={isActive}
                  /*
                   * Named by the plain title: the marks drawn over the
                   * matched words must never change what is read out.
                   */
                  aria-label={componentMetadata.title}
                  aria-describedby={`${optionId}-description`}
                  data-component-id={componentMetadata.id}
                  onMouseMove={() => {
                    if (!isActive) {
                      setActive({ query: deferredQuery, index: index });
                    }
                  }}
                  onClick={() => {
                    pick(componentMetadata);
                  }}
                  className={`flex scroll-mt-28 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-100 ${
                    isActive ? "bg-indigo-50" : ""
                  }`}
                >
                  <IconBox icon={componentMetadata.iconProp} size="small" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-900">
                      <HighlightedText
                        segments={getHighlightSegments(
                          componentMetadata.title,
                          outcome.tokens,
                          outcome.typoTokens,
                        )}
                      />
                    </div>
                    <div
                      id={`${optionId}-description`}
                      className="truncate text-xs text-gray-500"
                    >
                      {translator.translateText(componentMetadata.description)}
                    </div>
                  </div>
                  <span className="max-sm:hidden max-w-[40%] flex-shrink-0 truncate rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 sm:inline-block">
                    {label}
                  </span>
                </li>
              );
            },
          )}
        </ul>
        {searchHasMore && (
          <button
            type="button"
            onClick={() => {
              setShown({
                query: deferredQuery,
                count: shownCount + SEARCH_RESULTS_PAGE_SIZE,
              });
            }}
            className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {translator.translatePlural(
              { one: "Show {{count}} more", other: "Show {{count}} more" },
              Math.min(
                SEARCH_RESULTS_PAGE_SIZE,
                outcome.results.length - visibleResults.length,
              ),
            )}
          </button>
        )}
      </>
    );
  };

  const renderHome: () => ReactElement = (): ReactElement => {
    const otherBuiltIns: Array<ComponentMetadata> =
      catalog.otherBuiltInGroups.flatMap(
        (group: PickerBuiltInGroup): Array<ComponentMetadata> => {
          return group.components;
        },
      );

    if (catalog.components.length === 0) {
      return (
        <p className="px-1 py-12 text-center text-sm text-gray-500">
          {translator.translateText(
            isTrigger ? "No triggers to show." : "No components to show.",
          )}
        </p>
      );
    }

    return (
      <div className="space-y-6">
        {catalog.popular.length > 0 && (
          <section aria-labelledby="workflow-picker-popular">
            <SectionHeading id="workflow-picker-popular" title="Popular" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {catalog.popular.map(
                (componentMetadata: ComponentMetadata): ReactElement => {
                  return (
                    <ComponentTile
                      key={componentMetadata.id}
                      componentMetadata={componentMetadata}
                      onSelect={pick}
                    />
                  );
                },
              )}
            </div>
          </section>
        )}

        {otherBuiltIns.length > 0 && (
          <section aria-labelledby="workflow-picker-more">
            <SectionHeading
              id="workflow-picker-more"
              title={
                catalog.popular.length > 0
                  ? isTrigger
                    ? "More triggers"
                    : "More components"
                  : isTrigger
                    ? "Triggers"
                    : "Components"
              }
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {otherBuiltIns.map(
                (componentMetadata: ComponentMetadata): ReactElement => {
                  return (
                    <ComponentTile
                      key={componentMetadata.id}
                      componentMetadata={componentMetadata}
                      onSelect={pick}
                    />
                  );
                },
              )}
            </div>
          </section>
        )}

        {catalog.resources.length > 0 && (
          <section aria-labelledby="workflow-picker-resources">
            <SectionHeading
              id="workflow-picker-resources"
              title="OneUptime resources"
              description={
                props.componentsType === ComponentType.Trigger
                  ? "Start this workflow when an incident, alert, monitor or any other record in this project is created, updated or deleted."
                  : "Create, find, update or delete incidents, alerts, monitors and every other record in this project."
              }
            />
            {catalog.commonResources.length > 0 && (
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {catalog.commonResources.map(
                  (resource: PickerResource): ReactElement => {
                    return (
                      <ResourceTile
                        key={resource.key}
                        resource={resource}
                        componentsType={props.componentsType}
                        onOpen={openResource}
                      />
                    );
                  },
                )}
              </div>
            )}
            <button
              type="button"
              {...getPickerItemProps(ALL_RESOURCES_ITEM_KEY)}
              aria-label={translator.translateTemplate(
                "Browse all resources, {{count}}",
                {
                  count: translator.formatNumber(catalog.resources.length),
                },
              )}
              onClick={() => {
                openView(
                  { kind: PickerViewKind.AllResources },
                  ALL_RESOURCES_ITEM_KEY,
                );
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors duration-150 hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="min-w-0 flex-1">
                {translator.translateText("Browse all resources")}
              </span>
              <span className="flex-shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">
                {catalog.resources.length}
              </span>
              <Icon
                icon={IconProp.ChevronRight}
                className="h-4 w-4 flex-shrink-0 text-gray-400"
              />
            </button>
          </section>
        )}
      </div>
    );
  };

  const renderResource: (resource: PickerResource) => ReactElement = (
    resource: PickerResource,
  ): ReactElement => {
    return (
      <div>
        <BackButton
          label="Back"
          onBack={() => {
            goBack(false);
          }}
        />
        <div className="mt-3 flex items-start gap-3">
          <IconBox icon={resource.icon} size="large" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              {resource.name}
            </h3>
            {resource.disambiguation && (
              <p className="text-xs text-gray-500">{resource.disambiguation}</p>
            )}
            {resource.description && (
              <p className="mt-0.5 text-sm text-gray-500">
                {resource.description}
              </p>
            )}
          </div>
        </div>
        <div
          role="group"
          aria-label={translator.translateTemplate(
            isTrigger ? "{{resource}} triggers" : "{{resource}} components",
            { resource: translatableTerm(resource.name) },
          )}
          className="mt-4 grid grid-cols-1 gap-2"
        >
          {resource.components.map(
            (componentMetadata: ComponentMetadata): ReactElement => {
              return (
                <ComponentTile
                  key={componentMetadata.id}
                  componentMetadata={componentMetadata}
                  onSelect={pick}
                />
              );
            },
          )}
        </div>
      </div>
    );
  };

  const renderAllResources: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <BackButton
          label="Back"
          onBack={() => {
            goBack(false);
          }}
        />
        <h3 className="mt-3 text-base font-semibold text-gray-900">
          {translator.translateText("All resources")}
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">
          {translator.translatePlural(
            {
              one: "{{count}} resource, A to Z. Search above to find one by name.",
              other:
                "{{count}} resources, A to Z. Search above to find one by name.",
            },
            catalog.resources.length,
          )}
        </p>
        <div
          role="group"
          aria-label={translator.translateText("All resources")}
          className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200"
        >
          {catalog.resources.map((resource: PickerResource): ReactElement => {
            return (
              <ResourceRow
                key={resource.key}
                resource={resource}
                componentsType={props.componentsType}
                onOpen={openResource}
              />
            );
          })}
        </div>
      </div>
    );
  };

  let body: ReactElement;

  if (isSearching) {
    body = renderSearchResults();
  } else if (view === PickerViewKind.Resource && openedResource) {
    body = renderResource(openedResource);
  } else if (view === PickerViewKind.AllResources) {
    body = renderAllResources();
  } else {
    body = renderHome();
  }

  return (
    <SideOver
      title={isTrigger ? "Add Trigger" : "Add Component"}
      description={
        isTrigger
          ? "Click a trigger to add it to your workflow."
          : "Click a component to add it to your workflow."
      }
      onClose={props.onCloseModal}
      leftFooterElement={
        <div className="max-md:hidden items-center gap-4 text-xs text-gray-500 md:flex">
          <span className="inline-flex items-center gap-1.5">
            <TranslatedSentence
              template="{{keys}} to move"
              slots={{
                keys: (
                  <>
                    <KeyboardShortcut
                      keys={[KeyboardKey.ArrowUp]}
                      size={KeyboardShortcutSize.ExtraSmall}
                    />
                    <KeyboardShortcut
                      keys={[KeyboardKey.ArrowDown]}
                      size={KeyboardShortcutSize.ExtraSmall}
                    />
                  </>
                ),
              }}
              renderText={(text: string): ReactElement => {
                return <span>{text.trim()}</span>;
              }}
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TranslatedSentence
              template="{{key}} to add"
              slots={{
                key: (
                  <KeyboardShortcut
                    keys={[KeyboardKey.Enter]}
                    size={KeyboardShortcutSize.ExtraSmall}
                  />
                ),
              }}
              renderText={(text: string): ReactElement => {
                return <span>{text.trim()}</span>;
              }}
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TranslatedSentence
              template="{{key}} to search"
              slots={{
                key: (
                  <KeyboardShortcut
                    keys={["/"]}
                    size={KeyboardShortcutSize.ExtraSmall}
                  />
                ),
              }}
              renderText={(text: string): ReactElement => {
                return <span>{text.trim()}</span>;
              }}
            />
          </span>
        </div>
      }
    >
      <div ref={rootRef} data-testid="workflow-component-picker">
        <div className="sticky top-0 z-10 -mx-5 border-b border-gray-100 bg-white px-5 pb-3 pt-1 sm:pt-5">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
            </div>
            <input
              ref={searchInputRef}
              id={SEARCH_INPUT_ID}
              type="text"
              role="combobox"
              aria-label={translator.translateText(
                isTrigger ? "Search triggers" : "Search components",
              )}
              aria-autocomplete="list"
              aria-expanded={isSearching && visibleResults.length > 0}
              aria-controls={isSearching ? SEARCH_RESULTS_ID : undefined}
              aria-activedescendant={
                isSearching && visibleResults.length > 0
                  ? getSearchOptionId(activeIndex)
                  : undefined
              }
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={query}
              placeholder={translator.translateText(
                props.componentsType === ComponentType.Trigger
                  ? "Search triggers, e.g. incident created"
                  : "Search components, e.g. create incident",
              )}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setQuery(event.target.value);
              }}
              onKeyDown={onSearchKeyDown}
              className="block w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-10 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {query.length > 0 && (
              <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
                <button
                  type="button"
                  aria-label={translator.translateText("Clear search")}
                  onClick={clearSearch}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Icon icon={IconProp.Close} className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <p
            role="status"
            aria-live="polite"
            className={`text-xs text-gray-500 ${statusText ? "mt-2" : ""}`}
          >
            {statusText}
          </p>
        </div>

        <div
          data-testid="workflow-component-picker-body"
          aria-busy={isCatchingUp}
          className={`pt-4 transition-opacity duration-150 ${
            isCatchingUp ? "opacity-60" : ""
          }`}
          onKeyDown={onBrowseKeyDown}
        >
          {body}
        </div>
      </div>
    </SideOver>
  );
};

export default ComponentsModal;
