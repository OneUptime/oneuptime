import React, { FunctionComponent, ReactElement } from "react";

/*
 * The small monogram circle beside a user in the session list and the
 * Users view. One person, one colour: the hue comes from
 * SessionReplayUserIdentity.stableHue, so the same identified user or
 * visitor reads as the same disc on every row, page and reload, and a
 * support engineer can spot "the same person again" three rows down
 * before reading a single label.
 *
 * Purely decorative - the text beside it carries the name - so it is
 * hidden from assistive technology.
 */

export interface SessionReplayUserAvatarProps {
  initials: string;
  /* null draws the dashed "nobody in particular" disc for anonymous rows. */
  hue: number | null;
  size?: "sm" | "md" | undefined;
}

const SIZE_CLASSES: Record<"sm" | "md", string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
};

const SessionReplayUserAvatar: FunctionComponent<
  SessionReplayUserAvatarProps
> = (props: SessionReplayUserAvatarProps): ReactElement => {
  const size: "sm" | "md" = props.size ?? "sm";

  if (props.hue === null) {
    return (
      <span
        aria-hidden="true"
        data-testid="session-user-avatar"
        data-hue=""
        className={`inline-flex flex-none items-center justify-center rounded-full border border-dashed border-gray-300 bg-gray-100 font-semibold text-gray-400 ${SIZE_CLASSES[size]}`}
      >
        {props.initials}
      </span>
    );
  }

  /*
   * A light tint with a dark ink of the same hue: legible on white for
   * every hue, and distinct enough between hues that two people three
   * rows apart do not look alike.
   */
  return (
    <span
      aria-hidden="true"
      data-testid="session-user-avatar"
      data-hue={String(props.hue)}
      className={`inline-flex flex-none items-center justify-center rounded-full font-semibold ${SIZE_CLASSES[size]}`}
      style={{
        backgroundColor: `hsl(${props.hue} 70% 90%)`,
        color: `hsl(${props.hue} 45% 30%)`,
      }}
    >
      {props.initials}
    </span>
  );
};

export default SessionReplayUserAvatar;
