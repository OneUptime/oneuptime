import PageComponentProps from "../../PageComponentProps";
import IssueFeed from "../../../Components/DataSecurity/IssueFeed";
import DataSecurityIssueViewContext, {
  useDataSecurityIssueView,
} from "./IssueViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Everything that happened to the issue, with who did it: when its check
 * first failed, each change of severity, evidence, status or assignee, the
 * case, alert and owner notifications it caused, and OneUptime AI's
 * explanations. Read again whenever the issue changes.
 */
const DataSecurityIssueTimelinePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: DataSecurityIssueViewContext = useDataSecurityIssueView();

  return (
    <IssueFeed key={view.refreshToggle} dataSecurityIssueId={view.issueId} />
  );
};

export default DataSecurityIssueTimelinePage;
