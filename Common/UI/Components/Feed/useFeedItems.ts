import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../../Types/Database/LimitMax";
import {
  PromiseVoidFunction,
  VoidFunction,
} from "../../../Types/FunctionTypes";
import API from "../../Utils/API/API";
import { FeedItemProps } from "./FeedItem";

export interface FeedPage<TFeedModel> {
  data: Array<TFeedModel>;
  count: number;
}

export interface UseFeedItemsProps<TFeedModel> {
  resourceKey: string;
  refreshToken?: number | undefined;
  getItems: (limit: number) => Promise<FeedPage<TFeedModel>>;
  mapItems: (items: Array<TFeedModel>) => Array<FeedItemProps>;
}

export interface UseFeedItemsResult {
  feedItems: Array<FeedItemProps>;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | undefined;
  loadMoreError: string | undefined;
  hasMore: boolean;
  isCurrentFeedLoaded: boolean;
  setError: Dispatch<SetStateAction<string | undefined>>;
  refresh: PromiseVoidFunction;
  loadMore: VoidFunction;
}

interface FetchOptions {
  limit: number;
  isLoadingMore: boolean;
}

/*
 * Every dashboard activity feed follows the same paging contract: read the
 * newest top N rows and replace that window when the reader asks for more.
 * Re-reading from zero matters for a live feed. Offset-appending can duplicate
 * or skip a row when a new event arrives between page requests.
 */
const useFeedItems: <TFeedModel>(
  props: UseFeedItemsProps<TFeedModel>,
) => UseFeedItemsResult = <TFeedModel>(
  props: UseFeedItemsProps<TFeedModel>,
): UseFeedItemsResult => {
  const [feedItems, setFeedItems] = useState<Array<FeedItemProps>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadMoreError, setLoadMoreError] = useState<string | undefined>(
    undefined,
  );
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadedResourceKey, setLoadedResourceKey] = useState<string | null>(
    null,
  );

  const activeResourceKeyRef: MutableRefObject<string> = useRef<string>(
    props.resourceKey,
  );
  activeResourceKeyRef.current = props.resourceKey;
  const previousResourceKeyRef: MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const currentLimitRef: MutableRefObject<number> =
    useRef<number>(DEFAULT_LIMIT);
  const fetchGenerationRef: MutableRefObject<number> = useRef<number>(0);
  const isLoadingMoreRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const getItemsRef: MutableRefObject<
    UseFeedItemsProps<TFeedModel>["getItems"]
  > = useRef<UseFeedItemsProps<TFeedModel>["getItems"]>(props.getItems);
  getItemsRef.current = props.getItems;
  const mapItemsRef: MutableRefObject<
    UseFeedItemsProps<TFeedModel>["mapItems"]
  > = useRef<UseFeedItemsProps<TFeedModel>["mapItems"]>(props.mapItems);
  mapItemsRef.current = props.mapItems;

  const fetchItems: (options: FetchOptions) => Promise<void> = useCallback(
    async (options: FetchOptions): Promise<void> => {
      const generation: number = fetchGenerationRef.current + 1;
      fetchGenerationRef.current = generation;
      const requestedResourceKey: string = activeResourceKeyRef.current;
      const getItems: UseFeedItemsProps<TFeedModel>["getItems"] =
        getItemsRef.current;
      const mapItems: UseFeedItemsProps<TFeedModel>["mapItems"] =
        mapItemsRef.current;
      const isLatestRequest: () => boolean = (): boolean => {
        return (
          generation === fetchGenerationRef.current &&
          requestedResourceKey === activeResourceKeyRef.current
        );
      };

      setLoadMoreError(undefined);
      if (options.isLoadingMore) {
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
      } else {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
        setError(undefined);
        setIsLoading(true);
      }

      try {
        const page: FeedPage<TFeedModel> = await getItems(options.limit);

        if (!isLatestRequest()) {
          return;
        }

        setFeedItems(mapItems(page.data));
        currentLimitRef.current = options.limit;
        setHasMore(
          page.data.length < page.count && options.limit < LIMIT_PER_PROJECT,
        );
        setLoadedResourceKey(requestedResourceKey);
      } catch (err: unknown) {
        if (!isLatestRequest()) {
          return;
        }

        if (options.isLoadingMore) {
          setLoadMoreError(API.getFriendlyMessage(err));
        } else {
          setError(API.getFriendlyMessage(err));
          setLoadedResourceKey(requestedResourceKey);
        }
      } finally {
        if (isLatestRequest()) {
          if (options.isLoadingMore) {
            isLoadingMoreRef.current = false;
            setIsLoadingMore(false);
          } else {
            setIsLoading(false);
          }
        }
      }
    },
    [],
  );

  const refresh: PromiseVoidFunction = useCallback(async (): Promise<void> => {
    await fetchItems({
      limit: currentLimitRef.current,
      isLoadingMore: false,
    });
  }, [fetchItems]);

  const loadMore: VoidFunction = useCallback((): void => {
    if (
      isLoadingMoreRef.current ||
      currentLimitRef.current >= LIMIT_PER_PROJECT
    ) {
      return;
    }

    fetchItems({
      limit: Math.min(
        currentLimitRef.current + DEFAULT_LIMIT,
        LIMIT_PER_PROJECT,
      ),
      isLoadingMore: true,
    }).catch(() => {
      // fetchItems converts request failures into the load-more error state.
    });
  }, [fetchItems]);

  useEffect(() => {
    const hasResourceChanged: boolean =
      previousResourceKeyRef.current !== props.resourceKey;
    previousResourceKeyRef.current = props.resourceKey;

    if (hasResourceChanged) {
      currentLimitRef.current = DEFAULT_LIMIT;
      setFeedItems([]);
      setHasMore(false);
      setLoadedResourceKey(null);
    }

    fetchItems({
      limit: hasResourceChanged ? DEFAULT_LIMIT : currentLimitRef.current,
      isLoadingMore: false,
    }).catch(() => {
      // fetchItems converts request failures into the appropriate UI state.
    });
  }, [fetchItems, props.resourceKey, props.refreshToken]);

  useEffect(() => {
    return () => {
      fetchGenerationRef.current += 1;
    };
  }, []);

  const isCurrentFeedLoaded: boolean = loadedResourceKey === props.resourceKey;

  return {
    feedItems,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError: isCurrentFeedLoaded ? loadMoreError : undefined,
    hasMore,
    isCurrentFeedLoaded,
    setError,
    refresh,
    loadMore,
  };
};

export default useFeedItems;
