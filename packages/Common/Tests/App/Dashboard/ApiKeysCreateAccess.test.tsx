/**
 * @timezone America/New_York
 */
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
 * CREATE API KEY, on the real Settings > API Keys page, with only the network
 * stubbed.
 *
 * A key used to be made from a name, a description and an expiry date the
 * user had to pick, and it could do nothing until someone found its page and
 * searched several hundred permissions. Now:
 *
 *   - the form asks Name and Access - Project Admin, Project Member, Viewer,
 *     or Choose permissions later, which is picked - with the description
 *     and Expires, a year from today, folded under Advanced;
 *   - the key is created exactly as before: nothing about its access goes
 *     with it;
 *   - a role picked under Access becomes the key's first permission once the
 *     key exists, through the API key permission endpoint;
 *   - Choose permissions later adds nothing;
 *   - the new key opens on its page;
 *   - a role the server refuses leaves the key, says why, and links to it;
 *   - the user sees only the roles they may hand on, and is not asked
 *     without the right to give keys permissions.
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
const createMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
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
      create: (...args: Array<any>) => {
        return createMock(...args);
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

import APIKeysPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeys";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getDefaultApiKeyExpiry } from "../../../../App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyCreateForm";
import { ROLE_ACCESS_LATER } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import Permission, { UserPermission } from "../../../Types/Permission";
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

const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";
const NEW_KEY_ID: string = "0e000000-0000-4000-8000-000000000002";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

let navigateCalls: Array<string> = [];

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

function keyRoute(keyId: string): string {
  return `/dashboard/${PROJECT_ID}/settings/api-keys/${keyId}`;
}

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/settings/api-keys`,
  );

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );

  getListMock.mockImplementation(async (): Promise<any> => {
    // A project with no keys yet.
    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  // The server answers a create with the new key.
  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return {
      data: {
        _id: NEW_KEY_ID,
        name: data.model.name,
      },
    };
  });

  createMock.mockImplementation(async (): Promise<any> => {
    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
});

/*
 * BasicForm settles its fields and defaults in effects. Wait until it has:
 * on a busy machine one tick is not enough, and a form submitted before
 * Expires is filled in is refused for want of a date. A default that never
 * arrives - a form holding on to the last key's answers - still fails here.
 */
async function waitForFormDefaults(modal: HTMLElement): Promise<void> {
  await within(modal).findByPlaceholderText("API Key Name");
  await act(async (): Promise<void> => {});

  await waitFor(() => {
    expect(within(modal).getByPlaceholderText("Expires at")).toHaveValue(
      OneUptimeDate.asDateForDatabaseQuery(getDefaultApiKeyExpiry()),
    );

    const later: HTMLElement | null = within(modal).queryByTestId(
      `card-select-option-${ROLE_ACCESS_LATER}`,
    );

    if (later) {
      expect(later).toHaveAttribute("aria-checked", "true");
    }
  });
}

async function openCreateForm(): Promise<HTMLElement> {
  render(<APIKeysPage {...pageProps} />);

  const createButton: HTMLElement = await waitFor(
    (): HTMLElement => {
      const button: HTMLElement | undefined = screen
        .getAllByTestId("card-button")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").includes("Create API Key");
        });

      if (!button) {
        throw new Error("No Create API Key button yet");
      }

      return button;
    },
    { timeout: 10000 },
  );

  fireEvent.click(createButton);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await waitForFormDefaults(modal);

  return modal;
}

function typeName(modal: HTMLElement, name: string): void {
  fireEvent.change(within(modal).getByPlaceholderText("API Key Name"), {
    target: { value: name },
  });
}

function accessCard(modal: HTMLElement, value: string): HTMLElement {
  return within(modal).getByTestId(`card-select-option-${value}`);
}

function accessCardValues(modal: HTMLElement): Array<string> {
  return within(modal)
    .queryAllByRole("radio")
    .map((card: HTMLElement): string => {
      return (card.getAttribute("data-testid") || "").replace(
        "card-select-option-",
        "",
      );
    });
}

function advancedHeader(modal: HTMLElement): HTMLElement {
  return within(modal).getByRole("button", { name: "More fields" });
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", { name: "Create API Key" }),
    );
  });
}

function keyRequest(): any {
  const call: Array<any> | undefined = createOrUpdateMock.mock.calls.find(
    (args: Array<any>): boolean => {
      return args[0].modelType === ApiKey;
    },
  );

  expect(call).toBeDefined();

  return call![0];
}

describe("the Create API Key form", () => {
  test("asks Name and Access, with the rest folded under Advanced, and no steps", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(within(modal).getByText("Access")).toBeInTheDocument();
    expect(
      within(modal).getByText(
        "What this key can do. You can change it on the key's page at any time.",
      ),
    ).toBeInTheDocument();

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader(modal))).toEqual([]);
    expect(
      within(modal).getByPlaceholderText("API Key Description"),
    ).not.toBeVisible();
    expect(within(modal).getByPlaceholderText("Expires at")).not.toBeVisible();

    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
  });

  test("offers Project Admin, Project Member, Viewer and Choose permissions later, the last picked", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(accessCardValues(modal)).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      ROLE_ACCESS_LATER,
    ]);

    expect(accessCard(modal, ROLE_ACCESS_LATER)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    for (const role of [
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      expect(accessCard(modal, role)).toHaveAttribute("aria-checked", "false");
    }

    expect(
      within(modal).getByText("Choose permissions later"),
    ).toBeInTheDocument();
  });

  test("Expires starts a year from today", async () => {
    const modal: HTMLElement = await openCreateForm();

    fireEvent.click(advancedHeader(modal));

    expect(within(modal).getByPlaceholderText("Expires at")).toBeVisible();
    expect(within(modal).getByPlaceholderText("Expires at")).toHaveValue(
      OneUptimeDate.asDateForDatabaseQuery(getDefaultApiKeyExpiry()),
    );
  });

  test("folded, More fields names what it holds and says the key expires a year from today", async () => {
    const modal: HTMLElement = await openCreateForm();

    const summary: HTMLElement = within(modal).getByTestId(
      "collapsible-section-summary",
    );

    expect(summary).toHaveTextContent("The key expires a year from today.");
    // Read out with the header, and on screen while it is folded.
    expect(advancedHeader(modal).getAttribute("aria-describedby")).toContain(
      summary.id,
    );
    expect(summary).toBeVisible();
    expect(listedNames(advancedHeader(modal))).toEqual([
      "Description",
      "Expires",
    ]);
    expect(setChips(advancedHeader(modal))).toEqual([]);
  });

  test("a description typed under Advanced keeps the line: the expiry is still the default", async () => {
    const modal: HTMLElement = await openCreateForm();

    fireEvent.click(advancedHeader(modal));
    fireEvent.change(
      within(modal).getByPlaceholderText("API Key Description"),
      {
        target: { value: "Manages our monitors." },
      },
    );
    fireEvent.click(advancedHeader(modal));

    expect(
      within(modal).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent("The key expires a year from today.");
  });

  test("another expiry date replaces the line with a chip of that date", async () => {
    const modal: HTMLElement = await openCreateForm();

    fireEvent.click(advancedHeader(modal));
    fireEvent.change(within(modal).getByPlaceholderText("Expires at"), {
      target: { value: "2030-01-15" },
    });
    fireEvent.click(advancedHeader(modal));

    expect(advancedHeader(modal)).toHaveAttribute("aria-expanded", "false");
    expect(hasSetChip(advancedHeader(modal))).toBe(true);
    expect(
      within(modal).queryByTestId("collapsible-section-summary"),
    ).toBeNull();
  });
});

describe("creating a key", () => {
  test("with the defaults: the key as before, a year to live, no access, and its page opens", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([keyRoute(NEW_KEY_ID)]);
    });

    const request: any = keyRequest();

    expect(request.formType).toBe(FormType.Create);
    expect(request.model.name).toBe("Terraform");
    expect(OneUptimeDate.fromString(request.model.expiresAt).getTime()).toBe(
      getDefaultApiKeyExpiry().getTime(),
    );

    // Nothing about access goes with the key, as a column or misc data.
    expect(request.miscDataProps).toEqual({});
    expect(
      (request.model as unknown as Record<string, unknown>)["access"],
    ).toBeUndefined();

    // Choose permissions later: no permission is added.
    expect(createMock).not.toHaveBeenCalled();
  });

  test("the key's page is the one the route map names", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toHaveLength(1);
    });

    expect(navigateCalls[0]).toBe(
      (RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", NEW_KEY_ID),
    );
  });

  test.each([
    [Permission.ProjectAdmin],
    [Permission.ProjectMember],
    [Permission.Viewer],
  ])(
    "with %s picked, the key is made first and the role becomes its first permission",
    async (role: Permission) => {
      const modal: HTMLElement = await openCreateForm();

      typeName(modal, "CI pipeline");
      fireEvent.click(accessCard(modal, role));

      expect(accessCard(modal, role)).toHaveAttribute("aria-checked", "true");

      await submit(modal);

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledTimes(1);
      });

      const permissionRequest: any = createMock.mock.calls[0]![0];

      expect(permissionRequest.modelType).toBe(ApiKeyPermission);

      const row: ApiKeyPermission = permissionRequest.model;

      expect(row.permission).toBe(role);
      expect(row.apiKeyId?.toString()).toBe(NEW_KEY_ID);
      expect(row.projectId?.toString()).toBe(PROJECT_ID);
      expect(row.isBlockPermission).toBe(false);

      // The key went first, and carried nothing of the role.
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      expect(createOrUpdateMock.mock.invocationCallOrder[0]!).toBeLessThan(
        createMock.mock.invocationCallOrder[0]!,
      );
      expect(keyRequest().miscDataProps).toEqual({});

      await waitFor(() => {
        expect(navigateCalls).toEqual([keyRoute(NEW_KEY_ID)]);
      });
    },
  );

  test("a role picked and then taken back adds nothing", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "CI pipeline");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    fireEvent.click(accessCard(modal, ROLE_ACCESS_LATER));

    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([keyRoute(NEW_KEY_ID)]);
    });

    expect(createMock).not.toHaveBeenCalled();
  });

  test("a second key does not inherit the first one's role", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "First");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    // The page stays mounted here (navigation is stubbed): make another.
    const createButton: HTMLElement = screen
      .getAllByTestId("card-button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").includes("Create API Key");
      })!;

    fireEvent.click(createButton);

    const secondModal: HTMLElement = await screen.findByTestId("modal");

    // Back on Choose permissions later, not on the first key's Viewer.
    await waitForFormDefaults(secondModal);

    expect(accessCard(secondModal, Permission.Viewer)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(accessCard(secondModal, ROLE_ACCESS_LATER)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    typeName(secondModal, "Second");
    await submit(secondModal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(navigateCalls).toHaveLength(2);
    });

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("the description and expiry typed under Advanced are saved with the key", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    fireEvent.click(advancedHeader(modal));
    fireEvent.change(
      within(modal).getByPlaceholderText("API Key Description"),
      {
        target: { value: "Manages our monitors." },
      },
    );
    fireEvent.change(within(modal).getByPlaceholderText("Expires at"), {
      target: { value: "2030-01-15" },
    });

    // Folded again, the section says something in it is set.
    fireEvent.click(advancedHeader(modal));
    expect(hasSetChip(advancedHeader(modal))).toBe(true);

    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = keyRequest();

    expect(request.model.description).toBe("Manages our monitors.");
    expect(OneUptimeDate.asDateForDatabaseQuery(request.model.expiresAt)).toBe(
      "2030-01-15",
    );
  });

  test("a key that cannot be created stays on the form and adds no permission", async () => {
    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new Error("A name is required.");
    });

    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    expect(
      await within(modal).findByText("A name is required."),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigateCalls).toEqual([]);
  });
});

describe("a role the server refuses", () => {
  beforeEach(() => {
    createMock.mockImplementation(async (): Promise<never> => {
      throw new Error(
        "You cannot grant an API key permission beyond your own authority",
      );
    });
  });

  test("leaves the key, says why it has no access, and stays on the list", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    const notice: HTMLElement = await screen.findByTestId(
      "api-key-access-notice",
    );

    expect(notice).toHaveTextContent("Terraform was created without access.");
    expect(notice).toHaveTextContent(
      "You cannot grant an API key permission beyond your own authority",
    );
    expect(notice).toHaveTextContent("Open the key to give it a role");

    expect(navigateCalls).toEqual([]);
    // The key itself was made, once.
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  test("the notice opens the key", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    const notice: HTMLElement = await screen.findByTestId(
      "api-key-access-notice",
    );

    fireEvent.click(notice);

    expect(navigateCalls).toEqual([keyRoute(NEW_KEY_ID)]);
  });

  test("the notice can be closed", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    fireEvent.click(accessCard(modal, Permission.ProjectAdmin));
    await submit(modal);

    const notice: HTMLElement = await screen.findByTestId(
      "api-key-access-notice",
    );

    fireEvent.click(within(notice).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByTestId("api-key-access-notice")).toBeNull();
    });
    expect(navigateCalls).toEqual([]);
  });
});

describe("who is asked what", () => {
  test("a project admin is offered the role they hold, and Choose permissions later", async () => {
    holding([Permission.ProjectAdmin]);

    const modal: HTMLElement = await openCreateForm();

    expect(accessCardValues(modal)).toEqual([
      Permission.ProjectAdmin,
      ROLE_ACCESS_LATER,
    ]);
  });

  test("someone who may create keys but not give them permissions is not asked", async () => {
    holding([Permission.CreateProjectApiKey, Permission.ReadProjectApiKey]);

    const modal: HTMLElement = await openCreateForm();

    expect(within(modal).queryByText("Access")).toBeNull();
    expect(within(modal).queryAllByRole("radio")).toEqual([]);

    // The rest of the form is as for everyone.
    expect(within(modal).getByText("Name")).toBeInTheDocument();
    expect(advancedHeader(modal)).toBeInTheDocument();

    typeName(modal, "Read-only export");
    await submit(modal);

    await waitFor(() => {
      expect(navigateCalls).toEqual([keyRoute(NEW_KEY_ID)]);
    });

    expect(keyRequest().miscDataProps).toEqual({});
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("the request the key's create sends", () => {
  test("is the same with or without a role picked", async () => {
    const modal: HTMLElement = await openCreateForm();

    typeName(modal, "Terraform");
    fireEvent.click(accessCard(modal, Permission.Viewer));
    await submit(modal);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const json: JSONObject = ApiKey.toJSON(keyRequest().model, ApiKey);

    // A name and an expiry date: nothing the form added.
    expect(Object.keys(json).sort()).toEqual(["expiresAt", "name"]);
  });
});
