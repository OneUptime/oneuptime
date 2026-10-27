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
 * A TEAM'S CUSTOM ROLES ON THE ENTERPRISE EDITION, on the team's real
 * Permissions page with only the network stubbed.
 *
 * "Move custom roles to More settings because it is an advanced feature."
 * - the maintainer. The page opens on the team's own Permissions, and the
 * Enterprise Custom Roles card waits folded under More settings, before
 * Block Permissions:
 *
 *   - a project with no custom role sees the page as before: no card, and
 *     More settings naming Block Permissions alone;
 *   - with roles, More settings names Custom Roles, and how many roles the
 *     team has, while folded - and nothing of it opens by itself;
 *   - Owners and Admin, whose permissions can't change, draw no card, so
 *     More settings does not name it;
 *   - giving the team a role from the card updates the folded count;
 *   - the team's empty Permissions card says its custom roles give it its
 *     access;
 *   - a link to #custom-roles opens More settings at the card.
 */

// A valid license, unless a test lets it lapse.
let licenseModeForTest: string = "editable";

(
  globalThis as unknown as { __teamLicenseModeForTest: () => string }
).__teamLicenseModeForTest = (): string => {
  return licenseModeForTest;
};

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __teamLicenseModeForTest: () => string }
        ).__teamLicenseModeForTest();
      },
    };
  },
);

/*
 * The Enterprise Edition, self-hosted: the team's page draws the
 * Enterprise card through its core shell (TeamCustomRolesSettings).
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
            return "0e000000-0000-4000-8000-000000000001";
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

import TeamViewPermissions, {
  TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID,
} from "@oneuptime/dashboard/Pages/Teams/View/Permissions";
import { TEAM_CUSTOM_ROLES_TEST_ID } from "../../../Dashboard/CustomRoles/TeamCustomRoleTable";
import {
  CUSTOM_ROLES_CARD_PLACE,
  TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION,
  TEAM_MORE_SETTINGS_ROLES_DESCRIPTION,
  TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
} from "@oneuptime/dashboard/Components/CustomRole/CustomRolesFold";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap from "@oneuptime/dashboard/Utils/RouteMap";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Route from "Common/Types/API/Route";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "Common/Tests/Spy";
import {
  listedNames,
  setChips,
} from "Common/Tests/UI/Components/FoldedSection/FoldedSectionQueries";

jest.setTimeout(30000);

const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";
const TEAM_ID: string = "0e000000-0000-4000-8000-000000000002";
const RESPONDER_ID: string = "0e000000-0000-4000-8000-0000000000a1";
const LEAD_ID: string = "0e000000-0000-4000-8000-0000000000a2";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID;

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAM_VIEW_PERMISSIONS] as Route,
  hasPaymentMethod: true,
  currentProject: currentProject,
} as unknown as PageComponentProps;

let roles: Array<CustomRole> = [];
let givenRows: Array<TeamCustomRole> = [];
// False for Owners and Admin, whose permissions can't change.
let isPermissionsEditable: boolean = true;

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

function role(id: string, name: string, permissionCount: number): CustomRole {
  const customRole: CustomRole = new CustomRole();
  customRole._id = id;
  customRole.name = name;
  customRole.permissionCount = permissionCount;
  return customRole;
}

function givenToTeam(customRole: CustomRole): TeamCustomRole {
  const given: TeamCustomRole = new TeamCustomRole();
  given._id = ObjectID.generate().toString();
  given.teamId = new ObjectID(TEAM_ID);
  given.customRoleId = new ObjectID(customRole._id!.toString());
  given.customRole = customRole;
  return given;
}

beforeEach(() => {
  licenseModeForTest = "editable";
  holding([Permission.ProjectOwner]);
  roles = [];
  givenRows = [];
  isPermissionsEditable = true;
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/teams/${TEAM_ID}/permissions`,
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(TEAM_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === Team) {
      const team: Team = new Team();
      team._id = TEAM_ID;
      team.isPermissionsEditable = isPermissionsEditable;
      return team;
    }

    return null;
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

    if (params.modelType === TeamCustomRole) {
      return answer(givenRows);
    }

    if (params.modelType === TeamPermission) {
      return answer([]);
    }

    return answer([]);
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    const picked: CustomRole | undefined = roles.find(
      (candidate: CustomRole): boolean => {
        return (
          candidate._id?.toString() === data.model.customRoleId?.toString()
        );
      },
    );

    if (picked) {
      givenRows = [...givenRows, givenToTeam(picked)];
    }

    return {
      data: {
        _id: ObjectID.generate().toString(),
        customRoleId: data.model.customRoleId,
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

// The page has loaded: the team's own Permissions card shows its empty state.
async function renderPage(): Promise<void> {
  render(
    <MemoryRouter
      initialEntries={[`/dashboard/${PROJECT_ID}/teams/${TEAM_ID}/permissions`]}
    >
      <TeamViewPermissions {...pageProps} />
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(
        screen.getAllByText(
          /This team can do nothing yet|This team has no permissions of its own yet/,
        ).length,
      ).toBeGreaterThanOrEqual(1);
    },
    { timeout: 10000 },
  );
}

function moreSettings(): HTMLElement {
  return screen.getByTestId(TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID);
}

function moreSettingsHeader(): HTMLElement {
  return within(moreSettings()).getByRole("button", {
    name: "More settings",
  });
}

function permissionsCard(): HTMLElement {
  const heading: HTMLElement | undefined = screen
    .getAllByTestId("card-details-heading")
    .find((candidate: HTMLElement): boolean => {
      return candidate.textContent === "Permissions";
    });

  return heading!.closest("[data-testid='card']") as HTMLElement;
}

async function customRolesCard(): Promise<HTMLElement> {
  return await screen.findByTestId(
    TEAM_CUSTOM_ROLES_TEST_ID,
    {},
    { timeout: 10000 },
  );
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

describe("a team's custom roles, folded under More settings", () => {
  test("a project with no custom role sees the page as before: no card, More settings naming Block Permissions alone", async () => {
    await renderPage();

    await waitFor(() => {
      expect(listCallsFor(CustomRole).length).toBeGreaterThan(0);
    });
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId(TEAM_CUSTOM_ROLES_TEST_ID)).toBeNull();
    expect(listedNames(moreSettingsHeader())).toEqual(["Block Permissions"]);

    fireEvent.click(moreSettingsHeader());

    expect(
      within(moreSettingsHeader()).getByText(
        TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION,
      ),
    ).toBeInTheDocument();
  });

  test("with roles, the page opens on Permissions and the card waits folded, before Block Permissions, the header saying how many the team has", async () => {
    const responder: CustomRole = role(RESPONDER_ID, "Incident Responder", 6);
    const lead: CustomRole = role(LEAD_ID, "Team Lead", 3);
    roles = [responder, lead];
    givenRows = [givenToTeam(responder), givenToTeam(lead)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    expect(moreSettings()).toContainElement(card);
    expect(moreSettings()).not.toContainElement(permissionsCard());
    expect(
      Boolean(
        permissionsCard().compareDocumentPosition(moreSettings()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    // Folded, and saying so does not open it.
    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(listedNames(moreSettingsHeader())).toEqual([
        "Custom Roles: 2",
        "Block Permissions",
      ]);
    });
    expect(setChips(moreSettingsHeader())).toEqual(["Custom Roles: 2"]);
    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "false");

    // The card is the place a link to it names.
    expect(card).toContainElement(
      document.getElementById(CUSTOM_ROLES_CARD_PLACE),
    );

    fireEvent.click(moreSettingsHeader());

    expect(
      within(moreSettingsHeader()).getByText(
        TEAM_MORE_SETTINGS_ROLES_DESCRIPTION,
      ),
    ).toBeInTheDocument();
    expect(
      await within(card).findByRole("link", { name: "Incident Responder" }),
    ).toBeInTheDocument();
  });

  test("with roles none of which the team has: Custom Roles is named, not set", async () => {
    roles = [role(RESPONDER_ID, "Incident Responder", 6)];

    await renderPage();
    await customRolesCard();

    await waitFor(() => {
      expect(listedNames(moreSettingsHeader())).toEqual([
        "Custom Roles",
        "Block Permissions",
      ]);
    });
    expect(setChips(moreSettingsHeader())).toEqual([]);
  });

  test("Owners and Admin, whose permissions can't change, draw no card, so More settings does not name it", async () => {
    roles = [role(RESPONDER_ID, "Incident Responder", 6)];
    isPermissionsEditable = false;

    await renderPage();

    await waitFor(() => {
      expect(listCallsFor(CustomRole).length).toBeGreaterThan(0);
    });
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId(TEAM_CUSTOM_ROLES_TEST_ID)).toBeNull();
    expect(listedNames(moreSettingsHeader())).toEqual(["Block Permissions"]);
  });

  test("giving the team a role from the card: the folded count follows", async () => {
    const responder: CustomRole = role(RESPONDER_ID, "Incident Responder", 6);
    const lead: CustomRole = role(LEAD_ID, "Team Lead", 3);
    roles = [responder, lead];
    givenRows = [givenToTeam(responder)];

    await renderPage();
    const card: HTMLElement = await customRolesCard();

    await waitFor(() => {
      expect(setChips(moreSettingsHeader())).toEqual(["Custom Roles: 1"]);
    });

    fireEvent.click(moreSettingsHeader());

    const add: HTMLElement | undefined = within(card)
      .getAllByTestId("card-button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === "Add Custom Role";
      });

    fireEvent.click(add!);

    const modal: HTMLElement = await screen.findByTestId("modal");

    fireEvent.click(await within(modal).findByText("Team Lead"));

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    // Folded again, the header counts the role just given.
    fireEvent.click(moreSettingsHeader());

    await waitFor(() => {
      expect(setChips(moreSettingsHeader())).toEqual(["Custom Roles: 2"]);
    });
  });

  test("a team whose access comes from its custom roles alone is not told it can do nothing", async () => {
    const responder: CustomRole = role(RESPONDER_ID, "Incident Responder", 6);
    roles = [responder];
    givenRows = [givenToTeam(responder)];

    await renderPage();
    await customRolesCard();

    await waitFor(() => {
      expect(
        within(permissionsCard()).getByText(
          TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES.split(". ")[0] as string,
        ),
      ).toBeInTheDocument();
    });
    expect(
      within(permissionsCard()).queryByText("This team can do nothing yet"),
    ).toBeNull();
  });

  test("opened at #custom-roles: More settings opens at the card", async () => {
    const responder: CustomRole = role(RESPONDER_ID, "Incident Responder", 6);
    roles = [responder];
    givenRows = [givenToTeam(responder)];
    window.history.replaceState(
      window.history.state,
      "",
      `/dashboard/${PROJECT_ID}/teams/${TEAM_ID}/permissions#${CUSTOM_ROLES_CARD_PLACE}`,
    );

    await renderPage();
    await customRolesCard();

    await waitFor(() => {
      expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "true");
    });
  });
});
