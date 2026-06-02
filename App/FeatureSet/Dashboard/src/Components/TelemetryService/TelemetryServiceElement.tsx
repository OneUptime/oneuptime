import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ColorSquareCube from "Common/UI/Components/ColorSquareCube/ColorSquareCube";
import AppLink from "../AppLink/AppLink";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import Service from "Common/Models/DatabaseModels/Service";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  telemetryService: Service;
  onNavigateComplete?: (() => void) | undefined;
  telemetryServiceNameClassName?: string;
}

const TelemetryServiceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getServiceElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="flex space-x-2">
        <div className="mt-1">
          <ColorSquareCube
            color={props.telemetryService.serviceColor || Black}
            tooltip={`${props.telemetryService.name?.toString()} Service Color`}
          />
        </div>
        <div className={props.telemetryServiceNameClassName}>
          {props.telemetryService.name?.toString()}
        </div>
      </div>
    );
  };

  /*
   * Unattributed telemetry is rendered with a synthetic "Unknown Service"
   * whose id is the projectId (ServiceType.Unknown). There is no service
   * detail page for it, so render plain text rather than a link that 404s.
   */
  const isUnknownService: boolean = TelemetryServiceUtil.isUnknownServiceId(
    props.telemetryService._id as string | undefined,
    ProjectUtil.getCurrentProjectId(),
  );

  if (props.telemetryService._id && !isUnknownService) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SERVICE_VIEW] as Route,
          {
            modelId: new ObjectID(props.telemetryService._id as string),
          },
        )}
      >
        {getServiceElement()}
      </AppLink>
    );
  }

  return <div>{getServiceElement()}</div>;
};

export default TelemetryServiceElement;
