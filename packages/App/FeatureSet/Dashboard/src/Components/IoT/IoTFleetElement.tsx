import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

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
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.IoT} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.iotFleet.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.iotFleet?.name || ""}</span>;
};

export default IoTFleetElement;
