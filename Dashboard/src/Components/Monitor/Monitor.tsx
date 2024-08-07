import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/src/Components/Icon/Icon";
import Link from "Common/UI/src/Components/Link/Link";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitor: Monitor;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const MonitorElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.monitor._id) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW] as Route,
          {
            modelId: new ObjectID(props.monitor._id as string),
          },
        )}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.AltGlobe} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.monitor.name}
        </span>
      </Link>
    );
  }

  return <span>{props.monitor.name}</span>;
};

export default MonitorElement;
