import PageComponentProps from "../../PageComponentProps";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import InventoryLinkedResource from "../../../Components/Inventory/InventoryLinkedResource";
import {
  LinkedResource,
  buildLinkedResourceQuery,
} from "../../../Components/Inventory/LinkedResource";
import Alert from "Common/Models/DatabaseModels/Alert";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const InventoryItemAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <InventoryLinkedResource modelId={modelId} signal="alerts">
        {(resource: LinkedResource): ReactElement => {
          return (
            <AlertsTable
              query={
                {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  ...buildLinkedResourceQuery(resource),
                } as Query<Alert>
              }
            />
          );
        }}
      </InventoryLinkedResource>
    </Fragment>
  );
};

export default InventoryItemAlerts;
