import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

const IncomingCallPolicyAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Incoming Call Policy Audit Logs"
      description="All changes made to this incoming call policy."
      resourceType="Incoming Call Policy"
      resourceId={modelId}
    />
  );
};

export default IncomingCallPolicyAuditLogs;
