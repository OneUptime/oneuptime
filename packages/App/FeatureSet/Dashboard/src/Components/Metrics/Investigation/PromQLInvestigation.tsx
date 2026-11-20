import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useMemo,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
import Card from "Common/UI/Components/Card/Card";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PromQLMonitorChart from "../PromQL/PromQLMonitorChart";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import useEventTimeReferenceLines, {
  EventTimeReferenceLines,
} from "../Utils/UseEventTimeReferenceLines";
import {
  getReferenceLinesInWindow,
  getReferenceRegionsInWindow,
} from "./MetricInvestigationAnnotations";
import { MetricInvestigationThreshold } from "./MetricInvestigationThresholds";
import MetricInvestigationTimePicker from "./MetricInvestigationTimePicker";
import { InvestigationTimeRangeState } from "./UseInvestigationTimeRange";

/*
 * A METRICS MONITOR WRITTEN IN PROMQL, CHARTED WHERE ITS PEOPLE LOOK
 * (issue #10227): on the monitor's Overview, every series of its expression;
 * on an incident or alert it opened, the one series that opened it.
 *
 * What someone paged needs to see at a glance: the series, the value the
 * monitor alerts at as a line, the side that alerts shaded, and when the
 * monitor's status changed and its incidents and alerts opened, marked on
 * the timeline (PromQLMonitorChart). The expression it charts is written
 * above it, as the monitor evaluates it.
 *
 * It holds no time range of its own: the page holds one
 * (useInvestigationTimeRange, or an event's metric investigation), so the
 * picker, a drag across the chart and a link keep it as on every metric
 * card - and an event's Logs, Traces and Exceptions tabs follow it.
 */

export const PROMQL_INVESTIGATION_TEST_ID: string = "promql-investigation";
export const PROMQL_INVESTIGATION_QUERY_TEST_ID: string =
  "promql-investigation-query";

const HEADER_ICON_BUTTON_CLASS_NAME: string =
  "flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer border bg-gray-50 border-gray-200/60 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

export interface ComponentProps {
  // The time range, held by the page.
  time: InvestigationTimeRangeState;
  // The expression the monitor evaluates.
  query: string;
  // English; "Metrics" when left out.
  title?: string | undefined;
  description?: string | undefined;
  // The services the monitor reads; none: every service the viewer may read.
  serviceIds?: Array<string> | undefined;
  /*
   * The labels of the one series an incident or alert opened for, as the
   * monitor named it: the chart draws that series alone. None: every
   * series of the expression.
   */
  seriesLabels?: JSONObject | undefined;
  // The values the monitor alerts at, drawn across the chart.
  thresholds?: Array<MetricInvestigationThreshold> | undefined;
  // The page's own moments, marked on the chart: status changes, an event's.
  moments?: Array<ChartTimeReferenceLineProps> | undefined;
  // Spans shaded across the chart, such as what the monitor evaluated.
  regions?: Array<ChartReferenceRegionProps> | undefined;
  // Mark this monitor's incidents and alerts (a monitor's own page).
  monitorId?: string | undefined;
  // English heading above the time ranges the page anchors.
  presetsHeading?: string | undefined;
  relativeRanges?: Array<TimeRange> | undefined;
  // Above the chart: what the page lets the reader pick first.
  beforeToolbar?: ReactNode | undefined;
  // Said in the chart's place when the expression returned no series.
  emptyState?: ReactNode | undefined;
}

const PromQLInvestigation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const time: InvestigationTimeRangeState = props.time;

  /*
   * The monitor's incidents and alerts, on its own page. An expression names
   * no resource the project's other events could be matched with, so an
   * event's card marks only its own moments (`moments`), never every
   * incident of the project.
   */
  const { lines: eventLines }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: Boolean(props.monitorId),
      window: time.window,
      queryConfigs: [],
      refreshTick: time.refreshNonce,
      monitorId: props.monitorId,
    });

  const timeReferenceLines: Array<ChartTimeReferenceLineProps> = useMemo(() => {
    return [
      ...getReferenceLinesInWindow(props.moments || [], time.window),
      ...eventLines,
    ];
  }, [props.moments, time.window, eventLines]);

  const referenceRegions: Array<ChartReferenceRegionProps> = useMemo(() => {
    return getReferenceRegionsInWindow(props.regions || [], time.window);
  }, [props.regions, time.window]);

  const openInPromQL: string = translator.translateTemplate(
    "Open in {{page}}",
    { page: "PromQL" },
  );

  const header: ReactElement = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <MetricInvestigationTimePicker
        investigation={time}
        presetsHeading={props.presetsHeading}
        relativeRanges={props.relativeRanges}
      />
      <Tooltip text="Refresh">
        <button
          type="button"
          aria-label={translator.translateText("Refresh")}
          className={HEADER_ICON_BUTTON_CLASS_NAME}
          onClick={time.refresh}
        >
          <Icon icon={IconProp.Refresh} className="h-4 w-4 text-gray-500" />
        </button>
      </Tooltip>
      <Tooltip text={openInPromQL} isTextTranslated={true}>
        <button
          type="button"
          aria-label={openInPromQL}
          className={HEADER_ICON_BUTTON_CLASS_NAME}
          onClick={() => {
            // The Metrics page's PromQL tab, on this expression.
            const page: Route = RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_PROMQL] as Route,
            );

            Navigation.navigate(
              new Route(
                `${page.toString()}?query=${encodeURIComponent(props.query)}`,
              ),
            );
          }}
        >
          <Icon
            icon={IconProp.ExternalLink}
            className="h-4 w-4 text-gray-500"
          />
        </button>
      </Tooltip>
    </div>
  );

  return (
    <TimeRangeZoomProvider zoom={time.zoom}>
      <Card
        title={props.title || "Metrics"}
        description={props.description}
        rightElement={header}
      >
        <div className="space-y-4" data-testid={PROMQL_INVESTIGATION_TEST_ID}>
          {props.beforeToolbar ? props.beforeToolbar : <></>}
          {/* What is charted, as written: the expression the monitor evaluates. */}
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
              {translator.translateText("PromQL")}
            </span>
            <code
              className="min-w-0 break-all font-mono text-xs leading-5 text-gray-800"
              dir="ltr"
              data-testid={PROMQL_INVESTIGATION_QUERY_TEST_ID}
            >
              {props.query}
            </code>
          </div>
          <PromQLMonitorChart
            query={props.query}
            window={time.window}
            serviceIds={props.serviceIds}
            seriesLabels={props.seriesLabels}
            thresholds={props.thresholds}
            timeReferenceLines={timeReferenceLines}
            referenceRegions={referenceRegions}
            /*
             * A drag zooms the card - and whatever follows its time range -
             * and a double-click, or Reset zoom beside the picker, goes back.
             */
            onTimeRangeSelect={time.zoom.zoomToTimeRange}
            onTimeRangeReset={time.isZoomed ? time.zoom.resetZoom : undefined}
            refreshKey={time.refreshNonce}
            emptyState={props.emptyState}
          />
        </div>
      </Card>
    </TimeRangeZoomProvider>
  );
};

export default PromQLInvestigation;
