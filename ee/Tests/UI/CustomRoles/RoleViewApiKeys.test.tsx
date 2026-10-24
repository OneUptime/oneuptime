import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { Location, MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * THE API KEYS A CUSTOM ROLE IS GIVEN TO, on the role's real page with only
 * the network stubbed - under the teams given it:
 *
 *   - API Keys with this Role lists the keys given it, each a link to the
 *     key's page;
 *   - the Permissions card says a change reaches the keys too, and the
 *     Delete dialog says whom deleting it reaches, keys counted;
 *   - Give to an API Key offers only the keys without the role and gives
 *     the one picked (ApiKeyCustomRole);
 *   - the card and the Give dialog say what a key gets of the role: all of
 *     it, or - for a role with a permission scoped to "Only resources they
 *     own" - how much, and why not the rest; read again when the role's
 *     permissions change;
 *   - Give to an API Key is off, saying why, when no key could take the
 *     role: the project has none (the empty card says so, with a link to
 *     the API Keys page) or every key has it;
 *   - Remove says what the key loses and keeps;
 *   - someone who may not read the project's API keys sees no keys card,
 *     and nothing names a key.
 */

// A valid license, unless a test lets it lapse.
let licenseModeForTest: string = "editable";

(
  globalThis as unknown as { __licenseModeForTest: () => string }
).__licenseModeForTest = (): string => {
  return licenseModeForTest;
};

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __licenseModeForTest: () => string }
        ).__licenseModeForTest();
      },
    };
  },
);

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("Common/UI/Utils/Translation", () => {
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

// How many API keys the project has, as ModelAPI.count answers.
let apiKeyCountForTest: number = 2;

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (params: any): Promise<number> => {
        return params.modelType?.name === "ApiKey" ? apiKeyCountForTest : 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0c000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import TeamRoleView from "../../../Dashboard/CustomRoles/RoleViewPage";
import CustomRoleApiKeysTable, {
  CUSTOM_ROLE_API_KEYS_TEST_ID,
} from "../../../Dashboard/CustomRoles/CustomRoleApiKeysTable";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap from "@oneuptime/dashboard/Utils/RouteMap";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import Route from "Common/Types/API/Route";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "Common/Tests/Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0c000000-0000-4000-8000-000000000001";
const ROLE_ID: string = "0c000000-0000-4000-8000-000000000002";
const DEPLOY_KEY_ID: string = "0c000000-0000-4000-8000-0000000000a1";
const CI_KEY_ID: string = "0c000000-0000-4000-8000-0000000000a2";
const GIVEN_ID: string = "0c000000-0000-4000-8000-0000000000b1";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

// Whether the reader may read the project's API keys: the server's answer.
let apiKeysReadable: boolean = true;

// The role's permissions, by scope, as CustomRolePermission rows answer.
let rolePermissionScopes: Array<PermissionScope> = [];

// The keys given the role.
let givenRows: Array<ApiKeyCustomRole> = [];

function rolePermissionRows(): Array<CustomRolePermission> {
  return rolePermissionScopes.map(
    (scope: PermissionScope, index: number): CustomRolePermission => {
      const row: CustomRolePermission = new CustomRolePermission();
      row._id = `0c000000-0000-4000-8000-0000000000c${index}`;
      row.customRoleId = new ObjectID(ROLE_ID);
      row.permission =
        index % 2 === 0 ? Permission.IncidentMember : Permission.AlertMember;
      row.scope = scope;
      row.labels = [];
      return row;
    },
  );
}

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function role(): CustomRole {
  const customRole: CustomRole = new CustomRole();
  customRole._id = ROLE_ID;
  customRole.name = "Incident Responder";
  customRole.description = "Declares, works and resolves incidents.";
  customRole.permissionCount = 2;
  return customRole;
}

function key(id: string, name: string): ApiKey {
  const apiKey: ApiKey = new ApiKey();
  apiKey._id = id;
  apiKey.name = name;
  return apiKey;
}

function givenToDeployBot(): ApiKeyCustomRole {
  const given: ApiKeyCustomRole = new ApiKeyCustomRole();
  given._id = GIVEN_ID;
  given.apiKeyId = new ObjectID(DEPLOY_KEY_ID);
  given.customRoleId = new ObjectID(ROLE_ID);
  given.apiKey = key(DEPLOY_KEY_ID, "Deploy bot");
  return given;
}

beforeEach(() => {
  licenseModeForTest = "editable";
  holding([Permission.ProjectOwner]);
  apiKeysReadable = true;
  apiKeyCountForTest = 2;
  rolePermissionScopes = [];
  givenRows = [givenToDeployBot()];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
  );

  // The page's breadcrumbs read the address from Navigation.
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(ROLE_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getItemMock.mockImplementation(async (): Promise<any> => {
    return role();
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const answer: (data: Array<unknown>) => any = (
      data: Array<unknown>,
    ): any => {
      return { data: data, count: data.length, skip: 0, limit: 50 };
    };

    if (params.modelType === ApiKeyCustomRole) {
      if (!apiKeysReadable) {
        throw new Error(
          "You do not have permissions to read API Key Custom Role. You need one of these permissions: Project Owner, Project Admin, Read API Key.",
        );
      }

      return answer(givenRows);
    }

    if (params.modelType === ApiKey) {
      return answer([key(CI_KEY_ID, "CI bot")]);
    }

    if (params.modelType === CustomRolePermission) {
      return answer(rolePermissionRows());
    }

    return answer([]);
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: ObjectID.generate().toString(),
        apiKeyId: data.model.apiKeyId,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter
      initialEntries={[`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`]}
    >
      <TeamRoleView {...pageProps} />
    </MemoryRouter>,
  );

  // The role has loaded: its name is on its details card.
  await screen.findByText(
    "Declares, works and resolves incidents.",
    {},
    { timeout: 10000 },
  );
}

async function apiKeysCard(): Promise<HTMLElement> {
  return await screen.findByTestId(
    CUSTOM_ROLE_API_KEYS_TEST_ID,
    {},
    { timeout: 10000 },
  );
}

function cardButton(container: HTMLElement, title: string): HTMLElement {
  const button: HTMLElement | undefined = within(container)
    .getAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === title;
    });

  if (!button) {
    throw new Error(`No ${title} button`);
  }

  return button;
}

// Lets React finish the renders it scheduled outside act().
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });
  }
}

function listCallsFor(modelType: unknown): Array<any> {
  return getListMock.mock.calls
    .map((args: Array<any>): any => {
      return args[0];
    })
    .filter((call: any): boolean => {
      return call.modelType === modelType;
    });
}

describe("a custom role's API keys", () => {
  test("with a lapsed license, the keys stay listed, and Give to an API Key is gone", async () => {
    licenseModeForTest = "read-only";

    await renderPage();
    const card: HTMLElement = await apiKeysCard();

    expect(
      await within(card).findByRole("link", { name: "Deploy bot" }),
    ).toBeInTheDocument();
    expect(
      within(card)
        .queryAllByTestId("card-button")
        .filter((button: HTMLElement): boolean => {
          return (button.textContent || "").trim() === "Give to an API Key";
        }),
    ).toEqual([]);
  });

  test("lists the keys given the role, each a link to the key's page", async () => {
    await renderPage();
    const card: HTMLElement = await apiKeysCard();

    expect(
      within(card).getByText("API Keys with this Role"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "These API keys can do everything this role allows.",
      ),
    ).toBeInTheDocument();

    const link: HTMLElement = await within(card).findByRole("link", {
      name: "Deploy bot",
    });
    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/settings/api-keys/${DEPLOY_KEY_ID}`,
    );

    // Read by the role and the project.
    const rows: any = listCallsFor(ApiKeyCustomRole).find((call: any) => {
      return Boolean(call.select?.apiKey);
    });
    expect(rows).toBeDefined();
    expect(rows.query.customRoleId.toString()).toBe(ROLE_ID);
  });

  test("the Permissions card says a change reaches the key, and Delete says deleting it does", async () => {
    await renderPage();

    expect(
      await screen.findByText(
        "What this role gives. Given to 1 API key. A change here changes what they can do at once.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();

    // What deleting any custom role does, keys included.
    expect(
      screen.getAllByText(
        /Deleting a custom role takes its permissions from every team and API key that has it\./,
      ).length,
    ).toBeGreaterThan(0);

    const deleteCard: HTMLElement = screen
      .getAllByTestId("card")
      .find((candidate: HTMLElement): boolean => {
        return (
          within(candidate).queryByTestId("model-delete-card-message") !== null
        );
      })!;

    await act(async (): Promise<void> => {
      fireEvent.click(cardButton(deleteCard, "Delete Custom Role"));
    });

    expect(
      await screen.findByTestId("custom-role-delete-reach"),
    ).toHaveTextContent("It is given to 1 API key right now.");
  });

  test("Give to an API Key offers only the keys without the role, and gives the one picked", async () => {
    await renderPage();
    const card: HTMLElement = await apiKeysCard();
    await within(card).findByRole("link", { name: "Deploy bot" });

    await act(async (): Promise<void> => {
      fireEvent.click(cardButton(card, "Give to an API Key"));
    });

    const modal: HTMLElement = await screen.findByTestId("modal");
    expect(
      within(modal).getByText("Give Incident Responder to an API Key"),
    ).toBeInTheDocument();
    // The role holds nothing scoped to what someone owns: no exception said.
    expect(
      within(modal).getByText(
        "From now on the key can do everything this role allows.",
      ),
    ).toBeInTheDocument();

    const dropdown: HTMLElement = await within(modal).findByRole("combobox");
    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    const option: HTMLElement = await screen.findByText("CI bot");

    // The keys offered leave out Deploy bot, which has the role.
    const keyReads: Array<any> = listCallsFor(ApiKey);
    const offered: any = keyReads[keyReads.length - 1];
    expect(offered.query._id).toBeInstanceOf(IncludesNone);
    expect((offered.query._id as IncludesNone).values.map(String)).toEqual([
      DEPLOY_KEY_ID,
    ]);

    await act(async (): Promise<void> => {
      fireEvent.click(option);
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", { name: "Give to API Key" }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });

    const sent: any = createOrUpdateMock.mock.calls[0]![0];
    expect(sent.modelType).toBe(ApiKeyCustomRole);
    expect(sent.model.customRoleId.toString()).toBe(ROLE_ID);
    expect(sent.model.projectId.toString()).toBe(PROJECT_ID);
    // The key, as the form's relation: the server reads it as apiKeyId.
    expect(sent.model.apiKey?.id?.toString()).toBe(CI_KEY_ID);
  });

  test("a role with a permission scoped to what someone owns: the card and the Give dialog say how much a key gets, and why", async () => {
    rolePermissionScopes = [PermissionScope.All, PermissionScope.Owned];

    await renderPage();
    const card: HTMLElement = await apiKeysCard();

    expect(
      await within(card).findByText(
        "These API keys get 1 of this role's 2 permissions: those scoped to “Only resources they own” don't apply to a key.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(
      within(card).queryByText(
        "These API keys can do everything this role allows.",
      ),
    ).toBeNull();

    // This role's permissions only, read by the role.
    const coverageReads: Array<any> = listCallsFor(CustomRolePermission).filter(
      (call: any): boolean => {
        return Boolean(call.select?.scope);
      },
    );
    expect(coverageReads.length).toBeGreaterThan(0);
    expect(coverageReads[0].query.customRoleId.toString()).toBe(ROLE_ID);

    await act(async (): Promise<void> => {
      fireEvent.click(cardButton(card, "Give to an API Key"));
    });

    const modal: HTMLElement = await screen.findByTestId("modal");
    expect(
      within(modal).getByText(
        "From now on the key can do everything this role allows, except permissions scoped to “Only resources they own”: a key owns nothing.",
      ),
    ).toBeInTheDocument();
  });

  test("a role whose every permission is scoped to what someone owns says none applies to its keys", async () => {
    rolePermissionScopes = [PermissionScope.Owned, PermissionScope.Owned];

    await renderPage();
    const card: HTMLElement = await apiKeysCard();

    expect(
      await within(card).findByText(
        "None of this role's permissions apply to these API keys: each is scoped to “Only resources they own”.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
  });

  test("what the card says follows a change of the role's permissions", async () => {
    rolePermissionScopes = [PermissionScope.All];

    const view: ReturnType<typeof render> = render(
      <MemoryRouter
        initialEntries={[`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`]}
      >
        <CustomRoleApiKeysTable
          customRoleId={new ObjectID(ROLE_ID)}
          roleName="Incident Responder"
          permissionsChangeToggle={0}
        />
      </MemoryRouter>,
    );

    const card: HTMLElement = await apiKeysCard();
    expect(
      await within(card).findByText(
        "These API keys can do everything this role allows.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();

    // The role's one permission is scoped to what someone owns now.
    rolePermissionScopes = [PermissionScope.Owned];

    view.rerender(
      <MemoryRouter
        initialEntries={[`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`]}
      >
        <CustomRoleApiKeysTable
          customRoleId={new ObjectID(ROLE_ID)}
          roleName="Incident Responder"
          permissionsChangeToggle={1}
        />
      </MemoryRouter>,
    );

    expect(
      await within(card).findByText(
        "None of this role's permissions apply to these API keys: each is scoped to “Only resources they own”.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
  });

  test("a project with no API key: the card says so, with the way to the API Keys page, and Give to an API Key is off", async () => {
    apiKeyCountForTest = 0;
    givenRows = [];

    await renderPage();
    const card: HTMLElement = await apiKeysCard();

    expect(
      await within(card).findByText(
        "This project has no API key yet",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/then give it this role here\./),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "API Keys" }).getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/settings/api-keys`);

    // No button under the empty card: a key has to be made first.
    expect(within(card).queryByTestId("empty-table-create-button")).toBeNull();

    // The card's own button is off, and says why.
    await waitFor(() => {
      expect(cardButton(card, "Give to an API Key")).toBeDisabled();
    });
    const give: HTMLElement = cardButton(card, "Give to an API Key");
    fireEvent.mouseEnter(give.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "This project has no API key yet. Create one on the API Keys page.",
    );

    fireEvent.click(give);
    await act(async (): Promise<void> => {});
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("when every API key has the role, Give to an API Key is off, and says why", async () => {
    apiKeyCountForTest = 1;

    await renderPage();
    const card: HTMLElement = await apiKeysCard();
    await within(card).findByRole("link", { name: "Deploy bot" });

    await waitFor(() => {
      expect(cardButton(card, "Give to an API Key")).toBeDisabled();
    });

    const give: HTMLElement = cardButton(card, "Give to an API Key");
    fireEvent.mouseEnter(give.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Every API key has this role already.",
    );
  });

  test("Remove says what the key loses, and that its other roles and permissions stay", async () => {
    await renderPage();
    const card: HTMLElement = await apiKeysCard();
    await within(card).findByRole("link", { name: "Deploy bot" });

    /*
     * The role's name is read with its details, apart from the table: wait
     * for it (the Delete card names it), and for the table to rebuild its
     * row actions with it - React does that a few ticks later, outside the
     * test's act().
     */
    await waitFor(() => {
      expect(screen.getByTestId("model-delete-card-message")).toHaveTextContent(
        "Incident Responder",
      );
    });
    await settle();

    const remove: HTMLElement | undefined = within(card)
      .getAllByRole("button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === "Remove";
      });
    expect(remove).toBeDefined();

    await act(async (): Promise<void> => {
      fireEvent.click(remove!);
    });

    expect(
      await screen.findByText("Remove Incident Responder from Deploy bot"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Deploy bot loses the permissions of Incident Responder. Its other roles and permissions stay.",
      ),
    ).toBeInTheDocument();
  });

  test("someone who may not read the project's API keys sees no keys card, and no count of keys", async () => {
    holding([Permission.ReadProjectTeam]);
    apiKeysReadable = false;

    await renderPage();

    // The teams card has loaded: no team has the role.
    expect(
      await screen.findByText(
        "No team has this role yet",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    await settle();

    expect(screen.queryByTestId(CUSTOM_ROLE_API_KEYS_TEST_ID)).toBeNull();

    // The key the role is given to is not theirs to know about.
    expect(screen.getByText("What this role gives.")).toBeInTheDocument();
    // A count starts at a word's edge: one try per number, not per digit.
    expect(screen.queryByText(/\b\d+ API keys?/)).toBeNull();
    expect(screen.queryByText(/Deploy bot/)).toBeNull();
  });
});
