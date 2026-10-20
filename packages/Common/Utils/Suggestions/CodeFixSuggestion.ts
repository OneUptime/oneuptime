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
 *   3. No repository the GitHub App can open a pull request in: SetUp when
 *      the suggestion is backed by evidence on screen (a finding in this
 *      trace) - then the evidence is worth a quiet "connect a repository"
 *      link, because connecting one is the single step between the person
 *      and the fix. A suggestion without such evidence (a standing "improve
 *      this service's logging") is not offered at all: on every page of
 *      every service, a setup link would only be noise.
 *   4. Otherwise: Act.
 */

export interface CodeFixSuggestionInput {
  // Project.enableAi !== false (see AiSuggestion.isAiOffered).
  isAiEnabled: boolean;
  // The suggestion's own rule: does it apply to what is on screen?
  applies: boolean;
  // A fix for this same thing is already queued or running.
  hasActiveFix: boolean;
  // The project has a repository the GitHub App can open a pull request in.
  hasConnectedRepository: boolean;
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

  if (!input.hasConnectedRepository) {
    return input.isBackedByEvidence
      ? SuggestionOffer.SetUp
      : SuggestionOffer.None;
  }

  return SuggestionOffer.Act;
}
