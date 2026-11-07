import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds, {
  MonitorMetricThreshold,
} from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import MetricInvestigation from "../../Metrics/Investigation/MetricInvestigation";
import { MetricInvestigationTimeKind } from "../../Metrics/Investigation/MetricInvestigationTime";
import { MetricInvestigationThreshold } from "../../Metrics/Investigation/MetricInvestigationThresholds";
import useMetricInvestigation, {
  MetricInvestigationState,
} from "../../Metrics/Investigation/UseMetricInvestigation";
import { getMonitorPageRoute } from "../Overview/MonitorOverviewLinks";
import { shouldAttemptRead } from "../../../Utils/OverviewSection";
import PageMap from "../../../Utils/PageMap";
import {
  MONITOR_METRIC_EMPTY_TITLE,
  MONITOR_METRIC_STEP_URL_PARAM,
  MonitorMetricEmptyHint,
  MonitorMetricStep,
  MonitorStatusChange,
  STATUS_CHANGED_LABEL,
  STATUS_CHANGE_COLOR,
  STATUS_CHANGE_SUBTITLE,
  getMonitorMetricDefaultRange,
  getMonitorMetricEmptyHint,
  getMonitorMetricSteps,
  getMonitorMetricUrlParamPrefix,
  getMonitorResourceName,
  readMonitorMetricStepPosition,
  toMetricInvestigationThresholds,
} from "../../../Utils/MonitorMetricInvestigation";
import useMonitorStatusChanges from "./useMonitorStatusChanges";

/*
 * THE METRICS A METRIC MONITOR CHECKS, ON ITS OVERVIEW (issue #5759).
 *
 * A metric-backed monitor - Metrics, and every infrastructure type (Host,
 * Kubernetes, Proxmox, ...) - is a few queries and the values its criteria
 * alert at. Its page charts exactly that, first thing:
 *
 * - its queries as the monitor reads them, with the filters it adds (the
 *   cluster, host or fleet it watches), over a range whose points are the
 *   monitor's own (the past three hours, a minute a point, for most);
 * - its criteria's thresholds across them, the side that alerts shaded, so
 *   how close the metric is to alerting reads at a glance;
 * - when its status changed, and the incidents and alerts it opened, marked
 *   on the timeline.
 *
 * The time picker, a drag to zoom, Edit metrics, Copy link and Open in
 * Metric Explorer are the metric investigation's (MetricInvestigation),
 * and what the reader changes is kept in the page's URL. A monitor with
 * several criteria steps charts one at a time, with a step picker.
 */

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
  monitorSteps: MonitorSteps | undefined;
  /*
   * Moves when the page wants the charts read again: its Refresh, and a
   * change of the monitor's status. Not on every poll.
   */
  refreshToken?: number | undefined;
}

export const MONITOR_METRICS_CARD_TITLE: string = "Metrics";

export const MONITOR_METRICS_STEP_PICKER_TEST_ID: string =
  "monitor-metrics-step-picker";
export const MONITOR_METRICS_PERMISSION_FALLBACK_TEST_ID: string =
  "monitor-metrics-permission-fallback";
export const MONITOR_METRICS_NO_METRIC_TEST_ID: string =
  "monitor-metrics-no-metric";

const STEP_BUTTON_CLASS_NAME: string =
  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

interface StepMetricsProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
  metricStep: MonitorMetricStep;
  // Its place among the steps the card offers, from 0.
  stepPosition: number;
  defaultMonitorStatusId: unknown;
  refreshToken: number;
  stepPicker: ReactElement | undefined;
}

// One step's metrics: an investigation of their own, kept in the URL.
const MonitorStepMetrics: FunctionComponent<StepMetricsProps> = (
  props: StepMetricsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const reads: MonitorMetricStep["reads"] = props.metricStep.reads;

  /*
   * Worked out again on every poll of the page, and kept by value: an
   * equal step read again must not redraw the charts.
   */
  const monitorThresholds: Array<MonitorMetricThreshold> =
    MonitorStepMetricThresholds.getThresholds({
      monitorType: props.monitorType,
      monitorStep: props.metricStep.step,
      defaultMonitorStatusId: props.defaultMonitorStatusId,
    });
  const thresholdsKey: string = JSON.stringify(monitorThresholds);
  const thresholds: Array<MetricInvestigationThreshold> = useMemo(() => {
    return toMetricInvestigationThresholds(monitorThresholds);
  }, [thresholdsKey]);

  const investigation: MetricInvestigationState = useMetricInvestigation({
    defaultQueries: {
      queryConfigs: reads.queryConfigs,
      formulaConfigs: reads.formulaConfigs,
    },
    defaultSelection: {
      kind: MetricInvestigationTimeKind.Relative,
      range: getMonitorMetricDefaultRange(reads),
    },
    urlParamPrefix: getMonitorMetricUrlParamPrefix(props.stepPosition),
  });

  // The page's Refresh, and a change of status, read the charts again.
  const lastRefreshToken: MutableRefObject<number> = useRef<number>(
    props.refreshToken,
  );

  useEffect(() => {
    if (lastRefreshToken.current === props.refreshToken) {
      return;
    }

    lastRefreshToken.current = props.refreshToken;
    investigation.refresh();
  }, [props.refreshToken]);

  const statusChanges: Array<MonitorStatusChange> = useMonitorStatusChanges({
    monitorId: props.monitorId,
    window: investigation.window,
    refreshToken: investigation.refreshNonce,
  });

  const statusChangesKey: string = JSON.stringify(statusChanges);

  const moments: Array<ChartTimeReferenceLineProps> = useMemo(() => {
    return statusChanges.map(
      (change: MonitorStatusChange): ChartTimeReferenceLineProps => {
        return {
          date: change.date,
          // A status's name as the project wrote it; the seeded ones translate.
          label: change.statusName
            ? translator.translateTerm(change.statusName)
            : translator.translateText(STATUS_CHANGED_LABEL) ||
              STATUS_CHANGED_LABEL,
          subtitle:
            translator.translateText(STATUS_CHANGE_SUBTITLE) ||
            STATUS_CHANGE_SUBTITLE,
          color: change.color || STATUS_CHANGE_COLOR,
          kind: ChartEventKind.Generic,
        };
      },
    );
  }, [statusChangesKey, translator]);

  const resourceName: string = getMonitorResourceName(
    MonitorStepMetricQueries.getSettings({
      monitorType: props.monitorType,
      monitorStep: props.metricStep.step,
    }),
  );
  const emptyHint: MonitorMetricEmptyHint = getMonitorMetricEmptyHint(
    props.monitorType,
  );

  /*
   * What to check when the charts come back with nothing: whether the data
   * still arrives, and whether the monitor's filters match it.
   */
  const emptyState: ReactElement = (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm">
      <p className="font-medium text-gray-900">
        {translator.translateText(MONITOR_METRIC_EMPTY_TITLE)}
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-gray-600">
        <li>
          {resourceName
            ? translator.translateTemplate(emptyHint.arrival, {
                resource: resourceName,
              })
            : translator.translateText(emptyHint.arrivalWithoutResource)}
        </li>
        <li>
          {translator.translateText(emptyHint.filters)}{" "}
          <Link
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_CRITERIA,
              monitorId: props.monitorId,
            })}
            className="font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("Open criteria")}
          </Link>
        </li>
      </ul>
    </div>
  );

  const serviceCount: number = reads.telemetryServiceIds.length;

  /*
   * A Metrics monitor read for some services only narrows its rows by a
   * field a chart's filters cannot name: say so, rather than let the chart
   * pass for what the monitor saw.
   */
  const serviceNote: ReactElement | null =
    serviceCount > 0 ? (
      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <Icon icon={IconProp.Info} className="h-3.5 w-3.5 text-gray-400" />
        {translator.translatePlural(
          {
            one: "This monitor checks these metrics for {{count}} service. The charts show them for every service.",
            other:
              "This monitor checks these metrics for {{count}} services. The charts show them for every service.",
          },
          serviceCount,
        )}
      </p>
    ) : null;

  const beforeToolbar: ReactElement | undefined =
    props.stepPicker || serviceNote ? (
      <div className="space-y-2">
        {props.stepPicker || <></>}
        {serviceNote || <></>}
      </div>
    ) : undefined;

  return (
    <MetricInvestigation
      investigation={investigation}
      title={MONITOR_METRICS_CARD_TITLE}
      description={
        thresholds.length > 0
          ? translator.translateText(
              "What this monitor checks, and the values it alerts at.",
            )
          : translator.translateText("What this monitor checks.")
      }
      changedDescription={translator.translateText(
        "The metrics you picked. Reset brings back the metrics this monitor checks.",
      )}
      moments={moments}
      monitorId={props.monitorId.toString()}
      thresholds={thresholds}
      beforeToolbar={beforeToolbar}
      emptyState={emptyState}
    />
  );
};

const MonitorMetricsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const steps: Array<MonitorMetricStep> = getMonitorMetricSteps({
    monitorType: props.monitorType,
    monitorSteps: props.monitorSteps,
  });

  // The step a link picked, else the first.
  const [stepPosition, setStepPosition] = useState<number>((): number => {
    return readMonitorMetricStepPosition(
      Navigation.getQueryStringByName(MONITOR_METRIC_STEP_URL_PARAM),
      steps.length,
    );
  });

  const gate: PermissionGateResult = PermissionGate.check(
    new Metric(),
    ModelAction.Read,
  );

  if (!shouldAttemptRead(gate)) {
    return (
      <Card title={MONITOR_METRICS_CARD_TITLE}>
        <p
          className="text-sm text-gray-600"
          data-testid={MONITOR_METRICS_PERMISSION_FALLBACK_TEST_ID}
        >
          {translator.translateText(
            "Charts of this monitor's metrics need permission to read telemetry.",
          )}
        </p>
      </Card>
    );
  }

  if (steps.length === 0) {
    return (
      <Card
        title={MONITOR_METRICS_CARD_TITLE}
        description="What this monitor checks."
      >
        <p
          className="text-sm text-gray-600"
          data-testid={MONITOR_METRICS_NO_METRIC_TEST_ID}
        >
          {translator.translateText(
            "This monitor has no metric to chart yet. Pick one in its criteria.",
          )}{" "}
          <Link
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_CRITERIA,
              monitorId: props.monitorId,
            })}
            className="font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("Open criteria")}
          </Link>
        </p>
      </Card>
    );
  }

  const position: number = Math.min(stepPosition, steps.length - 1);
  const current: MonitorMetricStep = steps[position]!;

  const pickStep: (next: number) => void = (next: number): void => {
    setStepPosition(next);
    // Kept in the URL with the rest, for a reload and a link.
    Navigation.setQueryString({
      [MONITOR_METRIC_STEP_URL_PARAM]: next > 0 ? String(next + 1) : null,
    });
  };

  const stepPicker: ReactElement | undefined =
    steps.length > 1 ? (
      <div
        role="group"
        aria-label={translator.translateText("Criteria step")}
        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
        data-testid={MONITOR_METRICS_STEP_PICKER_TEST_ID}
      >
        {steps.map((metricStep: MonitorMetricStep, offeredPosition: number) => {
          const isPicked: boolean = offeredPosition === position;

          return (
            <button
              key={metricStep.step.data?.id || `step-${metricStep.index}`}
              type="button"
              aria-pressed={isPicked}
              className={`${STEP_BUTTON_CLASS_NAME} ${
                isPicked
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => {
                pickStep(offeredPosition);
              }}
            >
              {translator.translateTemplate("Step {{number}}", {
                number: metricStep.index + 1,
              })}
            </button>
          );
        })}
      </div>
    ) : undefined;

  return (
    <MonitorStepMetrics
      // Another step is another investigation, with its own defaults.
      key={current.step.data?.id || `step-${current.index}`}
      monitorId={props.monitorId}
      monitorType={props.monitorType}
      metricStep={current}
      stepPosition={position}
      defaultMonitorStatusId={props.monitorSteps?.data?.defaultMonitorStatusId}
      refreshToken={props.refreshToken || 0}
      stepPicker={stepPicker}
    />
  );
};

export default MonitorMetricsCard;
