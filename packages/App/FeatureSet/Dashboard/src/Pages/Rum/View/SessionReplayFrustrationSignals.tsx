import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import FrustrationSignalsSettings from "../../../Components/SessionReplay/FrustrationSignals/FrustrationSignalsSettings";

/*
 * Frustration Signals: what counts as rage, dead and error clicks and
 * refresh rage in this application's sessions, and the moments of its own
 * it wants flagged (issue #6443). Beside the Replay Policy, as the other
 * half of how this application's recorders behave.
 */
const RumApplicationSessionReplayFrustrationSignals: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay-frustration-signals", so the model id is
   * one segment before the end, as on the Replay Health page.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <FrustrationSignalsSettings rumApplicationId={modelId} />;
};

export default RumApplicationSessionReplayFrustrationSignals;
