import PageComponentProps from "../../PageComponentProps";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import InventoryLinkedResource from "../../../Components/Inventory/InventoryLinkedResource";
import {
  LinkedResource,
  buildLinkedResourceQuery,
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
      <InventoryLinkedResource modelId={modelId} signal="incidents">
        {(resource: LinkedResource): ReactElement => {
          return (
            <IncidentsTable
              query={
                {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                  ...buildLinkedResourceQuery(resource),
                } as Query<Incident>
              }
            />
          );
        }}
      </InventoryLinkedResource>
    </Fragment>
  );
};

export default InventoryItemIncidents;
