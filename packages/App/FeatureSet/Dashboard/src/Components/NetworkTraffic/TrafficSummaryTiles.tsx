import {
  formatBitsPerSecond,
  formatTrafficBytes,
  getBitsPerSecond,
  getPeakBitsPerSecond,
} from "./NetworkTrafficFormat";
import { NetworkTrafficSummary } from "Common/Types/NetFlow/NetworkTraffic";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The four numbers over a Traffic page: how much traffic the window carried,
 * its average and its peak rate, and how many flow records it took. When
 * any device sampled, a line under them says the numbers are estimates.
 */

export const TILE_HELP: {
  traffic: string;
  average: string;
  peak: string;
  flows: string;
  sampled: string;
} = {
  traffic: translationKey(
    "Bytes in the flow records for this time range, as the devices reported them. When a device samples, its bytes are multiplied by its sampling rate, so the total is an estimate. Traffic that passes two exporting devices is counted by each.",
  ),
  average: translationKey(
    "The traffic's average rate over the whole time range, in bits per second.",
  ),
  peak: translationKey(
    "The rate of the busiest slice of the chart below: its bytes over the slice's length. A shorter time range has shorter slices, so a sharper peak.",
  ),
  flows: translationKey(
    "How many flow records the devices sent for this time range. Each one sums up a conversation - the same addresses, protocol and ports - over a short stretch, so a long download can be several.",
  ),
  sampled: translationKey(
    "Sampling devices count one packet in every N and the probe multiplies them back up, so these numbers are estimates - accurate for heavy traffic, rough for a few packets.",
  ),
};

interface TileProps {
  label: string;
  value: string;
  help: string;
  icon: IconProp;
  tone: string;
  dataTestId: string;
}

const TrafficTile: FunctionComponent<TileProps> = (
  props: TileProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="rounded-lg bg-white p-4 ring-1 ring-gray-200"
      data-testid={props.dataTestId}
    >
      <div className="flex items-start gap-3">
        <div
          className={`max-sm:hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg sm:flex ${props.tone}`}
          aria-hidden="true"
        >
          <Icon icon={props.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs font-medium text-gray-500">
            <span className="truncate">
              {translator.translateText(props.label)}
            </span>
            <InfoTooltip label={props.label} text={props.help} />
          </div>
          <div
            className="mt-0.5 truncate text-xl font-semibold tabular-nums text-gray-900"
            data-testid={`${props.dataTestId}-value`}
          >
            {props.value}
          </div>
        </div>
      </div>
    </div>
  );
};

export interface ComponentProps {
  summary: NetworkTrafficSummary;
  windowSeconds: number;
}

const TrafficSummaryTiles: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: NetworkTrafficSummary = props.summary;

  return (
    <div>
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="traffic-tiles"
      >
        <TrafficTile
          label="Traffic"
          value={formatTrafficBytes(summary.totals.octets)}
          help={TILE_HELP.traffic}
          icon={IconProp.ArrowUpDown}
          tone="bg-indigo-50 text-indigo-600"
          dataTestId="traffic-tile-total"
        />
        <TrafficTile
          label="Average"
          value={formatBitsPerSecond(
            getBitsPerSecond(summary.totals.octets, props.windowSeconds),
          )}
          help={TILE_HELP.average}
          icon={IconProp.Gauge}
          tone="bg-sky-50 text-sky-600"
          dataTestId="traffic-tile-average"
        />
        <TrafficTile
          label="Peak"
          value={formatBitsPerSecond(
            getPeakBitsPerSecond(summary.series, summary.bucketSeconds),
          )}
          help={TILE_HELP.peak}
          icon={IconProp.Bolt}
          tone="bg-amber-50 text-amber-600"
          dataTestId="traffic-tile-peak"
        />
        <TrafficTile
          label="Flows"
          value={translator.formatNumber(summary.totals.flows)}
          help={TILE_HELP.flows}
          icon={IconProp.FlowDiagram}
          tone="bg-emerald-50 text-emerald-600"
          dataTestId="traffic-tile-flows"
        />
      </div>
      {summary.maxSamplingRate > 1 ? (
        <div
          className="mt-2 flex items-center gap-1.5 text-xs text-gray-500"
          data-testid="traffic-sampled-note"
        >
          <Icon icon={IconProp.Info} className="h-3.5 w-3.5 text-gray-400" />
          <span>
            {translator.translateTemplate(
              "Estimated from sampled traffic (up to 1 in {{rate}} packets).",
              { rate: translator.formatNumber(summary.maxSamplingRate) },
            )}
          </span>
          <InfoTooltip label="Sampled" text={TILE_HELP.sampled} />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TrafficSummaryTiles;
