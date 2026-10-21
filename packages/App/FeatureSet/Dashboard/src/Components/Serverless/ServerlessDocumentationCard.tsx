import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  SERVERLESS_PLATFORMS,
  getServerlessPlatformForCloudPlatform,
  getServerlessSetupGuide,
  resolveServerlessPlatform,
} from "./ServerlessSetupGuide";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The function being set up (its Documentation tab): its identifier fills
   * in faas.name (OTEL_SERVICE_NAME on Azure Functions), and the
   * cloud.platform it reported opens the matching platform. Both omitted on
   * the product pages.
   */
  functionName?: string | undefined;
  cloudPlatform?: string | undefined;
}

const ServerlessDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Bolt}
      newKeyName={translationKey("Serverless key")}
      optionsLabel="Where do your functions run?"
      options={SERVERLESS_PLATFORMS}
      initialOption={getServerlessPlatformForCloudPlatform(props.cloudPlatform)}
      /*
       * A function sends no Origin header, so a Browser key is refused on
       * every export; only Server keys are offered, and created.
       */
      getKeyTypeFilter={(): TelemetryIngestionKeyType => {
        return TelemetryIngestionKeyType.Server;
      }}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getServerlessSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          platform: resolveServerlessPlatform(context.option),
          functionName: props.functionName,
        });
      }}
    />
  );
};

export default ServerlessDocumentationCard;
