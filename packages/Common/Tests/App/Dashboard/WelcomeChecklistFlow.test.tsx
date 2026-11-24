// UX rule: Docs/ux/README.md#a-products-first-page
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
 *  - "What do you want to do first?" once, for a new project's owner: six
 *    goals as cards, several ticked, what they bring said while picking,
 *    then Continue - or "Just looking around", the way out, which keeps
 *    that goal and hides the checklist (#8897); the checklist that
 *    follows; Change to answer again.
 *  - Hide is this person's own: the card goes, a line stays with Show it
 *    and How OneUptime works, which opens its dialog (#8995).
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
  GETTING_STARTED_BODY_CLASS_NAME,
  GETTING_STARTED_STEPS_CLASS_NAME,
  GETTING_STARTED_SUMMARY_CLASS_NAME,
  GETTING_STARTED_TEST_IDS,
  GOAL_CHIP_CLASS_NAME,
  HOW_ONEUPTIME_WORKS_LINE_TEST_ID,
  WelcomeCardView,
  getMoreSteps,
  getStepAfter,
  getWelcomeCardView,
  isPhoneOffered,
  isQuickstartTakingHome,
  isQuickstartView,
  offersFirstMonitor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import {
  WELCOME_CHECKLIST_COPY,
  WELCOME_GOALS,
  WELCOME_GOAL_CARDS,
  WELCOME_JUST_LOOKING_GOAL,
  WelcomeGoalEntry,
  getWelcomeStepEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog";
import {
  GOAL_CARDS_CLASS_NAME,
  GOAL_CARD_CLASS_NAME,
  GOAL_CHECKBOX_CLASS_NAME,
  GOAL_MARK_AT_REST_CLASS_NAME,
  GOAL_MARK_CHOSEN_CLASS_NAME,
  GOAL_MARK_CLASS_NAME,
  GOAL_QUESTION_BODY_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/GoalQuestion";
import {
  GOAL_PLAN_PANEL_CLASS_NAME,
  GOAL_PLAN_PANEL_COPY,
  GOAL_PLAN_PANEL_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/GoalPlanPanel";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import ObjectID from "../../../Types/ObjectID";
import ProjectGoal, {
  PROJECT_GOALS,
} from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  WELCOME_STEP_MINUTES,
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
  getPlanStepsForGoals,
  getWelcomeStepsMinutes,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WELCOME_CHECKLIST_GOALS_ROUTE,
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import { HowOneUptimeWorksOpenedFrom } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import Name from "../../../Types/Name";
import ChecklistEvents from "../../../UI/Utils/ChecklistEvents";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";

/*
 * An invited member's card (MemberFirstSteps) reads the member's next
 * shifts beside the steps. These tests are about the steps, so that read is
 * left unanswered: refused at once, and taken as one it could not make.
 */
refuseRequestsTo(["/on-call-calendar/my-shifts"]);

const PROJECT_ID: string = "65f00000000000000000dddd";

function step(
  key: WelcomeStep,
  extra?: Partial<WelcomeChecklistStepState>,
): WelcomeChecklistStepState {
  return {
    step: key,
    isDone: false,
    needsPlan: null,
    isNext: false,
    gap: null,
    ...extra,
  };
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

// Every view the card said it drew, in order (Home draws the page by it).
let views: Array<WelcomeCardView | null> = [];
// And each time, whether it said it was the whole of Home.
let takingHome: Array<boolean> = [];
// And whether it offered to create the first monitor (#7759).
let firstMonitorOffers: Array<boolean> = [];

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(
      <GettingStarted
        projectId={new ObjectID(PROJECT_ID)}
        onViewChange={(
          view: WelcomeCardView | null,
          isTakingHome: boolean,
          isOfferingFirstMonitor: boolean,
        ) => {
          views.push(view);
          takingHome.push(isTakingHome);
          firstMonitorOffers.push(isOfferingFirstMonitor);
        }}
      />,
    );
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
  views = [];
  takingHome = [];
  firstMonitorOffers = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getName").mockReturnValue(new Name("Ada Lovelace"));
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
  test("asks a new project's owner, with six goals as cards in the question's order, Just looking around under them, and no checklist yet", async () => {
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
    ).toEqual(
      PROJECT_GOALS.filter((goal: ProjectGoal): boolean => {
        return goal !== ProjectGoal.Explore;
      }),
    );
    expect(question).toHaveTextContent("Know when my website or API is down");
    expect(question).toHaveTextContent("I am moving from another tool");
    // The way out is a button under the cards, not one of them.
    expect(screen.queryByTestId("welcome-goal-explore")).toBeNull();
    expect(
      screen.getByTestId("welcome-question-just-looking"),
    ).toHaveTextContent("Just looking around");
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("every goal the question offers has its words, and they are the catalog's", () => {
    expect(
      WELCOME_GOALS.map((entry: WelcomeGoalEntry): ProjectGoal => {
        return entry.goal;
      }),
    ).toEqual([...PROJECT_GOALS]);
    expect(WELCOME_JUST_LOOKING_GOAL).toBe(ProjectGoal.Explore);
    expect(
      WELCOME_GOAL_CARDS.map((entry: WelcomeGoalEntry): ProjectGoal => {
        return entry.goal;
      }),
    ).toEqual(
      PROJECT_GOALS.filter((goal: ProjectGoal): boolean => {
        return goal !== WELCOME_JUST_LOOKING_GOAL;
      }),
    );
  });

  test("greets the person by their first name, as they wrote it", async () => {
    await renderGettingStarted();

    expect(screen.getByTestId("welcome-question-greeting")).toHaveTextContent(
      "Welcome to OneUptime, Ada 👋",
    );
  });

  test("with no name known, the greeting is the card's own welcome", async () => {
    jest.spyOn(UserUtil, "getName").mockReturnValue(new Name(""));
    await renderGettingStarted();

    expect(screen.getByTestId("welcome-question-greeting")).toHaveTextContent(
      /^Welcome to OneUptime 👋$/,
    );
  });

  test("each card says what the goal brings, and a screen reader hears it with the choice", async () => {
    await renderGettingStarted();

    for (const entry of WELCOME_GOAL_CARDS) {
      const card: HTMLElement = screen.getByTestId(
        `welcome-goal-${entry.goal}`,
      );
      const box: HTMLElement = within(card).getByRole("checkbox");

      expect(entry.outcome.length).toBeGreaterThan(20);
      expect(card).toHaveTextContent(entry.outcome);
      expect(box).toHaveAccessibleDescription(entry.outcome);
      expect(box).toHaveAccessibleName(entry.title);
    }
  });

  test("a picked card is plainly marked, and unmarked again", async () => {
    await renderGettingStarted();

    const card: HTMLElement = screen.getByTestId(
      `welcome-goal-${ProjectGoal.Uptime}`,
    );
    const mark: () => HTMLElement = (): HTMLElement => {
      return screen.getByTestId(`welcome-goal-${ProjectGoal.Uptime}-mark`);
    };

    // The round mark in the card's corner, with the checkbox lying over it.
    expect(mark().className).toContain(GOAL_MARK_CLASS_NAME);
    expect(mark().className).toContain(GOAL_MARK_AT_REST_CLASS_NAME);
    expect(mark()).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByTestId(`welcome-goal-${ProjectGoal.Uptime}-checkbox`),
    ).toBe(goalBox(ProjectGoal.Uptime));
    expect(goalBox(ProjectGoal.Uptime).className).toBe(
      GOAL_CHECKBOX_CLASS_NAME,
    );
    expect(card).toHaveAttribute("data-chosen", "false");
    expect(mark().querySelector("svg")).toBeNull();

    fireEvent.click(goalBox(ProjectGoal.Uptime));

    expect(card).toHaveAttribute("data-chosen", "true");
    expect(card.className).toContain("border-indigo-500");
    expect(card.className).toContain("bg-indigo-50");
    expect(mark().className).toContain(GOAL_MARK_CHOSEN_CLASS_NAME);
    // The tick, inside the disc.
    expect(mark().querySelector("svg")).not.toBeNull();
    expect(goalBox(ProjectGoal.Uptime).checked).toBe(true);

    fireEvent.click(goalBox(ProjectGoal.Uptime));

    expect(card).toHaveAttribute("data-chosen", "false");
    expect(card.className).not.toContain("border-indigo-500");
    expect(mark().className).toContain(GOAL_MARK_AT_REST_CLASS_NAME);
    expect(goalBox(ProjectGoal.Uptime).checked).toBe(false);
  });

  /*
   * The dark theme draws every visible checkbox its own way (square, with
   * a tick of its own: Theme.css), which fought the round mark. The
   * checkbox lies over the mark, see-through, so it still takes the click
   * and the keyboard, and only the mark is seen.
   */
  test("the checkbox lies over its mark, see-through, and takes the click itself", () => {
    expect(GOAL_CHECKBOX_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["absolute", "inset-0", "z-10", "opacity-0"]),
    );
    expect(GOAL_CHECKBOX_CLASS_NAME).not.toContain("sr-only");
    expect(GOAL_CHECKBOX_CLASS_NAME).not.toContain("pointer-events-none");
    expect(GOAL_MARK_CLASS_NAME).toContain("rounded-full");
  });

  test("a card is one row on a phone and a tile from sm up", () => {
    expect(GOAL_CARD_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["flex", "items-start", "sm:flex-col"]),
    );
  });

  test("a click anywhere on a card picks it: the card is the checkbox's label", async () => {
    await renderGettingStarted();

    fireEvent.click(
      within(
        screen.getByTestId(`welcome-goal-${ProjectGoal.StatusPage}`),
      ).getByText("Tell my customers with a status page"),
    );

    expect(goalBox(ProjectGoal.StatusPage).checked).toBe(true);
  });

  test("the checkbox is named by its goal alone, and described by what it brings", async () => {
    await renderGettingStarted();

    expect(
      screen.getByRole("checkbox", {
        name: "Page the right person when something breaks",
      }),
    ).toBe(goalBox(ProjectGoal.OnCall));
  });

  test("while picking, says how many steps the goals bring and about how long they take", async () => {
    await renderGettingStarted();

    // Nothing picked: why Continue waits.
    expect(screen.getByTestId("welcome-question-plan")).toHaveTextContent(
      "Pick at least one to continue.",
    );
    expect(screen.queryByTestId("welcome-question-plan-steps")).toBeNull();

    fireEvent.click(goalBox(ProjectGoal.Uptime));

    // Its clock is an Icon, which draws a div: no paragraph holds one.
    expect(
      screen.getByTestId("welcome-question").querySelectorAll("p div"),
    ).toHaveLength(0);

    // Uptime: a monitor and who is told.
    expect(screen.getByTestId("welcome-question-plan-steps")).toHaveTextContent(
      "2 steps to set up",
    );
    expect(
      screen.getByTestId("welcome-question-plan-minutes"),
    ).toHaveTextContent(
      `About ${getWelcomeStepsMinutes([WelcomeStep.Monitor, WelcomeStep.OnCall])} minutes`,
    );

    // A status page adds one step; the monitor they share is counted once.
    fireEvent.click(goalBox(ProjectGoal.StatusPage));

    expect(screen.getByTestId("welcome-question-plan-steps")).toHaveTextContent(
      "3 steps to set up",
    );
    expect(
      screen.getByTestId("welcome-question-plan-minutes"),
    ).toHaveTextContent(
      `About ${getWelcomeStepsMinutes([
        WelcomeStep.Monitor,
        WelcomeStep.OnCall,
        WelcomeStep.StatusPage,
      ])} minutes`,
    );
    expect(screen.queryByTestId("welcome-question-pick-hint")).toBeNull();
  });

  test("one step is said in the singular", async () => {
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.Telemetry));

    expect(screen.getByTestId("welcome-question-plan-steps")).toHaveTextContent(
      /^1 step to set up$/,
    );
    expect(
      screen.getByTestId("welcome-question-plan-minutes"),
    ).toHaveTextContent(
      `About ${WELCOME_STEP_MINUTES[WelcomeStep.Telemetry]} minutes`,
    );
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

  /*
   * The way out of the question (#8897): the goal of someone who has none
   * yet is kept, and the checklist is hidden for them at once, so they land
   * on the rest of Home with the line that shows it again. Skip used to
   * keep them on the checklist's four steps.
   */
  test("Just looking around keeps the Explore goal and hides the checklist for this person, with nothing drawn in between", async () => {
    const explore: WelcomeChecklistAnswer = answer({
      goals: [ProjectGoal.Explore],
      steps: [step(WelcomeStep.Monitor, { isNext: true })],
    });

    postMock.mockImplementation((route: unknown) => {
      return Promise.resolve(
        route === WELCOME_CHECKLIST_HIDE_ROUTE
          ? { ...explore, isHiddenForMe: true }
          : explore,
      );
    });
    await renderGettingStarted();

    await press("welcome-question-just-looking");

    expect(postMock.mock.calls).toEqual([
      [WELCOME_CHECKLIST_GOALS_ROUTE, { goals: [ProjectGoal.Explore] }],
      [WELCOME_CHECKLIST_HIDE_ROUTE, {}],
    ]);
    expect(screen.queryByTestId("welcome-question")).toBeNull();
    expect(screen.getByTestId("welcome-checklist-hidden")).toHaveTextContent(
      "You hid the Welcome checklist.",
    );
    // From the question straight to the line: the checklist never drew.
    expect(views).not.toContain(WelcomeCardView.Checklist);
    expect(views[views.length - 1]).toBe(WelcomeCardView.Hidden);
    expect(sendMock).toHaveBeenCalledWith(ProductEventName.GoalsChosen, {
      goals: "explore",
      goal_count: 1,
      is_change: false,
    });
    // Not a dismissal of a checklist the person never saw.
    expect(sendMock).not.toHaveBeenCalledWith(
      ProductEventName.ChecklistDismissed,
      expect.anything(),
    );
  });

  test("Just looking around whose goal does not save says so, and keeps the question", async () => {
    postMock.mockResolvedValue(null);
    await renderGettingStarted();

    await press("welcome-question-just-looking");

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("welcome-question-error")).toHaveTextContent(
      "That did not save.",
    );
    expect(sendMock).not.toHaveBeenCalledWith(
      ProductEventName.GoalsChosen,
      expect.anything(),
    );
  });

  test("Just looking around whose hide does not save shows the checklist Explore brings, with its Hide", async () => {
    postMock.mockImplementation((route: unknown) => {
      return Promise.resolve(
        route === WELCOME_CHECKLIST_HIDE_ROUTE
          ? null
          : answer({
              goals: [ProjectGoal.Explore],
              steps: [step(WelcomeStep.Monitor, { isNext: true })],
            }),
      );
    });
    await renderGettingStarted();

    await press("welcome-question-just-looking");

    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(
      screen.getByTestId(`getting-started-task-${WelcomeStep.Monitor}`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("getting-started-dismiss")).toBeEnabled();
  });

  test("an answer that does not save says so, and keeps the question with what was ticked", async () => {
    postMock.mockResolvedValue(null);
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.Uptime));
    await press("welcome-question-continue");

    expect(screen.getByTestId("welcome-question-error")).toHaveTextContent(
      "That did not save.",
    );
    expect(goalBox(ProjectGoal.Uptime).checked).toBe(true);
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
    // Changing is not a first visit: no greeting, and no way out but Cancel.
    expect(screen.queryByTestId("welcome-question-greeting")).toBeNull();
    expect(screen.queryByTestId("welcome-question-just-looking")).toBeNull();

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

  test("a project that was just looking around changes its goals from no card picked, and saves real ones", async () => {
    fetchMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.Explore],
        steps: [step(WelcomeStep.Monitor, { isNext: true })],
      }),
    );
    postMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.StatusPage],
        steps: [
          step(WelcomeStep.Monitor, { isNext: true }),
          step(WelcomeStep.StatusPage),
        ],
      }),
    );
    await renderGettingStarted();

    expect(
      screen.getByTestId(`welcome-checklist-goal-${ProjectGoal.Explore}`),
    ).toHaveTextContent("Just looking around");

    await press("welcome-checklist-change-goals");

    // Nothing is picked: the way out is no card, so Save waits for one.
    expect(screen.getByTestId("welcome-question-continue")).toBeDisabled();

    fireEvent.click(goalBox(ProjectGoal.StatusPage));
    await press("welcome-question-continue");

    expect(postMock).toHaveBeenCalledWith(WELCOME_CHECKLIST_GOALS_ROUTE, {
      goals: [ProjectGoal.StatusPage],
    });
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

  test("How OneUptime works stays one click away after hiding: the line opens its dialog", async () => {
    const opened: MockFunction = getJestMockFunction();
    const listener: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      opened(event.detail);
    };
    GlobalEvents.addEventListener(EventName.HOW_ONEUPTIME_WORKS_OPEN, listener);

    try {
      fetchMock.mockResolvedValue(answer({ isHiddenForMe: true }));
      await renderGettingStarted();

      const button: HTMLElement = screen.getByTestId(
        "welcome-checklist-how-it-works",
      );

      expect(button).toHaveAttribute("aria-haspopup", "dialog");
      // A dialog opens; nothing unfolds in the line.
      expect(button).not.toHaveAttribute("aria-expanded");

      await press("welcome-checklist-how-it-works");

      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened).toHaveBeenCalledWith({
        from: HowOneUptimeWorksOpenedFrom.WelcomeChecklist,
      });
      expect(screen.queryByTestId("how-oneuptime-works")).toBeNull();
      expect(screen.getByTestId("welcome-checklist-hidden")).toHaveTextContent(
        "You hid the Welcome checklist.",
      );
    } finally {
      GlobalEvents.removeEventListener(
        EventName.HOW_ONEUPTIME_WORKS_OPEN,
        listener,
      );
    }
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
  test("carry the goals, and leave out steps the plan holds back", async () => {
    const note: SpyInstance<typeof ChecklistEvents.noteProgress> = jest.spyOn(
      ChecklistEvents,
      "noteProgress",
    );

    fetchMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.OnCall],
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.OnCall, { isNext: true }),
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

/*
 * Home draws the rest of the page by the view this card says it draws
 * (#8897): nothing until the answer is read, then the view - the question
 * and the checklist are the quickstart, and Home is only them.
 */
describe("the view it says it draws, for Home", () => {
  test("nothing until the answer is read, then the question", async () => {
    let resolve: (value: WelcomeChecklistAnswer) => void = () => {};

    fetchMock.mockImplementation(() => {
      return new Promise((done: (value: WelcomeChecklistAnswer) => void) => {
        resolve = done;
      });
    });

    await renderGettingStarted();

    expect(views).toEqual([null]);

    await act(async () => {
      resolve(NEW_PROJECT);
    });

    expect(views).toEqual([null, WelcomeCardView.Question]);
  });

  test("the checklist after Continue, and the line after Hide", async () => {
    postMock.mockImplementation((route: unknown) => {
      return Promise.resolve(
        route === WELCOME_CHECKLIST_HIDE_ROUTE
          ? answer({ goals: [ProjectGoal.Uptime], isHiddenForMe: true })
          : answer({ goals: [ProjectGoal.Uptime] }),
      );
    });
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.Uptime));
    await press("welcome-question-continue");

    expect(views[views.length - 1]).toBe(WelcomeCardView.Checklist);

    await press("getting-started-dismiss");

    expect(views[views.length - 1]).toBe(WelcomeCardView.Hidden);
  });

  test("an answer that could not be read is no view at all: Home draws itself", async () => {
    fetchMock.mockResolvedValue(null);
    await renderGettingStarted();

    expect(views).toEqual([null, WelcomeCardView.None]);
  });

  test("a read that throws is no view either, never a page left deciding", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    await renderGettingStarted();

    expect(views[views.length - 1]).toBe(WelcomeCardView.None);
  });

  test("the question is the whole of Home; so is the checklist its answer brings", async () => {
    postMock.mockResolvedValue(answer({ goals: [ProjectGoal.Uptime] }));
    await renderGettingStarted();

    expect(views[views.length - 1]).toBe(WelcomeCardView.Question);
    expect(takingHome[takingHome.length - 1]).toBe(true);

    fireEvent.click(goalBox(ProjectGoal.Uptime));
    await press("welcome-question-continue");

    expect(views[views.length - 1]).toBe(WelcomeCardView.Checklist);
    expect(takingHome[takingHome.length - 1]).toBe(true);
  });

  test("an older project's checklist, whose question was never answered, is not", async () => {
    fetchMock.mockResolvedValue(answer({ goals: null }));
    await renderGettingStarted();

    expect(views[views.length - 1]).toBe(WelcomeCardView.Checklist);
    expect(takingHome[takingHome.length - 1]).toBe(false);
  });

  test("says whether it offers the first monitor, so Home's headline does not too (#7759)", async () => {
    fetchMock.mockResolvedValue(answer({ goals: null }));
    await renderGettingStarted();

    expect(firstMonitorOffers).toEqual([false, true]);

    cleanup();
    firstMonitorOffers = [];
    fetchMock.mockResolvedValue(
      answer({
        goals: null,
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.OnCall, { isNext: true }),
        ],
      }),
    );
    await renderGettingStarted();

    expect(firstMonitorOffers).toEqual([false, false]);
  });

  test("what else to set up is a card among Home's others, never the whole of Home", async () => {
    fetchMock.mockResolvedValue(
      answer({
        goals: [ProjectGoal.Uptime],
        isFinished: true,
        steps: [],
        moreSteps: [step(WelcomeStep.StatusPage), step(WelcomeStep.Team)],
      }),
    );
    await renderGettingStarted();

    expect(views[views.length - 1]).toBe(WelcomeCardView.More);
    expect(takingHome[takingHome.length - 1]).toBe(false);
    expect(screen.getByTestId("welcome-more")).toBeVisible();
  });

  test("nothing takes Home before the answer is read", async () => {
    fetchMock.mockImplementation(() => {
      return new Promise(() => {
        // not answered
      });
    });
    await renderGettingStarted();

    expect(views).toEqual([null]);
    expect(takingHome).toEqual([false]);
  });

  test.each([
    ["the question", WelcomeCardView.Question, answer({ goals: null }), true],
    [
      "a new project's checklist",
      WelcomeCardView.Checklist,
      answer({ goals: [ProjectGoal.Uptime] }),
      true,
    ],
    [
      "a skipped question's checklist",
      WelcomeCardView.Checklist,
      answer({ goals: [] }),
      true,
    ],
    [
      "an older project's checklist",
      WelcomeCardView.Checklist,
      answer({ goals: null }),
      false,
    ],
    ["the line left by Hide", WelcomeCardView.Hidden, answer(), false],
    [
      "an invited member's first steps",
      WelcomeCardView.InvitedMember,
      answer({ audience: WelcomeAudience.InvitedMember }),
      false,
    ],
    [
      "what else to set up, once the steps are done (#7986)",
      WelcomeCardView.More,
      answer({
        goals: [ProjectGoal.Uptime],
        isFinished: true,
        steps: [],
        moreSteps: [step(WelcomeStep.StatusPage)],
      }),
      false,
    ],
    ["nothing", WelcomeCardView.None, null, false],
    ["not read yet", null, null, false],
  ])(
    "whether the quickstart takes Home: %s",
    (
      _name: string,
      view: WelcomeCardView | null,
      value: WelcomeChecklistAnswer | null,
      expected: boolean,
    ) => {
      expect(isQuickstartTakingHome({ view: view, answer: value })).toBe(
        expected,
      );
    },
  );

  test("only the question and the checklist are the quickstart", () => {
    expect(isQuickstartView(WelcomeCardView.Question)).toBe(true);
    expect(isQuickstartView(WelcomeCardView.Checklist)).toBe(true);

    for (const view of [
      WelcomeCardView.None,
      WelcomeCardView.Hidden,
      WelcomeCardView.InvitedMember,
      WelcomeCardView.More,
      null,
    ]) {
      expect({ view, isQuickstart: isQuickstartView(view) }).toEqual({
        view,
        isQuickstart: false,
      });
    }
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
    [
      "finished, with core steps no goal brought left (#7986)",
      answer({
        isFinished: true,
        steps: [],
        moreSteps: [step(WelcomeStep.StatusPage), step(WelcomeStep.Team)],
      }),
      false,
      WelcomeCardView.More,
    ],
    [
      "finished, with them left, hidden by this person: nothing, no line",
      answer({
        isFinished: true,
        isHiddenForMe: true,
        steps: [],
        moreSteps: [step(WelcomeStep.StatusPage)],
      }),
      false,
      WelcomeCardView.None,
    ],
    [
      "finished, with them left, while choosing goals: what else to set up",
      answer({
        isFinished: true,
        steps: [],
        moreSteps: [step(WelcomeStep.Team)],
      }),
      true,
      WelcomeCardView.More,
    ],
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

  /*
   * Only email pages the person (#9442): a finished checklist with nothing
   * else left still offers their phone and the app, for whoever may use
   * the on-call guided setup.
   */
  test.each([
    ["only email pages them, and they may use the setup", false, true, true],
    ["a phone or the app pages them", true, true, false],
    ["not read", null, true, false],
    ["they may not use the setup", false, false, false],
  ])(
    "finished with nothing else left: %s",
    (
      _name: string,
      canBePagedByPhoneOrApp: boolean | null,
      mayUseOnCallSetup: boolean,
      isMore: boolean,
    ) => {
      const value: WelcomeChecklistAnswer = answer({
        isFinished: true,
        steps: [],
        moreSteps: [],
        canBePagedByPhoneOrApp: canBePagedByPhoneOrApp,
      });
      const offersPhone: boolean = isPhoneOffered({
        answer: value,
        mayUseOnCallSetup: mayUseOnCallSetup,
      });

      expect(offersPhone).toBe(isMore);
      expect(
        getWelcomeCardView({
          answer: value,
          isChangingGoals: false,
          offersPhone: offersPhone,
        }),
      ).toBe(isMore ? WelcomeCardView.More : WelcomeCardView.None);
    },
  );

  test("an invited member is never offered a phone by this card: their own first steps do", () => {
    expect(
      isPhoneOffered({
        answer: answer({
          audience: WelcomeAudience.InvitedMember,
          canBePagedByPhoneOrApp: false,
        }),
        mayUseOnCallSetup: true,
      }),
    ).toBe(false);
    expect(isPhoneOffered({ answer: null, mayUseOnCallSetup: true })).toBe(
      false,
    );
  });

  test("an answer that says nothing of what else to set up offers nothing", () => {
    const old: WelcomeChecklistAnswer = {
      ...answer({ isFinished: true, steps: [] }),
    };
    delete (old as Partial<WelcomeChecklistAnswer>).moreSteps;

    expect(getMoreSteps(old)).toEqual([]);
    expect(getWelcomeCardView({ answer: old, isChangingGoals: false })).toBe(
      WelcomeCardView.None,
    );
  });

  /*
   * One start for one job (#7759): the card says when it offers the first
   * monitor, so Home's headline leaves its own button out.
   */
  test.each([
    [
      "the checklist, the monitor left",
      WelcomeCardView.Checklist,
      answer(),
      true,
    ],
    [
      "the checklist, the monitor done",
      WelcomeCardView.Checklist,
      answer({
        steps: [
          step(WelcomeStep.Monitor, { isDone: true }),
          step(WelcomeStep.OnCall, { isNext: true }),
        ],
      }),
      false,
    ],
    [
      "the checklist, without the monitor",
      WelcomeCardView.Checklist,
      answer({ steps: [step(WelcomeStep.Telemetry, { isNext: true })] }),
      false,
    ],
    [
      "what else to set up, the monitor among them",
      WelcomeCardView.More,
      answer({
        isFinished: true,
        steps: [],
        moreSteps: [step(WelcomeStep.Monitor), step(WelcomeStep.Team)],
      }),
      true,
    ],
    [
      "what else to set up, without the monitor",
      WelcomeCardView.More,
      answer({
        isFinished: true,
        steps: [],
        moreSteps: [step(WelcomeStep.Team)],
      }),
      false,
    ],
    ["the line left by Hide", WelcomeCardView.Hidden, answer(), false],
    ["the question", WelcomeCardView.Question, answer(), false],
    ["nothing", WelcomeCardView.None, null, false],
  ])(
    "offers the first monitor: %s",
    (
      _name: string,
      view: WelcomeCardView,
      value: WelcomeChecklistAnswer | null,
      expected: boolean,
    ) => {
      expect(offersFirstMonitor({ view: view, answer: value })).toBe(expected);
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

/*
 * BESIDE THE QUESTION AND THE STEPS (#10276): a wide screen drew the
 * question and the checklist across the left of the page, with nothing
 * beside them. From lg up the question lists the steps the goals picked
 * bring beside the goals, as they are picked, and the checklist puts how
 * far the person is and the goals beside its steps.
 */
describe("beside the question and the steps", () => {
  test("with nothing picked, the panel beside the goals says the steps show there, from lg up", async () => {
    await renderGettingStarted();

    const panel: HTMLElement = screen.getByTestId(
      GOAL_PLAN_PANEL_TEST_IDS.panel,
    );

    expect(panel.className).toBe(GOAL_PLAN_PANEL_CLASS_NAME);
    expect(panel.className).toContain("hidden");
    expect(panel.className).toContain("lg:block");
    // Named by its title, for a screen reader moving by landmarks.
    expect(
      within(panel).getByRole("heading", { name: GOAL_PLAN_PANEL_COPY.title }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId(GOAL_PLAN_PANEL_TEST_IDS.nothingPicked),
    ).toHaveTextContent(GOAL_PLAN_PANEL_COPY.nothingPicked);
    expect(within(panel).queryAllByRole("listitem")).toHaveLength(0);
  });

  test("picking goals lists the steps they bring, in the checklist's order, each with its minutes; unpicking takes them away", async () => {
    await renderGettingStarted();

    fireEvent.click(goalBox(ProjectGoal.OnCall));
    fireEvent.click(goalBox(ProjectGoal.Uptime));

    const panel: HTMLElement = screen.getByTestId(
      GOAL_PLAN_PANEL_TEST_IDS.panel,
    );
    const expected: Array<WelcomeStep> = getPlanStepsForGoals([
      ProjectGoal.OnCall,
      ProjectGoal.Uptime,
    ]);

    expect(expected.length).toBeGreaterThan(1);
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-testid");
        }),
    ).toEqual(
      expected.map((planStep: WelcomeStep): string => {
        return GOAL_PLAN_PANEL_TEST_IDS.step(planStep);
      }),
    );

    for (const planStep of expected) {
      const minutes: number = WELCOME_STEP_MINUTES[planStep];
      expect(
        within(panel).getByTestId(GOAL_PLAN_PANEL_TEST_IDS.step(planStep)),
      ).toHaveTextContent(
        `${getWelcomeStepEntry(planStep).title}About ${minutes} minute${
          minutes === 1 ? "" : "s"
        }`,
      );
    }
    // The checklist's own line says what the steps are.
    expect(panel).toHaveTextContent(WELCOME_CHECKLIST_COPY.description);
    // The line beside Continue counts the same steps.
    expect(screen.getByTestId("welcome-question-plan-steps")).toHaveTextContent(
      `${expected.length} steps to set up`,
    );

    fireEvent.click(goalBox(ProjectGoal.OnCall));
    fireEvent.click(goalBox(ProjectGoal.Uptime));

    expect(
      within(panel).getByTestId(GOAL_PLAN_PANEL_TEST_IDS.nothingPicked),
    ).toBeInTheDocument();
    expect(within(panel).queryAllByRole("listitem")).toHaveLength(0);
  });

  test("the goals take the room beside the panel, three to a row once there is room for them", () => {
    expect(GOAL_QUESTION_BODY_CLASS_NAME).toContain(
      "lg:grid-cols-[minmax(0,1fr)_17rem]",
    );
    expect(GOAL_CARDS_CLASS_NAME).toContain("sm:grid-cols-2");
    expect(GOAL_CARDS_CLASS_NAME).toContain("xl:grid-cols-3");
    expect(GOAL_CARDS_CLASS_NAME).not.toContain("lg:grid-cols-3");
  });

  test("the checklist puts how far, and the goals with Change, beside its steps; How OneUptime works is the last line", async () => {
    fetchMock.mockResolvedValue(
      answer({ goals: [ProjectGoal.Uptime, ProjectGoal.OnCall] }),
    );
    await renderGettingStarted();

    const body: HTMLElement = screen.getByTestId(GETTING_STARTED_TEST_IDS.body);
    const summary: HTMLElement = screen.getByTestId(
      GETTING_STARTED_TEST_IDS.summary,
    );
    const steps: HTMLElement = screen.getByTestId("getting-started-steps");
    const howItWorks: HTMLElement = screen.getByTestId(
      HOW_ONEUPTIME_WORKS_LINE_TEST_ID,
    );

    expect(body.className).toBe(GETTING_STARTED_BODY_CLASS_NAME);
    expect(body.className).toContain("lg:grid-cols-[minmax(0,1fr)_20rem]");
    // The column beside the steps from lg up.
    expect(summary.className).toBe(GETTING_STARTED_SUMMARY_CLASS_NAME);
    expect(summary.className).toContain("lg:col-start-2");
    expect(steps.className).toBe(GETTING_STARTED_STEPS_CLASS_NAME);
    expect(steps.className).toContain("lg:col-start-1");
    expect(
      within(summary).getByTestId("getting-started-progress"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByTestId("welcome-checklist-goals"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByTestId("welcome-checklist-change-goals"),
    ).toBeInTheDocument();

    // On a phone they come first, then the steps, then How OneUptime works.
    expect(
      summary.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(body.contains(howItWorks)).toBe(false);
    expect(
      body.compareDocumentPosition(howItWorks) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A goal is a card's shape, so one that takes two lines reads right.
    expect(
      screen.getByTestId(`welcome-checklist-goal-${ProjectGoal.Uptime}`)
        .className,
    ).toBe(GOAL_CHIP_CLASS_NAME);
    expect(GOAL_CHIP_CLASS_NAME).toContain("rounded-lg");
    expect(GOAL_CHIP_CLASS_NAME).not.toContain("rounded-full");
  });

  test("a change that does not save is said once, over the steps and their column", async () => {
    fetchMock.mockResolvedValue(
      answer({ goals: [ProjectGoal.Uptime, ProjectGoal.OnCall] }),
    );
    // What the API says of a change the server did not take.
    postMock.mockResolvedValue(null);
    await renderGettingStarted();

    await press("getting-started-dismiss");

    const alerts: Array<HTMLElement> = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(WELCOME_CHECKLIST_COPY.couldNotSave);
    expect(
      alerts[0]!.compareDocumentPosition(
        screen.getByTestId(GETTING_STARTED_TEST_IDS.body),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
