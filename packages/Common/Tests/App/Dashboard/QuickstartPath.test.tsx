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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE QUICKSTART'S STEPS, DRAWN AS A PATH (issue #8897).
 *
 * After the question, the checklist on Home was a grid of plain tiles: the
 * person could not tell how long any of it would take, how much was left,
 * or which one to press first beyond a small badge. Now:
 *
 *  - the person is greeted by their first name, with Hide on that line;
 *  - the progress says how many steps are done and about how many minutes
 *    are left;
 *  - each step to do says about how long it takes; a done step or one the
 *    plan holds back says nothing of time;
 *  - the next step stands out and carries its own Start, inside its row;
 *  - the steps are joined by a line, green past a step that is done;
 *  - under them, one line opens How OneUptime works, in line with them
 *    (#8995).
 *
 * The real component; the Welcome checklist's reads answer per test.
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
  HOW_ONEUPTIME_WORKS_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import {
  getGreeting,
  getGreetingFirstName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeGreeting";
import { PATH_LINE_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomePlanStep";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  WELCOME_STEP_MINUTES,
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import { Translator, createTranslator } from "../../../Types/Translator";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "65f00000000000000000eeee";

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
  steps: Array<WelcomeChecklistStepState>,
): WelcomeChecklistAnswer {
  const counted: Array<WelcomeChecklistStepState> = steps.filter(
    (state: WelcomeChecklistStepState): boolean => {
      return state.needsPlan === null;
    },
  );

  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: [ProjectGoal.Uptime, ProjectGoal.StatusPage],
    canChooseGoals: true,
    steps: steps,
    doneCount: counted.filter((state: WelcomeChecklistStepState): boolean => {
      return state.isDone;
    }).length,
    totalCount: counted.length,
  };
}

// The monitor done, who is told next, a status page, and the team held back.
const HALF_WAY: WelcomeChecklistAnswer = answer([
  step(WelcomeStep.Monitor, { isDone: true }),
  step(WelcomeStep.OnCall, { isNext: true }),
  step(WelcomeStep.StatusPage),
  step(WelcomeStep.Team, { needsPlan: PlanType.Growth }),
]);

async function renderPath(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

function row(key: WelcomeStep): HTMLElement {
  return screen.getByTestId(`getting-started-task-${key}`);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getName").mockReturnValue(new Name("Grace Hopper"));
  legacyMock.mockResolvedValue(null);
  fetchMock.mockResolvedValue(HALF_WAY);
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

describe("the top of the path", () => {
  test("greets the person by their first name, with Hide on the same line", async () => {
    await renderPath();

    const greeting: HTMLElement = screen.getByTestId(
      "getting-started-greeting",
    );

    expect(greeting).toHaveTextContent("Welcome to OneUptime, Grace 👋");
    expect(greeting.tagName).toBe("H2");
    // The section is named by it.
    expect(
      screen.getByRole("region", { name: "Welcome to OneUptime, Grace 👋" }),
    ).toBe(screen.getByTestId("getting-started"));
    expect(screen.getByTestId("getting-started-dismiss")).toHaveTextContent(
      "Hide",
    );
  });

  test("says how many steps are done, and about how many minutes are left of the ones the plan allows", async () => {
    await renderPath();

    // The clock is an Icon, which draws a div: no paragraph on the path holds one.
    expect(
      screen.getByTestId("getting-started").querySelectorAll("p div"),
    ).toHaveLength(0);

    const progress: HTMLElement = screen.getByTestId(
      "getting-started-progress",
    );

    expect(progress).toHaveTextContent("1 of 3 steps completed");
    expect(
      screen.getByTestId("getting-started-minutes-left"),
    ).toHaveTextContent(
      `About ${
        WELCOME_STEP_MINUTES[WelcomeStep.OnCall] +
        WELCOME_STEP_MINUTES[WelcomeStep.StatusPage]
      } minutes left`,
    );
  });

  test("with nothing left the plan allows, says nothing of minutes", async () => {
    fetchMock.mockResolvedValue(
      answer([
        step(WelcomeStep.Monitor, { isDone: true }),
        step(WelcomeStep.Team, { needsPlan: PlanType.Growth }),
      ]),
    );
    await renderPath();

    expect(screen.queryByTestId("getting-started-minutes-left")).toBeNull();
  });

  test("the goals are chips with their icons, and Change is beside them", async () => {
    await renderPath();

    const goals: HTMLElement = screen.getByTestId("welcome-checklist-goals");

    expect(
      within(goals).getByTestId(`welcome-checklist-goal-${ProjectGoal.Uptime}`),
    ).toHaveTextContent("Know when my website or API is down");
    expect(
      within(goals).getByTestId(
        `welcome-checklist-goal-${ProjectGoal.StatusPage}`,
      ),
    ).toHaveTextContent("Tell my customers with a status page");
    expect(
      within(goals).getByTestId("welcome-checklist-change-goals"),
    ).toHaveTextContent("Change");
  });
});

describe("each step", () => {
  test("a step to do says about how long it takes", async () => {
    await renderPath();

    expect(
      screen.getByTestId(`getting-started-task-${WelcomeStep.OnCall}-minutes`),
    ).toHaveTextContent(
      `About ${WELCOME_STEP_MINUTES[WelcomeStep.OnCall]} minutes`,
    );
    expect(
      screen.getByTestId(
        `getting-started-task-${WelcomeStep.StatusPage}-minutes`,
      ),
    ).toHaveTextContent(
      `About ${WELCOME_STEP_MINUTES[WelcomeStep.StatusPage]} minutes`,
    );
  });

  test("a step that takes a minute says so in the singular", async () => {
    fetchMock.mockResolvedValue(
      answer([step(WelcomeStep.Team, { isNext: true })]),
    );
    await renderPath();

    expect(
      screen.getByTestId(`getting-started-task-${WelcomeStep.Team}-minutes`),
    ).toHaveTextContent(/^About 1 minute$/);
  });

  test("a done step, and one the plan holds back, say nothing of time", async () => {
    await renderPath();

    expect(
      screen.queryByTestId(
        `getting-started-task-${WelcomeStep.Monitor}-minutes`,
      ),
    ).toBeNull();
    expect(
      screen.queryByTestId(`getting-started-task-${WelcomeStep.Team}-minutes`),
    ).toBeNull();
    expect(
      screen.getByTestId(`getting-started-task-${WelcomeStep.Team}-needs-plan`),
    ).toHaveTextContent("Needs the Growth plan");
  });

  test("a done step is a record with a check, not a way anywhere", async () => {
    await renderPath();

    const done: HTMLElement = row(WelcomeStep.Monitor);

    expect(done.tagName).toBe("DIV");
    expect(done).toHaveAttribute("data-done", "true");
    expect(done).toHaveTextContent("Done");

    fireEvent.click(done);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("the next step stands out and carries its own Start, inside its row: one control, not two", async () => {
    await renderPath();

    const next: HTMLElement = row(WelcomeStep.OnCall);
    const start: HTMLElement = within(next).getByTestId(
      "getting-started-start",
    );

    expect(next).toHaveAttribute("data-next", "true");
    expect(next.className).toContain("bg-indigo-50");
    expect(start).toHaveTextContent("Start");
    // Drawn as a button, but the row is the button.
    expect(start.tagName).toBe("SPAN");
    expect(within(next).queryAllByRole("button")).toHaveLength(0);
    // Only the next step has it.
    expect(screen.getAllByTestId("getting-started-start")).toHaveLength(1);
    expect(
      within(row(WelcomeStep.StatusPage)).queryByTestId(
        "getting-started-start",
      ),
    ).toBeNull();

    fireEvent.click(start);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP]!.toString().replace(
        ":projectId",
        PROJECT_ID,
      ),
    );
  });

  test("a screen reader hears a step's title first, then that it is next, what it does and how long it takes", async () => {
    await renderPath();

    expect(row(WelcomeStep.OnCall)).toHaveAccessibleName(
      new RegExp(
        `^Set up an on-call policy Next step .+ About ${
          WELCOME_STEP_MINUTES[WelcomeStep.OnCall]
        }\\sminutes Start$`,
      ),
    );
  });

  test("the steps keep the server's order", async () => {
    await renderPath();

    expect(
      within(screen.getByTestId("getting-started-steps"))
        .getAllByTestId(/^getting-started-task-[a-z_]+$/)
        .map((element: HTMLElement): string => {
          return (element.getAttribute("data-testid") || "").replace(
            "getting-started-task-",
            "",
          );
        }),
    ).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
      WelcomeStep.Team,
    ]);
  });
});

describe("the path between the steps", () => {
  test("joins each step to the next, and the last to nothing", async () => {
    await renderPath();

    for (const key of [
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
    ]) {
      expect(
        screen.getByTestId(`getting-started-path-${key}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId(`getting-started-path-${WelcomeStep.Team}`),
    ).toBeNull();
  });

  test("is green past a step that is done, and grey past one to do", async () => {
    await renderPath();

    const pastDone: HTMLElement = screen.getByTestId(
      `getting-started-path-${WelcomeStep.Monitor}`,
    );
    const pastToDo: HTMLElement = screen.getByTestId(
      `getting-started-path-${WelcomeStep.OnCall}`,
    );

    expect(pastDone).toHaveAttribute("data-done", "true");
    expect(pastDone.className).toContain("bg-emerald-500");
    expect(pastToDo).toHaveAttribute("data-done", "false");
    expect(pastToDo.className).toContain("bg-gray-200");
    // Decoration: never read out.
    expect(pastDone).toHaveAttribute("aria-hidden", "true");
  });

  test("runs down the start of the line, so a page read from the right draws it on the right", () => {
    expect(PATH_LINE_CLASS_NAME).toContain("start-[34px]");
    expect(PATH_LINE_CLASS_NAME).not.toMatch(/\b(?:left|right)-/);
  });
});

describe("under the steps", () => {
  test("How OneUptime works is one line, its icon and words in line with the steps' own", async () => {
    await renderPath();

    const line: HTMLElement = screen.getByTestId(
      HOW_ONEUPTIME_WORKS_LINE_TEST_ID,
    );
    const classesOf: (element: HTMLElement) => Array<string> = (
      element: HTMLElement,
    ): Array<string> => {
      return element.className.split(" ");
    };

    // The same room either side as the steps' list has...
    for (const padding of ["px-3", "sm:px-5"]) {
      expect(classesOf(screen.getByTestId("getting-started-steps"))).toContain(
        padding,
      );
      expect(classesOf(line.parentElement!)).toContain(padding);
    }
    // ...and inside, as a step's row has.
    for (const token of ["px-3", "gap-4", "rounded-xl", "border"]) {
      expect(classesOf(row(WelcomeStep.OnCall))).toContain(token);
      expect(classesOf(line)).toContain(token);
    }
    // An icon as wide as a step's, so its words start where theirs do.
    const icon: HTMLElement = line.firstElementChild as HTMLElement;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(classesOf(icon)).toEqual(expect.arrayContaining(["h-11", "w-11"]));
    // Quieter than a step: no colour of its own, and never marked next.
    expect(line).not.toHaveAttribute("data-next");
    expect(classesOf(icon)).toContain("bg-gray-100");
  });
});

describe("the greeting's words", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("a first name is greeted as written, a missing one with the card's own welcome", () => {
    expect(getGreeting(english, "Ada")).toBe("Welcome to OneUptime, Ada 👋");
    expect(getGreeting(english, "  ")).toBe("Welcome to OneUptime 👋");
    expect(getGreeting(english, undefined)).toBe("Welcome to OneUptime 👋");
  });

  test("the first name is the first word of the person's name, and nothing when there is none", () => {
    jest.spyOn(UserUtil, "getName").mockReturnValue(new Name("Ada Lovelace"));
    expect(getGreetingFirstName()).toBe("Ada");

    jest.spyOn(UserUtil, "getName").mockReturnValue(new Name(""));
    expect(getGreetingFirstName()).toBe("");

    jest.spyOn(UserUtil, "getName").mockImplementation(() => {
      throw new Error("no storage");
    });
    expect(getGreetingFirstName()).toBe("");
  });
});
