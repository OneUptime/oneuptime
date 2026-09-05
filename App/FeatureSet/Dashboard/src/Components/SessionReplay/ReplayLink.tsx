import AppLink from "../AppLink/AppLink";
import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { ReplayRailTabId } from "./Rail/ReplaySignalTypes";
import { buildReplayMomentRoute } from "./ReplayPlayerUrlState";

export interface ComponentProps {
  rumApplicationId?: ObjectID | string | undefined;
  sessionId?: string | undefined;
  /*
   * The absolute moment (the row's own timestamp) -> ?at=. Preferred: the
   * caller knows the wall clock, the player knows the recording's start,
   * and the conversion happens once, in the player, against the header.
   */
  atTime?: Date | undefined;
  /* An offset into the recording -> ?t=. Used when only an offset is known. */
  atOffsetMs?: number | undefined;
  /* The rail row to select on arrival (log:<id>, span:<id>, exc:<id>). */
  signal?: string | undefined;
  /* The rail tab to open on arrival. */
  rail?: ReplayRailTabId | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

/*
 * The route this link points at, or null when it should not render. Kept
 * separate from the component so a node test can pin the URL grammar
 * without rendering. Every inbound link goes through
 * buildReplayMomentRoute so the pre-roll (1s for a row, 10s for an
 * exception signal) and the clamp at 0 are the same from every surface.
 */
export function buildReplayLinkRoute(props: ComponentProps): Route | null {
  return buildReplayMomentRoute({
    rumApplicationId: props.rumApplicationId,
    sessionId: props.sessionId,
    at: props.atTime,
    t: props.atOffsetMs,
    signal: props.signal,
    rail: props.rail,
  });
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
