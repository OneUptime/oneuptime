import type { OnCallPageRecordType } from "../api/onCallPassOn";
import { PASS_ON_TEXT } from "./passOn";

/*
 * ACKNOWLEDGE AND ESCALATE FROM A PAGE'S PUSH.
 *
 * A push about a page carries two actions under it, on the lock screen and
 * in the notification shade (the server names the on-call page category,
 * notifications/categories.ts): Acknowledge, and Escalate for when the reader
 * cannot take it. Either opens the app - after the phone is unlocked, and
 * after the app's own biometric lock - on the record the page is about, and
 * the record's screen does what was asked with what it now knows:
 *
 *   Acknowledge  the record's own Acknowledge while nobody has; Acknowledge
 *                again on a page again, whose record was acknowledged all
 *                along; and otherwise it says why there was nothing to do.
 *   Escalate     asks first, as the screen's Escalate does, saying what
 *                escalating will do; or says there is nothing to escalate.
 *
 * Opening the app first is deliberate: the answer is then said on the screen
 * that shows the record, with the app's own session and lock, instead of
 * being fired off unseen from a background task that cannot tell the reader
 * when it fails - a failed acknowledgement from the lock screen is a page
 * that escalates while its reader thinks it is taken.
 */

export type PushPageActionKind = "acknowledge" | "escalate";

/**
 * What a push's action asks the record's screen to do, as a navigation
 * param: the action, and an id of the tap, so the screen does each tap once.
 */
export interface PushPageActionRequest {
  kind: PushPageActionKind;
  id: string;
}

export function isPushPageActionRequest(
  value: unknown,
): value is PushPageActionRequest {
  const request: Partial<PushPageActionRequest> | null =
    value && typeof value === "object"
      ? (value as Partial<PushPageActionRequest>)
      : null;

  return (
    Boolean(request) &&
    (request!.kind === "acknowledge" || request!.kind === "escalate") &&
    typeof request!.id === "string" &&
    request!.id.length > 0
  );
}

export interface PushPageRecordState {
  recordType: OnCallPageRecordType;
  isResolved: boolean;
  isAcknowledged: boolean;
  // The project has an acknowledged state to move the record to.
  canAcknowledge: boolean;
  // The reader's open pages about the record: any at all, and a page again among them.
  hasOpenPages: boolean;
  isPageAgain: boolean;
  // Whether the server could say what the reader's open pages are.
  pagesKnown: boolean;
}

export type PushPageAnswer =
  | { kind: "acknowledge" }
  | { kind: "acknowledgeAgain" }
  | { kind: "askToEscalate" }
  | { kind: "explain"; title: string; message: string };

// What the record is called in a sentence: both kinds of episode are an "episode".
export function getPushPageRecordWord(
  recordType: OnCallPageRecordType,
): string {
  if (recordType === "alert") {
    return "alert";
  }
  if (recordType === "incident-episode" || recordType === "alert-episode") {
    return "episode";
  }
  return "incident";
}

export const PUSH_PAGE_TEXT: Readonly<{
  alreadyResolvedTitle: string;
  alreadyAcknowledgedTitle: string;
  couldNotAcknowledgeTitle: string;
  couldNotEscalateTitle: string;
  couldNotEscalate: string;
  notPaged: string;
}> = {
  alreadyResolvedTitle: "Already resolved",
  // The Dashboard's heading for the same answer (PassOnPage).
  alreadyAcknowledgedTitle: "Already acknowledged",
  couldNotAcknowledgeTitle: "Could not acknowledge",
  couldNotEscalateTitle: "Could not escalate",
  couldNotEscalate:
    "OneUptime could not say whether you are being paged about it. Pull down to refresh, then try again.",
  notPaged: "You are not being paged about this right now.",
};

/** What the record's screen does for a push's action, from what it now knows. */
export function getPushPageAnswer(
  kind: PushPageActionKind,
  state: PushPageRecordState,
): PushPageAnswer {
  const word: string = getPushPageRecordWord(state.recordType);

  if (kind === "acknowledge") {
    if (state.isResolved) {
      return {
        kind: "explain",
        title: PUSH_PAGE_TEXT.alreadyResolvedTitle,
        message: `This ${word} is resolved, so there is nothing to acknowledge.`,
      };
    }

    if (state.isAcknowledged && state.isPageAgain) {
      return { kind: "acknowledgeAgain" };
    }

    if (state.isAcknowledged) {
      return {
        kind: "explain",
        title: PUSH_PAGE_TEXT.alreadyAcknowledgedTitle,
        message: `This ${word} was already acknowledged, and you are not being paged about it.`,
      };
    }

    if (!state.canAcknowledge) {
      return {
        kind: "explain",
        title: PUSH_PAGE_TEXT.couldNotAcknowledgeTitle,
        message: `This project has no acknowledged state for this ${word}.`,
      };
    }

    return { kind: "acknowledge" };
  }

  if (!state.pagesKnown) {
    return {
      kind: "explain",
      title: PUSH_PAGE_TEXT.couldNotEscalateTitle,
      message: PUSH_PAGE_TEXT.couldNotEscalate,
    };
  }

  if (!state.hasOpenPages || state.isResolved) {
    return {
      kind: "explain",
      title: PASS_ON_TEXT.notDoneTitle,
      message: PUSH_PAGE_TEXT.notPaged,
    };
  }

  return { kind: "askToEscalate" };
}
