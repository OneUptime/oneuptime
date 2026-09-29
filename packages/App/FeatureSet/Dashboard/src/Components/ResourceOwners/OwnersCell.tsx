import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import OwnerAvatar, { OwnerAvatarItem } from "../Owners/OwnerAvatar";
import { ResourceOwnerEntry } from "./OwnerEntry";

export interface ComponentProps {
  owners: Array<ResourceOwnerEntry> | undefined;
  isLoading?: boolean | undefined;
  maxVisible?: number | undefined;
}

interface CellOwner extends OwnerAvatarItem {
  key: string;
  email?: string | undefined;
}

function toCellOwner(entry: ResourceOwnerEntry, index: number): CellOwner {
  if (entry.kind === "user") {
    const userId: ObjectID | undefined = entry.user.id ?? undefined;
    const name: string =
      entry.user.name?.toString() || entry.user.email?.toString() || "User";
    return {
      key: `user-${userId?.toString() || entry.user._id?.toString() || index}`,
      type: "user",
      name,
      userId,
      hasProfilePicture: Boolean(entry.user.profilePictureId),
      email: entry.user.email?.toString(),
    };
  }

  return {
    key: `team-${entry.team._id?.toString() || index}`,
    type: "team",
    name: entry.team.name?.toString() || "Team",
    hasProfilePicture: false,
  };
}

interface OwnerCircleProps {
  item: CellOwner;
}

const OwnerCircle: FunctionComponent<OwnerCircleProps> = (
  props: OwnerCircleProps,
): ReactElement => {
  const { item } = props;

  const tooltipContent: ReactElement = (
    <div className="flex items-center gap-3 p-1.5 min-w-[180px]">
      <div className="flex-shrink-0">
        <OwnerAvatar item={item} size="md" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {item.name}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {item.type === "team" ? "Team" : item.email || "Owner"}
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative -ml-2 first:ml-0 transition-transform duration-150 hover:z-20 hover:-translate-y-0.5">
      <Tooltip richContent={tooltipContent}>
        <div className="cursor-default">
          <OwnerAvatar item={item} size="sm" />
        </div>
      </Tooltip>
    </div>
  );
};

const OwnersCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.isLoading && !props.owners) {
    return <p className="text-gray-400">Loading...</p>;
  }

  const owners: Array<ResourceOwnerEntry> = props.owners || [];

  if (owners.length === 0) {
    return <p className="text-gray-400">No owners.</p>;
  }

  const cellOwners: Array<CellOwner> = owners.map(toCellOwner);
  const maxVisible: number = props.maxVisible ?? 4;
  const visibleOwners: Array<CellOwner> = cellOwners.slice(0, maxVisible);
  const hiddenOwners: Array<CellOwner> = cellOwners.slice(maxVisible);

  const overflowTooltip: ReactElement = (
    <div className="flex flex-col gap-1 p-1.5 min-w-[180px]">
      {hiddenOwners.map((owner: CellOwner) => {
        return (
          <div key={owner.key} className="flex items-center gap-2">
            <OwnerAvatar item={owner} size="xs" />
            <div className="flex flex-col min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">
                {owner.name}
              </div>
              {owner.type === "user" && owner.email ? (
                <div className="text-xs text-gray-500 truncate">
                  {owner.email}
                </div>
              ) : null}
              {owner.type === "team" ? (
                <div className="text-xs text-gray-500">Team</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex items-center">
      {visibleOwners.map((owner: CellOwner) => {
        return <OwnerCircle key={owner.key} item={owner} />;
      })}
      {hiddenOwners.length > 0 ? (
        <div className="relative -ml-2 transition-transform duration-150 hover:z-20 hover:-translate-y-0.5">
          <Tooltip richContent={overflowTooltip}>
            <div className="h-8 w-8 rounded-full bg-gray-100 ring-2 ring-white shadow-sm flex items-center justify-center text-xs font-semibold text-gray-700 select-none cursor-default">
              +{hiddenOwners.length}
            </div>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
};

export default OwnersCell;
