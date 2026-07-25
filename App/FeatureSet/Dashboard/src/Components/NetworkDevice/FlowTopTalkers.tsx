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
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import fillFlowSeriesGaps from "./FlowSeriesUtil";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * Top talkers for one network device, aggregated from NetFlow v5 records
 * the device exported to a probe: top source IPs, top destination IPs,
 * top conversations and top protocol/port pairs by bytes over a
 * user-selectable time window (default: the past hour), plus window
 * totals and a bandwidth-over-time chart. Standalone — fetches its own
 * data from the top-talkers endpoint for the given device.
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

const TopEntryTable: FunctionComponent<{
  title: string;
  keyHeader: string;
  entries: Array<TopEntry>;
}> = (props: {
  title: string;
  keyHeader: string;
  entries: Array<TopEntry>;
}): ReactElement => {
  return (
    <div>
      <div className="text-sm font-medium text-gray-900 mb-2">
        {props.title}
      </div>
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

/*
 * Bandwidth-over-time area chart, hand-rolled SVG (no chart library).
 * Each series bucket's byte count is converted to average megabits/sec
 * over the bucket (octets * 8 / 1e6 / bucketSeconds). Responsive via
 * viewBox + preserveAspectRatio, with min/avg/max Mbps labels above and
 * the window edges below.
 */
const BandwidthOverTimeChart: FunctionComponent<{
  series: Array<SeriesPointEntry>;
  bucketSeconds: number;
}> = (props: {
  series: Array<SeriesPointEntry>;
  bucketSeconds: number;
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

  const chartWidth: number = 600;
  const chartHeight: number = 120;
  const topPadding: number = 6;
  const scaleMax: number = maxMbps > 0 ? maxMbps : 1;

  const yFor: (mbps: number) => number = (mbps: number): number => {
    return topPadding + (1 - mbps / scaleMax) * (chartHeight - topPadding);
  };

  // A single bucket still renders: draw it as a flat line across the window.
  const points: Array<[number, number]> =
    mbpsValues.length === 1
      ? [
          [0, yFor(mbpsValues[0]!)],
          [chartWidth, yFor(mbpsValues[0]!)],
        ]
      : mbpsValues.map((mbps: number, index: number): [number, number] => {
          return [(index / (mbpsValues.length - 1)) * chartWidth, yFor(mbps)];
        });

  const linePoints: string = points
    .map((point: [number, number]): string => {
      return `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
    })
    .join(" ");

  const areaPath: string = `M ${linePoints
    .split(" ")
    .join(" L ")} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`;

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
      </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
        className="h-32 w-full text-indigo-500"
        role="img"
        aria-label="Bandwidth over time in megabits per second"
      >
        <path d={areaPath} fill="currentColor" fillOpacity={0.12} />
        <polyline
          points={linePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={chartHeight}
          x2={chartWidth}
          y2={chartHeight}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-gray-400">
        <span>
          {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            props.series[0]!.time,
          )}
        </span>
        <span>
          {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            props.series[props.series.length - 1]!.time,
          )}
        </span>
      </div>
    </div>
  );
};

const FlowTopTalkers: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [data, setData] = useState<TopTalkersData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const fetchTopTalkers: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/network-device/flow/top-talkers",
        );

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        /*
         * Project scoping is attached automatically via the tenantid header
         * that ModelAPI.getCommonHeaders() sets from the current project.
         * The window comes from the time-range picker (default: past hour).
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

        setData(parseResponse(response.data));
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, [props.networkDeviceId, timeRange]);

  useEffect(() => {
    fetchTopTalkers().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchTopTalkers]);

  return (
    <Card
      title="Top Talkers"
      description={`Who this device saw talking over ${windowLabel(
        timeRange,
      )}, aggregated from the NetFlow records it exported: top sources, destinations, conversations and protocol/port pairs by bytes.`}
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={(newRange: RangeStartAndEndDateTime) => {
            setTimeRange(newRange);
          }}
        />
      }
    >
      {isLoading ? <ComponentLoader /> : <></>}

      {!isLoading && error ? <ErrorMessage message={error} /> : <></>}

      {!isLoading && !error && data && data.totalFlows === 0 ? (
        <div className="flex items-center justify-center py-16 px-6">
          <div className="text-center max-w-md">
            <div className="text-sm font-medium text-gray-900">
              No flow data yet.
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Flow export is not configured for this device, or nothing has
              arrived in {windowLabel(timeRange)}. Point the device&apos;s
              NetFlow v5 export at your probe&apos;s IP on UDP port 2055 (and
              set PROBE_NETFLOW_RECEIVER_ENABLED=true on the probe).
            </p>
          </div>
        </div>
      ) : (
        <></>
      )}

      {!isLoading && !error && data && data.totalFlows > 0 ? (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Total Traffic
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatBytes(data.totalOctets)}
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Packets
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatCount(data.totalPackets)}
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Flows
              </div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {formatCount(data.totalFlows)}
              </div>
            </div>
          </div>

          {data.series.length > 0 ? (
            <div className="mb-6">
              <div className="text-sm font-medium text-gray-900 mb-2">
                Bandwidth Over Time
              </div>
              <BandwidthOverTimeChart
                series={fillFlowSeriesGaps(
                  data.series,
                  data.seriesBucketSeconds,
                  data.windowStartAt,
                  data.windowEndAt,
                )}
                bucketSeconds={data.seriesBucketSeconds}
              />
            </div>
          ) : (
            <></>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopEntryTable
              title="Top Sources"
              keyHeader="Source IP"
              entries={data.topSources}
            />
            <TopEntryTable
              title="Top Destinations"
              keyHeader="Destination IP"
              entries={data.topDestinations}
            />
          </div>

          {data.topConversations.length > 0 ? (
            <div className="mt-6">
              <div className="text-sm font-medium text-gray-900 mb-2">
                Top Conversations
              </div>
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
            <div className="text-sm font-medium text-gray-900 mb-2">
              Top Protocols &amp; Ports
            </div>
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
      ) : (
        <></>
      )}
    </Card>
  );
};

export default FlowTopTalkers;
