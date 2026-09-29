import PageComponentProps from "../PageComponentProps";
import WorkflowVariableView from "../../Components/Workflow/WorkflowVariableView";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

// Workflows > Global Variables > View Variable.
const GlobalWorkflowVariableView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const variableId: ObjectID = Navigation.getLastParamAsObjectID(0);

  return (
    <Fragment>
      {/* No workflowId - one of the project's global variables. */}
      {/*
       * Keyed by the variable, so moving straight from one variable's page to
       * another's mounts a fresh page rather than handing the new variable to
       * an instance with the old one's requests still in flight.
       */}
      <WorkflowVariableView
        key={variableId.toString()}
        variableId={variableId}
      />
    </Fragment>
  );
};

export default GlobalWorkflowVariableView;
