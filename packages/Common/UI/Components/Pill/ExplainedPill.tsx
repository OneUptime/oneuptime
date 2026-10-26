import Color from "../../../Types/Color";
import Pill, { PillSize } from "./Pill";
import Tooltip from "../Tooltip/Tooltip";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * A PILL THAT SAYS WHY, TO EVERYONE WHO ASKS.
 *
 * Some pills are a warning with a reason: "Adds nothing" beside a label or
 * owner rule that matches and adds nothing, "Never reminds" on a maintenance
 * reminder rule that waits for its event to start and stops when it starts.
 * Drawn as a Pill with a tooltip, the reason showed only under a mouse: a
 * phone never hovers, a keyboard never reached the pill, and a screen reader
 * read its two words alone.
 *
 * This one is a real button around the same pill:
 *   - hovering shows the reason, as any tooltip does;
 *   - a tap (or a click) shows it and keeps it until the next one
 *     (Tooltip's isShownOnPress) - on a phone's card of a table too;
 *   - Tab reaches it, and focus shows the reason;
 *   - a screen reader reads the reason as the button's description, from a
 *     node that is always there (aria-describedby), whether or not the
 *     tooltip is showing.
 *
 * A press does nothing else: it is swallowed, so a pill inside a row or a
 * card that is a link or a button never opens it (as InfoTooltip does).
 * The pill looks exactly like the plain one; a pointer shows the help cursor
 * over it.
 */

export interface ComponentProps {
  // The pill's words, as Pill takes them (translated as Pill translates).
  text: string;
  // Why, as one or two plain sentences (translated where it is drawn).
  explanation: string;
  color: Color;
  size?: PillSize | undefined;
  // On the button: what a test or a page finds the pill by.
  dataTestId?: string | undefined;
}

export const EXPLAINED_PILL_CLASS_NAME: string =
  "inline-flex max-w-full cursor-help items-center rounded-full align-middle focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

const ExplainedPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const descriptionId: string = useId();
  const explanation: string =
    translateString(props.explanation) ?? props.explanation;

  return (
    <span className="inline-flex max-w-full">
      <Tooltip
        text={props.explanation}
        isShownOnPress={true}
        isTriggerAlreadyDescribed={true}
      >
        <button
          type="button"
          data-testid={props.dataTestId}
          className={EXPLAINED_PILL_CLASS_NAME}
          aria-describedby={descriptionId}
          onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
            event.preventDefault();
            event.stopPropagation();
          }}
          /*
           * A row or a card that handles Enter / Space itself would hear
           * them bubble up from the pill and act.
           */
          onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>): void => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
            }
          }}
        >
          <Pill text={props.text} color={props.color} size={props.size} />
        </button>
      </Tooltip>
      <span id={descriptionId} hidden={true}>
        {explanation}
      </span>
    </span>
  );
};

export default ExplainedPill;
