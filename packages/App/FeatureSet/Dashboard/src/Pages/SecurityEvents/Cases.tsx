import PageComponentProps from "../PageComponentProps";
import SecurityCasesTable from "../../Components/SecurityCase/SecurityCasesTable";
import React, { FunctionComponent, ReactElement } from "react";

// The case queue: everything detected, grouped into cases to work.
const SecurityCasesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <SecurityCasesTable />;
};

export default SecurityCasesPage;
