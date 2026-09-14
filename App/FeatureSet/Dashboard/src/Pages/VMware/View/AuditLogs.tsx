import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const VMwareVCenterAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * `resourceType` must match the VMwareVCenter model's singularName —
   * that is the string AuditLogService writes for every change.
   */
  return (
    <AuditLogsTable
      title="vCenter Audit Logs"
      description="All changes made to this vCenter."
      resourceType="vCenter"
      resourceId={modelId}
    />
  );
};

export default VMwareVCenterAuditLogs;
