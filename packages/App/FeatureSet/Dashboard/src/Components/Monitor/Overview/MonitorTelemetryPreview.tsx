import LogMonitorPreview from "../LogMonitor/LogMonitorPreview";
import MetricMonitorPreview from "../MetricMonitor/MetricMonitorPreview";
import SecurityEventsMonitorPreview from "../SecurityEventsMonitor/SecurityEventsMonitorPreview";
import TraceMonitorPreview from "../TraceMonitor/TraceMonitorPreview";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorType: MonitorType;
  monitorSteps: MonitorSteps | undefined;
}

export const getTelemetryPreviewDescription: (stepCount: number) => string = (
  stepCount: number,
): string => {
  return stepCount > 1
    ? `Previewing the first of ${stepCount} criteria steps.`
    : "Preview of what this monitor's filter matches.";
};

/*
 * What a telemetry monitor's filter matches right now, so a reader can see
 * the data the criteria are judging. Only the first criteria step is
 * previewed, and the description says so when there are more.
 */
const MonitorTelemetryPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const steps: Array<MonitorStep> =
    props.monitorSteps?.data?.monitorStepsInstanceArray || [];
  const firstStep: MonitorStep | undefined = steps[0];

  if (!firstStep || !firstStep.data) {
    return <></>;
  }

  const description: string = getTelemetryPreviewDescription(steps.length);

  switch (props.monitorType) {
    case MonitorType.Logs:
      return (
        <Card title="Logs preview" description={description}>
          <LogMonitorPreview
            monitorStepLogMonitor={firstStep.data.logMonitor}
          />
        </Card>
      );

    case MonitorType.SecurityEvents:
      return (
        <Card title="Security events preview" description={description}>
          <SecurityEventsMonitorPreview
            context="overview"
            monitorStepSecurityEventsMonitor={
              firstStep.data.securityEventsMonitor
            }
          />
        </Card>
      );

    case MonitorType.Metrics:
      // The metrics preview is a card of its own, with its own range picker.
      return (
        <MetricMonitorPreview
          monitorStepMetricMonitor={firstStep.data.metricMonitor}
        />
      );

    case MonitorType.Traces:
      return (
        <TraceMonitorPreview
          context="overview"
          monitorStepTraceMonitor={firstStep.data.traceMonitor}
          description={steps.length > 1 ? description : undefined}
        />
      );

    default:
      return <></>;
  }
};

export default MonitorTelemetryPreview;
