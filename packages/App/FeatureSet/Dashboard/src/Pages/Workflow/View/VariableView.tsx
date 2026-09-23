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
      {/*
       * Keyed by the workflow and the variable, so moving straight from one
       * variable's page to another's mounts a fresh page rather than handing
       * the new variable to an instance with the old one's requests still in
       * flight.
       */}
      <WorkflowVariableView
        key={`${workflowId.toString()}/${variableId.toString()}`}
        variableId={variableId}
        workflowId={workflowId}
      />
    </Fragment>
  );
};

export default WorkflowVariableViewPage;
