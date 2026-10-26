import { JSONObject } from "../../Types/JSON";
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
 *   - Otherwise: the card (Act).
 *
 * POST /ai-investigation/telemetry-improvement-suggestion answers with this
 * rule, and the create route enforces the same gates, so the page never
 * offers an improvement the server then refuses.
 */

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
}

export const NO_TELEMETRY_IMPROVEMENT_SUGGESTION: TelemetryImprovementSuggestion =
  {
    offer: SuggestionOffer.None,
    aiRunId: null,
  };

/*
 * Reads the route's answer. Only Act, and InProgress with its run, draw
 * anything: an unknown offer, a SetUp this suggestion never makes, or an
 * InProgress with no run read as nothing.
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
    return { offer, aiRunId: null };
  }

  if (
    offer === SuggestionOffer.InProgress &&
    typeof record["aiRunId"] === "string" &&
    record["aiRunId"].length > 0
  ) {
    return { offer, aiRunId: record["aiRunId"] };
  }

  return NO_TELEMETRY_IMPROVEMENT_SUGGESTION;
}

export function telemetryImprovementSuggestionToJSON(
  suggestion: TelemetryImprovementSuggestion,
): JSONObject {
  return {
    offer: suggestion.offer,
    aiRunId: suggestion.aiRunId,
  };
}
