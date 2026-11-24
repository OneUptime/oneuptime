import Project from "Common/Models/DatabaseModels/Project";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The project's usage as metrics (issue #6355), on Project Settings >
 * Telemetry & APM > Usage, under More settings: one switch, saved as it is
 * flipped (Project.publishTelemetryUsageMetrics). On, the telemetry worker
 * counts what each service sends as it arrives, and every 5 minutes it is
 * written as the metric oneuptime.telemetry.usage.bytes, which charts and
 * alerts within minutes. Off - the default - usage is the daily count on
 * this page, and ingest does no extra work.
 */

export const TELEMETRY_USAGE_METRICS_CARD_TITLE: string =
  translationKey("Usage as Metrics");
export const TELEMETRY_USAGE_METRICS_CARD_DESCRIPTION: string = translationKey(
  "Chart and alert on how much telemetry each service sends, within minutes instead of the next day.",
);
export const TELEMETRY_USAGE_METRICS_SWITCH_TITLE: string = translationKey(
  "Publish usage as metrics",
);
export const TELEMETRY_USAGE_METRICS_ON_DESCRIPTION: string = translationKey(
  "Every 5 minutes, what each service sent of each signal is written as the metric oneuptime.telemetry.usage.bytes. It is not billed.",
);
export const TELEMETRY_USAGE_METRICS_OFF_DESCRIPTION: string = translationKey(
  "Usage is counted once a day, on this page only.",
);

export const TELEMETRY_USAGE_METRICS_SWITCH_TEST_ID: string =
  "telemetry-usage-metrics-switch";

export interface ComponentProps {
  // Whether the project publishes its usage, once read and as it is saved.
  onChange?: ((isOn: boolean) => void) | undefined;
}

const TelemetryUsageMetricsSwitch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={ProjectUtil.getCurrentProjectId()!}
      column="publishTelemetryUsageMetrics"
      cardTitle={TELEMETRY_USAGE_METRICS_CARD_TITLE}
      cardDescription={TELEMETRY_USAGE_METRICS_CARD_DESCRIPTION}
      title={TELEMETRY_USAGE_METRICS_SWITCH_TITLE}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? TELEMETRY_USAGE_METRICS_ON_DESCRIPTION
          : TELEMETRY_USAGE_METRICS_OFF_DESCRIPTION;
      }}
      onLoaded={(project: Project) => {
        props.onChange?.(Boolean(project.publishTelemetryUsageMetrics));
      }}
      onSaved={(isOn: boolean) => {
        props.onChange?.(isOn);
      }}
      dataTestId={TELEMETRY_USAGE_METRICS_SWITCH_TEST_ID}
    />
  );
};

export default TelemetryUsageMetricsSwitch;
