import Text from "../../../../Types/Text";
import Dictionary from "../../../../Types/Dictionary";
import { getUnitNameInLanguage } from "../Utils/UnitNames";
import LineChart, { ComponentProps as LineChartProps } from "../Line/LineChart";
import BarChartElement, {
  ComponentProps as BarChartProps,
} from "../Bar/BarChart";
import AreaChartElement, {
  ComponentProps as AreaChartProps,
} from "../Area/AreaChart";
import ExemplarPoint from "../Types/ExemplarPoint";
import XAxisType from "../Types/XAxis/XAxisType";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../TimeRangeZoom/TimeRangeZoomContext";
import Icon, { SizeProp } from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import Modal, { ModalWidth } from "../../Modal/Modal";
import DictionaryFilterSentence from "../../Dictionary/DictionaryFilterSentence";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import {
  getLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../Utils/LineDirection";
import { ReadingDirection } from "../../../../Types/ReadingDirection";
import TimeRangeZoomHint from "../TimeRangeZoom/TimeRangeZoomHint";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * A CHART'S TITLE ROW: the title, its (i) and explorer icons, then the zoom
 * hint. The title is the one thing the row must say. The title and its
 * icons are one group that never wraps (the title is cut at its end only
 * when it is wider than the whole row), and the row wraps: when the hint
 * does not fit beside the title it goes on a line of its own under it,
 * kept to the row's end. It never takes the title's room, as it did when
 * the two shared one line and only the title could shrink (#8048).
 */
export const CHART_TITLE_ROW_TEST_ID: string = "chart-title-row";
export const CHART_TITLE_ROW_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-3";
export const CHART_TITLE_GROUP_CLASS_NAME: string =
  "flex min-w-0 max-w-full items-center";
export const CHART_TITLE_ROW_HINT_CLASS_NAME: string =
  "ml-auto max-w-full truncate";

/*
 * A chart's card, and the box its plot is drawn in, when the charts are
 * drawn as cards (not hideCard): a reader's measure of how tall a chart is.
 */
export const CHART_CARD_TEST_ID: string = "chart-group-card";
export const CHART_CARD_PLOT_TEST_ID: string = "chart-group-card-plot";

export enum ChartType {
  LINE = "line",
  BAR = "bar",
  AREA = "area",
}

export interface ChartMetricInfo {
  metricName: string;
  aggregationType: string;
  /*
   * The query's attribute filters as they are stored - a bare value for
   * equality, an operator's value otherwise - each said as one sentence
   * in the reader's language (DictionaryFilterSentence).
   */
  attributes?: Dictionary<unknown> | undefined;
  groupByAttribute?: string | undefined;
  unit?: string | undefined;
}

export interface Chart {
  id: string;
  title: string;
  description?: string | undefined;
  type: ChartType;
  props: LineChartProps | BarChartProps | AreaChartProps;
  metricInfo?: ChartMetricInfo | undefined;
  exemplarPoints?: Array<ExemplarPoint> | undefined;
  onExemplarClick?: ((exemplar: ExemplarPoint) => void) | undefined;
  /**
   * Optional "Open in Explorer" action rendered as an icon button in the
   * chart header next to the info icon. Kept as a plain callback so this
   * shared component stays free of any app's routing — callers build the
   * explorer URL and navigate themselves.
   */
  onOpenInExplorer?: (() => void) | undefined;
  /**
   * Optional control panel rendered directly below the chart body. Used by
   * per-series-grouped metric charts to surface a search box, a sort
   * control, per-series toggles, and a "show all" escape hatch so the chart
   * stays usable at thousands of unique label combinations.
   */
  seriesControls?: ReactElement | undefined;
}

export interface ComponentProps {
  charts: Array<Chart>;
  hideCard?: boolean | undefined;
  chartCssClass?: string | undefined;
  /**
   * Share one crosshair-sync channel across SEVERAL ChartGroup instances
   * (e.g. every metric widget on one dashboard passes the dashboard id,
   * so hovering an instant on one widget highlights it on all of them).
   * Absent → this group syncs only within itself.
   */
  syncId?: string | undefined;
  /*
   * Without its card, a chart's plot takes whatever height the panel has
   * left after the title and the series controls. In a panel that can grow
   * (a monitor overview column), that squeezed the plot to a sliver, so
   * those hosts set this to keep a minimum plot height and let the panel
   * grow instead. A panel with a fixed height (a dashboard widget) must
   * leave it off: it cannot grow, so a floor pushes the series controls and
   * the x-axis out of view. Only read when hideCard is set.
   */
  minPlotHeight?: boolean | undefined;
}

const ChartGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Stable per-mount fallback: a plain const regenerated the id on every
   * render, which forced recharts to tear down and re-subscribe its sync
   * listeners on each parent re-render (auto-refresh ticks included).
   */
  const [fallbackSyncId] = useState<string>(() => {
    return Text.generateRandomText(10);
  });
  const syncId: string = props.syncId || fallbackSyncId;
  const [metricInfoModalChart, setMetricInfoModalChart] =
    useState<ChartMetricInfo | null>(null);
  // The page's zoom, which every chart below takes unless it has its own.
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();

  type GetChartContentFunction = (chart: Chart, index: number) => ReactElement;

  const getChartContent: GetChartContentFunction = (
    chart: Chart,
    index: number,
  ): ReactElement => {
    /*
     * When the chart has its own seriesControls panel, that panel doubles
     * as a colored, interactive legend — so we suppress the built-in
     * Recharts legend to avoid showing two legends for the same series.
     */
    const showLegend: boolean = !chart.seriesControls;

    switch (chart.type) {
      case ChartType.LINE:
        return (
          <LineChart
            key={index}
            {...(chart.props as LineChartProps)}
            syncid={syncId}
            exemplarPoints={chart.exemplarPoints}
            onExemplarClick={chart.onExemplarClick}
            showLegend={showLegend}
          />
        );
      case ChartType.BAR:
        return (
          <BarChartElement
            key={index}
            {...(chart.props as BarChartProps)}
            syncid={syncId}
            showLegend={showLegend}
          />
        );
      case ChartType.AREA:
        return (
          <AreaChartElement
            key={index}
            {...(chart.props as AreaChartProps)}
            syncid={syncId}
            exemplarPoints={chart.exemplarPoints}
            onExemplarClick={chart.onExemplarClick}
            showLegend={showLegend}
          />
        );
      default:
        return <></>;
    }
  };

  type GetDragToZoomHintFunction = (chart: Chart) => ReactElement;

  // Same subtle hint the log/telemetry histograms show for drag-to-zoom.
  const getDragToZoomHint: GetDragToZoomHintFunction = (
    chart: Chart,
  ): ReactElement => {
    if (
      chart.type !== ChartType.LINE &&
      chart.type !== ChartType.AREA &&
      chart.type !== ChartType.BAR
    ) {
      return <></>;
    }

    /*
     * Resolved exactly the way the chart itself resolves them, so the hint
     * never promises a gesture the chart does not have: the chart's own
     * handlers, else the page's zoom.
     */
    const chartProps: LineChartProps | AreaChartProps | BarChartProps =
      chart.props;
    const xAxisType: XAxisType | undefined = chartProps.xAxis?.options?.type;
    const zoom: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      onTimeRangeSelect: chartProps.onTimeRangeSelect,
      onTimeRangeReset: chartProps.onTimeRangeReset,
      isTimeAxis: xAxisType === XAxisType.Time || xAxisType === XAxisType.Date,
      disableTimeRangeZoom: chartProps.disableTimeRangeZoom,
      pageZoom: pageZoom,
    });

    if (!zoom.onTimeRangeSelect) {
      return <></>;
    }

    /*
     * The shared hint, as every chart card draws it: never on a phone,
     * where no finger drags or double-clicks. On a wider card it is the
     * row's last item and gives way to the title: when the two do not fit
     * side by side it goes under the title (the row wraps), rather than
     * cut the title to a few letters (#8048). The way back out is named
     * while there is something to reset (a reset handler is supplied
     * exactly then), with the drag, since the chart can be dragged again.
     */
    return (
      <TimeRangeZoomHint
        zoom={zoom}
        namesDragWhileZoomed={true}
        className={CHART_TITLE_ROW_HINT_CLASS_NAME}
      />
    );
  };

  type GetInfoIconFunction = (chart: Chart) => ReactElement;

  const getInfoIcon: GetInfoIconFunction = (chart: Chart): ReactElement => {
    if (!chart.metricInfo) {
      return <></>;
    }

    return (
      <button
        type="button"
        className="ml-1.5 inline-flex items-center justify-center rounded-full w-5 h-5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-150"
        title={translator.translateText("View metric details")}
        onClick={() => {
          setMetricInfoModalChart(chart.metricInfo || null);
        }}
      >
        <Icon
          icon={IconProp.InformationCircle}
          size={SizeProp.Smaller}
          className="h-3.5 w-3.5"
        />
      </button>
    );
  };

  type GetExplorerIconFunction = (chart: Chart) => ReactElement;

  const getExplorerIcon: GetExplorerIconFunction = (
    chart: Chart,
  ): ReactElement => {
    if (!chart.onOpenInExplorer) {
      return <></>;
    }

    return (
      <button
        type="button"
        className="ml-1.5 inline-flex items-center justify-center rounded-full w-5 h-5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-150"
        title={translator.translateText("Open in Metric Explorer")}
        onClick={() => {
          chart.onOpenInExplorer?.();
        }}
      >
        <Icon
          icon={IconProp.ExternalLink}
          size={SizeProp.Smaller}
          className="h-3.5 w-3.5"
        />
      </button>
    );
  };

  const renderMetricInfoModal: () => ReactElement = (): ReactElement => {
    if (!metricInfoModalChart) {
      return <></>;
    }

    const attributes: Dictionary<unknown> =
      metricInfoModalChart.attributes || {};
    const attributeKeys: Array<string> = Object.keys(attributes);

    /*
     * OTel reports fraction metrics like `*.utilization` with unit "1".
     * Translate that to a human label ("Percent") for the details modal,
     * and hide the row entirely for truly dimensionless counts.
     */
    const displayUnit: string = metricInfoModalChart.unit
      ? getUnitNameInLanguage(metricInfoModalChart.unit, translator, {
          metricName: metricInfoModalChart.metricName,
        })
      : "";

    return (
      <Modal
        title="Metric Details"
        onClose={() => {
          setMetricInfoModalChart(null);
        }}
        closeButtonText="Close"
        modalWidth={ModalWidth.Normal}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                    {translator.translateText("Metric Name")}
                  </td>
                  <td className="py-2.5 text-gray-900 font-mono text-xs">
                    {metricInfoModalChart.metricName}
                  </td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                    {translator.translateText("Aggregation")}
                  </td>
                  <td className="py-2.5 text-gray-900">
                    {metricInfoModalChart.aggregationType}
                  </td>
                </tr>
                {displayUnit && (
                  <tr className="border-b border-gray-200">
                    <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                      {translator.translateText("Unit")}
                    </td>
                    <td className="py-2.5 text-gray-900">{displayUnit}</td>
                  </tr>
                )}
                {metricInfoModalChart.groupByAttribute && (
                  <tr className="border-b border-gray-200">
                    <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap">
                      {translator.translateText("Grouped By")}
                    </td>
                    <td className="py-2.5 text-gray-900 font-mono text-xs">
                      {metricInfoModalChart.groupByAttribute}
                    </td>
                  </tr>
                )}
                {attributeKeys.length > 0 && (
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-gray-500 whitespace-nowrap align-top">
                      {translator.translateText("Attributes")}
                    </td>
                    <td className="py-2.5">
                      <div className="space-y-1.5">
                        {attributeKeys.map((key: string) => {
                          return (
                            <div
                              key={key}
                              className="text-xs leading-6 text-gray-500"
                            >
                              <DictionaryFilterSentence
                                attributeKey={key}
                                value={attributes[key]}
                                keyClassName="inline-block rounded bg-gray-200 px-2 font-mono text-gray-700"
                                valueClassName="font-mono text-gray-900"
                                dataTestId="metric-info-attribute"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  };

  /*
   * A chart's title and description are its metric's, often in English: on
   * a Persian page each line reads the way it is written, so a title too
   * long for its card is cut short at its own end, not at its start, and a
   * short one still starts where the page's lines do (LineDirection).
   */
  type LineFunction = (text: string | undefined) => {
    dir: ReadingDirection | undefined;
    alignment: string;
  };

  const lineOf: LineFunction = (
    text: string | undefined,
  ): { dir: ReadingDirection | undefined; alignment: string } => {
    const dir: ReadingDirection | undefined = getLineDirection(
      text,
      translator.language,
    );

    return {
      dir,
      alignment: dir ? ` ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}` : "",
    };
  };

  // When hideCard is true, render charts in a clean vertical stack with dividers
  if (props.hideCard) {
    return (
      <>
        {renderMetricInfoModal()}
        <div className="space-y-3 flex-col flex flex-1 w-full">
          {props.charts.map((chart: Chart, index: number) => {
            return (
              <div
                key={index}
                className={`bg-white ${props.chartCssClass || ""} flex-1 flex-col flex w-full`}
              >
                <div className="px-5 pt-4 pb-4 flex flex-col flex-1">
                  <div className="mb-3 pb-3 border-b border-gray-100">
                    <div
                      data-testid={CHART_TITLE_ROW_TEST_ID}
                      className={CHART_TITLE_ROW_CLASS_NAME}
                    >
                      <div className={CHART_TITLE_GROUP_CLASS_NAME}>
                        <h3
                          className={`min-w-0 truncate text-sm font-semibold text-gray-800 tracking-tight${
                            lineOf(chart.title).alignment
                          }`}
                          dir={lineOf(chart.title).dir}
                          title={chart.title}
                        >
                          {chart.title}
                        </h3>
                        {getInfoIcon(chart)}
                        {getExplorerIcon(chart)}
                      </div>
                      {getDragToZoomHint(chart)}
                    </div>
                    {chart.description && (
                      <p
                        className={`mt-1 text-xs text-gray-500 max-md:hidden md:block${
                          lineOf(chart.description).alignment
                        }`}
                        dir={lineOf(chart.description).dir}
                      >
                        {chart.description}
                      </p>
                    )}
                  </div>
                  {/*
                   * The plot takes whatever height the panel has left. With
                   * minPlotHeight the panel grows around a floor instead;
                   * without it the plot shrinks to fit (see minPlotHeight).
                   */}
                  <div
                    data-testid="chart-group-plot"
                    className={`flex flex-1 flex-col ${
                      props.minPlotHeight ? "min-h-48" : "min-h-0"
                    }`}
                  >
                    {getChartContent(chart, index)}
                  </div>
                  {chart.seriesControls ? (
                    <div className="mt-3">{chart.seriesControls}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // When showing cards, use the grid layout
  const gridCols: string =
    props.charts.length > 1 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  return (
    <>
      {renderMetricInfoModal()}
      <div className={`grid grid-cols-1 ${gridCols} gap-4`}>
        {props.charts.map((chart: Chart, index: number) => {
          return (
            <div
              key={index}
              data-testid={CHART_CARD_TEST_ID}
              className={`flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm ${props.chartCssClass || ""}`}
            >
              {/* Header strip — title, meta icons, the always-visible zoom hint */}
              <div className="border-b border-gray-100 px-4 py-2.5">
                <div
                  data-testid={CHART_TITLE_ROW_TEST_ID}
                  className={CHART_TITLE_ROW_CLASS_NAME}
                >
                  <div className={CHART_TITLE_GROUP_CLASS_NAME}>
                    {/*
                     * No id: it was a card's, the same on every chart, and
                     * repeated on every page with two charts.
                     */}
                    <h2
                      data-testid="card-details-heading"
                      className={`min-w-0 truncate text-sm font-semibold leading-6 text-gray-900${
                        lineOf(chart.title).alignment
                      }`}
                      dir={lineOf(chart.title).dir}
                      title={chart.title}
                    >
                      {chart.title}
                    </h2>
                    {getInfoIcon(chart)}
                    {getExplorerIcon(chart)}
                  </div>
                  {getDragToZoomHint(chart)}
                </div>
                {chart.description && (
                  <p
                    data-testid="card-description"
                    className={`mt-0.5 w-full truncate text-xs text-gray-500 max-md:hidden md:block${
                      lineOf(chart.description).alignment
                    }`}
                    dir={lineOf(chart.description).dir}
                    title={chart.description}
                  >
                    {chart.description}
                  </p>
                )}
              </div>
              <div
                data-testid={CHART_CARD_PLOT_TEST_ID}
                className="flex-1 flex flex-col min-h-80 px-4 pt-3 pb-2"
              >
                {getChartContent(chart, index)}
              </div>
              {chart.seriesControls ? (
                <div className="border-t border-gray-100 px-4 py-3">
                  {chart.seriesControls}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default ChartGroup;
