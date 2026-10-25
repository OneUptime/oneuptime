import PageComponentProps from "../../PageComponentProps";
import SecurityCaseDetections from "../../../Components/SecurityCase/SecurityCaseDetections";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What fired to open the case or join it - detection rules, threat
 * intelligence matches and alerts from connected products - each with how
 * often it fired, what it names, and the event that last set it off.
 */
const SecurityCaseDetectionsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <SecurityCaseDetections
      securityCaseId={view.caseId}
      refreshToggle={view.refreshToggle}
    />
  );
};

export default SecurityCaseDetectionsPage;
