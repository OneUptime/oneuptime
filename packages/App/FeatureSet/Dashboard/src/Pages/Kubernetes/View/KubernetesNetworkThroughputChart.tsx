import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import ValueFormatter from "Common/Utils/ValueFormatter";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import KubernetesNetworkUtils, {
  NetworkThroughputSeries,
} from "../Utils/KubernetesNetworkUtils";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { useEmbeddedMetricCardRefreshNonce } from "../../../Components/Metrics/EmbeddedMetricCardRefresh";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export const NETWORK_THROUGHPUT_SKELETON_TEST_ID: string =
  "chart-loading-skeleton";
export const NETWORK_THROUGHPUT_REFETCHING_TEST_ID: string = "chart-refetching";

const DEFAULT_HEIGHT_IN_PX: number = 300;

export interface ComponentProps {
  clusterIdentifier: string;
  nodeName?: string | undefined;
  startDate: Date;
  endDate: Date;
  heightInPx?: number | undefined;
  syncId?: string | undefined;
}

/*
 * What a load drew, kept with the window it was fetched for. While the next
 * load is in flight the chart keeps these points on THEIR window: drawn on
 * the new window's axis they would sit at the wrong times.
 */
interface LoadedThroughput {
  // The cluster and node the points were loaded for.
  scopeKey: string;
  series: Array<SeriesPoint>;
  startDate: Date;
  endDate: Date;
}

/*
 * The chart zooms whatever range its host shares (issue #4105) - the
 * Insights page's, or the node Metrics tab's card - by taking the zoom the
 * host offers: it is handed no zoom handlers of its own.
 *
 * A drag or a double-click here reloads this very chart, and so do the
 * card's Refresh and every change of range. Only the first load has
 * nothing to draw and shows a skeleton, the chart's own height. Every
 * later load keeps the last chart on screen, dimmed and marked
 * "Refreshing", as MetricView keeps the charts beside it: swapping the
 * 300px chart for a 192px skeleton pulled it from under the pointer and
 * moved everything below it on every zoom, reset and refresh.
 */
const KubernetesNetworkThroughputChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();
  // null until the first load lands.
  const [loaded, setLoaded] = useState<LoadedThroughput | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Refresh on the card around the chart (the Insights Network card, a
   * node's Metrics tab). The window alone cannot ask for a reload: a Custom
   * window, and every zoom is one, re-resolves to the same instants, so
   * Refresh used to leave the chart - and an error it could have retried -
   * as it was.
   */
  const refreshNonce: number = useEmbeddedMetricCardRefreshNonce();

  const startMs: number = props.startDate.getTime();
  const endMs: number = props.endDate.getTime();
  const scopeKey: string = `${props.clusterIdentifier}|${props.nodeName || ""}`;

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * A failed load's error stays until this one settles, as MetricView's
       * does: over a kept chart it would otherwise blink out and back while
       * a retry is in flight.
       */
      setIsLoading(true);
      try {
        const result: NetworkThroughputSeries =
          await KubernetesNetworkUtils.fetchNetworkThroughput({
            clusterIdentifier: props.clusterIdentifier,
            nodeName: props.nodeName,
            startDate: new Date(startMs),
            endDate: new Date(endMs),
          });
        if (cancelled) {
          return;
        }
        const next: Array<SeriesPoint> = [];
        if (result.receive.length > 0) {
          next.push({ seriesName: "Received", data: result.receive });
        }
        if (result.transmit.length > 0) {
          next.push({ seriesName: "Transmitted", data: result.transmit });
        }
        setLoaded({
          scopeKey: scopeKey,
          series: next,
          startDate: new Date(startMs),
          endDate: new Date(endMs),
        });
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      cancelled = true;
    };
    /*
     * startMs/endMs track the date props by value so identical ranges don't
     * refetch; only the card's Refresh reloads the same window.
     */
  }, [props.clusterIdentifier, props.nodeName, startMs, endMs, refreshNonce]);

  const heightInPx: number = props.heightInPx ?? DEFAULT_HEIGHT_IN_PX;

  /*
   * Only a reload of the same cluster and node keeps the last chart.
   * Another node starts over from the skeleton rather than showing the
   * previous one's traffic under the new heading.
   */
  const shown: LoadedThroughput | null =
    loaded && loaded.scopeKey === scopeKey ? loaded : null;

  if (!shown) {
    /*
     * A failed first load has no chart to keep, so the message stands in
     * for it - and takes the reset double-click, so a zoom whose load
     * failed is undone where the reader's pointer already is (select-none,
     * or that double-click would also select a word of it). A retry is a
     * skeleton again.
     */
    if (error && !isLoading) {
      return (
        <div className="select-none" onDoubleClick={zoom?.onTimeRangeReset}>
          <ErrorMessage message={error} />
        </div>
      );
    }

    return (
      <div
        data-testid={NETWORK_THROUGHPUT_SKELETON_TEST_ID}
        className="animate-pulse rounded-md bg-gray-50"
        style={{ height: `${heightInPx}px` }}
      />
    );
  }

  const getChart: () => ReactElement = (): ReactElement => {
    if (shown.series.length === 0) {
      /*
       * A zoom into a quiet stretch lands here, with no chart to
       * double-click. The empty box takes the double-click instead, so
       * the way back is where the reader's pointer already is; it keeps
       * the chart's height, so the zoom does not move the page, and is
       * select-none, so the double-click does not select a word.
       */
      return (
        <div
          className="flex select-none items-center justify-center text-sm text-gray-400"
          style={{ height: `${heightInPx}px` }}
          onDoubleClick={zoom?.onTimeRangeReset}
        >
          {translator.translateText(
            "No network traffic reported for the selected time range.",
          )}
        </div>
      );
    }

    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: shown.startDate,
        max: shown.endDate,
        aggregateType: XAxisAggregateType.Average,
      },
    };

    const yAxis: YAxis = {
      legend: "B/s",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return ValueFormatter.formatValue(value, "By/s");
        },
      },
    };

    const syncId: string =
      props.syncId ||
      `k8s-network-throughput-${props.clusterIdentifier}${
        props.nodeName ? `-${props.nodeName}` : ""
      }`;

    return (
      <LineChartElement
        data={shown.series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        heightInPx={heightInPx}
        showLegend={shown.series.length > 1}
        sync={true}
        syncid={syncId}
      />
    );
  };

  /*
   * The wrappers stay the same whether or not a load is in flight, so a
   * reload never remounts the chart inside (and a drag on it survives an
   * auto-refresh). A failed reload keeps the last chart too, with the
   * error above it - the same "Couldn't refresh" MetricView shows - and
   * the card's Refresh retries it.
   */
  return (
    <div>
      {error ? (
        <div
          role="alert"
          className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <Icon
            icon={IconProp.Error}
            className="h-4 w-4 shrink-0 text-red-500"
          />
          <span>
            {translator.translateTemplate(
              "Couldn't refresh — showing previously loaded data. {{error}}",
              { error: error },
            )}
          </span>
        </div>
      ) : null}
      <div className="relative" aria-busy={isLoading}>
        {isLoading ? (
          <div
            data-testid={NETWORK_THROUGHPUT_REFETCHING_TEST_ID}
            className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-500 shadow-sm"
          >
            <Icon
              icon={IconProp.Refresh}
              className="h-3 w-3 animate-spin text-gray-400"
            />
            {translator.translateText("Refreshing")}
          </div>
        ) : null}
        <div
          className={
            isLoading ? "opacity-75 transition-opacity" : "transition-opacity"
          }
        >
          {getChart()}
        </div>
      </div>
    </div>
  );
};

export default KubernetesNetworkThroughputChart;
