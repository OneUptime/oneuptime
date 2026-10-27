import {
  DASHBOARD_AUTO_REFRESH_FALLBACK,
  getDashboardAutoRefreshInterval,
  parseDashboardAutoRefreshInterval,
} from "../../Types/Dashboard/DashboardAutoRefresh";
import {
  DASHBOARD_TIME_RANGE_FALLBACK,
  getDashboardTimeRange,
  parseDashboardTimeRange,
} from "../../Types/Dashboard/DashboardTimeRange";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardSetting,
  isDashboardDefaultSource,
} from "../../Types/Dashboard/DashboardViewerChoice";
import RangeStartAndEndDateTime from "../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../Types/Time/TimeRange";
import DashboardSettingsUrlState, {
  DashboardSettingsInUrl,
} from "../../Utils/Dashboard/DashboardSettingsUrlState";
import DashboardViewerPicks from "./DashboardViewerPicks";
import useDashboardTimeRangeZoom, {
  DashboardTimeRangeZoom,
} from "./UseDashboardTimeRangeZoom";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A dashboard's time range and auto-refresh as one viewer has them, shared
 * by both dashboard shells - the dashboard inside OneUptime (DashboardView)
 * and the public one (DashboardViewPage) - so the two open, remember and go
 * back the same way (issue #5080).
 *
 * Each setting is, from the first place that names it
 * (Types/Dashboard/DashboardViewerChoice.ts): the link the page was opened
 * with (?range=, ?refresh=), the viewer's own pick that their browser
 * remembers for the dashboard (DashboardViewerPicks), the dashboard's
 * default saved with it, else the past hour and no auto-refresh.
 *
 *   - The link's and the remembered pick are read as the page opens, so
 *     the board's first range is already the viewer's own; the dashboard's
 *     defaults follow with its config (applySavedDefaults).
 *   - A preset the viewer picks is remembered and written into the address
 *     bar, so a refresh keeps it and a copied link opens on it. A custom
 *     range, or a window a drag zoomed into, is shown but never kept: it
 *     would hold the dashboard on a moment in the past.
 *   - "Default (...)" forgets the pick and takes it out of the address: the
 *     dashboard's default decides again, now and whenever it changes.
 *   - An editor who saves a new default is moved onto it (followChanged-
 *     Defaults): they just said what the dashboard should open on.
 *
 * The board's window itself, with the undo that makes drag-to-zoom
 * reversible, is useDashboardTimeRangeZoom's, as it always was.
 */

export interface DashboardViewerSettings {
  // The board's window and its zoom.
  timeRangeZoom: DashboardTimeRangeZoom;
  /*
   * The dashboard's default time range - its own, else the past hour: what
   * the time range picker's "Default (...)" names.
   */
  defaultTimeRange: TimeRange;
  // Whether the viewer is on it, rather than on a link's range or their own.
  isOnDefaultTimeRange: boolean;
  // The auto-refresh the board runs with.
  autoRefreshInterval: AutoRefreshInterval;
  /*
   * The dashboard's default auto-refresh - its own, else off: what the
   * auto-refresh menu's "Default (...)" names.
   */
  defaultAutoRefreshInterval: AutoRefreshInterval;
  isOnDefaultAutoRefresh: boolean;
  /*
   * The dashboard's own defaults, from its config: as it loads, after its
   * changes are discarded, and after a save - with followChangedDefaults,
   * which moves the viewer onto a default that the save changed.
   */
  applySavedDefaults: (
    config: DashboardViewConfig | null | undefined,
    options?: { followChangedDefaults?: boolean | undefined } | undefined,
  ) => void;
  // A pick from the time range picker.
  pickTimeRange: (range: RangeStartAndEndDateTime) => void;
  // The time range picker's "Default (...)".
  pickDefaultTimeRange: () => void;
  // A pick from the auto-refresh menu.
  pickAutoRefreshInterval: (interval: AutoRefreshInterval) => void;
  // The auto-refresh menu's "Default (...)".
  pickDefaultAutoRefreshInterval: () => void;
}

interface SavedDefaults {
  timeRange: TimeRange | null;
  refreshInterval: AutoRefreshInterval | null;
}

interface ViewerChoices {
  // The viewer's own range or the link's; null while on the default.
  timeRange: TimeRange | null;
  refreshInterval: AutoRefreshInterval | null;
}

// A setting's value when a link or the viewer chose it, else null.
function getChoice<T>(setting: DashboardSetting<T>): T | null {
  return isDashboardDefaultSource(setting.source) ? null : setting.value;
}

// What the page's address and the viewer's browser say, as the page opens.
function readChoices(dashboardId: string): ViewerChoices {
  const fromLink: DashboardSettingsInUrl =
    DashboardSettingsUrlState.parseFromSearch(
      typeof window === "undefined" ? "" : window.location.search,
    );

  return {
    timeRange: getChoice(
      getDashboardTimeRange({
        linkTimeRange: fromLink.timeRange,
        viewerTimeRange: DashboardViewerPicks.getTimeRange(dashboardId),
      }),
    ),
    refreshInterval: getChoice(
      getDashboardAutoRefreshInterval({
        linkInterval: fromLink.refreshInterval,
        viewerInterval:
          DashboardViewerPicks.getAutoRefreshInterval(dashboardId),
      }),
    ),
  };
}

const NO_SAVED_DEFAULTS: SavedDefaults = {
  timeRange: null,
  refreshInterval: null,
};

// No choice of a link's or the viewer's: the dashboard's defaults decide.
const NO_CHOICES: ViewerChoices = {
  timeRange: null,
  refreshInterval: null,
};

const useDashboardViewerSettings: (data: {
  dashboardId: string;
  /*
   * A dashboard shown as its editors saved it, whoever looks at it: a
   * playlist's turn on a screen (issue #5235). The page's address and the
   * viewer's remembered picks are neither read nor written - the address
   * is the playlist's, and the dashboards it shows share it - so the board
   * opens on the dashboard's own default time range and auto-refresh.
   */
  savedDefaultsOnly?: boolean | undefined;
}) => DashboardViewerSettings = (data: {
  dashboardId: string;
  savedDefaultsOnly?: boolean | undefined;
}): DashboardViewerSettings => {
  const dashboardId: string = data.dashboardId;
  const savedDefaultsOnly: boolean = Boolean(data.savedDefaultsOnly);

  const [initialChoices] = useState<ViewerChoices>(() => {
    return savedDefaultsOnly ? NO_CHOICES : readChoices(dashboardId);
  });

  const [choices, setChoices] = useState<ViewerChoices>(initialChoices);
  const [savedDefaults, setSavedDefaults] =
    useState<SavedDefaults>(NO_SAVED_DEFAULTS);

  // The same, for the callbacks below, which stay the same for the page's life.
  const choicesRef: MutableRefObject<ViewerChoices> =
    useRef<ViewerChoices>(initialChoices);
  const savedDefaultsRef: MutableRefObject<SavedDefaults> =
    useRef<SavedDefaults>(NO_SAVED_DEFAULTS);

  /*
   * The default range the board was last put on while the viewer had no
   * range of their own, or null while it shows theirs. A config read again
   * with the same default (a discard) then leaves the board - and a zoom on
   * it - alone.
   */
  const appliedDefaultTimeRangeRef: MutableRefObject<TimeRange | null> =
    useRef<TimeRange | null>(
      initialChoices.timeRange === null ? DASHBOARD_TIME_RANGE_FALLBACK : null,
    );

  const timeRangeZoom: DashboardTimeRangeZoom = useDashboardTimeRangeZoom({
    range: initialChoices.timeRange || DASHBOARD_TIME_RANGE_FALLBACK,
  });

  const setStartAndEndDate: (range: RangeStartAndEndDateTime) => void =
    timeRangeZoom.setStartAndEndDate;

  const updateChoices: (next: ViewerChoices) => void = useCallback(
    (next: ViewerChoices): void => {
      choicesRef.current = next;
      setChoices(next);
    },
    [],
  );

  /*
   * The address carries the viewer's own choices from the start - their
   * remembered pick included - so a link copied straight away opens on what
   * they see; a parameter no choice came from (one it cannot read) goes.
   */
  useEffect(() => {
    if (savedDefaultsOnly) {
      return;
    }

    DashboardSettingsUrlState.writeToBrowserUrl({
      timeRange: initialChoices.timeRange,
      refreshInterval: initialChoices.refreshInterval,
    });
  }, []);

  /*
   * A pick, or its end, kept in the viewer's browser for this dashboard and
   * written into the address - never for a board on saved defaults only.
   */
  const rememberTimeRange: (timeRange: TimeRange | null) => void = useCallback(
    (timeRange: TimeRange | null): void => {
      if (savedDefaultsOnly) {
        return;
      }

      DashboardViewerPicks.setTimeRange(dashboardId, timeRange);
      DashboardSettingsUrlState.writeToBrowserUrl({ timeRange: timeRange });
    },
    [dashboardId, savedDefaultsOnly],
  );

  const rememberAutoRefreshInterval: (
    refreshInterval: AutoRefreshInterval | null,
  ) => void = useCallback(
    (refreshInterval: AutoRefreshInterval | null): void => {
      if (savedDefaultsOnly) {
        return;
      }

      DashboardViewerPicks.setAutoRefreshInterval(dashboardId, refreshInterval);
      DashboardSettingsUrlState.writeToBrowserUrl({
        refreshInterval: refreshInterval,
      });
    },
    [dashboardId, savedDefaultsOnly],
  );

  const putBoardOnDefaultTimeRange: () => void = useCallback((): void => {
    const defaultRange: TimeRange =
      savedDefaultsRef.current.timeRange || DASHBOARD_TIME_RANGE_FALLBACK;

    setStartAndEndDate({ range: defaultRange });
    appliedDefaultTimeRangeRef.current = defaultRange;
  }, [setStartAndEndDate]);

  const applySavedDefaults: DashboardViewerSettings["applySavedDefaults"] =
    useCallback(
      (
        config: DashboardViewConfig | null | undefined,
        options?: { followChangedDefaults?: boolean | undefined } | undefined,
      ): void => {
        const next: SavedDefaults = {
          timeRange: parseDashboardTimeRange(config?.timeRange),
          refreshInterval: parseDashboardAutoRefreshInterval(
            config?.refreshInterval,
          ),
        };
        const previous: SavedDefaults = savedDefaultsRef.current;
        const nextChoices: ViewerChoices = { ...choicesRef.current };
        let hasLeftTimeRangeChoice: boolean = false;

        /*
         * A default changed when what it opens on changed: naming the past
         * hour on a dashboard that named nothing is no change.
         */
        if (options?.followChangedDefaults) {
          if (
            (next.timeRange || DASHBOARD_TIME_RANGE_FALLBACK) !==
              (previous.timeRange || DASHBOARD_TIME_RANGE_FALLBACK) &&
            nextChoices.timeRange !== null
          ) {
            nextChoices.timeRange = null;
            hasLeftTimeRangeChoice = true;
            rememberTimeRange(null);
          }

          if (
            (next.refreshInterval || DASHBOARD_AUTO_REFRESH_FALLBACK) !==
              (previous.refreshInterval || DASHBOARD_AUTO_REFRESH_FALLBACK) &&
            nextChoices.refreshInterval !== null
          ) {
            nextChoices.refreshInterval = null;
            rememberAutoRefreshInterval(null);
          }
        }

        savedDefaultsRef.current = next;
        setSavedDefaults(next);
        updateChoices(nextChoices);

        if (nextChoices.timeRange === null) {
          const defaultRange: TimeRange =
            next.timeRange || DASHBOARD_TIME_RANGE_FALLBACK;

          if (
            hasLeftTimeRangeChoice ||
            appliedDefaultTimeRangeRef.current !== defaultRange
          ) {
            putBoardOnDefaultTimeRange();
          }
        }
      },
      [
        updateChoices,
        putBoardOnDefaultTimeRange,
        rememberTimeRange,
        rememberAutoRefreshInterval,
      ],
    );

  const pickTimeRange: (range: RangeStartAndEndDateTime) => void = useCallback(
    (range: RangeStartAndEndDateTime): void => {
      setStartAndEndDate(range);

      const preset: TimeRange | null = parseDashboardTimeRange(range.range);

      /*
       * A custom range is shown, never kept: the viewer's choice - and what
       * a refresh opens on - stays the last preset.
       */
      if (!preset) {
        return;
      }

      appliedDefaultTimeRangeRef.current = null;
      updateChoices({ ...choicesRef.current, timeRange: preset });
      rememberTimeRange(preset);
    },
    [setStartAndEndDate, updateChoices, rememberTimeRange],
  );

  const pickDefaultTimeRange: () => void = useCallback((): void => {
    updateChoices({ ...choicesRef.current, timeRange: null });
    rememberTimeRange(null);
    putBoardOnDefaultTimeRange();
  }, [updateChoices, putBoardOnDefaultTimeRange, rememberTimeRange]);

  const pickAutoRefreshInterval: (interval: AutoRefreshInterval) => void =
    useCallback(
      (interval: AutoRefreshInterval): void => {
        const picked: AutoRefreshInterval | null =
          parseDashboardAutoRefreshInterval(interval);

        if (!picked) {
          return;
        }

        updateChoices({ ...choicesRef.current, refreshInterval: picked });
        rememberAutoRefreshInterval(picked);
      },
      [updateChoices, rememberAutoRefreshInterval],
    );

  const pickDefaultAutoRefreshInterval: () => void = useCallback((): void => {
    updateChoices({ ...choicesRef.current, refreshInterval: null });
    rememberAutoRefreshInterval(null);
  }, [updateChoices, rememberAutoRefreshInterval]);

  const defaultAutoRefreshInterval: AutoRefreshInterval =
    savedDefaults.refreshInterval || DASHBOARD_AUTO_REFRESH_FALLBACK;

  return {
    timeRangeZoom,
    defaultTimeRange: savedDefaults.timeRange || DASHBOARD_TIME_RANGE_FALLBACK,
    isOnDefaultTimeRange: choices.timeRange === null,
    autoRefreshInterval: choices.refreshInterval || defaultAutoRefreshInterval,
    defaultAutoRefreshInterval,
    isOnDefaultAutoRefresh: choices.refreshInterval === null,
    applySavedDefaults,
    pickTimeRange,
    pickDefaultTimeRange,
    pickAutoRefreshInterval,
    pickDefaultAutoRefreshInterval,
  };
};

export default useDashboardViewerSettings;
