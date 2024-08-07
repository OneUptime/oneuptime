import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/src/Components/Icon/Icon";
import Link from "Common/UI/src/Components/Link/Link";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorGroup: MonitorGroup;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean;
}

const MonitorGroupElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.monitorGroup._id) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
          {
            modelId: new ObjectID(props.monitorGroup._id as string),
          },
        )}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Squares} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.monitorGroup.name}
        </span>
      </Link>
    );
  }

  return <span>{props.monitorGroup.name}</span>;
};

export default MonitorGroupElement;
