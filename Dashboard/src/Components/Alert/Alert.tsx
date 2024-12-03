import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  alert: Alert;
  onNavigateComplete?: (() => void) | undefined;
}

const AlertElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.alert._id) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERT_VIEW] as Route,
          {
            modelId: new ObjectID(props.alert._id as string),
          },
        )}
      >
        <span>{props.alert.title}</span>
      </Link>
    );
  }

  return <span>{props.alert.title}</span>;
};

export default AlertElement;
