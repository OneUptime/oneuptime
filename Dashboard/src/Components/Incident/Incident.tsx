import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Link from "CommonUI/src/Components/Link/Link";
import Incident from "Model/Models/Incident";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incident: Incident;
  onNavigateComplete?: (() => void) | undefined;
}

const IncidentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.incident._id) {
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENT_VIEW] as Route,
          {
            modelId: new ObjectID(props.incident._id as string),
          },
        )}
      >
        <span>{props.incident.title}</span>
      </Link>
    );
  }

  return <span>{props.incident.title}</span>;
};

export default IncidentElement;
