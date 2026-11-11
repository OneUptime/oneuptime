import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Welcome checklist on Home (issue #6803), from the keyboard and when
 * its read fails:
 *
 *  - Keyboard users. A step to do is a real button: Tab reaches it in the
 *    order listed, Enter and Space open it. A step done is a record, not a
 *    control.
 *  - A read that fails. The checklist is one server answer now (no more
 *    four counts, one of which could take the rest with it): an answer that
 *    did not come back, or is not one, draws nothing - the card is a help,
 *    never a broken box - and nothing is remembered from it.
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

import GettingStarted from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

type UserEventController = ReturnType<typeof userEvent.setup>;

const PROJECT_ID: string = "65f00000000000000000eeee";

const STEP_KEYS: Array<WelcomeStep> = [
  WelcomeStep.Monitor,
  WelcomeStep.OnCall,
  WelcomeStep.StatusPage,
  WelcomeStep.Team,
];

function step(
  key: WelcomeStep,
  extra?: Partial<WelcomeChecklistStepState>,
): WelcomeChecklistStepState {
  return { step: key, isDone: false, needsPlan: null, isNext: false, ...extra };
}

function answer(
  steps: Array<WelcomeChecklistStepState>,
  extra?: Partial<WelcomeChecklistAnswer>,
): WelcomeChecklistAnswer {
  const counted: Array<WelcomeChecklistStepState> = steps.filter(
    (state: WelcomeChecklistStepState): boolean => {
      return state.needsPlan === null;
    },
  );

  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: [],
    canChooseGoals: true,
    steps: steps,
    doneCount: counted.filter((state: WelcomeChecklistStepState): boolean => {
      return state.isDone;
    }).length,
    totalCount: counted.length,
    ...extra,
  };
}

const NOTHING_DONE: WelcomeChecklistAnswer = answer([
  step(WelcomeStep.Monitor, { isNext: true }),
  step(WelcomeStep.OnCall),
  step(WelcomeStep.StatusPage),
  step(WelcomeStep.Team),
]);

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

function stepTile(key: string): HTMLElement | null {
  return screen.queryByTestId(`getting-started-task-${key}`);
}

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  legacyMock.mockResolvedValue(null);
  fetchMock.mockResolvedValue(NOTHING_DONE);
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

describe("the steps, from the keyboard", () => {
  test("every step to do is a button", async () => {
    await renderGettingStarted();

    for (const key of STEP_KEYS) {
      const tile: HTMLElement = stepTile(key)!;
      expect(tile.tagName).toBe("BUTTON");
      expect(tile).toHaveAttribute("type", "button");
    }
  });

  test("a step is named by what it asks, as a screen reader reads it", async () => {
    await renderGettingStarted();

    expect(
      screen.getByRole("button", { name: /^Create your first monitor/ }),
    ).toBe(stepTile(WelcomeStep.Monitor));
    expect(screen.getByRole("button", { name: /^Invite your team/ })).toBe(
      stepTile(WelcomeStep.Team),
    );
  });

  test("Tab reaches every step, in the order they are listed", async () => {
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    const reached: Array<string> = [];

    // Hide and Change come first; then the steps.
    for (let press: number = 0; press < 14; press++) {
      await user.tab();
      const key: string | undefined = STEP_KEYS.find((candidate: string) => {
        return document.activeElement === stepTile(candidate);
      });
      if (key && !reached.includes(key)) {
        reached.push(key);
      }
    }

    expect(reached).toEqual(STEP_KEYS);
  });

  test("Enter on a step opens the page it names", async () => {
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    stepTile(WelcomeStep.Team)!.focus();
    await user.keyboard("{Enter}");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(routeOf(PageMap.USERS));
  });

  test("Space on a step opens it too", async () => {
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    stepTile(WelcomeStep.Monitor)!.focus();
    await user.keyboard(" ");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      routeOf(PageMap.MONITOR_CREATE),
    );
    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/getting-started-task",
      { projectId: PROJECT_ID, task: WelcomeStep.Monitor },
    );
  });

  test("a done step is a record, not a control: no button, no tab stop", async () => {
    fetchMock.mockResolvedValue(
      answer([
        step(WelcomeStep.Monitor, { isDone: true }),
        step(WelcomeStep.OnCall, { isNext: true }),
        step(WelcomeStep.StatusPage),
        step(WelcomeStep.Team),
      ]),
    );
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    const done: HTMLElement = stepTile(WelcomeStep.Monitor)!;
    expect(done.tagName).toBe("DIV");
    expect(done).not.toHaveAttribute("role");
    expect(done).toHaveTextContent("Done");

    for (let press: number = 0; press < 14; press++) {
      await user.tab();
      expect(document.activeElement).not.toBe(done);
    }

    await user.click(done);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("the next step is marked, once, and said to a screen reader as part of its name", async () => {
    await renderGettingStarted();

    expect(screen.getAllByTestId("getting-started-next")).toHaveLength(1);
    expect(
      within(stepTile(WelcomeStep.Monitor)!).getByTestId(
        "getting-started-next",
      ),
    ).toHaveTextContent("Next step");
    expect(stepTile(WelcomeStep.Monitor)).toHaveAttribute("data-next", "true");
    expect(stepTile(WelcomeStep.OnCall)).toHaveAttribute("data-next", "false");
  });

  test("the progress counts what the server counted", async () => {
    fetchMock.mockResolvedValue(
      answer([
        step(WelcomeStep.Monitor, { isDone: true }),
        step(WelcomeStep.OnCall, { isDone: true }),
        step(WelcomeStep.StatusPage, { isNext: true }),
      ]),
    );
    await renderGettingStarted();

    const progress: string =
      within(screen.getByTestId("getting-started")).getByText(/steps completed/)
        .textContent || "";

    expect(progress).toContain("2");
    expect(progress).toContain("3");
  });
});

describe("a read that fails draws nothing, and remembers nothing", () => {
  test("an answer that did not come back: no card", async () => {
    fetchMock.mockResolvedValue(null);
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("welcome-question")).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("a read that throws: no card, and no error on the page", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("an answer with no steps: no card", async () => {
    fetchMock.mockResolvedValue(answer([]));
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("a finished checklist: no card, for anyone", async () => {
    fetchMock.mockResolvedValue(
      answer(
        STEP_KEYS.map((key: WelcomeStep) => {
          return step(key, { isDone: true });
        }),
        { isFinished: true },
      ),
    );
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("welcome-checklist-hidden")).toBeNull();
  });

  test("an invited member: no card - their own first hour plugs in there (#6807)", async () => {
    fetchMock.mockResolvedValue(
      answer([], {
        audience: WelcomeAudience.InvitedMember,
        canChooseGoals: false,
        shouldAskForGoals: true,
      }),
    );
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("welcome-question")).toBeNull();
  });

  test("nothing is kept in this browser but what the events saw: the old keys are gone", async () => {
    await renderGettingStarted();

    expect(
      window.localStorage.getItem(`getting-started-complete-${PROJECT_ID}`),
    ).toBeNull();
    expect(
      window.localStorage.getItem(`getting-started-dismissed-${PROJECT_ID}`),
    ).toBeNull();
  });

  test("the card is read once per project, however often the page draws it", async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};

    await act(async () => {
      rerender = render(
        <GettingStarted projectId={new ObjectID(PROJECT_ID)} />,
      ).rerender;
    });

    await act(async () => {
      rerender(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
