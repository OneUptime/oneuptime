import { PlanType } from "../Billing/SubscriptionPlan";
import { JSONObject } from "../JSON";
import ProjectGoal, { isProjectGoal, parseProjectGoals } from "./ProjectGoal";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
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
  /*
   * This person may explore a sample project from the card (#6808): they
   * set the project up, and this server lets them make projects. False
   * whenever the card offers none.
   */
  canExploreSampleProject: boolean;
  // The steps, in order; empty when the card shows none (finished, an invited member).
  steps: Array<WelcomeChecklistStepState>;
  doneCount: number;
  totalCount: number;
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
      canExploreSampleProject: false,
      steps: [],
      doneCount: 0,
      totalCount: 0,
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
    canExploreSampleProject: answer.canExploreSampleProject,
    steps: answer.steps.map((state: WelcomeChecklistStepState): JSONObject => {
      return {
        step: state.step,
        isDone: state.isDone,
        needsPlan: state.needsPlan,
        isNext: state.isNext,
      };
    }),
    doneCount: answer.doneCount,
    totalCount: answer.totalCount,
  };
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

  const steps: Array<WelcomeChecklistStepState> = [];
  let hasNext: boolean = false;

  if (Array.isArray(raw["steps"])) {
    for (const item of raw["steps"] as Array<unknown>) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const step: Record<string, unknown> = item as Record<string, unknown>;

      if (!isWelcomeStep(step["step"])) {
        continue;
      }

      const isNext: boolean = step["isNext"] === true && !hasNext;

      if (isNext) {
        hasNext = true;
      }

      steps.push({
        step: step["step"],
        isDone: step["isDone"] === true,
        needsPlan: isPlanType(step["needsPlan"]) ? step["needsPlan"] : null,
        isNext: isNext,
      });
    }
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
    canExploreSampleProject: raw["canExploreSampleProject"] === true,
    steps: steps,
    doneCount: toCount(raw["doneCount"]),
    totalCount: toCount(raw["totalCount"]),
  };
};
