import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayTable from "../../../Components/SessionReplay/SessionReplayTable";
import RecordingHealthStrip from "../../../Components/SessionReplay/RecordingHealthStrip";

/*
 * The sessions list page: RecordingHealthStrip -> SessionReplayTable
 * (search bar, quick filters, sort, rows, explained empty state).
 *
 * The strip and the table's empty state subscribe to the SAME health
 * poller (useSessionReplayHealth keeps one per application), so the line
 * above the list and the reason under it can never disagree about why
 * nothing is here. The setup guide is rendered by the empty state, not by
 * this page: only the empty state knows whether the list is empty because
 * nothing was ever recorded or because somebody over-filtered.
 */
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
