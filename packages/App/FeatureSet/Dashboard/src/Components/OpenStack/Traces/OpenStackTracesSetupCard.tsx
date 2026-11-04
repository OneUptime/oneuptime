import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  DEFAULT_OPENSTACK_DEPLOYMENT_TOOL,
  OPENSTACK_DEPLOYMENT_TOOLS,
  resolveOpenStackDeploymentTool,
} from "../../../Pages/OpenStack/Utils/OpenStackDeploymentGuides";
import { getOpenStackTracesGuide } from "../../../Pages/OpenStack/Utils/OpenStackTracesGuide";
import { SetupGuideContent } from "../../SetupGuide/SetupGuide";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../../SetupGuide/SetupGuideCard";

/*
 * Turning OSProfiler on, in the shape every in-app guide has: which tool deployed the cloud,
 * the key, then the few steps for that tool, with the costs and the problems folded away.
 */

export interface ComponentProps {
  cloudName: string;
}

const OpenStackTracesSetupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title="Turn on traces"
      description="Each service sends its own spans to a collector on its machine. This takes a few steps on each service, and it can wait until you need it."
      icon={IconProp.Cloud}
      newKeyName={translationKey("OpenStack traces key")}
      optionsLabel="How do you deploy OpenStack?"
      options={OPENSTACK_DEPLOYMENT_TOOLS}
      initialOption={DEFAULT_OPENSTACK_DEPLOYMENT_TOOL}
      keyStepDescription={translationKey(
        "The collector sends your spans to OneUptime with this key. Pick an existing key or create a new one: the commands below update to use it.",
      )}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getOpenStackTracesGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          hasApiKey: context.hasApiKey,
          cloudName: props.cloudName,
          tool: resolveOpenStackDeploymentTool(context.option),
        });
      }}
    />
  );
};

export default OpenStackTracesSetupCard;
