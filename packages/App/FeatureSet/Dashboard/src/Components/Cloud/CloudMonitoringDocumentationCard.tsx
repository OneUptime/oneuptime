import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  CLOUD_MONITORING_GUIDE_OPTIONS,
  getCloudMonitoringSetupGuide,
  resolveCloudMonitoringGuideOption,
} from "./CloudMonitoringSetupGuide";

/*
 * The "Discover your cloud resources" guide, with a provider picker.
 *
 * Contract used by Pages/Cloud/MonitoredResources.tsx (empty state) and
 * Pages/Cloud/View/Documentation.tsx (a resource's own tab):
 *
 *   - `initialOption` pre-selects the picker: a guide key, or a provider
 *     ("azure", "aws", "gcp") - a resource's page passes its own - opens
 *     that provider's guide; anything else opens the default.
 *   - The guide below is that option's alone: read access, the collector's
 *     configuration, running it and verifying, with tuning and
 *     troubleshooting folded away.
 */
export interface ComponentProps {
  title: string;
  description: string;
  initialOption?: string | undefined;
}

const CloudMonitoringDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Cloud}
      newKeyName={translationKey("Cloud resources key")}
      optionsLabel="Which cloud do you want to monitor?"
      options={CLOUD_MONITORING_GUIDE_OPTIONS}
      initialOption={resolveCloudMonitoringGuideOption(props.initialOption)}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getCloudMonitoringSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          option: resolveCloudMonitoringGuideOption(context.option),
        });
      }}
    />
  );
};

export default CloudMonitoringDocumentationCard;
