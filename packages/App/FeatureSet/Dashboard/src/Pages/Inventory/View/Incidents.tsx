import PageComponentProps from "../../PageComponentProps";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import ManagedDeviceRecordsTable from "../../../Components/DeviceManagement/ManagedDeviceRecordsTable";
import InventoryLinkedResource from "../../../Components/Inventory/InventoryLinkedResource";
import {
  LinkedResource,
  buildLinkedResourceQuery,
  getCreateFromRecordForLinkedResource,
} from "../../../Components/Inventory/LinkedResource";
import Incident from "Common/Models/DatabaseModels/Incident";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const InventoryItemIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <InventoryLinkedResource
        modelId={modelId}
        signal="incidents"
        /*
         * A device a device manager imports, which no Host stands for: the
         * incidents its device manager's monitors raised about it, for a
         * monitor made to raise incidents (#10007).
         */
        renderManagedDevice={(managedDeviceId: ObjectID): ReactElement => {
          return (
            <ManagedDeviceRecordsTable
              managedDeviceId={managedDeviceId}
              kind="incident"
            />
          );
        }}
      >
        {(resource: LinkedResource): ReactElement => {
          return (
            <IncidentsTable
              query={
                {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  ...buildLinkedResourceQuery(resource),
                } as Query<Incident>
              }
              createFrom={getCreateFromRecordForLinkedResource(resource)}
            />
          );
        }}
      </InventoryLinkedResource>
    </Fragment>
  );
};

export default InventoryItemIncidents;
