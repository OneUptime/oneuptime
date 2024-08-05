import Route from "Common/Types/API/Route";
import Link from "CommonUI/src/Components/Link/Link";
import StatusPage from "Common/AppModels/Models/StatusPage";
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
      <Link
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
      </Link>
    );
  }

  return <span>{props.statusPage.name}</span>;
};

export default StatusPageElement;
