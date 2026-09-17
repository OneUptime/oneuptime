import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, { FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  workflow: Workflow;
  onNavigateComplete?: (() => void) | undefined;
}

const WorkflowElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.workflow._id) {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={
          new Route(
            `/dashboard/${projectId?.toString()}/workflows/${props.workflow._id}`,
          )
        }
      >
        <span>{props.workflow.name}</span>
      </AppLink>
    );
  }

  return <span>{props.workflow.name}</span>;
};

export default WorkflowElement;
