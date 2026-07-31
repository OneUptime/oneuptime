import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayPlayer from "../../../Components/SessionReplay/SessionReplayPlayer";

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
   * Deep link into a moment, used by ReplayCard's "watch 10s before the
   * error". Anything unparseable is ignored rather than defaulted, because
   * silently starting somewhere other than where the link pointed is the
   * failure mode this whole feature is trying to avoid.
   */
  const timeParam: string | null = Navigation.getQueryStringByName("t");
  const parsedSeconds: number = timeParam ? Number(timeParam) : NaN;
  const initialOffsetSeconds: number | undefined =
    isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : undefined;

  if (!sessionId || sessionId === "session-replay") {
    return <ErrorMessage message="No session was specified." />;
  }

  return (
    <Fragment>
      <SessionReplayPlayer
        rumApplicationId={modelId}
        sessionId={sessionId}
        initialOffsetSeconds={initialOffsetSeconds}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplayView;
