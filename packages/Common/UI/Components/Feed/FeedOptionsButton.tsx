import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import Icon from "../Icon/Icon";
import {
  DEFAULT_FEED_SORT_ORDER,
  FEED_OPTIONS_TEXT,
  FEED_SORT_ORDER_OPTIONS,
  FeedEventTypeOption,
  FeedOptions,
  FeedSortOrderOption,
  getFeedOptionsSummary,
  isDefaultFeedOptions,
  translateFeedOptionsText,
} from "./FeedOptions";

export interface ComponentProps {
  value: FeedOptions;
  onChange: (options: FeedOptions) => void;
  eventTypeOptions: Array<FeedEventTypeOption>;
}

// A short checklist is scanned by eye; a longer one gets a search box.
export const FEED_EVENT_TYPE_SEARCH_THRESHOLD: number = 8;

export const FEED_OPTIONS_PANEL_WIDTH_PX: number = 288;

// The panel never comes closer than this to either edge of the viewport.
export const FEED_OPTIONS_VIEWPORT_GUTTER_PX: number = 16;

export interface FeedOptionsPanelPlacement {
  // Offset from the trigger's left edge, in px.
  left: number;
  width: number;
}

type GetFeedOptionsPanelPlacement = (data: {
  triggerLeft: number;
  triggerRight: number;
  viewportWidth: number;
}) => FeedOptionsPanelPlacement;

/*
 * Where the panel goes. It lines its right edge up with the trigger's, like
 * every other header menu, and slides back inside the viewport when that
 * would cross an edge. That happens on phones and tablets: the card header
 * stacks there and puts this button, the first of the header's controls, at
 * the left of the row, so a right-aligned panel would open off the screen.
 */
export const getFeedOptionsPanelPlacement: GetFeedOptionsPanelPlacement =
  (data: {
    triggerLeft: number;
    triggerRight: number;
    viewportWidth: number;
  }): FeedOptionsPanelPlacement => {
    const width: number = Math.max(
      Math.min(
        FEED_OPTIONS_PANEL_WIDTH_PX,
        data.viewportWidth - 2 * FEED_OPTIONS_VIEWPORT_GUTTER_PX,
      ),
      0,
    );
    const lowestLeft: number = FEED_OPTIONS_VIEWPORT_GUTTER_PX;
    const highestLeft: number = Math.max(
      data.viewportWidth - FEED_OPTIONS_VIEWPORT_GUTTER_PX - width,
      lowestLeft,
    );
    const left: number = Math.min(
      Math.max(data.triggerRight - width, lowestLeft),
      highestLeft,
    );

    return {
      left: left - data.triggerLeft,
      width,
    };
  };

/*
 * The one control in a feed's header for everything about what the feed
 * shows: the time order and the event type filter. It opens a small panel
 * rather than a menu, because the reader ticks several boxes in one visit and
 * a menu closes on every pick. Changes apply as they are made - there is no
 * Apply button to forget - and the trigger is tinted, with a count of the
 * chosen event types, whenever the feed is not showing its default view.
 */
const FeedOptionsButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const uniqueId: string = useId();
  const buttonId: string = `feed-options-button-${uniqueId}`;
  const summaryId: string = `feed-options-summary-${uniqueId}`;
  const panelId: string = `feed-options-panel-${uniqueId}`;
  const sortHeadingId: string = `feed-options-sort-${uniqueId}`;
  const eventTypesHeadingId: string = `feed-options-event-types-${uniqueId}`;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>("");
  const [placement, setPlacement] = useState<FeedOptionsPanelPlacement | null>(
    null,
  );

  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const triggerRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const sortRadioRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);
  const eventTypeListRef: React.MutableRefObject<HTMLUListElement | null> =
    useRef<HTMLUListElement | null>(null);

  const selectedEventTypes: Set<string> = useMemo(() => {
    return new Set<string>(props.value.eventTypes);
  }, [props.value.eventTypes]);

  const selectedCount: number = props.value.eventTypes.length;
  const isCustomized: boolean = !isDefaultFeedOptions(props.value);
  const isOldestFirst: boolean =
    props.value.sortOrder !== DEFAULT_FEED_SORT_ORDER;
  const translate: (
    text: string,
    values?: Record<string, string | number>,
  ) => string = (
    text: string,
    values?: Record<string, string | number>,
  ): string => {
    return translateFeedOptionsText({
      text,
      values,
      translate: translateString,
    });
  };

  const summary: string = getFeedOptionsSummary({
    options: props.value,
    eventTypeCount: props.eventTypeOptions.length,
    translate: translateString,
  });

  const showSearch: boolean =
    props.eventTypeOptions.length > FEED_EVENT_TYPE_SEARCH_THRESHOLD;

  /*
   * Labels are shown - and searched and ordered - in the reader's language.
   * A label with no translation yet stays in English.
   */
  const translatedEventTypeOptions: Array<FeedEventTypeOption> =
    props.eventTypeOptions
      .map((option: FeedEventTypeOption): FeedEventTypeOption => {
        return {
          ...option,
          label: translate(option.label),
        };
      })
      .sort((a: FeedEventTypeOption, b: FeedEventTypeOption): number => {
        return a.label.localeCompare(b.label);
      });

  const searchTerm: string = searchText.trim().toLowerCase();
  const visibleEventTypeOptions: Array<FeedEventTypeOption> = searchTerm
    ? translatedEventTypeOptions.filter((option: FeedEventTypeOption) => {
        return option.label.toLowerCase().includes(searchTerm);
      })
    : translatedEventTypeOptions;

  const close: (shouldReturnFocus: boolean) => void = (
    shouldReturnFocus: boolean,
  ): void => {
    setIsOpen(false);
    setSearchText("");

    if (shouldReturnFocus) {
      triggerRef.current?.focus();
    }
  };

  /*
   * Dismiss on a press outside the trigger and panel. The listener sits on
   * the container that holds both, so pressing the trigger to close the panel
   * is a toggle, not a dismissal followed by a re-open.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const onPointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      const target: EventTarget | null = event.target;

      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearchText("");
      }
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen]);

  const placePanel: () => void = useCallback((): void => {
    const container: HTMLDivElement | null = containerRef.current;

    if (!container) {
      return;
    }

    const rect: DOMRect = container.getBoundingClientRect();

    setPlacement(
      getFeedOptionsPanelPlacement({
        triggerLeft: rect.left,
        triggerRight: rect.right,
        viewportWidth:
          document.documentElement.clientWidth || window.innerWidth,
      }),
    );
  }, []);

  // Placed before paint, so the panel never flashes off-screen first.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPlacement(null);
      return undefined;
    }

    placePanel();
    window.addEventListener("resize", placePanel);

    return () => {
      window.removeEventListener("resize", placePanel);
    };
  }, [isOpen, placePanel]);

  // Opening moves focus onto the chosen sort order, the panel's first control.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const selectedIndex: number = FEED_SORT_ORDER_OPTIONS.findIndex(
      (option: FeedSortOrderOption) => {
        return option.value === props.value.sortOrder;
      },
    );

    sortRadioRefs.current[Math.max(selectedIndex, 0)]?.focus();
    // Only on open: re-focusing on every sort change would fight the keyboard.
  }, [isOpen]);

  const setSortOrder: (sortOrder: SortOrder) => void = (
    sortOrder: SortOrder,
  ): void => {
    if (sortOrder === props.value.sortOrder) {
      return;
    }

    props.onChange({
      ...props.value,
      sortOrder,
    });
  };

  const toggleEventType: (eventType: string) => void = (
    eventType: string,
  ): void => {
    const nextSelected: Set<string> = new Set<string>(selectedEventTypes);

    if (nextSelected.has(eventType)) {
      nextSelected.delete(eventType);
    } else {
      nextSelected.add(eventType);
    }

    // Keep the checklist's order, not the order the boxes were ticked in.
    props.onChange({
      ...props.value,
      eventTypes: props.eventTypeOptions
        .map((option: FeedEventTypeOption) => {
          return option.value;
        })
        .filter((value: string) => {
          return nextSelected.has(value);
        }),
    });
  };

  /*
   * "Show all" and "Reset to default" hide themselves once they have done
   * their job. Focus on a button that unmounts falls to the page body, out of
   * the panel, where Escape no longer closes it - so both hand focus to the
   * control the reader is most likely to reach for next.
   */
  const focusSortOrder: (sortOrder: SortOrder) => void = (
    sortOrder: SortOrder,
  ): void => {
    const index: number = FEED_SORT_ORDER_OPTIONS.findIndex(
      (option: FeedSortOrderOption) => {
        return option.value === sortOrder;
      },
    );

    sortRadioRefs.current[Math.max(index, 0)]?.focus();
  };

  const clearEventTypes: () => void = (): void => {
    props.onChange({
      ...props.value,
      eventTypes: [],
    });

    const firstCheckbox: HTMLInputElement | null =
      eventTypeListRef.current?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      ) || null;

    if (firstCheckbox) {
      firstCheckbox.focus();
    } else {
      focusSortOrder(props.value.sortOrder);
    }
  };

  const resetOptions: () => void = (): void => {
    props.onChange({
      sortOrder: DEFAULT_FEED_SORT_ORDER,
      eventTypes: [],
    });
    focusSortOrder(DEFAULT_FEED_SORT_ORDER);
  };

  const onContainerKeyDown: (event: React.KeyboardEvent) => void = (
    event: React.KeyboardEvent,
  ): void => {
    if (isOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  /*
   * Tabbing out of the panel closes it. Only focus that lands on something
   * outside counts: a press on the panel's own padding moves focus to the
   * panel itself (it is focusable for exactly this reason), which keeps
   * Escape working.
   */
  const onContainerBlur: (event: React.FocusEvent) => void = (
    event: React.FocusEvent,
  ): void => {
    const nextFocus: EventTarget | null = event.relatedTarget;

    if (
      isOpen &&
      nextFocus instanceof Node &&
      containerRef.current &&
      !containerRef.current.contains(nextFocus)
    ) {
      setIsOpen(false);
      setSearchText("");
    }
  };

  // Arrow keys move between the two sort orders, as in any radio group.
  const onSortKeyDown: (event: React.KeyboardEvent, index: number) => void = (
    event: React.KeyboardEvent,
    index: number,
  ): void => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % FEED_SORT_ORDER_OPTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (index - 1 + FEED_SORT_ORDER_OPTIONS.length) %
        FEED_SORT_ORDER_OPTIONS.length;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextOption: FeedSortOrderOption | undefined =
      FEED_SORT_ORDER_OPTIONS[nextIndex];

    if (nextOption) {
      setSortOrder(nextOption.value);
      sortRadioRefs.current[nextIndex]?.focus();
    }
  };

  /*
   * The visible label is the button's name, and the state behind it - order
   * and filter - its description, so a screen reader says each once. The
   * label is only drawn from xl up: beside the feed's other header controls
   * it would squeeze the card title into a sliver on tablets. Oldest first
   * swaps the funnel for the sort glyph, so a reversed feed does not rely on
   * the tint alone to say so.
   */
  const getTrigger: () => ReactElement = (): ReactElement => {
    return (
      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        data-testid="feed-options-button"
        className={`inline-flex min-h-[2.375rem] items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-150 cursor-pointer select-none ${
          isCustomized
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-400"
            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900"
        }`}
        title={summary}
        aria-describedby={summaryId}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => {
          if (isOpen) {
            close(false);
          } else {
            setIsOpen(true);
          }
        }}
      >
        <Icon
          icon={isOldestFirst ? IconProp.BarsArrowUp : IconProp.Filter}
          className={`h-4 w-4 ${isCustomized ? "text-indigo-500" : "text-gray-500"}`}
        />
        <span
          className="sr-only xl:not-sr-only"
          data-testid="feed-options-label"
        >
          {translate(FEED_OPTIONS_TEXT.triggerLabel)}
        </span>
        {selectedCount > 0 && (
          <span
            data-testid="feed-options-count"
            className="inline-flex min-w-[1.25rem] justify-center rounded-full bg-indigo-600 px-1.5 text-xs font-semibold leading-5 text-white"
            aria-hidden="true"
          >
            {selectedCount}
          </span>
        )}
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-3.5 w-3.5 ml-0.5 ${isCustomized ? "text-indigo-400" : "text-gray-400"}`}
        />
      </button>
    );
  };

  const getSortSection: () => ReactElement = (): ReactElement => {
    return (
      <div className="border-b border-gray-100 p-3">
        <div
          id={sortHeadingId}
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          {translate(FEED_OPTIONS_TEXT.sortHeading)}
        </div>
        <div
          role="radiogroup"
          aria-labelledby={sortHeadingId}
          className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1"
        >
          {FEED_SORT_ORDER_OPTIONS.map(
            (option: FeedSortOrderOption, index: number) => {
              const isSelected: boolean =
                option.value === props.value.sortOrder;

              return (
                <button
                  key={option.value}
                  ref={(element: HTMLButtonElement | null) => {
                    sortRadioRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  data-testid={`feed-options-sort-${option.value}`}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isSelected
                      ? "bg-white font-semibold text-gray-900 shadow-sm ring-1 ring-indigo-400"
                      : "font-normal text-gray-600 hover:text-gray-900"
                  }`}
                  onClick={() => {
                    setSortOrder(option.value);
                  }}
                  onKeyDown={(event: React.KeyboardEvent) => {
                    onSortKeyDown(event, index);
                  }}
                >
                  <Icon
                    icon={option.icon}
                    className={`h-4 w-4 ${isSelected ? "text-indigo-500" : "text-gray-400"}`}
                  />
                  {translate(option.label)}
                </button>
              );
            },
          )}
        </div>
      </div>
    );
  };

  const getEventTypeSection: () => ReactElement = (): ReactElement => {
    return (
      <div className="p-3">
        <div className="flex items-center justify-between">
          <div
            id={eventTypesHeadingId}
            className="text-xs font-semibold uppercase tracking-wide text-gray-500"
          >
            {translate(FEED_OPTIONS_TEXT.eventTypesHeading)}
          </div>
          {selectedCount > 0 && (
            <button
              type="button"
              data-testid="feed-options-clear-event-types"
              className="-my-1 rounded px-1.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={clearEventTypes}
            >
              {translate(FEED_OPTIONS_TEXT.showAll)}
            </button>
          )}
        </div>
        <p
          className="mt-1 text-xs text-gray-500"
          data-testid="feed-options-event-type-summary"
          aria-live="polite"
        >
          {selectedCount === 0
            ? translate(FEED_OPTIONS_TEXT.showingEveryEventType)
            : translate(FEED_OPTIONS_TEXT.showingSomeEventTypes, {
                selected: selectedCount,
                total: props.eventTypeOptions.length,
              })}
        </p>
        {showSearch && (
          <div className="relative mt-2">
            <Icon
              icon={IconProp.Search}
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={searchText}
              aria-label={translate(FEED_OPTIONS_TEXT.searchPlaceholder)}
              placeholder={translate(FEED_OPTIONS_TEXT.searchPlaceholder)}
              data-testid="feed-options-search"
              className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearchText(event.target.value);
              }}
            />
            <span
              className="sr-only"
              aria-live="polite"
              data-testid="feed-options-search-results"
            >
              {searchTerm
                ? translate(FEED_OPTIONS_TEXT.searchResults, {
                    count: visibleEventTypeOptions.length,
                  })
                : ""}
            </span>
          </div>
        )}
        <div role="group" aria-labelledby={eventTypesHeadingId}>
          <ul
            ref={eventTypeListRef}
            role="list"
            className="-mx-1 mt-2 max-h-64 overflow-y-auto"
            data-testid="feed-options-event-types"
          >
            {visibleEventTypeOptions.map((option: FeedEventTypeOption) => {
              const isChecked: boolean = selectedEventTypes.has(option.value);

              return (
                <li key={option.value}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      data-testid={`feed-options-event-type-${option.value}`}
                      className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      onChange={() => {
                        toggleEventType(option.value);
                      }}
                    />
                    {option.icon && (
                      <Icon
                        icon={option.icon}
                        className="h-4 w-4 shrink-0 text-gray-400"
                      />
                    )}
                    <span className="truncate">{option.label}</span>
                  </label>
                </li>
              );
            })}
            {visibleEventTypeOptions.length === 0 && (
              <li className="px-1.5 py-2 text-sm text-gray-500">
                {props.eventTypeOptions.length === 0
                  ? translate(FEED_OPTIONS_TEXT.noEventTypes)
                  : translate(FEED_OPTIONS_TEXT.noSearchMatches, {
                      search: searchText.trim(),
                    })}
              </li>
            )}
          </ul>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block text-left"
      onKeyDown={onContainerKeyDown}
      onBlur={onContainerBlur}
    >
      {getTrigger()}
      {/* Outside the button, or its text would join the button's name. */}
      <span
        id={summaryId}
        className="sr-only"
        data-testid="feed-options-summary"
      >
        {summary}
      </span>
      {isOpen && (
        <div
          id={panelId}
          role="dialog"
          tabIndex={-1}
          aria-label={translate(FEED_OPTIONS_TEXT.panelLabel)}
          data-testid="feed-options-panel"
          style={
            placement
              ? { left: `${placement.left}px`, width: `${placement.width}px` }
              : undefined
          }
          className={`absolute z-50 mt-2 origin-top-right rounded-lg bg-white shadow-xl ring-1 ring-gray-200 focus:outline-none ${
            placement ? "" : "right-0 w-72"
          }`}
        >
          {getSortSection()}
          {getEventTypeSection()}
          {isCustomized && (
            <div className="flex justify-end border-t border-gray-100 px-3 py-2">
              <button
                type="button"
                data-testid="feed-options-reset"
                className="-my-1 rounded px-1.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={resetOptions}
              >
                {translate(FEED_OPTIONS_TEXT.reset)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FeedOptionsButton;
