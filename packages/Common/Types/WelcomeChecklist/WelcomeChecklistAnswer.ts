import { PlanType } from "../Billing/SubscriptionPlan";
import { JSONObject } from "../JSON";
import {
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecord,
  SetupHealthRecordKind,
} from "../SetupHealth/SetupHealth";
import ProjectGoal, { isProjectGoal, parseProjectGoals } from "./ProjectGoal";
import {
  WELCOME_GAP_INVITATION_NOT_ACCEPTED,
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStepGap,
  isWelcomeStep,
} from "./WelcomeChecklist";

/*
 * THE ONE ANSWER HOME READS FOR ITS WELCOME CARD (issue #6803):
 * GET /api/welcome-checklist, for the project in the `tenantid` header and
 * the person asking. Everything the card draws is in it - whether to ask
 * the question, the steps with what is done and what is next, and whether
 * this person hid the card - so a second member and another browser see
 * the same thing.
 *
 * The routes below change it, and each answers with the new answer:
 *
 *   POST /welcome-checklist/goals          { goals: [...] }  choose (or, with
 *                                           [], skip) - an Owner or Admin
 *   POST /welcome-checklist/hide           hide the card for me
 *   POST /welcome-checklist/show           show it again for me
 *   POST /welcome-checklist/browser-state  { wasDismissed, wasFinished } -
 *                                           what this browser remembered of
 *                                           the checklist before this one
 *
 * Server/API/WelcomeChecklistAPI.ts serves them; Server/Services/
 * WelcomeChecklistService.ts works the answer out.
 */

export const WELCOME_CHECKLIST_ROUTE: string = "/welcome-checklist";
export const WELCOME_CHECKLIST_GOALS_ROUTE: string = "/welcome-checklist/goals";
export const WELCOME_CHECKLIST_HIDE_ROUTE: string = "/welcome-checklist/hide";
export const WELCOME_CHECKLIST_SHOW_ROUTE: string = "/welcome-checklist/show";
export const WELCOME_CHECKLIST_BROWSER_STATE_ROUTE: string =
  "/welcome-checklist/browser-state";

export interface WelcomeChecklistAnswer {
  // Who the card is for: the people setting the project up, or an invited member.
  audience: WelcomeAudience;
  // The project's goals (null: never answered; []: skipped).
  goals: Array<ProjectGoal> | null;
  // Ask "What do you want to do first?" now.
  shouldAskForGoals: boolean;
  // This person may choose (and change) the project's goals.
  canChooseGoals: boolean;
  // This person hid the card for themselves.
  isHiddenForMe: boolean;
  // The checklist is finished, for everyone.
  isFinished: boolean;
  // The server can send email (false only on a server known not to).
  canSendEmail: boolean;
  /*
   * This person acknowledged a test page in this project: a page reached
   * them. An invited member's first hour ends there (#6807).
   */
  hasAcknowledgedTestPage: boolean;
  // The steps, in order; empty when the card shows none (finished, an invited member).
  steps: Array<WelcomeChecklistStepState>;
  doneCount: number;
  totalCount: number;
  /*
   * Once the checklist is finished: the core steps no goal brought that
   * are left to do (buildWelcomeMoreSteps, #7986), offered on Home until
   * each is done or the person hides the card. Empty otherwise.
   */
  moreSteps: Array<WelcomeChecklistStepState>;
  /*
   * Whether a verified phone number or push device can page this person
   * (canPageByPhoneOrApp, #9442): read once "who is told" is done, so Home
   * keeps a way to the on-call guided setup while only email reaches them.
   * Null when it was not read.
   */
  canBePagedByPhoneOrApp: boolean | null;
}

// An answer with nothing to show: what Home draws when it cannot read one.
export const getEmptyWelcomeChecklistAnswer: () => WelcomeChecklistAnswer =
  (): WelcomeChecklistAnswer => {
    return {
      audience: WelcomeAudience.InvitedMember,
      goals: null,
      shouldAskForGoals: false,
      canChooseGoals: false,
      isHiddenForMe: false,
      isFinished: false,
      canSendEmail: true,
      hasAcknowledgedTestPage: false,
      steps: [],
      doneCount: 0,
      totalCount: 0,
      moreSteps: [],
      canBePagedByPhoneOrApp: null,
    };
  };

const toStepJSON: (state: WelcomeChecklistStepState) => JSONObject = (
  state: WelcomeChecklistStepState,
): JSONObject => {
  return {
    step: state.step,
    isDone: state.isDone,
    needsPlan: state.needsPlan,
    isNext: state.isNext,
    gap: state.gap
      ? {
          check: state.gap.check,
          finding: state.gap.finding
            ? (JSON.parse(JSON.stringify(state.gap.finding)) as JSONObject)
            : null,
        }
      : null,
  };
};

export const toWelcomeChecklistAnswerJSON: (
  answer: WelcomeChecklistAnswer,
) => JSONObject = (answer: WelcomeChecklistAnswer): JSONObject => {
  return {
    audience: answer.audience,
    goals: answer.goals ? [...answer.goals] : null,
    shouldAskForGoals: answer.shouldAskForGoals,
    canChooseGoals: answer.canChooseGoals,
    isHiddenForMe: answer.isHiddenForMe,
    isFinished: answer.isFinished,
    canSendEmail: answer.canSendEmail,
    hasAcknowledgedTestPage: answer.hasAcknowledgedTestPage,
    steps: answer.steps.map(toStepJSON),
    doneCount: answer.doneCount,
    totalCount: answer.totalCount,
    moreSteps: answer.moreSteps.map(toStepJSON),
    canBePagedByPhoneOrApp: answer.canBePagedByPhoneOrApp,
  };
};

const isOneOf: <T extends string>(
  values: ReadonlyArray<T>,
) => (value: unknown) => value is T = <T extends string>(
  values: ReadonlyArray<T>,
): ((value: unknown) => value is T) => {
  return (value: unknown): value is T => {
    return typeof value === "string" && values.includes(value as T);
  };
};

const isSetupHealthCheck: (value: unknown) => value is SetupHealthCheck =
  isOneOf(Object.values(SetupHealthCheck));
const isSetupHealthFix: (value: unknown) => value is SetupHealthFix = isOneOf(
  Object.values(SetupHealthFix),
);
const isSetupHealthLevel: (value: unknown) => value is SetupHealthLevel =
  isOneOf(Object.values(SetupHealthLevel));
const isSetupHealthRecordKind: (
  value: unknown,
) => value is SetupHealthRecordKind = isOneOf(
  Object.values(SetupHealthRecordKind),
);

const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const readRecord: (value: unknown) => SetupHealthRecord | null = (
  value: unknown,
): SetupHealthRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (!isSetupHealthRecordKind(raw["kind"])) {
    return null;
  }

  return {
    kind: raw["kind"],
    id: readText(raw["id"]),
    name: readText(raw["name"]),
  };
};

/*
 * The Setup health finding a step's gap holds, as Home draws it: its
 * sentence, its values and its fix are known to the Dashboard, or the gap
 * is left out - a newer server's check is never drawn half.
 */
const parseFinding: (value: unknown) => SetupHealthFinding | null = (
  value: unknown,
): SetupHealthFinding | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const record: SetupHealthRecord | null = readRecord(raw["record"]);

  if (
    !isSetupHealthCheck(raw["check"]) ||
    !isSetupHealthFix(raw["fix"]) ||
    !isSetupHealthLevel(raw["level"]) ||
    !record ||
    typeof raw["words"] !== "string" ||
    !raw["words"]
  ) {
    return null;
  }

  const values: Record<string, string> = {};

  if (
    raw["values"] &&
    typeof raw["values"] === "object" &&
    !Array.isArray(raw["values"])
  ) {
    for (const [key, item] of Object.entries(
      raw["values"] as Record<string, unknown>,
    )) {
      if (typeof item === "string") {
        values[key] = item;
      }
    }
  }

  const finding: SetupHealthFinding = {
    key: readText(raw["key"]),
    check: raw["check"],
    level: raw["level"],
    subject: readText(raw["subject"]),
    reason: readText(raw["reason"]),
    record: record,
    related: Array.isArray(raw["related"])
      ? (raw["related"] as Array<unknown>)
          .map(readRecord)
          .filter((item: SetupHealthRecord | null): boolean => {
            return item !== null;
          })
          .map((item: SetupHealthRecord | null): SetupHealthRecord => {
            return item!;
          })
      : [],
    fix: raw["fix"],
    fixRecordId: readText(raw["fixRecordId"]),
    words: raw["words"],
    values: values,
    sentence: readText(raw["sentence"]),
  };

  if (typeof raw["startsAt"] === "string" && raw["startsAt"]) {
    finding.startsAt = raw["startsAt"];
  }

  if (
    typeof raw["balanceInUSDCents"] === "number" &&
    Number.isFinite(raw["balanceInUSDCents"])
  ) {
    finding.balanceInUSDCents = raw["balanceInUSDCents"];
  }

  return finding;
};

/*
 * A step's gap as a body holds it, or null when it is not one Home can
 * draw: the checklist's own, or a Setup health finding it knows.
 */
export const parseWelcomeStepGap: (value: unknown) => WelcomeStepGap | null = (
  value: unknown,
): WelcomeStepGap | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (raw["check"] === WELCOME_GAP_INVITATION_NOT_ACCEPTED) {
    return { check: WELCOME_GAP_INVITATION_NOT_ACCEPTED, finding: null };
  }

  const finding: SetupHealthFinding | null = parseFinding(raw["finding"]);

  if (!finding || finding.check !== raw["check"]) {
    return null;
  }

  return { check: finding.check, finding: finding };
};

const isPlanType: (value: unknown) => value is PlanType = (
  value: unknown,
): value is PlanType => {
  return (
    typeof value === "string" &&
    (Object.values(PlanType) as Array<string>).includes(value)
  );
};

const toCount: (value: unknown) => number = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
};

/*
 * The steps a body's list holds. Steps the Dashboard does not know (a newer
 * server) are left out, each step is listed once, and at most one is next
 * - none at all where none may be.
 */
const parseSteps: (
  value: unknown,
  options: { mayHaveNext: boolean },
) => Array<WelcomeChecklistStepState> = (
  value: unknown,
  options: { mayHaveNext: boolean },
): Array<WelcomeChecklistStepState> => {
  const steps: Array<WelcomeChecklistStepState> = [];
  let hasNext: boolean = false;

  if (!Array.isArray(value)) {
    return steps;
  }

  for (const item of value as Array<unknown>) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const step: Record<string, unknown> = item as Record<string, unknown>;

    if (
      !isWelcomeStep(step["step"]) ||
      steps.some((state: WelcomeChecklistStepState): boolean => {
        return state.step === step["step"];
      })
    ) {
      continue;
    }

    const isDone: boolean = step["isDone"] === true;
    const isNext: boolean =
      options.mayHaveNext && step["isNext"] === true && !hasNext;

    if (isNext) {
      hasNext = true;
    }

    steps.push({
      step: step["step"],
      isDone: isDone,
      needsPlan: isPlanType(step["needsPlan"]) ? step["needsPlan"] : null,
      isNext: isNext,
      // A done step has nothing missing.
      gap: isDone ? null : parseWelcomeStepGap(step["gap"]),
    });
  }

  return steps;
};

/*
 * The answer a response body holds, or null when it is not one. Steps the
 * Dashboard does not know (a newer server) are left out, and at most one
 * step is next.
 */
export const parseWelcomeChecklistAnswer: (
  value: unknown,
) => WelcomeChecklistAnswer | null = (
  value: unknown,
): WelcomeChecklistAnswer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (
    raw["audience"] !== WelcomeAudience.SetUp &&
    raw["audience"] !== WelcomeAudience.InvitedMember
  ) {
    return null;
  }

  const goals: Array<ProjectGoal> | null = Array.isArray(raw["goals"])
    ? parseProjectGoals((raw["goals"] as Array<unknown>).filter(isProjectGoal))
    : null;

  return {
    audience: raw["audience"] as WelcomeAudience,
    goals: goals,
    shouldAskForGoals: raw["shouldAskForGoals"] === true,
    canChooseGoals: raw["canChooseGoals"] === true,
    isHiddenForMe: raw["isHiddenForMe"] === true,
    isFinished: raw["isFinished"] === true,
    canSendEmail: raw["canSendEmail"] !== false,
    hasAcknowledgedTestPage: raw["hasAcknowledgedTestPage"] === true,
    steps: parseSteps(raw["steps"], { mayHaveNext: true }),
    doneCount: toCount(raw["doneCount"]),
    totalCount: toCount(raw["totalCount"]),
    // Offered, not planned: none of them is next, and none is done.
    moreSteps: parseSteps(raw["moreSteps"], { mayHaveNext: false }).filter(
      (state: WelcomeChecklistStepState): boolean => {
        return !state.isDone;
      },
    ),
    canBePagedByPhoneOrApp:
      typeof raw["canBePagedByPhoneOrApp"] === "boolean"
        ? raw["canBePagedByPhoneOrApp"]
        : null,
  };
};
