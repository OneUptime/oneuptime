import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Route from "Common/Types/API/Route";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import AppLink from "../AppLink/AppLink";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
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
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";

export type ChartCardColor =
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "sky"
  | "rose";

const colorClasses: Record<
  ChartCardColor,
  { bg: string; ring: string; text: string }
> = {
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
};

export interface ChartCardProps {
  title: string;
  icon: IconProp;
  iconColor: ChartCardColor;
  series: Array<SeriesPoint>;
  windowStart: Date | null;
  windowEnd: Date | null;
  syncId: string;
  // Small muted line under the title qualifying what the chart measures.
  sublabel?: string | undefined;
  // Longer explanation shown behind an info icon next to the title.
  tooltip?: string | undefined;
  // Optional link rendered under the chart, e.g. to a related page.
  footerLink?: { title: string; to: Route } | undefined;
  yLegend?: string | undefined;
  yMax?: number | "auto" | undefined;
  yFormatter?: ((value: number) => string) | undefined;
  showLegend?: boolean | undefined;
  loading?: boolean | undefined;
}

const ChartCard: FunctionComponent<ChartCardProps> = (
  props: ChartCardProps,
): ReactElement => {
  const colors: { bg: string; ring: string; text: string } =
    colorClasses[props.iconColor];

  const header: ReactElement = (
    <div className="flex items-start justify-between mb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {props.title}
          </span>
          {props.tooltip && (
            <Tooltip text={props.tooltip}>
              <span className="flex items-center">
                <Icon
                  icon={IconProp.Info}
                  className="h-3.5 w-3.5 cursor-help text-gray-300 hover:text-gray-400"
                />
              </span>
            </Tooltip>
          )}
        </div>
        {props.sublabel && (
          <p className="mt-0.5 truncate text-[11px] text-gray-400">
            {props.sublabel}
          </p>
        )}
      </div>
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
      >
        <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
      </div>
    </div>
  );

  const footerLink: ReactElement | null = props.footerLink ? (
    <div className="mt-2 text-right">
      <AppLink
        to={props.footerLink.to}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
      >
        {`${props.footerLink.title} →`}
      </AppLink>
    </div>
  ) : null;

  const hasData: boolean = props.series.some((s: SeriesPoint): boolean => {
    return s.data.length > 0;
  });

  if (props.loading || !props.windowStart || !props.windowEnd) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <div className="h-44 animate-pulse rounded-md bg-gray-50" />
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <div className="flex h-44 items-center justify-center rounded-md bg-gray-50 text-sm text-gray-400">
          No data in this time range
        </div>
        {footerLink}
      </div>
    );
  }

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: props.windowStart,
      max: props.windowEnd,
      aggregateType: XAxisAggregateType.Average,
    },
  };

  const yAxis: YAxis = {
    legend: props.yLegend ?? "",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: props.yMax ?? "auto",
      precision: YAxisPrecision.NoDecimals,
      formatter: props.yFormatter
        ? (value: number): string => {
            return props.yFormatter!(value);
          }
        : (value: number): string => {
            return String(Math.round(value));
          },
    },
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {header}
      <LineChartElement
        data={props.series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        sync={true}
        syncid={props.syncId}
        heightInPx={176}
        showLegend={props.showLegend ?? false}
      />
      {footerLink}
    </div>
  );
};

export default ChartCard;
