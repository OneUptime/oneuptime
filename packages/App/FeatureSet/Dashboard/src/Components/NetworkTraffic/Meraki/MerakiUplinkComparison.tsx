import {
  formatBitsPerSecond,
  formatSharePercent,
  formatTrafficBytes,
  getSharePercent,
} from "../NetworkTrafficFormat";
import {
  getTrafficChartRateAxis,
  getTrafficChartXAxis,
} from "../TrafficOverTimeChart";
import { MERAKI_VIEW_HELP, UPLINK_APPLIANCE_COUNT } from "./MerakiWords";
import {
  MerakiUplinkChartMode,
  MerakiUplinkComparisonRow,
  UNKNOWN_VALUE,
  formatLatency,
  formatLoss,
  getUplinkChartLines,
  hasUplinkHealth,
  isEveryChartSlotABucket,
} from "./MerakiTrafficRows";
import IconProp from "Common/Types/Icon/IconProp";
import { NetworkTrafficUsageSummary } from "Common/Types/NetFlow/NetworkTrafficUsage";
import Card from "Common/UI/Components/Card/Card";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { XAxis as ChartXAxis } from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import { ChartColorValue } from "Common/UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * THE PAGE'S UPLINKS SIDE BY SIDE: which WAN carried the traffic, and how each
 * line held up, over the page's own time range.
 *
 * A chart with one line per uplink - its traffic, or the latency or loss
 * Meraki measured on it - over a row per uplink with its traffic, its share,
 * its average and peak rate, and its loss and latency. A click on a row
 * narrows the whole page to that uplink, and a click on the row it is
 * narrowed to widens it again; narrowed, the card still lists the others, so
 * the comparison and the way back stay on the page.
 *
 * Bytes are zero where a read found none: silence is a fact. Loss and
 * latency are measurements, never a perfect zero where none was made: the
 * line breaks across a stretch nobody measured, on a range whose grid can
 * tell one (isEveryChartSlotABucket), and a row with no measurement says so
 * with a dash.
 *
 * The columns are a list of buttons rather than a table, so a row is one
 * target. The headings over them are only for the eye: each cell carries its
 * own label for a screen reader, and shows it on a phone, where the headings
 * are gone and the cells wrap under their uplink.
 */

export const MERAKI_UPLINK_CHART_MODES: Array<{
  mode: MerakiUplinkChartMode;
  label: string;
}> = [
  { mode: "traffic", label: translationKey("Traffic") },
  { mode: "latency", label: translationKey("Latency") },
  { mode: "loss", label: translationKey("Packet loss") },
];

const LINE_COLORS: Array<ChartColorValue> = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "cyan",
];

function getMeasurementAxis(mode: "latency" | "loss"): YAxis {
  return {
    legend: mode === "latency" ? "ms" : "%",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.TwoDecimals,
      formatter: mode === "latency" ? formatLatency : formatLoss,
    },
  };
}

const UplinkStat: FunctionComponent<{
  label: string;
  value: string;
  detail?: string | undefined;
  dataTestId: string;
}> = (props: {
  label: string;
  value: string;
  detail?: string | undefined;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="block min-w-0">
      <span className="block text-xs text-gray-500 sm:sr-only">
        {translator.translateText(props.label)}
      </span>
      <span
        className="block truncate text-sm tabular-nums text-gray-900"
        data-testid={props.dataTestId}
      >
        {props.value}
      </span>
      {props.detail ? (
        <span className="block text-xs tabular-nums text-gray-500">
          {props.detail}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

export interface ComponentProps {
  rows: Array<MerakiUplinkComparisonRow>;
  summary: Pick<
    NetworkTrafficUsageSummary,
    "uplinkSeries" | "bucketSeconds" | "windowStartAt" | "windowEndAt"
  >;
  // The uplink the page is narrowed to.
  activeInterfaceName?: string | undefined;
  onSelect: (interfaceName: string) => void;
  // Whether an uplink's appliances are worth counting: a page of several.
  showApplianceCount: boolean;
}

const MerakiUplinkComparison: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pickedMode, setMode] = useState<MerakiUplinkChartMode>("traffic");
  const hasHealth: boolean = hasUplinkHealth(props.rows);
  // A range with nothing measured has only traffic to show.
  const mode: MerakiUplinkChartMode = hasHealth ? pickedMode : "traffic";

  const total: number = props.rows.reduce(
    (sum: number, row: MerakiUplinkComparisonRow): number => {
      return sum + row.octets;
    },
    0,
  );

  const lines: Array<SeriesPoint> = useMemo(() => {
    return getUplinkChartLines({
      rows: props.rows,
      uplinkSeries: props.summary.uplinkSeries,
      bucketSeconds: props.summary.bucketSeconds,
      mode,
    });
  }, [props.rows, props.summary, mode]);

  const pointTimes: Array<number> = lines.flatMap(
    (line: SeriesPoint): Array<number> => {
      return line.data.map((point: DataPoint): number => {
        return (point.x as Date).getTime();
      });
    },
  );

  const xAxis: ChartXAxis | null =
    pointTimes.length > 0
      ? getTrafficChartXAxis({
          firstBucketMs: Math.min(...pointTimes),
          lastBucketMs: Math.max(...pointTimes),
          bucketSeconds: props.summary.bucketSeconds,
          windowStartAt: props.summary.windowStartAt,
          windowEndAt: props.summary.windowEndAt,
        })
      : null;

  const columnsClassName: string = hasHealth
    ? "sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_repeat(4,minmax(0,0.8fr))]"
    : "sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_repeat(2,minmax(0,0.8fr))]";

  const headings: Array<string> = [
    translationKey("Uplink"),
    translationKey("Traffic"),
    translationKey("Average"),
    translationKey("Peak"),
    ...(hasHealth
      ? [translationKey("Latency"), translationKey("Packet loss")]
      : []),
  ];

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          {translator.translateText("WAN uplinks")}
          <InfoTooltip
            label="WAN uplinks"
            text={MERAKI_VIEW_HELP.uplinkComparison}
          />
        </span>
      }
      description="Which uplink carried the traffic, and how each line held up."
      rightElement={
        hasHealth ? (
          <div
            className="inline-flex rounded-md bg-gray-50 p-0.5 ring-1 ring-gray-200"
            role="group"
            aria-label={translator.translateText("Compare the uplinks by")}
            data-testid="meraki-uplink-chart-modes"
          >
            {MERAKI_UPLINK_CHART_MODES.map(
              (option: {
                mode: MerakiUplinkChartMode;
                label: string;
              }): ReactElement => {
                return (
                  <button
                    key={option.mode}
                    type="button"
                    aria-pressed={mode === option.mode}
                    className={`rounded px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      mode === option.mode
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                    onClick={() => {
                      setMode(option.mode);
                    }}
                    data-testid={`meraki-uplink-chart-${option.mode}`}
                  >
                    {translator.translateText(option.label)}
                  </button>
                );
              },
            )}
          </div>
        ) : undefined
      }
    >
      <div data-testid="meraki-uplink-comparison">
        {xAxis ? (
          <div
            role="figure"
            aria-label={translator.translateText(
              mode === "traffic"
                ? "Each uplink's traffic over time, in bits per second"
                : mode === "latency"
                  ? "Each uplink's latency over time, in milliseconds"
                  : "Each uplink's packet loss over time, as a percentage",
            )}
            data-testid="meraki-uplink-chart"
          >
            <LineChartElement
              data={lines}
              xAxis={xAxis}
              yAxis={
                mode === "traffic"
                  ? getTrafficChartRateAxis()
                  : getMeasurementAxis(mode)
              }
              curve={ChartCurve.MONOTONE}
              sync={false}
              syncid="network-traffic-uplinks"
              heightInPx={200}
              showLegend={true}
              colors={LINE_COLORS}
              connectNulls={
                mode === "traffic" ||
                !isEveryChartSlotABucket(props.summary.bucketSeconds)
              }
            />
          </div>
        ) : (
          <p
            className="py-6 text-center text-sm text-gray-500"
            data-testid="meraki-uplink-chart-empty"
          >
            {translator.translateText(
              "Nothing was measured on these uplinks in this time range.",
            )}
          </p>
        )}

        <div
          className={`mt-5 max-sm:hidden gap-x-4 pb-1 text-xs font-medium text-gray-500 sm:grid ${columnsClassName}`}
          aria-hidden="true"
        >
          {headings.map((heading: string): ReactElement => {
            return (
              <span key={heading}>{translator.translateText(heading)}</span>
            );
          })}
        </div>

        <ol className="-mx-2 mt-3 space-y-0.5 sm:mt-0">
          {props.rows.map((row: MerakiUplinkComparisonRow): ReactElement => {
            const isActive: boolean =
              props.activeInterfaceName === row.interfaceName;
            const share: number = getSharePercent(row.octets, total);

            return (
              <li key={row.interfaceName}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={translator.translateTemplate(
                    "Show only the traffic of {{uplink}}",
                    { uplink: row.interfaceName },
                  )}
                  onClick={() => {
                    props.onSelect(row.interfaceName);
                  }}
                  className={`grid w-full grid-cols-2 items-start gap-x-4 gap-y-2 rounded-md px-2 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:gap-y-0 ${columnsClassName} ${
                    isActive ? "bg-indigo-50" : "hover:bg-gray-50"
                  }`}
                  data-testid="meraki-uplink-row"
                >
                  <span className="col-span-2 block min-w-0 sm:col-span-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {isActive ? (
                        <Icon
                          icon={IconProp.Filter}
                          className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600"
                        />
                      ) : (
                        <></>
                      )}
                      <span
                        className="truncate font-mono text-sm font-medium text-gray-900"
                        data-testid="meraki-uplink-row-name"
                      >
                        {row.interfaceName}
                      </span>
                      <span
                        className="text-xs tabular-nums text-gray-500"
                        data-testid="meraki-uplink-row-share"
                      >
                        {formatSharePercent(row.octets, total)}
                      </span>
                    </span>
                    {props.showApplianceCount && row.applianceCount > 0 ? (
                      <span
                        className="mt-0.5 block truncate text-xs text-gray-500"
                        data-testid="meraki-uplink-row-appliances"
                      >
                        {translator.translatePlural(
                          UPLINK_APPLIANCE_COUNT,
                          row.applianceCount,
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    <span
                      className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-gray-100"
                      aria-hidden="true"
                    >
                      <span
                        className={`block h-full rounded-full ${
                          isActive ? "bg-indigo-600" : "bg-indigo-400"
                        }`}
                        style={{ width: `${Math.max(share, 0.5)}%` }}
                      />
                    </span>
                  </span>
                  <UplinkStat
                    label="Traffic"
                    value={formatTrafficBytes(row.octets)}
                    detail={
                      row.octets > 0
                        ? translator.translateTemplate(
                            "In {{in}} · out {{out}}",
                            {
                              in: formatTrafficBytes(row.receivedOctets),
                              out: formatTrafficBytes(row.sentOctets),
                            },
                          )
                        : undefined
                    }
                    dataTestId="meraki-uplink-row-traffic"
                  />
                  <UplinkStat
                    label="Average"
                    value={formatBitsPerSecond(row.averageBitsPerSecond)}
                    dataTestId="meraki-uplink-row-average"
                  />
                  <UplinkStat
                    label="Peak"
                    value={formatBitsPerSecond(row.peakBitsPerSecond)}
                    dataTestId="meraki-uplink-row-peak"
                  />
                  {hasHealth ? (
                    <UplinkStat
                      label="Latency"
                      value={
                        row.latencyMs === null
                          ? UNKNOWN_VALUE
                          : formatLatency(row.latencyMs)
                      }
                      dataTestId="meraki-uplink-row-latency"
                    />
                  ) : (
                    <></>
                  )}
                  {hasHealth ? (
                    <UplinkStat
                      label="Packet loss"
                      value={
                        row.lossPercent === null
                          ? UNKNOWN_VALUE
                          : formatLoss(row.lossPercent)
                      }
                      dataTestId="meraki-uplink-row-loss"
                    />
                  ) : (
                    <></>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
};

export default MerakiUplinkComparison;
