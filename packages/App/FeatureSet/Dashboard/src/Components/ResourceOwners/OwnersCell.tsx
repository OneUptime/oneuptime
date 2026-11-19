import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import PeopleAvatar, {
  PeopleAvatarItem,
} from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { ResourceOwnerEntry } from "./OwnerEntry";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { TABLE_VALUE_LOADING_ATTRIBUTE } from "Common/UI/Components/Table/TableFoldedValues";

export interface ComponentProps {
  owners: Array<ResourceOwnerEntry> | undefined;
  isLoading?: boolean | undefined;
  maxVisible?: number | undefined;
}

interface CellOwner extends PeopleAvatarItem {
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
      kind: PeoplePickerKind.User,
      name,
      userId,
      hasProfilePicture: Boolean(entry.user.profilePictureId),
      email: entry.user.email?.toString(),
    };
  }

  return {
    key: `team-${entry.team._id?.toString() || index}`,
    kind: PeoplePickerKind.Team,
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
  const translator: Translator = useTranslator();

  const tooltipContent: ReactElement = (
    <div className="flex items-center gap-3 p-1.5 min-w-[180px]">
      <div className="flex-shrink-0">
        <PeopleAvatar item={item} size="md" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {item.name}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {item.kind === PeoplePickerKind.Team
            ? translator.translateText("Team")
            : item.email || translator.translateText("Owner")}
        </div>
      </div>
    </div>
  );

  /*
   * The row's 24px line tall (the "chip" size), so a row with owners is as
   * tall as one without: at 32px every owned row of a list stood 8px taller
   * than the rows around it.
   *
   * An image named by its owner, for a screen reader: the initials are
   * drawn for the eye only (PeopleAvatar), and the tooltip that names the
   * owner shows under the pointer only, so an owner drawn as initials was
   * not read at all. The name is an attribute, not words in the cell, so
   * the cell's own text - what a cut-short cell shows in full under the
   * pointer - stays its initials.
   *
   * On a touch screen a tap on it says who the owner is: the first tap is
   * the tooltip's own, not the card's, which would open the record - on a
   * tablet a list draws its rows as cards with their owners, and never
   * said who owned one (#9866). A second tap, or a tap elsewhere on the
   * card, opens the record as before.
   */
  return (
    <div className="relative -ml-1.5 first:ml-0 transition-transform duration-150 hover:z-20 hover:-translate-y-0.5">
      <Tooltip richContent={tooltipContent} isShownOnFirstTap={true}>
        <div className="cursor-default" role="img" aria-label={item.name}>
          <PeopleAvatar item={item} size="chip" />
        </div>
      </Tooltip>
    </div>
  );
};

const OwnersCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.isLoading && !props.owners) {
    /*
     * Marked as on its way: folded under a row's title (TableFit), it
     * draws no line of its own until the owners are in.
     */
    return (
      <p
        className="text-gray-500"
        {...{ [TABLE_VALUE_LOADING_ATTRIBUTE]: "true" }}
      >
        {translator.translateText("Loading...")}
      </p>
    );
  }

  const owners: Array<ResourceOwnerEntry> = props.owners || [];

  /*
   * No owners is a quiet dash, as every empty cell of a table is: "No
   * owners." down the whole column was the loudest thing in rows with
   * nothing to say. A screen reader still hears the words.
   */
  if (owners.length === 0) {
    return <TableEmptyValue screenReaderText="No owners." />;
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
            <PeopleAvatar item={owner} size="xs" />
            <div className="flex flex-col min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">
                {owner.name}
              </div>
              {owner.kind === PeoplePickerKind.User && owner.email ? (
                <div className="text-xs text-gray-500 truncate">
                  {owner.email}
                </div>
              ) : null}
              {owner.kind === PeoplePickerKind.Team ? (
                <div className="text-xs text-gray-500">
                  {translator.translateText("Team")}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-6 items-center">
      {visibleOwners.map((owner: CellOwner) => {
        return <OwnerCircle key={owner.key} item={owner} />;
      })}
      {hiddenOwners.length > 0 ? (
        <div className="relative -ml-1.5 transition-transform duration-150 hover:z-20 hover:-translate-y-0.5">
          {/*
           * Read as the owners it stands for, after the ones drawn before
           * it, rather than as "+2". A tap shows them, as an owner's does.
           */}
          <Tooltip richContent={overflowTooltip} isShownOnFirstTap={true}>
            <div
              className="h-6 w-6 rounded-full bg-gray-100 ring-2 ring-white shadow-sm flex items-center justify-center text-xs font-semibold text-gray-700 select-none cursor-default"
              role="img"
              aria-label={hiddenOwners
                .map((owner: CellOwner): string => {
                  return owner.name;
                })
                .join(", ")}
            >
              +{hiddenOwners.length}
            </div>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
};

export default OwnersCell;
