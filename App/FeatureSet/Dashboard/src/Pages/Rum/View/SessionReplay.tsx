import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayTable from "../../../Components/SessionReplay/SessionReplayTable";
import SessionReplaySetupGuide from "../../../Components/SessionReplay/SessionReplaySetupGuide";

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
      {/*
       * The setup guide is rendered by the table, not beside it: only the
       * table knows whether the empty list is "never set up" or "your
       * filters matched nothing", and showing installation steps to
       * somebody who simply over-filtered would be noise.
       */}
      <SessionReplayTable
        rumApplicationId={modelId}
        renderWhenEmpty={<SessionReplaySetupGuide rumApplicationId={modelId} />}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplay;
