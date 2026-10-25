import PageComponentProps from "../../PageComponentProps";
import SecurityCasePlaybookRuns from "../../../Components/SecurityPlaybook/SecurityCasePlaybookRuns";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The playbooks that ran on the case, newest first, each step and what it
 * did - and the steps held for an approval, with Approve and Reject. Run
 * Playbook is the header's, right above; a decision on a held step reads
 * the case again, so the header, the timeline and the side menu's count of
 * runs waiting follow it.
 */
const SecurityCasePlaybookRunsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCasePlaybookRuns
      securityCaseId={view.caseId}
      refreshToggle={view.refreshToggle}
      onRunsChanged={view.refresh}
    />
  );
};

export default SecurityCasePlaybookRunsPage;
