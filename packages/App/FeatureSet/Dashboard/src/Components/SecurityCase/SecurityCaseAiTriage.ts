import PageMap from "../../Utils/PageMap";
import { describeEvidenceTool } from "../../Utils/InvestigationEvidenceFormat";
import { parseInvestigationEvidence } from "../AI/InvestigationReport/InvestigationReportData";
import { WHO_CAN_ADD_AI_CREDITS } from "../ProjectBalance/ProjectBalanceCopy";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import { InvestigationEvidenceItem } from "Common/Types/AI/InvestigationEvidence";
import SecurityCaseAiVerdict, {
  getSecurityCaseAiVerdictDescription,
  isSecurityCaseAiVerdict,
} from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityPlaybookRunStatus, {
  isFinishedSecurityPlaybookRunStatus,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX } from "Common/Utils/AI/InvestigationReport";

/*
 * THE CASE'S AI CARD, as data: what OneUptime AI did with the case and what
 * the card says about it, kept free of React so a plain test pins every
 * state and word.
 *
 * The card reads two things:
 *
 *   - the case, whose ai* columns hold the triage's result: the read
 *     (aiVerdict), the priority and playbook it suggests, the report, when
 *     it finished, and whether the case's data held text written to steer
 *     an AI;
 *   - POST /security-case/:caseId/ai-triage (SecurityCaseTriageStatus):
 *     the latest run, its steps while it runs, and what stops a triage now.
 *
 * From them, one of four stages: triaging (a run is queued or running, or
 * finished with its report still being written), triaged (a report is on
 * the case - a later run that did not finish is said under it), failed
 * (the only run did not finish, or finished with nothing to say) and not
 * triaged.
 */

export enum SecurityCaseAiStage {
  NotTriaged = "NotTriaged",
  Triaging = "Triaging",
  Triaged = "Triaged",
  Failed = "Failed",
}

export interface SecurityCaseTriageRunView {
  id: string;
  status: AIRunStatus | null;
  createdAt?: Date | undefined;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
  toolCallCount: number;
  totalTokens: number;
  errorMessage?: string | undefined;
}

export interface SecurityCaseTriageStep {
  toolName: string;
  failed: boolean;
  rowCount?: number | undefined;
}

export type SecurityCaseTriageNotStartedCode =
  | "ai_disabled"
  | "automatic_triage_disabled"
  | "provider_missing"
  | "insufficient_ai_balance"
  | "project_daily_limit_reached"
  | "already_triaging"
  | "not_enqueued"
  | "eligibility_check_failed";

const NOT_STARTED_CODES: ReadonlyArray<SecurityCaseTriageNotStartedCode> = [
  "ai_disabled",
  "automatic_triage_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "project_daily_limit_reached",
  "already_triaging",
  "not_enqueued",
  "eligibility_check_failed",
];

export interface SecurityCaseTriageStatusView {
  run: SecurityCaseTriageRunView | null;
  steps: Array<SecurityCaseTriageStep>;
  // The run finished; its report is still being written onto the case.
  isReportPending: boolean;
  // The run settled without writing a report.
  finishedWithoutReport: boolean;
  // Every check the report on the case may cite, when it is the latest run's.
  evidence: Array<InvestigationEvidenceItem>;
  notStartedCode: SecurityCaseTriageNotStartedCode | null;
  isAutomaticTriageOn: boolean;
}

// What the case itself says of its triage (its ai* columns).
export interface SecurityCaseAiResult {
  verdict?: SecurityCaseAiVerdict | undefined;
  // The id of the project's priority OneUptime AI suggested.
  suggestedPriorityId?: string | undefined;
  suggestedPlaybookId?: string | undefined;
  report?: string | undefined;
  triagedAt?: Date | undefined;
  promptInjectionSuspected: boolean;
}

function readDate(value: JSONValue | undefined): Date | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readText(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// A count the server sent: a whole number, never below zero.
function readCount(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/*
 * The route's answer, read defensively: a field an older server left out,
 * or one of the wrong shape, reads as nothing - never as a feature that is
 * off.
 */
export function parseSecurityCaseTriageStatus(
  json: JSONObject | null | undefined,
): SecurityCaseTriageStatusView {
  const body: JSONObject = json || {};
  const rawRun: JSONValue | undefined = body["run"];
  let run: SecurityCaseTriageRunView | null = null;

  if (rawRun && typeof rawRun === "object" && !Array.isArray(rawRun)) {
    const runJson: JSONObject = rawRun as JSONObject;
    const status: JSONValue | undefined = runJson["status"];

    run = {
      id: readText(runJson["_id"]) || "",
      status: Object.values(AIRunStatus).includes(status as AIRunStatus)
        ? (status as AIRunStatus)
        : null,
      createdAt: readDate(runJson["createdAt"]),
      startedAt: readDate(runJson["startedAt"]),
      completedAt: readDate(runJson["completedAt"]),
      toolCallCount: readCount(runJson["toolCallCount"]),
      totalTokens: readCount(runJson["totalTokens"]),
      errorMessage: readText(runJson["errorMessage"]),
    };
  }

  const steps: Array<SecurityCaseTriageStep> = Array.isArray(body["steps"])
    ? (body["steps"] as Array<JSONValue>)
        .filter((step: JSONValue): boolean => {
          return (
            Boolean(step) &&
            typeof step === "object" &&
            !Array.isArray(step) &&
            typeof (step as JSONObject)["toolName"] === "string"
          );
        })
        .map((step: JSONValue): SecurityCaseTriageStep => {
          const stepJson: JSONObject = step as JSONObject;
          const rowCount: JSONValue | undefined = stepJson["rowCount"];

          return {
            toolName: stepJson["toolName"] as string,
            failed: stepJson["failed"] === true,
            ...(typeof rowCount === "number" ? { rowCount } : {}),
          };
        })
    : [];

  const reason: JSONValue | undefined = body["notStartedReason"];
  const code: JSONValue | undefined =
    reason && typeof reason === "object" && !Array.isArray(reason)
      ? (reason as JSONObject)["code"]
      : undefined;

  return {
    run,
    steps,
    isReportPending: body["isReportPending"] === true,
    finishedWithoutReport: body["finishedWithoutReport"] === true,
    evidence: parseInvestigationEvidence(body["evidence"]),
    notStartedCode: NOT_STARTED_CODES.includes(
      code as SecurityCaseTriageNotStartedCode,
    )
      ? (code as SecurityCaseTriageNotStartedCode)
      : null,
    isAutomaticTriageOn: body["isAutomaticTriageOn"] === true,
  };
}

// A case's ai* columns, as the card reads them.
export function readSecurityCaseAiResult(securityCase: {
  aiVerdict?: unknown;
  aiSuggestedSecurityCasePriorityId?: unknown;
  aiSuggestedPlaybookId?: unknown;
  aiTriageReport?: unknown;
  aiTriagedAt?: unknown;
  aiTriagePromptInjectionSuspected?: unknown;
}): SecurityCaseAiResult {
  const playbookId: unknown = securityCase.aiSuggestedPlaybookId;
  const priorityId: unknown = securityCase.aiSuggestedSecurityCasePriorityId;
  const triagedAt: unknown = securityCase.aiTriagedAt;

  return {
    verdict: isSecurityCaseAiVerdict(securityCase.aiVerdict)
      ? securityCase.aiVerdict
      : undefined,
    suggestedPriorityId: priorityId
      ? String(priorityId) || undefined
      : undefined,
    suggestedPlaybookId: playbookId
      ? String(playbookId) || undefined
      : undefined,
    report:
      typeof securityCase.aiTriageReport === "string" &&
      securityCase.aiTriageReport.trim()
        ? securityCase.aiTriageReport
        : undefined,
    triagedAt:
      triagedAt instanceof Date
        ? triagedAt
        : typeof triagedAt === "string"
          ? readDate(triagedAt)
          : undefined,
    promptInjectionSuspected:
      securityCase.aiTriagePromptInjectionSuspected === true,
  };
}

export function isTriageRunActive(
  run: SecurityCaseTriageRunView | null | undefined,
): boolean {
  return Boolean(
    run &&
      (run.status === AIRunStatus.Queued || run.status === AIRunStatus.Running),
  );
}

export function didTriageRunFail(
  run: SecurityCaseTriageRunView | null | undefined,
): boolean {
  return Boolean(
    run &&
      (run.status === AIRunStatus.Error ||
        run.status === AIRunStatus.Cancelled ||
        run.status === AIRunStatus.Stale),
  );
}

/*
 * Whether the latest triage is still on its way: queued, running, or
 * finished with its report not yet on the case.
 */
export function isTriageOnItsWay(
  status: SecurityCaseTriageStatusView | null | undefined,
): boolean {
  return Boolean(
    status && (isTriageRunActive(status.run) || status.isReportPending),
  );
}

/*
 * Whether the latest triage ended without a report: it failed, or it
 * settled with nothing written.
 */
export function didLatestTriageNotFinish(
  status: SecurityCaseTriageStatusView | null | undefined,
): boolean {
  return Boolean(
    status &&
      (didTriageRunFail(status.run) || status.finishedWithoutReport === true),
  );
}

export function getSecurityCaseAiStage(data: {
  status: SecurityCaseTriageStatusView | null;
  result: SecurityCaseAiResult;
}): SecurityCaseAiStage {
  if (isTriageOnItsWay(data.status)) {
    return SecurityCaseAiStage.Triaging;
  }

  if (data.result.verdict || data.result.report) {
    return SecurityCaseAiStage.Triaged;
  }

  if (didLatestTriageNotFinish(data.status)) {
    return SecurityCaseAiStage.Failed;
  }

  return SecurityCaseAiStage.NotTriaged;
}

/*
 * Whether the card offers the suggested priority as one click: there is
 * one, the project still has it, and the case is at another.
 */
export function shouldOfferSuggestedPriority(data: {
  suggestedPriorityId?: string | undefined;
  currentPriorityId?: string | undefined;
  isSuggestedPriorityKnown: boolean;
}): boolean {
  // Ids compared as Postgres compares them: by value, whatever their case.
  return Boolean(
    data.suggestedPriorityId &&
      data.isSuggestedPriorityKnown &&
      data.suggestedPriorityId.toLowerCase() !==
        (data.currentPriorityId || "").toLowerCase(),
  );
}

/*
 * Whether a reason stops a person's Triage with AI too: everything but the
 * automatic switch being off (which a person's request ignores) and a
 * triage already on its way (which the card shows instead).
 */
export function isBlockingTriageReason(
  code: SecurityCaseTriageNotStartedCode | null | undefined,
): boolean {
  return Boolean(
    code && code !== "automatic_triage_disabled" && code !== "already_triaging",
  );
}

// The words and the mark of the badge beside the card's title, by stage.
export type SecurityCaseAiBadgeIndicator =
  | "live"
  | "checking"
  | "done"
  | "idle"
  | "failed";

export function getSecurityCaseAiBadge(data: {
  stage: SecurityCaseAiStage;
  // Whether the card has heard from the server yet.
  hasStatus: boolean;
}): { text: string; indicator: SecurityCaseAiBadgeIndicator } {
  switch (data.stage) {
    case SecurityCaseAiStage.Triaging:
      return { text: SecurityCaseAiCopy.badges.triaging, indicator: "live" };
    case SecurityCaseAiStage.Triaged:
      return { text: SecurityCaseAiCopy.badges.triaged, indicator: "done" };
    case SecurityCaseAiStage.Failed:
      return { text: SecurityCaseAiCopy.badges.failed, indicator: "failed" };
    default:
      return data.hasStatus
        ? { text: SecurityCaseAiCopy.badges.notTriaged, indicator: "idle" }
        : { text: SecurityCaseAiCopy.badges.checking, indicator: "checking" };
  }
}

/*
 * Whether Triage with AI may be pressed now: nothing in the way, or only
 * the automatic switch being off (which a person's request ignores).
 */
export function canStartTriage(
  status: SecurityCaseTriageStatusView | null,
): boolean {
  if (!status) {
    return false;
  }

  if (isTriageOnItsWay(status)) {
    return false;
  }

  return (
    status.notStartedCode === null ||
    status.notStartedCode === "automatic_triage_disabled"
  );
}

/*
 * Whether the playbook OneUptime AI suggests is already on its way on the
 * case: its latest run there, while that run has not finished (queued,
 * running, or held for an approval). The card then shows that run's status
 * in place of Run playbook - a second run would ask for the same approval
 * again - and the run itself waits under Playbook Runs. A finished run, or
 * none, leaves Run playbook one click away.
 */
export function getSuggestedPlaybookRunInProgress(
  latestRunStatus: SecurityPlaybookRunStatus | string | null | undefined,
): SecurityPlaybookRunStatus | null {
  if (
    !latestRunStatus ||
    !Object.values(SecurityPlaybookRunStatus).includes(
      latestRunStatus as SecurityPlaybookRunStatus,
    ) ||
    isFinishedSecurityPlaybookRunStatus(latestRunStatus)
  ) {
    return null;
  }

  return latestRunStatus as SecurityPlaybookRunStatus;
}

/*
 * Whether the reader may start a triage, from the permission gate's answer
 * on updating the case (PermissionGate.check): yes; no, and the gate says
 * why (a Security Viewer), so the card greys the button and says who can;
 * or not known yet - the permissions have not arrived, or the gate has
 * nothing honest to say - so the card offers nothing rather than tell
 * someone they cannot do what they may.
 */
export enum SecurityCaseAiTriageAccess {
  Yes = "Yes",
  No = "No",
  NotKnownYet = "NotKnownYet",
}

export function getSecurityCaseAiTriageAccess(gate: {
  isAllowed: boolean;
  disabledReason?: string | undefined;
}): SecurityCaseAiTriageAccess {
  if (gate.isAllowed) {
    return SecurityCaseAiTriageAccess.Yes;
  }

  return gate.disabledReason
    ? SecurityCaseAiTriageAccess.No
    : SecurityCaseAiTriageAccess.NotKnownYet;
}

/*
 * A check the triage made, as the card lists it while it runs: in the
 * words every AI report's Evidence checked uses for the same tool
 * (describeEvidenceTool), so a check reads the same live and afterwards.
 */
export function getSecurityCaseAiStepLabel(toolName: string): string {
  return describeEvidenceTool(toolName).description;
}

/*
 * What the card says under "The triage did not finish": why the run stopped,
 * as the server recorded it (as the incident card says it), or else that
 * OneUptime AI could not finish.
 */
export function getFailedTriageDescription(
  status: SecurityCaseTriageStatusView | null | undefined,
): string {
  return status?.run?.errorMessage || SecurityCaseAiCopy.failedDescription;
}

/*
 * The report as the card draws it. When the case's data held text written to
 * steer an AI, the runner puts a heads-up first in the report, right under
 * its heading (SecurityCaseTriageRunner.getPromptInjectionReportLead), for
 * the timeline and Copy report. The card says the same first, in the
 * reader's language, so it draws the report without that paragraph - only
 * where the runner writes it, and only in the runner's own words: anything
 * the model wrote stays.
 */
export function withoutTriageInjectionLead(markdown: string): string {
  const lines: Array<string> = markdown.split("\n");
  const isFilled: (line: string) => boolean = (line: string): boolean => {
    return line.trim() !== "";
  };

  let index: number = lines.findIndex(isFilled);

  // The brand heading ("## 🧠 AI — Security Case Triage"), when there is one.
  if (index !== -1 && lines[index]!.trim().startsWith("## ")) {
    const heading: number = index;

    index = lines.findIndex((line: string, at: number): boolean => {
      return at > heading && isFilled(line);
    });
  }

  if (
    index === -1 ||
    !lines[index]!.trim().startsWith(SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX)
  ) {
    return markdown;
  }

  // The paragraph, and the blank line that ended it.
  const isFollowedByBlank: boolean =
    index + 1 < lines.length && !isFilled(lines[index + 1]!);

  lines.splice(index, isFollowedByBlank ? 2 : 1);

  return lines.join("\n");
}

// What the card says of each read, in a sentence under its pill.
export function getSecurityCaseAiVerdictSentence(
  verdict: SecurityCaseAiVerdict | undefined,
): string {
  return getSecurityCaseAiVerdictDescription(verdict)?.description || "";
}

/*
 * Where a reason sends the reader, when somewhere can fix it: the page,
 * and its link's words. Running out of AI credits is the card's own to
 * answer (getSecurityCaseAiCreditsAction): what it offers depends on who
 * is reading.
 */
export interface SecurityCaseAiReasonAction {
  label: string;
  page: PageMap;
}

export function getSecurityCaseAiReasonAction(
  code: SecurityCaseTriageNotStartedCode | null,
): SecurityCaseAiReasonAction | null {
  switch (code) {
    case "provider_missing":
      return {
        label: translationKey("Set up an LLM provider"),
        page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      };
    case "project_daily_limit_reached":
      return {
        label: translationKey("Go to Project Settings → AI → AI Features"),
        page: PageMap.SETTINGS_AI_FEATURES,
      };
    default:
      return null;
  }
}

/*
 * What the card offers when the project is out of AI credits. A project
 * owner or someone with Manage Billing adds them, so only they are sent to
 * AI Credits; someone known not to be one of them is told who can instead,
 * and while that is not known yet (the permissions are on their way)
 * nothing is offered. The card asks who is reading (getProjectBalanceAccess).
 */
export interface SecurityCaseAiCreditsAction {
  label: string;
  // The AI Credits page, or a sentence to read.
  linksToAiCredits: boolean;
}

export function getSecurityCaseAiCreditsAction(reader: {
  mayAddCredits: boolean;
  isKnownNotToAdd: boolean;
}): SecurityCaseAiCreditsAction | null {
  if (reader.mayAddCredits) {
    return {
      label: translationKey("Add AI credits"),
      linksToAiCredits: true,
    };
  }

  return reader.isKnownNotToAdd
    ? { label: WHO_CAN_ADD_AI_CREDITS, linksToAiCredits: false }
    : null;
}

// The card's words, each an English key the card translates.
export const SecurityCaseAiCopy: {
  cardTitle: string;
  notTriagedTitle: string;
  notTriagedDescription: string;
  automaticOffNote: string;
  triageButton: string;
  triageAgainButton: string;
  tryAgainButton: string;
  triagingTitle: string;
  triagingDescription: string;
  stepsLabel: string;
  failedTitle: string;
  failedDescription: string;
  lastRunFailed: string;
  suggestedPriority: string;
  setPriorityButton: string;
  suggestedPlaybook: string;
  runPlaybookButton: string;
  suggestedPlaybookRunning: string;
  askButton: string;
  askPrompt: string;
  promptInjectionTitle: string;
  promptInjectionDescription: string;
  triagedWhen: string;
  whoCanTriage: string;
  closeVerdictHint: string;
  badges: {
    triaging: string;
    triaged: string;
    failed: string;
    notTriaged: string;
    checking: string;
  };
  reasons: Record<SecurityCaseTriageNotStartedCode, string>;
} = {
  cardTitle: translationKey("OneUptime AI"),
  notTriagedTitle: translationKey("Not triaged yet"),
  notTriagedDescription: translationKey(
    "OneUptime AI reads the case's detections, events and threat intel, and says what happened, whether it looks real, and what to do next.",
  ),
  automaticOffNote: translationKey(
    "New cases are not triaged automatically. Turn it on in Security Events → AI → Settings.",
  ),
  triageButton: translationKey("Triage with AI"),
  triageAgainButton: translationKey("Triage again"),
  tryAgainButton: translationKey("Try again"),
  triagingTitle: translationKey("Triaging this case"),
  triagingDescription: translationKey(
    "OneUptime AI is reading the case's detections, events, threat intel and hosts. It changes nothing.",
  ),
  stepsLabel: translationKey("What OneUptime AI checked"),
  failedTitle: translationKey("The triage did not finish"),
  failedDescription: translationKey(
    "OneUptime AI could not finish triaging this case. Try again.",
  ),
  lastRunFailed: translationKey(
    "The latest triage did not finish. This is the one before it.",
  ),
  suggestedPriority: translationKey("Suggested priority"),
  setPriorityButton: translationKey("Set priority"),
  suggestedPlaybook: translationKey("Suggested playbook"),
  runPlaybookButton: translationKey("Run playbook"),
  // On the status of the suggested playbook's run, in place of Run playbook.
  suggestedPlaybookRunning: translationKey(
    "This playbook is already running on this case. Its run is under Playbook Runs.",
  ),
  askButton: translationKey("Ask about this case"),
  askPrompt: translationKey("What should I check next on this case, and why?"),
  promptInjectionTitle: translationKey(
    "Text in this case reads like instructions to an AI",
  ),
  promptInjectionDescription: translationKey(
    "OneUptime AI treated it as data and leaves the call to you.",
  ),
  triagedWhen: translationKey("Triaged {{when}}"),
  // Beside a greyed Triage with AI, for who cannot start one.
  whoCanTriage: translationKey(
    "Someone who can edit this case can start a triage.",
  ),
  // Over Close Case's verdicts, when OneUptime AI has read the case.
  closeVerdictHint: translationKey(
    "OneUptime AI read this case as {{read}}. Pick what you found.",
  ),
  badges: {
    triaging: translationKey("Triaging"),
    triaged: translationKey("Triaged"),
    failed: translationKey("Failed"),
    notTriaged: translationKey("Not triaged"),
    checking: translationKey("Checking"),
  },
  reasons: {
    ai_disabled: translationKey("AI is turned off for this project."),
    automatic_triage_disabled: translationKey(
      "New cases are not triaged automatically.",
    ),
    provider_missing: translationKey(
      "OneUptime AI has no LLM provider to use in this project.",
    ),
    insufficient_ai_balance: translationKey(
      "The project is out of AI credits.",
    ),
    project_daily_limit_reached: translationKey(
      "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
    ),
    already_triaging: translationKey(
      "OneUptime AI is already triaging this case.",
    ),
    not_enqueued: translationKey(
      "OneUptime AI could not start the triage right now. Try again in a few minutes.",
    ),
    eligibility_check_failed: translationKey(
      "OneUptime AI could not check whether it can triage this case. Try again in a few minutes.",
    ),
  },
};
