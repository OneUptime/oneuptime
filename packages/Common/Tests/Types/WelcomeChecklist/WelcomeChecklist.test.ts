import ActivationMilestone, {
  ALL_ACTIVATION_MILESTONES,
} from "../../../Types/Analytics/ActivationMilestone";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ProjectGoal, {
  PROJECT_GOALS,
} from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  DEFAULT_WELCOME_STEPS,
  PROJECT_IN_USE_MILESTONES,
  STEPS_OF_GOAL,
  STEP_DONE_BY_MILESTONES,
  WELCOME_STEP_ORDER,
  WelcomeAudience,
  WelcomeChecklist,
  WelcomeChecklistStepState,
  WelcomeOutcomeFacts,
  WelcomeStep,
  buildWelcomeChecklist,
  getStepsForGoals,
  getWelcomeAudience,
  getWelcomeStepPlanNeed,
  isLegacyChecklistComplete,
  isProjectInUse,
  isWelcomeStep,
  isWelcomeStepDone,
  needsOnCallRuleCheck,
  shouldAskForGoals,
  GOAL_PRODUCTS,
  WELCOME_STEP_PRODUCTS,
  isGoalOffOnServer,
  isWelcomeStepOffOnServer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ServerProductsPreset,
  getOffByPreset,
} from "../../../Types/Product/ServerProducts";
import { describe, expect, test } from "@jest/globals";

/*
 * The Welcome checklist's rules (issue #6803): which steps each goal brings
 * and in which order, when each step is done - on outcomes, never on a row
 * existing - what the plan holds back, which step is next, when the project
 * is finished, and when Home asks what the project came to do.
 */

const NOTHING: WelcomeOutcomeFacts = {
  reached: [],
  hasRuleThatPagesSomeone: false,
  hasFinishedImport: false,
  serverCanSendEmail: true,
};

const facts: (extra: Partial<WelcomeOutcomeFacts>) => WelcomeOutcomeFacts = (
  extra: Partial<WelcomeOutcomeFacts>,
): WelcomeOutcomeFacts => {
  return { ...NOTHING, ...extra };
};

const stepsOf: (checklist: WelcomeChecklist) => Array<WelcomeStep> = (
  checklist: WelcomeChecklist,
): Array<WelcomeStep> => {
  return checklist.steps.map(
    (state: WelcomeChecklistStepState): WelcomeStep => {
      return state.step;
    },
  );
};

const stateOf: (
  checklist: WelcomeChecklist,
  step: WelcomeStep,
) => WelcomeChecklistStepState = (
  checklist: WelcomeChecklist,
  step: WelcomeStep,
): WelcomeChecklistStepState => {
  return checklist.steps.find((state: WelcomeChecklistStepState): boolean => {
    return state.step === step;
  })!;
};

describe("which steps a project gets", () => {
  test("a project that never answered gets the four steps the checklist always had, in How OneUptime works' order", () => {
    expect(getStepsForGoals(null)).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
      WelcomeStep.Team,
    ]);
    expect(getStepsForGoals(null)).toEqual([...DEFAULT_WELCOME_STEPS]);
  });

  test("skipping the question gives the same four", () => {
    expect(getStepsForGoals([])).toEqual([...DEFAULT_WELCOME_STEPS]);
  });

  test.each([
    [ProjectGoal.Uptime, [WelcomeStep.Monitor, WelcomeStep.OnCall]],
    [
      ProjectGoal.OnCall,
      [WelcomeStep.Monitor, WelcomeStep.OnCall, WelcomeStep.Team],
    ],
    [ProjectGoal.StatusPage, [WelcomeStep.Monitor, WelcomeStep.StatusPage]],
    [ProjectGoal.Telemetry, [WelcomeStep.Telemetry]],
    [ProjectGoal.Infrastructure, [WelcomeStep.Infrastructure]],
    [ProjectGoal.Import, [WelcomeStep.Import, WelcomeStep.OnCall]],
    [ProjectGoal.Explore, [WelcomeStep.Monitor]],
  ])(
    "the %s goal brings its own steps",
    (goal: ProjectGoal, steps: Array<WelcomeStep>) => {
      expect(getStepsForGoals([goal])).toEqual(steps);
    },
  );

  test("every goal has steps, and every step a goal brings is in the order", () => {
    for (const goal of PROJECT_GOALS) {
      expect(STEPS_OF_GOAL[goal].length).toBeGreaterThan(0);

      for (const step of STEPS_OF_GOAL[goal]) {
        expect(WELCOME_STEP_ORDER).toContain(step);
      }
    }
  });

  test("goals together bring each step once, in the checklist's order however they were ticked", () => {
    expect(
      getStepsForGoals([
        ProjectGoal.StatusPage,
        ProjectGoal.Import,
        ProjectGoal.Uptime,
        ProjectGoal.Telemetry,
      ]),
    ).toEqual([
      WelcomeStep.Import,
      WelcomeStep.Monitor,
      WelcomeStep.Telemetry,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
    ]);
  });

  test("every goal at once is every project step, with the team last", () => {
    expect(getStepsForGoals([...PROJECT_GOALS])).toEqual(
      WELCOME_STEP_ORDER.filter((step: WelcomeStep): boolean => {
        return step !== WelcomeStep.ServerEmail;
      }),
    );
  });

  test("an unknown goal is ignored, and a list of only unknown ones is the default", () => {
    expect(getStepsForGoals(["nonsense" as ProjectGoal])).toEqual([
      ...DEFAULT_WELCOME_STEPS,
    ]);
    expect(
      getStepsForGoals(["nonsense" as ProjectGoal, ProjectGoal.Telemetry]),
    ).toEqual([WelcomeStep.Telemetry]);
  });

  test("the order follows How OneUptime works: monitors, then who is told, then status pages", () => {
    const order: Array<WelcomeStep> = [...WELCOME_STEP_ORDER];

    expect(order.indexOf(WelcomeStep.Monitor)).toBeLessThan(
      order.indexOf(WelcomeStep.OnCall),
    );
    expect(order.indexOf(WelcomeStep.OnCall)).toBeLessThan(
      order.indexOf(WelcomeStep.StatusPage),
    );
    expect(order[0]).toBe(WelcomeStep.ServerEmail);
    expect(order[order.length - 1]).toBe(WelcomeStep.Team);
  });

  test("isWelcomeStep knows every step and nothing else", () => {
    for (const step of WELCOME_STEP_ORDER) {
      expect(isWelcomeStep(step)).toBe(true);
    }

    expect(isWelcomeStep("create-monitor")).toBe(false);
    expect(isWelcomeStep(undefined)).toBe(false);
  });
});

describe("a step is done on its outcome, never because a record exists", () => {
  test("monitor: only its first check result, not the monitor being created", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.Monitor,
        facts({ reached: [ActivationMilestone.FirstMonitorCreated] }),
      ),
    ).toBe(false);
    expect(
      isWelcomeStepDone(
        WelcomeStep.Monitor,
        facts({ reached: [ActivationMilestone.FirstCheckResultReceived] }),
      ),
    ).toBe(true);
  });

  test("status page: only once it shows a monitor - an empty status page does not tick it", () => {
    expect(isWelcomeStepDone(WelcomeStep.StatusPage, NOTHING)).toBe(false);
    expect(
      isWelcomeStepDone(
        WelcomeStep.StatusPage,
        facts({
          // A subscriber alone, with nothing shown, is not it either.
          reached: [ActivationMilestone.FirstStatusPageSubscriberAdded],
        }),
      ),
    ).toBe(false);
    expect(
      isWelcomeStepDone(
        WelcomeStep.StatusPage,
        facts({ reached: [ActivationMilestone.FirstStatusPageMonitorAdded] }),
      ),
    ).toBe(true);
  });

  test("who is told: a policy that ran but paged nobody does not tick it", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.OnCall,
        facts({ reached: [ActivationMilestone.FirstOnCallPolicyExecuted] }),
      ),
    ).toBe(false);
    expect(isWelcomeStepDone(WelcomeStep.OnCall, NOTHING)).toBe(false);
  });

  test("who is told: a test page acknowledged ticks it (#6811)", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.OnCall,
        facts({ reached: [ActivationMilestone.FirstTestPageAcknowledged] }),
      ),
    ).toBe(true);
  });

  test("who is told: a real page that reached someone ticks it", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.OnCall,
        facts({ reached: [ActivationMilestone.FirstNotificationDelivered] }),
      ),
    ).toBe(true);
  });

  test("who is told: until then, a rule that runs a policy with someone reachable ticks it", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.OnCall,
        facts({ hasRuleThatPagesSomeone: true }),
      ),
    ).toBe(true);
  });

  test("team: a second person who accepted, not one invited", () => {
    expect(isWelcomeStepDone(WelcomeStep.Team, NOTHING)).toBe(false);
    expect(
      isWelcomeStepDone(
        WelcomeStep.Team,
        facts({ reached: [ActivationMilestone.SecondMemberJoined] }),
      ),
    ).toBe(true);
  });

  test.each([
    ActivationMilestone.FirstLogsReceived,
    ActivationMilestone.FirstTracesReceived,
    ActivationMilestone.FirstMetricsReceived,
    ActivationMilestone.FirstExceptionsReceived,
    ActivationMilestone.FirstProfilesReceived,
  ])("telemetry: the first %s tick it", (milestone: ActivationMilestone) => {
    expect(isWelcomeStepDone(WelcomeStep.Telemetry, NOTHING)).toBe(false);
    expect(
      isWelcomeStepDone(WelcomeStep.Telemetry, facts({ reached: [milestone] })),
    ).toBe(true);
  });

  test("servers: the first metrics, and not logs alone", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.Infrastructure,
        facts({ reached: [ActivationMilestone.FirstLogsReceived] }),
      ),
    ).toBe(false);
    expect(
      isWelcomeStepDone(
        WelcomeStep.Infrastructure,
        facts({ reached: [ActivationMilestone.FirstMetricsReceived] }),
      ),
    ).toBe(true);
  });

  test("import: an import that finished", () => {
    expect(isWelcomeStepDone(WelcomeStep.Import, NOTHING)).toBe(false);
    expect(
      isWelcomeStepDone(WelcomeStep.Import, facts({ hasFinishedImport: true })),
    ).toBe(true);
  });

  test("server email: the server can send", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.ServerEmail,
        facts({ serverCanSendEmail: false }),
      ),
    ).toBe(false);
    expect(isWelcomeStepDone(WelcomeStep.ServerEmail, NOTHING)).toBe(true);
  });

  test("nothing but its own outcome ticks a step: every other milestone leaves it open", () => {
    for (const step of WELCOME_STEP_ORDER) {
      const own: ReadonlyArray<ActivationMilestone> =
        STEP_DONE_BY_MILESTONES[step];
      const others: Array<ActivationMilestone> =
        ALL_ACTIVATION_MILESTONES.filter(
          (milestone: ActivationMilestone): boolean => {
            return !own.includes(milestone);
          },
        );

      expect({
        step: step,
        done: isWelcomeStepDone(
          step,
          facts({
            reached: others,
            serverCanSendEmail: step !== WelcomeStep.ServerEmail,
          }),
        ),
      }).toEqual({ step: step, done: false });
    }
  });

  test("a Set of milestones reads as the list does", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.Monitor,
        facts({
          reached: new Set([ActivationMilestone.FirstCheckResultReceived]),
        }),
      ),
    ).toBe(true);
  });
});

describe("whether the server needs to look at on-call rules", () => {
  test("only while who is told is a step and no milestone finished it", () => {
    expect(
      needsOnCallRuleCheck({ steps: [WelcomeStep.OnCall], reached: [] }),
    ).toBe(true);
    expect(
      needsOnCallRuleCheck({ steps: [WelcomeStep.Monitor], reached: [] }),
    ).toBe(false);
    expect(
      needsOnCallRuleCheck({
        steps: [WelcomeStep.OnCall],
        reached: [ActivationMilestone.FirstNotificationDelivered],
      }),
    ).toBe(false);
  });
});

describe("what the plan holds back", () => {
  test("on the Free plan, inviting the team needs the Growth plan", () => {
    expect(getWelcomeStepPlanNeed(WelcomeStep.Team, { isFreePlan: true })).toBe(
      PlanType.Growth,
    );
  });

  test("on any other plan, and on a server without billing, nothing is held back", () => {
    for (const step of WELCOME_STEP_ORDER) {
      expect(getWelcomeStepPlanNeed(step, { isFreePlan: false })).toBeNull();
    }
  });

  test("on the Free plan, nothing but the team is held back", () => {
    for (const step of WELCOME_STEP_ORDER) {
      if (step !== WelcomeStep.Team) {
        expect(getWelcomeStepPlanNeed(step, { isFreePlan: true })).toBeNull();
      }
    }
  });
});

describe("the checklist a project sees", () => {
  test("a new project that skipped: four steps, none done, the monitor next", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [],
      facts: NOTHING,
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
    });

    expect(stepsOf(checklist)).toEqual([...DEFAULT_WELCOME_STEPS]);
    expect(checklist.doneCount).toBe(0);
    expect(checklist.totalCount).toBe(4);
    expect(stateOf(checklist, WelcomeStep.Monitor).isNext).toBe(true);
    expect(
      checklist.steps.filter((state: WelcomeChecklistStepState): boolean => {
        return state.isNext;
      }),
    ).toHaveLength(1);
    expect(checklist.isProjectFinished).toBe(false);
  });

  test("the next step is the first left to do", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Uptime, ProjectGoal.StatusPage],
      facts: facts({
        reached: [ActivationMilestone.FirstCheckResultReceived],
      }),
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
    });

    expect(stepsOf(checklist)).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
    ]);
    expect(stateOf(checklist, WelcomeStep.Monitor).isDone).toBe(true);
    expect(stateOf(checklist, WelcomeStep.Monitor).isNext).toBe(false);
    expect(stateOf(checklist, WelcomeStep.OnCall).isNext).toBe(true);
    expect(stateOf(checklist, WelcomeStep.StatusPage).isNext).toBe(false);
    expect(checklist.doneCount).toBe(1);
    expect(checklist.totalCount).toBe(3);
  });

  test("on the Free plan the team step says what it needs, is never next and is not counted", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.OnCall],
      facts: facts({
        reached: [
          ActivationMilestone.FirstCheckResultReceived,
          ActivationMilestone.FirstNotificationDelivered,
        ],
      }),
      plan: { isFreePlan: true },
      readerIsServerAdmin: false,
    });

    const team: WelcomeChecklistStepState = stateOf(
      checklist,
      WelcomeStep.Team,
    );

    expect(team.needsPlan).toBe(PlanType.Growth);
    expect(team.isNext).toBe(false);
    expect(team.isDone).toBe(false);
    expect(checklist.totalCount).toBe(2);
    expect(checklist.doneCount).toBe(2);
    // The Free plan's project finishes without the step it cannot do.
    expect(checklist.isProjectFinished).toBe(true);
  });

  test("a team step done on a project now on the Free plan says nothing about the plan", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: null,
      facts: facts({ reached: [ActivationMilestone.SecondMemberJoined] }),
      plan: { isFreePlan: true },
      readerIsServerAdmin: false,
    });

    expect(stateOf(checklist, WelcomeStep.Team).needsPlan).toBeNull();
    expect(stateOf(checklist, WelcomeStep.Team).isDone).toBe(true);
  });

  test("a master admin of a server that cannot send email sees that first, as the next step", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: null,
      facts: facts({ serverCanSendEmail: false }),
      plan: { isFreePlan: false },
      readerIsServerAdmin: true,
    });

    expect(stepsOf(checklist)[0]).toBe(WelcomeStep.ServerEmail);
    expect(stateOf(checklist, WelcomeStep.ServerEmail).isNext).toBe(true);
    expect(checklist.totalCount).toBe(5);
  });

  test("nobody else sees the server's email step, and nobody once it can send", () => {
    expect(
      stepsOf(
        buildWelcomeChecklist({
          goals: null,
          facts: facts({ serverCanSendEmail: false }),
          plan: { isFreePlan: false },
          readerIsServerAdmin: false,
        }),
      ),
    ).not.toContain(WelcomeStep.ServerEmail);
    expect(
      stepsOf(
        buildWelcomeChecklist({
          goals: null,
          facts: NOTHING,
          plan: { isFreePlan: false },
          readerIsServerAdmin: true,
        }),
      ),
    ).not.toContain(WelcomeStep.ServerEmail);
  });

  test("the server's email is not the project's to finish: every project step done finishes it", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Telemetry],
      facts: facts({
        reached: [ActivationMilestone.FirstTracesReceived],
        serverCanSendEmail: false,
      }),
      plan: { isFreePlan: false },
      readerIsServerAdmin: true,
    });

    expect(stateOf(checklist, WelcomeStep.ServerEmail).isDone).toBe(false);
    expect(checklist.isProjectFinished).toBe(true);
  });

  test("a project with every step done is finished; one with any left is not", () => {
    const allDone: WelcomeOutcomeFacts = facts({
      reached: [
        ActivationMilestone.FirstCheckResultReceived,
        ActivationMilestone.FirstNotificationDelivered,
        ActivationMilestone.FirstStatusPageMonitorAdded,
        ActivationMilestone.SecondMemberJoined,
      ],
    });

    expect(
      buildWelcomeChecklist({
        goals: null,
        facts: allDone,
        plan: { isFreePlan: false },
        readerIsServerAdmin: false,
      }).isProjectFinished,
    ).toBe(true);

    expect(
      buildWelcomeChecklist({
        goals: [ProjectGoal.Telemetry],
        facts: allDone,
        plan: { isFreePlan: false },
        readerIsServerAdmin: false,
      }).isProjectFinished,
    ).toBe(false);
  });

  test("every goal, alone, on every plan and edition, gives a checklist with one next step and counts that add up", () => {
    for (const goal of PROJECT_GOALS) {
      for (const isFreePlan of [false, true]) {
        for (const readerIsServerAdmin of [false, true]) {
          for (const serverCanSendEmail of [false, true]) {
            const checklist: WelcomeChecklist = buildWelcomeChecklist({
              goals: [goal],
              facts: facts({ serverCanSendEmail: serverCanSendEmail }),
              plan: { isFreePlan: isFreePlan },
              readerIsServerAdmin: readerIsServerAdmin,
            });

            const next: Array<WelcomeChecklistStepState> =
              checklist.steps.filter(
                (state: WelcomeChecklistStepState): boolean => {
                  return state.isNext;
                },
              );

            expect(next).toHaveLength(1);
            expect(next[0]!.needsPlan).toBeNull();
            expect(checklist.doneCount).toBe(0);
            expect(checklist.totalCount).toBe(
              checklist.steps.filter(
                (state: WelcomeChecklistStepState): boolean => {
                  return state.needsPlan === null;
                },
              ).length,
            );
            expect(checklist.isProjectFinished).toBe(false);
            expect(stepsOf(checklist).includes(WelcomeStep.ServerEmail)).toBe(
              readerIsServerAdmin && !serverCanSendEmail,
            );
          }
        }
      }
    }
  });
});

describe("when Home asks what the project came to do", () => {
  test("a new, empty project, of someone who may answer", () => {
    expect(
      shouldAskForGoals({
        goals: null,
        canChooseGoals: true,
        isFinished: false,
        reached: [],
      }),
    ).toBe(true);
  });

  test("never again once answered or skipped", () => {
    expect(
      shouldAskForGoals({
        goals: [],
        canChooseGoals: true,
        isFinished: false,
        reached: [],
      }),
    ).toBe(false);
    expect(
      shouldAskForGoals({
        goals: [ProjectGoal.Uptime],
        canChooseGoals: true,
        isFinished: false,
        reached: [],
      }),
    ).toBe(false);
  });

  test("never of an invited member, or anybody else who may not answer", () => {
    expect(
      shouldAskForGoals({
        goals: null,
        canChooseGoals: false,
        isFinished: false,
        reached: [],
      }),
    ).toBe(false);
  });

  test("never of a finished project", () => {
    expect(
      shouldAskForGoals({
        goals: null,
        canChooseGoals: true,
        isFinished: true,
        reached: [],
      }),
    ).toBe(false);
  });

  test.each(
    PROJECT_IN_USE_MILESTONES.map((milestone: ActivationMilestone) => {
      return [milestone];
    }),
  )(
    "never of a project already in use (%s)",
    (milestone: ActivationMilestone) => {
      expect(isProjectInUse([milestone])).toBe(true);
      expect(
        shouldAskForGoals({
          goals: null,
          canChooseGoals: true,
          isFinished: false,
          reached: [milestone],
        }),
      ).toBe(false);
    },
  );

  test("a project whose only milestone is a second member is still asked", () => {
    expect(isProjectInUse([ActivationMilestone.SecondMemberJoined])).toBe(
      false,
    );
    expect(
      shouldAskForGoals({
        goals: null,
        canChooseGoals: true,
        isFinished: false,
        reached: [ActivationMilestone.SecondMemberJoined],
      }),
    ).toBe(true);
  });
});

describe("who the card is for", () => {
  test("Owners, Admins and master admins set the project up; everyone else is an invited member", () => {
    expect(
      getWelcomeAudience({ isMasterAdmin: false, isProjectOwnerOrAdmin: true }),
    ).toBe(WelcomeAudience.SetUp);
    expect(
      getWelcomeAudience({ isMasterAdmin: true, isProjectOwnerOrAdmin: false }),
    ).toBe(WelcomeAudience.SetUp);
    expect(
      getWelcomeAudience({
        isMasterAdmin: false,
        isProjectOwnerOrAdmin: false,
      }),
    ).toBe(WelcomeAudience.InvitedMember);
  });
});

describe("the checklist before this one", () => {
  const COMPLETE: {
    monitors: number;
    statusPages: number;
    teamMembers: number;
    onCallPolicies: number;
  } = { monitors: 1, statusPages: 1, teamMembers: 2, onCallPolicies: 1 };

  test("was complete with a monitor, a status page, a second member and a policy", () => {
    expect(isLegacyChecklistComplete(COMPLETE)).toBe(true);
  });

  test.each([
    ["monitors", { ...COMPLETE, monitors: 0 }],
    ["status pages", { ...COMPLETE, statusPages: 0 }],
    ["a second member", { ...COMPLETE, teamMembers: 1 }],
    ["policies", { ...COMPLETE, onCallPolicies: 0 }],
  ])("was not without %s", (_name: string, counts: typeof COMPLETE) => {
    expect(isLegacyChecklistComplete(counts)).toBe(false);
  });
});

/*
 * Home never asks for what this server does not run (#6815): a step whose
 * product is switched off on the server is not on the checklist, and a goal
 * whose product is off is not offered.
 */
describe("products switched off on the server", () => {
  test("every step and goal says the products it is done in", () => {
    expect(Object.keys(WELCOME_STEP_PRODUCTS).sort()).toEqual(
      [...WELCOME_STEP_ORDER].sort(),
    );
    expect(Object.keys(GOAL_PRODUCTS).sort()).toEqual(
      [...PROJECT_GOALS].sort(),
    );
    expect(WELCOME_STEP_PRODUCTS[WelcomeStep.StatusPage]).toEqual([
      ProductKey.StatusPages,
    ]);
    expect(WELCOME_STEP_PRODUCTS[WelcomeStep.Team]).toEqual([]);
  });

  test("a step of a product that is off is left out; the others keep their order", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [],
      facts: NOTHING,
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
      offProducts: [ProductKey.StatusPages],
    });

    expect(stepsOf(checklist)).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.Team,
    ]);
    expect(checklist.totalCount).toBe(3);
  });

  test("the telemetry step goes while ingestion is stopped", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Telemetry, ProjectGoal.Uptime],
      facts: NOTHING,
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
      offProducts: [
        ProductKey.Logs,
        ProductKey.Metrics,
        ProductKey.Traces,
        ProductKey.Profiles,
        ProductKey.Exceptions,
      ],
    });

    expect(stepsOf(checklist)).not.toContain(WelcomeStep.Telemetry);
    expect(stepsOf(checklist)).toContain(WelcomeStep.Monitor);
  });

  test("the Monitoring and status pages preset keeps the four steps the checklist always had", () => {
    expect(
      stepsOf(
        buildWelcomeChecklist({
          goals: [],
          facts: NOTHING,
          plan: { isFreePlan: false },
          readerIsServerAdmin: false,
          offProducts: getOffByPreset(
            ServerProductsPreset.MonitoringAndStatusPages,
          ),
        }),
      ),
    ).toEqual([...DEFAULT_WELCOME_STEPS]);
  });

  test("nothing off changes nothing", () => {
    const without: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Infrastructure],
      facts: NOTHING,
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
    });
    const withNothingOff: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Infrastructure],
      facts: NOTHING,
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
      offProducts: [],
    });

    expect(withNothingOff).toEqual(without);
  });

  test("the server's email step stays: it is no product's", () => {
    expect(
      stepsOf(
        buildWelcomeChecklist({
          goals: [ProjectGoal.StatusPage],
          facts: facts({ serverCanSendEmail: false }),
          plan: { isFreePlan: false },
          readerIsServerAdmin: true,
          offProducts: [ProductKey.StatusPages],
        }),
      ),
    ).toEqual([WelcomeStep.ServerEmail, WelcomeStep.Monitor]);
  });

  test("a goal whose product is off is not offered; Import and Explore always are", () => {
    expect(
      isGoalOffOnServer(ProjectGoal.StatusPage, [ProductKey.StatusPages]),
    ).toBe(true);
    expect(isGoalOffOnServer(ProjectGoal.Telemetry, [ProductKey.Traces])).toBe(
      true,
    );
    expect(
      isGoalOffOnServer(ProjectGoal.Uptime, [ProductKey.StatusPages]),
    ).toBe(false);

    const everythingOff: Array<ProductKey> = getOffByPreset(
      ServerProductsPreset.MonitoringAndStatusPages,
    ).concat([ProductKey.Monitors, ProductKey.OnCall, ProductKey.StatusPages]);

    expect(isGoalOffOnServer(ProjectGoal.Import, everythingOff)).toBe(false);
    expect(isGoalOffOnServer(ProjectGoal.Explore, everythingOff)).toBe(false);
  });

  test("isWelcomeStepOffOnServer asks each product of the step", () => {
    expect(
      isWelcomeStepOffOnServer(WelcomeStep.Telemetry, [ProductKey.Services]),
    ).toBe(true);
    expect(
      isWelcomeStepOffOnServer(WelcomeStep.Team, [ProductKey.Monitors]),
    ).toBe(false);
  });
});
