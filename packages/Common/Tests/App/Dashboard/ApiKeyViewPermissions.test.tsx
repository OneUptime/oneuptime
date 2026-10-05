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
 * AN API KEY'S PAGE, on the real page with only the network stubbed.
 *
 * What a key can do used to be added through a picker that searched every
 * permission, next to an always open Block Permissions table as large as
 * the key's own permissions. Now:
 *
 *   - the page reads in the order it is used: details (the key to copy),
 *     Permissions, Reset API Key, a folded Advanced section, Delete;
 *   - Permissions offers Add Role - the role cards a team's Add Role shows -
 *     as its one button, and Add Permission, the one-permission picker it
 *     had, in the card's More menu;
 *   - an empty Permissions card says the key can do nothing yet and repeats
 *     Add Role;
 *   - a row is edited with the one-permission picker, however it was added;
 *   - Block Permissions sits in Advanced, which says "Configured" while the
 *     key has any, and keeps its one-permission form;
 *   - someone who may not change what a key can do sees both buttons locked.
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
const getItemMock: MockFunction = getJestMockFunction();
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
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";
import {
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

jest.setTimeout(30000);

const PROJECT_ID: string = "0f000000-0000-4000-8000-000000000001";
const KEY_ID: string = "0f000000-0000-4000-8000-000000000002";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID;

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: currentProject,
} as unknown as PageComponentProps;

let allowRows: Array<ApiKeyPermission> = [];
let blockRows: Array<ApiKeyPermission> = [];

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
): ApiKeyPermission {
  const row: ApiKeyPermission = new ApiKeyPermission();
  row._id = ObjectID.generate().toString();
  row.apiKeyId = new ObjectID(KEY_ID);
  row.permission = permission;
  row.isBlockPermission = isBlockPermission;
  row.labels = [];
  return row;
}

function apiKey(): ApiKey {
  const key: ApiKey = new ApiKey();
  key._id = KEY_ID;
  key.name = "Terraform";
  key.expiresAt = OneUptimeDate.getSomeDaysAfter(365);
  key.apiKey = new ObjectID("0f000000-0000-4000-8000-0000000000aa");
  return key;
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
    if (params.modelType === ApiKeyPermission) {
      const rows: Array<ApiKeyPermission> = params.query?.isBlockPermission
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
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(<APIKeyViewPage {...pageProps} />);

  // Both tables have loaded: each shows its rows or its empty state.
  await waitFor(
    () => {
      expect(
        screen.getAllByText(
          /This key can do nothing yet|Nothing is blocked for this API key|Restriction by labels|No restrictions/,
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
  return screen.getByTestId("api-key-advanced-section");
}

function advancedHeader(): HTMLElement {
  return within(advancedSection()).getByRole("button", {
    name: "More settings",
  });
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

  // BasicForm settles its fields in effects.
  await act(async (): Promise<void> => {});

  return modal;
}

/*
 * Picks one permission in the one-permission picker: searched for, its group
 * opened in the picker's sidebar (a search shows the open group's matches),
 * then clicked.
 */
async function pickPermission(
  modal: HTMLElement,
  permission: Permission,
): Promise<void> {
  const props: PermissionProps = PermissionHelper.getAllPermissionProps().find(
    (candidate: PermissionProps): boolean => {
      return candidate.permission === permission;
    },
  )!;

  fireEvent.change(
    within(modal).getByPlaceholderText("Search permissions..."),
    {
      target: { value: props.title },
    },
  );

  const groupButton: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = within(modal)
      .getAllByRole("button")
      .find((candidate: HTMLElement): boolean => {
        return candidate.querySelector("span")?.textContent === props.group;
      });

    if (!found) {
      throw new Error(`No ${props.group} group yet`);
    }

    return found;
  });

  fireEvent.click(groupButton);

  const option: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = within(modal)
      .getAllByRole("button")
      .find((candidate: HTMLElement): boolean => {
        // Title then description: "Create Incident" is not "Create Incident State".
        return (candidate.textContent || "").startsWith(
          `${props.title}${props.description}`,
        );
      });

    if (!found) {
      throw new Error(`No ${props.title} yet`);
    }

    return found;
  });

  fireEvent.click(option);
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the page", () => {
  test("reads in the order it is used, Block Permissions folded under Advanced", async () => {
    await renderPage();

    const details: HTMLElement = card("API Key Details");
    const permissions: HTMLElement = card("Permissions");
    const reset: HTMLElement = card("Reset API Key");
    const block: HTMLElement = card("Block Permissions");
    const remove: HTMLElement = card("Delete API Key");

    expect(isBefore(details, permissions)).toBe(true);
    expect(isBefore(permissions, reset)).toBe(true);
    expect(isBefore(reset, advancedSection())).toBe(true);
    expect(isBefore(advancedSection(), remove)).toBe(true);

    // The block table is inside the folded section.
    expect(advancedSection()).toContainElement(block);
    expect(advancedSection()).not.toContainElement(permissions);
  });

  test("Advanced starts folded and says what is in it", async () => {
    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader())).toEqual([]);

    // Folded, it already names block permissions, none of them yet.
    expect(listedNames(advancedHeader())).toEqual(["Block Permissions"]);

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(advancedHeader()).getByText(
        "Block permissions: what this key can never do, even when one of its roles or permissions allows it.",
      ),
    ).toBeInTheDocument();
  });

  test("Advanced says Configured while the key has block permissions", async () => {
    blockRows = [permissionRow(Permission.DeleteProjectMonitor, true)];

    await renderPage();

    await waitFor(() => {
      expect(setChips(advancedHeader())).toEqual(["Block Permissions: 1"]);
    });
    expect(hasSetChip(advancedHeader())).toBe(true);
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("what the key can do", () => {
  test("is added with Add Role, or Add Permission from the More menu", async () => {
    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    // One button on the card: a role is what most keys need.
    expect(cardButton(permissions, "Add Role")).toBeEnabled();
    expect(() => {
      return cardButton(permissions, "Add Permission");
    }).toThrow();

    expect(await moreMenuItem(permissions, "Add Permission")).toBeEnabled();
    expect(
      within(permissions).getByText(
        "What this API key can do. Add a role for a ready-made set of permissions, or a single permission for exactly what you need.",
      ),
    ).toBeInTheDocument();
  });

  test("a key with none says so and repeats Add Role", async () => {
    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    expect(
      within(permissions).getByText("This key can do nothing yet"),
    ).toBeInTheDocument();
    expect(
      within(permissions).getByText("Add a role to give it access."),
    ).toBeInTheDocument();
    expect(
      within(permissions).getByTestId("empty-table-create-button"),
    ).toHaveTextContent("Add Role");
  });

  test("Add Role shows the role cards and adds the role picked as an allow row", async () => {
    await renderPage();

    const modal: HTMLElement = await openModal(
      cardButton(card("Permissions"), "Add Role"),
    );

    expect(within(modal).getByText("Role")).toBeInTheDocument();

    // The team's role cards, all of them.
    const roles: number = PermissionHelper.getRolePermissionProps().length;
    expect(within(modal).getAllByRole("radio")).toHaveLength(roles);
    expect(within(modal).getByText("Domain Roles")).toBeInTheDocument();

    fireEvent.click(
      within(modal).getByTestId(
        `card-select-option-${Permission.IncidentMember}`,
      ),
    );

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", { name: "Add Permission" }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(ApiKeyPermission);
    expect(request.model.permission).toBe(Permission.IncidentMember);
    expect(request.model.apiKeyId?.toString()).toBe(KEY_ID);
    expect(request.model.projectId?.toString()).toBe(PROJECT_ID);
    expect(request.model.isBlockPermission).toBe(false);
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

    await pickPermission(modal, Permission.CreateProjectIncident);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", { name: "Add Permission" }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.model.permission).toBe(Permission.CreateProjectIncident);
    expect(request.model.isBlockPermission).toBe(false);
  });

  test("a row is edited with the one-permission picker, however it was added", async () => {
    allowRows = [permissionRow(Permission.Viewer)];

    await renderPage();

    const permissions: HTMLElement = card("Permissions");

    await within(permissions).findByText(
      PermissionHelper.getTitle(Permission.Viewer),
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

    expect(
      await within(modal).findByPlaceholderText("Search permissions..."),
    ).toBeInTheDocument();
    expect(within(modal).queryAllByRole("radio")).toEqual([]);
  });
});

describe("what the key can never do", () => {
  test("is added from Advanced, one permission at a time, as a block row", async () => {
    await renderPage();

    fireEvent.click(advancedHeader());

    const block: HTMLElement = card("Block Permissions");

    expect(
      within(block).getByText("Nothing is blocked for this API key"),
    ).toBeInTheDocument();

    const modal: HTMLElement = await openModal(
      cardButton(block, "Add Block Permission"),
    );

    expect(
      within(modal).getByPlaceholderText("Search permissions..."),
    ).toBeInTheDocument();
    expect(within(modal).queryAllByRole("radio")).toEqual([]);

    await pickPermission(modal, Permission.DeleteProjectMonitor);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", { name: "Add Block Permission" }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.model.permission).toBe(Permission.DeleteProjectMonitor);
    expect(request.model.isBlockPermission).toBe(true);
    expect(request.model.apiKeyId?.toString()).toBe(KEY_ID);
  });

  test("the two tables never mix their rows", async () => {
    allowRows = [permissionRow(Permission.ProjectAdmin)];
    blockRows = [permissionRow(Permission.DeleteProjectMonitor, true)];

    await renderPage();

    const permissions: HTMLElement = card("Permissions");
    const block: HTMLElement = card("Block Permissions");

    await within(permissions).findByText(
      PermissionHelper.getTitle(Permission.ProjectAdmin),
    );
    await within(block).findByText(
      PermissionHelper.getTitle(Permission.DeleteProjectMonitor),
    );

    expect(
      within(permissions).queryByText(
        PermissionHelper.getTitle(Permission.DeleteProjectMonitor),
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
        return params.modelType === ApiKeyPermission;
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
      expect(String(query["apiKeyId"])).toBe(KEY_ID);
    }
  });
});

describe("someone who may read a key but not change what it can do", () => {
  test("sees Add Role and Add Permission locked, with the reason", async () => {
    holding([Permission.ReadProjectApiKey]);

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
  });
});
