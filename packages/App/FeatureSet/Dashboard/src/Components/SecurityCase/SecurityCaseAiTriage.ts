import PageMap from "../../Utils/PageMap";
import { describeEvidenceTool } from "../../Utils/InvestigationEvidenceFormat";
import { parseInvestigationEvidence } from "../AI/InvestigationReport/InvestigationReportData";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import { WHO_CAN_ADD_AI_CREDITS } from "../ProjectBalance/ProjectBalanceCopy";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import { InvestigationEvidenceItem } from "Common/Types/AI/InvestigationEvidence";
import SecurityCaseAiVerdict, {
  getSecurityCaseAiVerdictDescription,
  isSecurityCaseAiVerdict,
} from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriority, {
  isSecurityCasePriority,
} from "Common/Types/SecurityCase/SecurityCasePriority";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";

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
  suggestedPriority?: SecurityCasePriority | undefined;
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
  aiSuggestedPriority?: unknown;
  aiSuggestedPlaybookId?: unknown;
  aiTriageReport?: unknown;
  aiTriagedAt?: unknown;
  aiTriagePromptInjectionSuspected?: unknown;
}): SecurityCaseAiResult {
  const playbookId: unknown = securityCase.aiSuggestedPlaybookId;
  const triagedAt: unknown = securityCase.aiTriagedAt;

  return {
    verdict: isSecurityCaseAiVerdict(securityCase.aiVerdict)
      ? securityCase.aiVerdict
      : undefined,
    suggestedPriority: isSecurityCasePriority(securityCase.aiSuggestedPriority)
      ? securityCase.aiSuggestedPriority
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
 * one, and the case is at another.
 */
export function shouldOfferSuggestedPriority(data: {
  suggestedPriority?: SecurityCasePriority | undefined;
  currentPriority?: SecurityCasePriority | string | undefined;
}): boolean {
  return Boolean(
    data.suggestedPriority && data.suggestedPriority !== data.currentPriority,
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
 * A check the triage made, as the card lists it while it runs: in the
 * words every AI report's Evidence checked uses for the same tool
 * (describeEvidenceTool), so a check reads the same live and afterwards.
 */
export function getSecurityCaseAiStepLabel(toolName: string): string {
  return describeEvidenceTool(toolName).description;
}

// What the card says of each read, in a sentence under its pill.
export function getSecurityCaseAiVerdictSentence(
  verdict: SecurityCaseAiVerdict | undefined,
): string {
  return getSecurityCaseAiVerdictDescription(verdict)?.description || "";
}

/*
 * Where a reason sends the reader, when somewhere can fix it: the page,
 * and its link's words. AI credits are added by a project owner or someone
 * with Manage Billing, so only they are sent to the page that adds them;
 * someone known not to be one of them is told who can instead, and while
 * that is not known yet (the permissions are on their way) nothing is said.
 */
export interface SecurityCaseAiReasonAction {
  label: string;
  // Absent: a sentence to read, not a link.
  page?: PageMap | undefined;
}

export function getSecurityCaseAiReasonAction(
  code: SecurityCaseTriageNotStartedCode | null,
  balanceAccess?: ProjectBalanceAccess,
): SecurityCaseAiReasonAction | null {
  switch (code) {
    case "provider_missing":
      return {
        label: translationKey("Set up an LLM provider"),
        page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      };
    case "insufficient_ai_balance": {
      const access: ProjectBalanceAccess =
        balanceAccess || getProjectBalanceAccess(ProjectBalanceType.AI);

      if (access === ProjectBalanceAccess.Yes) {
        return {
          label: translationKey("Add AI credits"),
          page: PageMap.SETTINGS_AI_CREDITS,
        };
      }

      return access === ProjectBalanceAccess.No
        ? { label: WHO_CAN_ADD_AI_CREDITS }
        : null;
    }
    case "project_daily_limit_reached":
      return {
        label: translationKey("Go to Project Settings → AI → AI Features"),
        page: PageMap.SETTINGS_AI_FEATURES,
      };
    default:
      return null;
  }
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
  askButton: string;
  askPrompt: string;
  promptInjection: string;
  triagedWhen: string;
  noPermission: string;
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
  askButton: translationKey("Ask about this case"),
  askPrompt: translationKey("What should I check next on this case, and why?"),
  promptInjection: translationKey(
    "Some text in this case's data reads like instructions to an AI. OneUptime AI treated it as data and leaves the call to you.",
  ),
  triagedWhen: translationKey("Triaged {{when}}"),
  noPermission: translationKey(
    "A role that can work security cases can ask OneUptime AI to triage one.",
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
