import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps {
  team: Team;
  onNavigateComplete?: (() => void) | undefined;
}

const TeamElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    props.team._id &&
    (props.team.projectId ||
      (props.team.project && props.team.project._id) ||
      ProjectUtil.getCurrentProjectId())
  ) {
    let projectId: string | undefined = props.team.projectId
      ? props.team.projectId.toString()
      : props.team.project
        ? props.team.project._id
        : "";

    if (!projectId) {
      projectId = ProjectUtil.getCurrentProjectId()?.toString();
    }
    return (
      <AppLink
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={
          new Route(`/dashboard/${projectId}/settings/teams/${props.team._id}`)
        }
      >
        <span>{props.team.name}</span>
      </AppLink>
    );
  }

  return <span>{props.team.name}</span>;
};

export default TeamElement;
