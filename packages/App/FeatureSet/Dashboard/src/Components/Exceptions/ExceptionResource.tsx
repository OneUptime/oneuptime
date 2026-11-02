import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil, {
  UNKNOWN_RESOURCE_LABEL,
} from "Common/UI/Utils/TelemetryService";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import ServiceElement from "../Service/ServiceElement";

export interface ComponentProps {
  primaryEntityId?: ObjectID | undefined;
  primaryEntityType?: ServiceType | undefined;
  // The group's Service when it has been loaded (at most one row).
  services?: Array<Service> | undefined;
  fallback?: ReactElement | undefined;
  className?: string | undefined;
}

/*
 * The resource an exception group belongs to, from its polymorphic
 * (primaryEntityId, primaryEntityType): a real Service renders as a linked
 * ServiceElement; the unattributed bucket renders as a non-linked synthetic
 * "Unknown Service"; Host / DockerHost / KubernetesCluster render as a typed
 * label. The bare "Unknown" fallback renders `fallback` instead.
 */
const ExceptionResource: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { service, label } = TelemetryServiceUtil.resolveTelemetryResource({
    primaryEntityId: props.primaryEntityId,
    primaryEntityType: props.primaryEntityType,
    services: props.services || [],
    projectId: ProjectUtil.getCurrentProjectId(),
  });

  if (service) {
    return (
      <div className={props.className} data-testid="exception-resource">
        <ServiceElement service={service} serviceNameClassName="truncate" />
      </div>
    );
  }

  if (label && label !== UNKNOWN_RESOURCE_LABEL) {
    return (
      <div
        className={`text-gray-700 ${props.className || ""}`}
        data-testid="exception-resource"
      >
        {translator.translateText(label)}
      </div>
    );
  }

  return props.fallback || <></>;
};

export default ExceptionResource;
