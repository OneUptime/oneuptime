import PageComponentProps from "../PageComponentProps";
import WorkflowVariablesTable from "../../Components/Workflow/WorkflowVariablesTable";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      {/* No workflowId - the project's global variables. */}
      <WorkflowVariablesTable />
    </Fragment>
  );
};

export default Workflows;
