import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this device and its owners, and who ran a ping, traceroute
 * or SNMP walk against it, and when: every entry that rolls up to the
 * device - its own, its owners' and its diagnostics'.
 */
const NetworkDeviceAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Device Audit Logs"
      description="Every change made to this device and its owners, and every diagnostic run against it: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default NetworkDeviceAuditLogs;
