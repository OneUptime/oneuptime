import { fetchHomeOverview, HomeOverviewData } from "./HomeOverviewData";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import useLiveRefresh from "Common/UI/Utils/UseLiveRefresh";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
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
 * - It follows what it counts as it changes (#8963): an incident opened, an
 *   alert resolved, a monitor going offline, a maintenance event starting,
 *   an SLO at risk - anywhere in the project, by anyone - reads the batch
 *   again, quietly: what is on screen stays, the refresh button stays still,
 *   and a read that fails keeps it. At once for the first change, then at
 *   most once every LIVE_ROWS_MIN_INTERVAL_IN_MS however many follow
 *   (UseLiveRefresh), never while the tab is hidden, and only on the app's
 *   live connection. What each change says is only that a record changed:
 *   the batch is read again with the reader's own permissions.
 * - A Home tab left in the background is refreshed when it is looked at
 *   again, once what it shows is older than STALE_AFTER_MS, or at once when
 *   something it counts changed meanwhile - once either way. Nothing polls:
 *   a tab nobody reads makes no requests.
 */

export const HOME_OVERVIEW_STALE_AFTER_MS: number = 60 * 1000;

/*
 * The kinds of record the batch counts (HomeOverviewData): a change to any
 * of them can move a number, the headline or a row of Needs attention.
 */
export const HOME_OVERVIEW_LIVE_MODEL_TYPES: ReadonlyArray<{
  new (): BaseModel;
}> = [Incident, Alert, Monitor, ScheduledMaintenance, ServiceLevelObjective];

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

interface LoadOptions {
  isRefresh: boolean;
  /*
   * A read nobody asked for: Home following a change it heard. Quiet - the
   * refresh button does not turn - and one that fails keeps what is on
   * screen rather than saying it could not refresh; the next change, or
   * Refresh, reads again.
   */
  isBackground?: boolean | undefined;
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
  // The batch being read, for a read after a change to wait for.
  const readInFlight: MutableRefObject<Promise<HomeOverviewData> | null> =
    useRef<Promise<HomeOverviewData> | null>(null);
  // The project on show: a read for one that was left never starts.
  const shownProjectId: MutableRefObject<string | null> = useRef<string | null>(
    projectIdString,
  );
  shownProjectId.current = projectIdString;

  const load: (options: LoadOptions) => Promise<void> = useCallback(
    async (options: LoadOptions): Promise<void> => {
      if (!projectIdString || projectIdString !== shownProjectId.current) {
        return;
      }

      latestRequest.current += 1;
      const requestNumber: number = latestRequest.current;
      isLoadInFlight.current = true;

      const isBackground: boolean = Boolean(options.isBackground);

      /*
       * A refresh with nothing on screen yet - Try again after a failed
       * first load - is a load: the skeletons say something is happening.
       * A read nobody asked for says nothing at all.
       */
      if (!isBackground) {
        if (options.isRefresh && hasData.current) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
      }

      try {
        const reading: Promise<HomeOverviewData> = fetchHomeOverview(
          new ObjectID(projectIdString),
        );
        readInFlight.current = reading;

        const result: HomeOverviewData = await reading;

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

        /*
         * What is on screen was right a moment ago: a read nobody asked for
         * keeps it, and the next change reads again. With nothing on screen,
         * the failure is said, as a first load's is.
         */
        if (isBackground && hasData.current) {
          return;
        }

        setError(API.getFriendlyMessage(err));
      } finally {
        if (requestNumber === latestRequest.current) {
          isLoadInFlight.current = false;
          readInFlight.current = null;
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
      readInFlight.current = null;
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

  /*
   * A change to what the batch counts: read it again, quietly. A read
   * already out - the first load, Refresh - may have started before the
   * change, so it is waited for, never dropped, and the batch read after it.
   */
  const readAfterChange: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const reading: Promise<HomeOverviewData> | null = isLoadInFlight.current
        ? readInFlight.current
        : null;

      if (reading) {
        await reading.catch(() => {
          // That read's own failure is handled where it was made.
          return null;
        });
      }

      await load({ isRefresh: true, isBackground: true });
    }, [load]);

  /*
   * Heard before the stale check below (effects run in order), so a tab
   * that comes back with a change pending reads once: this read is in
   * flight by the time the stale check asks.
   */
  useLiveRefresh({
    modelTypes: HOME_OVERVIEW_LIVE_MODEL_TYPES,
    isEnabled: Boolean(projectIdString),
    getTenantId: (): ObjectID | null => {
      return projectIdString ? new ObjectID(projectIdString) : null;
    },
    refresh: readAfterChange,
  });

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
