import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import AppLink from "../AppLink/AppLink";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incidentEpisode: IncidentEpisode;
  onNavigateComplete?: (() => void) | undefined;
}

const IncidentEpisodeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.incidentEpisode._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENT_EPISODE_VIEW] as Route,
          {
            modelId: new ObjectID(props.incidentEpisode._id as string),
          },
        )}
      >
        <span>{props.incidentEpisode.title}</span>
      </AppLink>
    );
  }

  return <span>{props.incidentEpisode.title}</span>;
};

export default IncidentEpisodeElement;
