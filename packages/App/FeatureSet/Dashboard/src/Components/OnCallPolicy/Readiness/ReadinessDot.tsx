import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, { FunctionComponent, ReactElement } from "react";
import {
  READINESS_STATUS_NOT_REACHABLE,
  READINESS_STATUS_PARTIALLY_READY,
  ReadinessDeliveryContext,
  UserReadinessWire,
  getStatusConsequence,
} from "./ReadinessTypes";

/*
 * The readiness marker that rides along on a responder chip.
 *
 * Rendered only for amber and red. A green dot on every healthy chip would put a
 * mark on the majority of chips in a healthy policy, which is precisely how a
 * scannable summary stops being scannable — the eye has to read every dot to
 * learn that nothing is wrong. Absence is the "ready" signal; the readiness card
 * on the policy overview is where the positive confirmation lives.
 *
 * Red is reserved for the state that actually loses pages. Amber gaps are
 * degraded rather than broken *when the project's fallback is on*: it delivers
 * those pages on whatever verified method the responder has, so the tooltip says
 * so instead of implying the page will vanish. Crying wolf on the amber state is
 * how the existing binary Compliant/Non-Compliant pill lost its audience — but
 * the reverse mistake is worse, so when the fallback is off the tooltip says the
 * pages are dropped, and getStatusConsequence owns that decision for every
 * surface at once.
 */

export interface ComponentProps {
  user: UserReadinessWire;
  // The chip's own label, so the tooltip names the person the reader is looking at.
  label: string;
  /*
   * The project's fallback switch, which decides whether an amber gap is a
   * delayed page or a lost one. Required rather than defaulted: a dot that
   * guesses is a dot that can quietly reassure an admin about a gap that is
   * currently dropping pages.
   */
  isFallbackEnabled: boolean;
}

const ReadinessDot: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isNotReachable: boolean =
    props.user.status === READINESS_STATUS_NOT_REACHABLE;
  const isPartiallyReady: boolean =
    props.user.status === READINESS_STATUS_PARTIALLY_READY;

  if (!isNotReachable && !isPartiallyReady) {
    return <></>;
  }

  const delivery: ReadinessDeliveryContext = {
    isFallbackEnabled: props.isFallbackEnabled,
  };

  /*
   * The consequence sentence names the responder using the chip's own label, so
   * the tooltip talks about the person the reader is pointing at even if the
   * readiness row's stored name differs. The second half is the fix: a tooltip
   * that only states the problem is a dead end, and this one is attached to a
   * chip an admin cannot act on directly.
   */
  const tooltipText: string = `${getStatusConsequence(
    props.user,
    delivery,
    props.label,
  )} ${
    isNotReachable
      ? "They need to add and verify a notification method in User Settings — the Responder readiness card on this policy's overview has the details."
      : "The Responder readiness card on this policy's overview lists which ones and how to fix them."
  }`;

  return (
    <Tooltip text={tooltipText}>
      <span
        role="img"
        aria-label={tooltipText}
        className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
          isNotReachable ? "bg-red-500" : "bg-amber-500"
        }`}
      />
    </Tooltip>
  );
};

/*
 * The third state, and the only one that is about the SURFACE rather than about
 * the responder: this readiness answer is incomplete, and this particular
 * responder is one of the people it does not cover.
 *
 * It exists because absence means "ready" everywhere else on this chip row. When
 * the payload is truncated that inference silently becomes "this person is fine"
 * for someone the check never looked at — the exact substitution the whole
 * feature is built to prevent — so an uncovered chip says "not checked" instead
 * of saying nothing. Grey, never amber: an unknown is not an accusation, and
 * dressing it as one would put a warning on people who are probably fine.
 */
export interface UnknownDotProps {
  label: string;
}

export const ReadinessUnknownDot: FunctionComponent<UnknownDotProps> = (
  props: UnknownDotProps,
): ReactElement => {
  const tooltipText: string = `Readiness for ${props.label} was not checked - this policy has more responders than the readiness check covered, so this chip is unknown rather than ready. Open the Responder readiness card for the full list.`;

  return (
    <Tooltip text={tooltipText}>
      <span
        role="img"
        aria-label={tooltipText}
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400 ring-1 ring-inset ring-gray-500"
      />
    </Tooltip>
  );
};

export default ReadinessDot;
