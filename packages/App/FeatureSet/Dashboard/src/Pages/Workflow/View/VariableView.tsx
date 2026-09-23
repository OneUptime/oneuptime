import PageComponentProps from "../../PageComponentProps";
import WorkflowVariableView from "../../../Components/Workflow/WorkflowVariableView";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

// Workflow > Workflow Variables > View Variable: /workflows/:id/variables/:subModelId.
const WorkflowVariableViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const workflowId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const variableId: ObjectID = Navigation.getLastParamAsObjectID(0);

  return (
    <Fragment>
      <WorkflowVariableView variableId={variableId} workflowId={workflowId} />
    </Fragment>
  );
};

export default WorkflowVariableViewPage;
