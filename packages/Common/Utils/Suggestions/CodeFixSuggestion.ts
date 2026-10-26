import AIRunStatus from "../../Types/AI/AIRunStatus";
import {
  CodeTaskState,
  CodeTaskStateInput,
  CodeTaskStateUtil,
} from "../../Types/AI/CodeTask";
import SuggestionOffer from "./SuggestionOffer";

/*
 * WHEN TO OFFER "AI OPENS A PULL REQUEST".
 *
 * The decision every code-fix suggestion shares - a trace's performance fix,
 * a service's logging or tracing improvement - once its own rule has said
 * whether it applies to what is on screen. Asked in the order a person
 * would meet the answers:
 *
 *   1. AI is off for the project, or the suggestion does not apply: None.
 *      Nothing is drawn.
 *   2. A fix for this very thing is already queued or running: InProgress.
 *      The page links to it instead of offering a second one (the server
 *      refuses a duplicate anyway).
 *   3. A fix for this very thing already did its work: Done. The page says
 *      how it came out and links to it - a second pull request for the same
 *      evidence would only repeat the first, and the task's conversation in
 *      Code takes it further. A suggestion that stands for good (improve a
 *      service's logging) never says it has one.
 *   4. No repository the GitHub App can open a pull request in: SetUp when
 *      the suggestion is backed by evidence on screen (a finding in this
 *      trace) - then the evidence is worth a quiet "connect a repository"
 *      link, because connecting one is the single step between the person
 *      and the fix. A suggestion without such evidence (a standing "improve
 *      this service's logging") is not offered at all: on every page of
 *      every service, a setup link would only be noise.
 *   5. Something else stands in the way - what Code's gate says (the plan or
 *      the bill, AI credits or an LLM provider, the project's daily AI
 *      limit, a Runner online): the same as a missing repository. SetUp
 *      with evidence on screen, where the page says what is missing in
 *      Code's words; nothing without.
 *   6. Otherwise: Act.
 */

export interface CodeFixSuggestionInput {
  // Project.enableAi !== false (see AiSuggestion.isAiOffered).
  isAiEnabled: boolean;
  // The suggestion's own rule: does it apply to what is on screen?
  applies: boolean;
  // A fix for this same thing is already queued or running.
  hasActiveFix: boolean;
  /*
   * A fix for this same thing already did its work: it opened its pull
   * request, or read the code and found nothing to change.
   */
  hasFinishedFix?: boolean | undefined;
  // The project has a repository the GitHub App can open a pull request in.
  hasConnectedRepository: boolean;
  /*
   * Code's gate says something stops the fix from doing its work now (a
   * CodeTaskBlocker for the run the click would queue).
   */
  isBlocked?: boolean | undefined;
  /*
   * True when the suggestion rests on evidence on screen, so a missing
   * repository is worth a quiet link to connect one (SetUp) rather than
   * hiding the suggestion.
   */
  isBackedByEvidence: boolean;
}

export function getCodeFixOffer(
  input: CodeFixSuggestionInput,
): SuggestionOffer {
  if (!input.isAiEnabled || !input.applies) {
    return SuggestionOffer.None;
  }

  if (input.hasActiveFix) {
    return SuggestionOffer.InProgress;
  }

  if (input.hasFinishedFix) {
    return SuggestionOffer.Done;
  }

  if (!input.hasConnectedRepository || input.isBlocked) {
    return input.isBackedByEvidence
      ? SuggestionOffer.SetUp
      : SuggestionOffer.None;
  }

  return SuggestionOffer.Act;
}

/*
 * How a fix that did its work came out (a Done offer), in the words its
 * task says it in, in Code: its pull request is open for review, the AI
 * read the code and found nothing to change, or it stopped with a question
 * for the person.
 */
export enum FinishedFixOutcome {
  Fixed = "Fixed",
  NothingToChange = "NothingToChange",
  WaitingForYou = "WaitingForYou",
}

const ALL_FINISHED_FIX_OUTCOMES: ReadonlyArray<string> =
  Object.values(FinishedFixOutcome);

// Reads an outcome off the wire; anything this build does not know is null.
export function parseFinishedFixOutcome(
  value: unknown,
): FinishedFixOutcome | null {
  if (typeof value === "string" && ALL_FINISHED_FIX_OUTCOMES.includes(value)) {
    return value as FinishedFixOutcome;
  }

  return null;
}

// The run statuses of a fix that did its work.
export const FINISHED_FIX_STATUSES: ReadonlyArray<AIRunStatus> = [
  AIRunStatus.Completed,
  AIRunStatus.NoFixFound,
];

/*
 * How a fix that did its work stands now, from the fix itself (its task's
 * first turn) and the task's latest turn - a reply someone sent in Code, or
 * the fix again when nobody has replied - as Code reads the task
 * (CodeTaskStateUtil):
 *
 *   - null while the task is working again (a reply is under way): the
 *     page links to it as work in progress;
 *   - WaitingForYou while the task waits for an answer;
 *   - otherwise how the fix came out: nothing to change when it found
 *     nothing, its pull request when it made one. A reply that failed or
 *     was stopped leaves the fix as it came out.
 *
 * A fix that did not do its work (it failed, or was stopped) is no
 * finished fix: the caller offers it again.
 */
export function getFinishedFixOutcome(data: {
  fix: CodeTaskStateInput;
  latestTurn: CodeTaskStateInput;
}): FinishedFixOutcome | null {
  const state: CodeTaskState = CodeTaskStateUtil.fromRun(data.latestTurn);

  if (state === CodeTaskState.Working) {
    return null;
  }

  if (state === CodeTaskState.WaitingForYou) {
    return FinishedFixOutcome.WaitingForYou;
  }

  return data.fix.status === AIRunStatus.NoFixFound
    ? FinishedFixOutcome.NothingToChange
    : FinishedFixOutcome.Fixed;
}
