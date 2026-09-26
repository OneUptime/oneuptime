import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  TOPOLOGY_OUTDATED_MESSAGE,
  TopologyOutdatedError,
  TopologyRequestOptions,
  fetchInfrastructureData,
  fetchServiceMapData,
} from "./TopologyApi";
import { InfrastructureData, ServiceMapData } from "./TopologyData";

/*
 * Loads what the Topology page's telemetry tabs draw.
 *
 * Each tab has its own endpoint and its own payload (see TopologyApi), so
 * each tab loads on its own, the first time it is opened — a reader who only
 * looks at the Service Map never pays for Infrastructure. Switching tabs
 * never refetches or cancels anything: a tab that is loading keeps loading,
 * a tab that is ready stays ready.
 *
 * Both tabs are pinned to ONE range start per "generation", so the two maps
 * always judge activity against the same moment. A time-range change, a
 * project change or reload() starts a new generation: the range is re-pinned,
 * requests in flight are aborted, both tabs are dropped and only the active
 * tab loads again. A response from an older generation (or an older attempt
 * of the same tab) is ignored, so it can never overwrite a newer one.
 *
 * Network discovery has its own live data source and never loads anything
 * here.
 */

export type TopologyView = "Service Map" | "Infrastructure" | "Network";

export type TopologyTabStatus = "idle" | "loading" | "ready" | "error";

export interface TopologyLoadError {
  message: string;
  /* The server speaks another Topology API: only a page reload can help. */
  isOutdated: boolean;
}

export interface TopologyTabState<TData> {
  status: TopologyTabStatus;
  data: TData | null;
  error: TopologyLoadError | null;
  loadedAt: Date | null;
}

export interface TopologyDataState {
  generation: number;
  /*
   * The range start both tabs request. Views must NOT judge activity against
   * it: they use `data.rangeStart`, the server's floored echo of it.
   */
  pinnedRangeStart: Date | null;
  pinnedAt: Date | null;
  serviceMap: TopologyTabState<ServiceMapData>;
  infrastructure: TopologyTabState<InfrastructureData>;
}

export interface TopologyData extends TopologyDataState {
  /* Start a new generation and load the active tab. */
  reload: () => void;
  /* Load one tab again (after an error), leaving the other tab alone. */
  retry: (view: TopologyView) => void;
}

/*
 * A relative range ("past hour") pinned longer ago than this has drifted:
 * opening another tab against it would draw that tab for a window that ended
 * minutes ago. Such a lazy load starts a new generation instead, so both tabs
 * are re-pinned to the same, current range start.
 */
export const TOPOLOGY_RANGE_REPIN_AFTER_MS: number = 5 * 60 * 1000;

export const NO_PROJECT_MESSAGE: string = "Select a project to view topology.";

type TabKey = "serviceMap" | "infrastructure";

interface TabDataByKey {
  serviceMap: ServiceMapData;
  infrastructure: InfrastructureData;
}

const TAB_KEYS: ReadonlyArray<TabKey> = ["serviceMap", "infrastructure"];

const FETCHERS: {
  [Key in TabKey]: (
    rangeStart: Date,
    options: TopologyRequestOptions,
  ) => Promise<TabDataByKey[Key]>;
} = {
  serviceMap: fetchServiceMapData,
  infrastructure: fetchInfrastructureData,
};

function tabKeyForView(view: TopologyView): TabKey | null {
  if (view === "Service Map") {
    return "serviceMap";
  }
  if (view === "Infrastructure") {
    return "infrastructure";
  }
  return null;
}

function idleTab<TData>(): TopologyTabState<TData> {
  return { status: "idle", data: null, error: null, loadedAt: null };
}

function withTab<Key extends TabKey>(
  state: TopologyDataState,
  key: Key,
  tab: TopologyTabState<TabDataByKey[Key]>,
): TopologyDataState {
  if (key === "serviceMap") {
    return {
      ...state,
      serviceMap: tab as TopologyTabState<ServiceMapData>,
    };
  }
  return {
    ...state,
    infrastructure: tab as TopologyTabState<InfrastructureData>,
  };
}

function toLoadError(error: unknown): TopologyLoadError {
  if (error instanceof TopologyOutdatedError) {
    return { message: TOPOLOGY_OUTDATED_MESSAGE, isOutdated: true };
  }
  return { message: API.getFriendlyMessage(error), isOutdated: false };
}

const INITIAL_STATE: TopologyDataState = {
  generation: 0,
  pinnedRangeStart: null,
  pinnedAt: null,
  serviceMap: idleTab<ServiceMapData>(),
  infrastructure: idleTab<InfrastructureData>(),
};

interface LatestInputs {
  timeRange: RangeStartAndEndDateTime;
  projectId: string | undefined;
  activeView: TopologyView;
}

export default function useTopologyData(
  timeRange: RangeStartAndEndDateTime,
  activeView: TopologyView,
): TopologyData {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  const [state, setState] = useState<TopologyDataState>(INITIAL_STATE);

  /*
   * The authoritative copy of `state`. Decisions ("is this tab still idle?",
   * "is this response still wanted?") are made against it rather than a
   * render's snapshot, because two effects and a late response can all act
   * between one render and the next.
   */
  const storeRef: MutableRefObject<TopologyDataState> =
    useRef<TopologyDataState>(INITIAL_STATE);
  const controllersRef: MutableRefObject<
    Record<TabKey, AbortController | null>
  > = useRef<Record<TabKey, AbortController | null>>({
    serviceMap: null,
    infrastructure: null,
  });
  /* The attempt each tab currently wants an answer for. */
  const attemptsRef: MutableRefObject<Record<TabKey, number>> = useRef<
    Record<TabKey, number>
  >({ serviceMap: 0, infrastructure: 0 });
  const attemptCounterRef: MutableRefObject<number> = useRef<number>(0);
  const latestRef: MutableRefObject<LatestInputs> = useRef<LatestInputs>({
    timeRange,
    projectId,
    activeView,
  });
  latestRef.current = { timeRange, projectId, activeView };

  const commit: (
    update: (previous: TopologyDataState) => TopologyDataState,
  ) => void = useCallback(
    (update: (previous: TopologyDataState) => TopologyDataState): void => {
      storeRef.current = update(storeRef.current);
      setState(storeRef.current);
    },
    [],
  );

  const abortAll: () => void = useCallback((): void => {
    for (const key of TAB_KEYS) {
      controllersRef.current[key]?.abort();
      controllersRef.current[key] = null;
      attemptsRef.current[key] = 0;
    }
  }, []);

  const loadTab: (key: TabKey) => void = useCallback(
    (key: TabKey): void => {
      const current: TopologyDataState = storeRef.current;
      const requestProjectId: string | undefined = latestRef.current.projectId;
      const rangeStart: Date | null = current.pinnedRangeStart;

      controllersRef.current[key]?.abort();
      controllersRef.current[key] = null;

      if (!requestProjectId || !rangeStart) {
        attemptsRef.current[key] = 0;
        commit((previous: TopologyDataState): TopologyDataState => {
          return withTab(previous, key, {
            status: "error",
            data: null,
            error: { message: NO_PROJECT_MESSAGE, isOutdated: false },
            loadedAt: null,
          });
        });
        return;
      }

      const generation: number = current.generation;
      attemptCounterRef.current += 1;
      const attempt: number = attemptCounterRef.current;
      attemptsRef.current[key] = attempt;
      const controller: AbortController = new AbortController();
      controllersRef.current[key] = controller;

      const isWanted: () => boolean = (): boolean => {
        return (
          storeRef.current.generation === generation &&
          attemptsRef.current[key] === attempt &&
          latestRef.current.projectId === requestProjectId &&
          !controller.signal.aborted
        );
      };

      commit((previous: TopologyDataState): TopologyDataState => {
        return withTab(previous, key, {
          status: "loading",
          data: null,
          error: null,
          loadedAt: null,
        });
      });

      const request: Promise<ServiceMapData | InfrastructureData> = FETCHERS[
        key
      ](rangeStart, { signal: controller.signal });
      request.then(
        (data: ServiceMapData | InfrastructureData): void => {
          if (!isWanted()) {
            return;
          }
          controllersRef.current[key] = null;
          commit((previous: TopologyDataState): TopologyDataState => {
            return withTab(previous, key, {
              status: "ready",
              data: data,
              error: null,
              loadedAt: data.loadedAt,
            });
          });
        },
        (error: unknown): void => {
          if (!isWanted()) {
            return;
          }
          controllersRef.current[key] = null;
          commit((previous: TopologyDataState): TopologyDataState => {
            return withTab(previous, key, {
              status: "error",
              data: null,
              error: toLoadError(error),
              loadedAt: null,
            });
          });
        },
      );
    },
    [commit],
  );

  /*
   * A new generation: re-pin the range, forget both tabs and load `view`
   * (the active tab) — or nothing, when it is the Network tab.
   */
  const restart: (view: TopologyView) => void = useCallback(
    (view: TopologyView): void => {
      abortAll();
      const now: Date = new Date();
      const rangeStart: Date = RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        latestRef.current.timeRange,
      ).startValue;
      commit((previous: TopologyDataState): TopologyDataState => {
        return {
          generation: previous.generation + 1,
          pinnedRangeStart: rangeStart,
          pinnedAt: now,
          serviceMap: idleTab<ServiceMapData>(),
          infrastructure: idleTab<InfrastructureData>(),
        };
      });
      const key: TabKey | null = tabKeyForView(view);
      if (key) {
        loadTab(key);
      }
    },
    [abortAll, commit, loadTab],
  );

  const hasPinnedRangeDrifted: () => boolean = useCallback((): boolean => {
    const pinnedAt: Date | null = storeRef.current.pinnedAt;
    if (!pinnedAt || !storeRef.current.pinnedRangeStart) {
      return true;
    }
    if (latestRef.current.timeRange.range === TimeRange.CUSTOM) {
      return false;
    }
    return Date.now() - pinnedAt.getTime() > TOPOLOGY_RANGE_REPIN_AFTER_MS;
  }, []);

  /*
   * Loads a tab that has nothing to show yet — against the pinned range,
   * unless that range has drifted, in which case the load starts a new
   * generation so both tabs keep describing the same window.
   */
  const loadFresh: (view: TopologyView) => void = useCallback(
    (view: TopologyView): void => {
      const key: TabKey | null = tabKeyForView(view);
      if (!key) {
        return;
      }
      if (hasPinnedRangeDrifted()) {
        restart(view);
        return;
      }
      loadTab(key);
    },
    [hasPinnedRangeDrifted, loadTab, restart],
  );

  /* A new range or project is a new generation. */
  useEffect(() => {
    restart(latestRef.current.activeView);
  }, [timeRange, projectId, restart]);

  /* The first activation of a tab loads it; later ones change nothing. */
  useEffect(() => {
    const key: TabKey | null = tabKeyForView(activeView);
    if (key && storeRef.current[key].status === "idle") {
      loadFresh(activeView);
    }
  }, [activeView, loadFresh]);

  /* Nothing may land after unmount. */
  useEffect(() => {
    return (): void => {
      abortAll();
    };
  }, [abortAll]);

  const reload: () => void = useCallback((): void => {
    restart(latestRef.current.activeView);
  }, [restart]);

  const retry: (view: TopologyView) => void = useCallback(
    (view: TopologyView): void => {
      loadFresh(view);
    },
    [loadFresh],
  );

  return { ...state, reload, retry };
}
