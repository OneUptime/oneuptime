/*
 * A ROUND OF AN AI FIX, AS THE REMEDIATION STEP EXPLAINS IT (issues #6436,
 * #6487).
 *
 * "We have things like no safe fix found, but it doesn't tell me anything
 * about why? Why wasn't the safe fix found? What did you do to remediate
 * that you found no safe fix? If no safe fix was found - did you ask for an
 * approval? What fix wasn't safe? What commands did you run to find a fix
 * that wasn't safe."
 *
 * A fix OneUptime AI works out (an AutoRemediationSuggestion with a run:
 * a command plan, a fix through MCP servers, or a runbook it picks) is a
 * round: one AI run reads the cluster, the resource or the telemetry and
 * proposes a fix, makes one, or finds none. The step reads the round
 * (POST REMEDIATION_ROUND_PATH): how its run went - finished, or stopped
 * and why (the run's own failure, as every AI card words it) - the commands
 * it ran to check, and, when it ends without a fix, why and the fixes it
 * ruled out, which the AI says with EXPLAIN_NO_FIX_TOOL_NAME before its
 * answer.
 *
 * A round that did not finish - its run failed, stopped answering or
 * expired in the queue - is tried again from the step
 * (POST REMEDIATION_ROUND_TRY_AGAIN_PATH) by whoever may change the
 * incident or alert, the same person whose Try again decides the record
 * again. Only a round that changed nothing starts again from the top:
 * every command, change and runbook a round makes is recorded before it
 * acts (its idempotency key), so a round that recorded one is never started
 * again - that could make the same change twice.
 *
 * Shared by the server (the routes, the runners' tool) and the Dashboard
 * (the step, and the refusals in the reader's language), so both read the
 * same shapes and say the same sentences. Dependency-free, but for the
 * words of an incident's or alert's daily AI token limit, which every
 * message about it shares (Types/AI/RecordAiTokenLimit, itself
 * dependency-free).
 */

import { getRecordAiTokenLimitMessage } from "../AI/RecordAiTokenLimit";

export const REMEDIATION_ROUND_PATH: string = "/auto-remediation/round";

export const REMEDIATION_ROUND_TRY_AGAIN_PATH: string =
  "/auto-remediation/round-try-again";

/*
 * The tool a round calls when it ends without a fix: why, and each fix it
 * ruled out with why not. Its arguments are the explanation; the round's
 * read parses them (parseRemediationRoundExplanation) from the run's own
 * event, so nothing else stores it.
 */
export const EXPLAIN_NO_FIX_TOOL_NAME: string = "explain_no_fix";

// How much of an explanation a reader is shown: the AI writes the rest away.
export const MAX_EXPLANATION_REASON_LENGTH: number = 600;
export const MAX_RULED_OUT_FIXES: number = 5;
export const MAX_RULED_OUT_FIX_LENGTH: number = 300;
export const MAX_RULED_OUT_WHY_NOT_LENGTH: number = 500;
export const MAX_RULED_OUT_FIX_COMMANDS: number = 5;
export const MAX_ROUND_COMMAND_LENGTH: number = 300;

// A fix OneUptime AI considered and did not propose or make.
export interface RemediationRuledOutFix {
  // What the fix would have done, in a few words.
  fix: string;
  // The commands it would have run, when it is made of commands.
  commands: Array<string>;
  // Why it was not proposed: not safe, not allowed here, or would not help.
  whyNot: string;
}

// Why a round ended without a fix, in the AI's words.
export interface RemediationRoundExplanation {
  reason: string;
  ruledOutFixes: Array<RemediationRuledOutFix>;
}

// One line of the AI's text: whitespace folded, cut at the limit with "…".
export function clipRoundText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const folded: string = value.replace(/\s+/g, " ").trim();

  if (folded.length <= maxLength) {
    return folded;
  }

  return `${folded.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function readRuledOutFix(value: unknown): RemediationRuledOutFix | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry: Record<string, unknown> = value as Record<string, unknown>;
  const fix: string = clipRoundText(entry["fix"], MAX_RULED_OUT_FIX_LENGTH);
  const whyNot: string = clipRoundText(
    entry["whyNot"],
    MAX_RULED_OUT_WHY_NOT_LENGTH,
  );

  // A fix with no reason, or a reason with no fix, explains nothing.
  if (!fix || !whyNot) {
    return null;
  }

  const commands: Array<string> = [];
  const writtenCommands: unknown = entry["commands"];

  if (Array.isArray(writtenCommands)) {
    for (const command of writtenCommands) {
      const text: string = clipRoundText(command, MAX_ROUND_COMMAND_LENGTH);

      if (text && !commands.includes(text)) {
        commands.push(text);
      }

      if (commands.length >= MAX_RULED_OUT_FIX_COMMANDS) {
        break;
      }
    }
  }

  return { fix, commands, whyNot };
}

/*
 * The explanation as the AI wrote it (the tool's arguments): plain text
 * only, each part clipped, at most MAX_RULED_OUT_FIXES fixes. Null when it
 * says nothing - no reason and no fix ruled out with a reason.
 */
export function parseRemediationRoundExplanation(
  value: unknown,
): RemediationRoundExplanation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const written: Record<string, unknown> = value as Record<string, unknown>;
  const reason: string = clipRoundText(
    written["reason"],
    MAX_EXPLANATION_REASON_LENGTH,
  );
  const ruledOutFixes: Array<RemediationRuledOutFix> = [];
  const writtenFixes: unknown = written["ruledOutFixes"];

  if (Array.isArray(writtenFixes)) {
    for (const writtenFix of writtenFixes) {
      const fix: RemediationRuledOutFix | null = readRuledOutFix(writtenFix);

      if (fix) {
        ruledOutFixes.push(fix);
      }

      if (ruledOutFixes.length >= MAX_RULED_OUT_FIXES) {
        break;
      }
    }
  }

  if (!reason && ruledOutFixes.length === 0) {
    return null;
  }

  return { reason, ruledOutFixes };
}

/*
 * What a round already did outside OneUptime: each is recorded before it
 * acts, so a round that recorded one may have changed something, and is
 * never started again from the top.
 */
export interface RemediationRoundAppliedSteps {
  // Commands it ran or sent (recorded before each one runs).
  commandCount: number;
  // Changes it sent through MCP servers (recorded before each is sent).
  changeCount: number;
  // A runbook it started.
  isRunbookStarted: boolean;
}

export function hasRemediationRoundAppliedSteps(
  applied: RemediationRoundAppliedSteps,
): boolean {
  return (
    applied.commandCount > 0 ||
    applied.changeCount > 0 ||
    applied.isRunbookStarted
  );
}

/*
 * Why a round is not tried again, when it is not: one sentence each,
 * English as every refusal of the API is. The Dashboard holds the same
 * sentences as translation keys (RemediationStepCopy), so the step says
 * them in the reader's language.
 */
export enum RemediationRoundTryAgainRefusal {
  // The fix was not worked out by an AI run (a runbook a rule names).
  NoRound = "NoRound",
  // Its run is queued, running, or waits to try again on its own.
  StillWorking = "StillWorking",
  // Its run finished: what it found is what the step shows.
  Finished = "Finished",
  // It made a change before it stopped: starting it again could repeat it.
  PartlyApplied = "PartlyApplied",
  // The incident or alert is resolved.
  IncidentResolved = "IncidentResolved",
  AlertResolved = "AlertResolved",
  // Someone started it again a moment ago.
  AlreadyStarted = "AlreadyStarted",
  // What stops any AI run of the project: say who can change it.
  AiOff = "AiOff",
  NoProvider = "NoProvider",
  CreditsUsedUp = "CreditsUsedUp",
  // The project's own daily AI limits (Project Settings → AI → AI Features).
  LimitReached = "LimitReached",
  /*
   * The incident's (alert's) own daily AI token limit (#7157): set to 0,
   * which pauses the work until it is raised, or used up until midnight UTC.
   */
  IncidentTokenLimitPaused = "IncidentTokenLimitPaused",
  IncidentTokenLimitUsedUp = "IncidentTokenLimitUsedUp",
  AlertTokenLimitPaused = "AlertTokenLimitPaused",
  AlertTokenLimitUsedUp = "AlertTokenLimitUsedUp",
  // The queue did not take it, for no reason it could name.
  NotStarted = "NotStarted",
}

export const REMEDIATION_ROUND_TRY_AGAIN_REFUSALS: Readonly<
  Record<RemediationRoundTryAgainRefusal, string>
> = {
  [RemediationRoundTryAgainRefusal.NoRound]:
    "OneUptime AI did not work this fix out, so there is nothing to try again.",
  [RemediationRoundTryAgainRefusal.StillWorking]:
    "OneUptime AI is still working on this fix.",
  [RemediationRoundTryAgainRefusal.Finished]:
    "OneUptime AI finished working on this fix, so there is nothing to try again.",
  [RemediationRoundTryAgainRefusal.PartlyApplied]:
    "OneUptime AI made a change for this fix before it stopped, so it does not start the fix again: that could make the same change twice. Check what it changed, then finish the fix yourself.",
  [RemediationRoundTryAgainRefusal.IncidentResolved]:
    "This incident is resolved, so OneUptime AI does not try to fix it.",
  [RemediationRoundTryAgainRefusal.AlertResolved]:
    "This alert is resolved, so OneUptime AI does not try to fix it.",
  [RemediationRoundTryAgainRefusal.AlreadyStarted]:
    "Someone has just started this fix again.",
  [RemediationRoundTryAgainRefusal.AiOff]:
    "OneUptime AI is switched off for this project. A project owner or someone with Manage Billing can turn it on in Project Settings > AI > AI Features.",
  [RemediationRoundTryAgainRefusal.NoProvider]:
    "This project has no LLM provider to work out a fix with. Add one in Project Settings > AI > LLM Providers, then try again.",
  [RemediationRoundTryAgainRefusal.CreditsUsedUp]:
    "This project's AI credits are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings > AI > AI Credits.",
  [RemediationRoundTryAgainRefusal.LimitReached]:
    "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
  [RemediationRoundTryAgainRefusal.IncidentTokenLimitPaused]:
    getRecordAiTokenLimitMessage("incident", { limitInTokens: 0 }),
  [RemediationRoundTryAgainRefusal.IncidentTokenLimitUsedUp]:
    getRecordAiTokenLimitMessage("incident"),
  [RemediationRoundTryAgainRefusal.AlertTokenLimitPaused]:
    getRecordAiTokenLimitMessage("alert", { limitInTokens: 0 }),
  [RemediationRoundTryAgainRefusal.AlertTokenLimitUsedUp]:
    getRecordAiTokenLimitMessage("alert"),
  [RemediationRoundTryAgainRefusal.NotStarted]:
    "The fix could not start again. Try again in a few minutes.",
};

export function getRemediationRoundTryAgainRefusal(
  refusal: RemediationRoundTryAgainRefusal,
): string {
  return REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[refusal];
}

/*
 * The refusal of a person who may read the fix but not change the incident
 * or alert it is for: worded as the investigation's Try again words it.
 */
export const REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED: Readonly<
  Record<"incident" | "alert", string>
> = {
  incident:
    "You do not have permission to change this incident, so you cannot ask OneUptime AI to try this fix again.",
  alert:
    "You do not have permission to change this alert, so you cannot ask OneUptime AI to try this fix again.",
};

/*
 * A command a round ran to check what is wrong (a read-only kubectl
 * command, or a command on an infrastructure resource), as the step lists
 * it: the command, the round's own reason for it, when, and how it went -
 * it ran, it failed (kubectl answered an error, or it could not run), its
 * result never came back (it may have run), it is running now, or the
 * round stopped while it ran.
 */
export type RemediationRoundCheckStatus =
  | "ran"
  | "failed"
  | "unknown"
  | "running"
  | "stopped";

export interface RemediationRoundCheck {
  command: string;
  // Why the round ran it, in its own words: may be empty.
  why: string;
  status: RemediationRoundCheckStatus;
  // When it started, as an ISO date.
  at: string;
  // What went wrong, when it failed: may be empty.
  error: string;
}

// How many checks a round's read lists: the last ones, in order.
export const MAX_ROUND_CHECKS: number = 50;
export const MAX_ROUND_CHECK_WHY_LENGTH: number = 200;
export const MAX_ROUND_CHECK_ERROR_LENGTH: number = 300;

const CHECK_STATUSES: ReadonlyArray<string> = [
  "ran",
  "failed",
  "unknown",
  "running",
  "stopped",
];

// The checks off the wire: anything this build cannot read is left out.
export function parseRemediationRoundChecks(
  value: unknown,
): Array<RemediationRoundCheck> {
  if (!Array.isArray(value)) {
    return [];
  }

  const checks: Array<RemediationRoundCheck> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const entry: Record<string, unknown> = item as Record<string, unknown>;
    const command: string = clipRoundText(
      entry["command"],
      MAX_ROUND_COMMAND_LENGTH,
    );
    const status: unknown = entry["status"];

    if (
      !command ||
      typeof status !== "string" ||
      !CHECK_STATUSES.includes(status)
    ) {
      continue;
    }

    checks.push({
      command,
      why: clipRoundText(entry["why"], MAX_ROUND_CHECK_WHY_LENGTH),
      status: status as RemediationRoundCheckStatus,
      at: typeof entry["at"] === "string" ? entry["at"] : "",
      error: clipRoundText(entry["error"], MAX_ROUND_CHECK_ERROR_LENGTH),
    });

    if (checks.length >= MAX_ROUND_CHECKS) {
      break;
    }
  }

  return checks;
}

// The applied steps off the wire: anything unreadable counts as none.
export function parseRemediationRoundAppliedSteps(
  value: unknown,
): RemediationRoundAppliedSteps {
  const entry: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const count: (key: string) => number = (key: string): number => {
    const written: unknown = entry[key];

    return typeof written === "number" && Number.isFinite(written)
      ? Math.max(0, Math.floor(written))
      : 0;
  };

  return {
    commandCount: count("commandCount"),
    changeCount: count("changeCount"),
    isRunbookStarted: entry["isRunbookStarted"] === true,
  };
}
