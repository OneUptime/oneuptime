import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  DOCKER_SWARM_INSTALL_METHODS,
  getDockerSwarmSetupGuide,
  resolveDockerSwarmInstallMethod,
} from "../../Pages/DockerSwarm/Utils/DocumentationMarkdown";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The cluster being set up (its Documentation tab): its name, which is the
   * DOCKER_SWARM_CLUSTER_NAME its agent reports. Omitted on the product
   * pages, where the guide suggests a name for a new cluster instead.
   */
  clusterName?: string | undefined;
}

const DockerSwarmDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.DockerSwarm}
      newKeyName={translationKey("Docker Swarm key")}
      optionsLabel="How do you want to install the agent?"
      options={DOCKER_SWARM_INSTALL_METHODS}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getDockerSwarmSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          method: resolveDockerSwarmInstallMethod(context.option),
          clusterName: props.clusterName,
        });
      }}
    />
  );
};

export default DockerSwarmDocumentationCard;
