import PageComponentProps from "../PageComponentProps";
import RunbookVariablesTable from "../../Components/Runbook/RunbookVariablesTable";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Runbooks > Settings > Global Variables: the project's own variables,
 * which every runbook can use. Runbook secrets were merged into them, and
 * the credentials runbook steps named became secret variables too.
 */
const RunbookGlobalVariables: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <RunbookVariablesTable />;
};

export default RunbookGlobalVariables;
