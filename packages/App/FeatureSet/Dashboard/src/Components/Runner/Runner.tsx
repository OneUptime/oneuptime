import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Runner from "Common/Models/DatabaseModels/Runner";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

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
          RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW] as Route,
          {
            modelId: new ObjectID(props.runner._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <RecordLinkName
          name={props.runner.name}
          icon={props.showIcon ? IconProp.Terminal : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.runner?.name || ""}</span>;
};

export default RunnerElement;
