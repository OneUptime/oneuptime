import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  dashboard: Dashboard;
  onNavigateComplete?: (() => void) | undefined;
}

const DashboardElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.dashboard?._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DASHBOARD_VIEW] as Route,
          {
            modelId: new ObjectID(props.dashboard._id as string),
          },
        )}
      >
        <span>{props.dashboard.name}</span>
      </AppLink>
    );
  }

  return <span>{props.dashboard?.name || "-"}</span>;
};

export default DashboardElement;
