import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const ScheduledMaintenanceAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Scheduled Maintenance Audit Logs"
      description="All changes made to this scheduled maintenance event."
      resourceType="Scheduled Maintenance Event"
      resourceId={modelId}
    />
  );
};

export default ScheduledMaintenanceAuditLogs;
