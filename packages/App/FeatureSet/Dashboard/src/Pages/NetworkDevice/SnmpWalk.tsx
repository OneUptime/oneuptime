import PageComponentProps from "../PageComponentProps";
import MultiDeviceSnmpWalkCard from "../../Components/NetworkDevice/MultiDeviceSnmpWalkCard";
import {
  MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM,
  MULTI_DEVICE_SNMP_WALK_OID_PARAM,
  MultiDeviceSnmpWalkQuery,
  parseMultiDeviceSnmpWalkQuery,
} from "../../Components/NetworkDevice/MultiDeviceSnmpWalkViewModel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The Network's SNMP Walk page (issue #5548): walk many devices at once and
 * compare what they answer, then collect an OID on every device that does.
 * Reached from the Devices list (select devices, Bulk Actions, SNMP Walk),
 * from a device's own SNMP Walk page (an OID's menu, Check other devices),
 * and from Advanced in the Network menu.
 *
 * Each action is offered only to who may take it - hidden, not disabled, as
 * on a device's own SNMP Walk page: walking needs the diagnostic create
 * permission, collecting the device (or OID Collection Template) update
 * permission.
 *
 * The address holds what was walked, `?devices=<ids>&oid=<oid>`, so a
 * reload, Back from a device, or a link opens on the same walk. It is
 * written in place when a walk starts, never pushed: walking twice adds
 * nothing to the browser's history.
 */
const NetworkSnmpWalk: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [initialQuery] = useState<MultiDeviceSnmpWalkQuery>(() => {
    return parseMultiDeviceSnmpWalkQuery({
      devices: Navigation.getQueryStringByName(
        MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM,
      ),
      oid: Navigation.getQueryStringByName(MULTI_DEVICE_SNMP_WALK_OID_PARAM),
    });
  });

  return (
    <MultiDeviceSnmpWalkCard
      initialQuery={initialQuery}
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
      onQueryChange={(query: MultiDeviceSnmpWalkQuery) => {
        Navigation.setQueryString({
          [MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM]: query.deviceIds.join(","),
          [MULTI_DEVICE_SNMP_WALK_OID_PARAM]: query.startOid,
        });
      }}
    />
  );
};

export default NetworkSnmpWalk;
