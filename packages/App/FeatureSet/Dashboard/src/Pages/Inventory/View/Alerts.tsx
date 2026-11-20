import PageComponentProps from "../../PageComponentProps";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import ManagedDeviceRecordsTable from "../../../Components/DeviceManagement/ManagedDeviceRecordsTable";
import InventoryLinkedResource from "../../../Components/Inventory/InventoryLinkedResource";
import {
  LinkedResource,
  buildLinkedResourceQuery,
  getCreateFromRecordForLinkedResource,
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
      <InventoryLinkedResource
        modelId={modelId}
        signal="alerts"
        /*
         * A device a device manager imports, which no Host stands for: the
         * alerts its device manager's monitors raised about it (#10007).
         */
        renderManagedDevice={(managedDeviceId: ObjectID): ReactElement => {
          return (
            <ManagedDeviceRecordsTable
              managedDeviceId={managedDeviceId}
              kind="alert"
            />
          );
        }}
      >
        {(resource: LinkedResource): ReactElement => {
          return (
            <AlertsTable
              query={
                {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  ...buildLinkedResourceQuery(resource),
                } as Query<Alert>
              }
              createFrom={getCreateFromRecordForLinkedResource(resource)}
            />
          );
        }}
      </InventoryLinkedResource>
    </Fragment>
  );
};

export default InventoryItemAlerts;
