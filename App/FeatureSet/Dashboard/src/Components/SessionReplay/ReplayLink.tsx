import AppLink from "../AppLink/AppLink";
import React, { FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  rumApplicationId?: ObjectID | undefined;
  sessionId?: string | undefined;
  /* Deep-links into a moment. The player reads it off the ?t= query param. */
  atOffsetMs?: number | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

/*
 * Cross-link from anything carrying a sessionId to the recording of it.
 * Same shape as Components/Traces/TraceElement.tsx: renders nothing at all
 * rather than a dead link when the id is absent, because a session id of ""
 * is the default on every telemetry row that predates the recorder.
 */
const ReplayLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.sessionId || !props.rumApplicationId) {
    return <></>;
  }

  let route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
    {
      modelId: props.rumApplicationId,
      subModelId: props.sessionId,
    },
  );

  if (props.atOffsetMs !== undefined && props.atOffsetMs >= 0) {
    route = route.addQueryParams({
      t: String(Math.floor(props.atOffsetMs / 1000)),
    });
  }

  return (
    <div className="flex space-x-2">
      <div className="hover:underline">
        <AppLink to={route} className={props.className}>
          <p>{props.label || "Watch session replay"}</p>
        </AppLink>
      </div>
    </div>
  );
};

export default ReplayLink;
