import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";
import UserElement from "../User/User";
import TeamElement from "../Team/Team";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";

export type MonitorOwnerEntry =
  | { kind: "user"; user: User }
  | { kind: "team"; team: Team };

export interface ComponentProps {
  owners: Array<MonitorOwnerEntry> | undefined;
  isLoading?: boolean | undefined;
}

const MonitorOwnersCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.isLoading && !props.owners) {
    return <p className="text-gray-400">Loading...</p>;
  }

  const owners: Array<MonitorOwnerEntry> = props.owners || [];

  return (
    <TableColumnListComponent
      items={owners.map((owner: MonitorOwnerEntry, index: number) => {
        return { ...owner, _key: index };
      })}
      moreText={owners.length > 4 ? "more owners" : "more owner"}
      className={owners.length > 0 ? "-mb-1 -mt-1" : ""}
      getEachElement={(entry: MonitorOwnerEntry) => {
        if (entry.kind === "user") {
          return (
            <div className="my-1">
              <UserElement user={entry.user} />
            </div>
          );
        }

        return (
          <div className="my-1">
            <TeamElement team={entry.team} />
          </div>
        );
      }}
      noItemsMessage={"No owners."}
    />
  );
};

export default MonitorOwnersCell;
