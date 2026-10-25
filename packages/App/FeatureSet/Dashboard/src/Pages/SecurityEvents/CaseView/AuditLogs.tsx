import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Every change made to the case, by whom and when, as every record's Audit
 * Logs page lists them (a case is audit-logged, as its model says). The
 * case's Timeline tells its story; this is the record of each write.
 */
const SecurityCaseAuditLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <AuditLogsTable
      title="Case Audit Logs"
      description="All changes made to this case."
      resourceType="Security Case"
      resourceId={view.caseId}
    />
  );
};

export default SecurityCaseAuditLogsPage;
