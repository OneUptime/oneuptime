/*
 * "TRY AGAIN" ON THE REMEDIATION STEP OF AN INCIDENT'S OR ALERT'S AI CARD.
 *
 * OneUptime AI decides how to fix an incident (or alert) once: when it is
 * declared, or - when it is investigated first - once the investigation is
 * done (AutoRemediationRuleEngineService, and the AutoRemediationDecision
 * it writes down). It decides with the project's settings of that moment.
 * Turning on "Fix new incidents automatically", a cluster's or a host's
 * fixes, or an AI agent afterwards changes what it would decide now, and
 * the incident still said what it decided then - so a project with fixing
 * on saw nothing being fixed on the incidents it already had (block 43:
 * "I have auto remediation enabled ... but I do not see any remediation
 * happening at all").
 *
 * Try again asks OneUptime AI to decide again, now, with the settings of
 * now, exactly as it decides for a new incident: Enable AI, the fixing
 * switch, the AI rules, each cluster's and resource's fix mode and the
 * per-incident cap all decide, and the step shows the new decision. Turning
 * a switch on never reaches back into open incidents on its own: the
 * switch says "new", and one person's switch must not set fixes going on
 * every open incident of the project at once.
 *
 * Offered on an open incident whose latest decision fixed nothing, to
 * whoever may change the incident - the same person whose link of what the
 * incident is about already makes OneUptime AI try again (#5293).
 *
 * Shared by the server (the route and the engine) and the Dashboard (the
 * step's button and what it says when the server refuses), so both name
 * the same answers in the same words.
 */

/*
 * How long after OneUptime AI decided about a record the same record may be
 * decided again: long enough that a double click, or two people pressing at
 * once, decide once; short enough that someone who has just turned a
 * setting on is never kept waiting.
 */
export const REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS: number = 30;

export enum RemediationTryAgainResult {
  // Decided again: the step reads the new decision.
  Evaluated = "Evaluated",
  // The record is resolved: nothing is fixed on a resolved record.
  Resolved = "Resolved",
  /*
   * Remediation still waits for the record's investigation, and decides as
   * soon as it is done.
   */
  WaitingForInvestigation = "WaitingForInvestigation",
  /*
   * A fix is being worked out, or waits for approval: deciding again would
   * only find it.
   */
  FixInProgress = "FixInProgress",
  // Decided less than REMEDIATION_TRY_AGAIN_COOLDOWN_SECONDS ago.
  TooSoon = "TooSoon",
  /*
   * Another try - or a link of what the record is about - is deciding it at
   * this very moment.
   */
  Busy = "Busy",
}

export type RemediationTryAgainRefusal = Exclude<
  RemediationTryAgainResult,
  RemediationTryAgainResult.Evaluated
>;

export type RemediationTryAgainSignal = "incident" | "alert";

/*
 * What the server answers when it does not decide again, one sentence per
 * kind of record. English, as every refusal of the API is; the Dashboard
 * holds the same sentences as translation keys (RemediationStepCopy), so
 * the step says them in the reader's language.
 */
export const REMEDIATION_TRY_AGAIN_REFUSALS: Readonly<
  Record<
    RemediationTryAgainRefusal,
    Readonly<Record<RemediationTryAgainSignal, string>>
  >
> = {
  [RemediationTryAgainResult.Resolved]: {
    incident:
      "This incident is resolved, so OneUptime AI does not try to fix it.",
    alert: "This alert is resolved, so OneUptime AI does not try to fix it.",
  },
  [RemediationTryAgainResult.WaitingForInvestigation]: {
    incident:
      "OneUptime AI decides how to fix this incident as soon as its investigation is done.",
    alert:
      "OneUptime AI decides how to fix this alert as soon as its investigation is done.",
  },
  [RemediationTryAgainResult.FixInProgress]: {
    incident:
      "A fix for this incident is being worked out or waits for approval. Approve or dismiss it first.",
    alert:
      "A fix for this alert is being worked out or waits for approval. Approve or dismiss it first.",
  },
  [RemediationTryAgainResult.TooSoon]: {
    incident:
      "OneUptime AI has just checked this incident. Try again in a moment.",
    alert: "OneUptime AI has just checked this alert. Try again in a moment.",
  },
  [RemediationTryAgainResult.Busy]: {
    incident:
      "OneUptime AI is checking this incident right now. Try again in a moment.",
    alert:
      "OneUptime AI is checking this alert right now. Try again in a moment.",
  },
};

export function getRemediationTryAgainRefusal(data: {
  result: RemediationTryAgainRefusal;
  signal: RemediationTryAgainSignal;
}): string {
  return REMEDIATION_TRY_AGAIN_REFUSALS[data.result][data.signal];
}

const RESULTS: ReadonlyArray<string> = Object.values(RemediationTryAgainResult);

// Reads a result off the wire; anything this build does not know is null.
export function parseRemediationTryAgainResult(
  value: unknown,
): RemediationTryAgainResult | null {
  return typeof value === "string" && RESULTS.includes(value)
    ? (value as RemediationTryAgainResult)
    : null;
}
