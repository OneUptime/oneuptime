import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Icon, { SizeProp } from "../Icon/Icon";
import Image from "../Image/Image";
import UserUtil from "../../Utils/User";
import {
  getPeoplePickerKindDefinition,
  PeoplePickerAvatarStyle,
} from "./PeoplePickerKinds";
import { PeoplePickerKind } from "./PeoplePickerTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The round avatar of a person, a team - any kind the people picker offers -
 * as the Owners page, the owners column of a list and the picker's chips all
 * draw it: a profile picture, or initials on a colour picked from the name,
 * so the same person always gets the same colour. A team is a dark tile with
 * a small people badge, so it never reads as a person.
 */

// "chip" sits inside a picked chip, beside the name.
export type PeopleAvatarSize = "chip" | "xs" | "sm" | "md" | "lg";

export interface PeopleAvatarItem {
  kind: PeoplePickerKind;
  name: string;
  userId?: ObjectID | string | undefined;
  hasProfilePicture?: boolean | undefined;
}

export interface AvatarPaletteEntry {
  bg: string;
  ring: string;
}

const PERSON_AVATAR_PALETTE: Array<AvatarPaletteEntry> = [
  { bg: "bg-gradient-to-br from-indigo-500 to-violet-600", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-sky-500 to-blue-600", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-fuchsia-500 to-pink-600", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-emerald-500 to-teal-600",
    ring: "ring-white",
  },
  { bg: "bg-gradient-to-br from-amber-500 to-orange-600", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-rose-500 to-red-600", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-violet-500 to-purple-600",
    ring: "ring-white",
  },
  { bg: "bg-gradient-to-br from-cyan-500 to-sky-600", ring: "ring-white" },
];

const GROUP_AVATAR_PALETTE: Array<AvatarPaletteEntry> = [
  { bg: "bg-gradient-to-br from-slate-700 to-slate-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-gray-700 to-gray-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-stone-700 to-stone-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-zinc-700 to-zinc-900", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-neutral-700 to-neutral-900",
    ring: "ring-white",
  },
];

const hashString: (text: string) => number = (text: string): number => {
  let hash: number = 0;

  for (let i: number = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }

  return Math.abs(hash);
};

export const getPeopleAvatarPalette: (
  kind: PeoplePickerKind,
  name: string,
) => AvatarPaletteEntry = (
  kind: PeoplePickerKind,
  name: string,
): AvatarPaletteEntry => {
  const palette: Array<AvatarPaletteEntry> =
    getPeoplePickerKindDefinition(kind).avatar.type === "person"
      ? PERSON_AVATAR_PALETTE
      : GROUP_AVATAR_PALETTE;

  return palette[hashString(name) % palette.length] as AvatarPaletteEntry;
};

export const getPeopleInitials: (name: string) => string = (
  name: string,
): string => {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((part: string): boolean => {
      return part.length > 0;
    });

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return ((parts[0] as string)[0] || "?").toUpperCase();
  }

  const first: string = (parts[0] as string)[0] || "";
  const last: string = (parts[parts.length - 1] as string)[0] || "";

  return (first + last).toUpperCase();
};

const SIZE_CLASSES: Record<PeopleAvatarSize, string> = {
  lg: "h-14 w-14 text-base",
  md: "h-11 w-11 text-sm",
  sm: "h-8 w-8 text-xs",
  xs: "h-7 w-7 text-[10px]",
  chip: "h-6 w-6 text-[10px]",
};

const BADGE_SIZE_CLASSES: Record<PeopleAvatarSize, string> = {
  lg: "h-4 w-4 -bottom-0.5 -right-0.5",
  md: "h-4 w-4 -bottom-0.5 -right-0.5",
  sm: "h-3.5 w-3.5 -bottom-0.5 -right-0.5",
  xs: "h-3 w-3 -bottom-0 -right-0",
  chip: "h-3 w-3 -bottom-0.5 -right-0.5",
};

const BADGE_ICON_CLASSES: Record<PeopleAvatarSize, string> = {
  lg: "h-2.5 w-2.5",
  md: "h-2.5 w-2.5",
  sm: "h-2.5 w-2.5",
  xs: "h-1.5 w-1.5",
  chip: "h-2 w-2",
};

export interface ComponentProps {
  item: PeopleAvatarItem;
  size?: PeopleAvatarSize | undefined;
  // A team's small people badge. On by default.
  showGroupBadge?: boolean | undefined;
}

const PeopleAvatar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: PeopleAvatarSize = props.size || "md";
  const { item } = props;
  const style: PeoplePickerAvatarStyle = getPeoplePickerKindDefinition(
    item.kind,
  ).avatar;
  const sizeClasses: string = SIZE_CLASSES[size];
  const userId: string = item.userId ? item.userId.toString() : "";

  if (style.type === "person" && item.hasProfilePicture && userId) {
    return (
      <Image
        className={`${sizeClasses} flex-shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm bg-gray-100`}
        imageUrl={UserUtil.getProfilePictureRoute(
          new ObjectID(userId),
        ).toString()}
        alt={item.name}
      />
    );
  }

  if (style.type === "icon") {
    return (
      <div
        className={`${sizeClasses} flex flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 ring-2 ring-white`}
        aria-hidden="true"
      >
        <Icon icon={style.icon} className="h-1/2 w-1/2" />
      </div>
    );
  }

  const palette: AvatarPaletteEntry = getPeopleAvatarPalette(
    item.kind,
    item.name,
  );

  const avatar: ReactElement = (
    <div
      className={`${sizeClasses} ${palette.bg} flex flex-shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ${palette.ring}`}
      aria-hidden="true"
    >
      {getPeopleInitials(item.name)}
    </div>
  );

  if (style.type !== "group" || props.showGroupBadge === false) {
    return avatar;
  }

  return (
    <div className="relative inline-flex flex-shrink-0">
      {avatar}
      <div
        className={`absolute ${BADGE_SIZE_CLASSES[size]} flex items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200`}
        aria-hidden="true"
      >
        <Icon
          icon={IconProp.UserGroup}
          className={`${BADGE_ICON_CLASSES[size]} text-gray-600`}
          size={SizeProp.Smaller}
        />
      </div>
    </div>
  );
};

export default PeopleAvatar;
