import PageComponentProps from "../../PageComponentProps";
import SecurityCaseTasks from "../../../Components/SecurityCase/Tasks/SecurityCaseTasks";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Tasks: its checklist - what has to be done on it, who is doing
 * each task, and which are done (SecurityCaseTasks). Read again whenever
 * the case changes, as every page of the case is. A case about a data store
 * draws the exposure assessment's answer under each task of the Close a
 * Data Exposure checklist, so its entities go with it.
 */
const SecurityCaseTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseTasks
      key={view.caseId.toString()}
      caseId={view.caseId}
      entities={view.securityCase.entities}
      refreshToken={view.refreshToggle}
    />
  );
};

export default SecurityCaseTasksPage;
