import React, { FunctionComponent, ReactElement } from "react";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import UserElement from "../User/User";
import TeamElement from "../Team/Team";
import { ResourceOwnerEntry } from "./OwnerEntry";

export interface ComponentProps {
  owners: Array<ResourceOwnerEntry> | undefined;
  isLoading?: boolean | undefined;
}

const OwnersCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.isLoading && !props.owners) {
    return <p className="text-gray-400">Loading...</p>;
  }

  const owners: Array<ResourceOwnerEntry> = props.owners || [];

  return (
    <TableColumnListComponent
      items={owners.map((owner: ResourceOwnerEntry, index: number) => {
        return { ...owner, _key: index };
      })}
      moreText={owners.length > 4 ? "more owners" : "more owner"}
      className={owners.length > 0 ? "-mb-1 -mt-1" : ""}
      getEachElement={(entry: ResourceOwnerEntry) => {
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

export default OwnersCell;
