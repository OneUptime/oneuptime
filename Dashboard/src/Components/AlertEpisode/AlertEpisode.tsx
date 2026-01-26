import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import AppLink from "../AppLink/AppLink";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  alertEpisode: AlertEpisode;
  onNavigateComplete?: (() => void) | undefined;
}

const AlertEpisodeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.alertEpisode._id) {
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route,
          {
            modelId: new ObjectID(props.alertEpisode._id as string),
          },
        )}
      >
        <span>{props.alertEpisode.title}</span>
      </AppLink>
    );
  }

  return <span>{props.alertEpisode.title}</span>;
};

export default AlertEpisodeElement;
