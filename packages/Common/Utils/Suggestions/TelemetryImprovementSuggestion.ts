import { JSONObject } from "../../Types/JSON";
import {
  CodeFixRepositoryChoice,
  codeFixRepositoryChoicesToJSON,
  parseCodeFixRepositoryChoices,
} from "./CodeFixRepositoryPick";
import { getCodeFixOffer } from "./CodeFixSuggestion";
import SuggestionOffer, { parseSuggestionOffer } from "./SuggestionOffer";

/*
 * WHEN TO OFFER "IMPROVE LOGGING / TRACING WITH AI".
 *
 * A service's Logs and Traces pages carry a card that has OneUptime AI open
 * a pull request improving the service's logging or tracing. It used to
 * show on every service, always - with AI switched off, with no repository
 * for the pull request, and while the same improvement was already being
 * written - and every one of those clicks was refused, or queued a run
 * that could only fail.
 *
 * It applies to every service (its grounding is the service's code, not a
 * finding on screen), so the rule is the code-fix one with nothing to
 * point at:
 *
 *   - AI off for the project, or no repository the GitHub App can open a
 *     pull request in: nothing. Without a finding on screen a "connect a
 *     repository" link would sit on every page of every service, so none
 *     is shown (the trace page's finding is the one that earns that link).
 *   - Code's gate says the run could not do its work now (the plan or the
 *     bill, AI credits or an LLM provider, the daily AI limit, a Runner
 *     online): nothing either, for the same reason - the click would only
 *     queue a run that fails, or waits for a Runner that is not there.
 *   - The same improvement already queued or running for this service:
 *     a link to it (InProgress), not a second card.
 *   - None of the connected repositories the person may use in Code - read
 *     it, and ask OneUptime AI to work in it (#11209): nothing, as for a
 *     trace's fix. The improvement is a code task on their behalf, held to
 *     the rule every Fix with AI holds to (CodeFixRepositoryPick).
 *   - Otherwise: the card (Act) - with the repositories to pick from, when
 *     several are the person's and none is named like the service.
 *
 * POST /ai-investigation/telemetry-improvement-suggestion answers with this
 * rule, and the create route enforces the same gates, so the page never
 * offers an improvement the server then refuses.
 */

/*
 * The server's refusal of an improvement the person did not pick a
 * repository for, when several of theirs are connected and none is named
 * like the service. The card asks for the pick first, so people meet this
 * through the API - or on the page, when a repository was connected after
 * the card read the choices.
 */
export const PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE: string =
  "Several repositories are connected, and none could be matched to this service. Pick the one that holds its code.";

export interface TelemetryImprovementOfferInput {
  isAiEnabled: boolean;
  // The same improvement is already queued or running for this service.
  hasActiveFix: boolean;
  hasConnectedRepository: boolean;
  // Code's gate says something stops the run (CodeFixStartGate).
  isBlocked?: boolean | undefined;
}

export function getTelemetryImprovementOffer(
  input: TelemetryImprovementOfferInput,
): SuggestionOffer {
  return getCodeFixOffer({
    isAiEnabled: input.isAiEnabled,
    applies: true,
    hasActiveFix: input.hasActiveFix,
    hasConnectedRepository: input.hasConnectedRepository,
    isBlocked: input.isBlocked,
    isBackedByEvidence: false,
  });
}

// What the suggestion route answers, and the card reads.
export interface TelemetryImprovementSuggestion {
  offer: SuggestionOffer;
  // The queued or running improvement, when the offer is InProgress.
  aiRunId: string | null;
  /*
   * Act, when several repositories the person may use are connected and
   * none is named like the service: the first of them by name - more than
   * one says the person picks the pull request's repository, from a search
   * of those on the server (the click names the pick). Empty otherwise.
   */
  repositories: Array<CodeFixRepositoryChoice>;
}

export const NO_TELEMETRY_IMPROVEMENT_SUGGESTION: TelemetryImprovementSuggestion =
  {
    offer: SuggestionOffer.None,
    aiRunId: null,
    repositories: [],
  };

/*
 * Reads the route's answer. Only Act, and InProgress with its run, draw
 * anything: an unknown offer, a SetUp this suggestion never makes, or an
 * InProgress with no run read as nothing. Only Act carries repositories to
 * pick from, and a list of fewer than two reads as none.
 */
export function parseTelemetryImprovementSuggestion(
  value: unknown,
): TelemetryImprovementSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
  }

  const record: JSONObject = value as JSONObject;
  const offer: SuggestionOffer = parseSuggestionOffer(record["offer"]);

  if (offer === SuggestionOffer.Act) {
    return {
      offer,
      aiRunId: null,
      repositories: parseCodeFixRepositoryChoices(record["repositories"]),
    };
  }

  if (
    offer === SuggestionOffer.InProgress &&
    typeof record["aiRunId"] === "string" &&
    record["aiRunId"].length > 0
  ) {
    return { offer, aiRunId: record["aiRunId"], repositories: [] };
  }

  return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
}

export function telemetryImprovementSuggestionToJSON(
  suggestion: TelemetryImprovementSuggestion,
): JSONObject {
  return {
    offer: suggestion.offer,
    aiRunId: suggestion.aiRunId,
    repositories: codeFixRepositoryChoicesToJSON(suggestion.repositories),
  };
}
