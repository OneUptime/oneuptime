import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplaySetupGuide from "../../../Components/SessionReplay/SessionReplaySetupGuide";
import SessionReplayDocsReference from "../../../Components/SessionReplay/SessionReplayDocsReference";

/*
 * Session Replay > Documentation: the live setup guide, then a map of the
 * full docs. This is where every "Set up recording" / "Open the setup guide"
 * action lands (getRecordingHealthActionLink's "setup-guide" target).
 */
const RumApplicationSessionReplayDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay-documentation", so the model id is one
   * segment before the end. Same as Pages/Rum/View/SessionReplayAudit.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SessionReplaySetupGuide rumApplicationId={modelId} />
      <SessionReplayDocsReference />
    </Fragment>
  );
};

export default RumApplicationSessionReplayDocumentation;
