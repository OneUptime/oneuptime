import CloudChangesTable from "../../../Components/Cloud/CloudChangesTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A cloud resource's Changes: what its account's activity log recorded
 * about it, and the health events its provider published naming it.
 */
const CloudResourceChanges: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CloudChangesTable
        id="cloud-resource-changes-table"
        scope={{ cloudResourceId: modelId }}
        description="What changed in this resource, as its cloud's activity log recorded it, and its provider's health events about it. Newest first."
        noItemsMessage="No changes recorded for this resource yet. Its cloud connection records them as it reads the account's activity log."
      />
    </Fragment>
  );
};

export default CloudResourceChanges;
