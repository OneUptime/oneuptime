import AppLink from "../AppLink/AppLink";
import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import { buildReplayLinkRoute, ReplayLinkRouteProps } from "./ReplayLinkRoute";

/*
 * The props and the route builder live in ReplayLinkRoute.ts, which has no
 * React import, so a node test can pin the URL grammar. Re-exported under
 * the names callers already use.
 */
export { buildReplayLinkRoute };
export type ComponentProps = ReplayLinkRouteProps;

/*
 * Cross-link from anything carrying a sessionId to the recording of it.
 * Same shape as Components/Traces/TraceElement.tsx: renders nothing at all
 * rather than a dead link when the id is absent, because a session id of ""
 * is the default on every telemetry row that predates the recorder.
 */
const ReplayLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const {
    rumApplicationId,
    sessionId,
    atTime,
    atOffsetMs,
    signal,
    rail,
    label,
    className,
  } = props;

  const route: Route | null = buildReplayLinkRoute({
    rumApplicationId,
    sessionId,
    atTime,
    atOffsetMs,
    signal,
    rail,
  });

  if (!route) {
    return <></>;
  }

  return (
    <div className="flex space-x-2" data-testid="replay-link">
      <div className="hover:underline">
        <AppLink to={route} className={className}>
          <p>{label || "Watch session replay"}</p>
        </AppLink>
      </div>
    </div>
  );
};

export default ReplayLink;
