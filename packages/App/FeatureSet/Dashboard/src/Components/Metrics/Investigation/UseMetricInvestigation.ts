import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Dictionary from "Common/Types/Dictionary";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Navigation from "Common/UI/Utils/Navigation";
import {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
} from "./MetricInvestigationTime";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
} from "./MetricInvestigationQueries";
import MetricInvestigationUrl from "./MetricInvestigationUrl";
import useInvestigationTimeRange, {
  InvestigationTimeRangeState,
  getCurrentHref,
} from "./UseInvestigationTimeRange";

/*
 * The state of a metric investigation (issue #5954): which time range it
 * charts, which metrics, and the zoom a reader dragged out on a chart.
 *
 * The time range is useInvestigationTimeRange's, which a card with no
 * metrics of its own holds alone (an incident's logs, issue #6251); this
 * adds the metrics: the page's, or the ones the reader picked.
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

export interface MetricInvestigationState extends InvestigationTimeRangeState {
  queries: MetricInvestigationQueries;
  /*
   * The page's metrics, which Reset goes back to: what lines drawn for the
   * page's own metrics (a monitor's thresholds) are drawn on.
   */
  defaultQueries: MetricInvestigationQueries;
  // The window and the queries, for MetricView and the explorer link.
  metricViewData: MetricViewData;
  // Whether the reader changed the metrics.
  isQueriesChanged: boolean;
  /*
   * The page's address with the investigation in it, for a "Copy link"
   * that opens the same charts; null when it is not kept in the URL.
   */
  shareUrl: string | null;
  setQueries: (queries: MetricInvestigationQueries) => void;
  // Back to the default time range and metrics.
  reset: () => void;
}

type ReadUrlParamFunction = (name: string) => string | null;

const readUrlParam: ReadUrlParamFunction = (name: string): string | null => {
  return Navigation.getQueryStringByName(name);
};

const useMetricInvestigation: (
  options: UseMetricInvestigationOptions,
) => MetricInvestigationState = (
  options: UseMetricInvestigationOptions,
): MetricInvestigationState => {
  const urlParamPrefix: string | undefined = options.urlParamPrefix;

  const time: InvestigationTimeRangeState = useInvestigationTimeRange({
    getPresets: options.getPresets,
    defaultSelection: options.defaultSelection,
    urlParamPrefix: urlParamPrefix,
  });

  // The reader's metrics; null while they are the default.
  const [pickedQueries, setPickedQueries] =
    useState<MetricInvestigationQueries | null>(
      (): MetricInvestigationQueries | null => {
        if (!urlParamPrefix) {
          return null;
        }

        const fromUrl: MetricInvestigationQueries | null =
          MetricInvestigationUrl.readQueries({
            prefix: urlParamPrefix,
            read: readUrlParam,
          });

        return fromUrl &&
          !MetricInvestigationQueryUtil.isSame(fromUrl, options.defaultQueries)
          ? fromUrl
          : null;
      },
    );

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

  const queries: MetricInvestigationQueries = pickedQueries || defaultQueries;

  const isQueriesChanged: boolean = useMemo((): boolean => {
    return (
      pickedQueries !== null &&
      !MetricInvestigationQueryUtil.isSame(pickedQueries, defaultQueries)
    );
  }, [pickedQueries, defaultQueries]);

  const metricViewData: MetricViewData = useMemo((): MetricViewData => {
    return {
      startAndEndDate: time.window,
      queryConfigs: queries.queryConfigs,
      formulaConfigs: queries.formulaConfigs,
      /*
       * A relative pick keeps rolling in the explorer an "Open in Metric
       * Explorer" leads to; every other pick is the window itself.
       */
      ...(time.selection.kind === MetricInvestigationTimeKind.Relative
        ? { rangeToken: time.selection.range }
        : {}),
    };
  }, [time.window, queries, time.selection]);

  // Read by setQueries, which keeps its identity for the life of the page.
  const latestDefaults: React.MutableRefObject<MetricInvestigationQueries> =
    useRef<MetricInvestigationQueries>(defaultQueries);
  latestDefaults.current = defaultQueries;

  const setQueries: (queries: MetricInvestigationQueries) => void = useCallback(
    (nextQueries: MetricInvestigationQueries): void => {
      const normalized: MetricInvestigationQueries =
        MetricInvestigationQueryUtil.normalize(nextQueries);

      setPickedQueries(
        MetricInvestigationQueryUtil.isSame(normalized, latestDefaults.current)
          ? null
          : normalized,
      );
    },
    [],
  );

  const resetTime: () => void = time.reset;

  const reset: () => void = useCallback((): void => {
    resetTime();
    setPickedQueries(null);
  }, [resetTime]);

  /*
   * The metrics' half of the URL, kept the way the time range keeps its
   * own: what the reader changed, written only when it changes, and once
   * when the page opens on a link that holds any of it.
   */
  const queryUrlParams: Dictionary<string | null> | null = urlParamPrefix
    ? MetricInvestigationUrl.buildQueryParams({
        prefix: urlParamPrefix,
        queries: isQueriesChanged ? pickedQueries : null,
      })
    : null;
  const queryUrlParamsKey: string = queryUrlParams
    ? JSON.stringify(queryUrlParams)
    : "";

  const lastWrittenQueryUrlParamsKey: React.MutableRefObject<string | null> =
    useRef<string | null>(null);

  useEffect(() => {
    if (!urlParamPrefix || !queryUrlParams) {
      return;
    }

    if (lastWrittenQueryUrlParamsKey.current === null) {
      // The page just opened: write only to tidy a link it was opened on.
      lastWrittenQueryUrlParamsKey.current = queryUrlParamsKey;

      if (
        !MetricInvestigationUrl.hasAnyQueryParam({
          prefix: urlParamPrefix,
          read: readUrlParam,
        })
      ) {
        return;
      }
    } else if (lastWrittenQueryUrlParamsKey.current === queryUrlParamsKey) {
      return;
    }

    lastWrittenQueryUrlParamsKey.current = queryUrlParamsKey;
    Navigation.setQueryString(queryUrlParams);
  }, [urlParamPrefix, queryUrlParamsKey]);

  const urlParams: Dictionary<string | null> | null =
    time.urlParams && queryUrlParams
      ? { ...time.urlParams, ...queryUrlParams }
      : null;

  /*
   * Worked out from the state, not read back off the address bar: the URL
   * is written after this render, and a link copied in between would miss
   * the latest change.
   */
  const shareUrl: string | null = urlParams
    ? MetricInvestigationUrl.applyParams(getCurrentHref(), urlParams)
    : null;

  return {
    ...time,
    queries: queries,
    defaultQueries: defaultQueries,
    metricViewData: metricViewData,
    isQueriesChanged: isQueriesChanged,
    urlParams: urlParams,
    shareUrl: shareUrl,
    setQueries: setQueries,
    reset: reset,
  };
};

export default useMetricInvestigation;
