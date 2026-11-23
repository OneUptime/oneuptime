import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Mock, SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { MemoryRouter } from "react-router-dom";

/*
 * ONE MEMBER'S SAVED SIGN-IN SETTINGS, ON THE PROJECT'S USERS LIST (#9993).
 *
 * The server holds the rule on every request (ProjectSignInClearing, and
 * its suites over HTTP). The page holds it again wherever it can, and these
 * pin each part on the real Settings > Users page, its table stood in for
 * by one that records its props:
 *
 *   - only a Project Owner of the project asks, by their own permission
 *     rows - never a member who is only an admin, never a master admin by
 *     their standing;
 *   - it asks only about the rows it drew: members who joined, each once,
 *     never the reader's own row, a page at most;
 *   - a row the server named says Sign-In Settings Saved and offers Clear
 *     Sign-In Settings - and no other row does, whatever an answer says of
 *     the reader, of a pending invitation, or of anybody it did not ask
 *     about;
 *   - the question names the person and lists exactly what goes; the clear
 *     is asked of the server for that person, says so in a toast, and reads
 *     the list again; a refusal says why, in the question;
 *   - its words are in every Dashboard language.
 */

let mockRows: Array<Record<string, unknown>> = [];
let mockIsMasterAdmin: boolean = false;
let mockReaderId: string | null = null;

jest.mock("../../../UI/Utils/Permission", () => {
  const held: {
    fromRows: (data: {
      rows: Array<Record<string, unknown>>;
      globalPermissions: Array<string>;
    }) => unknown;
  } = (
    jest.requireActual("../../../Types/HeldPermissions") as {
      default: {
        fromRows: (data: {
          rows: Array<Record<string, unknown>>;
          globalPermissions: Array<string>;
        }) => unknown;
      };
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): { permissions: unknown } => {
        return { permissions: mockRows };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
      getHeldPermissions: (): unknown => {
        return held.fromRows({ rows: mockRows, globalPermissions: [] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      getUserId: (): unknown => {
        return mockReaderId
          ? {
              toString: () => {
                return mockReaderId;
              },
            }
          : null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

type CapturedAction = {
  title: string;
  buttonStyleType: unknown;
  isVisible?: ((item: TeamMember) => boolean | undefined) | undefined;
  getConfirmation?:
    | ((item: TeamMember) => RowActionConfirmation | undefined)
    | undefined;
  onClick: (
    item: TeamMember,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
    context?: { refresh: () => void } | undefined,
  ) => void;
};

type CapturedColumn = {
  title: string;
  getElement?: ((item: TeamMember) => ReactElement) | undefined;
};

type CapturedTableProps = {
  actionButtons?: Array<CapturedAction> | undefined;
  columns?: Array<CapturedColumn> | undefined;
  onFetchSuccess?:
    | ((data: Array<TeamMember>, totalCount: number) => void)
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import {
  getMembersToAskAbout,
  getSavedSignInSettingLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/User/MemberSavedSignInSettings";
import MEMBER_SAVED_SIGN_IN_SETTINGS_COPY, {
  MEMBER_SAVED_SIGN_IN_SETTINGS_ALREADY_CLEARED_TOAST_TEST_ID,
  MEMBER_SAVED_SIGN_IN_SETTINGS_CLEARED_TOAST_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/User/MemberSavedSignInSettingsCopy";
import { RowActionConfirmation } from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsOfPeopleRoute,
  LocalSignInSettings,
  MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "99930000-0000-4000-8000-000000000001",
);
const OWNER_ID: string = "99930000-0000-4000-8000-0000000000a1";
const ALICE_ID: string = "99930000-0000-4000-8000-0000000000b1";
const BOB_ID: string = "99930000-0000-4000-8000-0000000000b2";
const PENDING_ID: string = "99930000-0000-4000-8000-0000000000b3";
// Somebody the page never drew.
const STRANGER_ID: string = "99930000-0000-4000-8000-0000000000b9";

const ALICE_SETTINGS: LocalSignInSettings = {
  hasPassword: true,
  hasPasswordResetLink: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 1,
  passkeyAndSecurityKeyCount: 2,
  backupCodeCount: 10,
};

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

function row(data: {
  userId: string;
  name?: string;
  email?: string;
  hasAcceptedInvitation?: boolean;
}): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.userId = new ObjectID(data.userId);
  member.projectId = PROJECT_ID;
  member.hasAcceptedInvitation = data.hasAcceptedInvitation !== false;

  const user: User = new User();
  user._id = data.userId;

  if (data.name) {
    user.name = new Name(data.name);
  }

  user.email = new Email(data.email || `${data.userId.slice(-2)}@example.com`);
  member.user = user;

  return member;
}

const OWNER_ROW: TeamMember = row({ userId: OWNER_ID, name: "Olive Owner" });
const ALICE_ROW: TeamMember = row({ userId: ALICE_ID, name: "Alice Smith" });
const BOB_ROW: TeamMember = row({ userId: BOB_ID, name: "Bob Jones" });
const PENDING_ROW: TeamMember = row({
  userId: PENDING_ID,
  name: "Pat Pending",
  hasAcceptedInvitation: false,
});

const PAGE: Array<TeamMember> = [OWNER_ROW, ALICE_ROW, BOB_ROW, PENDING_ROW];

type Request = { url: URL; data: JSONObject };

let fetchSpy: SpyInstance<typeof API.fetch>;
// What the server answers the list with, and the clear with.
let listAnswer: () => Promise<unknown>;
let clearAnswer: () => Promise<unknown>;
let toastSpy: SpyInstance<typeof Toast.success>;

const asOwner: () => void = (): void => {
  mockRows = [
    {
      _type: "UserPermission",
      permission: Permission.ProjectOwner,
      labelIds: [],
    },
  ];
};

function requestsTo(route: string): Array<Request> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>): Request => {
      return call[0] as Request;
    })
    .filter((request: Request): boolean => {
      return request.url.toString().endsWith(route);
    });
}

const LIST_ROUTE: string = getProjectSavedSignInSettingsOfPeopleRoute(
  PROJECT_ID.toString(),
);

beforeEach(() => {
  standInForGlobalConfig();
  capturedTableProps = null;
  mockIsMasterAdmin = false;
  mockReaderId = OWNER_ID;
  asOwner();

  listAnswer = async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(
      200,
      { people: [{ userId: ALICE_ID, settings: { ...ALICE_SETTINGS } }] },
      {},
    );
  };
  clearAnswer = async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(200, { peopleCleared: 1 }, {});
  };

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID.toString(),
  });
  // No SCIM Push Groups.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);
  toastSpy = jest
    .spyOn(Toast, "success")
    .mockReturnValue("toast") as unknown as SpyInstance<typeof Toast.success>;

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: Request,
  ) => {
    if (request.url.toString().endsWith(LIST_ROUTE)) {
      return await listAnswer();
    }

    if (request.url.toString().endsWith("/clear")) {
      return await clearAnswer();
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never) as unknown as SpyInstance<typeof API.fetch>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderUsers(): Promise<void> {
  render(
    <MemoryRouter>
      <Users
        pageRoute={new Route("/dashboard/settings/users")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
}

function table(): CapturedTableProps {
  expect(capturedTableProps).not.toBeNull();
  return capturedTableProps!;
}

// The table has drawn these rows: as ModelTable hands them over.
async function rowsFetched(rows: Array<TeamMember> = PAGE): Promise<void> {
  await act(async (): Promise<void> => {
    table().onFetchSuccess!(rows, rows.length);
  });

  // The answer, read and kept.
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

function clearAction(): CapturedAction {
  const action: CapturedAction | undefined = table().actionButtons?.find(
    (candidate: CapturedAction): boolean => {
      return candidate.title === MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.action;
    },
  );

  expect(action).toBeDefined();
  return action!;
}

function isOffered(member: TeamMember): boolean {
  return Boolean(clearAction().isVisible!(member));
}

function statusText(member: TeamMember): string {
  const column: CapturedColumn | undefined = table().columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Status";
    },
  );

  expect(column?.getElement).toBeDefined();

  const { container, unmount } = render(<>{column!.getElement!(member)}</>);
  const text: string = container.textContent || "";
  unmount();

  return text;
}

function askedIds(): Array<string> {
  const asks: Array<Request> = requestsTo(LIST_ROUTE);
  expect(asks).toHaveLength(1);
  return (asks[0]!.data["userIds"] as Array<string>).slice().sort();
}

describe("who asks", () => {
  test("a Project Owner of the project asks about the members the page drew", async () => {
    await renderUsers();
    await rowsFetched();

    expect(askedIds()).toEqual([ALICE_ID, BOB_ID].sort());
  });

  test.each([
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a member who may invite people", [Permission.InviteProjectTeamMembers]],
    ["a Viewer", [Permission.Viewer]],
  ])(
    "%s is no owner: nothing is asked, offered or said",
    async (_label: string, permissions: Array<Permission>) => {
      mockRows = permissions.map((permission: Permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      });

      await renderUsers();
      await rowsFetched();

      expect(requestsTo(LIST_ROUTE)).toHaveLength(0);
      expect(isOffered(ALICE_ROW)).toBe(false);
      expect(statusText(ALICE_ROW)).not.toContain(
        MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.pill,
      );
    },
  );

  test("an owner a team blocks from Project Owner asks nothing", async () => {
    mockRows = [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
      },
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: true,
      },
    ];

    await renderUsers();
    await rowsFetched();

    expect(requestsTo(LIST_ROUTE)).toHaveLength(0);
  });

  test("a master admin who is no owner of the project asks nothing: their standing is not ownership", async () => {
    mockIsMasterAdmin = true;
    mockRows = [];

    await renderUsers();
    await rowsFetched();

    expect(requestsTo(LIST_ROUTE)).toHaveLength(0);
    expect(isOffered(ALICE_ROW)).toBe(false);
  });
});

describe("whom it asks about", () => {
  test("never the reader's own row, whatever case their id is in", async () => {
    mockReaderId = OWNER_ID.toUpperCase();

    await renderUsers();
    await rowsFetched();

    expect(askedIds()).not.toContain(OWNER_ID);
  });

  test("never somebody only invited: they have joined nothing yet", async () => {
    await renderUsers();
    await rowsFetched();

    expect(askedIds()).not.toContain(PENDING_ID);
  });

  test("each person once, a page at most", () => {
    const many: Array<TeamMember> = [];

    for (
      let index: number = 0;
      index < MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK + 20;
      index++
    ) {
      const member: TeamMember = row({
        userId: ObjectID.generate().toString(),
      });
      many.push(member, member);
    }

    const asked: Array<string> = getMembersToAskAbout(many);

    expect(asked).toHaveLength(MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK);
    expect(new Set(asked).size).toBe(asked.length);
  });

  test("a page with nobody to ask about asks nothing", async () => {
    await renderUsers();
    await rowsFetched([OWNER_ROW, PENDING_ROW]);

    expect(requestsTo(LIST_ROUTE)).toHaveLength(0);
  });

  test("the ask goes to this project, with its tenant header", async () => {
    await renderUsers();
    await rowsFetched();

    const ask: Request & { headers?: Record<string, string> } = requestsTo(
      LIST_ROUTE,
    )[0] as Request & { headers?: Record<string, string> };

    expect(ask.url.toString()).toContain(PROJECT_ID.toString());
    expect(ask.headers?.["tenantid"]).toBe(PROJECT_ID.toString());
  });
});

describe("whom it offers to clear", () => {
  test("only the rows the server named: they say Sign-In Settings Saved and offer Clear Sign-In Settings", async () => {
    await renderUsers();
    await rowsFetched();

    expect(isOffered(ALICE_ROW)).toBe(true);
    expect(statusText(ALICE_ROW)).toContain(
      MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.pill,
    );

    expect(isOffered(BOB_ROW)).toBe(false);
    expect(statusText(BOB_ROW)).not.toContain(
      MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.pill,
    );
  });

  test("never the reader's own row, though an answer names them", async () => {
    listAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        { people: [{ userId: OWNER_ID, settings: { ...ALICE_SETTINGS } }] },
        {},
      );
    };

    await renderUsers();
    await rowsFetched();

    expect(isOffered(OWNER_ROW)).toBe(false);
    expect(statusText(OWNER_ROW)).not.toContain(
      MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.pill,
    );
  });

  test("never a pending invitation's row, though an answer names them", async () => {
    listAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        { people: [{ userId: PENDING_ID, settings: { ...ALICE_SETTINGS } }] },
        {},
      );
    };

    await renderUsers();
    await rowsFetched();

    expect(isOffered(PENDING_ROW)).toBe(false);
  });

  test("never anybody the page did not ask about, though an answer names them", async () => {
    const stranger: TeamMember = row({ userId: STRANGER_ID, name: "Stan" });

    listAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        { people: [{ userId: STRANGER_ID, settings: { ...ALICE_SETTINGS } }] },
        {},
      );
    };

    await renderUsers();
    await rowsFetched();

    expect(isOffered(stranger)).toBe(false);
  });

  test("an answer that could not be read offers nothing", async () => {
    listAnswer = async (): Promise<unknown> => {
      return new HTTPErrorResponse(
        422,
        { message: "Only Project Owners can clear it." },
        {},
      );
    };

    await renderUsers();
    await rowsFetched();

    expect(isOffered(ALICE_ROW)).toBe(false);
  });

  test("a row that says nothing is saved offers nothing", async () => {
    listAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          people: [
            { userId: ALICE_ID, settings: { ...NO_LOCAL_SIGN_IN_SETTINGS } },
          ],
        },
        {},
      );
    };

    await renderUsers();
    await rowsFetched();

    expect(isOffered(ALICE_ROW)).toBe(false);
  });

  test("the action is a destructive one: it sinks to the end of the row's menu", async () => {
    await renderUsers();

    expect(clearAction().buttonStyleType).toBe(ButtonStyleType.DANGER_OUTLINE);
  });
});

describe("the question", () => {
  test("names the person, says it can't be undone, and lists exactly what goes", async () => {
    await renderUsers();
    await rowsFetched();

    const confirmation: RowActionConfirmation =
      clearAction().getConfirmation!(ALICE_ROW)!;

    expect(confirmation.title).toBe(
      "Clear Alice Smith's saved sign-in settings?",
    );
    expect(confirmation.description).toBe(
      MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription,
    );
    expect(confirmation.submitButtonText).toBe(
      MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.action,
    );
    expect(confirmation.submitButtonType).toBe(ButtonStyleType.DANGER);

    const { container } = render(confirmation.details!);

    expect(
      Array.from(container.querySelectorAll("li")).map(
        (item: Element): string => {
          return item.textContent || "";
        },
      ),
    ).toEqual([
      "Their password, and any password reset or sign-in link",
      "2 passkeys and security keys",
      "1 authenticator app",
      "10 backup codes",
      "Two-factor authentication, which is turned off",
    ]);
  });

  test("a person with no name is named by their email", async () => {
    const unnamed: TeamMember = row({
      userId: ALICE_ID,
      email: "alice@example.com",
    });

    await renderUsers();
    await rowsFetched([unnamed]);

    expect(clearAction().getConfirmation!(unnamed)!.title).toBe(
      "Clear alice@example.com's saved sign-in settings?",
    );
  });

  test("a reset link alone is the one line; with a password it is in the password's (#9992)", () => {
    const english: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("en");

    expect(
      getSavedSignInSettingLines(
        { ...NO_LOCAL_SIGN_IN_SETTINGS, hasPasswordResetLink: true },
        english,
      ),
    ).toEqual(["A password reset link that still works"]);

    expect(
      getSavedSignInSettingLines(
        {
          ...NO_LOCAL_SIGN_IN_SETTINGS,
          hasPassword: true,
          hasPasswordResetLink: true,
        },
        english,
      ),
    ).toEqual(["Their password, and any password reset or sign-in link"]);
  });

  test("one of each reads as one", () => {
    expect(
      getSavedSignInSettingLines(
        {
          ...NO_LOCAL_SIGN_IN_SETTINGS,
          passkeyAndSecurityKeyCount: 1,
          authenticatorAppCount: 1,
          backupCodeCount: 1,
        },
        dashboardTranslator("en"),
      ),
    ).toEqual([
      "1 passkey or security key",
      "1 authenticator app",
      "1 backup code",
    ]);
  });
});

// How a row action's run ended: done, failed, and whether the list was read again.
interface ClearOutcome {
  completed: Mock<() => void>;
  failed: Mock<(error: Error) => void>;
  refresh: Mock<() => void>;
}

describe("the clear", () => {
  async function clearAlice(): Promise<ClearOutcome> {
    await renderUsers();
    await rowsFetched();

    const completed: Mock<() => void> = jest.fn();
    const failed: Mock<(error: Error) => void> = jest.fn();
    const refresh: Mock<() => void> = jest.fn();

    await act(async (): Promise<void> => {
      clearAction().onClick(
        ALICE_ROW,
        completed as unknown as () => void,
        failed as unknown as (error: Error) => void,
        { refresh: refresh as unknown as () => void },
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(completed.mock.calls.length + failed.mock.calls.length).toBe(1);
    });

    return { completed, failed, refresh };
  }

  test("is asked of the server for that person, in this project; then a toast, and the list read again", async () => {
    const outcome: ClearOutcome = await clearAlice();

    const clears: Array<Request> = requestsTo(
      getProjectClearPersonSavedSignInSettingsRoute(
        PROJECT_ID.toString(),
        ALICE_ID,
      ),
    );
    expect(clears).toHaveLength(1);

    expect(outcome.completed).toHaveBeenCalledTimes(1);
    expect(outcome.failed).not.toHaveBeenCalled();
    expect(outcome.refresh).toHaveBeenCalledTimes(1);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]![0]).toBe(
      "Cleared Alice Smith's sign-in settings.",
    );
    expect(
      (toastSpy.mock.calls[0]![1] as { dataTestId?: string }).dataTestId,
    ).toBe(MEMBER_SAVED_SIGN_IN_SETTINGS_CLEARED_TOAST_TEST_ID);

    // Their chip goes at once, before the list is read again.
    await waitFor(() => {
      expect(isOffered(ALICE_ROW)).toBe(false);
    });
  });

  test("a refusal says why, in the question, and is never a toast", async () => {
    clearAnswer = async (): Promise<unknown> => {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "You can't clear this person's sign-in settings from this project.",
        },
        {},
      );
    };

    const outcome: ClearOutcome = await clearAlice();

    expect(outcome.failed).toHaveBeenCalledTimes(1);
    expect((outcome.failed.mock.calls[0]![0] as Error).message).toContain(
      "You can't clear this person's sign-in settings from this project.",
    );
    expect(outcome.completed).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  /*
   * #10776: another clear of Alice - another owner's, a server admin's, or
   * this question sent twice - came first, so the server removed and
   * recorded nothing, and answered that it cleared nobody.
   */
  test("an answer that clears nobody is no success: it says their settings were already cleared, and the list is read again", async () => {
    clearAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(200, { peopleCleared: 0 }, {});
    };
    const infoSpy: SpyInstance<typeof Toast.info> = jest
      .spyOn(Toast, "info")
      .mockReturnValue("toast") as unknown as SpyInstance<typeof Toast.info>;

    const outcome: ClearOutcome = await clearAlice();

    expect(outcome.completed).toHaveBeenCalledTimes(1);
    expect(outcome.failed).not.toHaveBeenCalled();
    expect(outcome.refresh).toHaveBeenCalledTimes(1);
    expect(toastSpy).not.toHaveBeenCalled();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]![0]).toBe(
      "Alice Smith's sign-in settings were already cleared.",
    );
    expect(
      (infoSpy.mock.calls[0]![1] as { dataTestId?: string }).dataTestId,
    ).toBe(MEMBER_SAVED_SIGN_IN_SETTINGS_ALREADY_CLEARED_TOAST_TEST_ID);

    // Their chip goes, as after any clear: nothing of theirs is left.
    await waitFor(() => {
      expect(isOffered(ALICE_ROW)).toBe(false);
    });
  });

  test("a row with no name to say is told in the nameless words", async () => {
    clearAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(200, { peopleCleared: 0 }, {});
    };
    const infoSpy: SpyInstance<typeof Toast.info> = jest
      .spyOn(Toast, "info")
      .mockReturnValue("toast") as unknown as SpyInstance<typeof Toast.info>;

    await renderUsers();
    await rowsFetched();

    const nameless: TeamMember = row({ userId: ALICE_ID, name: "" });
    nameless.user!.email = undefined;
    const completed: Mock<() => void> = jest.fn();

    await act(async (): Promise<void> => {
      clearAction().onClick(
        nameless,
        completed as unknown as () => void,
        jest.fn() as unknown as (error: Error) => void,
        { refresh: jest.fn() as unknown as () => void },
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(completed).toHaveBeenCalledTimes(1);
    });

    expect(infoSpy.mock.calls[0]![0]).toBe(
      MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.alreadyClearedWithoutName,
    );
  });

  test("an answer that cannot be read says nothing at all", async () => {
    clearAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(200, { cleared: "yes" }, {});
    };
    const infoSpy: SpyInstance<typeof Toast.info> = jest
      .spyOn(Toast, "info")
      .mockReturnValue("toast") as unknown as SpyInstance<typeof Toast.info>;

    const outcome: ClearOutcome = await clearAlice();

    expect(outcome.completed).toHaveBeenCalledTimes(1);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("in every Dashboard language", () => {
  const KEYS: Array<string> = [
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.pill,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.pillTooltip,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.action,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.confirmTitleWithoutName,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.password,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.passwordResetLink,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.twoFactorAuth,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.cleared,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.clearedWithoutName,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.alreadyCleared,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.alreadyClearedWithoutName,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.passkeys.other,
    `${MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.passkeys.other}_one`,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.authenticatorApps.other,
    `${MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.authenticatorApps.other}_one`,
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.backupCodes.other,
    `${MEMBER_SAVED_SIGN_IN_SETTINGS_COPY.backupCodes.other}_one`,
  ];

  test.each(
    DASHBOARD_LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )("%s words every one of them", (language: string) => {
    const unworded: Array<string> = KEYS.filter((key: string): boolean => {
      return !isWordedInDashboardLocale(key, language);
    });

    expect(unworded).toEqual([]);
  });

  test.each(
    DASHBOARD_LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "%s: the list of what goes reads in the language, its counts in it too",
    (language: string) => {
      const lines: Array<string> = getSavedSignInSettingLines(
        ALICE_SETTINGS,
        dashboardTranslator(language),
      );
      const english: Array<string> = getSavedSignInSettingLines(
        ALICE_SETTINGS,
        dashboardTranslator("en"),
      );

      expect(lines).toHaveLength(english.length);

      for (let index: number = 0; index < lines.length; index++) {
        expect(lines[index]).not.toBe(english[index]);
      }
    },
  );
});
