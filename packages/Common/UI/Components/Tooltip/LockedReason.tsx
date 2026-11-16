import Tooltip from "./Tooltip";
import { BUTTON_DISABLED_CURSOR_CLASS_NAME } from "../Button/ButtonStates";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * WHY A LOCKED CONTROL IS LOCKED, REACHABLE BY EVERYONE WHO ASKS (#8587).
 *
 * A disabled <button> takes no focus, no tap and no hover - tippy.js even
 * refuses to show a tooltip whose trigger is disabled - so a reason put in
 * a tooltip on it was never shown: the connect pages' locked provider
 * tiles were greyed out with nothing to say why, from the keyboard, on a
 * phone, or under the mouse. This wraps the locked control, as a locked
 * Button does its own (Button's disabled wrapper):
 *
 *   - Tab reaches the wrapper, and focus shows the reason;
 *   - a press (a tap, a click) shows it and keeps it until the next one;
 *   - a hover shows it, the control inside taking no pointer
 *     (pointer-events-none, which the caller gives it), so the pointer
 *     reaches the wrapper;
 *   - a screen reader hears the reason as the wrapper's description, from
 *     a node that is always there, whether or not the tooltip shows.
 *
 * The reason is in the reader's words already - a permission check's
 * (PermissionGate words it) - and is drawn as given.
 */

export interface ComponentProps {
  reason: string;
  // The locked control: drawn with pointer-events-none by the caller.
  children: ReactElement;
  /*
   * How the wrapper sits where the control did: "inline-flex" for a
   * button in a line (the default), "flex h-full w-full" for a tile that
   * fills its cell.
   */
  layoutClassName?: string | undefined;
  dataTestId?: string | undefined;
}

// The locked look's cursor, as a locked Button's wrapper takes it (ButtonStates).
export const LOCKED_REASON_WRAPPER_CLASS_NAME: string = `${BUTTON_DISABLED_CURSOR_CLASS_NAME} rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1`;

// What a locked control inside the wrapper takes, so the pointer reaches it.
export const LOCKED_CONTROL_CLASS_NAME: string = "pointer-events-none";

const LockedReason: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const reasonId: string = useId();

  return (
    <>
      <Tooltip
        text={props.reason}
        isTextTranslated={true}
        isShownOnPress={true}
        isTriggerAlreadyDescribed={true}
      >
        <span
          tabIndex={0}
          aria-describedby={reasonId}
          className={`${props.layoutClassName || "inline-flex"} ${LOCKED_REASON_WRAPPER_CLASS_NAME}`}
          data-testid={props.dataTestId}
        >
          {props.children}
        </span>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        {props.reason}
      </span>
    </>
  );
};

export default LockedReason;
