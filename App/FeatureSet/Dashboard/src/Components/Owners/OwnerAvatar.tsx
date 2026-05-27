import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Image from "Common/UI/Components/Image/Image";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface OwnerAvatarItem {
  type: "user" | "team";
  name: string;
  userId?: ObjectID | undefined;
  hasProfilePicture: boolean;
}

const USER_AVATAR_PALETTE: Array<{ bg: string; ring: string }> = [
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

const TEAM_AVATAR_PALETTE: Array<{ bg: string; ring: string }> = [
  { bg: "bg-gradient-to-br from-slate-700 to-slate-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-gray-700 to-gray-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-stone-700 to-stone-900", ring: "ring-white" },
  { bg: "bg-gradient-to-br from-zinc-700 to-zinc-900", ring: "ring-white" },
  {
    bg: "bg-gradient-to-br from-neutral-700 to-neutral-900",
    ring: "ring-white",
  },
];

function hashString(text: string): number {
  let hash: number = 0;
  for (let i: number = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getOwnerAvatarPaletteStyle(
  type: "user" | "team",
  name: string,
): { bg: string; ring: string } {
  const palette: Array<{ bg: string; ring: string }> =
    type === "user" ? USER_AVATAR_PALETTE : TEAM_AVATAR_PALETTE;
  const idx: number = hashString(name) % palette.length;
  return palette[idx] as { bg: string; ring: string };
}

export function getOwnerInitials(name: string): string {
  const parts: Array<string> = name
    .trim()
    .split(/\s+/)
    .filter((p: string) => {
      return p.length > 0;
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
}

export interface ComponentProps {
  item: OwnerAvatarItem;
  size?: AvatarSize | undefined;
  showTeamBadge?: boolean | undefined;
}

const OwnerAvatar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const size: AvatarSize = props.size || "md";
  const showTeamBadge: boolean = props.showTeamBadge !== false;
  const { item } = props;

  const sizeClasses: string =
    size === "lg"
      ? "h-14 w-14 text-base"
      : size === "md"
        ? "h-11 w-11 text-sm"
        : size === "sm"
          ? "h-8 w-8 text-xs"
          : "h-7 w-7 text-[10px]";

  const badgeSizeClass: string =
    size === "xs"
      ? "h-3 w-3 -bottom-0 -right-0"
      : size === "sm"
        ? "h-3.5 w-3.5 -bottom-0.5 -right-0.5"
        : "h-4 w-4 -bottom-0.5 -right-0.5";

  const badgeIconClass: string = size === "xs" ? "h-1.5 w-1.5" : "h-2.5 w-2.5";

  let avatar: ReactElement;

  if (item.type === "user" && item.hasProfilePicture && item.userId) {
    avatar = (
      <Image
        className={`${sizeClasses} rounded-full object-cover ring-2 ring-white shadow-sm bg-gray-100`}
        imageUrl={UserUtil.getProfilePictureRoute(item.userId)}
        alt={item.name}
      />
    );
  } else {
    const palette: { bg: string; ring: string } = getOwnerAvatarPaletteStyle(
      item.type,
      item.name,
    );
    avatar = (
      <div
        className={`${sizeClasses} ${palette.bg} rounded-full ring-2 ${palette.ring} shadow-sm flex items-center justify-center font-semibold text-white select-none`}
      >
        {getOwnerInitials(item.name)}
      </div>
    );
  }

  if (item.type === "team" && showTeamBadge) {
    return (
      <div className="relative inline-flex">
        {avatar}
        <div
          className={`absolute ${badgeSizeClass} rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center shadow-sm`}
          aria-hidden="true"
        >
          <Icon
            icon={IconProp.UserGroup}
            className={`${badgeIconClass} text-gray-600`}
            size={SizeProp.Smaller}
          />
        </div>
      </div>
    );
  }

  return avatar;
};

export default OwnerAvatar;
