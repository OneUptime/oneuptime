import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  monitor: Monitor;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const MonitorElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.monitor?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW] as Route,
          {
            modelId: new ObjectID(props.monitor._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.AltGlobe} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.monitor.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.monitor?.name || ""}</span>;
};

export default MonitorElement;
