import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import SetupGuideCard, {
  SetupGuideFrameProps,
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  OPENSTACK_CONNECT_METHODS,
  getOpenStackSetupGuide,
  resolveOpenStackConnectMethod,
} from "../../Pages/OpenStack/Utils/DocumentationMarkdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps extends SetupGuideFrameProps {
  title: string;
  description: string;
  /*
   * The cloud being set up (its Documentation tab). Omitted on the product
   * pages, where the guide suggests a name for a new cloud instead.
   */
  cloudName?: string | undefined;
}

const OpenStackDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Cloud}
      newKeyName={translationKey("OpenStack key")}
      optionsLabel="How do you want to install the agent?"
      options={OPENSTACK_CONNECT_METHODS}
      keyStepDescription={translationKey(
        "The agent sends your cloud's metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it.",
      )}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getOpenStackSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          hasApiKey: context.hasApiKey,
          method: resolveOpenStackConnectMethod(context.option),
          cloudName: props.cloudName,
        });
      }}
      isBare={props.isBare}
      inputs={props.inputs}
      lastStep={props.lastStep}
    />
  );
};

export default OpenStackDocumentationCard;
