import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import SetupGuideCard, {
  SetupGuideFrameProps,
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  RUM_CLIENTS,
  getRumIngestionKeyType,
  getRumSetupGuide,
  resolveRumClient,
} from "./RumSetupGuide";
import { RUM_DOCUMENTATION_TRANSLATIONS } from "../../Pages/Rum/Utils/DocumentationTranslations";

export interface ComponentProps extends SetupGuideFrameProps {
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
      newKeyName={translationKey("RUM key")}
      /*
       * A Mobile key made on an app's Documentation tab is pinned to that
       * app (issue #6457): everything it sends is filed under its name.
       */
      newKeyPinnedServiceName={props.appName}
      optionsLabel="What are you instrumenting?"
      options={RUM_CLIENTS}
      initialOption={props.clientType}
      /*
       * The browser snippet is public, so the picker lists and creates only
       * Browser keys for it; a mobile app cannot use one, and must never
       * ship a Server key, so it gets Mobile keys only.
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
      // The guide's markdown in the reader's language (#6434).
      translations={RUM_DOCUMENTATION_TRANSLATIONS}
      isBare={props.isBare}
      inputs={props.inputs}
      lastStep={props.lastStep}
    />
  );
};

export default RumDocumentationCard;
