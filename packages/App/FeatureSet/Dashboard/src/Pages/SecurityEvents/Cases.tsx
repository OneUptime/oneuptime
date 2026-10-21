import PageComponentProps from "../PageComponentProps";
import SecurityCasesTable from "../../Components/SecurityCase/SecurityCasesTable";
import { SecurityCaseQueueViewKey } from "../../Components/SecurityCase/SecurityCaseQueueViews";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps extends PageComponentProps {
  /*
   * Which of the case queue's pages this is (SecurityCaseQueueViews.ts):
   * Open Cases, Assigned to Me, Unassigned, Closed Cases or All Cases. The
   * open cases when not given.
   */
  view?: SecurityCaseQueueViewKey | undefined;
}

// One page of the case queue: everything detected, grouped into cases to work.
const SecurityCasesPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <SecurityCasesTable view={props.view} />;
};

export default SecurityCasesPage;
