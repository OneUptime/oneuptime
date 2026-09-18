import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  statusPage: StatusPage;
  onNavigateComplete?: (() => void) | undefined;
}

const StatusPageElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.statusPage._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
          {
            modelId: new ObjectID(props.statusPage._id as string),
          },
        )}
      >
        <span>{props.statusPage.name}</span>
      </AppLink>
    );
  }

  return <span>{props.statusPage.name}</span>;
};

export default StatusPageElement;
