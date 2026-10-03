import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  CEPH_INSTALL_METHODS,
  getCephSetupGuide,
  resolveCephInstallMethod,
} from "../../Pages/Ceph/Utils/DocumentationMarkdown";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The cluster being set up (its Documentation tab). Omitted on the product
   * pages, where the guide suggests a name for a new cluster instead.
   */
  clusterName?: string | undefined;
}

const CephDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Ceph}
      newKeyName={translationKey("Ceph key")}
      optionsLabel="How do you want to install the agent?"
      options={CEPH_INSTALL_METHODS}
      keyStepDescription="The agent sends your cluster's metrics to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it."
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getCephSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          hasApiKey: context.hasApiKey,
          method: resolveCephInstallMethod(context.option),
          clusterName: props.clusterName,
        });
      }}
    />
  );
};

export default CephDocumentationCard;
