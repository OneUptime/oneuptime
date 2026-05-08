import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Host from "Common/Models/DatabaseModels/Host";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  host: Host;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const HostElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.host?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.HOST_VIEW] as Route,
          {
            modelId: new ObjectID(props.host._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Server} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.host.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.host?.name || ""}</span>;
};

export default HostElement;
