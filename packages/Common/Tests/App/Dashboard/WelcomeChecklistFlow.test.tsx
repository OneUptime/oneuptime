import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE WELCOME CARD'S FLOW ON HOME (issue #6803), with the real component and
 * the server's answers stood in for:
 *
 *  - "What do you want to do first?" once, for a new project's owner: the
 *    seven goals, several ticked, Continue or Skip; the checklist that
 *    follows; Change to answer again.
 *  - Hide is this person's own: the card goes, a line stays with Show it
 *    and How OneUptime works.
 *  - What a browser remembered of the old checklist goes to the server
 *    first, once.
 *  - The events: home/goals_chosen, home/checklist_dismissed, and the
 *    step-completed and finished events with the goals.
 */

const navigateMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();
const sendMock: MockFunction = getJestMockFunction();
const fetchMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const legacyMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistApi",
  () => {
    return {
      __esModule: true,
      fetchWelcomeChecklist: (...args: Array<unknown>) => {
        return fetchMock(...args);
      },
      postWelcomeChecklist: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      sendLegacyBrowserState: (...args: Array<unknown>) => {
        return legacyMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

import GettingStarted, {
  WelcomeCardView,
  getStepAfter,
  getWelcomeCardView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import {
  WELCOME_GOALS,
  WelcomeGoalEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import ObjectID from "../../../Types/ObjectID";
import ProjectGoal, {
  PROJECT_GOALS,
} from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_GOALS_ROUTE,
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import ChecklistEvents from "../../../UI/Utils/ChecklistEvents";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "65f00000000000000000dddd";

function step(
  key: WelcomeStep,
  extra?: Partial<WelcomeChecklistStepState>,
): WelcomeChecklistStepState {
  return { step: key, isDone: false, needsPlan: null, isNext: false, ...extra };
}

function answer(
  extra?: Partial<WelcomeChecklistAnswer>,
): WelcomeChecklistAnswer {
  const steps: Array<WelcomeChecklistStepState> = extra?.steps || [
    step(WelcomeStep.Monitor, { isNext: true }),
    step(WelcomeStep.OnCall),
    step(WelcomeStep.StatusPage),
    step(WelcomeStep.Team),
  ];

  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: null,
    canChooseGoals: true,
    steps: steps,
    doneCount: steps.filter((state: WelcomeChecklistStepState): boolean => {
      return state.isDone;
    }).length,
    totalCount: steps.length,
    ...extra,
  };
}

const NEW_PROJECT: WelcomeChecklistAnswer = answer({ shouldAskForGoals: true });

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

async function press(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

function goalBox(goal: ProjectGoal): HTMLInputElement {
  return within(screen.getByTestId(`welcome-goal-${goal}`)).getByRole(
    "checkbox",
  ) as HTMLInputElement;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  legacyMock.mockResolvedValue(null);
  fetchMock.mockResolvedValue(NEW_PROJECT);
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      return { isAllowed: true };
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  navigateMock.mockReset();
  captureMock.mockReset();
  sendMock.mockReset();
  fetchMock.mockReset();
  postMock.mockReset();
  legacyMock.mockReset();
});

describe("What do you want to do first?", () => {
  test("asks a new project's owner, with the seven goals in the question's order, and no checklist yet", async () => {
    await renderGettingStarted();

    const question: HTMLElement = screen.getByTestId("welcome-question");

    expect(question).toHaveTextContent("What do you want to do first?");
    expect(
      within(question)
        .getAllByRole("checkbox")
        .map((box: HTMLElement): string => {
          return (
            box.closest("label")?.getAttribute("data-testid") || ""
          ).replace("welcome-goal-", "");
        }),
    ).toEqual([...PROJECT_GOALS]);
    expect(question).toHaveTextContent("Know when my website or API is down");
    expect(question).toHaveTextContent("I am moving from another tool");
    expect(question).toHaveTextContent("Just looking around");
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("every goal the question offers has its words, and they are the catalog's", () => {
    expect(
      WELCOME_GOALS.map((entry: WelcomeGoalEntry): ProjectGoal => {
        return entry.goal;
      }),
    ).toEqual([...PROJECT_GOALS]);
  });

  test("Continue waits for a goal; nothing is sent until then", async () => {
    await renderGettingStarted();

    expect(screen.getByTestId("welcome-question-continue")).toBeDisabled();

    fireEvent.click(goalBox(ProjectGoal.StatusPage));

    expect(screen.getByTestId("welcome-question-continue")).toBeEnabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("several goals can be ticked, and unticked", async () => {
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.Uptime));
    fireEvent.click(goalBox(ProjectGoal.StatusPage));
    fireEvent.click(goalBox(ProjectGoal.Telemetry));
    fireEvent.click(goalBox(ProjectGoal.Telemetry));

    expect(goalBox(ProjectGoal.Uptime).checked).toBe(true);
    expect(goalBox(ProjectGoal.StatusPage).checked).toBe(true);
    expect(goalBox(ProjectGoal.Telemetry).checked).toBe(false);
    expect(
      screen.getByTestId(`welcome-goal-${ProjectGoal.Uptime}`),
    ).toHaveAttribute("data-chosen", "true");
  });

  test("Continue sends the goals, draws the checklist that follows, and records home/goals_chosen", async () => {
    postMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.Uptime, ProjectGoal.StatusPage],
        steps: [
          step(WelcomeStep.Monitor, { isNext: true }),
          step(WelcomeStep.OnCall),
          step(WelcomeStep.StatusPage),
        ],
      }),
    );
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.StatusPage));
    fireEvent.click(goalBox(ProjectGoal.Uptime));
    await press("welcome-question-continue");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_GOALS_ROUTE, {
      goals: [ProjectGoal.StatusPage, ProjectGoal.Uptime],
    });
    expect(screen.queryByTestId("welcome-question")).toBeNull();
    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(
      screen.getByTestId(`welcome-checklist-goal-${ProjectGoal.Uptime}`),
    ).toHaveTextContent("Know when my website or API is down");
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.GoalsChosen, {
      goals: "uptime.status_page",
      goal_count: 2,
      is_change: false,
    });
  });

  test("Skip sends no goals, and the four steps follow", async () => {
    postMock.mockResolvedValue(answer({ goals: [] }));
    await renderGettingStarted();

    await press("welcome-question-skip");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_GOALS_ROUTE, {
      goals: [],
    });
    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(
      screen.getAllByTestId(/^getting-started-task-[a-z_]+$/),
    ).toHaveLength(4);
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.GoalsChosen, {
      goals: "",
      goal_count: 0,
      is_change: false,
    });
  });

  test("an answer that does not save says so, and keeps the question with what was ticked", async () => {
    postMock.mockResolvedValue(null);
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.Explore));
    await press("welcome-question-continue");

    expect(screen.getByTestId("welcome-question-error")).toHaveTextContent(
      "That did not save.",
    );
    expect(goalBox(ProjectGoal.Explore).checked).toBe(true);
    expect(sendMock).not.toHaveBeenCalledWith(
      ProductEventName.GoalsChosen,
      expect.anything(),
    );
  });

  test("somebody who may not answer is never asked", async () => {
    fetchMock.mockResolvedValue(
      answer({ shouldAskForGoals: true, canChooseGoals: false }),
    );
    await renderGettingStarted();

    expect(screen.queryByTestId("welcome-question")).toBeNull();
    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(screen.queryByTestId("welcome-checklist-change-goals")).toBeNull();
  });
});

describe("changing the goals later, from Home", () => {
  const ANSWERED: WelcomeChecklistAnswer = answer({
    goals: [ProjectGoal.Telemetry],
    steps: [step(WelcomeStep.Telemetry, { isNext: true })],
  });

  test("Change opens the question with the goals already chosen, and Cancel goes back", async () => {
    fetchMock.mockResolvedValue(ANSWERED);
    await renderGettingStarted();

    await press("welcome-checklist-change-goals");

    expect(goalBox(ProjectGoal.Telemetry).checked).toBe(true);
    expect(goalBox(ProjectGoal.Uptime).checked).toBe(false);
    expect(screen.getByTestId("welcome-question-continue")).toHaveTextContent(
      "Save",
    );

    await press("welcome-question-cancel");

    expect(screen.queryByTestId("welcome-question")).toBeNull();
    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("Save sends the new goals and records them as a change", async () => {
    fetchMock.mockResolvedValue(ANSWERED);
    postMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.Telemetry, ProjectGoal.Infrastructure],
        steps: [
          step(WelcomeStep.Infrastructure, { isNext: true }),
          step(WelcomeStep.Telemetry),
        ],
      }),
    );
    await renderGettingStarted();

    await press("welcome-checklist-change-goals");
    fireEvent.click(goalBox(ProjectGoal.Infrastructure));
    await press("welcome-question-continue");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_GOALS_ROUTE, {
      goals: [ProjectGoal.Telemetry, ProjectGoal.Infrastructure],
    });
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.GoalsChosen, {
      goals: "telemetry.infrastructure",
      goal_count: 2,
      is_change: true,
    });
    expect(
      screen.getAllByTestId(/^getting-started-task-[a-z_]+$/),
    ).toHaveLength(2);
  });

  test("a project that skipped is offered to choose goals", async () => {
    fetchMock.mockResolvedValue(answer({ goals: [] }));
    await renderGettingStarted();

    expect(
      screen.getByTestId("welcome-checklist-change-goals"),
    ).toHaveTextContent("Choose your goals");
  });
});

describe("hiding the card is this person's own", () => {
  test("Hide sends it, leaves a line with Show it, and records home/checklist_dismissed", async () => {
    fetchMock.mockResolvedValue(answer({ goals: [ProjectGoal.Uptime] }));
    postMock.mockResolvedValue(
      answer({ goals: [ProjectGoal.Uptime], isHiddenForMe: true }),
    );
    await renderGettingStarted();

    await press("getting-started-dismiss");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_HIDE_ROUTE, {});
    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.getByTestId("welcome-checklist-hidden")).toHaveTextContent(
      "You hid the Welcome checklist.",
    );
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.ChecklistDismissed, {
      done_count: 0,
      step_count: 4,
      goals: "uptime",
    });
    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/getting-started-dismissed",
      { projectId: PROJECT_ID },
    );
    // Nothing kept in this browser: the server has it.
    expect(
      window.localStorage.getItem(`getting-started-dismissed-${PROJECT_ID}`),
    ).toBeNull();
  });

  test("How OneUptime works stays one click away after hiding", async () => {
    fetchMock.mockResolvedValue(answer({ isHiddenForMe: true }));
    await renderGettingStarted();

    expect(screen.queryByTestId("how-oneuptime-works")).toBeNull();

    await press("welcome-checklist-how-it-works");

    expect(screen.getByTestId("how-oneuptime-works")).toBeInTheDocument();

    await press("welcome-checklist-how-it-works");

    expect(screen.queryByTestId("how-oneuptime-works")).toBeNull();
  });

  test("Show it brings the checklist back", async () => {
    fetchMock.mockResolvedValue(answer({ isHiddenForMe: true }));
    postMock.mockResolvedValue(answer());
    await renderGettingStarted();

    await press("welcome-checklist-show");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_SHOW_ROUTE, {});
    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
  });

  test("a hide that does not save says so, and keeps the checklist", async () => {
    fetchMock.mockResolvedValue(answer());
    postMock.mockResolvedValue(null);
    await renderGettingStarted();

    await press("getting-started-dismiss");

    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("That did not save.");
  });
});

describe("what this browser remembered of the old checklist", () => {
  test("goes to the server first, and its answer is the card: nothing else is read", async () => {
    legacyMock.mockResolvedValue(answer({ isHiddenForMe: true }));
    await renderGettingStarted();

    expect(legacyMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("welcome-checklist-hidden")).toBeInTheDocument();
  });

  test("with nothing remembered, the card is read", async () => {
    await renderGettingStarted();

    expect(legacyMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the events of a step seen done", () => {
  test("carry the goals, and leave out the server's email and steps the plan holds back", async () => {
    const note: SpyInstance<typeof ChecklistEvents.noteProgress> = jest.spyOn(
      ChecklistEvents,
      "noteProgress",
    );

    fetchMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.OnCall],
        steps: [
          step(WelcomeStep.ServerEmail, { isNext: true }),
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.OnCall),
          step(WelcomeStep.Team, { needsPlan: "Growth" as never }),
        ],
      }),
    );
    await renderGettingStarted();

    expect(note).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      current: { monitor: true, on_call: false },
      stepKeys: ["monitor", "on_call"],
      goals: "on_call",
    });
  });

  test("the answer that finishes the checklist still notes it, so home/checklist_finished is sent once", async () => {
    window.localStorage.setItem(
      ChecklistEvents.getSeenKey(PROJECT_ID),
      JSON.stringify({ monitor: true, on_call: false }),
    );
    fetchMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.Uptime],
        isFinished: true,
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.OnCall, { isDone: true }),
        ],
      }),
    );
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.ChecklistStepCompleted,
      { step: "on_call", goals: "uptime" },
    );
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.ChecklistFinished, {
      step_count: 2,
      goals: "uptime",
    });
  });

  test("an invited member's answer notes nothing", async () => {
    const note: SpyInstance<typeof ChecklistEvents.noteProgress> = jest.spyOn(
      ChecklistEvents,
      "noteProgress",
    );

    fetchMock.mockResolvedValue(
      answer({ audience: WelcomeAudience.InvitedMember, steps: [] }),
    );
    await renderGettingStarted();

    expect(note).not.toHaveBeenCalled();
  });
});

describe("what the card draws", () => {
  test.each([
    ["nothing read", null, false, WelcomeCardView.None],
    [
      "an invited member",
      answer({ audience: WelcomeAudience.InvitedMember }),
      false,
      WelcomeCardView.InvitedMember,
    ],
    ["finished", answer({ isFinished: true }), false, WelcomeCardView.None],
    [
      "a new project",
      answer({ shouldAskForGoals: true }),
      false,
      WelcomeCardView.Question,
    ],
    ["changing the goals", answer(), true, WelcomeCardView.Question],
    [
      "changing, by someone who may not",
      answer({ canChooseGoals: false }),
      true,
      WelcomeCardView.Checklist,
    ],
    ["hidden", answer({ isHiddenForMe: true }), false, WelcomeCardView.Hidden],
    ["no steps", answer({ steps: [] }), false, WelcomeCardView.None],
    ["steps to do", answer(), false, WelcomeCardView.Checklist],
  ])(
    "%s",
    (
      _name: string,
      value: WelcomeChecklistAnswer | null,
      isChangingGoals: boolean,
      view: WelcomeCardView,
    ) => {
      expect(
        getWelcomeCardView({ answer: value, isChangingGoals: isChangingGoals }),
      ).toBe(view);
    },
  );

  test("the step after one is the next left to do that the plan allows", () => {
    const steps: Array<WelcomeChecklistStepState> = [
      step(WelcomeStep.Monitor),
      step(WelcomeStep.OnCall, { isDone: true }),
      step(WelcomeStep.StatusPage),
      step(WelcomeStep.Team, { needsPlan: "Growth" as never }),
    ];

    expect(getStepAfter(steps, WelcomeStep.Monitor)).toBe(
      WelcomeStep.StatusPage,
    );
    expect(getStepAfter(steps, WelcomeStep.StatusPage)).toBe(
      WelcomeStep.Monitor,
    );
    expect(
      getStepAfter([step(WelcomeStep.Monitor)], WelcomeStep.Monitor),
    ).toBeNull();
  });
});
