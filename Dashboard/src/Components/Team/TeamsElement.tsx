import TeamElement from "./Team";
import Team from "Common/Models/DatabaseModels/Team";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  teams: Array<Team>;
  onNavigateComplete?: (() => void) | undefined;
}

const TeamsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.teams || props.teams.length === 0) {
    return <p>No teams.</p>;
  }

  return (
    <TableColumnListComponent
      items={props.teams}
      moreText="more teams"
      getEachElement={(team: Team) => {
        return (
          <TeamElement
            team={team}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No monitors."
    />
  );
};

export default TeamsElement;
