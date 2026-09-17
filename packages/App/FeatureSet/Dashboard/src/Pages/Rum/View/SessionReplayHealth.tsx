import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import RecordingHealthDashboard from "../../../Components/SessionReplay/RecordingHealthDashboard";

/*
 * Replay Health: is anything being recorded for this application, and if
 * not, where does it stop? Its own page beside the session list, so the list
 * stays a list and the health picture has room for every stage, counter and
 * budget rather than a one-line strip above the table.
 */
const RumApplicationSessionReplayHealth: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay-health", so the model id is one segment
   * before the end. Same as Pages/Rum/View/SessionReplayAudit.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <RecordingHealthDashboard rumApplicationId={modelId} />;
};

export default RumApplicationSessionReplayHealth;
