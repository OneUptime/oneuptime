import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  team: Team;
  onNavigateComplete?: (() => void) | undefined;
}

const TeamElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    props.team._id &&
    (props.team.projectId || (props.team.project && props.team.project._id))
  ) {
    const projectId: string | undefined = props.team.projectId
      ? props.team.projectId.toString()
      : props.team.project
        ? props.team.project._id
        : "";
    return (
      <Link
        onNavigateComplete={props.onNavigateComplete}
        className="hover:underline"
        to={
          new Route(`/dashboard/${projectId}/settings/teams/${props.team._id}`)
        }
      >
        <span>{props.team.name}</span>
      </Link>
    );
  }

  return <span>{props.team.name}</span>;
};

export default TeamElement;
