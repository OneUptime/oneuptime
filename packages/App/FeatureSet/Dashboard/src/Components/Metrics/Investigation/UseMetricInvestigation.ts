import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import Navigation from "Common/UI/Utils/Navigation";
import MetricInvestigationTime, {
  DEFAULT_RELATIVE_RANGE,
  MetricInvestigationCustomTime,
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
} from "./MetricInvestigationTime";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
} from "./MetricInvestigationQueries";
import MetricInvestigationUrl, {
  MetricInvestigationUrlState,
} from "./MetricInvestigationUrl";

/*
 * The state of a metric investigation (issue #5954): which time range it
 * charts, which metrics, and the zoom a reader dragged out on a chart.
 *
 * Held by the page, above whatever shows it, so it outlives a switch to
 * another tab and back, and the page can hand its window to everything else
 * that should follow it (the telemetry card's Logs, Traces and Exceptions
 * tabs). MetricInvestigation draws it; MetricInvestigationTimePicker picks
 * its time range from anywhere on the page.
 *
 * Until the reader changes something, it follows the page's defaults - the
 * page may work them out again on every render - and Reset goes back to
 * them. What the reader changed is all it remembers, in the page's URL when
 * the page asks for that (see MetricInvestigationUrl).
 */

export interface UseMetricInvestigationOptions {
  // The metrics it starts from, and Reset goes back to.
  defaultQueries: MetricInvestigationQueries;
  /*
   * Time ranges anchored on what the page is about ("Around the start" of
   * an incident), worked out for the moment the investigation last resolved
   * its window. Left out, it offers ranges relative to now only. Mount the
   * investigation once the page knows them: a link to one of them is read
   * when it mounts.
   */
  getPresets?:
    | ((now: Date) => Array<MetricInvestigationTimePreset>)
    | undefined;
  // The pick it starts from; else the first preset, else the past hour.
  defaultSelection?: MetricInvestigationTimeSelection | undefined;
  /*
   * Keep what the reader changed in the page's URL, under names that start
   * with this. Left out, it is kept in memory only.
   */
  urlParamPrefix?: string | undefined;
}

export interface MetricInvestigationState {
  presets: Array<MetricInvestigationTimePreset>;
  // The pick on screen: the reader's, a zoom, or the default.
  selection: MetricInvestigationTimeSelection;
  // What the pick on screen shows. Keeps its identity while its value stays.
  window: InBetween<Date>;
  // The pick as the time picker's value.
  pickerValue: RangeStartAndEndDateTime;
  queries: MetricInvestigationQueries;
  /*
   * The page's metrics, which Reset goes back to: what lines drawn for the
   * page's own metrics (a monitor's thresholds) are drawn on.
   */
  defaultQueries: MetricInvestigationQueries;
  // The window and the queries, for MetricView and the explorer link.
  metricViewData: MetricViewData;
  // Bumped by Refresh, so the charts read again past their cache.
  refreshNonce: number;
  // Whether the reader moved off the default time range (a zoom included).
  isTimeChanged: boolean;
  // Whether the reader changed the metrics.
  isQueriesChanged: boolean;
  isZoomed: boolean;
  /*
   * For a TimeRangeZoomProvider around the charts and the Reset zoom
   * buttons: a drag zooms the investigation, a double-click or Reset zoom
   * goes back to the pick from before.
   */
  zoom: TimeRangeZoom;
  /*
   * The page's address with the investigation in it, for a "Copy link"
   * that opens the same charts; null when it is not kept in the URL.
   */
  shareUrl: string | null;
  selectPreset: (presetId: string) => void;
  // A pick in the time picker's own list: a relative range, or a custom one.
  selectPickerValue: (value: RangeStartAndEndDateTime) => void;
  setQueries: (queries: MetricInvestigationQueries) => void;
  refresh: () => void;
  // Back to the default time range and metrics.
  reset: () => void;
}

interface InvestigationZoom {
  // The pick the reader zoomed from; null for the default.
  before: MetricInvestigationTimeSelection | null;
  window: InBetween<Date>;
}

interface InvestigationState {
  // The reader's pick; null while it is the default.
  selection: MetricInvestigationTimeSelection | null;
  // The reader's metrics; null while they are the default.
  queries: MetricInvestigationQueries | null;
  zoom: InvestigationZoom | null;
  // When the windows were last worked out: at first, on a pick, on Refresh.
  resolvedAtMs: number;
  refreshNonce: number;
}

interface LatestInputs {
  presets: Array<MetricInvestigationTimePreset>;
  defaultSelection: MetricInvestigationTimeSelection;
  defaultQueries: MetricInvestigationQueries;
  window: InBetween<Date>;
}

type IsZoomedFunction = (state: InvestigationState) => boolean;

// Zoomed while the pick on screen is still the window the zoom made.
const isStateZoomed: IsZoomedFunction = (
  state: InvestigationState,
): boolean => {
  return Boolean(
    state.zoom &&
      state.selection &&
      state.selection.kind === MetricInvestigationTimeKind.Custom &&
      MetricInvestigationTime.isSameWindow(
        state.selection.window,
        state.zoom.window,
      ),
  );
};

type SelectionKeyFunction = (
  selection: MetricInvestigationTimeSelection | null,
) => string;

const getSelectionKey: SelectionKeyFunction = (
  selection: MetricInvestigationTimeSelection | null,
): string => {
  return selection
    ? JSON.stringify(MetricInvestigationTime.toUrlValue(selection))
    : "";
};

type ReadUrlParamFunction = (name: string) => string | null;

const readUrlParam: ReadUrlParamFunction = (name: string): string | null => {
  return Navigation.getQueryStringByName(name);
};

type GetCurrentHrefFunction = () => string;

const getCurrentHref: GetCurrentHrefFunction = (): string => {
  return typeof globalThis.location !== "undefined"
    ? globalThis.location.href
    : "";
};

const useMetricInvestigation: (
  options: UseMetricInvestigationOptions,
) => MetricInvestigationState = (
  options: UseMetricInvestigationOptions,
): MetricInvestigationState => {
  const urlParamPrefix: string | undefined = options.urlParamPrefix;

  const [state, setState] = useState<InvestigationState>(
    (): InvestigationState => {
      const nowMs: number = OneUptimeDate.getCurrentDate().getTime();
      const initial: InvestigationState = {
        selection: null,
        queries: null,
        zoom: null,
        resolvedAtMs: nowMs,
        refreshNonce: 0,
      };

      if (!urlParamPrefix) {
        return initial;
      }

      const presets: Array<MetricInvestigationTimePreset> =
        options.getPresets?.(new Date(nowMs)) || [];
      const fromUrl: MetricInvestigationUrlState =
        MetricInvestigationUrl.readState({
          prefix: urlParamPrefix,
          read: readUrlParam,
          presets: presets,
        });
      const defaultSelection: MetricInvestigationTimeSelection =
        MetricInvestigationTime.getDefaultSelection({
          presets: presets,
          preferred: options.defaultSelection,
        });

      return {
        ...initial,
        selection:
          fromUrl.selection &&
          !MetricInvestigationTime.isSameSelection(
            fromUrl.selection,
            defaultSelection,
          )
            ? fromUrl.selection
            : null,
        queries:
          fromUrl.queries &&
          !MetricInvestigationQueryUtil.isSame(
            fromUrl.queries,
            options.defaultQueries,
          )
            ? fromUrl.queries
            : null,
      };
    },
  );

  const now: Date = useMemo((): Date => {
    return new Date(state.resolvedAtMs);
  }, [state.resolvedAtMs]);

  const presets: Array<MetricInvestigationTimePreset> = options.getPresets
    ? options.getPresets(now)
    : [];

  const defaultSelection: MetricInvestigationTimeSelection =
    MetricInvestigationTime.getDefaultSelection({
      presets: presets,
      preferred: options.defaultSelection,
    });

  /*
   * The reader's pick while the page can still show it; the default
   * otherwise (a preset the page stopped offering).
   */
  const selection: MetricInvestigationTimeSelection =
    state.selection &&
    MetricInvestigationTime.isUsableSelection(state.selection, presets)
      ? state.selection
      : defaultSelection;

  const resolvedWindow: InBetween<Date> =
    MetricInvestigationTime.resolveWindow({
      selection: selection,
      presets: presets,
      now: now,
    }) ||
    MetricInvestigationTime.resolveRelativeWindow(
      DEFAULT_RELATIVE_RANGE,
      now,
    ) ||
    new InBetween<Date>(
      OneUptimeDate.addRemoveHours(now, -1),
      new Date(now.getTime()),
    );

  const windowStartMs: number = resolvedWindow.startValue.getTime();
  const windowEndMs: number = resolvedWindow.endValue.getTime();

  const shownWindow: InBetween<Date> = useMemo((): InBetween<Date> => {
    return new InBetween<Date>(new Date(windowStartMs), new Date(windowEndMs));
  }, [windowStartMs, windowEndMs]);

  const selectionKey: string = getSelectionKey(selection);

  const pickerValue: RangeStartAndEndDateTime =
    useMemo((): RangeStartAndEndDateTime => {
      return MetricInvestigationTime.toPickerValue(selection, shownWindow);
    }, [selectionKey, shownWindow]);

  /*
   * The page's metrics, kept by value: a page that reads an equal copy
   * again (a background refresh of the incident) has not changed them.
   */
  const latestDefaultQueries: MetricInvestigationQueries =
    MetricInvestigationQueryUtil.normalize(options.defaultQueries);
  const defaultQueriesKey: string =
    MetricInvestigationQueryUtil.getKey(latestDefaultQueries);
  const defaultQueries: MetricInvestigationQueries =
    useMemo((): MetricInvestigationQueries => {
      return latestDefaultQueries;
    }, [defaultQueriesKey]);

  const queries: MetricInvestigationQueries = state.queries || defaultQueries;

  const isQueriesChanged: boolean = useMemo((): boolean => {
    return (
      state.queries !== null &&
      !MetricInvestigationQueryUtil.isSame(state.queries, defaultQueries)
    );
  }, [state.queries, defaultQueries]);

  const isTimeChanged: boolean =
    state.selection !== null &&
    !MetricInvestigationTime.isSameSelection(selection, defaultSelection);

  const isZoomed: boolean = isStateZoomed(state);

  const metricViewData: MetricViewData = useMemo((): MetricViewData => {
    return {
      startAndEndDate: shownWindow,
      queryConfigs: queries.queryConfigs,
      formulaConfigs: queries.formulaConfigs,
      /*
       * A relative pick keeps rolling in the explorer an "Open in Metric
       * Explorer" leads to; every other pick is the window itself.
       */
      ...(selection.kind === MetricInvestigationTimeKind.Relative
        ? { rangeToken: selection.range }
        : {}),
    };
  }, [shownWindow, queries, selectionKey]);

  /*
   * The callbacks below keep their identity for the life of the page (the
   * charts they go to are memoized), so they read the latest inputs here.
   */
  const latest: React.MutableRefObject<LatestInputs> = useRef<LatestInputs>({
    presets: presets,
    defaultSelection: defaultSelection,
    defaultQueries: defaultQueries,
    window: shownWindow,
  });
  latest.current = {
    presets: presets,
    defaultSelection: defaultSelection,
    defaultQueries: defaultQueries,
    window: shownWindow,
  };

  type NormalizeSelectionFunction = (
    picked: MetricInvestigationTimeSelection,
  ) => MetricInvestigationTimeSelection | null;

  // A pick of the default is no change: the URL stays clean.
  const normalizeSelection: NormalizeSelectionFunction = useCallback(
    (
      picked: MetricInvestigationTimeSelection,
    ): MetricInvestigationTimeSelection | null => {
      return MetricInvestigationTime.isSameSelection(
        picked,
        latest.current.defaultSelection,
      )
        ? null
        : picked;
    },
    [],
  );

  const selectPreset: (presetId: string) => void = useCallback(
    (presetId: string): void => {
      if (
        !MetricInvestigationTime.findPreset(latest.current.presets, presetId)
      ) {
        return;
      }

      setState((current: InvestigationState): InvestigationState => {
        return {
          ...current,
          selection: normalizeSelection({
            kind: MetricInvestigationTimeKind.Preset,
            presetId: presetId,
          }),
          zoom: null,
          resolvedAtMs: OneUptimeDate.getCurrentDate().getTime(),
        };
      });
    },
    [normalizeSelection],
  );

  const selectPickerValue: (value: RangeStartAndEndDateTime) => void =
    useCallback(
      (value: RangeStartAndEndDateTime): void => {
        const picked: MetricInvestigationTimeSelection | null =
          MetricInvestigationTime.fromPickerValue(value);

        if (!picked) {
          return;
        }

        setState((current: InvestigationState): InvestigationState => {
          return {
            ...current,
            selection: normalizeSelection(picked),
            zoom: null,
            // A relative range ends at now from the moment it is picked.
            resolvedAtMs:
              picked.kind === MetricInvestigationTimeKind.Relative
                ? OneUptimeDate.getCurrentDate().getTime()
                : current.resolvedAtMs,
          };
        });
      },
      [normalizeSelection],
    );

  /*
   * A drag across a chart: the investigation zooms to the window dragged
   * out. Only the first zoom is remembered, as on every other page: after
   * zooming twice, one reset goes back to the pick from before the first.
   */
  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      const zoomedTo: MetricInvestigationCustomTime | null =
        MetricInvestigationTime.getZoomSelection({
          startTime: startTime,
          endTime: endTime,
          currentWindow: latest.current.window,
        });

      if (!zoomedTo) {
        return;
      }

      setState((current: InvestigationState): InvestigationState => {
        return {
          ...current,
          selection: zoomedTo,
          zoom: {
            before:
              isStateZoomed(current) && current.zoom
                ? current.zoom.before
                : current.selection,
            window: zoomedTo.window,
          },
        };
      });
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    setState((current: InvestigationState): InvestigationState => {
      // Nothing to undo: a stray double-click must not move the window.
      if (!isStateZoomed(current) || !current.zoom) {
        return current;
      }

      return {
        ...current,
        selection: current.zoom.before,
        zoom: null,
        resolvedAtMs: OneUptimeDate.getCurrentDate().getTime(),
      };
    });
  }, []);

  const setQueries: (queries: MetricInvestigationQueries) => void = useCallback(
    (nextQueries: MetricInvestigationQueries): void => {
      const normalized: MetricInvestigationQueries =
        MetricInvestigationQueryUtil.normalize(nextQueries);

      setState((current: InvestigationState): InvestigationState => {
        return {
          ...current,
          queries: MetricInvestigationQueryUtil.isSame(
            normalized,
            latest.current.defaultQueries,
          )
            ? null
            : normalized,
        };
      });
    },
    [],
  );

  /*
   * Works the windows out again - a range that ends at now moves on to now -
   * and has the charts read past their cache, which is what a pinned window
   * (a custom pick, a zoom) needs to show anything new.
   */
  const refresh: () => void = useCallback((): void => {
    setState((current: InvestigationState): InvestigationState => {
      return {
        ...current,
        resolvedAtMs: OneUptimeDate.getCurrentDate().getTime(),
        refreshNonce: current.refreshNonce + 1,
      };
    });
  }, []);

  const reset: () => void = useCallback((): void => {
    setState((current: InvestigationState): InvestigationState => {
      return {
        ...current,
        selection: null,
        queries: null,
        zoom: null,
        resolvedAtMs: OneUptimeDate.getCurrentDate().getTime(),
      };
    });
  }, []);

  /*
   * The range a reset of the zoom goes back to, for the Reset zoom button's
   * words ("Go back to Past 1 Hour").
   */
  const beforeZoomSelection: MetricInvestigationTimeSelection | null =
    isZoomed && state.zoom ? state.zoom.before || defaultSelection : null;
  const beforeZoomKey: string = getSelectionKey(beforeZoomSelection);
  const beforeZoomWindow: InBetween<Date> | null = beforeZoomSelection
    ? MetricInvestigationTime.resolveWindow({
        selection: beforeZoomSelection,
        presets: presets,
        now: now,
      })
    : null;
  const beforeZoomStartMs: number = beforeZoomWindow
    ? beforeZoomWindow.startValue.getTime()
    : Number.NaN;
  const beforeZoomEndMs: number = beforeZoomWindow
    ? beforeZoomWindow.endValue.getTime()
    : Number.NaN;

  const zoom: TimeRangeZoom = useMemo((): TimeRangeZoom => {
    const rangeBeforeZoom: RangeStartAndEndDateTime | null =
      beforeZoomSelection &&
      Number.isFinite(beforeZoomStartMs) &&
      Number.isFinite(beforeZoomEndMs)
        ? MetricInvestigationTime.toPickerValue(
            beforeZoomSelection,
            new InBetween<Date>(
              new Date(beforeZoomStartMs),
              new Date(beforeZoomEndMs),
            ),
          )
        : null;

    return {
      isZoomed: isZoomed,
      timeRange: pickerValue,
      rangeBeforeZoom: isZoomed ? rangeBeforeZoom : null,
      zoomToTimeRange: zoomToTimeRange,
      resetZoom: resetZoom,
    };
  }, [
    isZoomed,
    pickerValue,
    beforeZoomKey,
    beforeZoomStartMs,
    beforeZoomEndMs,
    zoomToTimeRange,
    resetZoom,
  ]);

  /*
   * Kept in the URL: what the reader changed, and nothing while they
   * changed nothing. Written only when it changes, and once when the page
   * opens on a link that holds any of it, so a link that named what this
   * page cannot show is tidied away.
   */
  const urlState: MetricInvestigationUrlState = {
    selection: isTimeChanged ? state.selection : null,
    queries: isQueriesChanged ? state.queries : null,
  };
  const urlParams: Dictionary<string | null> | null = urlParamPrefix
    ? MetricInvestigationUrl.buildParams({
        prefix: urlParamPrefix,
        state: urlState,
      })
    : null;
  const urlParamsKey: string = urlParams ? JSON.stringify(urlParams) : "";

  const lastWrittenUrlParamsKey: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  useEffect(() => {
    if (!urlParamPrefix || !urlParams) {
      return;
    }

    if (lastWrittenUrlParamsKey.current === null) {
      // The page just opened: write only to tidy a link it was opened on.
      lastWrittenUrlParamsKey.current = urlParamsKey;

      if (
        !MetricInvestigationUrl.hasAnyParam({
          prefix: urlParamPrefix,
          read: readUrlParam,
        })
      ) {
        return;
      }
    } else if (lastWrittenUrlParamsKey.current === urlParamsKey) {
      return;
    }

    lastWrittenUrlParamsKey.current = urlParamsKey;
    Navigation.setQueryString(urlParams);
  }, [urlParamPrefix, urlParamsKey]);

  /*
   * Worked out from the state, not read back off the address bar: the URL
   * is written after this render, and a link copied in between would miss
   * the latest change.
   */
  const shareUrl: string | null = urlParams
    ? MetricInvestigationUrl.applyParams(getCurrentHref(), urlParams)
    : null;

  return {
    presets: presets,
    selection: selection,
    window: shownWindow,
    pickerValue: pickerValue,
    queries: queries,
    defaultQueries: defaultQueries,
    metricViewData: metricViewData,
    refreshNonce: state.refreshNonce,
    isTimeChanged: isTimeChanged,
    isQueriesChanged: isQueriesChanged,
    isZoomed: isZoomed,
    zoom: zoom,
    shareUrl: shareUrl,
    selectPreset: selectPreset,
    selectPickerValue: selectPickerValue,
    setQueries: setQueries,
    refresh: refresh,
    reset: reset,
  };
};

export default useMetricInvestigation;
