import Includes from "Common/Types/BaseDatabase/Includes";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import { CreateFromRecordKind } from "../../../Components/CreateFromRecord/CreateFromRecord";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * A network device's incidents (issue #5341): the ones linked to it - by a
 * person under Other Affected Resources, by the monitors that report on it,
 * or by OneUptime AI from the device's page - with Declare Incident keeping
 * the device picked.
 */
const NetworkDeviceIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Incident> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.networkDevices = new Includes([modelId]);
  }

  return (
    <Fragment>
      <IncidentsTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.NetworkDevice, id: modelId }}
      />
    </Fragment>
  );
};

export default NetworkDeviceIncidents;
