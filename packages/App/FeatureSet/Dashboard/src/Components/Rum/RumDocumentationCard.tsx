import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  RUM_CLIENTS,
  getRumIngestionKeyType,
  getRumSetupGuide,
  resolveRumClient,
} from "./RumSetupGuide";

export interface ComponentProps {
  title: string;
  description: string;
  /*
   * The application being set up (its Documentation tab): its identifier
   * fills in service.name, and its client type ("browser" / "mobile", as
   * ingest records it) opens the matching option. Both omitted on the
   * product pages.
   */
  appName?: string | undefined;
  clientType?: string | undefined;
}

const RumDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.Globe}
      optionsLabel="What are you instrumenting?"
      options={RUM_CLIENTS}
      initialOption={props.clientType}
      /*
       * The browser snippet is public, so the picker lists and creates only
       * Browser keys for it; a mobile app cannot use one, so it gets Server
       * keys only.
       */
      getKeyTypeFilter={(
        option: string | undefined,
      ): TelemetryIngestionKeyType => {
        return getRumIngestionKeyType(resolveRumClient(option));
      }}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getRumSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          client: resolveRumClient(context.option),
          appName: props.appName,
        });
      }}
    />
  );
};

export default RumDocumentationCard;
