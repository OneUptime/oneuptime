import React, { FunctionComponent, ReactElement } from "react";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ObjectID from "Common/Types/ObjectID";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourceAddedModal from "../ResourceOnboarding/ResourceAddedModal";
import { SetupGuideFrameProps } from "../SetupGuide/SetupGuideCard";
import RumDocumentationCard from "./RumDocumentationCard";
import PageMap from "../../Utils/PageMap";

/*
 * Create RUM Application saves the app name, so its labels, owners and
 * replay policy can be in place before the first visitor: the data comes
 * from the snippet in the app. So once the form has saved one, its guide
 * opens on its own - the application's Documentation tab, with its name as
 * the snippet's service.name - and its last step says when the first data
 * arrived.
 */

export const RUM_APPLICATION_ADDED_VIEW_TEXT: string =
  translationKey("View application");

export interface ComponentProps {
  applicationId: ObjectID;
  // The service.name the form saved.
  appIdentifier: string;
  onClose: () => void;
}

const RumApplicationAddedModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // As the application's Documentation tab says it.
  const title: string = "Instrument your app for RUM";
  const description: string = translator.translateTemplate(
    "Send browser / mobile telemetry so {{application}} reports real-user monitoring to OneUptime.",
    { application: props.appIdentifier },
  );

  return (
    <ResourceAddedModal
      title={title}
      description={description}
      modelType={RumApplication}
      recordId={props.applicationId}
      name={props.appIdentifier}
      viewPage={PageMap.RUM_APPLICATION_VIEW}
      viewText={RUM_APPLICATION_ADDED_VIEW_TEXT}
      onClose={props.onClose}
      renderGuide={(frame: SetupGuideFrameProps): ReactElement => {
        return (
          <RumDocumentationCard
            title={title}
            description={description}
            appName={props.appIdentifier}
            isBare={frame.isBare}
            lastStep={frame.lastStep}
          />
        );
      }}
    />
  );
};

export default RumApplicationAddedModal;
