import PageComponentProps from "../../PageComponentProps";
import SecurityCaseFeed from "../../../Components/SecurityCase/SecurityCaseFeed";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Everything that happened to the case, with who did it: how it opened,
 * each detection that joined it, each change of status, priority or
 * assignee, the notes written on it, every playbook step and approval, who
 * was told, and OneUptime AI's triage. Read again whenever the case changes.
 */
const SecurityCaseTimelinePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseFeed key={view.refreshToggle} securityCaseId={view.caseId} />
  );
};

export default SecurityCaseTimelinePage;
