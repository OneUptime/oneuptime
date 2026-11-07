import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import TimeRange from "Common/Types/Time/TimeRange";
import { getTimeRangeLabel } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import Card from "Common/UI/Components/Card/Card";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import {
  Translator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MetricView from "../MetricView";
import ExplorerLink from "../Utils/ExplorerLink";
import useEventTimeReferenceLines, {
  EventTimeReferenceLines,
} from "../Utils/UseEventTimeReferenceLines";
import { MetricInvestigationQueries } from "./MetricInvestigationQueries";
import { MetricResultsState } from "../Utils/MetricResultsState";
import {
  DrawnThresholds,
  MetricInvestigationThreshold,
  getDrawnThresholds,
  getRangeShowingHiddenThresholds,
} from "./MetricInvestigationThresholds";
import MetricInvestigationTimePicker from "./MetricInvestigationTimePicker";
import { MetricInvestigationState } from "./UseMetricInvestigation";
import {
  getReferenceLinesInWindow,
  getReferenceRegionsInWindow,
} from "./MetricInvestigationAnnotations";

export interface ComponentProps {
  // From useMetricInvestigation, held by the page.
  investigation: MetricInvestigationState;
  // English; "Metrics" when left out.
  title?: string | undefined;
  // What the card says while it charts the page's own metrics.
  description?: string | undefined;
  // What it says once the reader changed the metrics.
  changedDescription?: string | undefined;
  // English heading above the time ranges the page anchors.
  presetsHeading?: string | undefined;
  // The ranges relative to now to offer; every one if left out.
  relativeRanges?: Array<TimeRange> | undefined;
  /*
   * The page's own moments, marked on every chart: an incident's start,
   * acknowledgement and resolution. Only the ones in the window are drawn.
   */
  moments?: Array<ChartTimeReferenceLineProps> | undefined;
  // Spans to shade on every chart, such as what a monitor evaluated.
  regions?: Array<ChartReferenceRegionProps> | undefined;
  /*
   * Other incidents, alerts and changes in the window are marked as on
   * every metric chart; these are left off (the page's own, which it marks
   * through `moments`).
   */
  excludedIncidentIds?: Array<string> | undefined;
  excludedAlertIds?: Array<string> | undefined;
  /*
   * Mark this monitor's incidents and alerts, rather than those the
   * charts' resource filters find (a monitor's own page).
   */
  monitorId?: string | undefined;
  /*
   * Lines for values the page's own metrics are compared with - a
   * monitor's thresholds - each drawn while its metric is as the page
   * started it, at a range whose points hold it (see
   * MetricInvestigationThresholds).
   */
  thresholds?: Array<MetricInvestigationThreshold> | undefined;
  // Above the card's toolbar: what the page lets the reader pick first.
  beforeToolbar?: ReactNode | undefined;
  /*
   * Said above the charts once they have loaded and found nothing: what to
   * check. Never while they load, and never when the read failed.
   */
  emptyState?: ReactNode | undefined;
}

const HEADER_ICON_BUTTON_CLASS_NAME: string =
  "flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer border bg-gray-50 border-gray-200/60 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const TOOLBAR_BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

export const METRIC_INVESTIGATION_TEST_ID: string = "metric-investigation";
export const METRIC_INVESTIGATION_EMPTY_TEST_ID: string =
  "metric-investigation-empty";
export const METRIC_INVESTIGATION_THRESHOLD_HINT_TEST_ID: string =
  "metric-investigation-threshold-hint";

/**
 * Metrics to investigate right where they are shown (issue #5954): the
 * charts of a few metrics, with the time range to read them over - ranges
 * anchored on what the page is about first ("Around the start" of an
 * incident) - and the metric explorer's own query builder, folded away
 * under "Edit metrics", to change a metric, add one, filter or group it.
 *
 * The page's moments are marked on every chart, along with the incidents,
 * alerts and changes in the window, and a drag across a chart zooms in.
 * "Open in Metric Explorer" carries the same metrics and time range to the
 * explorer, for whoever wants it all; the point is that nobody has to.
 *
 * Shows a useMetricInvestigation the page holds, so the investigation
 * outlives this card being swapped out (a tab switch) and the page can hand
 * its time range to whatever else should follow it.
 */
const MetricInvestigation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const investigation: MetricInvestigationState = props.investigation;
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const { lines: eventLines }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: true,
      window: investigation.window,
      queryConfigs: investigation.queries.queryConfigs,
      refreshTick: investigation.refreshNonce,
      excludedIncidentIds: props.excludedIncidentIds,
      excludedAlertIds: props.excludedAlertIds,
      monitorId: props.monitorId,
    });

  const timeReferenceLines: Array<ChartTimeReferenceLineProps> = useMemo(() => {
    return [
      ...getReferenceLinesInWindow(props.moments || [], investigation.window),
      ...eventLines,
    ];
  }, [props.moments, investigation.window, eventLines]);

  const referenceRegions: Array<ChartReferenceRegionProps> = useMemo(() => {
    return getReferenceRegionsInWindow(
      props.regions || [],
      investigation.window,
    );
  }, [props.regions, investigation.window]);

  const thresholds: DrawnThresholds = useMemo((): DrawnThresholds => {
    return getDrawnThresholds({
      thresholds: props.thresholds,
      defaultQueries: investigation.defaultQueries,
      queries: investigation.queries,
      window: investigation.window,
    });
  }, [
    props.thresholds,
    investigation.defaultQueries,
    investigation.queries,
    investigation.window,
  ]);

  // The range whose points hold the lines this one cannot show.
  const rangeShowingHiddenThresholds: TimeRange | null =
    getRangeShowingHiddenThresholds(thresholds.hiddenAtThisRange);

  const [resultsState, setResultsState] = useState<MetricResultsState>(
    MetricResultsState.Loading,
  );

  const onMetricViewChange: (data: MetricViewData) => void = useCallback(
    (data: MetricViewData): void => {
      // The window is the investigation's to pick; only the metrics change.
      const queries: MetricInvestigationQueries = {
        queryConfigs: data.queryConfigs,
        formulaConfigs: data.formulaConfigs,
      };
      investigation.setQueries(queries);
    },
    [investigation.setQueries],
  );

  const isChanged: boolean =
    investigation.isTimeChanged || investigation.isQueriesChanged;

  const header: ReactElement = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <MetricInvestigationTimePicker
        investigation={investigation}
        presetsHeading={props.presetsHeading}
        relativeRanges={props.relativeRanges}
      />
      <Tooltip text="Refresh">
        <button
          type="button"
          aria-label={translator.translateText("Refresh")}
          className={HEADER_ICON_BUTTON_CLASS_NAME}
          onClick={investigation.refresh}
        >
          <Icon icon={IconProp.Refresh} className="h-4 w-4 text-gray-500" />
        </button>
      </Tooltip>
      <Tooltip text="Open in Metric Explorer">
        <button
          type="button"
          aria-label={translator.translateText("Open in Metric Explorer")}
          className={HEADER_ICON_BUTTON_CLASS_NAME}
          onClick={() => {
            ExplorerLink.openInExplorer(investigation.metricViewData);
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

  const description: string | undefined = investigation.isQueriesChanged
    ? props.changedDescription ||
      translator.translateText("The metrics you picked.")
    : props.description;

  return (
    <TimeRangeZoomProvider zoom={investigation.zoom}>
      <Card
        title={props.title || "Metrics"}
        description={description}
        rightElement={header}
      >
        <div className="space-y-4" data-testid={METRIC_INVESTIGATION_TEST_ID}>
          {props.beforeToolbar ? props.beforeToolbar : <></>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className={TOOLBAR_BUTTON_CLASS_NAME}
              aria-expanded={isEditing}
              onClick={() => {
                setIsEditing(!isEditing);
              }}
            >
              <Icon
                icon={isEditing ? IconProp.Check : IconProp.Edit}
                className="h-3.5 w-3.5"
              />
              {isEditing
                ? translator.translateText("Done")
                : translator.translateText("Edit metrics")}
            </button>
            {isChanged ? (
              <div className="flex flex-wrap items-center gap-2">
                {/*
                 * What the reader changed is in the page's URL, so this
                 * link opens the very same charts for whoever it is sent to.
                 */}
                {investigation.shareUrl ? (
                  <CopyTextButton
                    textToBeCopied={investigation.shareUrl}
                    label="Copy link"
                    copiedLabel="Link copied"
                    title="Copy a link to these charts"
                    size="sm"
                    variant="ghost"
                    className="bg-white font-medium text-gray-700 shadow-sm"
                  />
                ) : (
                  <></>
                )}
                <Tooltip text="Go back to the metrics and time range you started from">
                  <button
                    type="button"
                    className={TOOLBAR_BUTTON_CLASS_NAME}
                    onClick={() => {
                      investigation.reset();
                      setIsEditing(false);
                    }}
                  >
                    <Icon
                      icon={IconProp.ArrowUturnLeft}
                      className="h-3.5 w-3.5"
                    />
                    {translator.translateText("Reset")}
                  </button>
                </Tooltip>
              </div>
            ) : (
              <></>
            )}
          </div>

          {props.emptyState && resultsState === MetricResultsState.Empty ? (
            <div data-testid={METRIC_INVESTIGATION_EMPTY_TEST_ID}>
              {props.emptyState}
            </div>
          ) : (
            <></>
          )}

          {thresholds.hiddenAtThisRange.length > 0 ? (
            /*
             * A line on a sum or a count holds only where each point covers
             * what the monitor reads: say why it is not on these charts,
             * and offer the range that shows it.
             */
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
              data-testid={METRIC_INVESTIGATION_THRESHOLD_HINT_TEST_ID}
            >
              <Icon icon={IconProp.Info} className="h-3.5 w-3.5 text-gray-400" />
              <span>
                {translator.translateText(
                  "Thresholds on counts show only on ranges whose points cover what the monitor reads.",
                )}
              </span>
              {rangeShowingHiddenThresholds ? (
                <button
                  type="button"
                  className="font-medium text-indigo-600 hover:underline focus:outline-none focus-visible:underline"
                  onClick={() => {
                    investigation.selectPickerValue({
                      range: rangeShowingHiddenThresholds,
                    });
                  }}
                >
                  {translator.translateTemplate("Show {{range}}", {
                    range: translatableTerm(
                      getTimeRangeLabel(rangeShowingHiddenThresholds),
                    ),
                  })}
                </button>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}

          <MetricView
            data={investigation.metricViewData}
            hideQueryElements={!isEditing}
            hideStartAndEndDate={true}
            chartCssClass="rounded-lg border border-gray-200 shadow-sm"
            refreshNonce={investigation.refreshNonce}
            timeReferenceLines={
              timeReferenceLines.length > 0 ? timeReferenceLines : undefined
            }
            referenceRegions={
              referenceRegions.length > 0 ? referenceRegions : undefined
            }
            /*
             * A drag zooms the investigation - and whatever follows its time
             * range - and a double-click, or Reset zoom beside the picker,
             * goes back to the range from before.
             */
            onTimeRangeSelect={investigation.zoom.zoomToTimeRange}
            onTimeRangeReset={
              investigation.isZoomed ? investigation.zoom.resetZoom : undefined
            }
            thresholds={
              thresholds.drawn.length > 0 ? thresholds.drawn : undefined
            }
            onResultsStateChange={setResultsState}
            onChange={onMetricViewChange}
          />
        </div>
      </Card>
    </TimeRangeZoomProvider>
  );
};

export default MetricInvestigation;
