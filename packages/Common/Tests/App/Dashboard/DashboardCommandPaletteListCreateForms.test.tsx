import {
  afterEach,
  beforeAll,
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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";

/*
 * Search's actions that open a list's create form (#7035): Create Status
 * Page, Create On-Call Policy, Create On-Call Schedule, Create Dashboard,
 * Create Workflow and Invite User. Each opens its list with ?create=1, which
 * the list's table reads to open the form; each is offered only to someone
 * who may create the list's record, and only while searching.
 */

const navigateMock: MockFunction = getJestMockFunction();
const isOnThisPageMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const getAllPermissionsMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, defaultValue?: string): string => {
          return defaultValue ?? key;
        },
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// The project's people (#7036) are not what this file is about.
jest.mock("../../../UI/Utils/ProjectMemberSearch", () => {
  return {
    __esModule: true,
    default: {
      search: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: (...args: Array<unknown>) => {
        return isOnThisPageMock(...args);
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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (...args: Array<unknown>) => {
        return getAllPermissionsMock(...args);
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (...args: Array<unknown>) => {
        return isMasterAdminMock(...args);
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
      getCurrentProject: (): null => {
        return null;
      },
    },
  };
});

const PROJECT: string = "65f0000000000000000000aa";

interface ListCreate {
  id: string;
  title: string;
  query: string;
  path: string;
  // A permission that lets someone create there, and nothing else of these.
  permission: Permission;
}

const LIST_CREATES: Array<ListCreate> = [
  {
    id: "action-create-status-page",
    title: "Create Status Page",
    query: "create status page",
    path: `/dashboard/${PROJECT}/status-pages?create=1`,
    permission: Permission.CreateProjectStatusPage,
  },
  {
    id: "action-create-on-call-policy",
    title: "Create On-Call Policy",
    query: "create on-call policy",
    path: `/dashboard/${PROJECT}/on-call-duty/policies?create=1`,
    permission: Permission.CreateProjectOnCallDutyPolicy,
  },
  {
    id: "action-create-on-call-schedule",
    title: "Create On-Call Schedule",
    query: "create on-call schedule",
    path: `/dashboard/${PROJECT}/on-call-duty/schedules?create=1`,
    permission: Permission.CreateProjectOnCallDutyPolicySchedule,
  },
  {
    id: "action-create-dashboard",
    title: "Create Dashboard",
    query: "create dashboard",
    path: `/dashboard/${PROJECT}/dashboards?create=1`,
    permission: Permission.CreateDashboard,
  },
  {
    id: "action-create-workflow",
    title: "Create Workflow",
    query: "create workflow",
    path: `/dashboard/${PROJECT}/workflows?create=1`,
    permission: Permission.CreateWorkflow,
  },
  {
    id: "action-invite-user",
    title: "Invite User",
    query: "invite user",
    path: `/dashboard/${PROJECT}/users?create=1`,
    permission: Permission.InviteProjectTeamMembers,
  },
];

function palette(): HTMLElement | null {
  return screen.queryByTestId("command-palette");
}

function option(id: string): HTMLElement | null {
  return screen.queryByTestId(`command-palette-option-${id}`);
}

function openPalette(): void {
  fireEvent.keyDown(document.body, { key: "k", metaKey: true });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function search(text: string): Promise<void> {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: text },
  });
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  await settle();
}

// The ids of the rows Search lists, in order.
function listedIds(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid^="command-palette-option-"]',
    ),
  ).map((element: HTMLElement): string => {
    return (element.getAttribute("data-testid") || "").replace(
      "command-palette-option-",
      "",
    );
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT));
  getAllPermissionsMock.mockReturnValue([]);
  isMasterAdminMock.mockReturnValue(false);
  isOnThisPageMock.mockReturnValue(false);
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
  (globalThis as unknown as { fetch: unknown }).fetch =
    (): Promise<unknown> => {
      return Promise.reject(new Error("offline"));
    };
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  navigateMock.mockReset();
  isOnThisPageMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getAllPermissionsMock.mockReset();
  isMasterAdminMock.mockReset();
});

describe("Search opens a list's create form (#7035)", () => {
  test.each(LIST_CREATES)(
    "$title is found by its name and opens its list with ?create=1",
    async (listCreate: ListCreate) => {
      getAllPermissionsMock.mockReturnValue([listCreate.permission]);

      render(<DashboardCommandPalette />);
      openPalette();
      await search(listCreate.query);

      const row: HTMLElement | null = option(listCreate.id);
      expect(row).toHaveTextContent(listCreate.title);
      // The best match for its own name.
      expect(listedIds()[0]).toBe(listCreate.id);

      fireEvent.click(row!);

      expect(navigateMock).toHaveBeenCalledTimes(1);
      const [to, options] = navigateMock.mock.calls[0] as [
        Route,
        { replace: boolean },
      ];
      expect(to).toBeInstanceOf(Route);
      expect(to.toString()).toBe(listCreate.path);
      expect(options).toEqual({ replace: false });
      expect(palette()).toBeNull();
    },
  );

  test.each(LIST_CREATES)(
    "$title is not offered to a member who may not create there",
    async (listCreate: ListCreate) => {
      // They read everything here, and create none of it.
      getAllPermissionsMock.mockReturnValue([
        Permission.Viewer,
        Permission.ReadProjectStatusPage,
        Permission.ReadDashboard,
        Permission.ReadWorkflow,
        Permission.ReadProjectTeam,
      ]);

      render(<DashboardCommandPalette />);
      openPalette();
      await search(listCreate.query);

      expect(option(listCreate.id)).toBeNull();
    },
  );

  test("a permission to create one kind offers that one alone", async () => {
    getAllPermissionsMock.mockReturnValue([Permission.CreateDashboard]);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("create");

    expect(option("action-create-dashboard")).toBeInTheDocument();

    for (const listCreate of LIST_CREATES) {
      if (listCreate.id !== "action-create-dashboard") {
        expect(option(listCreate.id)).toBeNull();
      }
    }
  });

  test("a master admin is offered all six", async () => {
    isMasterAdminMock.mockReturnValue(true);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("create");

    for (const listCreate of LIST_CREATES.filter((each: ListCreate) => {
      return each.id !== "action-invite-user";
    })) {
      expect(option(listCreate.id)).toBeInTheDocument();
    }

    await search("invite");
    expect(option("action-invite-user")).toBeInTheDocument();
  });

  test("they are offered while searching, not in the list Search opens on", async () => {
    isMasterAdminMock.mockReturnValue(true);

    render(<DashboardCommandPalette />);
    openPalette();
    await settle();

    for (const listCreate of LIST_CREATES) {
      expect(option(listCreate.id)).toBeNull();
    }

    // The five create actions with pages of their own are listed, as before.
    expect(option("action-create-monitor")).toBeInTheDocument();
  });

  test("without a project none is offered", async () => {
    isMasterAdminMock.mockReturnValue(true);
    getCurrentProjectIdMock.mockReturnValue(null);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("create");

    for (const listCreate of LIST_CREATES) {
      expect(option(listCreate.id)).toBeNull();
    }
  });

  test("'new' and 'invite' find them too", async () => {
    isMasterAdminMock.mockReturnValue(true);

    render(<DashboardCommandPalette />);
    openPalette();

    await search("new status page");
    expect(listedIds()[0]).toBe("action-create-status-page");

    await search("invite");
    expect(listedIds()[0]).toBe("action-invite-user");

    await search("add teammate");
    expect(listedIds()[0]).toBe("action-invite-user");
  });

  test("chosen on its own list, it replaces the address rather than adding to it", async () => {
    isMasterAdminMock.mockReturnValue(true);
    isOnThisPageMock.mockReturnValue(true);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("create workflow");
    fireEvent.click(option("action-create-workflow")!);

    const [to, options] = navigateMock.mock.calls[0] as [
      Route,
      { replace: boolean },
    ];
    expect(to.toString()).toBe(`/dashboard/${PROJECT}/workflows?create=1`);
    expect(options).toEqual({ replace: true });
    // Asked about the list itself, not the address with the ask.
    expect(String(isOnThisPageMock.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT}/workflows`,
    );
  });

  test("a chosen one is remembered under Recent, by its id", async () => {
    isMasterAdminMock.mockReturnValue(true);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("create status page");
    fireEvent.click(option("action-create-status-page")!);

    expect(
      window.localStorage.getItem("oneuptime-command-palette-recents") || "",
    ).toContain("action-create-status-page");

    openPalette();
    await settle();
    expect(option("recent-action-create-status-page")).toBeInTheDocument();
  });

  test("the lists' own words still open the lists first", async () => {
    isMasterAdminMock.mockReturnValue(true);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("status pages");

    const ids: Array<string> = listedIds();
    expect(ids[0]).not.toBe("action-create-status-page");
    expect(ids).toContain("action-create-status-page");
  });
});
