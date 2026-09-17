import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useLocation } from "react-router-dom";
import SessionReplayPlayer from "../../../Components/SessionReplay/SessionReplayPlayer";
import {
  SessionReplayPlayerRoute,
  parseSessionReplayPlayerRoute,
} from "../../../Utils/SessionReplayLayout";
import {
  ReplayPlayerUrlState,
  parseReplayPlayerUrlState,
} from "../../../Components/SessionReplay/ReplayPlayerUrlState";

const RumApplicationSessionReplayView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * The router's location, not window.location, and it is what subscribes
   * this view to navigation.
   *
   * Every route element under the application layout is created once, by
   * the routes component, so React sees the SAME element object when only
   * a path parameter changes and bails out of re-rendering the subtree.
   * Reading the ids from window.location was therefore a one-shot read:
   * opening another session from the header's Older / Newer buttons, the
   * sessions menu or the ended card's "Next session by this user" changed
   * the address bar while the mounted player carried on with the session
   * it was already playing - it kept polling that session's manifest and
   * never fetched the one the viewer asked for. useLocation subscribes
   * through context, which reaches a component past a parent's bailout.
   */
  const location: ReturnType<typeof useLocation> = useLocation();

  /*
   * The route is ":id/session-replay/:subModelId" and the ids are counted
   * BACKWARDS from the end of the path - the last-but-one segment is the
   * literal "session-replay", not the application id, the same trap
   * Pages/Host/View/ProcessView.tsx documents. parseSessionReplayPlayerRoute
   * does that counting and refuses anything that is not a player path.
   */
  const route: SessionReplayPlayerRoute | null = parseSessionReplayPlayerRoute(
    location.pathname,
  );

  /*
   * The whole player URL model (?t / ?at / ?tab / ?rail / ?signal / ?q) is
   * parsed by ReplayPlayerUrlState, which treats the query string as
   * untrusted input: anything unparseable drops to "absent" rather than
   * defaulting, because silently starting somewhere other than where the
   * link pointed is the failure mode deep links exist to avoid.
   */
  const initialUrlState: ReplayPlayerUrlState = parseReplayPlayerUrlState(
    location.search,
  );

  if (!route) {
    return <ErrorMessage message="No session was specified." />;
  }

  const modelId: ObjectID = new ObjectID(route.rumApplicationId);

  /*
   * Keyed on application + session. The route element is the same React
   * element for every :subModelId, so browser back/forward between two
   * recordings used to REUSE the mounted player and carry one session's
   * playhead, pending seek and auto-play state into the next
   * (player-shell-2). A key makes each session a fresh mount.
   */
  return (
    <Fragment>
      <SessionReplayPlayer
        key={`${modelId.toString()}:${route.sessionId}`}
        rumApplicationId={modelId}
        sessionId={route.sessionId}
        initialUrlState={initialUrlState}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplayView;
