import React, { FunctionComponent, ReactElement } from "react";
import Pill from "../Pill/Pill";
import { PillTone } from "../Pill/PillTone";

/*
 * A STATUS BADGE IS A PILL (#9137).
 *
 * It was a chip of its own - a gradient, a ring and bold text - beside the
 * Pill's flat wash, so one page could show "Active" in two shapes and two
 * greens. It now names its tone and the Pill draws it: the same size,
 * corners, dot and contrast in both themes as every other chip. New code
 * draws a Pill with a `tone`; this stays so the pages that use it keep
 * working.
 */

export enum StatusBadgeType {
  Success = "success",
  Warning = "warning",
  Danger = "danger",
  Info = "info",
  Neutral = "neutral",
  // A state someone chose to switch off: grey, with a hollow dot.
  Paused = "paused",
}

export const STATUS_BADGE_TONES: Readonly<Record<StatusBadgeType, PillTone>> =
  Object.freeze({
    [StatusBadgeType.Success]: PillTone.Success,
    [StatusBadgeType.Warning]: PillTone.Warning,
    [StatusBadgeType.Danger]: PillTone.Danger,
    [StatusBadgeType.Info]: PillTone.Info,
    [StatusBadgeType.Neutral]: PillTone.Neutral,
    [StatusBadgeType.Paused]: PillTone.Paused,
  });

export interface ComponentProps {
  text: string;
  type?: StatusBadgeType | undefined;
  // Where it sits in its row (a margin, flex-shrink-0), never its look.
  className?: string | undefined;
  /*
   * The text is drawn as given, never looked up: a name someone typed - a
   * session's own signal, "Payment failed" - which a translation of the
   * same English words would otherwise replace.
   */
  isUserContent?: boolean | undefined;
  /*
   * The badge keeps to one line, never wider than the box it is in: words
   * too long for the room end in "..." - a name someone typed can be long -
   * and show whole under the pointer. Without it a badge wraps between its
   * words, as one of a few short words may.
   */
  isOneLine?: boolean | undefined;
}

const StatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      text={props.text}
      tone={STATUS_BADGE_TONES[props.type || StatusBadgeType.Neutral]}
      isUserContent={props.isUserContent}
      isWrapping={!props.isOneLine}
      isKeepingWordsWhole={!props.isOneLine}
      /*
       * One line, in a flex row: it may shrink below its words, which then
       * end in "...", rather than push its row wider.
       */
      className={
        props.isOneLine
          ? `min-w-0${props.className ? ` ${props.className}` : ""}`
          : props.className
      }
    />
  );
};

export default StatusBadge;
