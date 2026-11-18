import ActivationMilestone from "../Analytics/ActivationMilestone";
import { PlanType } from "../Billing/SubscriptionPlan";
import ProjectGoal, { parseProjectGoals } from "./ProjectGoal";
import ProductKey from "../Product/ProductKey";
import {
  SetupHealthCheck,
  SetupHealthFinding,
} from "../SetupHealth/SetupHealth";

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
 *   - A step whose record exists but does not work yet says why
 *     (WelcomeStepGap, #6938): the Setup health finding about its record,
 *     such as a status page that shows no monitor, with the page that fixes
 *     it - so it does not look like a step never started.
 *   - A step the project's plan cannot finish says which plan it needs
 *     (getWelcomeStepPlanNeed) and is not counted.
 *   - The next step is the first one left to do that the plan allows.
 *   - Once every step of the goals is done, the project's checklist is
 *     finished, and Home offers the core steps no goal brought that are
 *     still left (getWelcomeMoreSteps, #7986): a project that came for its
 *     website is still offered a status page and its team.
 *
 * The server builds the checklist (Server/Services/WelcomeChecklistService)
 * and sends it to Home in one answer (WelcomeChecklistAnswer.ts); the
 * Dashboard draws it with each step's words and pages
 * (Components/Home/WelcomeChecklist/WelcomeChecklistCatalog.ts).
 *
 * The server's own setup (email, HTTPS, who can sign up) is not a step: its
 * master admins see the Server setup card above the checklist instead
 * (Components/ServerSetup/ServerSetupCard, #6824), so Home asks for it once
 * (#7018).
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

export enum WelcomeStep {
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
 * and the team last.
 */
export const WELCOME_STEP_ORDER: ReadonlyArray<WelcomeStep> = [
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
 * ABOUT HOW LONG EACH STEP TAKES, in minutes (issue #8897). The quickstart
 * says it beside each step and adds up what is left, and the question adds
 * up the steps a choice of goals brings, so a person sees what a plan asks
 * of them before they start it. Each is someone new doing the step's guided
 * setup (or page) with every default kept: rounded up, and said as "about".
 * The guided setups say the same number beside their steps.
 */
export const WELCOME_STEP_MINUTES: Readonly<Record<WelcomeStep, number>> = {
  // An API key from the other tool, a preview, and the import itself.
  [WelcomeStep.Import]: 10,
  // An address, who is told, and a test page (#6804).
  [WelcomeStep.Monitor]: 3,
  // The agent on one server, or one cluster or cloud account connected.
  [WelcomeStep.Infrastructure]: 5,
  // An app pointed at OpenTelemetry, then its first data (#6806).
  [WelcomeStep.Telemetry]: 10,
  // How you are reached, who else, what if nobody answers, a test (#6805).
  [WelcomeStep.OnCall]: 5,
  // A name, the monitors it shows, and a look at it (#6806).
  [WelcomeStep.StatusPage]: 3,
  // An invitation sent; accepting it is the teammate's.
  [WelcomeStep.Team]: 1,
};

// About how long some steps take together, in minutes.
export const getWelcomeStepsMinutes: (
  steps: ReadonlyArray<WelcomeStep>,
) => number = (steps: ReadonlyArray<WelcomeStep>): number => {
  return steps.reduce((total: number, step: WelcomeStep): number => {
    return total + WELCOME_STEP_MINUTES[step];
  }, 0);
};

/*
 * About how long the steps left take: the ones not done that the plan
 * allows. A step the plan holds back is not counted, as it is not in the
 * progress either.
 */
export const getWelcomeMinutesLeft: (
  steps: ReadonlyArray<WelcomeChecklistStepState>,
) => number = (steps: ReadonlyArray<WelcomeChecklistStepState>): number => {
  return getWelcomeStepsMinutes(
    steps
      .filter((state: WelcomeChecklistStepState): boolean => {
        return !state.isDone && state.needsPlan === null;
      })
      .map((state: WelcomeChecklistStepState): WelcomeStep => {
        return state.step;
      }),
  );
};

/*
 * The steps a choice of goals would give this server's project, before it
 * is sent: what the question says the plan is while the person picks.
 */
export const getPlanStepsForGoals: (
  goals: ReadonlyArray<ProjectGoal>,
  offProducts?: ReadonlyArray<ProductKey> | undefined,
) => Array<WelcomeStep> = (
  goals: ReadonlyArray<ProjectGoal>,
  offProducts?: ReadonlyArray<ProductKey> | undefined,
): Array<WelcomeStep> => {
  if (goals.length === 0) {
    return [];
  }

  return getStepsForGoals(goals).filter((step: WelcomeStep): boolean => {
    return !isWelcomeStepOffOnServer(step, offProducts || []);
  });
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
   * An on-call policy in service that can reach somebody
   * (OnCallReadinessService) is run when something breaks: an enabled
   * incident or alert on-call rule runs it, or a monitor's criteria page it
   * directly (#7017). Somebody would be told, though nobody has been yet.
   * Until a test page (#6811) has been acknowledged, this is how "who is
   * told" is known.
   */
  hasPolicyThatPagesSomeone: boolean;
  // An import from another tool finished (ToolImportRun Completed).
  hasFinishedImport: boolean;
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
    case WelcomeStep.Import:
      return facts.hasFinishedImport;
    case WelcomeStep.OnCall:
      return (
        isWelcomeStepDoneByMilestones(step, facts.reached) ||
        facts.hasPolicyThatPagesSomeone
      );
    default:
      return isWelcomeStepDoneByMilestones(step, facts.reached);
  }
};

/*
 * Whether the server needs to look at what runs the project's on-call
 * policies (its rules, and its monitors' criteria): the steps include "who
 * is told" and no milestone has finished it yet. The check reads rules,
 * monitors and responders, so it is skipped whenever it cannot change the
 * answer.
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

/*
 * WHY A STEP WHOSE RECORD EXISTS IS NOT DONE YET (#6938). A step ticks on
 * its outcome, so it can be open although its record is there: a status
 * page that shows no monitor, a monitor no probe checks, an on-call policy
 * nothing runs or that reaches nobody, an invitation nobody accepted. Home
 * says the break in one line under the step, and the step opens the page
 * that fixes it, so it never looks like a step never started (principle 3:
 * show the chain, and name the break).
 *
 * The breaks are Setup health's findings (Types/SetupHealth, #6812), read
 * once for the project and said in its words, so the checklist and Setup
 * Health never disagree. Only an invitation nobody accepted is the
 * checklist's own: Setup health knows of one only for a responder.
 */
export const WELCOME_GAP_INVITATION_NOT_ACCEPTED: string =
  "invitation_not_accepted";

export interface WelcomeStepGap {
  /*
   * What is missing, as a stable key: the Setup health check of the
   * finding (SetupHealthCheck), or WELCOME_GAP_INVITATION_NOT_ACCEPTED.
   */
  check: string;
  /*
   * The Setup health finding that names it - its sentence, the record it is
   * about and the page that fixes it - or null for the checklist's own,
   * whose step opens its own page.
   */
  finding: SetupHealthFinding | null;
}

/*
 * The Setup health checks that say why a step is not done although its
 * record exists, each step's in the order they are said: what runs a
 * policy before what it reaches. A step with none here (importing, the
 * team, telemetry, a server) has no finding about its record.
 */
export const WELCOME_STEP_GAP_CHECKS: Readonly<
  Record<WelcomeStep, ReadonlyArray<SetupHealthCheck>>
> = {
  [WelcomeStep.Import]: [],
  // A monitor no probe checks never reports its first result.
  [WelcomeStep.Monitor]: [SetupHealthCheck.MonitorNotChecked],
  [WelcomeStep.Infrastructure]: [],
  [WelcomeStep.Telemetry]: [],
  [WelcomeStep.OnCall]: [
    SetupHealthCheck.PolicyNotRun,
    SetupHealthCheck.PolicyHasNoEscalationRules,
    SetupHealthCheck.PolicyReachesNobody,
    SetupHealthCheck.ResponderCannotBePaged,
  ],
  [WelcomeStep.StatusPage]: [SetupHealthCheck.StatusPageShowsNoMonitor],
  [WelcomeStep.Team]: [],
};

// Whether a step can have a Setup health finding about its record.
export const hasWelcomeStepGapChecks: (step: WelcomeStep) => boolean = (
  step: WelcomeStep,
): boolean => {
  return WELCOME_STEP_GAP_CHECKS[step].length > 0;
};

/*
 * A step's gap among the project's findings (the ones this person is
 * shown, without the dismissed): the first finding of the first of its
 * checks that has one, or null.
 */
export const getWelcomeStepGapFromFindings: (
  step: WelcomeStep,
  findings: ReadonlyArray<SetupHealthFinding>,
) => WelcomeStepGap | null = (
  step: WelcomeStep,
  findings: ReadonlyArray<SetupHealthFinding>,
): WelcomeStepGap | null => {
  for (const check of WELCOME_STEP_GAP_CHECKS[step]) {
    const finding: SetupHealthFinding | undefined = findings.find(
      (candidate: SetupHealthFinding): boolean => {
        return candidate.check === check;
      },
    );

    if (finding) {
      return { check: check, finding: finding };
    }
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
  /*
   * Why the step is not done although its record exists (#6938), or null:
   * a step done, held back by the plan, or not started has none.
   */
  gap: WelcomeStepGap | null;
}

export interface WelcomeChecklist {
  steps: Array<WelcomeChecklistStepState>;
  // Of the steps that count (not held back by the plan): how many are done.
  doneCount: number;
  totalCount: number;
  /*
   * Every one of the project's own steps that counts is done: the
   * checklist is finished for everyone, once.
   */
  isProjectFinished: boolean;
}

// A step's state for the facts and the plan.
const getWelcomeStepState: (data: {
  step: WelcomeStep;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
}) => Omit<WelcomeChecklistStepState, "isNext"> = (data: {
  step: WelcomeStep;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
}): Omit<WelcomeChecklistStepState, "isNext"> => {
  const isDone: boolean = isWelcomeStepDone(data.step, data.facts);

  return {
    step: data.step,
    isDone: isDone,
    needsPlan: isDone ? null : getWelcomeStepPlanNeed(data.step, data.plan),
    gap: null,
  };
};

export const buildWelcomeChecklist: (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
  // The products switched off on the server: their steps are left out.
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}) => WelcomeChecklist = (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}): WelcomeChecklist => {
  const keys: Array<WelcomeStep> = getStepsForGoals(data.goals).filter(
    (step: WelcomeStep): boolean => {
      return !isWelcomeStepOffOnServer(step, data.offProducts || []);
    },
  );

  let hasNext: boolean = false;

  const steps: Array<WelcomeChecklistStepState> = keys.map(
    (step: WelcomeStep): WelcomeChecklistStepState => {
      const state: Omit<WelcomeChecklistStepState, "isNext"> =
        getWelcomeStepState({ step: step, facts: data.facts, plan: data.plan });
      const isNext: boolean =
        !hasNext && !state.isDone && state.needsPlan === null;

      if (isNext) {
        hasNext = true;
      }

      return { ...state, isNext: isNext };
    },
  );

  const counted: Array<WelcomeChecklistStepState> = steps.filter(
    (state: WelcomeChecklistStepState): boolean => {
      return state.needsPlan === null;
    },
  );

  return {
    steps: steps,
    doneCount: counted.filter((state: WelcomeChecklistStepState): boolean => {
      return state.isDone;
    }).length,
    totalCount: counted.length,
    isProjectFinished:
      counted.length > 0 &&
      counted.every((state: WelcomeChecklistStepState): boolean => {
        return state.isDone;
      }),
  };
};

/*
 * WHAT ELSE TO SET UP, ONCE THE GOALS' STEPS ARE DONE (#7986).
 *
 * The goals bring the steps a project came for, and the checklist is
 * finished for everyone once those are done. A project that came for its
 * website - a monitor and who is told - was then never offered on Home what
 * every project needs next: a status page and its team. So, once finished,
 * Home offers the core steps (DEFAULT_WELCOME_STEPS, the four every
 * checklist had before there were goals) that no goal brought and that are
 * not done yet, each until it is done or the person hides the card. A
 * project that never chose goals, or skipped them, had the four already,
 * so it is offered nothing more.
 */
export const getWelcomeMoreSteps: (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}) => Array<WelcomeStep> = (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}): Array<WelcomeStep> => {
  const goalSteps: Array<WelcomeStep> = getStepsForGoals(data.goals);

  return DEFAULT_WELCOME_STEPS.filter((step: WelcomeStep): boolean => {
    return (
      !goalSteps.includes(step) &&
      !isWelcomeStepOffOnServer(step, data.offProducts || [])
    );
  });
};

/*
 * The core steps left to offer once the checklist is finished, in the
 * checklist's order: the ones not done yet. None is marked next - each is
 * offered, none is the plan - and one the plan holds back says which plan
 * it needs, as on the checklist.
 */
export const buildWelcomeMoreSteps: (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}) => Array<WelcomeChecklistStepState> = (data: {
  goals: ReadonlyArray<ProjectGoal> | null;
  facts: WelcomeOutcomeFacts;
  plan: WelcomePlanFacts;
  offProducts?: ReadonlyArray<ProductKey> | undefined;
}): Array<WelcomeChecklistStepState> => {
  return getWelcomeMoreSteps({
    goals: data.goals,
    offProducts: data.offProducts,
  })
    .map((step: WelcomeStep): WelcomeChecklistStepState => {
      return {
        ...getWelcomeStepState({
          step: step,
          facts: data.facts,
          plan: data.plan,
        }),
        isNext: false,
      };
    })
    .filter((state: WelcomeChecklistStepState): boolean => {
      return !state.isDone;
    });
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

/*
 * PAGED BY MORE THAN EMAIL (#9442). The website setup's policy pages the
 * person who set it up by email, which ticks "Set up an on-call policy";
 * a ticked step is a record, not a way anywhere, so Home stopped leading
 * to the on-call guided setup - SMS, calls and the app - for an owner whom
 * only email reaches. Home keeps a way to it until one of these, verified,
 * can page them: a phone number (SMS, a call, WhatsApp) or a push device
 * (the mobile app, or a browser). They are Readiness's method types
 * (ReadinessMethodType in Server/Services/OnCallReadinessService).
 */
export const PHONE_OR_APP_METHOD_TYPES: ReadonlyArray<string> = [
  "SMS",
  "Call",
  "WhatsApp",
  "Push",
];

export interface WelcomeReachMethod {
  methodType: string;
  isVerified: boolean;
}

// Whether a verified phone number or push device can page the person.
export const canPageByPhoneOrApp: (
  methods: ReadonlyArray<WelcomeReachMethod>,
) => boolean = (methods: ReadonlyArray<WelcomeReachMethod>): boolean => {
  return methods.some((method: WelcomeReachMethod): boolean => {
    return (
      method.isVerified && PHONE_OR_APP_METHOD_TYPES.includes(method.methodType)
    );
  });
};
