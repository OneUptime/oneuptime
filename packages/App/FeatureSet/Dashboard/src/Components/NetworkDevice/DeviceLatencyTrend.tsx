import MetricSparkline from "../Metrics/MetricSparkline";
import MetricUtil from "../Metrics/Utils/Metrics";
import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  LatencyPoint,
  LatencySummary,
  formatMilliseconds,
  formatPercent,
  latencyPointsFromAggregates,
  summarizeLatencySeries,
} from "./DeviceDiagnosticsViewModel";
import Route from "Common/Types/API/Route";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import { NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME } from "Common/Types/NetworkDevice/NetworkDevicePingMetricNames";
import ObjectID from "Common/Types/ObjectID";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Link from "Common/UI/Components/Link/Link";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  networkDeviceId: ObjectID;
}

/*
 * The past hour of a device's ping round-trip time as a sparkline, with the
 * hour's packet-loss peak beside it (issue #3745). Reads the DEVICE-scoped
 * series the device's own poll writes (attributes.networkDeviceId), so it
 * works for every registered device whether or not a monitor watches it —
 * and it is the context an on-demand ping is read against: "12 ms now" means
 * something different when the hour averaged 11 than when it averaged 40.
 *
 * Quiet on failure. The topology drawer mounts this for every managed device
 * it opens, and a red error under the device's name because the metrics
 * store was slow would make the whole drawer look broken; "no ping data" is
 * the honest and harmless answer either way.
 */
const DeviceLatencyTrend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [rttPoints, setRttPoints] = useState<Array<LatencyPoint>>([]);
  const [lossPoints, setLossPoints] = useState<Array<LatencyPoint>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const networkDeviceId: string = props.networkDeviceId.toString();

  useEffect(() => {
    let isCancelled: boolean = false;

    /*
     * Reset before fetching: the topology drawer can hand this same
     * instance the next node the operator clicks, and the previous
     * device's numbers must not sit under the new device's name while its
     * own fetch is in flight.
     */
    setIsLoading(true);
    setRttPoints([]);
    setLossPoints([]);

    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";

    /*
     * No project means no metrics to scope to — the case in a render
     * outside the dashboard shell (a test harness) — so there is nothing
     * to ask the API for.
     */
    if (!projectId) {
      setIsLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    const queryConfigs: Array<MetricQueryConfigData> = [
      {
        metricAliasData: {
          metricVariable: "rtt",
          title: "Round-trip time",
          description: "Ping round-trip time of this device.",
          legend: "RTT",
          legendUnit: "ms",
        },
        metricQueryData: {
          filterData: {
            metricName: NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME,
            attributes: {
              networkDeviceId: networkDeviceId,
              projectId: projectId,
            },
            aggegationType: AggregationType.Avg,
          },
        },
      },
      {
        metricAliasData: {
          metricVariable: "loss",
          title: "Packet loss",
          description: "Ping packet loss of this device.",
          legend: "Loss",
          legendUnit: "%",
        },
        metricQueryData: {
          filterData: {
            metricName: MonitorMetricType.PacketLossPercent,
            attributes: {
              networkDeviceId: networkDeviceId,
              projectId: projectId,
            },
            // The worst bucket is what matters for loss, not the mean.
            aggegationType: AggregationType.Max,
          },
        },
      },
    ];

    const metricViewData: MetricViewData = {
      startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_HOUR,
      }),
      queryConfigs: queryConfigs,
      formulaConfigs: [],
    };

    /*
     * metricTypes: [] on purpose. fetchResults uses the list only to
     * convert units, and these two series are already in ms and %; left
     * out, it lists every MetricType of the project (up to 10 000 rows,
     * uncached) on every drawer open.
     */
    MetricUtil.fetchResults({ metricViewData, metricTypes: [] })
      .then((results: Array<AggregatedResult>) => {
        if (isCancelled) {
          return;
        }

        setRttPoints(latencyPointsFromAggregates(results[0]?.data || []));
        setLossPoints(latencyPointsFromAggregates(results[1]?.data || []));
        setIsLoading(false);
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setRttPoints([]);
        setLossPoints([]);
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [networkDeviceId]);

  const summary: LatencySummary | undefined = summarizeLatencySeries(rttPoints);
  const lossSummary: LatencySummary | undefined =
    summarizeLatencySeries(lossPoints);

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_METRICS] as Route,
    { modelId: props.networkDeviceId },
  );

  const trendTitle: string =
    translateString("Round-trip time, past hour") ||
    "Round-trip time, past hour";
  const lossTitle: string =
    translateString("Packet loss (1h max)") || "Packet loss (1h max)";

  return (
    <div data-testid="network-device-latency-trend">
      <div className="flex items-center justify-between gap-4">
        {/*
         * The (i) says what now / avg / max are: per-minute averages, so
         * "max" is the slowest minute and not the slowest single ping.
         */}
        <span className="flex items-center gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {trendTitle}
          </span>
          <InfoTooltip
            label={trendTitle}
            text={NETWORK_DEVICE_METRIC_DESCRIPTIONS.latencyTrend}
          />
        </span>
        <Link
          to={metricsRoute}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          {translateString("Open metrics") || "Open metrics"}
        </Link>
      </div>
      {/*
       * MetricSparkline draws a dashed "no data" box for fewer than two
       * points, which would sit above a summary line that has a number in
       * it. One poll in the hour is a summary, not a line.
       */}
      {isLoading || rttPoints.length >= 2 ? (
        <div className="mt-2">
          <MetricSparkline
            points={rttPoints}
            isLoading={isLoading}
            widthClassName="w-full"
            heightClassName="h-12"
          />
        </div>
      ) : (
        <></>
      )}
      {isLoading ? (
        <></>
      ) : summary ? (
        <div className="mt-2 space-y-0.5 text-xs text-gray-600">
          <p data-testid="network-device-latency-summary">
            {`${translateString("now") || "now"} ${formatMilliseconds(
              summary.latest,
            )} · ${translateString("avg") || "avg"} ${formatMilliseconds(
              summary.avg,
            )} · ${translateString("max") || "max"} ${formatMilliseconds(
              summary.max,
            )}`}
          </p>
          <p
            data-testid="network-device-loss-summary"
            className="flex items-center gap-1"
          >
            <span>
              {`${lossTitle}: ${
                lossSummary ? formatPercent(lossSummary.max) : "—"
              }`}
            </span>
            <InfoTooltip
              label={lossTitle}
              text={NETWORK_DEVICE_METRIC_DESCRIPTIONS.packetLossPeak}
            />
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-500">
          {translateString("No ping data in the last hour.") ||
            "No ping data in the last hour."}
        </p>
      )}
    </div>
  );
};

export default DeviceLatencyTrend;
