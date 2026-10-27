import CloudChangesTable from "../../../../Components/Cloud/CloudChangesTable";
import PageComponentProps from "../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Changes: everything its activity log recorded and every
 * health event its provider published about it, whichever resource each
 * one names - newest first.
 */
const CloudAccountChanges: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CloudChangesTable
        id="cloud-account-changes-table"
        scope={{ cloudAccountId: modelId }}
        showRegion={true}
        description="What changed in this account, as its activity log recorded it, and its provider's health events about it. Newest first."
        noItemsMessage="No changes recorded for this account yet. Its cloud connection records them as it reads the activity log."
      />
    </Fragment>
  );
};

export default CloudAccountChanges;
