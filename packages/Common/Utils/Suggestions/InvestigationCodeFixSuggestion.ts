import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { AutomaticFixPullRequestBlocker } from "../../Types/AI/AutomaticFixPullRequests";
import {
  FinishedFixOutcome,
  getCodeFixOffer,
  parseFinishedFixOutcome,
} from "./CodeFixSuggestion";
import {
  parseSuggestionBlocker,
  SuggestionBlocker,
  suggestionBlockerToJSON,
} from "./SuggestionBlocker";
import SuggestionOffer, { parseSuggestionOffer } from "./SuggestionOffer";

/*
 * THE FIX IN THE CODE AN INVESTIGATION RECOMMENDS, ON THE REMEDIATION STEP.
 *
 * An AI investigation of an incident or an alert that finds the cause in
 * the code records that a code fix is recommended (AIRunCodeFixRecommendation
 * .Recommended). Two things can come of it:
 *
 *   - OneUptime AI opens the fix pull request on its own, when the
 *     investigation ends - while "Fix new incidents automatically" (or
 *     alerts) is on, the AI rules let it, a repository they allow is
 *     connected and the day's share is not used up
 *     (FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation);
 *   - a person opens it ("Open a fix pull request").
 *
 * The automatic one used to stop silently: it wrote a debug line and
 * nothing else, so a project that had fixing on and no repository connected
 * saw an investigation that blamed the code and nothing happening (block
 * 43). This is what the Remediation step says about it now, in the order a
 * person meets the answers (CodeFixSuggestion.getCodeFixOffer):
 *
 *   - None: nothing to say - AI is off, or the investigation recommended no
 *     change in the code;
 *   - InProgress: the fix pull request is being written (aiRunId: its task
 *     in Code), and whether OneUptime AI or a person asked for it;
 *   - Done: it did its work - its pull request is open for review, it read
 *     the code and found nothing to change, or it waits for an answer in
 *     Code;
 *   - SetUp: no repository is connected, or Code's own gate stands in the
 *     way (the plan, AI credits or an LLM provider, the day's limit, a
 *     Runner online) - the one step to take;
 *   - Act: a person may open it now.
 *
 * And, beside SetUp and Act, why OneUptime AI did not open it on its own
 * (AutomaticCodeFixBlocker), read with the project's settings of now.
 *
 * Pure: the server decides it (FixFromIncidentTaskTrigger
 * .getSuggestionForSubject) and the Dashboard reads it off the wire.
 */

// Why OneUptime AI did not open the fix pull request on its own.
export enum AutomaticCodeFixBlocker {
  // Enable AI is off for the project.
  AiOff = "AiOff",
  // "Fix new incidents automatically" (or alerts) is off.
  FixOff = "FixOff",
  // The AI rules could not be read.
  RulesUnreadable = "RulesUnreadable",
  // AI rules are set up and none that fixes matches the record.
  NoMatchingRule = "NoMatchingRule",
  // The AI rules that match have fix pull requests off.
  PullRequestOff = "PullRequestOff",
  // No connected repository the AI rules allow.
  NoRepository = "NoRepository",
  // OneUptime AI already opened its share of fix pull requests today.
  DailyLimit = "DailyLimit",
  /*
   * Nothing stops it now: it opens on its own only when an investigation
   * ends, and what stopped it then (a setting, a repository) has changed
   * since. A person opens it now.
   */
  ChangedSince = "ChangedSince",
}

const ALL_AUTOMATIC_BLOCKERS: ReadonlyArray<string> = Object.values(
  AutomaticCodeFixBlocker,
);

// The fixing rule's blocker, as the Remediation step names it.
export const AUTOMATIC_CODE_FIX_BLOCKER_BY_RULE_BLOCKER: Readonly<
  Record<AutomaticFixPullRequestBlocker, AutomaticCodeFixBlocker>
> = {
  [AutomaticFixPullRequestBlocker.FixOff]: AutomaticCodeFixBlocker.FixOff,
  [AutomaticFixPullRequestBlocker.RulesUnreadable]:
    AutomaticCodeFixBlocker.RulesUnreadable,
  [AutomaticFixPullRequestBlocker.NoMatchingRule]:
    AutomaticCodeFixBlocker.NoMatchingRule,
  [AutomaticFixPullRequestBlocker.PullRequestOff]:
    AutomaticCodeFixBlocker.PullRequestOff,
};

export function parseAutomaticCodeFixBlocker(
  value: unknown,
): AutomaticCodeFixBlocker | null {
  return typeof value === "string" && ALL_AUTOMATIC_BLOCKERS.includes(value)
    ? (value as AutomaticCodeFixBlocker)
    : null;
}

export interface InvestigationCodeFixSuggestion {
  offer: SuggestionOffer;
  // Done: how the fix came out.
  fixOutcome: FinishedFixOutcome | null;
  // SetUp: what Code's gate says stands in the way (null: a repository).
  blocker: SuggestionBlocker | null;
  // InProgress or Done: the fix's task in Code.
  aiRunId: string | null;
  /*
   * InProgress or Done: OneUptime AI opened it on its own (no person asked
   * for it).
   */
  isAutomatic: boolean;
  /*
   * Act or SetUp: why OneUptime AI did not open it on its own. Null for the
   * other offers.
   */
  automaticBlocker: AutomaticCodeFixBlocker | null;
}

export const NO_INVESTIGATION_CODE_FIX_SUGGESTION: InvestigationCodeFixSuggestion =
  {
    offer: SuggestionOffer.None,
    fixOutcome: null,
    blocker: null,
    aiRunId: null,
    isAutomatic: false,
    automaticBlocker: null,
  };

// A fix pull request of the record, as the decision reads it.
export interface InvestigationCodeFixRun {
  aiRunId: string;
  // No person asked for it.
  isAutomatic: boolean;
}

export interface InvestigationCodeFixSuggestionInput {
  // Project.enableAi !== false.
  isAiEnabled: boolean;
  /*
   * The record's latest investigation is complete and recommends a change
   * in the code.
   */
  isCodeFixRecommended: boolean;
  // A fix pull request for the record is queued or being written.
  activeFix: InvestigationCodeFixRun | null;
  /*
   * The latest fix pull request for the record that did its work, and how
   * it stands: null outcome while a reply in Code is under way.
   */
  finishedFix:
    | (InvestigationCodeFixRun & { outcome: FinishedFixOutcome | null })
    | null;
  // The project has a repository OneUptime AI can open a pull request in.
  hasConnectedRepository: boolean;
  // What Code's gate says, when it says anything.
  blocker: SuggestionBlocker | null;
  // Why it was not opened on its own (read only when no fix exists).
  automaticBlocker: AutomaticCodeFixBlocker | null;
}

export function getInvestigationCodeFixSuggestion(
  input: InvestigationCodeFixSuggestionInput,
): InvestigationCodeFixSuggestion {
  // A reply to the finished fix is under way: work in progress.
  const isWorkingAgain: boolean = Boolean(
    input.finishedFix && input.finishedFix.outcome === null,
  );

  const offer: SuggestionOffer = getCodeFixOffer({
    isAiEnabled: input.isAiEnabled,
    applies: input.isCodeFixRecommended,
    hasActiveFix: Boolean(input.activeFix) || isWorkingAgain,
    hasFinishedFix: Boolean(input.finishedFix),
    hasConnectedRepository: input.hasConnectedRepository,
    isBlocked: Boolean(input.blocker),
    // The investigation's report is on screen: worth the one setup step.
    isBackedByEvidence: true,
  });

  if (offer === SuggestionOffer.None) {
    return NO_INVESTIGATION_CODE_FIX_SUGGESTION;
  }

  if (offer === SuggestionOffer.InProgress || offer === SuggestionOffer.Done) {
    const run: InvestigationCodeFixRun | null =
      input.activeFix || input.finishedFix || null;

    return {
      offer,
      fixOutcome:
        offer === SuggestionOffer.Done
          ? input.finishedFix?.outcome || null
          : null,
      blocker: null,
      aiRunId: run?.aiRunId || null,
      isAutomatic: Boolean(run?.isAutomatic),
      automaticBlocker: null,
    };
  }

  return {
    offer,
    fixOutcome: null,
    // A repository to connect comes first: Code's gate needs one to ask.
    blocker:
      offer === SuggestionOffer.SetUp && input.hasConnectedRepository
        ? input.blocker
        : null,
    aiRunId: null,
    isAutomatic: false,
    automaticBlocker: input.automaticBlocker,
  };
}

export function investigationCodeFixSuggestionToJSON(
  suggestion: InvestigationCodeFixSuggestion,
): JSONObject {
  return {
    offer: suggestion.offer,
    fixOutcome: suggestion.fixOutcome,
    blocker: suggestion.blocker
      ? suggestionBlockerToJSON(suggestion.blocker)
      : null,
    aiRunId: suggestion.aiRunId,
    isAutomatic: suggestion.isAutomatic,
    automaticBlocker: suggestion.automaticBlocker,
  };
}

/*
 * Reads the suggestion off the wire. Anything this build cannot draw - an
 * offer it does not know, an InProgress or Done without its task - reads as
 * None, so an unknown answer never draws an action or a dead link.
 */
export function parseInvestigationCodeFixSuggestion(
  value: unknown,
): InvestigationCodeFixSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NO_INVESTIGATION_CODE_FIX_SUGGESTION;
  }

  const record: JSONObject = value as JSONObject;
  const offer: SuggestionOffer = parseSuggestionOffer(record["offer"]);
  const rawRunId: unknown = record["aiRunId"];
  const aiRunId: string | null =
    typeof rawRunId === "string" && ObjectID.isValidUUID(rawRunId)
      ? rawRunId
      : null;

  if (offer === SuggestionOffer.None) {
    return NO_INVESTIGATION_CODE_FIX_SUGGESTION;
  }

  if (
    (offer === SuggestionOffer.InProgress || offer === SuggestionOffer.Done) &&
    !aiRunId
  ) {
    return NO_INVESTIGATION_CODE_FIX_SUGGESTION;
  }

  const isFixOffer: boolean =
    offer === SuggestionOffer.InProgress || offer === SuggestionOffer.Done;

  return {
    offer,
    fixOutcome:
      offer === SuggestionOffer.Done
        ? parseFinishedFixOutcome(record["fixOutcome"])
        : null,
    blocker:
      offer === SuggestionOffer.SetUp
        ? parseSuggestionBlocker(record["blocker"])
        : null,
    aiRunId: isFixOffer ? aiRunId : null,
    isAutomatic: isFixOffer && record["isAutomatic"] === true,
    automaticBlocker: isFixOffer
      ? null
      : parseAutomaticCodeFixBlocker(record["automaticBlocker"]),
  };
}
