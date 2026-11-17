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
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ProjectMemberSearchMatch } from "../../../Types/Team/ProjectMemberSearch";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";

/*
 * Search finds the project's people (#7036): typing part of a teammate's
 * name or email lists them under Users, as the Users page shows them - the
 * name, and the email under it - and opens their page. Only someone who may
 * see the project's people is searched for them, in the one debounced round
 * of record searches, with at least two letters typed.
 */

const navigateMock: MockFunction = getJestMockFunction();
const memberSearchMock: MockFunction = getJestMockFunction();
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

jest.mock("../../../UI/Utils/ProjectMemberSearch", () => {
  return {
    __esModule: true,
    default: {
      search: (...args: Array<unknown>) => {
        return memberSearchMock(...args);
      },
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
const ADA: ProjectMemberSearchMatch = {
  userId: "5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1da1",
  name: "Ada Lovelace",
  email: "ada@acme.test",
};
const EVE: ProjectMemberSearchMatch = {
  userId: "5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1de1",
  name: "",
  email: "eve@acme.test",
};

function option(id: string): HTMLElement | null {
  return screen.queryByTestId(`command-palette-option-${id}`);
}

function memberRow(match: ProjectMemberSearchMatch): HTMLElement | null {
  return option(`members-members-${match.userId}`);
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

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT));
  // A member of the project: they see its people on the Users page.
  getAllPermissionsMock.mockReturnValue([Permission.ProjectMember]);
  isMasterAdminMock.mockReturnValue(false);
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
  memberSearchMock.mockResolvedValue([] as never);
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
  memberSearchMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getAllPermissionsMock.mockReset();
  isMasterAdminMock.mockReset();
});

describe("Search finds the project's people (#7036)", () => {
  test("part of a teammate's name lists them under Users, with their email, and opens their page", async () => {
    memberSearchMock.mockResolvedValue([ADA] as never);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("lovel");

    expect(memberSearchMock).toHaveBeenCalledWith("lovel");

    const section: HTMLElement = screen.getByTestId(
      "command-palette-section-members",
    );
    expect(section).toHaveTextContent("Users");

    const row: HTMLElement | null = memberRow(ADA);
    expect(row).toHaveTextContent("Ada Lovelace");
    expect(row).toHaveTextContent("ada@acme.test");

    fireEvent.click(row!);

    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT}/users/${ADA.userId}`,
    );
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  test("someone found by their email with no name yet reads as their email", async () => {
    memberSearchMock.mockResolvedValue([EVE] as never);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("eve@acme");

    const row: HTMLElement | null = memberRow(EVE);
    expect(row).toHaveTextContent("eve@acme.test");
    // Said once: the email is the title, not again under it.
    expect((row?.textContent || "").split("eve@acme.test")).toHaveLength(2);
  });

  test("a search that finds nobody shows no Users section", async () => {
    render(<DashboardCommandPalette />);
    openPalette();
    await search("zzqx");

    expect(screen.queryByTestId("command-palette-section-members")).toBeNull();
  });

  test("a search that fails or is refused shows nothing, never an error, and the rest still answers", async () => {
    memberSearchMock.mockRejectedValue(new Error("403") as never);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("glossary");

    expect(screen.queryByTestId("command-palette-section-members")).toBeNull();
    expect(option("action-glossary")).toBeInTheDocument();
  });

  test("it is asked once, when typing stops, and never for one letter", async () => {
    render(<DashboardCommandPalette />);
    openPalette();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "a" },
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(memberSearchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "ad" },
    });
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "ada" },
    });
    expect(memberSearchMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await settle();

    expect(memberSearchMock).toHaveBeenCalledTimes(1);
    expect(memberSearchMock).toHaveBeenCalledWith("ada");
  });

  test("someone whose permissions leave out the project's people is never searched for them", async () => {
    /*
     * They read services, and nothing of the project's people: not even the
     * Project User every member holds, which their team took away.
     */
    getAllPermissionsMock.mockReturnValue([Permission.ReadService]);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("ada");

    expect(memberSearchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("command-palette-section-members")).toBeNull();
  });

  test.each([
    ["a viewer", [Permission.Viewer]],
    ["someone who reads the project's teams", [Permission.ReadProjectTeam]],
    // Every member holds Project User, which reads member profiles.
    [
      "a member whose role only reads services",
      [Permission.ReadService, Permission.ProjectUser],
    ],
  ] as Array<[string, Array<Permission>]>)(
    "%s is searched for them, as the Users page shows them people",
    async (_who: string, permissions: Array<Permission>) => {
      getAllPermissionsMock.mockReturnValue(permissions);
      memberSearchMock.mockResolvedValue([ADA] as never);

      render(<DashboardCommandPalette />);
      openPalette();
      await search("ada");

      expect(memberRow(ADA)).toBeInTheDocument();
    },
  );

  test("a master admin is searched for them", async () => {
    getAllPermissionsMock.mockReturnValue([Permission.ReadService]);
    isMasterAdminMock.mockReturnValue(true);
    memberSearchMock.mockResolvedValue([ADA] as never);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("ada");

    expect(memberRow(ADA)).toBeInTheDocument();
  });

  test("without a project, nobody is searched for", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("ada");

    expect(memberSearchMock).not.toHaveBeenCalled();
  });

  test("people are listed in a Users section of their own", async () => {
    memberSearchMock.mockResolvedValue([ADA] as never);

    render(<DashboardCommandPalette />);
    openPalette();
    await search("ada");

    const sections: Array<string> = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid^="command-palette-section-"]',
      ),
    )
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      })
      .filter((id: string): boolean => {
        return !id.startsWith("command-palette-section-pending-");
      });

    expect(sections).toContain("command-palette-section-members");
  });
});
