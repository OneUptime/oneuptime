import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SetupGuideCard, {
  SetupGuideFrameProps,
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  IOT_INGESTION_METHODS,
  getIoTSetupGuide,
  resolveIoTIngestionMethod,
} from "../../Pages/IoT/Utils/DocumentationMarkdown";

export interface ComponentProps extends SetupGuideFrameProps {
  title: string;
  description: string;
  /*
   * The fleet the readings go to: a fleet's Documentation tab, or the name
   * typed in Add IoT Fleet. Omitted on the Documentation page, where the
   * snippets name an example fleet instead.
   */
  fleetName?: string | undefined;
}

const IoTDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.IoT}
      newKeyName={translationKey("IoT key")}
      optionsLabel="How do your devices send data?"
      options={IOT_INGESTION_METHODS}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getIoTSetupGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          method: resolveIoTIngestionMethod(context.option),
          fleetName: props.fleetName,
        });
      }}
      isBare={props.isBare}
      inputs={props.inputs}
      lastStep={props.lastStep}
    />
  );
};

export default IoTDocumentationCard;
