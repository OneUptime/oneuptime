import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { withTranslatedSeriesNames } from "Common/UI/Components/Charts/Utils/SeriesNames";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  ChartTimeRangeZoomContextValue,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { getDrawnLanguage } from "Common/UI/Components/SideMenu/SideMenuEntryState";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  getTileTitleWordsClassName,
  TILE_TITLE_LONG_WORDS,
} from "./TileTitleWords";
import HyphenatedWords from "Common/UI/Components/HyphenatedWords/HyphenatedWords";

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
  // The chart's name, as an English literal: the card translates it.
  title: string;
  icon: IconProp;
  iconColor: ChartCardColor;
  /*
   * The lines it plots, each named by the page in English ("Requests",
   * "Page loads", "p95", a catalog metric's title): the legend, the hover
   * line and the tooltip name them in the reader's language
   * (withTranslatedSeriesNames). A name the locale has no words for reads
   * as given.
   */
  series: Array<SeriesPoint>;
  windowStart: Date | null;
  windowEnd: Date | null;
  syncId: string;
  yLegend?: string | undefined;
  yMax?: number | "auto" | undefined;
  yFormatter?: ((value: number) => string) | undefined;
  /*
   * false keeps the y ticks on whole numbers (a count of connections or
   * nodes); unset, the axis may pick decimal ticks as it always has.
   */
  yAllowDecimals?: boolean | undefined;
  showLegend?: boolean | undefined;
  loading?: boolean | undefined;
  // What the chart plots, shown in an (i) tooltip beside the title.
  description?: string | undefined;
  /*
   * What the empty box says instead of "No data in this time range" when
   * the page knows why the chart is empty ("Needs consumer traces"): an
   * English literal the card draws in the reader's language.
   */
  emptyMessage?: string | undefined;
  // A link or a line drawn under it: where to read what fills the chart.
  emptyAction?: ReactElement | undefined;
  /*
   * Moments to mark on the chart - an app's deploys - as the metric charts
   * mark incidents and changes: a hairline through the plot, its words in
   * the chip above it.
   */
  timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
  /*
   * What the card says when nothing is in the range, in place of "No data
   * in this time range": why, and what to do (a RUM application's
   * Exceptions and Logs say whether the signal is set up, issue #5770).
   * Drawn in the same grey box, which grows to hold it.
   */
  emptyContent?: ReactElement | undefined;
  /*
   * The step of the time axis, when the page knows it: a chart of one point
   * a day (Product Analytics) passes XAxisPrecision.EVERY_DAY, so its ticks
   * name days ("07 Nov") however short or long the window is - never the
   * clock times a window of a few days gets ("07 Nov, 00:00"), and never
   * days averaged into weeks or months over a long one. Unset, the axis
   * picks its step from the window's length, as every other card's does.
   */
  xAxisPrecision?: XAxisPrecision | undefined;
}

const ChartCard: FunctionComponent<ChartCardProps> = (
  props: ChartCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const colors: { bg: string; ring: string; text: string } =
    colorClasses[props.iconColor];
  /*
   * The card names its chart in the reader's language, from the English a
   * page hands it ("Queries from applications"), in all three states below;
   * the (i) takes the English and words its own label. A word too long for
   * the header's line breaks where its language hyphenates it, as a tile's
   * title does (TileTitleWords), rather than run under the icon.
   */
  const title: string = translator.translateText(props.title) || props.title;
  const titleLanguage: string | undefined = getDrawnLanguage({
    english: props.title,
    drawn: title,
    language: translator.language,
  });
  // The page's drag-to-zoom (TimeRangeZoomScope), which the chart takes.
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();

  const hasData: boolean = props.series.some((s: SeriesPoint): boolean => {
    return s.data.length > 0;
  });

  const isSkeletonShown: boolean = Boolean(
    props.loading || !props.windowStart || !props.windowEnd,
  );

  // A reset the empty box below takes, set only while the page is zoomed.
  const emptyStateReset: (() => void) | undefined = pageZoom?.onTimeRangeReset;

  /*
   * Name a gesture only where the body takes one: the chart takes the drag
   * (and the double-click while zoomed), and the empty box takes the
   * double-click while zoomed. The skeleton takes neither, and nor does the
   * empty box with nothing to reset. The icon beside the hint sets the
   * header's height, so the hint can come and go without moving anything.
   */
  const isZoomHintShown: boolean =
    !isSkeletonShown && (hasData || Boolean(emptyStateReset));

  const header: ReactElement = (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={`min-w-0 text-xs font-medium text-gray-500 uppercase tracking-wider ${getTileTitleWordsClassName(
            { text: title, lang: titleLanguage },
          )}`}
          lang={titleLanguage}
        >
          <HyphenatedWords
            text={title}
            lang={titleLanguage}
            rule={TILE_TITLE_LONG_WORDS}
          />
        </span>
        <InfoTooltip label={props.title} text={props.description} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isZoomHintShown ? <TimeRangeZoomHint revealOnHover={true} /> : <></>}
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
    </div>
  );

  // The window checks repeat isSkeletonShown's so the axis below gets dates.
  if (isSkeletonShown || !props.windowStart || !props.windowEnd) {
    return (
      <div className="group/zoomhint rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <div className="h-44 animate-pulse rounded-md bg-gray-50" />
      </div>
    );
  }

  if (!hasData) {
    const emptyMessage: string = props.emptyMessage
      ? translator.translateText(props.emptyMessage) || props.emptyMessage
      : translator.translateText("No data in this time range") ||
        "No data in this time range";
    /*
     * A zoom into a quiet stretch lands here, with no chart to
     * double-click. The empty plot area takes the double-click instead, so
     * the way back is where the reader's pointer already is. While it does,
     * its text is not selectable: a double-click on text also selects a
     * word, and the hosts keep this very box on screen through the refetch
     * a reset starts (and for good if the page's own range is quiet too),
     * so the word stayed highlighted.
     */
    /*
     * The box fills the card: beside a card whose message is longer, in
     * the same row, both grey boxes end on one line.
     */
    if (props.emptyContent) {
      return (
        <div className="group/zoomhint flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {header}
          <div
            className={`flex min-h-44 flex-1 flex-col rounded-md bg-gray-50${
              emptyStateReset ? " select-none" : ""
            }`}
            onDoubleClick={emptyStateReset}
            data-testid="chart-card-empty-content"
          >
            {props.emptyContent}
          </div>
        </div>
      );
    }

    return (
      <div className="group/zoomhint rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <div
          className={`flex h-44 items-center justify-center rounded-md bg-gray-50 text-sm text-gray-400${
            emptyStateReset ? " select-none" : ""
          }`}
          onDoubleClick={emptyStateReset}
        >
          {/*
           * Every page's empty chart, in the reader's language - or what the
           * page says fills it, with where to read how. Balanced, so a label
           * that needs two lines splits evenly and never leaves its arrow on
           * a line of its own.
           */}
          {props.emptyAction ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-balance">
              <span>{emptyMessage}</span>
              {props.emptyAction}
            </div>
          ) : (
            emptyMessage
          )}
        </div>
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
      precision: props.xAxisPrecision,
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
            /*
             * A count as the page's tiles and the time axis write numbers
             * in the reader's language: "20,000", "20.000", "۲۰٬۰۰۰" - never
             * a bare "20000" beside a "12,480" tile.
             */
            return translator.formatNumber(Math.round(value));
          },
    },
  };

  /*
   * The chart sits at the foot of the card. Cards side by side in a row
   * grow to the tallest one - a title on two lines, a legend on three - and
   * their plots and time axes still line up, as the hover line they share
   * (syncId) runs across them.
   */
  return (
    <div className="group/zoomhint flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {header}
      <div className="mt-auto" data-testid="chart-card-chart">
        <LineChartElement
          data={withTranslatedSeriesNames(props.series, translator)}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={ChartCurve.MONOTONE}
          sync={true}
          syncid={props.syncId}
          heightInPx={176}
          /*
           * A legend that wraps (three long series names on a phone, or in
           * German) adds its lines to the card instead of squeezing the plot.
           */
          growsWhenLegendWraps={true}
          showLegend={props.showLegend ?? false}
          allowDecimals={props.yAllowDecimals}
          timeReferenceLines={props.timeReferenceLines}
        />
      </div>
    </div>
  );
};

export default ChartCard;
