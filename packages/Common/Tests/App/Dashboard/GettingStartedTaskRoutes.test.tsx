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
 * Where each step of the Welcome checklist on Home takes a person (issue
 * #6803), and what it records:
 *
 *  - "Invite your team" opens Users, where Invite User is - never Teams,
 *    which cannot invite anybody.
 *  - "Create your first monitor" opens the create form, but only for
 *    somebody who may create a monitor, decided at the click; anybody else
 *    lands on the list, where the button is locked with the reason (#3306).
 *  - Every other step opens today's page for its job: on-call, status pages,
 *    the importer (saying it was opened from here), Logs, Hosts.
 *  - The server's email opens the Admin Dashboard in a new tab.
 *  - A step the plan holds back says so before the click, and opens Billing.
 *  - A step started from here is carried to the page its record lands on,
 *    with the step after it (WelcomeNextStep).
 *  - Each click sends home/checklist_step_started, with the goals, and the
 *    event sent before the rule.
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
  getStepAfter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import { ADMIN_SERVER_SETUP_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog";
import { STEP_IN_PROGRESS_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeStepInProgress";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
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
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "65f00000000000000000cccc";

function step(
  key: WelcomeStep,
  extra?: Partial<WelcomeChecklistStepState>,
): WelcomeChecklistStepState {
  return { step: key, isDone: false, needsPlan: null, isNext: false, ...extra };
}

function answer(
  steps: Array<WelcomeChecklistStepState>,
  goals: Array<ProjectGoal> | null = [ProjectGoal.Uptime],
): WelcomeChecklistAnswer {
  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: goals,
    canChooseGoals: true,
    steps: steps,
    doneCount: 0,
    totalCount: steps.length,
  };
}

// Every step there is, none done, so each can be clicked.
const EVERY_STEP: WelcomeChecklistAnswer = answer(
  [
    step(WelcomeStep.ServerEmail, { isNext: true }),
    step(WelcomeStep.Import),
    step(WelcomeStep.Monitor),
    step(WelcomeStep.Infrastructure),
    step(WelcomeStep.Telemetry),
    step(WelcomeStep.OnCall),
    step(WelcomeStep.StatusPage),
    step(WelcomeStep.Team),
  ],
  [ProjectGoal.Uptime, ProjectGoal.StatusPage],
);

let mayCreate: boolean | undefined;
let checkSpy: SpyInstance<typeof PermissionGate.check>;

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

function click(key: WelcomeStep): void {
  fireEvent.click(screen.getByTestId(`getting-started-task-${key}`));
}

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

function navigatedTo(): string {
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return String(navigateMock.mock.calls[0]![0]);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mayCreate = true;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  legacyMock.mockResolvedValue(null);
  fetchMock.mockResolvedValue(EVERY_STEP);
  checkSpy = jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      // Not loaded yet: not allowed, with nothing to say why.
      return mayCreate === undefined
        ? { isAllowed: false }
        : mayCreate
          ? { isAllowed: true }
          : {
              isAllowed: false,
              disabledReason: "You need the Create Monitor permission.",
            };
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

describe("Invite your team", () => {
  test("opens Users, where Invite User is", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Team);

    expect(navigatedTo()).toBe(routeOf(PageMap.USERS));
  });

  test("no longer opens Teams, which cannot invite anybody", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Team);

    expect(navigatedTo()).not.toBe(routeOf(PageMap.TEAMS));
  });

  test("goes there for everyone: inviting has no create form to gate", async () => {
    mayCreate = false;
    await renderGettingStarted();
    click(WelcomeStep.Team);

    expect(navigatedTo()).toBe(routeOf(PageMap.USERS));
  });

  test("the route carries the current project id", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Team);

    expect(navigatedTo()).toContain(PROJECT_ID);
    expect(navigatedTo()).not.toContain(":projectId");
  });

  test("on the Free plan, says which plan it needs before the click, and opens Billing", async () => {
    fetchMock.mockResolvedValue(
      answer([
        step(WelcomeStep.Monitor, { isNext: true }),
        step(WelcomeStep.Team, { needsPlan: PlanType.Growth }),
      ]),
    );
    await renderGettingStarted();

    expect(
      screen.getByTestId(`getting-started-task-${WelcomeStep.Team}-needs-plan`),
    ).toHaveTextContent("Needs the Growth plan");
    expect(
      screen.getByTestId(`getting-started-task-${WelcomeStep.Team}`),
    ).toHaveTextContent(
      "The Free plan has one person. Upgrade to the Growth plan to invite your team.",
    );

    click(WelcomeStep.Team);

    expect(navigatedTo()).toBe(routeOf(PageMap.SETTINGS_BILLING));
    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.ChecklistStepStarted,
      { step: WelcomeStep.Team, goals: "uptime", needs_plan: PlanType.Growth },
    );
  });
});

describe("Create your first monitor", () => {
  /*
   * The guided setup (#6804) takes the step over: an address, who is told
   * and a test page on one page - for somebody who may create a monitor,
   * since its first step makes one.
   */
  test("opens the guided setup for someone who may create a monitor", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Monitor);

    expect(navigatedTo()).toBe(routeOf(PageMap.MONITOR_GUIDED_SETUP));
    expect(navigatedTo()).not.toBe(routeOf(PageMap.MONITOR_CREATE));
  });

  test("asks the permission gate about creating a Monitor, and nothing else", async () => {
    await renderGettingStarted();
    checkSpy.mockClear();
    click(WelcomeStep.Monitor);

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(
      (checkSpy.mock.calls[0]![0] as PermissionCheckableModel).constructor.name,
    ).toBe("Monitor");
  });

  test("lands anyone else on the Monitors list, not in a form they cannot submit", async () => {
    mayCreate = false;
    await renderGettingStarted();
    click(WelcomeStep.Monitor);

    expect(navigatedTo()).toBe(routeOf(PageMap.MONITORS));
  });

  test("an unknown permission snapshot (not loaded yet) is not a yes", async () => {
    mayCreate = undefined;
    await renderGettingStarted();
    click(WelcomeStep.Monitor);

    expect(navigatedTo()).toBe(routeOf(PageMap.MONITORS));
  });

  test("the permission is read at the click, not when Home first rendered", async () => {
    mayCreate = false;
    await renderGettingStarted();
    mayCreate = true;
    click(WelcomeStep.Monitor);

    expect(navigatedTo()).toBe(routeOf(PageMap.MONITOR_GUIDED_SETUP));
  });
});

describe("Set up an on-call policy", () => {
  /*
   * The guided setup (#6805) takes the step over: how you are reached, who
   * else is on call, what if nobody answers and a test page, on one page.
   * It is for everyone: its first step is the person's own methods, and it
   * says itself what a member who may not make a policy can do.
   */
  test("opens the guided setup, whoever clicks it", async () => {
    mayCreate = false;
    await renderGettingStarted();
    click(WelcomeStep.OnCall);

    expect(navigatedTo()).toBe(routeOf(PageMap.ON_CALL_DUTY_GUIDED_SETUP));
    expect(navigatedTo()).not.toBe(routeOf(PageMap.ON_CALL_DUTY));
  });

  test("carries nothing: the setup says what is next", async () => {
    await renderGettingStarted();
    click(WelcomeStep.OnCall);

    expect(window.sessionStorage.getItem(STEP_IN_PROGRESS_KEY)).toBeNull();
  });
});

describe("Publish a status page", () => {
  /*
   * The guided setup (#6806) takes the step over: a name, the monitors it
   * shows and what customers see on one page - for somebody who may create
   * a status page, since its first step makes one.
   */
  test("opens the guided setup for someone who may create a status page", async () => {
    await renderGettingStarted();
    click(WelcomeStep.StatusPage);

    expect(navigatedTo()).toBe(routeOf(PageMap.STATUS_PAGES_GUIDED_SETUP));
  });

  test("asks the permission gate about creating a StatusPage", async () => {
    await renderGettingStarted();
    checkSpy.mockClear();
    click(WelcomeStep.StatusPage);

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(
      (checkSpy.mock.calls[0]![0] as PermissionCheckableModel).constructor.name,
    ).toBe("StatusPage");
  });

  test("lands anyone else on the Status Pages list", async () => {
    mayCreate = false;
    await renderGettingStarted();
    click(WelcomeStep.StatusPage);

    expect(navigatedTo()).toBe(routeOf(PageMap.STATUS_PAGES));
  });

  test("carries nothing: the setup says what is next", async () => {
    await renderGettingStarted();
    click(WelcomeStep.StatusPage);

    expect(window.sessionStorage.getItem(STEP_IN_PROGRESS_KEY)).toBeNull();
  });
});

describe("Send your first logs, metrics or traces", () => {
  // The guided setup (#6806): the guide, the first data, then alerts on it.
  test("opens the guided setup, which carries nothing", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Telemetry);

    expect(navigatedTo()).toBe(routeOf(PageMap.SERVICES_GUIDED_SETUP));
    expect(window.sessionStorage.getItem(STEP_IN_PROGRESS_KEY)).toBeNull();
  });
});

describe("every other step opens today's page for its job", () => {
  test.each([[WelcomeStep.Infrastructure, PageMap.HOSTS]])(
    "%s opens %s",
    async (key: WelcomeStep, pageMap: PageMap) => {
      await renderGettingStarted();
      click(key);

      expect(navigatedTo()).toBe(routeOf(pageMap));
    },
  );

  test("importing opens the importer, saying it was opened from the checklist", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Import);

    expect(navigatedTo()).toBe(
      `${routeOf(PageMap.SETTINGS_IMPORT_FROM_TOOL)}?from=welcome`,
    );
  });

  test("the server's email opens the Admin Dashboard's server setup in a new tab", async () => {
    await renderGettingStarted();
    click(WelcomeStep.ServerEmail);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toContain(
      `/admin${ADMIN_SERVER_SETUP_ROUTE}`,
    );
    expect(navigateMock.mock.calls[0]![1]).toEqual({ openInNewTab: true });
  });
});

describe("what a click records", () => {
  test("home/checklist_step_started with the step and the goals, and the event sent before the rule", async () => {
    await renderGettingStarted();
    click(WelcomeStep.StatusPage);

    expect(sendMock).toHaveBeenCalledWith(
      ProductEventName.ChecklistStepStarted,
      { step: WelcomeStep.StatusPage, goals: "uptime.status_page" },
    );
    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/getting-started-task",
      { projectId: PROJECT_ID, task: WelcomeStep.StatusPage },
    );
  });

  /*
   * No step of the catalog lands on a record's page of its own since the
   * guided setups (#6804, #6805, #6806): what a landing carries is held in
   * WelcomeNextStep.test.tsx.
   */
  test("a step that opens a guided setup carries nothing: the setup says what is next", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Monitor);

    expect(window.sessionStorage.getItem(STEP_IN_PROGRESS_KEY)).toBeNull();
  });

  /*
   * What a landing page names as next (getStepAfter): no step of the
   * catalog lands on a page of its own since the guided setups, so it is
   * read here as the page would read it.
   */
  test("the step after the last one left wraps round to one still to do", () => {
    const steps: Array<WelcomeChecklistStepState> = answer([
      step(WelcomeStep.Monitor, { isNext: true }),
      step(WelcomeStep.StatusPage),
      step(WelcomeStep.OnCall),
    ]).steps;

    expect(getStepAfter(steps, WelcomeStep.OnCall)).toBe(WelcomeStep.Monitor);
    expect(getStepAfter(steps, WelcomeStep.Monitor)).toBe(
      WelcomeStep.StatusPage,
    );
  });

  test("a step with nothing to land on carries nothing", async () => {
    await renderGettingStarted();
    click(WelcomeStep.Team);

    expect(window.sessionStorage.getItem(STEP_IN_PROGRESS_KEY)).toBeNull();
  });
});

describe("a finished step", () => {
  test("goes nowhere and asks nothing", async () => {
    fetchMock.mockResolvedValue(
      answer([
        step(WelcomeStep.Monitor, { isDone: true }),
        step(WelcomeStep.OnCall, { isNext: true }),
      ]),
    );
    await renderGettingStarted();
    checkSpy.mockClear();

    fireEvent.click(
      screen.getByTestId(`getting-started-task-${WelcomeStep.Monitor}`),
    );

    expect(navigateMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalledWith(
      ProductEventName.ChecklistStepStarted,
      expect.anything(),
    );
    expect(checkSpy).not.toHaveBeenCalled();
  });
});

describe("the steps a project that skipped gets", () => {
  test("are the four it always had, in How OneUptime works' order", async () => {
    fetchMock.mockResolvedValue(
      answer(
        [
          step(WelcomeStep.Monitor, { isNext: true }),
          step(WelcomeStep.OnCall),
          step(WelcomeStep.StatusPage),
          step(WelcomeStep.Team),
        ],
        [],
      ),
    );
    await renderGettingStarted();

    expect(
      screen
        .getAllByTestId(/^getting-started-task-[a-z_]+$/)
        .map((tile: HTMLElement): string | null => {
          return tile.getAttribute("data-testid");
        }),
    ).toEqual([
      "getting-started-task-monitor",
      "getting-started-task-on_call",
      "getting-started-task-status_page",
      "getting-started-task-team",
    ]);
  });
});
