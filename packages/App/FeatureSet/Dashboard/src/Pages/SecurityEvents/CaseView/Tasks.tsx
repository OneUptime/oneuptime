import PageComponentProps from "../../PageComponentProps";
import SecurityCaseTasks from "../../../Components/SecurityCase/Tasks/SecurityCaseTasks";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Tasks: its checklist - what has to be done on it, who is doing
 * each task, and which are done (SecurityCaseTasks). Read again whenever
 * the case changes, as every page of the case is.
 */
const SecurityCaseTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseTasks
      key={view.caseId.toString()}
      caseId={view.caseId}
      refreshToken={view.refreshToggle}
    />
  );
};

export default SecurityCaseTasksPage;
