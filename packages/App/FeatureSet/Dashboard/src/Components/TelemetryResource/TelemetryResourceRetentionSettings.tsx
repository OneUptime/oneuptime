import { TELEMETRY_RETENTION_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage, {
  EnterprisePluginUpsellProps,
} from "../../Enterprise/EnterprisePluginPage";
import {
  TelemetryResourceRetentionSettingsProps,
  TelemetryRetentionModel as ContractTelemetryRetentionModel,
} from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, { ReactElement } from "react";

export type TelemetryRetentionModel = ContractTelemetryRetentionModel;

export interface ComponentProps<TModel extends TelemetryRetentionModel> {
  modelType: { new (): TModel };
  modelId: ObjectID;
  resourceName: string;
  modelDetailIdPrefix: string;
}

/*
 * The upsell shown in place of the retention cards, on Settings > Telemetry
 * too. Only retention OVERRIDES are Enterprise: the project's default
 * retention is part of every edition and stays on Settings > Telemetry.
 */
export const getTelemetryRetentionUpsell: (
  scope: string,
) => EnterprisePluginUpsellProps = (
  scope: string,
): EnterprisePluginUpsellProps => {
  return {
    title: "Retention Overrides",
    description: `Keep telemetry ${scope} for longer or shorter than the project's default retention.`,
    featureName: "Retention Overrides",
    featureDescription:
      "Set retention by telemetry type, log severity and trace status, for the whole project or for one service or resource. Without it, all telemetry is kept for the project's default retention.",
    featureIcon: IconProp.Clock,
    benefits: [
      {
        icon: IconProp.Filter,
        title: "Retention by telemetry type",
        subtitle:
          "Keep logs, traces, metrics and profiles for different lengths of time.",
      },
      {
        icon: IconProp.Layers,
        title: "Finer-grained rules",
        subtitle: "Keep error logs and failed traces longer than routine ones.",
      },
      {
        icon: IconProp.Cube,
        title: "Per service and resource",
        subtitle:
          "Give a service, host, cluster or any other resource its own retention.",
      },
      {
        icon: IconProp.Billing,
        title: "Control storage",
        subtitle: "Keep only what you need for as long as you need it.",
      },
    ],
  };
};

/**
 * The retention controls of a service's or telemetry resource's Settings
 * page: the resource's own retention and its retention by telemetry type.
 *
 * Retention overrides are part of the Enterprise Edition
 * (ee/Dashboard/TelemetryRetention). Every Settings page keeps importing
 * this component; it renders the Enterprise cards when the project may use
 * the feature and this build includes it, and the upsell card otherwise.
 */
const TelemetryResourceRetentionSettings: <
  TModel extends TelemetryRetentionModel,
>(
  props: ComponentProps<TModel>,
) => ReactElement = <TModel extends TelemetryRetentionModel>(
  props: ComponentProps<TModel>,
): ReactElement => {
  const pluginProps: TelemetryResourceRetentionSettingsProps = {
    modelType: props.modelType,
    modelId: props.modelId,
    resourceName: props.resourceName,
    modelDetailIdPrefix: props.modelDetailIdPrefix,
  };

  return (
    <EnterprisePluginPage<TelemetryResourceRetentionSettingsProps>
      plugin={getDashboardPlugins().TelemetryResourceRetentionSettings}
      pluginProps={pluginProps}
      requiredPlan={TELEMETRY_RETENTION_REQUIRED_PLAN}
      upsell={getTelemetryRetentionUpsell(
        `collected from this ${props.resourceName}`,
      )}
    />
  );
};

export default TelemetryResourceRetentionSettings;
