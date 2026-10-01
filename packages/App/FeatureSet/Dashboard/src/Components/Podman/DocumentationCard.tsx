import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  PODMAN_INSTALL_METHODS,
  getPodmanSetupGuide,
  resolvePodmanInstallMethod,
} from "../../Pages/Podman/Utils/DocumentationMarkdown";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The host being set up (its Documentation tab): its identifier, which is
   * the PODMAN_HOST_NAME its agent reports. Omitted on the product pages,
   * where the guide suggests a name for a new host instead.
   */
  hostName?: string | undefined;
}

const PodmanDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Podman}
      optionsLabel="How do you want to run the agent?"
      options={PODMAN_INSTALL_METHODS}
      keyStepDescription="The agent sends this host's metrics and logs to OneUptime with this key. Pick an existing key or create a new one — the commands below update to use it."
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getPodmanSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          method: resolvePodmanInstallMethod(context.option),
          hostName: props.hostName,
        });
      }}
    />
  );
};

export default PodmanDocumentationCard;
