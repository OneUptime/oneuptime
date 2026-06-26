import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  runbookAgent: RunbookAgent;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const RunbookAgentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.runbookAgent?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUNBOOKS_AGENT_VIEW] as Route,
          {
            modelId: new ObjectID(props.runbookAgent._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Terminal} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.runbookAgent.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.runbookAgent?.name || ""}</span>;
};

export default RunbookAgentElement;
