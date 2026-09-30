import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  HOST_INSTALL_METHODS,
  getHostSetupGuide,
  resolveHostInstallMethod,
} from "../../Pages/Host/Utils/DocumentationMarkdown";

export interface ComponentProps {
  title: string;
  description: string;
}

const HostDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Server}
      optionsLabel="How do you want to install the collector?"
      options={HOST_INSTALL_METHODS}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getHostSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          method: resolveHostInstallMethod(context.option),
        });
      }}
    />
  );
};

export default HostDocumentationCard;
