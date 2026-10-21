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
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Where each Getting Started step on Home takes a new user.
 *
 * Two steps used to land in the wrong place:
 *
 *  - "Invite your team" opened Teams: a list of the three built-in teams with
 *    a "Create Team" button and no way to invite anybody. The Invite User
 *    button is on Users.
 *  - "Create your first monitor" opened the (empty) Monitors list, one click
 *    short of the form the step names. It now opens the create form - but
 *    only for somebody who may create a monitor. Anybody else still lands on
 *    the list, where the Create Monitor button is shown locked with the
 *    permission it needs (issue #3306: a create form that fails at submit is
 *    worse than one you are never sent to).
 *
 * The real component is mounted; ModelAPI.count decides which steps are done,
 * and PermissionGate.check is spied so each test says who is looking.
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
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "65f00000000000000000bbbb";

type CountFor = (modelName: string) => number;

// Every step still to do: no monitor, no status page, one member, no policy.
const NOTHING_DONE: CountFor = (): number => {
  return 0;
};

function answerCounts(countFor: CountFor): void {
  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: { name: string } } = args[0] as {
      modelType: { name: string };
    };
    return Promise.resolve(countFor(request.modelType.name));
  });
}

let checkSpy: SpyInstance<typeof PermissionGate.check>;

function allowMonitorCreate(isAllowed: boolean): void {
  checkSpy.mockImplementation((): PermissionGateResult => {
    return isAllowed
      ? { isAllowed: true }
      : {
          isAllowed: false,
          disabledReason: "You do not have permission to create this Monitor.",
        };
  });
}

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

function openStep(key: string): string {
  fireEvent.click(screen.getByTestId(`getting-started-task-${key}`));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return String(navigateMock.mock.calls[0]![0]);
}

beforeEach(() => {
  window.localStorage.clear();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  answerCounts(NOTHING_DONE);
  checkSpy = jest.spyOn(PermissionGate, "check");
  allowMonitorCreate(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  navigateMock.mockReset();
  countMock.mockReset();
  captureMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("Getting Started: Invite your team", () => {
  test("opens Users, where Invite User is", async () => {
    await renderGettingStarted();

    const route: string = openStep("invite-team");

    expect(route).toBe(routeOf(PageMap.USERS));
  });

  test("no longer opens Teams, which cannot invite anybody", async () => {
    await renderGettingStarted();

    const route: string = openStep("invite-team");

    expect(route).not.toBe(routeOf(PageMap.TEAMS));
    expect(route.endsWith("/teams")).toBe(false);
  });

  test("goes there for everyone: inviting has no create form to gate", async () => {
    allowMonitorCreate(false);
    await renderGettingStarted();

    openStep("invite-team");

    expect(checkSpy).not.toHaveBeenCalled();
  });

  test("the route carries the current project id", async () => {
    await renderGettingStarted();

    const route: string = openStep("invite-team");

    expect(route).toBe(`/dashboard/${PROJECT_ID}/users`);
    expect(route).not.toContain(":projectId");
  });

  test("still reports which step was opened", async () => {
    await renderGettingStarted();

    openStep("invite-team");

    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/getting-started-task",
      { projectId: PROJECT_ID, task: "invite-team" },
    );
  });
});

describe("Getting Started: Create your first monitor", () => {
  test("opens the create form for someone who may create a monitor", async () => {
    allowMonitorCreate(true);
    await renderGettingStarted();

    const route: string = openStep("create-monitor");

    expect(route).toBe(routeOf(PageMap.MONITOR_CREATE));
    expect(route).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
  });

  test("asks the permission gate about creating a Monitor, and nothing else", async () => {
    await renderGettingStarted();

    openStep("create-monitor");

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy).toHaveBeenCalledWith(
      expect.any(Monitor),
      ModelAction.Create,
    );
  });

  test("lands anyone else on the Monitors list, not in a form they cannot submit", async () => {
    allowMonitorCreate(false);
    await renderGettingStarted();

    const route: string = openStep("create-monitor");

    expect(route).toBe(routeOf(PageMap.MONITORS));
    expect(route).not.toBe(routeOf(PageMap.MONITOR_CREATE));
  });

  test("an unknown permission snapshot (not loaded yet) is not a yes", async () => {
    checkSpy.mockImplementation((): PermissionGateResult => {
      return { isAllowed: false };
    });
    await renderGettingStarted();

    expect(openStep("create-monitor")).toBe(routeOf(PageMap.MONITORS));
  });

  test("the permission is read at the click, not when Home first rendered", async () => {
    allowMonitorCreate(false);
    await renderGettingStarted();
    expect(checkSpy).not.toHaveBeenCalled();

    // The snapshot arrives after the first paint (a response header).
    allowMonitorCreate(true);

    expect(openStep("create-monitor")).toBe(routeOf(PageMap.MONITOR_CREATE));
  });

  test("still reports which step was opened", async () => {
    await renderGettingStarted();

    openStep("create-monitor");

    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/getting-started-task",
      { projectId: PROJECT_ID, task: "create-monitor" },
    );
  });

  test("a finished step goes nowhere and asks nothing", async () => {
    answerCounts((modelName: string): number => {
      return modelName === "Monitor" ? 1 : 0;
    });
    await renderGettingStarted();

    fireEvent.click(screen.getByTestId("getting-started-task-create-monitor"));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });
});

describe("Getting Started: the other steps are unchanged", () => {
  test.each([
    ["create-status-page", PageMap.STATUS_PAGES],
    ["create-on-call-policy", PageMap.ON_CALL_DUTY],
  ])(
    "%s opens its product in the current project",
    async (key: string, pageMap: PageMap) => {
      await renderGettingStarted();

      const route: string = openStep(key);

      expect(route).toBe(routeOf(pageMap));
      expect(route).toContain(PROJECT_ID);
      expect(checkSpy).not.toHaveBeenCalled();
      expect(captureMock).toHaveBeenCalledWith(
        "dashboard/home/getting-started-task",
        { projectId: PROJECT_ID, task: key },
      );
    },
  );

  test("the four steps are still offered, in the same order", async () => {
    await renderGettingStarted();

    const keys: Array<string> = screen
      .getAllByTestId(/^getting-started-task-/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      });

    expect(keys).toEqual([
      "getting-started-task-create-monitor",
      "getting-started-task-create-status-page",
      "getting-started-task-invite-team",
      "getting-started-task-create-on-call-policy",
    ]);
  });
});
