import GenericObject from "../../../Types/GenericObject";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * What a reader can change about a dashboard activity feed from the ⋯ More
 * menu in its header (FeedMoreMenu): which way the timeline runs, and which
 * kinds of event it shows.
 *
 * Both are applied by the API, never to the rows already in the browser. A
 * feed is read a window at a time (see useFeedItems), so filtering the loaded
 * window would show "no items" while matching events sat one page further
 * back, and reversing it would show the newest ten upside down instead of the
 * oldest ten.
 *
 * This module is React-free so the rules can be tested on their own.
 */
export interface FeedOptions {
  sortOrder: SortOrder;
  /*
   * The event types to show. Empty means no filter, so every event type is
   * shown - including one a feed model gains after the reader last looked.
   */
  eventTypes: Array<string>;
}

export const DEFAULT_FEED_SORT_ORDER: SortOrder = SortOrder.Descending;

export const DEFAULT_FEED_OPTIONS: FeedOptions = {
  sortOrder: DEFAULT_FEED_SORT_ORDER,
  eventTypes: [],
};

export interface FeedSortOrderOption {
  value: SortOrder;
  label: string;
  icon: IconProp;
}

export const FEED_SORT_ORDER_OPTIONS: Array<FeedSortOrderOption> = [
  {
    value: SortOrder.Descending,
    label: "Newest first",
    icon: IconProp.BarsArrowDown,
  },
  {
    value: SortOrder.Ascending,
    label: "Oldest first",
    icon: IconProp.BarsArrowUp,
  },
];

export interface FeedEventTypeOption {
  value: string;
  label: string;
  icon?: IconProp | undefined;
}

export type GetFeedEventTypeLabelFunction = (
  eventType: string,
) => string | undefined;

export type GetFeedEventTypeIconFunction = (
  eventType: string,
) => IconProp | undefined;

/*
 * Event types shared by many feeds whose split name reads badly
 * ("Owner User Added"). A Map rather than an object literal, so an event type
 * that happens to share a name with an Object.prototype member ("toString")
 * cannot come back as a function.
 */
const EVENT_TYPE_LABELS: Map<string, string> = new Map<string, string>([
  ["OwnerUserAdded", "User Added as Owner"],
  ["OwnerUserRemoved", "User Removed as Owner"],
  ["OwnerTeamAdded", "Team Added as Owner"],
  ["OwnerTeamRemoved", "Team Removed as Owner"],
  ["AutoRemediation", "Auto-Remediation"],
]);

/*
 * Runs that camel-case splitting would get wrong, matched before any other
 * word: "VMware" would split into "V Mware", "OnCall" should read
 * "On-Call", and the SLO feed's "ServiceLevelObjective" prefix is written
 * "SLO" everywhere else in the dashboard.
 */
const EVENT_TYPE_WORDS: Array<{ word: string; label: string }> = [
  { word: "ServiceLevelObjective", label: "SLO" },
  { word: "VMware", label: "VMware" },
  { word: "VCenter", label: "vCenter" },
  { word: "OnCall", label: "On-Call" },
];

// Joining words stay lower case inside a title ("Added to Episode").
const LOWER_CASE_WORDS: Set<string> = new Set<string>([
  "a",
  "an",
  "and",
  "as",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

const EVENT_TYPE_WORD_PATTERN: RegExp = new RegExp(
  `${EVENT_TYPE_WORDS.map((entry: { word: string }) => {
    return entry.word;
  }).join("|")}|[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+`,
  "g",
);

type GetFeedEventTypeLabel = (eventType: string) => string;

/*
 * Feed event types are enum values named like "IncidentStateChanged", so a
 * readable label is the value split into words. A feed with a better name for
 * one of its own events passes getEventTypeLabel to getFeedEventTypeOptions.
 */
export const getFeedEventTypeLabel: GetFeedEventTypeLabel = (
  eventType: string,
): string => {
  const knownLabel: string | undefined = EVENT_TYPE_LABELS.get(eventType);

  if (knownLabel) {
    return knownLabel;
  }

  const words: Array<string> = eventType.match(EVENT_TYPE_WORD_PATTERN) || [];

  if (words.length === 0) {
    return eventType;
  }

  return words
    .map((word: string, index: number): string => {
      const knownWord: { word: string; label: string } | undefined =
        EVENT_TYPE_WORDS.find((entry: { word: string }) => {
          return entry.word === word;
        });

      if (knownWord) {
        return knownWord.label;
      }

      if (index > 0 && LOWER_CASE_WORDS.has(word.toLowerCase())) {
        return word.toLowerCase();
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

type GetFeedEventTypeOptions = (data: {
  eventTypes: Array<string>;
  getEventTypeLabel?: GetFeedEventTypeLabelFunction | undefined;
  getEventTypeIcon?: GetFeedEventTypeIconFunction | undefined;
}) => Array<FeedEventTypeOption>;

/*
 * The checklist of the event type filter: one entry per event type,
 * alphabetical by label so the reader can scan for the one they want.
 */
export const getFeedEventTypeOptions: GetFeedEventTypeOptions = (data: {
  eventTypes: Array<string>;
  getEventTypeLabel?: GetFeedEventTypeLabelFunction | undefined;
  getEventTypeIcon?: GetFeedEventTypeIconFunction | undefined;
}): Array<FeedEventTypeOption> => {
  const uniqueEventTypes: Array<string> = Array.from(
    new Set<string>(
      data.eventTypes.filter((eventType: string) => {
        return Boolean(eventType);
      }),
    ),
  );

  return uniqueEventTypes
    .map((eventType: string): FeedEventTypeOption => {
      return {
        value: eventType,
        label:
          data.getEventTypeLabel?.(eventType) ||
          getFeedEventTypeLabel(eventType),
        icon: data.getEventTypeIcon?.(eventType),
      };
    })
    .sort((a: FeedEventTypeOption, b: FeedEventTypeOption): number => {
      return a.label.localeCompare(b.label);
    });
};

type SanitizeFeedEventTypes = (data: {
  selectedEventTypes: Array<string>;
  knownEventTypes: Array<string>;
}) => Array<string>;

/*
 * Keep only event types the feed actually has, once each, in the feed's own
 * order. The order matters: it makes the request - and so the reload key -
 * the same whichever order the reader ticked the boxes in.
 */
export const sanitizeFeedEventTypes: SanitizeFeedEventTypes = (data: {
  selectedEventTypes: Array<string>;
  knownEventTypes: Array<string>;
}): Array<string> => {
  const selected: Set<string> = new Set<string>(data.selectedEventTypes);

  return Array.from(new Set<string>(data.knownEventTypes)).filter(
    (eventType: string) => {
      return selected.has(eventType);
    },
  );
};

type IsFeedSortOrder = (value: unknown) => value is SortOrder;

export const isFeedSortOrder: IsFeedSortOrder = (
  value: unknown,
): value is SortOrder => {
  return value === SortOrder.Ascending || value === SortOrder.Descending;
};

type GetFeedOptionsKey = (options: FeedOptions) => string;

/*
 * A stable string for "what this feed is showing". useFeedItems re-reads the
 * feed from its first window whenever it changes.
 */
export const getFeedOptionsKey: GetFeedOptionsKey = (
  options: FeedOptions,
): string => {
  return `${options.sortOrder}|${options.eventTypes.join(",")}`;
};

type IsFeedFiltered = (options: FeedOptions) => boolean;

export const isFeedFiltered: IsFeedFiltered = (
  options: FeedOptions,
): boolean => {
  return options.eventTypes.length > 0;
};

type IsDefaultFeedOptions = (options: FeedOptions) => boolean;

export const isDefaultFeedOptions: IsDefaultFeedOptions = (
  options: FeedOptions,
): boolean => {
  return (
    options.sortOrder === DEFAULT_FEED_SORT_ORDER && !isFeedFiltered(options)
  );
};

/*
 * The query fragment for the event type filter, keyed by the feed model's
 * event type column. It is empty when nothing is filtered, so an unfiltered
 * feed sends exactly the query it always sent.
 */
export const getFeedEventTypeQuery: <TFeedModel extends GenericObject>(
  eventTypeColumn: Extract<keyof TFeedModel, string>,
  options: FeedOptions,
) => Query<TFeedModel> = <TFeedModel extends GenericObject>(
  eventTypeColumn: Extract<keyof TFeedModel, string>,
  options: FeedOptions,
): Query<TFeedModel> => {
  if (!isFeedFiltered(options)) {
    return {};
  }

  return {
    [eventTypeColumn]: new Includes([...options.eventTypes]),
  } as unknown as Query<TFeedModel>;
};

export const FILTERED_FEED_NO_ITEMS_MESSAGE: string =
  "No events in this feed match the selected event types.";

type GetFeedNoItemsMessage = (data: {
  options: FeedOptions;
  noItemsMessage: string;
}) => string;

/*
 * An empty filtered feed says so, rather than claiming the resource has no
 * activity at all.
 */
export const getFeedNoItemsMessage: GetFeedNoItemsMessage = (data: {
  options: FeedOptions;
  noItemsMessage: string;
}): string => {
  return isFeedFiltered(data.options)
    ? FILTERED_FEED_NO_ITEMS_MESSAGE
    : data.noItemsMessage;
};

/*
 * The sentences of a feed's ⋯ menu, its event type filter and the box that
 * says the feed is filtered, as the English keys the dashboard's locale files
 * translate. The ones with placeholders are looked up whole and filled
 * afterwards (translateTemplate), so a translation can put the numbers where
 * its grammar wants them.
 */
export const FEED_OPTIONS_TEXT: {
  sortHeading: string;
  filter: string;
  refresh: string;
  appliedFiltersTitle: string;
  moreEventTypes: string;
  eventTypesLabel: string;
  showAll: string;
  searchPlaceholder: string;
  searchResults: string;
  showingEveryEventType: string;
  showingSomeEventTypes: string;
  noSearchMatches: string;
  noEventTypes: string;
  applyFilters: string;
} = {
  // The ⋯ menu.
  sortHeading: translationKey("Sort by time"),
  filter: translationKey("Filter by event type"),
  refresh: translationKey("Refresh"),
  // The box over a filtered feed.
  appliedFiltersTitle: translationKey(
    "Showing {{selected}} of {{total}} event types",
  ),
  moreEventTypes: translationKey("and {{remaining}} more"),
  // The filter dialog.
  eventTypesLabel: translationKey("Event types"),
  showAll: translationKey("Show all"),
  searchPlaceholder: translationKey("Search event types"),
  searchResults: translationKey("Matching event types: {{count}}"),
  showingEveryEventType: translationKey(
    "Showing every event type. Tick one or more to narrow the feed.",
  ),
  showingSomeEventTypes: translationKey(
    "Showing {{selected}} of {{total}} event types.",
  ),
  noSearchMatches: translationKey('No event types match "{{search}}".'),
  noEventTypes: translationKey("This feed has no event types to filter by."),
  applyFilters: translationKey("Apply Filters"),
};

/*
 * The box over a filtered feed shows the chosen event types as chips, and
 * folds the rest into "and N more" past this many, so ticking most of a long
 * checklist does not push the feed itself down the page.
 */
export const FEED_APPLIED_FILTERS_CHIP_LIMIT: number = 8;
