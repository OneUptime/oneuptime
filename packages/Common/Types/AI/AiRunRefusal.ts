import { translationKey } from "../Translator";
import { JSONObject } from "../JSON";
import {
  isRecordAiTokenLimitPaused,
  RecordAiTokenLimitKind,
  RecordAiTokenLimitState,
} from "./RecordAiTokenLimit";

/*
 * WHY ONEUPTIME AI DID NOT START A RUN SOMEONE ASKED FOR, AS A CODE AND
 * ONE SENTENCE (#7359).
 *
 * An incident's or alert's AI card has two buttons that ask the server to
 * start an investigation - Try again on the failure notice, and Investigate
 * now while a rule waits - and an AI insight's card has Try again for its
 * triage. When the server refuses, the card shows why under the button.
 *
 * The server answers the refusal as bad data (400) with its English
 * sentence as the message, for the API and for older Dashboards, and with
 * the refusal's code beside it (AI_RUN_REFUSAL_CODE_FIELD). The Dashboard
 * words the code itself, in the reader's language (AiRunFailureWords'
 * describeAiRunRefusal): the sentences below are its translation keys, so a
 * sentence changed here is a new key every language must word before the
 * Dashboard's extract test passes. A refusal of who may (403, no code) is
 * one of these sentences too, and is worded by its text.
 *
 * Every refusal is one whole sentence per code - incident and alert each
 * have their own, so a language words each its own way - and none carries
 * a number or a name, so none needs values. The sentences that other
 * messages share (the AI credits, the project's daily AI limits, a
 * record's own daily AI token limit) are those messages, word for word: a
 * test holds each to its source.
 *
 * Pure, with no Node or browser APIs: the server and the Dashboard both
 * read it.
 */

export enum AiRunRefusalCode {
  // The record is gone, or the person may not read it.
  IncidentNotFound = "incident_not_found",
  AlertNotFound = "alert_not_found",
  // The person may read the record but not change it (403).
  IncidentTryAgainNotAllowed = "incident_try_again_not_allowed",
  AlertTryAgainNotAllowed = "alert_try_again_not_allowed",
  IncidentInvestigateNowNotAllowed = "incident_investigate_now_not_allowed",
  AlertInvestigateNowNotAllowed = "alert_investigate_now_not_allowed",
  // An investigation's Try again.
  IncidentHasNoInvestigation = "incident_has_no_investigation",
  AlertHasNoInvestigation = "alert_has_no_investigation",
  IncidentInvestigationRunning = "incident_investigation_running",
  AlertInvestigationRunning = "alert_investigation_running",
  InvestigationFinished = "investigation_finished",
  InvestigationNotQueued = "investigation_not_queued",
  // Investigate now, while an investigation rule waits.
  NotWaiting = "not_waiting",
  AlreadyInvestigated = "already_investigated",
  InvestigationNotStarted = "investigation_not_started",
  // What stops OneUptime AI for the whole project.
  AiOff = "ai_off",
  NoProviderToInvestigate = "no_provider_to_investigate",
  AiCreditsUsedUp = "ai_credits_used_up",
  ProjectDailyLimitReached = "project_daily_limit_reached",
  // The incident's (alert's) own daily AI token limit (#7157).
  IncidentTokenLimitPaused = "incident_token_limit_paused",
  IncidentTokenLimitUsedUp = "incident_token_limit_used_up",
  AlertTokenLimitPaused = "alert_token_limit_paused",
  AlertTokenLimitUsedUp = "alert_token_limit_used_up",
  // An AI insight's triage Try again.
  InsightNotFound = "insight_not_found",
  InsightTriageRunning = "insight_triage_running",
  TriageFinished = "triage_finished",
  InsightsOff = "insights_off",
  NoProviderToTriage = "no_provider_to_triage",
  TriageNotQueued = "triage_not_queued",
  TriageNotStarted = "triage_not_started",
}

// Each refusal's sentence: the server's message, and the Dashboard's key.
export const AI_RUN_REFUSALS: Readonly<Record<AiRunRefusalCode, string>> = {
  [AiRunRefusalCode.IncidentNotFound]: translationKey(
    "Incident not found (or you do not have access to it).",
  ),
  [AiRunRefusalCode.AlertNotFound]: translationKey(
    "Alert not found (or you do not have access to it).",
  ),
  [AiRunRefusalCode.IncidentTryAgainNotAllowed]: translationKey(
    "You do not have permission to change this incident, so you cannot start its investigation again.",
  ),
  [AiRunRefusalCode.AlertTryAgainNotAllowed]: translationKey(
    "You do not have permission to change this alert, so you cannot start its investigation again.",
  ),
  [AiRunRefusalCode.IncidentInvestigateNowNotAllowed]: translationKey(
    "You do not have permission to change this incident, so you cannot start its investigation.",
  ),
  [AiRunRefusalCode.AlertInvestigateNowNotAllowed]: translationKey(
    "You do not have permission to change this alert, so you cannot start its investigation.",
  ),
  [AiRunRefusalCode.IncidentHasNoInvestigation]: translationKey(
    "This incident has no investigation to try again.",
  ),
  [AiRunRefusalCode.AlertHasNoInvestigation]: translationKey(
    "This alert has no investigation to try again.",
  ),
  [AiRunRefusalCode.IncidentInvestigationRunning]: translationKey(
    "This incident's investigation is queued or running already.",
  ),
  [AiRunRefusalCode.AlertInvestigationRunning]: translationKey(
    "This alert's investigation is queued or running already.",
  ),
  [AiRunRefusalCode.InvestigationFinished]: translationKey(
    "Only an investigation that did not finish can be tried again.",
  ),
  [AiRunRefusalCode.InvestigationNotQueued]: translationKey(
    "The investigation could not start: the project may have reached its daily AI limit, which resets at midnight UTC. Try again later.",
  ),
  [AiRunRefusalCode.NotWaiting]: translationKey(
    "OneUptime AI is no longer waiting to investigate this. Refresh to see where it stands.",
  ),
  [AiRunRefusalCode.AlreadyInvestigated]: translationKey(
    "OneUptime AI has already started investigating this.",
  ),
  [AiRunRefusalCode.InvestigationNotStarted]: translationKey(
    "The investigation could not be started. Try again in a moment.",
  ),
  [AiRunRefusalCode.AiOff]: translationKey(
    "OneUptime AI is switched off for this project. A project owner or someone with Manage Billing can turn it on in Project Settings > AI > AI Features.",
  ),
  [AiRunRefusalCode.NoProviderToInvestigate]: translationKey(
    "This project has no LLM provider to investigate with. Add one in Project Settings > AI > LLM Providers, then try again.",
  ),
  // PROJECT_AI_CREDITS_USED_UP_MESSAGE (Utils/Project/ProjectBalance).
  [AiRunRefusalCode.AiCreditsUsedUp]: translationKey(
    "This project's AI credits are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings → AI → AI Credits.",
  ),
  // Ends with ProjectAiDailyLimits.getWhoCanChangeSentence().
  [AiRunRefusalCode.ProjectDailyLimitReached]: translationKey(
    "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC. A project owner or someone with Manage Billing can raise or remove the limit in Project Settings → AI → AI Features → More settings.",
  ),
  // getRecordAiTokenLimitMessage (Types/AI/RecordAiTokenLimit), each kind.
  [AiRunRefusalCode.IncidentTokenLimitPaused]: translationKey(
    "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
  ),
  [AiRunRefusalCode.IncidentTokenLimitUsedUp]: translationKey(
    "Automatic AI work for incidents used up today's Daily Incident AI Token Limit. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  ),
  [AiRunRefusalCode.AlertTokenLimitPaused]: translationKey(
    "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
  ),
  [AiRunRefusalCode.AlertTokenLimitUsedUp]: translationKey(
    "Automatic AI work for alerts used up today's Daily Alert AI Token Limit. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  ),
  [AiRunRefusalCode.InsightNotFound]: translationKey(
    "This AI insight no longer exists.",
  ),
  [AiRunRefusalCode.InsightTriageRunning]: translationKey(
    "This insight is being triaged already.",
  ),
  [AiRunRefusalCode.TriageFinished]: translationKey(
    "Only a triage that did not finish can be tried again.",
  ),
  /*
   * Only AI Insights' own switch is left to be off: a telemetry product's
   * AI that works on the insight's kind is on (getLaneWorkingOn).
   */
  [AiRunRefusalCode.InsightsOff]: translationKey(
    "AI Insights is switched off for this project, so no insight is triaged. A project owner or admin can turn on Watch telemetry for problems in AI → Insights → Settings.",
  ),
  [AiRunRefusalCode.NoProviderToTriage]: translationKey(
    "This project has no LLM provider to triage with. Add one in Project Settings > AI > LLM Providers, then try again.",
  ),
  [AiRunRefusalCode.TriageNotQueued]: translationKey(
    "The triage could not start: the project may have reached its daily AI limit, which resets at midnight UTC. Try again later.",
  ),
  [AiRunRefusalCode.TriageNotStarted]: translationKey(
    "The triage could not start. Try again in a moment.",
  ),
};

/*
 * The field of a refused request's answer that carries the code, beside
 * its message: { message: "...", refusalCode: "ai_off" }.
 */
export const AI_RUN_REFUSAL_CODE_FIELD: string = "refusalCode";

const AI_RUN_REFUSAL_CODES: ReadonlySet<string> = new Set<string>(
  Object.values(AiRunRefusalCode),
);

export function isAiRunRefusalCode(value: unknown): value is AiRunRefusalCode {
  return typeof value === "string" && AI_RUN_REFUSAL_CODES.has(value);
}

export function getAiRunRefusalMessage(code: AiRunRefusalCode): string {
  return AI_RUN_REFUSALS[code];
}

/*
 * The code of a refused request's answer, or null when it has none or one
 * this version does not know (a newer server): the message is said then.
 */
export function readAiRunRefusalCode(
  body: JSONObject | null | undefined,
): AiRunRefusalCode | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const code: unknown = body[AI_RUN_REFUSAL_CODE_FIELD];

  return isAiRunRefusalCode(code) ? code : null;
}

export type AiRunRefusalSubject = "incident" | "alert";

// The record is gone, or the person may not read it.
export function getRecordNotFoundRefusal(
  subject: AiRunRefusalSubject,
): AiRunRefusalCode {
  return subject === "alert"
    ? AiRunRefusalCode.AlertNotFound
    : AiRunRefusalCode.IncidentNotFound;
}

// The person may read the record, not change it: which button they pressed.
export function getNotAllowedRefusal(
  subject: AiRunRefusalSubject,
  action: "try_again" | "investigate_now",
): AiRunRefusalCode {
  if (action === "try_again") {
    return subject === "alert"
      ? AiRunRefusalCode.AlertTryAgainNotAllowed
      : AiRunRefusalCode.IncidentTryAgainNotAllowed;
  }

  return subject === "alert"
    ? AiRunRefusalCode.AlertInvestigateNowNotAllowed
    : AiRunRefusalCode.IncidentInvestigateNowNotAllowed;
}

export function getNoInvestigationRefusal(
  subject: AiRunRefusalSubject,
): AiRunRefusalCode {
  return subject === "alert"
    ? AiRunRefusalCode.AlertHasNoInvestigation
    : AiRunRefusalCode.IncidentHasNoInvestigation;
}

export function getInvestigationRunningRefusal(
  subject: AiRunRefusalSubject,
): AiRunRefusalCode {
  return subject === "alert"
    ? AiRunRefusalCode.AlertInvestigationRunning
    : AiRunRefusalCode.IncidentInvestigationRunning;
}

/*
 * The record's own daily AI token limit: paused (a limit of 0 or below)
 * until someone raises it, or used up until midnight UTC. Without a state
 * the limit is taken as used up, as getRecordAiTokenLimitMessage does.
 */
export function getRecordAiTokenLimitRefusal(
  kind: RecordAiTokenLimitKind,
  state?: Pick<RecordAiTokenLimitState, "limitInTokens"> | null | undefined,
): AiRunRefusalCode {
  const isPaused: boolean = isRecordAiTokenLimitPaused(state?.limitInTokens);

  if (kind === "alert") {
    return isPaused
      ? AiRunRefusalCode.AlertTokenLimitPaused
      : AiRunRefusalCode.AlertTokenLimitUsedUp;
  }

  return isPaused
    ? AiRunRefusalCode.IncidentTokenLimitPaused
    : AiRunRefusalCode.IncidentTokenLimitUsedUp;
}
