import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import Navigation from "../../../UI/Utils/Navigation";
import DashboardHeader from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header";
import MyReadiness, {
  parseUserReadiness,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/MyReadiness";
import {
  NOTIFICATION_SETUP_NUDGE_HIDDEN_FOR_IN_MS,
  NOTIFICATION_SETUP_NUDGE_HIDDEN_KEY_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/NotificationSetupNudge";
import { NOTIFICATION_SETUP_REREAD_AFTER_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Header/useNotificationSetupNudge";

/*
 * "FINISH SETTING UP YOUR NOTIFICATIONS", IN THE DASHBOARD'S BELL (#7040),
 * on the real header and bell: shown while the person is on an on-call
 * policy and OneUptime cannot fully reach them - by the rule the setup
 * reminder and Readiness use - under On-Call, with why, one click to the
 * page that fixes it and Hide; gone once it is fixed. Only the readiness
 * route and the header's own reads are answered here.
 */

const getMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const currentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string } | undefined)?.message || "";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {
          tenantid: currentProjectIdMock()?.toString(),
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectIdMock();
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: () => {
        return () => {};
      },
    },
  };
});

const USER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { count?: number }): string => {
          return options?.count === undefined ? key : `${key}:${options.count}`;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/ProjectPicker",
  () => {
    return () => {
      return null;
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/UserProfile",
  () => {
    return () => {
      return null;
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/Logo",
  () => {
    return () => {
      return null;
    };
  },
);

const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";

const TITLE: string = "Finish setting up your notifications";

interface ReadinessAnswer {
  status: "Ready" | "PartiallyReady" | "NotReachable";
  reachedVia?: Array<string>;
  isMissingPhoneMethod?: boolean;
}

// What each project's readiness route answers for the person, or fails with.
let readinessByProject: Record<string, ReadinessAnswer | Error>;

function readinessJson(answer: ReadinessAnswer): JSONObject {
  return {
    userId: USER_ID,
    userName: "Ana",
    userEmail: "ana@example.com",
    status: answer.status,
    methods: [],
    coverage: [],
    reasons: [],
    reachedVia: answer.reachedVia || ["Schedule"],
    teams: [],
    ...(answer.isMissingPhoneMethod ? { isMissingPhoneMethod: true } : {}),
  };
}

function isReadinessRequest(args: Array<unknown>): boolean {
  const request: { url?: { toString: () => string } } | undefined = args[0] as
    | { url?: { toString: () => string } }
    | undefined;

  return Boolean(request?.url?.toString().includes("/on-call-readiness/user/"));
}

function readinessRequests(): Array<Array<unknown>> {
  return getMock.mock.calls.filter((args: Array<unknown>): boolean => {
    return isReadinessRequest(args);
  });
}

function project(id: string): Project {
  const result: Project = new Project();
  result.id = new ObjectID(id);
  result.name = "Example project";
  return result;
}

function header(selectedProject: Project | null): ReactElement {
  return (
    <DashboardHeader
      projects={selectedProject ? [selectedProject] : []}
      onProjectSelected={() => {}}
      showProjectModal={false}
      onProjectModalClose={() => {}}
      selectedProject={selectedProject}
    />
  );
}

function selectCurrentProject(id: string | null): void {
  currentProjectIdMock.mockImplementation(() => {
    return id ? new ObjectID(id) : null;
  });
}

async function renderHeader(id: string = PROJECT_A): Promise<{
  rerender: (element: ReactElement) => void;
}> {
  selectCurrentProject(id);
  const view: ReturnType<typeof render> = render(header(project(id)));
  await act(async () => {});
  return { rerender: view.rerender };
}

function openBell(): void {
  fireEvent.click(screen.getByRole("button", { name: "View notifications" }));
}

function badge(): HTMLElement | null {
  const bell: HTMLElement = screen.getByRole("button", {
    name: "View notifications",
  });

  return bell.parentElement!.querySelector("span.rounded-full");
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.clearAllMocks();
  MyReadiness.clear();
  window.localStorage.clear();
  readinessByProject = {};
  selectCurrentProject(PROJECT_A);

  getMock.mockImplementation(async (...args: Array<unknown>) => {
    if (isReadinessRequest(args)) {
      const tenant: string = (args[0] as { headers: { tenantid: string } })
        .headers.tenantid;
      const answer: ReadinessAnswer | Error | undefined =
        readinessByProject[tenant];

      if (!answer || answer instanceof Error) {
        return new HTTPErrorResponse(
          500,
          { message: "The readiness read failed." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, readinessJson(answer), {});
    }

    return new HTTPResponse<JSONObject>(
      200,
      {
        escalationRulesByUser: [],
        escalationRulesByTeam: [],
        escalationRulesBySchedule: [],
      },
      {},
    );
  });
  countMock.mockResolvedValue(0);

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the bell asks somebody on call whom OneUptime cannot fully reach", () => {
  test("nothing reaches them: the item, under On-Call, says so, and opens the setup checklist", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };

    await renderHeader();

    // One read of their own readiness, in the project open.
    expect(readinessRequests()).toHaveLength(1);
    expect(
      (readinessRequests()[0]![0] as { url: Route }).url.toString(),
    ).toContain(`/on-call-readiness/user/${USER_ID}`);
    expect(
      (readinessRequests()[0]![0] as { headers: { tenantid: string } }).headers
        .tenantid,
    ).toBe(PROJECT_A);

    // An amber badge counts it: nothing more urgent is there.
    expect(badge()).toHaveTextContent("1");
    expect(badge()).toHaveClass("bg-amber-600");

    openBell();

    const item: HTMLElement = screen.getByTestId(
      "notification-bell-item-notificationSetup",
    );

    expect(item).toHaveTextContent(TITLE);
    expect(
      screen.getByTestId(
        "notification-bell-item-notificationSetup-description",
      ),
    ).toHaveTextContent("Nothing can reach you yet.");

    // Under On-Call, the part of the bell about the person's duty.
    const section: HTMLElement = item.closest("div.py-2") as HTMLElement;
    expect(within(section).getByText("On-Call")).toBeInTheDocument();

    fireEvent.click(item);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_A}/user-settings/setup`,
    );
  });

  test("a severity with no rule of theirs: the item says so", async () => {
    readinessByProject[PROJECT_A] = { status: "PartiallyReady" };

    await renderHeader();
    openBell();

    expect(
      screen.getByTestId(
        "notification-bell-item-notificationSetup-description",
      ),
    ).toHaveTextContent("Some severities have no notification rule yet.");
  });

  test("Ready, with no phone method the project asks for (#7449): the item opens How to Reach Me", async () => {
    readinessByProject[PROJECT_A] = {
      status: "Ready",
      isMissingPhoneMethod: true,
    };

    await renderHeader();
    openBell();

    expect(
      screen.getByTestId(
        "notification-bell-item-notificationSetup-description",
      ),
    ).toHaveTextContent(
      "This project asks everyone on call to have a phone method.",
    );

    fireEvent.click(
      screen.getByTestId("notification-bell-item-notificationSetup"),
    );

    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_A}/user-settings/on-call-rules`,
    );
  });

  test("an active incident outranks it in the badge, and the item still shows", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };
    countMock.mockImplementation(async (...args: Array<unknown>) => {
      const modelType: { name?: string } | undefined = (
        args[0] as { modelType?: { name?: string } }
      )?.modelType;

      return modelType?.name === "Incident" ? 2 : 0;
    });

    await renderHeader();

    expect(badge()).toHaveClass("bg-red-500");

    openBell();
    expect(
      screen.getByTestId("notification-bell-item-notificationSetup"),
    ).toBeInTheDocument();
  });
});

describe("the bell asks nothing", () => {
  test("of somebody who can be reached", async () => {
    readinessByProject[PROJECT_A] = { status: "Ready" };

    await renderHeader();

    expect(badge()).toBeNull();
    openBell();
    expect(
      screen.queryByTestId("notification-bell-item-notificationSetup"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });

  test("of somebody on no on-call policy, however unreachable", async () => {
    readinessByProject[PROJECT_A] = {
      status: "NotReachable",
      reachedVia: [],
    };

    await renderHeader();
    openBell();

    expect(
      screen.queryByTestId("notification-bell-item-notificationSetup"),
    ).not.toBeInTheDocument();
  });

  test("when their readiness could not be read: it claims nothing", async () => {
    readinessByProject[PROJECT_A] = new Error("down");

    await renderHeader();
    openBell();

    expect(
      screen.queryByTestId("notification-bell-item-notificationSetup"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });
});

describe("Hide puts it away, and fixing it takes it away", () => {
  test("Hide puts it away for a week, in this browser, and takes it off the badge", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };

    await renderHeader();
    openBell();

    const hide: HTMLElement = screen.getByTestId(
      "notification-bell-item-notificationSetup-dismiss",
    );

    expect(hide).toHaveAccessibleName("Hide for a week");

    const before: number = Date.now();

    fireEvent.click(hide);

    expect(
      screen.queryByTestId("notification-bell-item-notificationSetup"),
    ).not.toBeInTheDocument();
    expect(badge()).toBeNull();
    // Hiding it opened nothing.
    expect(navigateSpy).not.toHaveBeenCalled();

    const stored: number = Number(
      window.localStorage.getItem(
        `${NOTIFICATION_SETUP_NUDGE_HIDDEN_KEY_PREFIX}${USER_ID}:${PROJECT_A}`,
      ),
    );

    expect(stored).toBeGreaterThanOrEqual(
      before + NOTIFICATION_SETUP_NUDGE_HIDDEN_FOR_IN_MS,
    );

    // A page loaded again within the week asks nothing either.
    cleanup();
    await renderHeader();
    expect(badge()).toBeNull();
  });

  test("a week later it asks again, while it is still so", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };
    window.localStorage.setItem(
      `${NOTIFICATION_SETUP_NUDGE_HIDDEN_KEY_PREFIX}${USER_ID}:${PROJECT_A}`,
      String(Date.now() - 1000),
    );

    await renderHeader();

    expect(badge()).toHaveTextContent("1");
  });

  test("hidden in one project, it still asks in another", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };
    readinessByProject[PROJECT_B] = { status: "NotReachable" };
    window.localStorage.setItem(
      `${NOTIFICATION_SETUP_NUDGE_HIDDEN_KEY_PREFIX}${USER_ID}:${PROJECT_A}`,
      String(Date.now() + NOTIFICATION_SETUP_NUDGE_HIDDEN_FOR_IN_MS),
    );

    await renderHeader(PROJECT_B);

    expect(badge()).toHaveTextContent("1");
  });

  test("a fresh read from the setup checklist that says they can be reached takes it away at once", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };

    await renderHeader();
    expect(badge()).toHaveTextContent("1");

    // The checklist's Recheck, after the person verified a phone.
    await act(async () => {
      MyReadiness.record({
        projectId: PROJECT_A,
        userId: USER_ID,
        readiness: parseUserReadiness(readinessJson({ status: "Ready" }))!,
      });
    });

    expect(badge()).toBeNull();
  });

  test("moving to another page reads again once the last read is a minute old, never sooner", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };

    const view: { rerender: (element: ReactElement) => void } =
      await renderHeader();
    expect(readinessRequests()).toHaveLength(1);

    // A move within the minute reads nothing.
    window.history.pushState({}, "", `/dashboard/${PROJECT_A}/monitors`);
    view.rerender(header(project(PROJECT_A)));
    await act(async () => {});
    expect(readinessRequests()).toHaveLength(1);

    // Fixed meanwhile, and a minute later the person moves on.
    readinessByProject[PROJECT_A] = { status: "Ready" };
    const now: number = Date.now();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(now + NOTIFICATION_SETUP_REREAD_AFTER_IN_MS + 1);

    window.history.pushState({}, "", `/dashboard/${PROJECT_A}/incidents`);
    view.rerender(header(project(PROJECT_A)));
    await act(async () => {});

    expect(readinessRequests()).toHaveLength(2);
    expect(badge()).toBeNull();
  });

  test("another project's answer is never shown in this one", async () => {
    readinessByProject[PROJECT_A] = { status: "NotReachable" };
    readinessByProject[PROJECT_B] = { status: "Ready" };

    const view: { rerender: (element: ReactElement) => void } =
      await renderHeader();
    expect(badge()).toHaveTextContent("1");

    selectCurrentProject(PROJECT_B);
    view.rerender(header(project(PROJECT_B)));
    await act(async () => {});

    expect(badge()).toBeNull();
    expect(
      (readinessRequests()[1]![0] as { headers: { tenantid: string } }).headers
        .tenantid,
    ).toBe(PROJECT_B);
  });
});
