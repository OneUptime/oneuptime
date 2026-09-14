import PageComponentProps from "../../PageComponentProps";
import WorkflowVariablesTable from "../../../Components/Workflow/WorkflowVariablesTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Workflows: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <WorkflowVariablesTable workflowId={modelId} />
    </Fragment>
  );
};

export default Workflows;
