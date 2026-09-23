import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { getInitials } from "./EventNotesUtil";

export interface ComponentProps {
  userId: ObjectID | null;
  name: string;
  isAutomation?: boolean | undefined;
  size?: "sm" | "md" | undefined;
}

const INITIALS_COLORS: Array<string> = [
  "bg-indigo-100 text-indigo-700",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
];

// The same person always gets the same colour.
export function getInitialsColor(seed: string): string {
  let hash: number = 0;

  for (let i: number = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }

  return INITIALS_COLORS[hash % INITIALS_COLORS.length] as string;
}

/*
 * The author's profile picture, with their initials when there is no picture
 * to load (or it fails to), and the OneUptime mark for notes nobody typed.
 */
const NoteAvatar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [hasImageFailed, setHasImageFailed] = useState<boolean>(false);

  const sizeClassName: string =
    props.size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs";

  if (props.isAutomation) {
    return (
      <span
        aria-hidden="true"
        className={`${sizeClassName} flex shrink-0 items-center justify-center rounded-full bg-gray-900 text-white ring-4 ring-white`}
      >
        <Icon icon={IconProp.Bolt} className="h-4 w-4" />
      </span>
    );
  }

  if (props.userId && !hasImageFailed) {
    return (
      <img
        src={UserUtil.getProfilePictureRoute(props.userId).toString()}
        alt=""
        aria-hidden="true"
        onError={() => {
          setHasImageFailed(true);
        }}
        className={`${sizeClassName} shrink-0 rounded-full bg-gray-100 object-cover ring-4 ring-white`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClassName} flex shrink-0 items-center justify-center rounded-full font-semibold ring-4 ring-white ${getInitialsColor(
        props.userId?.toString() || props.name,
      )}`}
    >
      {getInitials(props.name)}
    </span>
  );
};

export default NoteAvatar;
