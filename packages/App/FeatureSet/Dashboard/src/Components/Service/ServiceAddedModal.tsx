import React, { FunctionComponent, ReactElement } from "react";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourceAddedModal from "../ResourceOnboarding/ResourceAddedModal";
import TelemetryDocumentation, {
  canCarryServiceName,
} from "../Telemetry/Documentation";
import { SERVICE_NAME_HELP } from "./ServiceListCopy";
import PageMap from "../../Utils/PageMap";

/*
 * Create Service saves the service.name its apps send; its traces, logs
 * and metrics come from the apps, once they are instrumented. So once the
 * form has saved one, the OpenTelemetry guide opens on its own with that
 * service.name in every snippet, and says when the service's first data
 * arrived. A name the snippets cannot carry (a quote, a $ in it) leaves
 * their examples, and the dialog says to use the service's name instead.
 */

export const SERVICE_ADDED_TITLE: string = translationKey(
  "Send telemetry from {{name}}",
);

export const SERVICE_ADDED_DESCRIPTION: string = translationKey(
  "Instrument the service with OpenTelemetry. Every snippet below already carries its service.name.",
);

export const SERVICE_ADDED_VIEW_TEXT: string = translationKey("View service");

export interface ComponentProps {
  serviceId: ObjectID;
  // The service.name the form saved.
  name: string;
  onClose: () => void;
}

const ServiceAddedModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ResourceAddedModal
      title={translator.translateTemplate(SERVICE_ADDED_TITLE, {
        name: props.name,
      })}
      description={
        canCarryServiceName(props.name)
          ? SERVICE_ADDED_DESCRIPTION
          : SERVICE_NAME_HELP
      }
      modelType={Service}
      recordId={props.serviceId}
      name={props.name}
      viewPage={PageMap.SERVICE_VIEW}
      viewText={SERVICE_ADDED_VIEW_TEXT}
      onClose={props.onClose}
      drawsLastStep={false}
      renderGuide={(): ReactElement => {
        return (
          <TelemetryDocumentation
            telemetryType="traces"
            serviceName={props.name}
            isBare={true}
          />
        );
      }}
    />
  );
};

export default ServiceAddedModal;
