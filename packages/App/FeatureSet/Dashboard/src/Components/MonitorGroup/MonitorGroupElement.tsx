import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";
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
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
          {
            modelId: new ObjectID(props.monitorGroup._id as string),
          },
        )}
      >
        <RecordLinkName
          name={props.monitorGroup.name}
          icon={props.showIcon ? IconProp.Squares : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.monitorGroup.name}</span>;
};

export default MonitorGroupElement;
