import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideFrameProps,
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  KUBERNETES_PLATFORMS,
  getKubernetesSetupGuide,
  resolveKubernetesPlatform,
} from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";

export interface ComponentProps extends SetupGuideFrameProps {
  title: string;
  description: string;
  /*
   * The cluster being set up: its Documentation tab, or the name typed in
   * the Add guide. Omitted on the Documentation page, where the guide
   * suggests a name for a new cluster instead.
   */
  clusterName?: string | undefined;
}

const KubernetesDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Kubernetes}
      newKeyName={translationKey("Kubernetes key")}
      optionsLabel="Where is your cluster running?"
      options={KUBERNETES_PLATFORMS}
      keyStepDescription="The agent sends your cluster's data to OneUptime with this key. Pick an existing key or create a new one — the install command below updates to use it."
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getKubernetesSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          platform: resolveKubernetesPlatform(context.option),
          clusterName: props.clusterName,
        });
      }}
      isBare={props.isBare}
      inputs={props.inputs}
      lastStep={props.lastStep}
    />
  );
};

export default KubernetesDocumentationCard;
