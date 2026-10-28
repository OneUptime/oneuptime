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
 * need one; custom roles, an Enterprise feature most projects never use,
 * opened the page. Now, as on an API key's page:
 *
 *   - the page reads in the order it is used: Permissions, then a folded
 *     More settings holding Custom Roles (while that card is drawn) and
 *     Block Permissions;
 *   - More settings starts folded, says what is in it, and says how many
 *     custom roles and block permissions the team has;
 *   - a team whose access comes from its custom roles alone is not told
 *     it can do nothing: its empty Permissions card says where the roles
 *     are;
 *   - a link to #custom-roles opens More settings at the card;
 *   - Permissions offers Add Role - the role picker: the whole project or
 *     one area, then a level (Components/Permission/RolePicker) - as its
 *     one button, and Add Permission in the card's More menu;
 *   - the Scope of a role waits under the dialog's More fields line, on
 *     All resources in the project, and is still sent;
 *   - an empty Permissions card says the team can do nothing yet and
 *     repeats Add Role (a new team created with Choose permissions later
 *     lands here);
 *   - Block Permissions keeps adding rows as it did, as block rows;
 *   - someone who may not change a team's permissions sees the buttons
 *     locked, with the reason.
 */

/*
 * A self-hosted Community Edition install: billing off and not the
 * Enterprise Edition, whatever the environment says. CI's config.env turns
 * billing on for every suite, and with billing on the page asks the
 * project's plan instead of the edition - a plan this suite does not have,
 * so the custom roles leftover would never be drawn.
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

// How many custom roles the team has: what the custom roles card counts.
let customRoleCountForTest: number = 0;

(
  globalThis as unknown as { __customRoleCountForTest: () => number }
).__customRoleCountForTest = (): number => {
  return customRoleCountForTest;
};

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
      count: async (): Promise<number> => {
        return (
          globalThis as unknown as { __customRoleCountForTest: () => number }
        ).__customRoleCountForTest();
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
  TEAM_BLOCK_PERMISSIONS_PLACE,
  TEAM_PERMISSIONS_ADVANCED_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions";
import {
  CUSTOM_ROLES_CARD_PLACE,
  TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION,
  TEAM_MORE_SETTINGS_ROLES_DESCRIPTION,
  TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRolesFold";
import { TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleLeftoverCopy";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import TeamCustomRole from "../../../Models/DatabaseModels/TeamCustomRole";
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
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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
// The team's custom roles, as the custom roles card lists them.
let customRoleRows: Array<TeamCustomRole> = [];

// What scrollIntoView was asked of, in order (jsdom has none of its own).
const scrolled: Array<Element> = [];
const originalScrollIntoView: unknown = (
  Element.prototype as unknown as Record<string, unknown>
)["scrollIntoView"];

function customRoleRow(name: string): TeamCustomRole {
  const role: CustomRole = new CustomRole();
  role._id = ObjectID.generate().toString();
  role.name = name;
  role.permissionCount = 3;

  const row: TeamCustomRole = new TeamCustomRole();
  row._id = ObjectID.generate().toString();
  row.teamId = new ObjectID(TEAM_ID);
  row.customRoleId = new ObjectID(role._id);
  row.customRole = role;
  return row;
}

// The team has these custom roles: counted, then listed.
function givenCustomRoles(names: Array<string>): void {
  customRoleRows = names.map((name: string): TeamCustomRole => {
    return customRoleRow(name);
  });
  customRoleCountForTest = customRoleRows.length;
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
  customRoleRows = [];
  customRoleCountForTest = 0;
  scrolled.length = 0;
  (Element.prototype as unknown as Record<string, unknown>)["scrollIntoView"] =
    function (this: Element): void {
      scrolled.push(this);
    };
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

    if (params.modelType === TeamCustomRole) {
      return {
        data: customRoleRows,
        count: customRoleRows.length,
        skip: 0,
        limit: 10,
      };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  // An Edit form reads its row: the one the table listed, by its id.
  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    return (
      [...allowRows, ...blockRows].find((row: TeamPermission): boolean => {
        return row._id?.toString() === params.id?.toString();
      }) || null
    );
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
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();

  if (originalScrollIntoView === undefined) {
    delete (Element.prototype as unknown as Record<string, unknown>)[
      "scrollIntoView"
    ];
  } else {
    (Element.prototype as unknown as Record<string, unknown>)[
      "scrollIntoView"
    ] = originalScrollIntoView;
  }
});

async function renderPage(): Promise<void> {
  render(<TeamViewPermissions {...pageProps} />);

  /*
   * Both tables have loaded: each shows its rows (a row's Scope cell says
   * what it reaches) or its empty state.
   */
  await waitFor(
    () => {
      expect(
        screen.getAllByText(
          /This team can do nothing yet|Nothing is blocked for this team|All resources in the project|Only resources they own|Only resources with certain labels/,
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
    name: "More settings",
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

  // The form is drawn: the role picker, or the one-permission picker.
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
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
  });
}

// The role picker's switch: Whole project, or One area.
function reachButton(modal: HTMLElement, reach: string): HTMLElement {
  return within(modal).getByTestId(`role-picker-reach-${reach}`);
}

// An area's role at a level, picked as a person picks it: the area, then the level.
async function pickAreaRole(
  modal: HTMLElement,
  area: string,
  level: string,
): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(reachButton(modal, "OneArea"));
  });
  await act(async (): Promise<void> => {
    fireEvent.click(within(modal).getByTestId(`role-picker-area-${area}`));
  });
  await act(async (): Promise<void> => {
    fireEvent.click(within(modal).getByTestId(`role-picker-level-${level}`));
  });
  await settleForm();
}

// The dialog's More fields line, which folds the Scope away.
function moreFields(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole("button", { name: /More fields/ });
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the page", () => {
  test("reads Permissions, then More settings holding Block Permissions", async () => {
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

  test("More settings starts folded and says what is in it", async () => {
    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader())).toEqual([]);

    // Folded, it already names block permissions, none of them yet.
    expect(listedNames(advancedHeader())).toEqual(["Block Permissions"]);

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

  test("More settings says how many block permissions the team has", async () => {
    blockRows = [permissionRow(Permission.AuthorizeMcpClient, true)];

    await renderPage();

    await waitFor(() => {
      expect(setChips(advancedHeader())).toEqual(["Block Permissions: 1"]);
    });
    // Saying so does not open it.
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("an allow row alone sets nothing in More settings", async () => {
    allowRows = [permissionRow(Permission.ProjectMember)];

    await renderPage();

    await within(card("Permissions")).findByText(
      PermissionHelper.getTitle(Permission.ProjectMember),
    );
    await act(async (): Promise<void> => {});

    expect(setChips(advancedHeader())).toEqual([]);
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

  test("Add Role asks the whole project or one area: no wall of forty cards", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    /*
     * Named after the button that opened it, as a custom role's dialog
     * is: it read "Create New Team Permission" behind Add Role.
     */
    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      /^Add a Role$/,
    );
    expect(
      within(modal).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(/^Add Role$/);

    // It opens on the four roles that reach the whole project.
    expect(reachButton(modal, "WholeProject")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(modal)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string => {
          return radio.getAttribute("value") || "";
        }),
    ).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
    expect(within(modal).queryByText("Domain Roles")).toBeNull();
    // The field's old help is gone: the dialog's title says what it adds.
    expect(
      within(modal).queryByText("A ready-made set of permissions."),
    ).toBeNull();
    // A search box finds any role.
    expect(
      within(modal).getByRole("searchbox", { name: "Search roles" }),
    ).toBeInTheDocument();
  });

  test("an area's role, picked by area and level, is added as an allow row for all resources", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    await pickAreaRole(modal, "Incidents", "Member");

    expect(
      within(modal).getByTestId("role-picker-picked-title"),
    ).toHaveTextContent("Incident Member");

    // A role that can be scoped folds its Scope under More fields, on All.
    expect(moreFields(modal)).toHaveAttribute("aria-expanded", "false");

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

  test("a whole-project role is one click, and one that takes no scope shows no More fields", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByTestId(
          `role-picker-role-${Permission.ProjectAdmin}`,
        ),
      );
    });
    await settleForm();

    expect(
      within(modal).queryByRole("button", { name: /More fields/ }),
    ).toBeNull();

    await submitModal(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.model.permission).toBe(Permission.ProjectAdmin);
    expect(request.model.scope).toBe(PermissionScope.All);
  });

  /*
   * The More fields line (Scope) is drawn under the picker only for a role
   * that takes a scope. Until then, and for a role that takes none, the
   * picker keeps its room - so neither the first pick nor a move to Project
   * Admin grows or shrinks the dialog (measured in real Chromium by
   * packages/E2E/CustomRoles/AddRoleDialog.spec.ts).
   */
  test("the picker keeps the More fields line's room exactly while the line is not drawn", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    const room: () => HTMLElement | null = (): HTMLElement | null => {
      return within(modal).queryByTestId("role-picker-room");
    };
    const line: () => HTMLElement | null = (): HTMLElement | null => {
      return within(modal).queryByRole("button", { name: /More fields/ });
    };
    const pickRow: (permission: Permission) => Promise<void> = async (
      permission: Permission,
    ): Promise<void> => {
      await act(async (): Promise<void> => {
        fireEvent.click(
          within(modal).getByTestId(`role-picker-role-${permission}`),
        );
      });
      await settleForm();
    };

    // Nothing picked: no line, the room kept.
    expect(line()).toBeNull();
    expect(room()).not.toBeNull();

    // Project Member takes a scope: the line, in the room's place.
    await pickRow(Permission.ProjectMember);
    expect(line()).not.toBeNull();
    expect(room()).toBeNull();

    // Project Admin takes none: the room again.
    await pickRow(Permission.ProjectAdmin);
    expect(line()).toBeNull();
    expect(room()).not.toBeNull();

    // An area's role that takes a scope, and Billing, which takes none.
    await pickAreaRole(modal, "Telemetry", "Viewer");
    expect(line()).not.toBeNull();
    expect(room()).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByTestId("role-picker-area-Billing"));
    });
    await settleForm();
    expect(line()).toBeNull();
    expect(room()).not.toBeNull();
  });

  test("a search finds a role, Enter picks it, and Add Role adds it", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    const search: HTMLElement = within(modal).getByRole("searchbox", {
      name: "Search roles",
    });

    await act(async (): Promise<void> => {
      fireEvent.change(search, { target: { value: "telemetry viewer" } });
    });
    await act(async (): Promise<void> => {
      fireEvent.keyDown(search, { key: "Enter" });
    });
    await settleForm();

    // Enter picked the first match; it did not submit the dialog.
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await submitModal(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createOrUpdateMock.mock.calls[0]![0].model.permission).toBe(
      Permission.TelemetryViewer,
    );
  });

  test("with nothing picked, Add Role says a role is needed and adds nothing", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    await submitModal(modal);
    await settleForm();

    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(within(modal).getByRole("alert")).toHaveTextContent(
      "Role is required.",
    );
  });

  test("the empty state's Add Role opens the same role picker", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      within(card("Permissions")).getByTestId("empty-table-create-button"),
    );

    expect(
      within(modal).getByTestId(`role-picker-role-${Permission.Viewer}`),
    ).toBeInTheDocument();
  });

  test("Edit opens the picker on the row's role, where it lives", async () => {
    allowRows = [permissionRow(Permission.MonitorViewer)];

    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    await within(permissions).findByText(
      PermissionHelper.getTitle(Permission.MonitorViewer),
    );

    const editButton: HTMLElement = await waitFor((): HTMLElement => {
      const found: HTMLElement | undefined = within(permissions)
        .getAllByRole("button")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").trim() === "Edit";
        });

      if (!found) {
        throw new Error("No Edit button yet");
      }

      return found;
    });

    const modal: HTMLElement = await openModal(editButton);

    await waitFor(() => {
      expect(reachButton(modal, "OneArea")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(
      within(modal)
        .getByTestId("role-picker-area-Monitors")
        .querySelector("input[type='radio']"),
    ).toBeChecked();
    expect(
      within(modal).getByTestId("role-picker-level-Viewer"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(modal).getByTestId("role-picker-picked-title"),
    ).toHaveTextContent("Monitor Viewer");
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
    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      /^Add a Permission$/,
    );
    expect(
      within(modal).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(/^Add Permission$/);
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
    // In the words the Scope choice uses (PermissionScopeChoice).
    expect(
      within(permissions).getByText("All resources in the project"),
    ).toBeInTheDocument();
  });

  test("Add Role says what each role is for in one line, not its whole description", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    const member: HTMLElement = within(modal).getByTestId(
      `role-picker-role-${Permission.ProjectMember}`,
    );

    expect(member).toHaveTextContent(
      "Create, change and delete monitors, incidents, status pages and other resources.",
    );
    expect(member).not.toHaveTextContent("Member of this project.");

    await pickAreaRole(modal, "Incidents", "Viewer");

    expect(
      within(modal).getByTestId("role-picker-picked-summary"),
    ).toHaveTextContent("Read incidents. Change nothing.");
  });

  test("the Scope waits under More fields: three plain answers starting on All; the third asks for labels, and requires them", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    await pickAreaRole(modal, "Incidents", "Member");

    // Folded, its line names the Scope.
    expect(moreFields(modal)).toHaveAttribute("aria-expanded", "false");
    expect(moreFields(modal)).toHaveTextContent("Scope");

    await act(async (): Promise<void> => {
      fireEvent.click(moreFields(modal));
    });

    expect(moreFields(modal)).toHaveAttribute("aria-expanded", "true");

    const all: HTMLElement = await within(modal).findByRole("radio", {
      name: "All resources in the project",
    });

    expect(all).toBeChecked();
    expect(
      within(modal).getByRole("radio", { name: "Only resources they own" }),
    ).not.toBeChecked();
    expect(
      within(modal).getByText(
        "Resources the person, or the team given this permission, owns.",
      ),
    ).toBeInTheDocument();
    // No labels asked for until the third answer is picked.
    expect(within(modal).queryByText("Labels")).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("radio", {
          name: "Only resources with certain labels",
        }),
      );
    });

    expect(await within(modal).findByText("Labels")).toBeInTheDocument();

    // Picked, but no label chosen: the form asks for one instead of saving.
    await submitModal(modal);
    await settleForm();

    expect(createOrUpdateMock).not.toHaveBeenCalled();

    // Back to All: the labels are not asked for, and the row saves for every resource.
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("radio", {
          name: "All resources in the project",
        }),
      );
    });
    await settleForm();

    expect(within(modal).queryByText("Labels")).toBeNull();

    await submitModal(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.model.scope).toBe(PermissionScope.All);
    expect(request.model.labels || []).toEqual([]);
  });
});

describe("what the team's members can never do", () => {
  test("is added from More settings, as a block row", async () => {
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

    // A block is most often one area's role: its picker opens on One area.
    expect(reachButton(modal, "OneArea")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await pickAreaRole(modal, "Billing", "Admin");

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

/*
 * "Move custom roles to More settings because it is an advanced feature."
 * - the maintainer. The Community Edition draws the roles a team still has
 * (where roles can no longer be given) in the same place the Enterprise
 * card takes, and tells the page the same things, so the page is held to
 * it here; the Enterprise card's own suite holds it to the same in ee.
 */
describe("custom roles, folded under More settings", () => {
  // The custom roles card, once it has counted the team's roles.
  async function customRolesCard(): Promise<HTMLElement> {
    return await screen.findByTestId(TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID);
  }

  test("a team with none: More settings names Block Permissions alone, as before", async () => {
    await renderPage();
    await act(async (): Promise<void> => {});

    expect(listedNames(advancedHeader())).toEqual(["Block Permissions"]);
    expect(screen.queryByTestId(TEAM_CUSTOM_ROLES_LEFTOVER_TEST_ID)).toBeNull();

    fireEvent.click(advancedHeader());
    expect(
      within(advancedHeader()).getByText(TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION),
    ).toBeInTheDocument();
  });

  test("a team with custom roles: the page opens on Permissions, the roles folded under More settings, before Block Permissions", async () => {
    givenCustomRoles(["Incident Responder", "Team Lead"]);

    await renderPage();

    const roles: HTMLElement = await customRolesCard();

    // Permissions first, on the page; the roles inside the fold.
    expect(isBefore(card("Permissions"), advancedSection())).toBe(true);
    expect(advancedSection()).toContainElement(roles);
    expect(advancedSection()).not.toContainElement(card("Permissions"));
    expect(isBefore(roles, card("Block Permissions"))).toBe(true);

    // Folded, out of sight and reach, but mounted: it counted what it holds.
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(advancedBody()).toHaveClass("invisible");
    expect(advancedBody()).toContainElement(roles);

    await waitFor(() => {
      expect(listedNames(advancedHeader())).toEqual([
        "Custom Roles: 2",
        "Block Permissions",
      ]);
    });
    expect(setChips(advancedHeader())).toEqual(["Custom Roles: 2"]);
  });

  test("its card is titled as its folded name, and takes the place a link to it names", async () => {
    givenCustomRoles(["Incident Responder"]);

    await renderPage();

    const roles: HTMLElement = await customRolesCard();

    // Folded, each name the header lists is the place of a card in it.
    await waitFor(() => {
      expect(
        Array.from(
          advancedHeader().querySelectorAll(
            "[data-testid='folded-section-item']",
          ),
        ).map((item: Element): string => {
          return item.getAttribute("data-item-key") || "";
        }),
      ).toEqual([CUSTOM_ROLES_CARD_PLACE, TEAM_BLOCK_PERMISSIONS_PLACE]);
    });
    expect(roles).toContainElement(
      document.getElementById(CUSTOM_ROLES_CARD_PLACE),
    );
    expect(advancedSection()).toContainElement(
      document.getElementById(TEAM_BLOCK_PERMISSIONS_PLACE),
    );

    fireEvent.click(advancedHeader());

    // Open, the card reads as its folded name.
    expect(within(roles).getByTestId("card-details-heading")).toHaveTextContent(
      "Custom Roles",
    );
  });

  test("open, More settings says it holds the team's custom roles too", async () => {
    givenCustomRoles(["Incident Responder"]);

    await renderPage();
    await customRolesCard();
    await waitFor(() => {
      expect(listedNames(advancedHeader())[0]).toBe("Custom Roles: 1");
    });

    fireEvent.click(advancedHeader());

    expect(
      within(advancedHeader()).getByText(TEAM_MORE_SETTINGS_ROLES_DESCRIPTION),
    ).toBeInTheDocument();
    expect(
      within(advancedHeader()).queryByText(
        TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION,
      ),
    ).toBeNull();
  });

  test("a team whose access comes from its custom roles alone is not told it can do nothing", async () => {
    givenCustomRoles(["Incident Responder"]);

    await renderPage();
    await customRolesCard();

    const permissions: HTMLElement = card("Permissions");

    await waitFor(() => {
      expect(
        within(permissions).getByText(
          TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES.split(". ")[0] as string,
        ),
      ).toBeInTheDocument();
    });
    expect(
      within(permissions).queryByText("This team can do nothing yet"),
    ).toBeNull();
  });

  test("a team with no custom role and no permission is still told it can do nothing yet", async () => {
    await renderPage();
    await act(async (): Promise<void> => {});

    expect(
      within(card("Permissions")).getByText("This team can do nothing yet"),
    ).toBeInTheDocument();
  });

  test("opened at #custom-roles: More settings opens by itself at the card, and brings it into view", async () => {
    givenCustomRoles(["Incident Responder"]);
    window.history.replaceState(null, "", `#${CUSTOM_ROLES_CARD_PLACE}`);

    await renderPage();
    await customRolesCard();

    await waitFor(() => {
      expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    });
    await waitFor(() => {
      expect(scrolled).toContain(
        document.getElementById(CUSTOM_ROLES_CARD_PLACE),
      );
    });
    expect(advancedBody()).not.toHaveClass("invisible");
  });

  test("opened at #custom-roles in a project with none: the fold stays folded, as nothing in it is called that", async () => {
    window.history.replaceState(null, "", `#${CUSTOM_ROLES_CARD_PLACE}`);

    await renderPage();
    await act(async (): Promise<void> => {});

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("opened at #block-permissions: More settings opens at Block Permissions", async () => {
    window.history.replaceState(null, "", `#${TEAM_BLOCK_PERMISSIONS_PLACE}`);

    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(scrolled).toContain(
        document.getElementById(TEAM_BLOCK_PERMISSIONS_PLACE),
      );
    });
    expect(
      document.getElementById(TEAM_BLOCK_PERMISSIONS_PLACE),
    ).toContainElement(card("Block Permissions"));
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
