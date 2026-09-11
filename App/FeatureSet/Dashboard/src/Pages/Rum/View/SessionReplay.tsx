import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayTable from "../../../Components/SessionReplay/SessionReplayTable";
import RecordingHealthStrip from "../../../Components/SessionReplay/RecordingHealthStrip";

/* Recording health stays outside the table; setup lives on Documentation. */
const RumApplicationSessionReplay: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay", so the model id is one segment before the
   * end. Same as Pages/Rum/View/Clients.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <RecordingHealthStrip rumApplicationId={modelId} />
      <SessionReplayTable rumApplicationId={modelId} />
    </Fragment>
  );
};

export default RumApplicationSessionReplay;
