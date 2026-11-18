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
  WELCOME_STEP_MINUTES,
  WELCOME_STEP_PRODUCTS,
  getPlanStepsForGoals,
  getWelcomeMinutesLeft,
  getWelcomeStepsMinutes,
  isGoalOffOnServer,
  isWelcomeStepOffOnServer,
  PHONE_OR_APP_METHOD_TYPES,
  WELCOME_STEP_GAP_CHECKS,
  buildWelcomeMoreSteps,
  canPageByPhoneOrApp,
  getWelcomeMoreSteps,
  getWelcomeStepGapFromFindings,
  hasWelcomeStepGapChecks,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ServerProductsPreset,
  getOffByPreset,
} from "../../../Types/Product/ServerProducts";
import {
  SETUP_HEALTH_WORDS,
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecordKind,
  SetupHealthResponderReason,
  makeSetupHealthFinding,
} from "../../../Types/SetupHealth/SetupHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * The Welcome checklist's rules (issue #6803): which steps each goal brings
 * and in which order, when each step is done - on outcomes, never on a row
 * existing - what the plan holds back, which step is next, when the project
 * is finished, and when Home asks what the project came to do.
 */

const NOTHING: WelcomeOutcomeFacts = {
  reached: [],
  hasPolicyThatPagesSomeone: false,
  hasFinishedImport: false,
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

  test("every goal at once is every step, with the team last", () => {
    expect(getStepsForGoals([...PROJECT_GOALS])).toEqual([
      ...WELCOME_STEP_ORDER,
    ]);
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
    expect(order[0]).toBe(WelcomeStep.Import);
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

  test("who is told: until then, a rule or a monitor that runs a policy with someone reachable ticks it (#7017)", () => {
    expect(
      isWelcomeStepDone(
        WelcomeStep.OnCall,
        facts({ hasPolicyThatPagesSomeone: true }),
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
        done: isWelcomeStepDone(step, facts({ reached: others })),
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
    });

    expect(stateOf(checklist, WelcomeStep.Team).needsPlan).toBeNull();
    expect(stateOf(checklist, WelcomeStep.Team).isDone).toBe(true);
  });

  /*
   * The server's setup is no step (#7018): its master admins see the Server
   * setup card above the checklist, so Home asks for the server's email
   * once. Whoever reads it, the checklist holds the project's steps only.
   */
  test("the server's email is never a step, whoever reads it", () => {
    expect(isWelcomeStep("server_email")).toBe(false);
    expect(WELCOME_STEP_ORDER as ReadonlyArray<string>).not.toContain(
      "server_email",
    );

    for (const goals of [null, [], [ProjectGoal.Telemetry]]) {
      expect(
        (
          stepsOf(
            buildWelcomeChecklist({
              goals: goals,
              facts: NOTHING,
              plan: { isFreePlan: false },
            }),
          ) as ReadonlyArray<string>
        ).includes("server_email"),
      ).toBe(false);
    }
  });

  test("every step of the project's done finishes it, with nothing of the server's held over", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Telemetry],
      facts: facts({
        reached: [ActivationMilestone.FirstTracesReceived],
      }),
      plan: { isFreePlan: false },
    });

    expect(stepsOf(checklist)).toEqual([WelcomeStep.Telemetry]);
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
      }).isProjectFinished,
    ).toBe(true);

    expect(
      buildWelcomeChecklist({
        goals: [ProjectGoal.Telemetry],
        facts: allDone,
        plan: { isFreePlan: false },
      }).isProjectFinished,
    ).toBe(false);
  });

  test("every goal, alone, on every plan, gives a checklist with one next step and counts that add up", () => {
    for (const goal of PROJECT_GOALS) {
      for (const isFreePlan of [false, true]) {
        const checklist: WelcomeChecklist = buildWelcomeChecklist({
          goals: [goal],
          facts: NOTHING,
          plan: { isFreePlan: isFreePlan },
        });

        const next: Array<WelcomeChecklistStepState> = checklist.steps.filter(
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
        // The rules never say why a step is not done: the server reads that.
        expect(
          checklist.steps.every((state: WelcomeChecklistStepState): boolean => {
            return state.gap === null;
          }),
        ).toBe(true);
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
    });
    const withNothingOff: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Infrastructure],
      facts: NOTHING,
      plan: { isFreePlan: false },
      offProducts: [],
    });

    expect(withNothingOff).toEqual(without);
  });

  test("a goal whose product is off keeps its other steps", () => {
    expect(
      stepsOf(
        buildWelcomeChecklist({
          goals: [ProjectGoal.StatusPage],
          facts: NOTHING,
          plan: { isFreePlan: false },
          offProducts: [ProductKey.StatusPages],
        }),
      ),
    ).toEqual([WelcomeStep.Monitor]);
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

/*
 * About how long each step takes (issue #8897): said beside each step of
 * the quickstart, added up for what is left, and added up for the plan a
 * choice of goals brings, before it is sent.
 */
describe("about how long it takes", () => {
  test("every step says how many minutes, a whole number of at least one", () => {
    expect(Object.keys(WELCOME_STEP_MINUTES).sort()).toEqual(
      [...WELCOME_STEP_ORDER].sort(),
    );

    for (const step of WELCOME_STEP_ORDER) {
      const minutes: number = WELCOME_STEP_MINUTES[step];

      expect({ step, whole: Number.isInteger(minutes) }).toEqual({
        step,
        whole: true,
      });
      expect({ step, atLeastOne: minutes >= 1 }).toEqual({
        step,
        atLeastOne: true,
      });
    }
  });

  test("a guided setup's step takes a few minutes, never an hour", () => {
    for (const step of WELCOME_STEP_ORDER) {
      expect({ step, short: WELCOME_STEP_MINUTES[step] <= 15 }).toEqual({
        step,
        short: true,
      });
    }
  });

  test("the four steps every project gets add up to a quarter of an hour at most, as the Quickstart guide says", () => {
    expect(getWelcomeStepsMinutes(DEFAULT_WELCOME_STEPS)).toBeLessThanOrEqual(
      15,
    );
    expect(getWelcomeStepsMinutes([])).toBe(0);
    expect(
      getWelcomeStepsMinutes([WelcomeStep.Monitor, WelcomeStep.StatusPage]),
    ).toBe(
      WELCOME_STEP_MINUTES[WelcomeStep.Monitor] +
        WELCOME_STEP_MINUTES[WelcomeStep.StatusPage],
    );
  });

  test("what is left counts the steps not done that the plan allows", () => {
    const steps: Array<WelcomeChecklistStepState> = [
      {
        step: WelcomeStep.Monitor,
        isDone: true,
        needsPlan: null,
        isNext: false,
        gap: null,
      },
      {
        step: WelcomeStep.OnCall,
        isDone: false,
        needsPlan: null,
        isNext: true,
        gap: null,
      },
      {
        step: WelcomeStep.StatusPage,
        isDone: false,
        needsPlan: null,
        isNext: false,
        gap: null,
      },
      {
        step: WelcomeStep.Team,
        isDone: false,
        needsPlan: PlanType.Growth,
        isNext: false,
        gap: null,
      },
    ];

    expect(getWelcomeMinutesLeft(steps)).toBe(
      WELCOME_STEP_MINUTES[WelcomeStep.OnCall] +
        WELCOME_STEP_MINUTES[WelcomeStep.StatusPage],
    );
    expect(
      getWelcomeMinutesLeft(
        steps.map((state: WelcomeChecklistStepState) => {
          return { ...state, isDone: true, needsPlan: null };
        }),
      ),
    ).toBe(0);
  });

  test("a checklist built for goals has as many minutes left as its steps take, until one is done", () => {
    const checklist: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Uptime, ProjectGoal.StatusPage],
      facts: NOTHING,
      plan: { isFreePlan: false },
    });

    expect(getWelcomeMinutesLeft(checklist.steps)).toBe(
      getWelcomeStepsMinutes(stepsOf(checklist)),
    );

    const afterMonitor: WelcomeChecklist = buildWelcomeChecklist({
      goals: [ProjectGoal.Uptime, ProjectGoal.StatusPage],
      facts: facts({
        reached: [ActivationMilestone.FirstCheckResultReceived],
      }),
      plan: { isFreePlan: false },
    });

    expect(getWelcomeMinutesLeft(afterMonitor.steps)).toBe(
      getWelcomeStepsMinutes(stepsOf(checklist)) -
        WELCOME_STEP_MINUTES[WelcomeStep.Monitor],
    );
  });
});

describe("the plan a choice of goals brings, before it is sent", () => {
  test("nothing chosen is no plan: never the four steps a skip gives", () => {
    expect(getPlanStepsForGoals([])).toEqual([]);
  });

  test("the goals' steps, each once, in the checklist's order", () => {
    expect(
      getPlanStepsForGoals([ProjectGoal.StatusPage, ProjectGoal.Uptime]),
    ).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
    ]);
    expect(getPlanStepsForGoals([ProjectGoal.OnCall])).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.Team,
    ]);
  });

  test("is the steps the server builds for the same goals", () => {
    for (const goal of PROJECT_GOALS) {
      const checklist: WelcomeChecklist = buildWelcomeChecklist({
        goals: [goal],
        facts: NOTHING,
        plan: { isFreePlan: false },
      });

      expect({ goal, steps: getPlanStepsForGoals([goal]) }).toEqual({
        goal,
        steps: stepsOf(checklist),
      });
    }
  });

  test("leaves out a step of a product switched off on the server, as the server does", () => {
    const off: Array<ProductKey> = [ProductKey.StatusPages];

    expect(
      getPlanStepsForGoals([ProjectGoal.Uptime, ProjectGoal.StatusPage], off),
    ).toEqual(
      stepsOf(
        buildWelcomeChecklist({
          goals: [ProjectGoal.Uptime, ProjectGoal.StatusPage],
          facts: NOTHING,
          plan: { isFreePlan: false },
          offProducts: off,
        }),
      ),
    );
    expect(getPlanStepsForGoals([ProjectGoal.StatusPage], off)).not.toContain(
      WelcomeStep.StatusPage,
    );
  });

  test("never names the server's email: it is no step at all (#7018)", () => {
    for (const goal of PROJECT_GOALS) {
      expect(
        getPlanStepsForGoals([goal]) as ReadonlyArray<string>,
      ).not.toContain("server_email");
    }
  });
});

/*
 * WHAT ELSE TO SET UP, ONCE THE GOALS' STEPS ARE DONE (#7986). A project
 * that came for its website - a monitor and who is told - finished its
 * checklist after the website setup, and Home never offered it a status
 * page or its team. Once finished, the core steps no goal brought are
 * offered, each until it works.
 */
describe("what else to set up, once the goals' steps are done", () => {
  test.each([
    [
      "the website",
      [ProjectGoal.Uptime],
      [WelcomeStep.StatusPage, WelcomeStep.Team],
    ],
    ["paging", [ProjectGoal.OnCall], [WelcomeStep.StatusPage]],
    [
      "a status page",
      [ProjectGoal.StatusPage],
      [WelcomeStep.OnCall, WelcomeStep.Team],
    ],
    ["telemetry", [ProjectGoal.Telemetry], [...DEFAULT_WELCOME_STEPS]],
    ["servers", [ProjectGoal.Infrastructure], [...DEFAULT_WELCOME_STEPS]],
    [
      "importing",
      [ProjectGoal.Import],
      [WelcomeStep.Monitor, WelcomeStep.StatusPage, WelcomeStep.Team],
    ],
    [
      "just looking around",
      [ProjectGoal.Explore],
      [WelcomeStep.OnCall, WelcomeStep.StatusPage, WelcomeStep.Team],
    ],
    [
      "the website and a status page",
      [ProjectGoal.Uptime, ProjectGoal.StatusPage],
      [WelcomeStep.Team],
    ],
    ["every goal", [...PROJECT_GOALS], []],
  ])(
    "a project that came for %s is offered the core steps its goals did not bring",
    (
      _name: string,
      goals: Array<ProjectGoal>,
      expected: Array<WelcomeStep>,
    ) => {
      expect(getWelcomeMoreSteps({ goals: goals })).toEqual(expected);
    },
  );

  test("a project that never chose goals, or skipped them, had the four already: nothing more", () => {
    expect(getWelcomeMoreSteps({ goals: null })).toEqual([]);
    expect(getWelcomeMoreSteps({ goals: [] })).toEqual([]);
  });

  test("they are only ever the core steps, in the checklist's order", () => {
    for (const goal of PROJECT_GOALS) {
      const more: Array<WelcomeStep> = getWelcomeMoreSteps({ goals: [goal] });

      for (const step of more) {
        expect(DEFAULT_WELCOME_STEPS).toContain(step);
        expect(getStepsForGoals([goal])).not.toContain(step);
      }

      expect(more).toEqual(
        WELCOME_STEP_ORDER.filter((step: WelcomeStep): boolean => {
          return more.includes(step);
        }),
      );
    }
  });

  test("a step whose product is off on the server is never offered", () => {
    expect(
      getWelcomeMoreSteps({
        goals: [ProjectGoal.Uptime],
        offProducts: [ProductKey.StatusPages],
      }),
    ).toEqual([WelcomeStep.Team]);
    expect(
      getWelcomeMoreSteps({
        goals: [ProjectGoal.Telemetry],
        offProducts: [ProductKey.OnCall, ProductKey.Monitors],
      }),
    ).toEqual([WelcomeStep.StatusPage, WelcomeStep.Team]);
  });

  test("a step that already works is not offered; one left is, never as next", () => {
    const more: Array<WelcomeChecklistStepState> = buildWelcomeMoreSteps({
      goals: [ProjectGoal.Uptime],
      facts: facts({ reached: [ActivationMilestone.SecondMemberJoined] }),
      plan: { isFreePlan: false },
    });

    expect(more).toEqual([
      {
        step: WelcomeStep.StatusPage,
        isDone: false,
        needsPlan: null,
        isNext: false,
        gap: null,
      },
    ]);
  });

  test("every core step done: nothing is left to offer", () => {
    expect(
      buildWelcomeMoreSteps({
        goals: [ProjectGoal.Telemetry],
        facts: facts({
          reached: [
            ActivationMilestone.FirstCheckResultReceived,
            ActivationMilestone.FirstTestPageAcknowledged,
            ActivationMilestone.FirstStatusPageMonitorAdded,
            ActivationMilestone.SecondMemberJoined,
          ],
        }),
        plan: { isFreePlan: false },
      }),
    ).toEqual([]);
  });

  test("who is told is offered until a policy that reaches someone runs, as on the checklist (#7017)", () => {
    const offered: (
      hasPolicyThatPagesSomeone: boolean,
    ) => Array<WelcomeStep> = (
      hasPolicyThatPagesSomeone: boolean,
    ): Array<WelcomeStep> => {
      return buildWelcomeMoreSteps({
        goals: [ProjectGoal.StatusPage],
        facts: facts({
          hasPolicyThatPagesSomeone: hasPolicyThatPagesSomeone,
        }),
        plan: { isFreePlan: false },
      }).map((state: WelcomeChecklistStepState): WelcomeStep => {
        return state.step;
      });
    };

    expect(offered(false)).toEqual([WelcomeStep.OnCall, WelcomeStep.Team]);
    expect(offered(true)).toEqual([WelcomeStep.Team]);
  });

  test("on the Free plan, inviting the team says which plan it needs, as on the checklist", () => {
    const team: WelcomeChecklistStepState | undefined = buildWelcomeMoreSteps({
      goals: [ProjectGoal.Uptime],
      facts: NOTHING,
      plan: { isFreePlan: true },
    }).find((state: WelcomeChecklistStepState): boolean => {
      return state.step === WelcomeStep.Team;
    });

    expect(team?.needsPlan).toBe(PlanType.Growth);
    expect(team?.isNext).toBe(false);
  });
});

/*
 * WHY A STEP WHOSE RECORD EXISTS IS NOT DONE YET (#6938): Setup health's
 * finding about its record, the first of the step's checks that has one.
 */
describe("why a step is not done although its record exists", () => {
  const finding: (data: {
    check: SetupHealthCheck;
    words: string;
    record: { kind: SetupHealthRecordKind; id: string; name: string };
    fix: SetupHealthFix;
    reason?: string | undefined;
  }) => SetupHealthFinding = (data: {
    check: SetupHealthCheck;
    words: string;
    record: { kind: SetupHealthRecordKind; id: string; name: string };
    fix: SetupHealthFix;
    reason?: string | undefined;
  }): SetupHealthFinding => {
    return makeSetupHealthFinding({
      check: data.check,
      level: SetupHealthLevel.WorthFixing,
      record: data.record,
      fix: data.fix,
      fixRecordId: data.record.id,
      words: data.words,
      values: { name: data.record.name },
      reason: data.reason,
    });
  };

  const EMPTY_PAGE: SetupHealthFinding = finding({
    check: SetupHealthCheck.StatusPageShowsNoMonitor,
    words: SETUP_HEALTH_WORDS.statusPageShowsNoMonitor,
    record: {
      kind: SetupHealthRecordKind.StatusPage,
      id: "status-page-1",
      name: "Acme status",
    },
    fix: SetupHealthFix.StatusPageResources,
  });

  const NOT_RUN: SetupHealthFinding = finding({
    check: SetupHealthCheck.PolicyNotRun,
    words: SETUP_HEALTH_WORDS.policyNotRun,
    record: {
      kind: SetupHealthRecordKind.OnCallDutyPolicy,
      id: "policy-1",
      name: "Primary",
    },
    fix: SetupHealthFix.IncidentOnCallRules,
  });

  const UNREACHABLE: SetupHealthFinding = finding({
    check: SetupHealthCheck.ResponderCannotBePaged,
    words:
      SETUP_HEALTH_WORDS.responderCannotBePaged[
        SetupHealthResponderReason.NoVerifiedMethod
      ],
    record: { kind: SetupHealthRecordKind.User, id: "user-1", name: "Ada" },
    fix: SetupHealthFix.OnCallReadiness,
    reason: SetupHealthResponderReason.NoVerifiedMethod,
  });

  const NO_PROBE: SetupHealthFinding = finding({
    check: SetupHealthCheck.MonitorNotChecked,
    words: "{{monitor}} is not checked: it has no probe.",
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: "monitor-1",
      name: "Storefront",
    },
    fix: SetupHealthFix.MonitorProbes,
  });

  test("a status page that shows no monitor names the status page's break", () => {
    expect(
      getWelcomeStepGapFromFindings(WelcomeStep.StatusPage, [
        NOT_RUN,
        EMPTY_PAGE,
      ]),
    ).toEqual({
      check: SetupHealthCheck.StatusPageShowsNoMonitor,
      finding: EMPTY_PAGE,
    });
  });

  test("a monitor no probe checks names the monitor's", () => {
    expect(
      getWelcomeStepGapFromFindings(WelcomeStep.Monitor, [NO_PROBE])?.finding,
    ).toBe(NO_PROBE);
  });

  test("who is told says what runs the policy before whom it reaches", () => {
    expect(
      getWelcomeStepGapFromFindings(WelcomeStep.OnCall, [UNREACHABLE, NOT_RUN])
        ?.check,
    ).toBe(SetupHealthCheck.PolicyNotRun);
    expect(
      getWelcomeStepGapFromFindings(WelcomeStep.OnCall, [UNREACHABLE])?.check,
    ).toBe(SetupHealthCheck.ResponderCannotBePaged);
  });

  test("another step's finding is never a step's gap", () => {
    expect(
      getWelcomeStepGapFromFindings(WelcomeStep.Monitor, [
        EMPTY_PAGE,
        NOT_RUN,
        UNREACHABLE,
      ]),
    ).toBeNull();
    expect(
      getWelcomeStepGapFromFindings(WelcomeStep.StatusPage, [NO_PROBE]),
    ).toBeNull();
  });

  test("nothing found: no gap", () => {
    for (const step of WELCOME_STEP_ORDER) {
      expect(getWelcomeStepGapFromFindings(step, [])).toBeNull();
    }
  });

  test("only the steps whose record Setup health looks at have checks", () => {
    expect(
      WELCOME_STEP_ORDER.filter((step: WelcomeStep): boolean => {
        return hasWelcomeStepGapChecks(step);
      }),
    ).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
    ]);

    // Each check is one step's, never two steps'.
    const seen: Array<SetupHealthCheck> = [];

    for (const step of WELCOME_STEP_ORDER) {
      for (const check of WELCOME_STEP_GAP_CHECKS[step]) {
        expect(seen).not.toContain(check);
        seen.push(check);
      }
    }
  });
});

/*
 * PAGED BY MORE THAN EMAIL (#9442): a verified phone number or push device.
 */
describe("whether a phone or the app can page the person", () => {
  test.each([
    ["a verified SMS number", "SMS", true, true],
    ["a verified call number", "Call", true, true],
    ["a verified WhatsApp number", "WhatsApp", true, true],
    ["a push device: the app or a browser", "Push", true, true],
    ["an SMS number not verified yet", "SMS", false, false],
    ["email alone", "Email", true, false],
    ["a Slack message", "Slack", true, false],
    ["a webhook", "Webhook", true, false],
  ])(
    "%s",
    (
      _name: string,
      methodType: string,
      isVerified: boolean,
      expected: boolean,
    ) => {
      expect(
        canPageByPhoneOrApp([
          { methodType: "Email", isVerified: true },
          { methodType: methodType, isVerified: isVerified },
        ]),
      ).toBe(expected);
    },
  );

  test("nothing verified at all: no", () => {
    expect(canPageByPhoneOrApp([])).toBe(false);
  });

  test("the method types are Readiness's own words", () => {
    expect([...PHONE_OR_APP_METHOD_TYPES]).toEqual([
      "SMS",
      "Call",
      "WhatsApp",
      "Push",
    ]);
  });
});
