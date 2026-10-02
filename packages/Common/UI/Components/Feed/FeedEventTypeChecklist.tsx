import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import { FEED_OPTIONS_TEXT, FeedEventTypeOption } from "./FeedOptions";

export interface ComponentProps {
  eventTypeOptions: Array<FeedEventTypeOption>;
  // The ticked event types. Empty means every event type is shown.
  selectedEventTypes: Array<string>;
  onChange: (eventTypes: Array<string>) => void;
}

// A short checklist is scanned by eye; a longer one gets a search box.
export const FEED_EVENT_TYPE_SEARCH_THRESHOLD: number = 8;

/*
 * The event types a feed can be narrowed to, as a checklist: what the filter
 * dialog of every feed shows (FeedFilterModal). Each event type wears the icon
 * its items carry in the feed, the list is alphabetical in the reader's
 * language, and a longer one can be searched. A sentence over the list says
 * how much of the feed the ticks leave, and Show all clears them.
 *
 * Controlled: the dialog holds the ticks until the reader applies them.
 */
const FeedEventTypeChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) ?? text;
  };
  const [searchText, setSearchText] = useState<string>("");
  const listRef: React.MutableRefObject<HTMLUListElement | null> =
    useRef<HTMLUListElement | null>(null);
  const searchRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const selectedEventTypes: Set<string> = useMemo(() => {
    return new Set<string>(props.selectedEventTypes);
  }, [props.selectedEventTypes]);

  // Only ticks the checklist can show count, so the sentence never overstates.
  const selectedCount: number = props.eventTypeOptions.filter(
    (option: FeedEventTypeOption) => {
      return selectedEventTypes.has(option.value);
    },
  ).length;

  /*
   * Labels are shown - and searched and ordered - in the reader's language.
   * A label with no translation yet stays in English.
   */
  const translatedEventTypeOptions: Array<FeedEventTypeOption> =
    props.eventTypeOptions
      .map((option: FeedEventTypeOption): FeedEventTypeOption => {
        return {
          ...option,
          label: tx(option.label),
        };
      })
      .sort((a: FeedEventTypeOption, b: FeedEventTypeOption): number => {
        return a.label.localeCompare(b.label);
      });

  const showSearch: boolean =
    props.eventTypeOptions.length > FEED_EVENT_TYPE_SEARCH_THRESHOLD;
  const searchTerm: string = searchText.trim().toLowerCase();
  const visibleEventTypeOptions: Array<FeedEventTypeOption> = searchTerm
    ? translatedEventTypeOptions.filter((option: FeedEventTypeOption) => {
        return option.label.toLowerCase().includes(searchTerm);
      })
    : translatedEventTypeOptions;

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
    props.onChange(
      props.eventTypeOptions
        .map((option: FeedEventTypeOption) => {
          return option.value;
        })
        .filter((value: string) => {
          return nextSelected.has(value);
        }),
    );
  };

  /*
   * Show all hides itself once it has done its job, and focus on a button
   * that unmounts falls out of the dialog. It goes to the first box instead,
   * or to the search box while the search hides every box.
   */
  const showAll: () => void = (): void => {
    props.onChange([]);

    const firstCheckbox: HTMLInputElement | null =
      listRef.current?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      ) || null;

    if (firstCheckbox) {
      firstCheckbox.focus();
    } else {
      searchRef.current?.focus();
    }
  };

  return (
    <div data-testid="feed-options-event-type-checklist">
      <div className="flex items-start justify-between gap-3">
        <p
          className="text-sm text-gray-500"
          data-testid="feed-options-event-type-summary"
          aria-live="polite"
        >
          {selectedCount === 0
            ? tx(FEED_OPTIONS_TEXT.showingEveryEventType)
            : translator.translateTemplate(
                FEED_OPTIONS_TEXT.showingSomeEventTypes,
                {
                  selected: selectedCount,
                  total: props.eventTypeOptions.length,
                },
              )}
        </p>
        {selectedCount > 0 && (
          <button
            type="button"
            data-testid="feed-options-clear-event-types"
            className="-my-1 shrink-0 rounded px-1.5 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={showAll}
          >
            {tx(FEED_OPTIONS_TEXT.showAll)}
          </button>
        )}
      </div>
      {showSearch && (
        <div className="relative mt-3">
          <Icon
            icon={IconProp.Search}
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          />
          <input
            ref={searchRef}
            type="text"
            value={searchText}
            aria-label={tx(FEED_OPTIONS_TEXT.searchPlaceholder)}
            placeholder={tx(FEED_OPTIONS_TEXT.searchPlaceholder)}
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
              ? translator.translateTemplate(FEED_OPTIONS_TEXT.searchResults, {
                  count: visibleEventTypeOptions.length,
                })
              : ""}
          </span>
        </div>
      )}
      <div role="group" aria-label={tx(FEED_OPTIONS_TEXT.eventTypesLabel)}>
        <ul
          ref={listRef}
          role="list"
          className="-mx-1.5 mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2"
          data-testid="feed-options-event-types"
        >
          {visibleEventTypeOptions.map((option: FeedEventTypeOption) => {
            const isChecked: boolean = selectedEventTypes.has(option.value);

            return (
              <li key={option.value} className="min-w-0">
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
            <li
              className="col-span-full px-1.5 py-2 text-sm text-gray-500"
              data-testid="feed-options-no-event-types"
            >
              {props.eventTypeOptions.length === 0
                ? tx(FEED_OPTIONS_TEXT.noEventTypes)
                : translator.translateTemplate(
                    FEED_OPTIONS_TEXT.noSearchMatches,
                    {
                      search: searchText.trim(),
                    },
                  )}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default FeedEventTypeChecklist;
