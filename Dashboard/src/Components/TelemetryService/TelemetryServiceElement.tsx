import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Black } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ColorSquareCube from "CommonUI/src/Components/ColorSquareCube/ColorSquareCube";
import Link from "CommonUI/src/Components/Link/Link";
import { GetReactElementFunction } from "CommonUI/src/Types/FunctionTypes";
import TelemetryService from "Model/Models/TelemetryService";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  telemetryService: TelemetryService;
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
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.TELEMETRY_SERVICES_VIEW] as Route,
          {
            modelId: new ObjectID(props.telemetryService._id as string),
          },
        )}
      >
        {getServiceElement()}
      </Link>
    );
  }

  return <div>{getServiceElement()}</div>;
};

export default TelemetryServiceElement;
