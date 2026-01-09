import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ColorSquareCube from "Common/UI/Components/ColorSquareCube/ColorSquareCube";
import AppLink from "../AppLink/AppLink";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import Service from "Common/Models/DatabaseModels/Service";
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

  if (props.telemetryService._id) {
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
