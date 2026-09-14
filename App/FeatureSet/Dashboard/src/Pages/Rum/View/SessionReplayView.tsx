import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayPlayer from "../../../Components/SessionReplay/SessionReplayPlayer";
import {
  ReplayPlayerUrlState,
  parseReplayPlayerUrlState,
} from "../../../Components/SessionReplay/ReplayPlayerUrlState";

const RumApplicationSessionReplayView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * The route is ":id/session-replay/:subModelId" and the param helpers count
   * BACKWARDS from the end of the URL. getLastParamAsObjectID(1) would return
   * the literal string "session-replay" here, not the application id - the
   * same trap Pages/Host/View/ProcessView.tsx documents.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const sessionId: string = Navigation.getLastParamAsString();

  /*
   * The whole player URL model (?t / ?at / ?tab / ?rail / ?signal / ?q) is
   * parsed by ReplayPlayerUrlState, which treats the query string as
   * untrusted input: anything unparseable drops to "absent" rather than
   * defaulting, because silently starting somewhere other than where the
   * link pointed is the failure mode deep links exist to avoid.
   */
  const initialUrlState: ReplayPlayerUrlState = parseReplayPlayerUrlState(
    Navigation.getQueryString(),
  );

  if (!sessionId || sessionId === "session-replay") {
    return <ErrorMessage message="No session was specified." />;
  }

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
        key={`${modelId.toString()}:${sessionId}`}
        rumApplicationId={modelId}
        sessionId={sessionId}
        initialUrlState={initialUrlState}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplayView;
