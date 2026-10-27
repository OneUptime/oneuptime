import PageComponentProps from "../../PageComponentProps";
import SecurityCaseStory from "../../../Components/SecurityCase/Context/SecurityCaseStory";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Story: what happened, in order, across OneUptime - each
 * detection and the requests behind it (how far they got, the trace, the
 * exception they threw), what changed on the records the case names, the
 * incidents and alerts it set off, and what the team and its playbooks did
 * (Components/SecurityCase/Context/SecurityCaseStory.tsx). Read again
 * whenever the case is (its refresh), as a new detection adds to it.
 */
const SecurityCaseStoryPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseStory caseId={view.caseId} refreshToken={view.refreshToggle} />
  );
};

export default SecurityCaseStoryPage;
