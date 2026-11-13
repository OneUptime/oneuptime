import ActivationMilestone from "../Analytics/ActivationMilestone";
import { PlanType } from "../Billing/SubscriptionPlan";
import ProjectGoal, { parseProjectGoals } from "./ProjectGoal";
import ProductKey from "../Product/ProductKey";

/*
 * THE WELCOME CHECKLIST ON HOME (issue #6803): which steps a project is
 * shown, in which order, and when each is done.
 *
 *   - The steps come from the goals the project chose (ProjectGoal): each
 *     goal brings its own (STEPS_OF_GOAL), and a project that skipped the
 *     question, or never answered it, gets DEFAULT_WELCOME_STEPS. They are
 *     always shown in WELCOME_STEP_ORDER, the order of "How OneUptime
 *     works": monitors, then who is told, then status pages.
 *   - A step is done when the thing works, not when a record exists
 *     (isWelcomeStepDone): a monitor that has reported, a status page that
 *     shows a monitor, a second person who accepted. Most of these are the
 *     project's activation milestones (#6830, STEP_DONE_BY_MILESTONES),
 *     which the server keeps the moment they first become true - and sends
 *     to product analytics then, as activation/<milestone>.
 *   - A step the project's plan cannot finish says which plan it needs
 *     (getWelcomeStepPlanNeed) and is not counted.
 *   - The next step is the first one left to do that the plan allows.
 *
 * The server builds the checklist (Server/Services/WelcomeChecklistService)
 * and sends it to Home in one answer (WelcomeChecklistAnswer.ts); the
 * Dashboard draws it with each step's words and pages
 * (Components/Home/WelcomeChecklist/WelcomeChecklistCatalog.ts).
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

export enum WelcomeStep {
  /*
   * A master admin of a self-hosted server that cannot send email yet: set
   * it up in the Admin Dashboard. Not one of the project's own steps.
   */
  ServerEmail = "server_email",
  // Bring monitors, on-call and status pages over from another tool.
  Import = "import",
  // A monitor that has reported its first result.
  Monitor = "monitor",
  // A server, Kubernetes cluster or cloud that sends its first metrics.
  Infrastructure = "infrastructure",
  // The project's first logs, metrics, traces, exceptions or profiles.
  Telemetry = "telemetry",
  // Somebody is told when something breaks.
  OnCall = "on_call",
  // A status page that shows a monitor.
  StatusPage = "status_page",
  // A second person in the project.
  Team = "team",
}

/*
 * Every step, in the order the checklist shows them: the order a problem
 * flows through OneUptime ("How OneUptime works"), with what feeds it first
 * and the team last. The server's email comes before everything: without
 * it nobody is told by email, and nobody gets an invitation.
 */
export const WELCOME_STEP_ORDER: ReadonlyArray<WelcomeStep> = [
  WelcomeStep.ServerEmail,
  WelcomeStep.Import,
  WelcomeStep.Monitor,
  WelcomeStep.Infrastructure,
  WelcomeStep.Telemetry,
  WelcomeStep.OnCall,
  WelcomeStep.StatusPage,
  WelcomeStep.Team,
];

export const isWelcomeStep: (value: unknown) => value is WelcomeStep = (
  value: unknown,
): value is WelcomeStep => {
  return (
    typeof value === "string" &&
    (WELCOME_STEP_ORDER as ReadonlyArray<string>).includes(value)
  );
};

// The steps each goal brings.
export const STEPS_OF_GOAL: Readonly<
  Record<ProjectGoal, ReadonlyArray<WelcomeStep>>
> = {
  [ProjectGoal.Uptime]: [WelcomeStep.Monitor, WelcomeStep.OnCall],
  [ProjectGoal.OnCall]: [
    WelcomeStep.Monitor,
    WelcomeStep.OnCall,
    WelcomeStep.Team,
  ],
  [ProjectGoal.StatusPage]: [WelcomeStep.Monitor, WelcomeStep.StatusPage],
  [ProjectGoal.Telemetry]: [WelcomeStep.Telemetry],
  [ProjectGoal.Infrastructure]: [WelcomeStep.Infrastructure],
  [ProjectGoal.Import]: [WelcomeStep.Import, WelcomeStep.OnCall],
  // The quickest thing that shows OneUptime working: a website monitor.
  [ProjectGoal.Explore]: [WelcomeStep.Monitor],
};

/*
 * The steps of a project that skipped the question or never answered it:
 * the four the checklist always had, in the checklist's order.
 */
export const DEFAULT_WELCOME_STEPS: ReadonlyArray<WelcomeStep> = [
  WelcomeStep.Monitor,
  WelcomeStep.OnCall,
  WelcomeStep.StatusPage,
  WelcomeStep.Team,
];

/*
 * The products each step is done in (#6815): a step whose product is
 * switched off on the server is not on the checklist, and a goal whose
 * products are off is not offered - Home never asks for what this server
 * does not run. Telemetry's step opens its guided setup, which sends logs,
 * metrics and traces to a service.
 */
export const WELCOME_STEP_PRODUCTS: Readonly<
  Record<WelcomeStep, ReadonlyArray<ProductKey>>
> = {
  [WelcomeStep.ServerEmail]: [],
  [WelcomeStep.Import]: [],
  [WelcomeStep.Monitor]: [ProductKey.Monitors],
  [WelcomeStep.Infrastructure]: [ProductKey.Hosts],
  [WelcomeStep.Telemetry]: [
    ProductKey.Services,
    ProductKey.Logs,
    ProductKey.Metrics,
    ProductKey.Traces,
  ],
  [WelcomeStep.OnCall]: [ProductKey.OnCall],
  [WelcomeStep.StatusPage]: [ProductKey.StatusPages],
  [WelcomeStep.Team]: [],
};

export const GOAL_PRODUCTS: Readonly<
  Record<ProjectGoal, ReadonlyArray<ProductKey>>
> = {
  [ProjectGoal.Uptime]: [ProductKey.Monitors],
  [ProjectGoal.OnCall]: [ProductKey.OnCall],
  [ProjectGoal.StatusPage]: [ProductKey.StatusPages],
  [ProjectGoal.Telemetry]: [
    ProductKey.Logs,
    ProductKey.Metrics,
    ProductKey.Traces,
  ],
  [ProjectGoal.Infrastructure]: [ProductKey.Hosts],
  [ProjectGoal.Import]: [],
  [ProjectGoal.Explore]: [],
};

// Whether a step needs a product switched off on the server.
export const isWelcomeStepOffOnServer: (
  step: WelcomeStep,
  offProducts: ReadonlyArray<ProductKey>,
) => boolean = (
  step: WelcomeStep,
  offProducts: ReadonlyArray<ProductKey>,
): boolean => {
  return WELCOME_STEP_PRODUCTS[step].some((product: ProductKey): boolean => {
    return offProducts.includes(product);
  });
};

// Whether a goal needs a product switched off on the server.
export const isGoalOffOnServer: (
  goal: ProjectGoal,
  offProducts: ReadonlyArray<ProductKey>,
) => boolean = (
  goal: ProjectGoal,
  offProducts: ReadonlyArray<ProductKey>,
): boolean => {
  return GOAL_PRODUCTS[goal].some((product: ProductKey): boolean => {
    return offProducts.includes(product);
  });
};

// The project's own steps for its goals, each once, in the checklist's order.
export const getStepsForGoals: (
  goals: ReadonlyArray<ProjectGoal> | null,
) => Array<WelcomeStep> = (
  goals: ReadonlyArray<ProjectGoal> | null,
): Array<WelcomeStep> => {
  const known: Array<ProjectGoal> =
    parseProjectGoals(goals ? [...goals] : null) || [];

  const wanted: Set<WelcomeStep> = new Set<WelcomeStep>();

  if (known.length === 0) {
    for (const step of DEFAULT_WELCOME_STEPS) {
      wanted.add(step);
    }
  }

  for (const goal of known) {
    for (const step of STEPS_OF_GOAL[goal]) {
      wanted.add(step);
    }
  }

  return WELCOME_STEP_ORDER.filter((step: WelcomeStep): boolean => {
    return wanted.has(step);
  });
};

/*
 * The milestones, any one of which finishes a step. The test page (#6811)
 * and a real page that reached someone both prove somebody is told; any
 * telemetry is a first result for "See my logs, metrics and traces"; a
 * server or cluster's agents send metrics first.
 */
export const STEP_DONE_BY_MILESTONES: Readonly<
  Record<WelcomeStep, ReadonlyArray<ActivationMilestone>>
> = {
  [WelcomeStep.ServerEmail]: [],
  [WelcomeStep.Import]: [],
  [WelcomeStep.Monitor]: [ActivationMilestone.FirstCheckResultReceived],
  [WelcomeStep.Infrastructure]: [ActivationMilestone.FirstMetricsReceived],
  [WelcomeStep.Telemetry]: [
    ActivationMilestone.FirstLogsReceived,
    ActivationMilestone.FirstTracesReceived,
    ActivationMilestone.FirstMetricsReceived,
    ActivationMilestone.FirstExceptionsReceived,
    ActivationMilestone.FirstProfilesReceived,
  ],
  [WelcomeStep.OnCall]: [
    ActivationMilestone.FirstTestPageAcknowledged,
    ActivationMilestone.FirstNotificationDelivered,
  ],
  [WelcomeStep.StatusPage]: [ActivationMilestone.FirstStatusPageMonitorAdded],
  [WelcomeStep.Team]: [ActivationMilestone.SecondMemberJoined],
};

// What the server knows about a project, for deciding which steps are done.
export interface WelcomeOutcomeFacts {
  // The project's activation milestones.
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
  /*
   * An enabled incident or alert on-call rule runs an on-call policy that
   * can reach somebody (OnCallReadinessService): somebody would be told,
   * though nobody has been yet. Until a test page (#6811) has been
   * acknowledged, this is how "who is told" is known.
   */
  hasRuleThatPagesSomeone: boolean;
  // An import from another tool finished (ToolImportRun Completed).
  hasFinishedImport: boolean;
  // The server can send email (always, on OneUptime Cloud).
  serverCanSendEmail: boolean;
}

const toSet: (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
) => Set<ActivationMilestone> = (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
): Set<ActivationMilestone> => {
  return reached instanceof Set ? reached : new Set(reached);
};

// Whether one of the step's milestones is reached.
export const isWelcomeStepDoneByMilestones: (
  step: WelcomeStep,
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
) => boolean = (
  step: WelcomeStep,
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
): boolean => {
  const reachedSet: Set<ActivationMilestone> = toSet(reached);

  return STEP_DONE_BY_MILESTONES[step].some(
    (milestone: ActivationMilestone): boolean => {
      return reachedSet.has(milestone);
    },
  );
};

/*
 * THE OUTCOME RULES: whether a step is done. One place, so each rule is
 * tested on its own (WelcomeChecklist.test.ts breaks each once).
 */
export const isWelcomeStepDone: (
  step: WelcomeStep,
  facts: WelcomeOutcomeFacts,
) => boolean = (step: WelcomeStep, facts: WelcomeOutcomeFacts): boolean => {
  switch (step) {
    case WelcomeStep.ServerEmail:
      return facts.serverCanSendEmail;
    case WelcomeStep.Import:
      return facts.hasFinishedImport;
    case WelcomeStep.OnCall:
      return (
        isWelcomeStepDoneByMilestones(step, facts.reached) ||
        facts.hasRuleThatPagesSomeone
      );
    default:
      return isWelcomeStepDoneByMilestones(step, facts.reached);
  }
};

/*
 * Whether the server needs to look at the project's on-call rules: the
 * steps include "who is told" and no milestone has finished it yet. The
 * check reads rules and responders, so it is skipped whenever it cannot
 * change the answer.
 */
export const needsOnCallRuleCheck: (data: {
  steps: ReadonlyArray<WelcomeStep>;
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
}) => boolean = (data: {
  steps: ReadonlyArray<WelcomeStep>;
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
}): boolean => {
  return (
    data.steps.includes(WelcomeStep.OnCall) &&
    !isWelcomeStepDoneByMilestones(WelcomeStep.OnCall, data.reached)
  );
};

// What the project's plan allows, as far as the checklist is concerned.
export interface WelcomePlanFacts {
  /*
   * The project is on OneUptime Cloud's Free plan (only ever true where
   * billing is on): one person, so nobody can be invited
   * (ALLOWED_PEOPLE_IN_FREE_PLAN in Server/Services/TeamMemberService).
   */
  isFreePlan: boolean;
}

/*
 * The plan a step needs, when the project's plan cannot finish it, or null.
 * Only inviting the team is held back today: the Free plan has one person,
 * and the invitation would be refused on submit.
 */
export const getWelcomeStepPlanNeed: (
  step: WelcomeStep,
  plan: WelcomePlanFacts,
) => PlanType | null = (
  step: WelcomeStep,
  plan: WelcomePlanFacts,
): PlanType | null => {
  if (step === WelcomeStep.Team && plan.isFreePlan) {
    return PlanType.Growth;
  }

  return null;
};

export interface WelcomeChecklistStepState {
  step: WelcomeStep;
  isDone: boolean;
  /*
   * The plan the step needs, when the project's plan cannot finish it: the
   * step says so before the click, opens Billing, and is not counted.
   */
  needsPlan: PlanType | null;
  // The one step Home marks as next.
  isNext: boolean;
}

export interface WelcomeChecklist {
  steps: Array<WelcomeChecklistStepState>;
  // Of the steps that count (not held back by the plan): how many are done.
  doneCount: number;
  totalCount: number;
  /*
   * Every one of the project's own steps that counts is done. The server's
   * email is not the project's to finish, so it is left out: a project is
   * finished for everyone, once.
   */
  isProjectFinished: boolean;
}

export const buildWelcomeChecklist: (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
  // The reader is a master admin of a self-hosted server.
  readerIsServerAdmin: boolean;
  // The products switched off on the server: their steps are left out.
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}) => WelcomeChecklist = (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
  readerIsServerAdmin: boolean;
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}): WelcomeChecklist => {
  const keys: Array<WelcomeStep> = getStepsForGoals(data.goals).filter(
    (step: WelcomeStep): boolean => {
      return !isWelcomeStepOffOnServer(step, data.offProducts || []);
    },
  );

  // Shown to the one person who can fix it, and only while it is broken.
  if (data.readerIsServerAdmin && !data.facts.serverCanSendEmail) {
    keys.unshift(WelcomeStep.ServerEmail);
  }

  let hasNext: boolean = false;

  const steps: Array<WelcomeChecklistStepState> = keys.map(
    (step: WelcomeStep): WelcomeChecklistStepState => {
      const isDone: boolean = isWelcomeStepDone(step, data.facts);
      const needsPlan: PlanType | null = isDone
        ? null
        : getWelcomeStepPlanNeed(step, data.plan);
      const isNext: boolean = !hasNext && !isDone && needsPlan === null;

      if (isNext) {
        hasNext = true;
      }

      return {
        step: step,
        isDone: isDone,
        needsPlan: needsPlan,
        isNext: isNext,
      };
    },
  );

  const counted: Array<WelcomeChecklistStepState> = steps.filter(
    (state: WelcomeChecklistStepState): boolean => {
      return state.needsPlan === null;
    },
  );

  const projectSteps: Array<WelcomeChecklistStepState> = counted.filter(
    (state: WelcomeChecklistStepState): boolean => {
      return state.step !== WelcomeStep.ServerEmail;
    },
  );

  return {
    steps: steps,
    doneCount: counted.filter((state: WelcomeChecklistStepState): boolean => {
      return state.isDone;
    }).length,
    totalCount: counted.length,
    isProjectFinished:
      projectSteps.length > 0 &&
      projectSteps.every((state: WelcomeChecklistStepState): boolean => {
        return state.isDone;
      }),
  };
};

/*
 * The milestones that say a project is already in use: it has monitors,
 * telemetry, a status page with a monitor, or on-call that ran. A project
 * like that is not asked what it came to do - its people already know -
 * and keeps the four steps it always had. A second member alone does not
 * count: inviting a co-founder is often the first thing a new project does.
 */
export const PROJECT_IN_USE_MILESTONES: ReadonlyArray<ActivationMilestone> = [
  ActivationMilestone.FirstMonitorCreated,
  ActivationMilestone.FirstCheckResultReceived,
  ActivationMilestone.FirstNotificationDelivered,
  ActivationMilestone.FirstIncidentOrAlertAcknowledged,
  ActivationMilestone.FirstStatusPageMonitorAdded,
  ActivationMilestone.FirstStatusPageSubscriberAdded,
  ActivationMilestone.FirstOnCallPolicyExecuted,
  ActivationMilestone.FirstLogsReceived,
  ActivationMilestone.FirstTracesReceived,
  ActivationMilestone.FirstMetricsReceived,
  ActivationMilestone.FirstExceptionsReceived,
  ActivationMilestone.FirstProfilesReceived,
];

export const isProjectInUse: (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
) => boolean = (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
): boolean => {
  const reachedSet: Set<ActivationMilestone> = toSet(reached);

  return PROJECT_IN_USE_MILESTONES.some(
    (milestone: ActivationMilestone): boolean => {
      return reachedSet.has(milestone);
    },
  );
};

/*
 * Whether Home asks "What do you want to do first?": once, of someone who
 * may answer for the project, while it has no answer, is not finished, and
 * is not in use yet.
 */
export const shouldAskForGoals: (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  canChooseGoals: boolean;
  isFinished: boolean;
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
}) => boolean = (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  canChooseGoals: boolean;
  isFinished: boolean;
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>;
}): boolean => {
  return (
    data.canChooseGoals &&
    data.goals === null &&
    !data.isFinished &&
    !isProjectInUse(data.reached)
  );
};

/*
 * Who the Welcome card is for.
 *
 *   SetUp           the people who set the project up: its Owners and
 *                   Admins (and a master admin). They share one checklist.
 *   InvitedMember   everyone else: they did not come to set the project up,
 *                   and the owner's checklist is not theirs. Home draws
 *                   nothing for them today; their own first hour - can
 *                   OneUptime reach me, when am I on call - is #6807, which
 *                   plugs in where Home reads this.
 */
export enum WelcomeAudience {
  SetUp = "set_up",
  InvitedMember = "invited_member",
}

export const getWelcomeAudience: (data: {
  isMasterAdmin: boolean;
  isProjectOwnerOrAdmin: boolean;
}) => WelcomeAudience = (data: {
  isMasterAdmin: boolean;
  isProjectOwnerOrAdmin: boolean;
}): WelcomeAudience => {
  return data.isMasterAdmin || data.isProjectOwnerOrAdmin
    ? WelcomeAudience.SetUp
    : WelcomeAudience.InvitedMember;
};

/*
 * THE CHECKLIST BEFORE THIS ONE ticked a step when a record existed: a
 * monitor, a status page, a second member, an on-call policy. A project
 * that finished it then must not see a checklist come back now that steps
 * tick on outcomes, so the server reads those four counts once for every
 * project that existed before (WelcomeChecklistState.needsLegacyCheck), and
 * stores the checklist as finished when they say it was.
 */
export interface LegacyChecklistCounts {
  monitors: number;
  statusPages: number;
  teamMembers: number;
  onCallPolicies: number;
}

export const isLegacyChecklistComplete: (
  counts: LegacyChecklistCounts,
) => boolean = (counts: LegacyChecklistCounts): boolean => {
  return (
    counts.monitors > 0 &&
    counts.statusPages > 0 &&
    // Every project starts with its creator as its first member.
    counts.teamMembers > 1 &&
    counts.onCallPolicies > 0
  );
};
