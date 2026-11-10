import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  parseAIRunAttemptEnd,
} from "Common/Types/AI/AIRunAttempt";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  parseRemediationRoundAppliedSteps,
  parseRemediationRoundChecks,
  parseRemediationRoundExplanation,
  RemediationRoundAppliedSteps,
  RemediationRoundCheck,
  RemediationRoundExplanation,
} from "Common/Types/AutoRemediation/RemediationRound";

/*
 * A ROUND OF AN AI FIX, AS THE REMEDIATION STEP READS IT (issues #6436,
 * #6487): what POST /auto-remediation/round answered for one fix - its
 * run, how its attempts ended, the commands it checked with, how many
 * other checks it made, why it found no fix and the fixes it ruled out,
 * what it already changed, and whether the reader may try it again.
 *
 * React-free, so App's tests can read it; RemediationStep reads the rounds
 * (useRemediationRounds) and draws them (RemediationRoundDetails).
 */

export interface RemediationRoundView {
  suggestionId: string;
  // The run the round was read for: a round tried again has a new one.
  aiRunId: string;
  run: AIRun | null;
  // How its attempts started and ended, in order (AiRunFailureWords reads them).
  events: Array<AIRunEvent>;
  checks: Array<RemediationRoundCheck>;
  otherCheckCount: number;
  explanation: RemediationRoundExplanation | null;
  appliedSteps: RemediationRoundAppliedSteps;
  mayTryAgain: boolean;
}

// The answer of POST /auto-remediation/round, for one fix.
export function parseRemediationRoundView(data: {
  json: JSONObject;
  suggestionId: string;
  aiRunId: string;
}): RemediationRoundView {
  const runJson: unknown = data.json["run"];
  const eventsJson: unknown = data.json["events"];
  const otherCheckCount: unknown = data.json["otherCheckCount"];

  return {
    suggestionId: data.suggestionId,
    aiRunId: data.aiRunId,
    run:
      runJson && typeof runJson === "object" && !Array.isArray(runJson)
        ? (AIRun.fromJSON(runJson as JSONObject, AIRun) as AIRun)
        : null,
    events: Array.isArray(eventsJson)
      ? (AIRunEvent.fromJSONArray(
          eventsJson as JSONArray,
          AIRunEvent,
        ) as Array<AIRunEvent>)
      : [],
    checks: parseRemediationRoundChecks(data.json["checks"]),
    otherCheckCount:
      typeof otherCheckCount === "number" && Number.isFinite(otherCheckCount)
        ? Math.max(0, Math.floor(otherCheckCount))
        : 0,
    explanation: parseRemediationRoundExplanation(data.json["explanation"]),
    appliedSteps: parseRemediationRoundAppliedSteps(data.json["appliedSteps"]),
    mayTryAgain: data.json["mayTryAgain"] === true,
  };
}

/*
 * The round of this fix as it is now: one read for an older run of it (a
 * round tried again since) is not this round's.
 */
export function getCurrentRemediationRound(
  rounds: Map<string, RemediationRoundView>,
  suggestion: Pick<AutoRemediationSuggestion, "_id" | "aiRunId">,
): RemediationRoundView | undefined {
  const suggestionId: string = suggestion._id?.toString() || "";
  const round: RemediationRoundView | undefined = rounds.get(suggestionId);

  if (!round || round.aiRunId !== (suggestion.aiRunId?.toString() || "")) {
    return undefined;
  }

  return round;
}

/*
 * The round stopped without its answer: its run failed, stopped answering
 * or expired in the queue - and the fix still says it found none, or is
 * still being worked out. Not one that waits to try again on its own.
 */
export function isRemediationRoundUnfinished(data: {
  status: AutoRemediationSuggestionStatus | undefined;
  round: RemediationRoundView | undefined;
}): boolean {
  if (
    data.status !== AutoRemediationSuggestionStatus.NoneApplicable &&
    data.status !== AutoRemediationSuggestionStatus.Planning
  ) {
    return false;
  }

  return Boolean(
    data.round?.run && AIRunStatusHelper.didNotFinish(data.round.run.status),
  );
}

/*
 * How the round's last attempt ended, when its run waits to try again on
 * its own (queued, with the time of its next attempt): what the live step
 * says under "Working out a fix…".
 */
export function getRemediationRoundRetryWait(
  round: RemediationRoundView | undefined,
): AIRunAttemptEnd | null {
  if (!round?.run || round.run.status !== AIRunStatus.Queued) {
    return null;
  }

  for (let index: number = round.events.length - 1; index >= 0; index--) {
    const event: AIRunEvent = round.events[index]!;

    if (event.eventType === AIRunEventType.RunStarted) {
      return null;
    }

    if (event.eventType === AIRunEventType.AttemptEnded) {
      const attemptEnd: AIRunAttemptEnd | null = parseAIRunAttemptEnd(
        event.resultSummary?.attemptEnd,
      );

      return attemptEnd?.outcome === AIRunAttemptOutcome.WillRetry
        ? attemptEnd
        : null;
    }
  }

  return null;
}

/*
 * Whether the round is still at work: its fix is being worked out and its
 * run has not ended. The step reads such a round again on every poll.
 */
export function isRemediationRoundLive(data: {
  status: AutoRemediationSuggestionStatus | undefined;
  round: RemediationRoundView | undefined;
}): boolean {
  if (data.status !== AutoRemediationSuggestionStatus.Planning) {
    return false;
  }

  return (
    !data.round?.run ||
    !AIRunStatusHelper.isTerminalStatus(data.round.run.status!)
  );
}

// Whether the round has anything to show under its fix's plan step.
export function hasRemediationRoundDetails(
  round: RemediationRoundView | undefined,
): boolean {
  return Boolean(
    round &&
      (round.checks.length > 0 ||
        round.otherCheckCount > 0 ||
        round.explanation),
  );
}
