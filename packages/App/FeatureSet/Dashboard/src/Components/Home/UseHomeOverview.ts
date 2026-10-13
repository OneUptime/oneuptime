import { fetchHomeOverview, HomeOverviewData } from "./HomeOverviewData";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Home's open-work numbers and rows, loaded once per project and kept fresh.
 *
 * - The first load shows skeletons; a refresh keeps what is on screen and
 *   only turns the refresh button's icon, so the page never flashes empty.
 * - A response that arrives after the project changed, or after a newer
 *   request went out, is dropped: it would show one project's incidents
 *   under another project's name.
 * - A Home tab left in the background is refreshed when it is looked at
 *   again, once what it shows is older than STALE_AFTER_MS. Nothing polls: a
 *   tab nobody reads makes no requests.
 */

export const HOME_OVERVIEW_STALE_AFTER_MS: number = 60 * 1000;

export interface UseHomeOverviewResult {
  data: HomeOverviewData | null;
  // The first load, before anything can be drawn.
  isLoading: boolean;
  // A refresh while the last result stays on screen.
  isRefreshing: boolean;
  // Why the last load failed, or "" when it did not.
  error: string;
  // When `data` was read.
  loadedAt: Date | null;
  refresh: () => void;
}

const useHomeOverview: (projectId: ObjectID | null) => UseHomeOverviewResult = (
  projectId: ObjectID | null,
): UseHomeOverviewResult => {
  const projectIdString: string | null = projectId
    ? projectId.toString()
    : null;

  const [data, setData] = useState<HomeOverviewData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(projectId));
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  // Every load takes a number; only the latest one may write its result.
  const latestRequest: MutableRefObject<number> = useRef<number>(0);
  const loadedAtRef: MutableRefObject<Date | null> = useRef<Date | null>(null);
  const isLoadInFlight: MutableRefObject<boolean> = useRef<boolean>(false);
  const hasData: MutableRefObject<boolean> = useRef<boolean>(false);

  const load: (options: { isRefresh: boolean }) => Promise<void> = useCallback(
    async (options: { isRefresh: boolean }): Promise<void> => {
      if (!projectIdString) {
        return;
      }

      latestRequest.current += 1;
      const requestNumber: number = latestRequest.current;
      isLoadInFlight.current = true;

      /*
       * A refresh with nothing on screen yet - Try again after a failed
       * first load - is a load: the skeletons say something is happening.
       */
      if (options.isRefresh && hasData.current) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result: HomeOverviewData = await fetchHomeOverview(
          new ObjectID(projectIdString),
        );

        if (requestNumber !== latestRequest.current) {
          return;
        }

        const now: Date = new Date();
        loadedAtRef.current = now;
        hasData.current = true;
        setData(result);
        setLoadedAt(now);
        setError("");
      } catch (err) {
        if (requestNumber !== latestRequest.current) {
          return;
        }

        setError(API.getFriendlyMessage(err));
      } finally {
        if (requestNumber === latestRequest.current) {
          isLoadInFlight.current = false;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [projectIdString],
  );

  useEffect(() => {
    // A new project: nothing of the last one may stay on screen.
    setData(null);
    hasData.current = false;
    setLoadedAt(null);
    loadedAtRef.current = null;
    setError("");
    setIsRefreshing(false);

    if (!projectIdString) {
      // Drop anything still in flight for the project that was left.
      latestRequest.current += 1;
      isLoadInFlight.current = false;
      setIsLoading(false);
      return;
    }

    load({ isRefresh: false }).catch(() => {
      // handled in load.
    });
    /*
     * Keyed on the id's string VALUE, not the ObjectID instance: a caller
     * that builds the id again on every render must not re-fire the batch.
     */
  }, [projectIdString]);

  useEffect(() => {
    if (!projectIdString || typeof document === "undefined") {
      return;
    }

    const onVisibilityChange: () => void = (): void => {
      if (document.visibilityState !== "visible" || isLoadInFlight.current) {
        return;
      }

      const lastLoadedAt: Date | null = loadedAtRef.current;

      if (
        lastLoadedAt &&
        Date.now() - lastLoadedAt.getTime() >= HOME_OVERVIEW_STALE_AFTER_MS
      ) {
        load({ isRefresh: true }).catch(() => {
          // handled in load.
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [projectIdString, load]);

  const refresh: () => void = useCallback((): void => {
    load({ isRefresh: true }).catch(() => {
      // handled in load.
    });
  }, [load]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    loadedAt,
    refresh,
  };
};

export default useHomeOverview;
