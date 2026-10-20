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
 * The welcome checklist on Home - the four steps that set a new project up -
 * failed two kinds of people:
 *
 *  - Keyboard users. Each step was a box with an onClick and role="button",
 *    but no tabindex and no key handler: Tab went past every step, and
 *    nothing pressed one. A step to do is now a real button; a step done is
 *    a record, not a control.
 *  - Anybody one of whose four checks failed. They ran in one Promise.all, so
 *    a single count that was refused (a role that may not read on-call
 *    policies) or that never came back hid the whole checklist. Each check
 *    now stands on its own: a step that could not be checked is left out of
 *    this visit, and the checklist goes only when no step could be checked -
 *    and it is never remembered as finished on a step nobody could check.
 *
 * The real component; ModelAPI.count answers per model, and may refuse.
 */

const navigateMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import GettingStarted from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

type UserEventController = ReturnType<typeof userEvent.setup>;

const PROJECT_ID: string = "65f00000000000000000eeee";

const STEP_KEYS: Array<string> = [
  "create-monitor",
  "create-status-page",
  "invite-team",
  "create-on-call-policy",
];

// The model each step counts.
const MODEL_OF_STEP: Record<string, string> = {
  "create-monitor": "Monitor",
  "create-status-page": "StatusPage",
  "invite-team": "TeamMember",
  "create-on-call-policy": "OnCallDutyPolicy",
};

// What each model's count says: a number, or a refusal.
type CountAnswer = number | "refused";

function answerCounts(answers: Record<string, CountAnswer>): void {
  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: { name: string } } = args[0] as {
      modelType: { name: string };
    };
    const answer: CountAnswer = answers[request.modelType.name] ?? 0;

    if (answer === "refused") {
      return Promise.reject(
        new Error("You do not have permission to read this resource."),
      );
    }

    return Promise.resolve(answer);
  });
}

// Every step still to do: no monitor, no status page, one member, no policy.
const NOTHING_DONE: Record<string, CountAnswer> = {
  Monitor: 0,
  StatusPage: 0,
  TeamMember: 1,
  OnCallDutyPolicy: 0,
};

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

function stepTile(key: string): HTMLElement | null {
  return screen.queryByTestId(`getting-started-task-${key}`);
}

function shownStepKeys(): Array<string> {
  return STEP_KEYS.filter((key: string): boolean => {
    return stepTile(key) !== null;
  });
}

function progressText(): string {
  return (
    within(screen.getByTestId("getting-started")).getByText(/steps completed/)
      .textContent || ""
  );
}

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

const COMPLETE_KEY: string = `getting-started-complete-${PROJECT_ID}`;

beforeEach(() => {
  window.localStorage.clear();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  answerCounts(NOTHING_DONE);
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
  countMock.mockReset();
  captureMock.mockReset();
  getCurrentProjectIdMock.mockReset();
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
    ).toBe(stepTile("create-monitor"));
    expect(screen.getByRole("button", { name: /^Invite your team/ })).toBe(
      stepTile("invite-team"),
    );
  });

  test("Tab reaches every step, in the order they are listed", async () => {
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    const reached: Array<string> = [];

    // Dismiss comes first in the card's header; then the steps.
    for (let press: number = 0; press < 12; press++) {
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

    stepTile("invite-team")!.focus();
    await user.keyboard("{Enter}");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(routeOf(PageMap.USERS));
  });

  test("Space on a step opens it too", async () => {
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    stepTile("create-monitor")!.focus();
    await user.keyboard(" ");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      routeOf(PageMap.MONITOR_CREATE),
    );
    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/getting-started-task",
      { projectId: PROJECT_ID, task: "create-monitor" },
    );
  });

  test("a done step is a record, not a control: no button, no tab stop", async () => {
    answerCounts({ ...NOTHING_DONE, Monitor: 2 });
    const user: UserEventController = userEvent.setup();
    await renderGettingStarted();

    const done: HTMLElement = stepTile("create-monitor")!;
    expect(done.tagName).toBe("DIV");
    expect(done).not.toHaveAttribute("role");
    expect(done).toHaveTextContent("Done");

    for (let press: number = 0; press < 12; press++) {
      await user.tab();
      expect(document.activeElement).not.toBe(done);
    }

    await user.click(done);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("a check that fails no longer takes the checklist with it", () => {
  test("a refused count leaves its step out, and the other three are shown", async () => {
    answerCounts({ ...NOTHING_DONE, OnCallDutyPolicy: "refused" });
    await renderGettingStarted();

    expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    expect(shownStepKeys()).toEqual([
      "create-monitor",
      "create-status-page",
      "invite-team",
    ]);
  });

  test("the progress counts the steps shown", async () => {
    answerCounts({
      ...NOTHING_DONE,
      Monitor: 1,
      OnCallDutyPolicy: "refused",
    });
    await renderGettingStarted();

    expect(progressText()).toContain("1");
    expect(progressText()).toContain("3");
    expect(progressText()).not.toContain("4");
  });

  test.each(STEP_KEYS)(
    "whichever step's check fails (%s), the rest are still there",
    async (failingStep: string) => {
      answerCounts({
        ...NOTHING_DONE,
        [MODEL_OF_STEP[failingStep]!]: "refused",
      });
      await renderGettingStarted();

      expect(shownStepKeys()).toEqual(
        STEP_KEYS.filter((key: string): boolean => {
          return key !== failingStep;
        }),
      );
    },
  );

  test("two failed checks leave two steps", async () => {
    answerCounts({
      ...NOTHING_DONE,
      StatusPage: "refused",
      TeamMember: "refused",
    });
    await renderGettingStarted();

    expect(shownStepKeys()).toEqual([
      "create-monitor",
      "create-on-call-policy",
    ]);
  });

  test("when no step could be checked, there is no checklist", async () => {
    answerCounts({
      Monitor: "refused",
      StatusPage: "refused",
      TeamMember: "refused",
      OnCallDutyPolicy: "refused",
    });
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(window.localStorage.getItem(COMPLETE_KEY)).toBeNull();
  });

  test("every step it could check is done: it goes for this visit, and is not remembered as finished", async () => {
    answerCounts({
      Monitor: 1,
      StatusPage: 1,
      TeamMember: 2,
      OnCallDutyPolicy: "refused",
    });
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    // The next visit checks again: the on-call step was never seen done.
    expect(window.localStorage.getItem(COMPLETE_KEY)).toBeNull();
  });

  test("every step checked and done is still remembered as finished", async () => {
    answerCounts({
      Monitor: 1,
      StatusPage: 1,
      TeamMember: 2,
      OnCallDutyPolicy: 1,
    });
    await renderGettingStarted();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(window.localStorage.getItem(COMPLETE_KEY)).not.toBeNull();
  });

  test("a step whose check failed opens nothing, because it is not there to open", async () => {
    answerCounts({ ...NOTHING_DONE, Monitor: "refused" });
    await renderGettingStarted();

    expect(stepTile("create-monitor")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Create your first monitor/ }),
    ).toBeNull();
  });
});
