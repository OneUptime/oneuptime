import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Card from "Common/UI/Components/Card/Card";
import AreaChartElement from "Common/UI/Components/Charts/Area/AreaChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import XAxisUtil from "Common/UI/Components/Charts/Utils/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import API from "Common/UI/Utils/API/API";
import fillFlowSeriesGaps, { parseBucketTime } from "./FlowSeriesUtil";
import { getCoarsestChartGridStepWithin } from "./ChartGridStep";
import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Top talkers for one network device, aggregated from NetFlow v5 records
 * the device exported to a probe: top source IPs, top destination IPs,
 * top conversations and top protocol/port pairs by bytes over a
 * user-selectable time window (default: the past hour), plus window
 * totals and a bandwidth-over-time chart. Standalone — fetches its own
 * data from the top-talkers endpoint for the given device.
 *
 * Its range is the whole Traffic page's, and the bandwidth chart zooms it
 * (issue #4105): a drag across the chart narrows the range, and since the
 * totals and every table come from the same fetch, they all follow; a
 * double-click on the chart, or "Reset zoom" beside the picker, puts the
 * range back.
 */

export interface ComponentProps {
  networkDeviceId: ObjectID;
}

interface TopEntry {
  key: string;
  octets: number;
  packets: number;
}

interface TopProtocolPortEntry {
  protocolNumber: number;
  destinationPort: number;
  octets: number;
  packets: number;
}

interface ConversationEntry {
  sourceIp: string;
  destinationIp: string;
  octets: number;
  packets: number;
}

interface SeriesPointEntry {
  // Bucket start, ISO string from the API.
  time: string;
  octets: number;
  packets: number;
}

interface TopTalkersData {
  totalOctets: number;
  totalPackets: number;
  totalFlows: number;
  topSources: Array<TopEntry>;
  topDestinations: Array<TopEntry>;
  topProtocolPorts: Array<TopProtocolPortEntry>;
  topConversations: Array<ConversationEntry>;
  series: Array<SeriesPointEntry>;
  seriesBucketSeconds: number;
  windowStartAt: string;
  windowEndAt: string;
}

// Common IP protocol numbers → names; anything else shows the number.
const PROTOCOL_NAMES: { [protocolNumber: number]: string } = {
  1: "ICMP",
  2: "IGMP",
  6: "TCP",
  17: "UDP",
  47: "GRE",
  50: "ESP",
  58: "ICMPv6",
  89: "OSPF",
  132: "SCTP",
};

const protocolLabel: (protocolNumber: number) => string = (
  protocolNumber: number,
): string => {
  return PROTOCOL_NAMES[protocolNumber] || `Protocol ${protocolNumber}`;
};

// 1234567 -> "1.23 MB" — flows are byte counters, keep units human.
const formatBytes: (octets: number) => string = (octets: number): string => {
  if (octets < 1024) {
    return `${octets} B`;
  }
  const units: Array<string> = ["KB", "MB", "GB", "TB", "PB"];
  let value: number = octets;
  let unitIndex: number = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

const formatCount: (value: number) => string = (value: number): string => {
  return value.toLocaleString();
};

// 0.0123 -> "0.01", 12.3 -> "12.3", 123.4 -> "123" — Mbps at a sane precision.
const formatMbps: (mbps: number) => string = (mbps: number): string => {
  if (mbps >= 100) {
    return mbps.toFixed(0);
  }
  if (mbps >= 10) {
    return mbps.toFixed(1);
  }
  return mbps.toFixed(2);
};

/*
 * Human label for the selected window, used in the card description and
 * the empty state ("over the past 1 hour" / "over the selected time range").
 */
const windowLabel: (timeRange: RangeStartAndEndDateTime) => string = (
  timeRange: RangeStartAndEndDateTime,
): string => {
  if (timeRange.range === TimeRange.CUSTOM) {
    return "the selected time range";
  }
  return `the ${timeRange.range.toLowerCase()}`;
};

const parseTopEntries: (value: unknown) => Array<TopEntry> = (
  value: unknown,
): Array<TopEntry> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as JSONArray).map((row: unknown): TopEntry => {
    const entry: JSONObject = (row || {}) as JSONObject;
    return {
      key: String(entry["key"] ?? ""),
      octets: Number(entry["octets"]) || 0,
      packets: Number(entry["packets"]) || 0,
    };
  });
};

const parseResponse: (data: JSONObject | undefined) => TopTalkersData = (
  data: JSONObject | undefined,
): TopTalkersData => {
  const rawProtocolPorts: JSONArray = Array.isArray(data?.["topProtocolPorts"])
    ? (data!["topProtocolPorts"] as JSONArray)
    : [];

  const rawConversations: JSONArray = Array.isArray(data?.["topConversations"])
    ? (data!["topConversations"] as JSONArray)
    : [];

  const rawSeries: JSONArray = Array.isArray(data?.["series"])
    ? (data!["series"] as JSONArray)
    : [];

  return {
    totalOctets: Number(data?.["totalOctets"]) || 0,
    totalPackets: Number(data?.["totalPackets"]) || 0,
    totalFlows: Number(data?.["totalFlows"]) || 0,
    topSources: parseTopEntries(data?.["topSources"]),
    topDestinations: parseTopEntries(data?.["topDestinations"]),
    topProtocolPorts: rawProtocolPorts.map(
      (row: unknown): TopProtocolPortEntry => {
        const entry: JSONObject = (row || {}) as JSONObject;
        return {
          protocolNumber: Number(entry["protocolNumber"]) || 0,
          destinationPort: Number(entry["destinationPort"]) || 0,
          octets: Number(entry["octets"]) || 0,
          packets: Number(entry["packets"]) || 0,
        };
      },
    ),
    topConversations: rawConversations.map(
      (row: unknown): ConversationEntry => {
        const entry: JSONObject = (row || {}) as JSONObject;
        return {
          sourceIp: String(entry["sourceIp"] ?? ""),
          destinationIp: String(entry["destinationIp"] ?? ""),
          octets: Number(entry["octets"]) || 0,
          packets: Number(entry["packets"]) || 0,
        };
      },
    ),
    series: rawSeries.map((row: unknown): SeriesPointEntry => {
      const entry: JSONObject = (row || {}) as JSONObject;
      return {
        time: String(entry["time"] ?? ""),
        octets: Number(entry["octets"]) || 0,
        packets: Number(entry["packets"]) || 0,
      };
    }),
    seriesBucketSeconds: Number(data?.["seriesBucketSeconds"]) || 60,
    windowStartAt: String(data?.["windowStartAt"] ?? ""),
    windowEndAt: String(data?.["windowEndAt"] ?? ""),
  };
};

export interface FlowSectionTitleProps {
  title: string;
  // What the section's numbers mean, in the (i) beside the title.
  description: string;
}

/*
 * The heading over one block of the card — the bandwidth chart or one of the
 * top-N tables — with the (i) that says what its numbers are: which window,
 * how many rows at most, and that Bytes / Packets are totals per row.
 */
export const FlowSectionTitle: FunctionComponent<FlowSectionTitleProps> = (
  props: FlowSectionTitleProps,
): ReactElement => {
  return (
    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-900">
      <span>{props.title}</span>
      <InfoTooltip label={props.title} text={props.description} />
    </div>
  );
};

export interface FlowStatTileProps {
  title: string;
  value: string;
  // What the value means, in the (i) beside the title.
  description: string;
}

/*
 * One of the three window totals above the chart. The card only renders
 * these once the data is in (the loading state is the card's own loader),
 * so there is no skeleton branch to carry the (i).
 */
export const FlowStatTile: FunctionComponent<FlowStatTileProps> = (
  props: FlowStatTileProps,
): ReactElement => {
  return (
    <div className="rounded-md border border-gray-200 p-4">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {props.title}
        </span>
        <InfoTooltip label={props.title} text={props.description} />
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">
        {props.value}
      </div>
    </div>
  );
};

const TopEntryTable: FunctionComponent<{
  title: string;
  description: string;
  keyHeader: string;
  entries: Array<TopEntry>;
}> = (props: {
  title: string;
  description: string;
  keyHeader: string;
  entries: Array<TopEntry>;
}): ReactElement => {
  return (
    <div>
      <FlowSectionTitle title={props.title} description={props.description} />
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
              {props.keyHeader}
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
              Bytes
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
              Packets
            </th>
          </tr>
        </thead>
        <tbody>
          {props.entries.map((entry: TopEntry, index: number) => {
            return (
              <tr key={index}>
                <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100 font-mono">
                  {entry.key}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                  {formatBytes(entry.octets)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                  {formatCount(entry.packets)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const BANDWIDTH_SERIES_NAME: string = "Bandwidth";

/*
 * The chart's grid step for the series' bucket width: the coarsest step no
 * wider than one bucket, so every bucket gets a slot of its own.
 *
 * The API sizes its buckets to about 120 per window, in whole minutes: 12
 * minutes over a day, 168 over two weeks, 372 over the 31-day maximum, and
 * any multiple of a minute for a zoom or a custom range. Hardly any of those
 * is a grid step, and the axis must not guess one from the window's length:
 * it guesses the step a metric query of that length is bucketed at, which
 * is coarser - daily for two weeks - and the chart then AVERAGES every bucket
 * that lands in one slot. A burst drew at a ninth of the Max printed above
 * the chart, and a drag could only select whole days. On a step no wider
 * than a bucket, buckets never share a slot; the slots between them are
 * left empty, and the area is drawn straight across them.
 */
export const getBandwidthAxisPrecision: (
  bucketSeconds: number,
) => XAxisPrecision | undefined = (
  bucketSeconds: number,
): XAxisPrecision | undefined => {
  return getCoarsestChartGridStepWithin(bucketSeconds);
};

/*
 * Bandwidth-over-time area chart. Each series bucket's byte count is
 * converted to average megabits/sec over the bucket (octets * 8 / 1e6 /
 * bucketSeconds), with min/avg/max Mbps labels above.
 *
 * It is the shared area chart (it used to be a hand-drawn SVG) laid over
 * the window the card fetched, so it has a time axis and a per-bucket
 * tooltip, and it joins the card's zoom (issue #4105): a drag across it
 * narrows the card's range, a double-click puts the range back.
 */
export const BandwidthOverTimeChart: FunctionComponent<{
  series: Array<SeriesPointEntry>;
  bucketSeconds: number;
  // The window the series was fetched over, as the API echoes it back.
  windowStartAt: string;
  windowEndAt: string;
}> = (props: {
  series: Array<SeriesPointEntry>;
  bucketSeconds: number;
  windowStartAt: string;
  windowEndAt: string;
}): ReactElement => {
  const bucketSeconds: number =
    props.bucketSeconds > 0 ? props.bucketSeconds : 60;

  const mbpsValues: Array<number> = props.series.map(
    (point: SeriesPointEntry): number => {
      return (point.octets * 8) / 1_000_000 / bucketSeconds;
    },
  );

  if (mbpsValues.length === 0) {
    return <></>;
  }

  const maxMbps: number = Math.max(...mbpsValues);
  const minMbps: number = Math.min(...mbpsValues);
  const avgMbps: number =
    mbpsValues.reduce((sum: number, value: number): number => {
      return sum + value;
    }, 0) / mbpsValues.length;

  // Bucket strings parsed as the gap filling parsed them (naive = UTC).
  const points: Array<DataPoint> = [];
  props.series.forEach((point: SeriesPointEntry, index: number): void => {
    const bucketMs: number = parseBucketTime(point.time);
    if (Number.isFinite(bucketMs)) {
      points.push({ x: new Date(bucketMs), y: mbpsValues[index]! });
    }
  });

  const precision: XAxisPrecision | undefined =
    getBandwidthAxisPrecision(bucketSeconds);

  /*
   * The axis spans the whole window the card asked for, so a quiet start
   * or end still reads as time passing, and a drag maps to real instants.
   * The first and last buckets stand in for a window the API left out.
   *
   * It starts on the grid, at the step that holds the FIRST bucket. Buckets
   * are aligned to the epoch, so the first one usually begins before the
   * window does (the gap filling walks from the bucket holding the window
   * start), and an axis walked from the window start - or from any instant
   * off the grid - can label its first or last slot past a bucket. The chart
   * silently drops a point with no slot: a burst at either end of the window
   * drew nothing.
   */
  const windowStartMs: number = parseBucketTime(props.windowStartAt);
  const windowEndMs: number = parseBucketTime(props.windowEndAt);
  const firstBucketMs: number =
    points.length > 0 ? points[0]!.x.getTime() : Number.NaN;
  const axisFromMs: number = Number.isFinite(windowStartMs)
    ? Math.min(windowStartMs, firstBucketMs)
    : firstBucketMs;
  const axisStartMs: number =
    precision && Number.isFinite(axisFromMs)
      ? XAxisUtil.getBucketStart(new Date(axisFromMs), precision).getTime()
      : axisFromMs;
  const axisEndMs: number = Number.isFinite(windowEndMs)
    ? windowEndMs
    : points.length > 0
      ? points[points.length - 1]!.x.getTime() + bucketSeconds * 1000
      : Number.NaN;
  const hasAxis: boolean =
    points.length > 0 &&
    Number.isFinite(axisStartMs) &&
    Number.isFinite(axisEndMs) &&
    axisEndMs > axisStartMs;

  const series: Array<SeriesPoint> = [
    { seriesName: BANDWIDTH_SERIES_NAME, data: points },
  ];

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: new Date(axisStartMs),
      max: new Date(axisEndMs),
      /*
       * One bucket per slot (see getBandwidthAxisPrecision); should a
       * daylight-saving change ever fold two into one, it shows their
       * average rate.
       */
      aggregateType: XAxisAggregateType.Average,
      precision: precision,
    },
  };

  const yAxis: YAxis = {
    legend: "Mbps",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.TwoDecimals,
      formatter: (value: number): string => {
        return `${formatMbps(value)} Mbps`;
      },
    },
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>
          Min{" "}
          <span className="font-medium text-gray-900">
            {formatMbps(minMbps)} Mbps
          </span>
        </span>
        <span>
          Avg{" "}
          <span className="font-medium text-gray-900">
            {formatMbps(avgMbps)} Mbps
          </span>
        </span>
        <span>
          Max{" "}
          <span className="font-medium text-gray-900">
            {formatMbps(maxMbps)} Mbps
          </span>
        </span>
        <TimeRangeZoomHint revealOnHover={true} className="ml-auto" />
      </div>
      {hasAxis ? (
        <div
          role="figure"
          aria-label="Bandwidth over time in megabits per second"
          data-testid="flow-bandwidth-chart"
        >
          <AreaChartElement
            data={series}
            xAxis={xAxis}
            yAxis={yAxis}
            curve={ChartCurve.MONOTONE}
            sync={false}
            syncid="network-device-flow-bandwidth"
            heightInPx={176}
            showLegend={false}
            colors={["indigo"]}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * No flows in the window the card loaded (`timeRange`).
 *
 * Over a preset window ("the past 1 hour") the likeliest reason is that flow
 * export is not set up, so it says how. A custom window is almost always a
 * zoom into a quiet stretch of the chart, for a device the reader has just
 * seen exporting; setup steps there read as if it were not. It says there
 * were no flows in that window instead, and how to get back.
 *
 * After a zoom this is all that is left where the chart was, so it takes the
 * chart's double-click (only while zoomed, and then its text cannot be
 * selected, or the double-click would also select a word): the way back is
 * where the reader's pointer already is. "Reset zoom" beside the picker does
 * the same.
 */
const FlowNoDataState: FunctionComponent<{
  timeRange: RangeStartAndEndDateTime;
}> = (props: { timeRange: RangeStartAndEndDateTime }): ReactElement => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();
  const onTimeRangeReset: (() => void) | undefined = zoom?.onTimeRangeReset;

  const rangeBeforeZoom: RangeStartAndEndDateTime | null =
    zoom?.rangeBeforeZoom || null;
  const wayBack: string =
    rangeBeforeZoom && rangeBeforeZoom.range !== TimeRange.CUSTOM
      ? windowLabel(rangeBeforeZoom)
      : "the time range before the zoom";

  return (
    <div
      className={`flex items-center justify-center py-16 px-6${
        onTimeRangeReset ? " select-none" : ""
      }`}
      data-testid="flow-no-data"
      onDoubleClick={onTimeRangeReset}
    >
      {props.timeRange.range === TimeRange.CUSTOM ? (
        <div className="text-center max-w-md">
          <div className="text-sm font-medium text-gray-900">
            No flows in the selected time range.
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {onTimeRangeReset
              ? `This device sent no flow records in the stretch you zoomed into. Double-click here, or use Reset zoom, to go back to ${wayBack}.`
              : "This device sent no flow records in this window."}
          </p>
        </div>
      ) : (
        <div className="text-center max-w-md">
          <div className="text-sm font-medium text-gray-900">
            No flow data yet.
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Flow export is not configured for this device, or nothing has
            arrived in {windowLabel(props.timeRange)}. Point the device&apos;s
            NetFlow v5 export at your probe&apos;s IP on UDP port 2055 (and set
            PROBE_NETFLOW_RECEIVER_ENABLED=true on the probe).
          </p>
        </div>
      )}
    </div>
  );
};

/*
 * What the card shows once a window with flows has loaded: the window's
 * totals, its bandwidth over time and the top-N tables, all from one fetch.
 */
const FlowTopTalkersFigures: FunctionComponent<{
  data: TopTalkersData;
}> = (props: { data: TopTalkersData }): ReactElement => {
  const data: TopTalkersData = props.data;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <FlowStatTile
          title="Total Traffic"
          value={formatBytes(data.totalOctets)}
          description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowTotalTraffic}
        />
        <FlowStatTile
          title="Packets"
          value={formatCount(data.totalPackets)}
          description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowPackets}
        />
        <FlowStatTile
          title="Flows"
          value={formatCount(data.totalFlows)}
          description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowCount}
        />
      </div>

      {data.series.length > 0 ? (
        // The named group: the chart's "Drag to zoom" hint shows on hover.
        <div className="group/zoomhint mb-6">
          <FlowSectionTitle
            title="Bandwidth Over Time"
            description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowBandwidth}
          />
          <BandwidthOverTimeChart
            series={fillFlowSeriesGaps(
              data.series,
              data.seriesBucketSeconds,
              data.windowStartAt,
              data.windowEndAt,
            )}
            bucketSeconds={data.seriesBucketSeconds}
            windowStartAt={data.windowStartAt}
            windowEndAt={data.windowEndAt}
          />
        </div>
      ) : (
        <></>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopEntryTable
          title="Top Sources"
          description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowTopSources}
          keyHeader="Source IP"
          entries={data.topSources}
        />
        <TopEntryTable
          title="Top Destinations"
          description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowTopDestinations}
          keyHeader="Destination IP"
          entries={data.topDestinations}
        />
      </div>

      {data.topConversations.length > 0 ? (
        <div className="mt-6">
          <FlowSectionTitle
            title="Top Conversations"
            description={
              NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowTopConversations
            }
          />
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  Source &rarr; Destination
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  Bytes
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  Packets
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topConversations.map(
                (entry: ConversationEntry, index: number) => {
                  return (
                    <tr key={index}>
                      <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100 font-mono">
                        {entry.sourceIp}{" "}
                        <span className="text-gray-400">&rarr;</span>{" "}
                        {entry.destinationIp}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                        {formatBytes(entry.octets)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                        {formatCount(entry.packets)}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <></>
      )}

      <div className="mt-6">
        <FlowSectionTitle
          title="Top Protocols & Ports"
          description={NETWORK_DEVICE_METRIC_DESCRIPTIONS.flowTopProtocolsPorts}
        />
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                Protocol
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                Destination Port
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                Bytes
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                Packets
              </th>
            </tr>
          </thead>
          <tbody>
            {data.topProtocolPorts.map(
              (entry: TopProtocolPortEntry, index: number) => {
                return (
                  <tr key={index}>
                    <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100">
                      {protocolLabel(entry.protocolNumber)}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900 border-b border-gray-100 font-mono">
                      {entry.destinationPort}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                      {formatBytes(entry.octets)}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600 border-b border-gray-100 text-right">
                      {formatCount(entry.packets)}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface LoadedTopTalkers {
  data: TopTalkersData;
  /*
   * The range the data was fetched over. While the next range loads it is
   * what the card still shows, not what the picker already says.
   */
  timeRange: RangeStartAndEndDateTime;
}

const FlowTopTalkers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // The last fetch that succeeded; a failed one keeps it.
  const [loaded, setLoaded] = useState<LoadedTopTalkers | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  /*
   * Counts fetches so only the latest one lands. A drag and a double-click
   * (or two picks) can leave two fetches in flight, and the slower, older
   * one must not fill the card with a window the picker no longer shows.
   */
  const latestFetchRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchTopTalkers: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      latestFetchRef.current += 1;
      const fetchId: number = latestFetchRef.current;

      setIsLoading(true);
      setError("");

      let result: TopTalkersData | null = null;
      let failure: string | null = null;

      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/network-device/flow/top-talkers",
        );

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        /*
         * Project scoping is attached automatically via the tenantid header
         * that ModelAPI.getCommonHeaders() sets from the current project.
         * The window comes from the time-range picker (default: past hour)
         * or a zoom on the chart.
         */
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url,
            data: {
              projectId: ProjectUtil.getCurrentProjectId()?.toString(),
              networkDeviceId: props.networkDeviceId.toString(),
              startTime: OneUptimeDate.toString(dateRange.startValue),
              endTime: OneUptimeDate.toString(dateRange.endValue),
            },
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        result = parseResponse(response.data);
      } catch (err) {
        failure = API.getFriendlyMessage(err);
      }

      if (fetchId !== latestFetchRef.current) {
        return;
      }

      if (failure !== null) {
        setError(failure);
      } else if (result) {
        setLoaded({ data: result, timeRange: timeRange });
      }

      setIsLoading(false);
    }, [props.networkDeviceId, timeRange]);

  useEffect(() => {
    fetchTopTalkers().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchTopTalkers]);

  return (
    /*
     * The card's range is the Traffic page's, and the zoom lives up here,
     * around both the picker (for its Reset zoom) and the card's body.
     */
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <Card
        title="Top Talkers"
        description={`Who this device saw talking over ${windowLabel(
          timeRange,
        )}, aggregated from the NetFlow records it exported: top sources, destinations, conversations and protocol/port pairs by bytes.`}
        rightElement={
          <div className="flex items-center gap-2">
            <RangeStartAndEndDateView
              dashboardStartAndEndDate={timeRange}
              onChange={(newRange: RangeStartAndEndDateTime) => {
                setTimeRange(newRange);
              }}
            />
            <ResetTimeRangeZoomButton />
          </div>
        }
      >
        {/*
         * The loader and the full-size error are for the first load only.
         * After that a zoom, a reset or a new pick keeps the last data on
         * screen, dimmed, until the next lands: the body is a page tall,
         * and swapping it for a loader collapsed the page under the pointer
         * that had just dragged or double-clicked the chart, then threw it
         * back. It also keeps the chart mounted, so a drag already under way
         * on it survives.
         */}
        {!loaded && isLoading ? <ComponentLoader /> : <></>}

        {!loaded && !isLoading && error ? (
          <ErrorMessage message={error} />
        ) : (
          <></>
        )}

        {loaded ? (
          <div className="relative" aria-busy={isLoading}>
            {error ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                <Icon
                  icon={IconProp.Error}
                  className="h-4 w-4 shrink-0 text-red-500"
                />
                <span>
                  Couldn&apos;t refresh — showing previously loaded data.{" "}
                  {error}
                </span>
              </div>
            ) : (
              <></>
            )}

            {isLoading ? (
              <div
                className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-500 shadow-sm"
                data-testid="flow-refreshing"
              >
                <Icon
                  icon={IconProp.Refresh}
                  className="h-3 w-3 animate-spin text-gray-400"
                />
                Refreshing
              </div>
            ) : (
              <></>
            )}

            <div
              className={isLoading ? "opacity-75 transition-opacity" : ""}
              data-testid="flow-top-talkers-body"
            >
              {loaded.data.totalFlows > 0 ? (
                <FlowTopTalkersFigures data={loaded.data} />
              ) : (
                <FlowNoDataState timeRange={loaded.timeRange} />
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </Card>
    </TimeRangeZoomScope>
  );
};

export default FlowTopTalkers;
