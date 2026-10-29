import Includes from "Common/Types/BaseDatabase/Includes";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import { CreateFromRecordKind } from "../../../Components/CreateFromRecord/CreateFromRecord";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * A network device's alerts (issue #5341): the ones linked to it, by a
 * person or by the monitors that report on it, with Create Alert keeping
 * the device picked.
 */
const NetworkDeviceAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.networkDevices = new Includes([modelId]);
  }

  return (
    <Fragment>
      <AlertsTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.NetworkDevice, id: modelId }}
      />
    </Fragment>
  );
};

export default NetworkDeviceAlerts;
