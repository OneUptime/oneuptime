import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this form, its custom domains and its submissions, and
 * when: every entry that rolls up to the form. A submission a visitor
 * sends is OneUptime's own write, recorded when the project stores
 * system events; deleting one is always recorded.
 */
const FormAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Form Audit Logs"
      description="Every change made to this form, its custom domains and its submissions: who made it, when, and what changed."
      rootResourceId={modelId}
    />
  );
};

export default FormAuditLogs;
