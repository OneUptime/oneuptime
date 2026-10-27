import TelemetryResourceRetentionSettings, {
  TelemetryRetentionModel,
} from "./TelemetryResourceRetentionSettings";
import { RESOURCE_RETENTION_MORE_DESCRIPTION } from "./TelemetryRetentionFold";
import useRetentionFold, { RetentionFold } from "./UseRetentionFold";
import {
  isEnterpriseFeatureEligible,
  TELEMETRY_RETENTION_REQUIRED_PLAN,
} from "../../Enterprise/EnterpriseEligibility";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import React, { ReactElement } from "react";

/*
 * The More settings of a service's or telemetry resource's Settings page:
 * its retention overrides, an Enterprise feature most projects never use
 * (TelemetryRetentionFold says why they fold). Folded, the header names
 * each retention card, with what it overrides while it does; a link to a
 * card opens it there. Between the page's own details and Archive:
 *
 *   <ResourceDetailsCard ... />
 *   <TelemetryResourceMoreSettings<Host>
 *     modelType={Host}
 *     modelId={modelId}
 *     resourceName="host"
 *     modelDetailIdPrefix="model-detail-host"
 *   />
 *   <ArchiveResourceCard ... />
 *
 * A page with a card of its own to fold beside them (a RUM application's
 * replay retention) draws its own AdvancedPageSection with the same pieces
 * (useRetentionFold, TelemetryResourceRetentionSettings).
 */

export const TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID: string =
  "telemetry-resource-more-settings";

export interface ComponentProps<TModel extends TelemetryRetentionModel> {
  modelType: { new (): TModel };
  modelId: ObjectID;
  resourceName: string;
  modelDetailIdPrefix: string;
  scopeNote?: string | undefined;
}

/*
 * Whether a resource's Enterprise retention cards are drawn: the decision
 * the shell's Enterprise door makes (EnterprisePluginPage) - the project
 * may set overrides and the build includes them - and the card that sells
 * them otherwise.
 */
export const isResourceRetentionCardDrawn: () => boolean = (): boolean => {
  return (
    isEnterpriseFeatureEligible(TELEMETRY_RETENTION_REQUIRED_PLAN) &&
    Boolean(getDashboardPlugins().TelemetryResourceRetentionSettings)
  );
};

const TelemetryResourceMoreSettings: <TModel extends TelemetryRetentionModel>(
  props: ComponentProps<TModel>,
) => ReactElement = <TModel extends TelemetryRetentionModel>(
  props: ComponentProps<TModel>,
): ReactElement => {
  const fold: RetentionFold = useRetentionFold({
    isEnterpriseCardDrawn: isResourceRetentionCardDrawn(),
    hasOwnRetention: true,
  });

  return (
    <AdvancedPageSection
      description={RESOURCE_RETENTION_MORE_DESCRIPTION}
      items={fold.items}
      dataTestId={TELEMETRY_RESOURCE_MORE_SETTINGS_TEST_ID}
    >
      <TelemetryResourceRetentionSettings<TModel>
        modelType={props.modelType}
        modelId={props.modelId}
        resourceName={props.resourceName}
        modelDetailIdPrefix={props.modelDetailIdPrefix}
        scopeNote={props.scopeNote}
        onRetentionChange={fold.onRetentionChange}
      />
    </AdvancedPageSection>
  );
};

export default TelemetryResourceMoreSettings;
