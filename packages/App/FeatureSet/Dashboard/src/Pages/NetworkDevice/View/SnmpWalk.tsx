import PageComponentProps from "../../PageComponentProps";
import SnmpWalkCard from "../../../Components/NetworkDevice/SnmpWalkCard";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A device's SNMP Walk page (issue #5184): walk the OID tree the device
 * exposes, from its probe with its saved credentials, and collect what it
 * finds. Each action is offered only to who may take it - hidden, not
 * disabled, as the device's other on-demand tools are: walking needs the
 * diagnostic create permission, collecting the device (or its OID
 * Collection Template) update permission, and "Alert on it" the monitor
 * create permission. Anyone who can read the device can read its last walk.
 */
const NetworkDeviceSnmpWalk: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <SnmpWalkCard
      networkDeviceId={modelId}
      canWalk={
        PermissionGate.check(new NetworkDeviceDiagnostic(), ModelAction.Create)
          .isAllowed
      }
      canEditDevice={
        PermissionGate.check(new NetworkDevice(), ModelAction.Update).isAllowed
      }
      canEditTemplate={
        PermissionGate.check(new NetworkDeviceOidTemplate(), ModelAction.Update)
          .isAllowed
      }
      canCreateMonitor={
        PermissionGate.check(new Monitor(), ModelAction.Create).isAllowed
      }
    />
  );
};

export default NetworkDeviceSnmpWalk;
