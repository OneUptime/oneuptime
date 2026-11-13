import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ProjectGoal, {
  GOALS_EVENT_VALUE_MAX_LENGTH,
  PROJECT_GOALS,
  isProjectGoal,
  parseProjectGoals,
  toGoalsEventValue,
} from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeAudience,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
  WELCOME_CHECKLIST_GOALS_ROUTE,
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
  parseWelcomeChecklistAnswer,
  toWelcomeChecklistAnswerJSON,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import {
  MAX_HIDDEN_FOR_USER_IDS,
  WelcomeChecklistFinishedBy,
  WelcomeChecklistState,
  getNewProjectWelcomeChecklistState,
  hasAcknowledgedTestPage,
  isWelcomeChecklistFinished,
  isWelcomeChecklistHiddenFor,
  needsLegacyCheck,
  parseWelcomeChecklistState,
  toWelcomeChecklistStateJSON,
  withTestPageAcknowledgedBy,
  withWelcomeChecklistFinished,
  withWelcomeChecklistHiddenFor,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistState";
import {
  PRODUCT_EVENT_TOKEN_MAX_LENGTH,
  ProductEventName,
  toProductEventProperties,
} from "../../../Types/Analytics/ProductEvent";
import { describe, expect, test } from "@jest/globals";

/*
 * What is kept and sent for the Welcome checklist (issue #6803): the goals
 * on Project.goals, the checklist's state on Project.welcomeChecklistState,
 * and the answer Home reads - each read defensively, so a value written by
 * hand, by an older version or by a newer one reads as what it safely can.
 */

const USER_A: string = "11111111-1111-4111-8111-111111111111";
const USER_B: string = "22222222-2222-4222-8222-222222222222";

describe("the goals a project chose", () => {
  test("are seven, each a value the question offers", () => {
    expect(PROJECT_GOALS).toEqual([
      "uptime",
      "on_call",
      "status_page",
      "telemetry",
      "infrastructure",
      "import",
      "explore",
    ]);

    for (const goal of PROJECT_GOALS) {
      expect(isProjectGoal(goal)).toBe(true);
    }

    expect(isProjectGoal("website")).toBe(false);
    expect(isProjectGoal(1)).toBe(false);
  });

  test("never answered is null; skipped is an empty list", () => {
    expect(parseProjectGoals(null)).toBeNull();
    expect(parseProjectGoals(undefined)).toBeNull();
    expect(parseProjectGoals("uptime")).toBeNull();
    expect(parseProjectGoals({ goals: ["uptime"] })).toBeNull();
    expect(parseProjectGoals([])).toEqual([]);
  });

  test("are read each once, in the question's order, leaving out what is not a goal", () => {
    expect(
      parseProjectGoals([
        "explore",
        "uptime",
        "nonsense",
        "uptime",
        42,
        "status_page",
      ]),
    ).toEqual([
      ProjectGoal.Uptime,
      ProjectGoal.StatusPage,
      ProjectGoal.Explore,
    ]);
  });

  test("travel to analytics joined by a dot, in order, all seven whole", () => {
    expect(
      toGoalsEventValue([ProjectGoal.StatusPage, ProjectGoal.Uptime]),
    ).toBe("uptime.status_page");
    expect(toGoalsEventValue([])).toBe("");
    expect(toGoalsEventValue(null)).toBe("");

    const all: string = toGoalsEventValue([...PROJECT_GOALS]);

    expect(all.length).toBe(GOALS_EVENT_VALUE_MAX_LENGTH);
    expect(all.length).toBeGreaterThan(PRODUCT_EVENT_TOKEN_MAX_LENGTH);

    // And survive the catalog's token rule whole, past the usual cut.
    expect(
      toProductEventProperties({
        name: ProductEventName.GoalsChosen,
        properties: { goals: all, goal_count: 7, is_change: false },
        isCloud: false,
      }),
    ).toEqual({ goals: all, goal_count: 7, is_change: false });
  });

  test("every checklist event carries the goals, and nothing it does not list", () => {
    for (const name of [
      ProductEventName.ChecklistStepStarted,
      ProductEventName.ChecklistStepCompleted,
      ProductEventName.ChecklistFinished,
      ProductEventName.ChecklistDismissed,
    ]) {
      expect(
        toProductEventProperties({
          name: name,
          properties: { goals: "uptime", project_name: "Acme" },
          isCloud: true,
        }),
      ).toEqual({ goals: "uptime" });
    }
  });
});

describe("the checklist's state", () => {
  test("reads nothing from what is not an object", () => {
    expect(parseWelcomeChecklistState(null)).toEqual({});
    expect(parseWelcomeChecklistState("finished")).toEqual({});
    expect(parseWelcomeChecklistState([USER_A])).toEqual({});
  });

  test("reads what makes sense, and nothing else", () => {
    expect(
      parseWelcomeChecklistState({
        startedWithOutcomes: true,
        legacyCheckedAt: "2026-11-11T10:00:00.000Z",
        goalsChosenAt: "2026-11-11T10:01:00.000Z",
        goalsChosenByUserId: USER_A,
        finishedAt: "2026-11-12T10:00:00.000Z",
        finishedBy: "legacy",
        hiddenForUserIds: [USER_A.toUpperCase(), USER_A, 7, "", USER_B],
        somethingElse: "dropped",
      }),
    ).toEqual({
      startedWithOutcomes: true,
      legacyCheckedAt: "2026-11-11T10:00:00.000Z",
      goalsChosenAt: "2026-11-11T10:01:00.000Z",
      goalsChosenByUserId: USER_A,
      finishedAt: "2026-11-12T10:00:00.000Z",
      finishedBy: WelcomeChecklistFinishedBy.Legacy,
      hiddenForUserIds: [USER_A, USER_B],
    });
  });

  test("a finish with no reason it knows reads as finished on outcomes", () => {
    expect(
      parseWelcomeChecklistState({
        finishedAt: "2026-11-12T10:00:00.000Z",
        finishedBy: "magic",
      }).finishedBy,
    ).toBe(WelcomeChecklistFinishedBy.Outcomes);
  });

  test("a project created now needs no legacy check; one from before does, once", () => {
    expect(needsLegacyCheck(getNewProjectWelcomeChecklistState())).toBe(false);
    expect(needsLegacyCheck(parseWelcomeChecklistState(null))).toBe(true);
    expect(
      needsLegacyCheck({ legacyCheckedAt: "2026-11-11T10:00:00.000Z" }),
    ).toBe(false);
    // Hiding before anyone looked does not count as looking.
    expect(needsLegacyCheck({ hiddenForUserIds: [USER_A] })).toBe(true);
  });

  test("hides for one member and shows again, never for anyone else", () => {
    let state: WelcomeChecklistState = {};

    state = withWelcomeChecklistHiddenFor(state, USER_A, true);

    expect(isWelcomeChecklistHiddenFor(state, USER_A)).toBe(true);
    expect(isWelcomeChecklistHiddenFor(state, USER_A.toUpperCase())).toBe(true);
    expect(isWelcomeChecklistHiddenFor(state, USER_B)).toBe(false);
    expect(isWelcomeChecklistHiddenFor(state, null)).toBe(false);

    // Twice is once.
    state = withWelcomeChecklistHiddenFor(state, USER_A, true);
    expect(state.hiddenForUserIds).toEqual([USER_A]);

    state = withWelcomeChecklistHiddenFor(state, USER_B, true);
    state = withWelcomeChecklistHiddenFor(state, USER_A, false);

    expect(isWelcomeChecklistHiddenFor(state, USER_A)).toBe(false);
    expect(isWelcomeChecklistHiddenFor(state, USER_B)).toBe(true);

    state = withWelcomeChecklistHiddenFor(state, USER_B, false);
    expect(state.hiddenForUserIds).toBeUndefined();
  });

  test("keeps at most MAX_HIDDEN_FOR_USER_IDS members, letting the oldest go", () => {
    let state: WelcomeChecklistState = {};

    for (let index: number = 0; index <= MAX_HIDDEN_FOR_USER_IDS; index++) {
      state = withWelcomeChecklistHiddenFor(state, `user-${index}`, true);
    }

    expect(state.hiddenForUserIds).toHaveLength(MAX_HIDDEN_FOR_USER_IDS);
    expect(isWelcomeChecklistHiddenFor(state, "user-0")).toBe(false);
    expect(
      isWelcomeChecklistHiddenFor(state, `user-${MAX_HIDDEN_FOR_USER_IDS}`),
    ).toBe(true);
  });

  test("notes each member who acknowledged a test page, once (#6807)", () => {
    let state: WelcomeChecklistState = {};

    expect(hasAcknowledgedTestPage(state, USER_A)).toBe(false);

    state = withTestPageAcknowledgedBy(state, USER_A.toUpperCase());

    expect(hasAcknowledgedTestPage(state, USER_A)).toBe(true);
    expect(hasAcknowledgedTestPage(state, USER_B)).toBe(false);
    expect(hasAcknowledgedTestPage(state, null)).toBe(false);
    expect(state.testPageAcknowledgedByUserIds).toEqual([USER_A]);

    // Twice is once, and the same state, so the server skips the write.
    expect(withTestPageAcknowledgedBy(state, USER_A)).toBe(state);

    state = withTestPageAcknowledgedBy(state, USER_B);
    expect(state.testPageAcknowledgedByUserIds).toEqual([USER_A, USER_B]);
    // Hiding is another list: noting a test page hides nothing.
    expect(isWelcomeChecklistHiddenFor(state, USER_A)).toBe(false);
  });

  test("reads the members who acknowledged a test page as it reads who hid it", () => {
    expect(
      parseWelcomeChecklistState({
        testPageAcknowledgedByUserIds: [
          USER_A,
          USER_A.toUpperCase(),
          7,
          "",
          USER_B,
        ],
      }).testPageAcknowledgedByUserIds,
    ).toEqual([USER_A, USER_B]);
    expect(
      parseWelcomeChecklistState({ testPageAcknowledgedByUserIds: [] })
        .testPageAcknowledgedByUserIds,
    ).toBeUndefined();
    expect(
      parseWelcomeChecklistState({ testPageAcknowledgedByUserIds: USER_A })
        .testPageAcknowledgedByUserIds,
    ).toBeUndefined();

    let state: WelcomeChecklistState = {};

    for (let index: number = 0; index <= MAX_HIDDEN_FOR_USER_IDS; index++) {
      state = withTestPageAcknowledgedBy(state, `user-${index}`);
    }

    expect(state.testPageAcknowledgedByUserIds).toHaveLength(
      MAX_HIDDEN_FOR_USER_IDS,
    );
    expect(hasAcknowledgedTestPage(state, "user-0")).toBe(false);
  });

  test("finishes once, keeping the first reason and time", () => {
    const first: WelcomeChecklistState = withWelcomeChecklistFinished(
      {},
      WelcomeChecklistFinishedBy.Legacy,
      new Date("2026-11-11T10:00:00.000Z"),
    );

    expect(isWelcomeChecklistFinished(first)).toBe(true);
    expect(first.finishedAt).toBe("2026-11-11T10:00:00.000Z");

    const again: WelcomeChecklistState = withWelcomeChecklistFinished(
      first,
      WelcomeChecklistFinishedBy.Outcomes,
      new Date("2026-11-12T10:00:00.000Z"),
    );

    expect(again).toEqual(first);
    expect(isWelcomeChecklistFinished({})).toBe(false);
  });

  test("is stored as it reads, without undefined keys", () => {
    const json: unknown = toWelcomeChecklistStateJSON({
      startedWithOutcomes: true,
      hiddenForUserIds: [USER_A],
      testPageAcknowledgedByUserIds: [USER_B],
      finishedAt: undefined,
    });

    expect(json).toEqual({
      startedWithOutcomes: true,
      hiddenForUserIds: [USER_A],
      testPageAcknowledgedByUserIds: [USER_B],
    });
    expect(
      parseWelcomeChecklistState(JSON.parse(JSON.stringify(json))),
    ).toEqual(json);
  });
});

describe("the answer Home reads", () => {
  const ANSWER: WelcomeChecklistAnswer = {
    audience: WelcomeAudience.SetUp,
    goals: [ProjectGoal.Uptime, ProjectGoal.OnCall],
    shouldAskForGoals: false,
    canChooseGoals: true,
    isHiddenForMe: false,
    isFinished: false,
    canSendEmail: true,
    hasAcknowledgedTestPage: true,
    // A sample project may be explored from the card (#6808).
    canExploreSampleProject: true,
    steps: [
      {
        step: WelcomeStep.Monitor,
        isDone: true,
        needsPlan: null,
        isNext: false,
      },
      {
        step: WelcomeStep.OnCall,
        isDone: false,
        needsPlan: null,
        isNext: true,
      },
      {
        step: WelcomeStep.Team,
        isDone: false,
        needsPlan: PlanType.Growth,
        isNext: false,
      },
    ],
    doneCount: 1,
    totalCount: 2,
  };

  test("goes over the wire and back unchanged", () => {
    expect(
      parseWelcomeChecklistAnswer(
        JSON.parse(JSON.stringify(toWelcomeChecklistAnswerJSON(ANSWER))),
      ),
    ).toEqual(ANSWER);
  });

  test("is not one without an audience it knows", () => {
    expect(parseWelcomeChecklistAnswer(null)).toBeNull();
    expect(parseWelcomeChecklistAnswer([])).toBeNull();
    expect(
      parseWelcomeChecklistAnswer({
        ...toWelcomeChecklistAnswerJSON(ANSWER),
        audience: "owner",
      }),
    ).toBeNull();
  });

  test("leaves out steps it does not know, and marks at most one next", () => {
    const parsed: WelcomeChecklistAnswer | null = parseWelcomeChecklistAnswer({
      ...toWelcomeChecklistAnswerJSON(ANSWER),
      steps: [
        { step: "teleport", isDone: false, needsPlan: null, isNext: true },
        { step: "monitor", isDone: false, needsPlan: "Platinum", isNext: true },
        { step: "on_call", isDone: false, needsPlan: null, isNext: true },
        "nonsense",
      ],
      doneCount: -3,
      totalCount: "two",
    });

    expect(parsed?.steps).toEqual([
      {
        step: WelcomeStep.Monitor,
        isDone: false,
        needsPlan: null,
        isNext: true,
      },
      {
        step: WelcomeStep.OnCall,
        isDone: false,
        needsPlan: null,
        isNext: false,
      },
    ]);
    expect(parsed?.doneCount).toBe(0);
    expect(parsed?.totalCount).toBe(0);
  });

  test("reads the goals as the project keeps them, and can send email unless told otherwise", () => {
    const parsed: WelcomeChecklistAnswer | null = parseWelcomeChecklistAnswer({
      audience: "set_up",
      goals: ["explore", "nonsense", "uptime"],
    });

    expect(parsed?.goals).toEqual([ProjectGoal.Uptime, ProjectGoal.Explore]);
    expect(parsed?.canSendEmail).toBe(true);
    expect(parsed?.steps).toEqual([]);
    expect(
      parseWelcomeChecklistAnswer({ audience: "set_up", canSendEmail: false })
        ?.canSendEmail,
    ).toBe(false);
    expect(
      parseWelcomeChecklistAnswer({ audience: "set_up" })?.goals,
    ).toBeNull();
  });

  test("a test page reached the person only when the answer says exactly so", () => {
    expect(
      parseWelcomeChecklistAnswer({ audience: "invited_member" })
        ?.hasAcknowledgedTestPage,
    ).toBe(false);
    expect(
      parseWelcomeChecklistAnswer({
        audience: "invited_member",
        hasAcknowledgedTestPage: "yes",
      })?.hasAcknowledgedTestPage,
    ).toBe(false);
    expect(
      parseWelcomeChecklistAnswer({
        audience: "invited_member",
        hasAcknowledgedTestPage: true,
      })?.hasAcknowledgedTestPage,
    ).toBe(true);
    expect(getEmptyWelcomeChecklistAnswer().hasAcknowledgedTestPage).toBe(
      false,
    );
  });

  test("an empty answer draws nothing", () => {
    const empty: WelcomeChecklistAnswer = getEmptyWelcomeChecklistAnswer();

    expect(empty.steps).toEqual([]);
    expect(empty.shouldAskForGoals).toBe(false);
    expect(empty.audience).toBe(WelcomeAudience.InvitedMember);
  });

  test("its routes are under /welcome-checklist", () => {
    expect([
      WELCOME_CHECKLIST_ROUTE,
      WELCOME_CHECKLIST_GOALS_ROUTE,
      WELCOME_CHECKLIST_HIDE_ROUTE,
      WELCOME_CHECKLIST_SHOW_ROUTE,
      WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
    ]).toEqual([
      "/welcome-checklist",
      "/welcome-checklist/goals",
      "/welcome-checklist/hide",
      "/welcome-checklist/show",
      "/welcome-checklist/browser-state",
    ]);
  });
});
