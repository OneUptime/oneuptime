import PageComponentProps from "../../PageComponentProps";
import SecurityCaseEvidenceTable from "../../../Components/SecurityCase/Evidence/SecurityCaseEvidenceTable";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Evidence: the files, links and security events kept on it, each
 * with who added it and when - a file with the SHA-256 of what was
 * uploaded, an event as it was when it was kept (SecurityCaseEvidenceTable).
 */
const SecurityCaseEvidencePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseEvidenceTable
      key={view.caseId.toString()}
      caseId={view.caseId}
    />
  );
};

export default SecurityCaseEvidencePage;
