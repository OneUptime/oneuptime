import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

export interface ComponentProps {
  iotFleet: IoTFleet;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const IoTFleetElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.iotFleet?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.IOT_FLEET_VIEW] as Route,
          {
            modelId: new ObjectID(props.iotFleet._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <RecordLinkName
          name={props.iotFleet.name}
          icon={props.showIcon ? IconProp.IoT : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.iotFleet?.name || ""}</span>;
};

export default IoTFleetElement;
