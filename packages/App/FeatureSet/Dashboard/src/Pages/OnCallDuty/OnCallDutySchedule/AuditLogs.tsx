import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const OnCallDutyScheduleAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="On-Call Schedule Audit Logs"
      description="All changes made to this on-call schedule."
      resourceType="On-Call Policy Schedule"
      resourceId={modelId}
    />
  );
};

export default OnCallDutyScheduleAuditLogs;
