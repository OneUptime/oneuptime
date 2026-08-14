import PageComponentProps from "../../PageComponentProps";
import ScheduledMaintenancesTable from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import InventoryLinkedResource from "../../../Components/Inventory/InventoryLinkedResource";
import {
  LinkedResource,
  buildLinkedResourceQuery,
} from "../../../Components/Inventory/LinkedResource";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const InventoryItemScheduledMaintenance: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <InventoryLinkedResource modelId={modelId} signal="maintenance windows">
        {(resource: LinkedResource): ReactElement => {
          return (
            <ScheduledMaintenancesTable
              query={
                {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  ...buildLinkedResourceQuery(resource),
                } as Query<ScheduledMaintenance>
              }
            />
          );
        }}
      </InventoryLinkedResource>
    </Fragment>
  );
};

export default InventoryItemScheduledMaintenance;
