import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Runner from "Common/Models/DatabaseModels/Runner";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  runner: Runner;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const RunnerElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.runner?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUNBOOKS_AGENT_VIEW] as Route,
          {
            modelId: new ObjectID(props.runner._id as string),
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
          {props.runner.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.runner?.name || ""}</span>;
};

export default RunnerElement;
