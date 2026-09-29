import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LocalStorage from "../../Utils/LocalStorage";
import {
  DEFAULT_FEED_SORT_ORDER,
  FeedEventTypeOption,
  FeedOptions,
  GetFeedEventTypeIconFunction,
  GetFeedEventTypeLabelFunction,
  getFeedEventTypeOptions,
  getFeedOptionsKey,
  isFeedFiltered,
  isFeedSortOrder,
  sanitizeFeedEventTypes,
} from "./FeedOptions";

export interface UseFeedOptionsProps {
  // Every event type the feed model can record, e.g. Object.values(the enum).
  eventTypes: Array<string>;
  getEventTypeLabel?: GetFeedEventTypeLabelFunction | undefined;
  getEventTypeIcon?: GetFeedEventTypeIconFunction | undefined;
  /*
   * Names this kind of feed ("incident", "monitor", ...) so the reader's sort
   * order is remembered across pages and visits. The event type filter is
   * deliberately not remembered: it narrows one investigation, and a filter
   * that silently followed the reader to the next incident would read as a
   * feed with missing events.
   */
  storageKey?: string | undefined;
  /*
   * The resource whose feed this is (the incident id, the cluster id, ...).
   * The dashboard moves between resources without remounting the feed, and
   * the event type filter belongs to the resource it was chosen on, so a new
   * resource starts unfiltered. The sort order is a preference and stays.
   */
  resetKey?: string | undefined;
}

export interface UseFeedOptionsResult {
  options: FeedOptions;
  // Pass to useFeedItems as viewKey: a change re-reads the feed.
  optionsKey: string;
  eventTypeOptions: Array<FeedEventTypeOption>;
  isFiltered: boolean;
  setOptions: (options: FeedOptions) => void;
}

const SORT_ORDER_STORAGE_KEY_PREFIX: string = "feed-sort-order:";

// One shared empty selection, so an unfiltered render keeps its identity.
const NO_EVENT_TYPES: Array<string> = [];

type GetSortOrderStorageKey = (storageKey: string) => string;

export const getSortOrderStorageKey: GetSortOrderStorageKey = (
  storageKey: string,
): string => {
  return `${SORT_ORDER_STORAGE_KEY_PREFIX}${storageKey}`;
};

type ReadStoredSortOrder = (storageKey: string | undefined) => SortOrder;

/*
 * Storage can be missing, blocked or hold anything, so every read falls back
 * to the default order.
 */
const readStoredSortOrder: ReadStoredSortOrder = (
  storageKey: string | undefined,
): SortOrder => {
  if (!storageKey) {
    return DEFAULT_FEED_SORT_ORDER;
  }

  try {
    const storedValue: unknown = LocalStorage.getItem(
      getSortOrderStorageKey(storageKey),
    );

    return isFeedSortOrder(storedValue) ? storedValue : DEFAULT_FEED_SORT_ORDER;
  } catch {
    return DEFAULT_FEED_SORT_ORDER;
  }
};

type WriteStoredSortOrder = (
  storageKey: string | undefined,
  sortOrder: SortOrder,
) => void;

const writeStoredSortOrder: WriteStoredSortOrder = (
  storageKey: string | undefined,
  sortOrder: SortOrder,
): void => {
  if (!storageKey) {
    return;
  }

  try {
    if (sortOrder === DEFAULT_FEED_SORT_ORDER) {
      LocalStorage.removeItem(getSortOrderStorageKey(storageKey));
    } else {
      LocalStorage.setItem(getSortOrderStorageKey(storageKey), sortOrder);
    }
  } catch {
    // A preference that cannot be saved still applies to this page.
  }
};

const useFeedOptions: (props: UseFeedOptionsProps) => UseFeedOptionsResult = (
  props: UseFeedOptionsProps,
): UseFeedOptionsResult => {
  /*
   * Callers pass Object.values(SomeEnum), a new array on every render, so the
   * list is keyed by its contents.
   */
  const eventTypesKey: string = props.eventTypes.join("\u0000");
  const knownEventTypes: Array<string> = useMemo(() => {
    return props.eventTypes;
  }, [eventTypesKey]);

  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    return readStoredSortOrder(props.storageKey);
  });
  /*
   * The selection remembers which resource it was made on. It is read through
   * that, during render rather than in an effect, so the first render for a
   * new resource is already unfiltered and never asks the API for the old
   * resource's filter. The stale selection is also dropped (React's "adjust
   * state when a prop changes" pattern), so going back to the first resource
   * does not bring its old filter back either.
   */
  const [selection, setSelection] = useState<{
    resetKey: string | undefined;
    eventTypes: Array<string>;
  }>(() => {
    return {
      resetKey: props.resetKey,
      eventTypes: [],
    };
  });
  const isSelectionForThisResource: boolean =
    selection.resetKey === props.resetKey;

  if (!isSelectionForThisResource) {
    setSelection({
      resetKey: props.resetKey,
      eventTypes: NO_EVENT_TYPES,
    });
  }

  const selectedEventTypes: Array<string> = isSelectionForThisResource
    ? selection.eventTypes
    : NO_EVENT_TYPES;

  const options: FeedOptions = useMemo(() => {
    return {
      sortOrder,
      eventTypes: sanitizeFeedEventTypes({
        selectedEventTypes,
        knownEventTypes,
      }),
    };
  }, [sortOrder, selectedEventTypes, knownEventTypes]);

  const eventTypeOptions: Array<FeedEventTypeOption> = useMemo(() => {
    return getFeedEventTypeOptions({
      eventTypes: knownEventTypes,
      getEventTypeLabel: props.getEventTypeLabel,
      getEventTypeIcon: props.getEventTypeIcon,
    });
  }, [knownEventTypes, props.getEventTypeLabel, props.getEventTypeIcon]);

  const setOptions: (nextOptions: FeedOptions) => void = useCallback(
    (nextOptions: FeedOptions): void => {
      const nextSortOrder: SortOrder = isFeedSortOrder(nextOptions.sortOrder)
        ? nextOptions.sortOrder
        : DEFAULT_FEED_SORT_ORDER;

      setSortOrder(nextSortOrder);
      setSelection({
        resetKey: props.resetKey,
        eventTypes: sanitizeFeedEventTypes({
          selectedEventTypes: nextOptions.eventTypes,
          knownEventTypes,
        }),
      });
    },
    [knownEventTypes, props.resetKey],
  );

  /*
   * The stored order follows the committed state, not each setOptions call:
   * two changes batched into one render would otherwise leave storage holding
   * the first while the page shows the second. The first run is the value
   * just read from storage, so there is nothing to write.
   */
  const hasCommittedSortOrderRef: MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (!hasCommittedSortOrderRef.current) {
      hasCommittedSortOrderRef.current = true;
      return;
    }

    writeStoredSortOrder(props.storageKey, sortOrder);
  }, [sortOrder]);

  return {
    options,
    optionsKey: getFeedOptionsKey(options),
    eventTypeOptions,
    isFiltered: isFeedFiltered(options),
    setOptions,
  };
};

export default useFeedOptions;
