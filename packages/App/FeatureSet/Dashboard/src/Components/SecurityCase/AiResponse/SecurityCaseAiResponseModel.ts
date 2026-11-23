import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  SECURITY_CASE_AI_AREAS,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  isSecurityCaseAiResponseActive,
  isSecurityCaseHandOffReason,
  readSecurityCaseAiMode,
} from "Common/Types/SecurityCase/SecurityCaseAi";
import {
  SecurityCaseAiActionEvidence,
  readSecurityCaseAiActionEvidence,
} from "Common/Types/SecurityCase/SecurityCaseAiActionEvidence";
import {
  SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES,
  SecurityCaseAiHoldOutcome,
  isSecurityCaseAiHoldOutcome,
} from "Common/Types/SecurityCase/SecurityCaseAiHold";
import {
  SECURITY_CASE_AI_ACTION_REASON_SENTENCES,
  SECURITY_CASE_HAND_OFF_SENTENCES,
  getSecurityCaseAiActionTitle,
} from "Common/Types/SecurityCase/SecurityCaseAiWords";

/*
 * WHAT THE CASE'S ONEUPTIME AI CARD SAYS OF ONEUPTIME AI WORKING THE CASE
 * (#10352), read from POST /security-case/:caseId/ai-response
 * (SecurityCaseResponseStatus): where it stands, its log - every step it
 * took, asked about or left, and why - and what a person can do about it.
 *
 * React-free, so the card and its tests read the same model.
 */

export interface SecurityCaseAiActionView {
  id: string;
  kind: SecurityCaseAiActionKind;
  status: SecurityCaseAiActionStatus;
  reason: SecurityCaseAiActionReason | null;
  handOffReason: SecurityCaseHandOffReason | null;
  area: SecurityCaseAiArea | null;
  mode: SecurityCaseAiMode | null;
  stepKey: string | null;
  target: string | null;
  evidence: SecurityCaseAiActionEvidence;
  report: string | null;
  securityPlaybookRunId: string | null;
  askedAt: Date | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  doneAt: Date | null;
  undoneAt: Date | null;
  undoneByName: string | null;
  createdAt: Date | null;
  // Asked of a person on the card itself, rather than on its playbook run.
  isDecidedOnCard: boolean;
}

/*
 * OneUptime AI responding first to the case (#10353): holding, and until
 * when; then how it ended, when, and who ended it.
 */
export interface SecurityCaseAiHoldView {
  outcome: SecurityCaseAiHoldOutcome;
  until: Date | null;
  endedAt: Date | null;
  endedByName: string | null;
}

export interface SecurityCaseAiResponseView {
  isOn: boolean;
  modes: Record<SecurityCaseAiArea, SecurityCaseAiMode>;
  state: SecurityCaseAiResponseState | null;
  handOffReason: SecurityCaseHandOffReason | null;
  tookCaseAt: Date | null;
  nextLookAt: Date | null;
  closedAt: Date | null;
  run: { id: string; status: string | null } | null;
  actions: Array<SecurityCaseAiActionView>;
  notStartedReason: { code: string; message: string } | null;
  // Null for a case OneUptime AI never held.
  hold: SecurityCaseAiHoldView | null;
}

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readText(value: JSONValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

function readEnum<T extends string>(
  value: JSONValue | undefined,
  values: ReadonlyArray<string>,
): T | null {
  return typeof value === "string" && values.includes(value)
    ? (value as T)
    : null;
}

export function parseSecurityCaseAiAction(
  json: JSONObject,
): SecurityCaseAiActionView | null {
  const kind: SecurityCaseAiActionKind | null = readEnum(
    json["kind"],
    Object.values(SecurityCaseAiActionKind),
  );
  const status: SecurityCaseAiActionStatus | null = readEnum(
    json["status"],
    Object.values(SecurityCaseAiActionStatus),
  );
  const id: string | null = readText(json["_id"]);

  if (!kind || !status || !id) {
    return null;
  }

  const handOffReason: JSONValue | undefined = json["handOffReason"];

  return {
    id,
    kind,
    status,
    reason: readEnum(json["reason"], Object.values(SecurityCaseAiActionReason)),
    handOffReason: isSecurityCaseHandOffReason(handOffReason)
      ? handOffReason
      : null,
    area: readEnum(json["area"], SECURITY_CASE_AI_AREAS),
    mode: readEnum(json["mode"], Object.values(SecurityCaseAiMode)),
    stepKey: readText(json["stepKey"]),
    target: readText(json["target"]),
    evidence: readSecurityCaseAiActionEvidence(json["evidence"]),
    report: readText(json["report"]),
    securityPlaybookRunId: readText(json["securityPlaybookRunId"]),
    askedAt: readDate(json["askedAt"]),
    decidedAt: readDate(json["decidedAt"]),
    decidedByName: readText(json["decidedByName"]),
    doneAt: readDate(json["doneAt"]),
    undoneAt: readDate(json["undoneAt"]),
    undoneByName: readText(json["undoneByName"]),
    createdAt: readDate(json["createdAt"]),
    isDecidedOnCard: json["isDecidedOnCard"] === true,
  };
}

export function parseSecurityCaseAiResponse(
  json: JSONObject,
): SecurityCaseAiResponseView {
  const modes: Record<SecurityCaseAiArea, SecurityCaseAiMode> = {} as Record<
    SecurityCaseAiArea,
    SecurityCaseAiMode
  >;
  const rawModes: JSONValue | undefined = json["modes"];

  for (const area of SECURITY_CASE_AI_AREAS) {
    modes[area] = readSecurityCaseAiMode(
      rawModes && typeof rawModes === "object" && !Array.isArray(rawModes)
        ? (rawModes as JSONObject)[area]
        : undefined,
    );
  }

  const run: JSONValue | undefined = json["run"];
  const reason: JSONValue | undefined = json["notStartedReason"];
  const hold: JSONValue | undefined = json["hold"];
  const handOffReason: JSONValue | undefined = json["handOffReason"];

  return {
    isOn: json["isOn"] === true,
    modes,
    state: readEnum(json["state"], Object.values(SecurityCaseAiResponseState)),
    handOffReason: isSecurityCaseHandOffReason(handOffReason)
      ? handOffReason
      : null,
    tookCaseAt: readDate(json["tookCaseAt"]),
    nextLookAt: readDate(json["nextLookAt"]),
    closedAt: readDate(json["closedAt"]),
    run:
      run && typeof run === "object" && !Array.isArray(run)
        ? {
            id: readText((run as JSONObject)["_id"]) || "",
            status: readText((run as JSONObject)["status"]),
          }
        : null,
    actions: Array.isArray(json["actions"])
      ? (json["actions"] as Array<JSONValue>)
          .map((action: JSONValue): SecurityCaseAiActionView | null => {
            return action &&
              typeof action === "object" &&
              !Array.isArray(action)
              ? parseSecurityCaseAiAction(action as JSONObject)
              : null;
          })
          .filter(
            (
              action: SecurityCaseAiActionView | null,
            ): action is SecurityCaseAiActionView => {
              return action !== null;
            },
          )
      : [],
    notStartedReason:
      reason && typeof reason === "object" && !Array.isArray(reason)
        ? {
            code: readText((reason as JSONObject)["code"]) || "",
            message: readText((reason as JSONObject)["message"]) || "",
          }
        : null,
    hold: parseSecurityCaseAiHold(hold),
  };
}

export function parseSecurityCaseAiHold(
  value: JSONValue | undefined,
): SecurityCaseAiHoldView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const outcome: JSONValue | undefined = json["outcome"];

  if (!isSecurityCaseAiHoldOutcome(outcome)) {
    return null;
  }

  return {
    outcome,
    until: readDate(json["until"]),
    endedAt: readDate(json["endedAt"]),
    endedByName: readText(json["endedByName"]),
  };
}

/*
 * How the case's hold ended, as the card says it: its sentence, with whoever
 * ended it. Null while it holds - the case's page says so above - and for a
 * case never held.
 */
export function getAiHoldEndedSentence(
  hold: SecurityCaseAiHoldView | null,
): { sentence: string; name: string; endedAt: Date | null } | null {
  if (!hold || hold.outcome === SecurityCaseAiHoldOutcome.Holding) {
    return null;
  }

  return {
    sentence: SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES[hold.outcome],
    name: hold.endedByName || "",
    endedAt: hold.endedAt,
  };
}

// Where OneUptime AI stands on the case, as the card's heading line says it.
export enum SecurityCaseAiResponseStage {
  // The project does not let OneUptime AI work cases.
  Off = "Off",
  // It is not working this case: Respond with AI may start it.
  NotWorking = "NotWorking",
  Working = "Working",
  WaitingForPeople = "WaitingForPeople",
  HandedToPeople = "HandedToPeople",
  Finished = "Finished",
}

export function getSecurityCaseAiResponseStage(
  view: SecurityCaseAiResponseView,
): SecurityCaseAiResponseStage {
  switch (view.state) {
    case SecurityCaseAiResponseState.Working:
      return SecurityCaseAiResponseStage.Working;
    case SecurityCaseAiResponseState.WaitingForPeople:
      return SecurityCaseAiResponseStage.WaitingForPeople;
    case SecurityCaseAiResponseState.HandedToPeople:
      return SecurityCaseAiResponseStage.HandedToPeople;
    case SecurityCaseAiResponseState.Finished:
      return SecurityCaseAiResponseStage.Finished;
    default:
      return view.isOn
        ? SecurityCaseAiResponseStage.NotWorking
        : SecurityCaseAiResponseStage.Off;
  }
}

// Whether OneUptime AI works the case now: the card polls, and offers Take Over.
export function isSecurityCaseAiWorking(
  view: SecurityCaseAiResponseView,
): boolean {
  return isSecurityCaseAiResponseActive(view.state);
}

/*
 * Whether Respond with AI is offered: the project lets OneUptime AI work
 * cases, it is not working this one, and nothing about the case stops it.
 */
export function canRespondWithAi(view: SecurityCaseAiResponseView): boolean {
  return view.isOn && !isSecurityCaseAiWorking(view) && !view.notStartedReason;
}

// One row's title, in English with its values: the card words it.
export function getActionTitleKey(action: SecurityCaseAiActionView): string {
  return getSecurityCaseAiActionTitle({
    kind: action.kind,
    status: action.status,
  });
}

// One row's why, as a key: a hand-off's own reason, else the row's.
export function getActionReasonKey(
  action: SecurityCaseAiActionView,
): string | null {
  if (action.kind === SecurityCaseAiActionKind.HandToPeople) {
    return action.handOffReason
      ? SECURITY_CASE_HAND_OFF_SENTENCES[action.handOffReason]
      : null;
  }

  return action.reason
    ? SECURITY_CASE_AI_ACTION_REASON_SENTENCES[action.reason]
    : null;
}

// The rows a person can answer on the card, and the ones waiting on their run's approval.
export function getActionsWaitingForPeople(
  view: SecurityCaseAiResponseView,
): Array<SecurityCaseAiActionView> {
  return view.actions.filter((action: SecurityCaseAiActionView): boolean => {
    return action.status === SecurityCaseAiActionStatus.Asked;
  });
}

// The close OneUptime AI made or asks for, with its report, newest first.
export function getClosingReport(
  view: SecurityCaseAiResponseView,
): SecurityCaseAiActionView | null {
  return (
    view.actions.find((action: SecurityCaseAiActionView): boolean => {
      return (
        action.kind === SecurityCaseAiActionKind.CloseCase &&
        Boolean(action.report) &&
        (action.status === SecurityCaseAiActionStatus.Asked ||
          action.status === SecurityCaseAiActionStatus.Done)
      );
    }) || null
  );
}
