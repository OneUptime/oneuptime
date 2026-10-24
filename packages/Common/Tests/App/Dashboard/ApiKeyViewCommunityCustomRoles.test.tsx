import "@testing-library/jest-dom";
import {
  cleanup,
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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN API KEY'S CUSTOM ROLES ON THE COMMUNITY EDITION, on the key's real page
 * with only the network stubbed. Custom roles are an Enterprise feature
 * (ee/Tests/UI/CustomRoles/ApiKeyViewCustomRoles.test.tsx holds the
 * Enterprise card); here, with the Community Edition's empty plugins:
 *
 *   - a key with no custom role shows no custom roles card at all;
 *   - a key that still has custom roles keeps their permissions, so they
 *     are listed, still in force, each with Remove - and nothing offers to
 *     give it another;
 *   - the key's own Permissions card never lists a role's copies.
 */

/*
 * A self-hosted Community Edition install: billing off and not the
 * Enterprise Edition, whatever the environment says. CI's config.env turns
 * billing on for every suite, and with billing on the page asks the
 * project's plan instead of the edition.
 */
jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
    IS_ENTERPRISE_EDITION: false,
  };
});

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

// How many custom roles the key has, as ModelAPI.count answers.
let roleCountForTest: number = 0;

(
  globalThis as unknown as { __apiKeyRoleCount: (params: any) => number }
).__apiKeyRoleCount = (params: any): number => {
  return params?.modelType?.name === "ApiKeyCustomRole" ? roleCountForTest : 0;
};

jest.mock("../../../UI/Utils/Permission", () => {
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

jest.mock("../../../UI/Utils/User", () => {
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
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
        return (
          globalThis as unknown as {
            __apiKeyRoleCount: (params: any) => number;
          }
        ).__apiKeyRoleCount(params);
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

jest.mock("../../../UI/Utils/Project", () => {
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

import APIKeyViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "../../../Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import OneUptimeDate from "../../../Types/Date";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";
import CustomRoleLeftoverCopy, {
  API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleLeftoverCopy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0f000000-0000-4000-8000-000000000001";
const KEY_ID: string = "0f000000-0000-4000-8000-000000000002";
const RESPONDER_ID: string = "0f000000-0000-4000-8000-0000000000a1";
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

beforeEach(() => {
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

describe("an API key's custom roles on the Community Edition", () => {
  beforeEach(() => {
    roleCountForTest = 0;
  });

  test("a key with no custom role shows no custom roles card", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.queryByText("Add Custom Role")).toBeNull();
    });

    expect(
      screen.queryByTestId(API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID),
    ).toBeNull();
    expect(screen.queryByText(CustomRoleLeftoverCopy.apiKeyTitle)).toBeNull();
  });

  test("a key that still has custom roles lists them, still in force, with Remove and nothing to add", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [incidentResponder];
    givenRows = [givenToKey(incidentResponder)];
    roleCountForTest = 1;

    await renderPage();

    const card: HTMLElement = await screen.findByTestId(
      API_KEY_CUSTOM_ROLES_LEFTOVER_TEST_ID,
      {},
      { timeout: 10000 },
    );

    expect(
      within(card).getByText(CustomRoleLeftoverCopy.apiKeyTitle),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(CustomRoleLeftoverCopy.apiKeyEditionDescription),
    ).toBeInTheDocument();
    expect(
      await within(card).findByText("Incident Responder"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Add Custom Role")).toBeNull();

    const rows: Array<any> = listCallsFor(ApiKeyCustomRole);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].query.apiKeyId.toString()).toBe(KEY_ID);
  });

  test("the key's own Permissions card never lists a role's copies", async () => {
    const incidentResponder: CustomRole = responder();
    roles = [incidentResponder];
    givenRows = [givenToKey(incidentResponder)];
    roleCountForTest = 1;

    await renderPage();

    const ownRows: Array<any> = listCallsFor(ApiKeyPermission);
    expect(ownRows.length).toBeGreaterThan(0);

    for (const call of ownRows) {
      expect(call.query.apiKeyCustomRoleId).toBeInstanceOf(IsNull);
    }
  });
});

function listCallsFor(modelType: unknown): Array<any> {
  return getListMock.mock.calls
    .map((args: Array<any>): any => {
      return args[0];
    })
    .filter((call: any): boolean => {
      return call.modelType === modelType;
    });
}
