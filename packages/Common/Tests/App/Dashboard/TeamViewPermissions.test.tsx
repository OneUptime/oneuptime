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
 * A TEAM'S PERMISSIONS PAGE, on the real page with only the network stubbed.
 *
 * Block permissions used to have a page of their own beside Permissions in
 * the team's menu, as prominent as what the team can do though few teams
 * need one. Now, as on an API key's page:
 *
 *   - the page reads in the order it is used: Permissions, then a folded
 *     Advanced section holding Block Permissions;
 *   - Advanced starts folded, says what is in it, and says "Configured"
 *     while the team has any block permission;
 *   - Permissions offers Add Role - the role cards, a plain grid - as its
 *     one button, and Add Permission in the card's More menu;
 *   - an empty Permissions card says the team can do nothing yet and
 *     repeats Add Role (a new team created with Choose permissions later
 *     lands here);
 *   - Block Permissions keeps adding rows as it did, as block rows;
 *   - someone who may not change a team's permissions sees the buttons
 *     locked, with the reason.
 */

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

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
const createOrUpdateMock: MockFunction = getJestMockFunction();

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
      getItem: async (): Promise<null> => {
        return null;
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0b000000-0000-4000-8000-000000000001";
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
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: string = "0b000000-0000-4000-8000-000000000001";
const TEAM_ID: string = "0b000000-0000-4000-8000-000000000002";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID;

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAM_VIEW_PERMISSIONS] as Route,
  hasPaymentMethod: true,
  currentProject: currentProject,
} as unknown as PageComponentProps;

const BLOCK_SECTION_DESCRIPTION: string =
  "Block permissions: what this team can never do, even when one of its roles or permissions allows it.";

let allowRows: Array<TeamPermission> = [];
let blockRows: Array<TeamPermission> = [];

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

function permissionRow(
  permission: Permission,
  isBlockPermission: boolean = false,
): TeamPermission {
  const row: TeamPermission = new TeamPermission();
  row._id = ObjectID.generate().toString();
  row.teamId = new ObjectID(TEAM_ID);
  row.permission = permission;
  row.isBlockPermission = isBlockPermission;
  row.scope = PermissionScope.All;
  row.labels = [];
  return row;
}

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  allowRows = [];
  blockRows = [];
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

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === TeamPermission) {
      const rows: Array<TeamPermission> = params.query?.isBlockPermission
        ? blockRows
        : allowRows;

      return { data: rows, count: rows.length, skip: 0, limit: 10 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: ObjectID.generate().toString(),
        permission: data.model.permission,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(<TeamViewPermissions {...pageProps} />);

  // Both tables have loaded: each shows its rows or its empty state.
  await waitFor(
    () => {
      expect(
        screen.getAllByText(
          /This team can do nothing yet|Nothing is blocked for this team|All resources in project/,
        ).length,
      ).toBeGreaterThanOrEqual(2);
    },
    { timeout: 10000 },
  );
}

function card(title: string): HTMLElement {
  const heading: HTMLElement | undefined = screen
    .getAllByTestId("card-details-heading")
    .find((candidate: HTMLElement): boolean => {
      return candidate.textContent === title;
    });

  if (!heading) {
    throw new Error(`No card titled ${title}`);
  }

  return heading.closest("[data-testid='card']") as HTMLElement;
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

// An item of a card's More (...) menu, opened.
async function moreMenuItem(
  container: HTMLElement,
  text: string,
): Promise<HTMLElement> {
  fireEvent.click(
    within(container).getByRole("button", { name: "More options" }),
  );

  return await screen.findByRole("menuitem", { name: text });
}

function advancedSection(): HTMLElement {
  return screen.getByTestId(TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID);
}

function advancedHeader(): HTMLElement {
  return within(advancedSection()).getByRole("button", {
    name: /^Advanced/,
  });
}

// The folded body the header opens: out of sight and reach while folded.
function advancedBody(): HTMLElement {
  return document.getElementById(
    advancedHeader().getAttribute("aria-controls") || "",
  ) as HTMLElement;
}

/*
 * BasicForm applies its fields' default values (a role's Scope starts on
 * All) in an effect after the fields are drawn, and only until the user
 * first changes something. A real click never comes that fast; a test's
 * can, so let the effects run before touching the form.
 */
async function settleForm(): Promise<void> {
  for (let tick: number = 0; tick < 3; tick++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function openModal(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(trigger);

  const modal: HTMLElement = await screen.findByTestId("modal");

  // The form is drawn: the role cards, or the one-permission picker.
  await waitFor(() => {
    expect(
      within(modal).queryAllByRole("radio").length > 0 ||
        within(modal).queryByPlaceholderText("Search permissions...") !== null,
    ).toBe(true);
  });

  await settleForm();

  return modal;
}

async function submitModal(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: /^Create Team Permission/ }),
    );
  });
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the page", () => {
  test("reads Permissions, then Advanced holding Block Permissions", async () => {
    await renderPage();

    const permissions: HTMLElement = card("Permissions");
    const block: HTMLElement = card("Block Permissions");

    expect(isBefore(permissions, advancedSection())).toBe(true);

    // The block table is inside the folded section, the allow table is not.
    expect(advancedSection()).toContainElement(block);
    expect(advancedSection()).not.toContainElement(permissions);

    // The old name of the allow card is gone.
    expect(
      screen
        .getAllByTestId("card-details-heading")
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).not.toContain("Allow Permissions");
  });

  test("Advanced starts folded and says what is in it", async () => {
    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(advancedHeader()).not.toHaveTextContent("Configured");

    // Folded, it already says block permissions are in there.
    expect(
      within(advancedSection()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(BLOCK_SECTION_DESCRIPTION);

    // Mounted, but out of sight and reach while it is folded.
    expect(advancedBody()).toContainElement(card("Block Permissions"));
    expect(advancedBody()).toHaveClass("invisible");

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(advancedHeader()).getByText(BLOCK_SECTION_DESCRIPTION),
    ).toBeInTheDocument();
    expect(advancedBody()).not.toHaveClass("invisible");
  });

  test("Advanced says Configured while the team has block permissions", async () => {
    blockRows = [permissionRow(Permission.AuthorizeMcpClient, true)];

    await renderPage();

    await waitFor(() => {
      expect(advancedHeader()).toHaveTextContent("Configured");
    });
    // Saying so does not open it.
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("an allow row alone does not make Advanced say Configured", async () => {
    allowRows = [permissionRow(Permission.ProjectMember)];

    await renderPage();

    await within(card("Permissions")).findByText(
      PermissionHelper.getTitle(Permission.ProjectMember),
    );
    await act(async (): Promise<void> => {});

    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });
});

describe("what the team's members can do", () => {
  test("is added with Add Role, or Add Permission from the More menu", async () => {
    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    // One button on the card: a role is what most teams need.
    expect(cardButton(permissions, "Add Role")).toBeEnabled();
    expect(() => {
      return cardButton(permissions, "Add Permission");
    }).toThrow();

    expect(await moreMenuItem(permissions, "Add Permission")).toBeEnabled();
    expect(
      within(permissions).getByText(
        "What this team's members can do. Add a role for a ready-made set of permissions, or a single permission for exactly what you need.",
      ),
    ).toBeInTheDocument();
  });

  test("a team with none says so and repeats Add Role", async () => {
    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    expect(
      within(permissions).getByText("This team can do nothing yet"),
    ).toBeInTheDocument();
    expect(
      within(permissions).getByText("Add a role to give it access."),
    ).toBeInTheDocument();
    expect(
      within(permissions).getByTestId("empty-table-create-button"),
    ).toHaveTextContent("Add Role");
  });

  test("Add Role shows every role card, as a plain grid, and adds the role picked as an allow row for all resources", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    const roles: number = PermissionHelper.getRolePermissionProps().length;
    expect(within(modal).getAllByRole("radio")).toHaveLength(roles);
    expect(within(modal).getByText("Domain Roles")).toBeInTheDocument();
    // No search box on the role grid.
    expect(within(modal).queryByRole("searchbox")).toBeNull();

    fireEvent.click(
      within(modal).getByTestId(
        `card-select-option-${Permission.IncidentMember}`,
      ),
    );

    // A role that can be scoped asks how far it reaches, starting on All.
    expect(
      await within(modal).findByText("All resources in the project"),
    ).toBeInTheDocument();

    await submitModal(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(TeamPermission);
    expect(request.model.permission).toBe(Permission.IncidentMember);
    expect(request.model.teamId?.toString()).toBe(TEAM_ID);
    expect(request.model.projectId?.toString()).toBe(PROJECT_ID);
    expect(request.model.isBlockPermission).toBe(false);
    expect(request.model.scope).toBe(PermissionScope.All);
  });

  test("the empty state's Add Role opens the same role cards", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      within(card("Permissions")).getByTestId("empty-table-create-button"),
    );

    expect(
      within(modal).getByTestId(`card-select-option-${Permission.Viewer}`),
    ).toBeInTheDocument();
  });

  test("Add Permission keeps the one-permission picker", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      await moreMenuItem(card("Permissions"), "Add Permission"),
    );

    expect(
      within(modal).getByPlaceholderText("Search permissions..."),
    ).toBeInTheDocument();
    expect(within(modal).queryAllByRole("radio")).toEqual([]);
  });

  test("lists the team's roles with their scope", async () => {
    allowRows = [permissionRow(Permission.ProjectAdmin)];

    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    expect(
      await within(permissions).findByText(
        PermissionHelper.getTitle(Permission.ProjectAdmin),
      ),
    ).toBeInTheDocument();
    expect(
      within(permissions).getByText("All resources in project"),
    ).toBeInTheDocument();
  });
});

describe("what the team's members can never do", () => {
  test("is added from Advanced, as a block row", async () => {
    await renderPage();

    fireEvent.click(advancedHeader());

    const block: HTMLElement = card("Block Permissions");

    expect(
      within(block).getByText("Nothing is blocked for this team"),
    ).toBeInTheDocument();
    expect(
      within(block).getByText(
        "Blocks win over this team's roles and permissions. A block with labels applies only to resources that carry one of them.",
      ),
    ).toBeInTheDocument();
    // An empty block list is not an invitation to block something.
    expect(within(block).queryByTestId("empty-table-create-button")).toBeNull();

    const modal: HTMLElement = await openModal(cardButton(block, "Add Role"));

    fireEvent.click(
      within(modal).getByTestId(
        `card-select-option-${Permission.BillingAdmin}`,
      ),
    );

    await submitModal(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.modelType).toBe(TeamPermission);
    expect(request.model.permission).toBe(Permission.BillingAdmin);
    expect(request.model.isBlockPermission).toBe(true);
    expect(request.model.teamId?.toString()).toBe(TEAM_ID);
  });

  test("the two tables never mix their rows", async () => {
    allowRows = [permissionRow(Permission.ProjectAdmin)];
    blockRows = [permissionRow(Permission.AuthorizeMcpClient, true)];

    await renderPage();

    const permissions: HTMLElement = card("Permissions");
    const block: HTMLElement = card("Block Permissions");

    await within(permissions).findByText(
      PermissionHelper.getTitle(Permission.ProjectAdmin),
    );
    await within(block).findByText(
      PermissionHelper.getTitle(Permission.AuthorizeMcpClient),
    );

    expect(
      within(permissions).queryByText(
        PermissionHelper.getTitle(Permission.AuthorizeMcpClient),
      ),
    ).toBeNull();
    expect(
      within(block).queryByText(
        PermissionHelper.getTitle(Permission.ProjectAdmin),
      ),
    ).toBeNull();

    const queries: Array<Record<string, unknown>> = getListMock.mock.calls
      .map((args: Array<any>): any => {
        return args[0];
      })
      .filter((params: any): boolean => {
        return params.modelType === TeamPermission;
      })
      .map((params: any): Record<string, unknown> => {
        return params.query;
      });

    expect(
      queries.some((query: Record<string, unknown>): boolean => {
        return query["isBlockPermission"] === false;
      }),
    ).toBe(true);
    expect(
      queries.some((query: Record<string, unknown>): boolean => {
        return query["isBlockPermission"] === true;
      }),
    ).toBe(true);
    for (const query of queries) {
      expect(String(query["teamId"])).toBe(TEAM_ID);
    }
  });
});

describe("someone who may read a team but not change what it can do", () => {
  test("sees Add Role and Add Permission locked, with the reason", async () => {
    holding([Permission.ReadProjectTeam]);

    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    expect(cardButton(permissions, "Add Role")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(cardButton(permissions, "Add Role"));
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();

    const addPermission: HTMLElement = await moreMenuItem(
      permissions,
      "Add Permission",
    );

    expect(addPermission).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(addPermission);
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();

    // The empty state says why it cannot help.
    expect(
      within(permissions).getByText(
        "You don't have permission to create these. Ask a project admin for access.",
      ),
    ).toBeInTheDocument();
  });
});
