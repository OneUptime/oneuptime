import PageComponentProps from "../../PageComponentProps";
import SecurityCasePlaybookRuns from "../../../Components/SecurityPlaybook/SecurityCasePlaybookRuns";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The playbooks that ran on the case, newest first: each a line of how far
 * it got, the newest and any held for an approval open on their steps and
 * what each did - the held ones with Approve and Reject. Run
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
