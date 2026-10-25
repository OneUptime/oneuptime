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
import { MemoryRouter } from "react-router-dom";
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
 * AN API KEY'S CUSTOM ROLES, on the key's real page with only the network
 * stubbed - as a team's Permissions page shows the team's
 * (TeamViewPermissions.test.tsx):
 *
 *   - a project with no custom role sees the key's page exactly as before:
 *     no Custom Roles card;
 *   - once it has one, a Custom Roles card above Permissions lists the
 *     key's roles, each a link to the role's page, saying how many of the
 *     role's permissions apply to the key when some are limited to what
 *     someone owns - which give a key nothing - with an (i) that says why,
 *     in the words the role's Scope column uses;
 *   - Add Custom Role offers only the roles the key has not got, each card
 *     saying what it would give the key, and sends one ApiKeyCustomRole;
 *     its dialog names the Owned exception only when a role it offers has
 *     such a permission;
 *   - when the key has every role, Add Custom Role is off, and says why;
 *   - someone who may not change what a key can do sees it locked;
 *   - Remove says what the key loses and keeps;
 *   - the key's own Permissions card lists its own rows only, never a
 *     role's copies.
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

/*
 * The Enterprise Edition, self-hosted: the key's page draws the Enterprise
 * card through its core shell (ApiKeyCustomRolesSettings).
 */
jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  return { ...actual, BILLING_ENABLED: false, IS_ENTERPRISE_EDITION: true };
});

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
const deleteItemMock: MockFunction = getJestMockFunction();

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
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
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
            return "0f000000-0000-4000-8000-000000000001";
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

import APIKeyViewPage from "@oneuptime/dashboard/Pages/Settings/APIKeyView";
import {
  API_KEY_CUSTOM_ROLES_TEST_ID,
  API_KEY_ROLE_OWNED_REASON_TEST_ID,
} from "../../../Dashboard/CustomRoles/ApiKeyCustomRoleTable";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap from "@oneuptime/dashboard/Utils/RouteMap";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "Common/Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import OneUptimeDate from "Common/Types/Date";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "Common/Tests/Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0f000000-0000-4000-8000-000000000001";
const KEY_ID: string = "0f000000-0000-4000-8000-000000000002";
const RESPONDER_ID: string = "0f000000-0000-4000-8000-0000000000a1";
const AUDITOR_ID: string = "0f000000-0000-4000-8000-0000000000a2";
const GIVEN_ID: string = "0f000000-0000-4000-8000-0000000000b1";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID;

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: currentProject,
} as unknown as PageComponentProps;

let roles: Array<CustomRole> = [];
let rolePermissions: Array<CustomRolePermission> = [];
let givenRows: Array<ApiKeyCustomRole> = [];

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

function role(
  id: string,
  name: string,
  permissions: Array<[Permission, PermissionScope]>,
): CustomRole {
  const customRole: CustomRole = new CustomRole();
  customRole._id = id;
  customRole.name = name;
  customRole.permissionCount = permissions.length;

  for (const [permission, scope] of permissions) {
    const row: CustomRolePermission = new CustomRolePermission();
    row._id = ObjectID.generate().toString();
    row.customRoleId = new ObjectID(id);
    row.permission = permission;
    row.scope = scope;
    row.labels = [];
    rolePermissions.push(row);
  }

  return customRole;
}

function givenToKey(customRole: CustomRole): ApiKeyCustomRole {
  const given: ApiKeyCustomRole = new ApiKeyCustomRole();
  given._id = GIVEN_ID;
  given.apiKeyId = new ObjectID(KEY_ID);
  given.customRoleId = new ObjectID(customRole._id!.toString());
  given.customRole = customRole;
  return given;
}

function apiKey(): ApiKey {
  const key: ApiKey = new ApiKey();
  key._id = KEY_ID;
  key.name = "Deploy bot";
  key.expiresAt = OneUptimeDate.getSomeDaysAfter(365);
  key.apiKey = new ObjectID("0f000000-0000-4000-8000-0000000000aa");
  return key;
}

// Incident Responder: six permissions, two limited to what someone owns.
function responder(): CustomRole {
  return role(RESPONDER_ID, "Incident Responder", [
    [Permission.IncidentMember, PermissionScope.All],
    [Permission.AlertMember, PermissionScope.All],
    [Permission.OnCallViewer, PermissionScope.All],
    [Permission.StatusPageMember, PermissionScope.All],
    [Permission.MonitorViewer, PermissionScope.Owned],
    [Permission.ScheduledMaintenanceMember, PermissionScope.Owned],
  ]);
}

function auditor(): CustomRole {
  return role(AUDITOR_ID, "Auditor", [
    [Permission.Viewer, PermissionScope.All],
    [Permission.ReadAuditLog, PermissionScope.All],
    [Permission.ReadProjectApiKey, PermissionScope.All],
  ]);
}

beforeEach(() => {
  licenseModeForTest = "editable";
  holding([Permission.ProjectOwner]);
  roles = [];
  rolePermissions = [];
  givenRows = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/settings/api-keys/${KEY_ID}`,
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(KEY_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getItemMock.mockImplementation(async (): Promise<any> => {
    return apiKey();
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const answer: (data: Array<unknown>) => any = (
      data: Array<unknown>,
    ): any => {
      return { data: data, count: data.length, skip: 0, limit: 50 };
    };

    if (params.modelType === CustomRole) {
      return answer(roles);
    }

    if (params.modelType === CustomRolePermission) {
      return answer(rolePermissions);
    }

    if (params.modelType === ApiKeyCustomRole) {
      return answer(givenRows);
    }

    return answer([]);
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: ObjectID.generate().toString(),
        customRoleId: data.model.customRoleId,
      },
    };
  });

  deleteItemMock.mockImplementation(async (): Promise<void> => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  deleteItemMock.mockReset();
  jest.restoreAllMocks();
});

// The page has loaded: the key's own Permissions card shows its empty state.
async function renderPage(): Promise<void> {
  render(
    <MemoryRouter
      initialEntries={[`/dashboard/${PROJECT_ID}/settings/api-keys/${KEY_ID}`]}
    >
      <APIKeyViewPage {...pageProps} />
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(
        screen.getAllByText(/This key can do nothing yet/).length,
      ).toBeGreaterThanOrEqual(1);
    },
    { timeout: 10000 },
  );
}

async function customRolesCard(): Promise<HTMLElement> {
  return await screen.findByTestId(
    API_KEY_CUSTOM_ROLES_TEST_ID,
    {},
    { timeout: 10000 },
  );
}

function addCustomRoleButton(container: HTMLElement): HTMLElement {
  const button: HTMLElement | undefined = within(container)
    .getAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === "Add Custom Role";
    });

  if (!button) {
    throw new Error("No Add Custom Role button");
  }

  return button;
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

describe("an API key's custom roles", () => {
  test("with a lapsed license, the key's roles stay, and Add Custom Role is gone", async () => {
    licenseModeForTest = "read-only";
    const incidentResponder: CustomRole = responder();
    roles = [auditor(), incidentResponder];
    givenRows = [givenToKey(incidentResponder)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    expect(
      await within(card).findByRole("link", { name: "Incident Responder" }),
    ).toBeInTheDocument();
    expect(
      within(card)
        .queryAllByTestId("card-button")
        .filter((button: HTMLElement): boolean => {
          return (button.textContent || "").trim() === "Add Custom Role";
        }),
    ).toEqual([]);
  });

  test("a project with no custom role sees the key's page as before: no Custom Roles card", async () => {
    await renderPage();

    // The roles were asked for, and there are none.
    await waitFor(() => {
      expect(listCallsFor(CustomRole).length).toBeGreaterThan(0);
    });

    expect(screen.queryByTestId(API_KEY_CUSTOM_ROLES_TEST_ID)).toBeNull();
    expect(screen.queryByText("Add Custom Role")).toBeNull();
  });

  test("lists the key's roles, each a link to the role, saying how many of its permissions apply to the key", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [auditor(), incidentResponder];
    givenRows = [givenToKey(incidentResponder)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    const link: HTMLElement = await within(card).findByRole("link", {
      name: "Incident Responder",
    });
    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/teams/roles/${RESPONDER_ID}`,
    );
    expect(
      await within(card).findByText("4 of its 6 permissions apply to this key"),
    ).toBeInTheDocument();

    // The description says where roles are made, as a link.
    expect(
      within(card).getByRole("link", { name: "Roles" }).getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/teams/roles`);
    expect(
      within(card).getByText(/Changing a role changes this key too\./),
    ).toBeInTheDocument();

    // The key's roles are read by the key and the project.
    const keyRoles: any = listCallsFor(ApiKeyCustomRole)[0];
    expect(keyRoles.query.apiKeyId.toString()).toBe(KEY_ID);
  });

  test("a role whose every permission is limited to what someone owns says none applies to the key", async () => {
    const ownedOnly: CustomRole = role(RESPONDER_ID, "Own Things", [
      [Permission.MonitorViewer, PermissionScope.Owned],
    ]);
    roles = [ownedOnly];
    givenRows = [givenToKey(ownedOnly)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    expect(
      await within(card).findByText(
        "None of its permissions apply to this key",
      ),
    ).toBeInTheDocument();
  });

  test("Add Custom Role offers only the roles the key has not got, and gives the one picked", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [auditor(), incidentResponder];
    givenRows = [givenToKey(incidentResponder)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();
    await within(card).findByText("4 of its 6 permissions apply to this key");

    await act(async (): Promise<void> => {
      fireEvent.click(addCustomRoleButton(card));
    });

    const modal: HTMLElement = await screen.findByTestId("modal");
    expect(within(modal).getByText("Add a Custom Role")).toBeInTheDocument();
    // Auditor, the one role offered, gives a key all of itself: no exception said.
    expect(within(modal).getByTestId("modal-description")).toHaveTextContent(
      "The key gets everything the role allows. Make or change roles on the Roles page.",
    );
    expect(within(modal).queryByText(/Only resources they own/)).toBeNull();
    // "Roles" is a link to the Roles page, where roles are made.
    const rolesLink: HTMLElement = within(
      within(modal).getByTestId("modal-description"),
    ).getByRole("link", { name: "Roles" });
    expect(rolesLink).toHaveAttribute(
      "href",
      expect.stringContaining("/teams/roles"),
    );

    // Only Auditor: the key has Incident Responder.
    expect(
      within(modal).queryByTestId(`card-select-option-${RESPONDER_ID}`),
    ).toBeNull();
    const auditorCard: HTMLElement = within(modal).getByTestId(
      `card-select-option-${AUDITOR_ID}`,
    );
    expect(within(auditorCard).getByText("Auditor")).toBeInTheDocument();
    expect(within(auditorCard).getByText("3 permissions")).toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(auditorCard);
    });

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByRole("button", { name: "Add Role" }));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    });

    const sent: any = createOrUpdateMock.mock.calls[0]![0];
    expect(sent.modelType).toBe(ApiKeyCustomRole);
    expect(sent.model.apiKeyId.toString()).toBe(KEY_ID);
    expect(sent.model.customRoleId.toString()).toBe(AUDITOR_ID);
    expect(sent.model.projectId.toString()).toBe(PROJECT_ID);
  });

  test("a role that gives the key part of itself says why behind an (i), in the Scope column's words", async () => {
    const incidentResponder: CustomRole = responder();
    const auditorRole: CustomRole = auditor();
    roles = [auditorRole, incidentResponder];
    givenRows = [
      givenToKey(incidentResponder),
      (() => {
        const given: ApiKeyCustomRole = givenToKey(auditorRole);
        given._id = "0f000000-0000-4000-8000-0000000000b2";
        return given;
      })(),
    ];

    await renderPage();
    const card: HTMLElement = await customRolesCard();
    await within(card).findByText("4 of its 6 permissions apply to this key");

    // One (i), on the role that gives the key part of itself; none on Auditor.
    const reasons: Array<HTMLElement> = within(card).getAllByTestId(
      API_KEY_ROLE_OWNED_REASON_TEST_ID,
    );
    expect(reasons).toHaveLength(1);
    const reason: HTMLElement = reasons[0]!;
    expect(reason.tagName).toBe("BUTTON");
    expect(reason).toHaveAttribute(
      "aria-label",
      "About the permissions that apply to this key",
    );
    expect(
      within(card)
        .getByText("4 of its 6 permissions apply to this key")
        .closest("p"),
    ).toContainElement(reason);
    expect(
      within(card)
        .getByText("3 permissions")
        .closest("p")!
        .querySelector("button"),
    ).toBeNull();

    fireEvent.mouseEnter(reason);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Permissions scoped to “Only resources they own” don't apply to an API key: a key owns nothing.",
    );
  });

  test("a role whose every permission is owned-only says why too", async () => {
    const ownedOnly: CustomRole = role(RESPONDER_ID, "Own Things", [
      [Permission.MonitorViewer, PermissionScope.Owned],
    ]);
    roles = [ownedOnly];
    givenRows = [givenToKey(ownedOnly)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();
    await within(card).findByText("None of its permissions apply to this key");

    expect(
      within(card).getByTestId(API_KEY_ROLE_OWNED_REASON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("Add Custom Role names the Owned exception when a role it offers has such a permission", async () => {
    roles = [responder(), auditor()];
    givenRows = [];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    await waitFor(() => {
      expect(addCustomRoleButton(card)).not.toBeDisabled();
    });

    await act(async (): Promise<void> => {
      fireEvent.click(addCustomRoleButton(card));
    });

    const modal: HTMLElement = await screen.findByTestId("modal");
    await waitFor(() => {
      expect(within(modal).getByTestId("modal-description")).toHaveTextContent(
        "The key gets everything the role allows, except permissions scoped to “Only resources they own”: a key owns nothing. Make or change roles on the Roles page.",
      );
    });
    expect(
      within(within(modal).getByTestId("modal-description")).getByRole(
        "link",
        { name: "Roles" },
      ),
    ).toBeInTheDocument();
    // And the card of that role says how much of it the key would hold.
    expect(
      within(
        within(modal).getByTestId(`card-select-option-${RESPONDER_ID}`),
      ).getByText(/4 of its 6 permissions apply to this key/),
    ).toBeInTheDocument();
  });

  test("when the key has every role, Add Custom Role is off and says why", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [incidentResponder];
    givenRows = [givenToKey(incidentResponder)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();
    await within(card).findByText("4 of its 6 permissions apply to this key");

    await waitFor(() => {
      expect(addCustomRoleButton(card)).toBeDisabled();
    });

    const button: HTMLElement = addCustomRoleButton(card);
    expect(button).toHaveAttribute("aria-disabled", "true");

    // The reason waits on the button's wrapper, which can still be hovered.
    fireEvent.mouseEnter(button.parentElement!);
    // A tooltip cannot hold a link: the card's own words link the Roles page.
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "This key has every custom role already.",
    );
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("Roles page");

    fireEvent.click(button);
    await act(async (): Promise<void> => {});
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("someone who may not change what a key can do sees Add Custom Role locked, with the reason", async () => {
    holding([Permission.ReadProjectApiKey, Permission.ReadProjectTeam]);
    roles = [auditor()];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    await waitFor(() => {
      expect(addCustomRoleButton(card)).toBeDisabled();
    });

    const button: HTMLElement = addCustomRoleButton(card);
    fireEvent.mouseEnter(button.parentElement!);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "You do not have permission to create this API Key Custom Role. You need one of these permissions: Project Owner, Project Admin, Edit API Key Permissions.",
    );

    fireEvent.click(button);
    await act(async (): Promise<void> => {});
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("Remove says what the key loses, and that its other roles and permissions stay", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [incidentResponder];
    givenRows = [givenToKey(incidentResponder)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();
    await within(card).findByText("4 of its 6 permissions apply to this key");

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
      await screen.findByText("Remove Incident Responder"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This key loses the permissions of Incident Responder. Its other roles and permissions stay.",
      ),
    ).toBeInTheDocument();
  });

  test("the key's own Permissions card never lists a role's copies", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [incidentResponder];
    givenRows = [givenToKey(incidentResponder)];

    await renderPage();
    await customRolesCard();

    const ownRows: Array<any> = listCallsFor(ApiKeyPermission);
    expect(ownRows.length).toBeGreaterThan(0);

    for (const call of ownRows) {
      expect(call.query.apiKeyCustomRoleId).toBeInstanceOf(IsNull);
    }
  });
});
