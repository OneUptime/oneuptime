import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
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

configure({ asyncUtilTimeout: 15000 });

/*
 * Incidents → Settings → Incident Roles, rendered for real - its ModelTable,
 * BaseModelTable and the ModelFormModal its Create and Edit open - with only
 * the API, the permissions and the signed-in user stubbed.
 *
 * The maintainer, on this page: "To make things simple, can we remove all
 * the roles except Incident Commander by default? People can add more roles
 * if they feel like. Please also remove multiple users column from modal
 * table (as this complicates the UI). We need to make the UI as easy to
 * understand as possible."
 *
 * What is pinned is what the maintainer sees:
 *   - a new project's list is Incident Commander alone, under a card that
 *     says more roles can be added;
 *   - the table is a role's name and description - no Multiple Users;
 *   - Incident Commander's Delete is locked, saying why, and a role the
 *     project added can be deleted;
 *   - Create is one page: a name and a description, with Allow Multiple
 *     Users, the icon and the colour folded under More fields - the colour
 *     already picked, one the listed roles do not use yet, so a role is
 *     created without opening anything. It used to be a second step,
 *     "Appearance", walked through only to pick a colour;
 *   - Edit keeps those three under More fields (showing what is set, and
 *     saving it), and leaves Allow Multiple Users out for Incident
 *     Commander, which is always one person.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

import IncidentRolesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentRoles";
import { IncidentRoleSettingsCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentRole/IncidentRoleSettings";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import {
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";
import { Amber600, Indigo500 } from "../../../Types/BrandColors";
import { areSimilarColors } from "../../../Utils/DistinctColor";

type RoleRow = {
  _id: string;
  name: string;
  description?: string;
  color: string;
  roleIcon?: IconProp;
  isPrimaryRole?: boolean;
  isDeleteable?: boolean;
  canAssignMultipleUsers?: boolean;
};

// What a new project has: the one role ProjectService seeds.
const COMMANDER: RoleRow = {
  _id: "00000000-0000-4000-8000-0000000000c1",
  name: "Incident Commander",
  description:
    "Primary decision maker during an incident. Responsible for coordinating the response and making final decisions.",
  color: "#a855f7",
  roleIcon: IconProp.ShieldCheck,
  isPrimaryRole: true,
  isDeleteable: false,
  canAssignMultipleUsers: false,
};

// Roles a team added, one of them held by more than one person.
const RESPONDER: RoleRow = {
  _id: "00000000-0000-4000-8000-0000000000c2",
  name: "Responder",
  description: "Does the hands-on work to resolve the incident.",
  color: "#3b82f6",
  roleIcon: IconProp.Wrench,
  isPrimaryRole: false,
  isDeleteable: true,
  canAssignMultipleUsers: false,
};

const OBSERVER: RoleRow = {
  _id: "00000000-0000-4000-8000-0000000000c3",
  name: "Observer",
  description: "Follows the incident without working on it.",
  color: "#6b7280",
  roleIcon: IconProp.Activity,
  isPrimaryRole: false,
  isDeleteable: true,
  canAssignMultipleUsers: true,
};

let rows: Array<RoleRow> = [COMMANDER];

const toModel: (row: RoleRow) => IncidentRole = (
  row: RoleRow,
): IncidentRole => {
  const role: IncidentRole = new IncidentRole();
  role._id = row._id;
  role.name = row.name;
  role.description = row.description || "";
  role.color = new Color(row.color);

  if (row.roleIcon) {
    role.roleIcon = row.roleIcon;
  }

  role.isPrimaryRole = Boolean(row.isPrimaryRole);
  role.isDeleteable = row.isDeleteable !== false;
  role.canAssignMultipleUsers = Boolean(row.canAssignMultipleUsers);
  return role;
};

let roleListRequests: Array<Record<string, unknown>> = [];
let itemRequests: Array<string> = [];
let saved: Array<{ formType: unknown; data: Record<string, unknown> }> = [];

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <IncidentRolesPage
      pageRoute={new Route("/dashboard/project/incidents/settings/roles")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  await waitFor(() => {
    expect(screen.getAllByRole("row").length).toBeGreaterThan(rows.length);
  });

  await screen.findByText(rows[0]!.name);
};

const rowOf: (name: string) => HTMLElement = (name: string): HTMLElement => {
  const cell: HTMLElement | undefined = screen
    .getAllByRole("row")
    .find((row: HTMLElement) => {
      return within(row).queryByText(name, { exact: true }) !== null;
    });

  expect(cell).toBeDefined();

  return cell!;
};

const headerCells: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("columnheader").map((cell: HTMLElement) => {
    return (cell.textContent || "").trim();
  });
};

const dialog: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("dialog");
};

const advancedHeader: () => HTMLElement | null = (): HTMLElement | null => {
  return within(dialog()).queryByRole("button", { name: "More fields" });
};

const multipleUsersSwitch: () => HTMLElement | null =
  (): HTMLElement | null => {
    return within(dialog()).queryByRole("switch", {
      name: IncidentRoleSettingsCopy.allowMultipleUsersTitle,
      hidden: true,
    });
  };

// The colour box, folded under More fields until it is opened.
const colorBox: () => HTMLInputElement = (): HTMLInputElement => {
  return within(dialog()).getByPlaceholderText(
    IncidentRoleSettingsCopy.colorPlaceholder,
  ) as HTMLInputElement;
};

const openCreate: () => Promise<void> = async (): Promise<void> => {
  const create: Array<HTMLElement> = screen.getAllByRole("button", {
    name: "Create Incident Role",
  });

  fireEvent.click(
    create.find((button: HTMLElement) => {
      return button.getAttribute("data-testid") === "card-button";
    })!,
  );

  // The form draws its fields once it has worked them out.
  await within(dialog()).findByPlaceholderText(
    IncidentRoleSettingsCopy.namePlaceholder,
  );

  // And fills the colour in once it has picked one.
  await waitFor(() => {
    expect(colorBox().value).not.toBe("");
  });
};

const openEdit: (row: RoleRow) => Promise<void> = async (
  row: RoleRow,
): Promise<void> => {
  fireEvent.click(
    within(rowOf(row.name)).getByRole("button", { name: "Edit" }),
  );

  await waitFor(() => {
    expect(
      (
        within(dialog()).getByPlaceholderText(
          IncidentRoleSettingsCopy.namePlaceholder,
        ) as HTMLInputElement
      ).value,
    ).toBe(row.name);
  });

  // Let the form's mount effects settle before asserting what is absent.
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  rows = [COMMANDER];
  roleListRequests = [];
  itemRequests = [];
  saved = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/project/incidents/settings/roles",
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: { new (): BaseModel };
    select?: Record<string, unknown>;
  }) => {
    if (args.modelType !== IncidentRole) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    roleListRequests.push(args.select || {});

    return {
      data: rows.map(toModel),
      count: rows.length,
      skip: 0,
      limit: 10,
    } as ListResult<IncidentRole>;
  }) as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    id: { toString: () => string };
  }) => {
    itemRequests.push(args.id.toString());

    const row: RoleRow | undefined = rows.find((candidate: RoleRow) => {
      return candidate._id === args.id.toString();
    });

    return row ? toModel(row) : null;
  }) as never);

  jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation((async (args: {
    model: BaseModel;
    formType: unknown;
  }) => {
    saved.push({
      formType: args.formType,
      data: BaseModel.toJSON(args.model, IncidentRole) as Record<
        string,
        unknown
      >,
    });

    return { data: args.model } as never;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Incident Roles page", () => {
  test("a new project's list is Incident Commander alone", async () => {
    await renderPage();

    expect(
      screen.getAllByRole("row").filter((row: HTMLElement) => {
        return within(row).queryAllByRole("cell").length > 0;
      }),
    ).toHaveLength(1);
    expect(rowOf("Incident Commander")).toBeInTheDocument();

    for (const retired of ["Responder", "Communications Lead", "Observer"]) {
      expect(screen.queryByText(retired, { exact: true })).toBeNull();
    }
  });

  test("its card says what roles are, and that more can be added", async () => {
    await renderPage();

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      IncidentRoleSettingsCopy.title,
    );
    expect(
      screen.getByText(IncidentRoleSettingsCopy.description),
    ).toBeInTheDocument();
    expect(IncidentRoleSettingsCopy.description).toContain(
      "Add more if your team needs them.",
    );
  });

  test("the table is a role's name and description, with no Multiple Users column", async () => {
    rows = [COMMANDER, RESPONDER, OBSERVER];

    await renderPage();

    const headers: Array<string> = headerCells();

    expect(headers).toContain("Name");
    expect(headers).toContain("Description");
    const mentionsMultiple: RegExp = /multiple/i;

    expect(
      headers.filter((header: string) => {
        return mentionsMultiple.test(header);
      }),
    ).toEqual([]);
    expect(screen.queryByText("Multiple Users")).toBeNull();
  });

  test("a role that allows more than one person looks like any other row", async () => {
    rows = [COMMANDER, RESPONDER, OBSERVER];

    await renderPage();

    const observerCells: Array<string> = within(rowOf("Observer"))
      .getAllByRole("cell")
      .map((cell: HTMLElement) => {
        return (cell.textContent || "").trim();
      })
      .filter((text: string) => {
        return text.length > 0;
      });

    const responderCellCount: number = within(rowOf("Responder"))
      .getAllByRole("cell")
      .filter((cell: HTMLElement) => {
        return (cell.textContent || "").trim().length > 0;
      }).length;

    expect(observerCells).toContain(OBSERVER.description);
    expect(observerCells.length).toBe(responderCellCount);
  });

  test("the list asks for what the rows need, not for Multiple Users", async () => {
    await renderPage();

    expect(roleListRequests.length).toBeGreaterThan(0);

    const select: Record<string, unknown> =
      roleListRequests[roleListRequests.length - 1]!;

    expect(select).toHaveProperty("name");
    expect(select).toHaveProperty("description");
    expect(select).toHaveProperty("isDeleteable");
    expect(select).toHaveProperty("isPrimaryRole");
    expect(select).not.toHaveProperty("canAssignMultipleUsers");
  });

  test("Incident Commander keeps Edit, and its Delete is locked with the reason", async () => {
    await renderPage();

    const row: HTMLElement = rowOf("Incident Commander");

    expect(
      within(row).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();

    fireEvent.click(within(row).getByTestId("row-actions-more-button"));

    const deleteItem: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Delete" },
    );

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(
      document.getElementById(deleteItem.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(
      "Every incident needs someone in charge, so this role can be renamed, but not deleted.",
    );
  });

  test("a role the project added can be deleted", async () => {
    rows = [COMMANDER, RESPONDER];

    await renderPage();

    fireEvent.click(
      within(rowOf("Responder")).getByTestId("row-actions-more-button"),
    );

    const deleteItem: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Delete" },
    );

    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("creating a role", () => {
  test("asks for a name and a description, with Allow Multiple Users folded under More fields", async () => {
    await renderPage();
    await openCreate();

    expect(
      within(dialog()).getByPlaceholderText(
        IncidentRoleSettingsCopy.namePlaceholder,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByPlaceholderText(
        IncidentRoleSettingsCopy.descriptionPlaceholder,
      ),
    ).toBeInTheDocument();

    const advanced: HTMLElement | null = advancedHeader();

    expect(advanced).not.toBeNull();
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advanced)).toEqual([]);

    // Folded: in the form, but hidden until More fields is opened.
    const toggle: HTMLElement | null = multipleUsersSwitch();

    expect(toggle).not.toBeNull();
    expect(toggle!.closest("[hidden]")).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(advanced!);

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(multipleUsersSwitch()!.closest("[hidden]")).toBeNull();
    expect(
      within(dialog()).getByText(
        IncidentRoleSettingsCopy.allowMultipleUsersDescription,
      ),
    ).toBeInTheDocument();
  });

  test("is one page: the icon and the colour are folded under More fields, not a step of their own", async () => {
    await renderPage();
    await openCreate();

    // No step list, and the action is right there - no Next.
    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create Incident Role");

    // More fields names what it holds while folded, none of it set.
    expect(listedNames(advancedHeader())).toEqual([
      IncidentRoleSettingsCopy.allowMultipleUsersTitle,
      IncidentRoleSettingsCopy.iconFieldTitle,
      IncidentRoleSettingsCopy.colorFieldTitle,
    ]);
    expect(setChips(advancedHeader())).toEqual([]);

    // The colour is in there, folded, until More fields is opened.
    expect(colorBox().closest("[hidden]")).not.toBeNull();

    fireEvent.click(advancedHeader()!);

    expect(colorBox().closest("[hidden]")).toBeNull();
    expect(
      within(dialog()).getByPlaceholderText(
        IncidentRoleSettingsCopy.iconPlaceholder,
      ),
    ).toBeInTheDocument();
  });

  test("starts with a colour already picked, one the listed roles do not use", async () => {
    await renderPage();
    await openCreate();

    // Incident Commander is purple; indigo is the palette's first colour.
    expect(colorBox().value).toBe(Indigo500.toString());
    expect(areSimilarColors(colorBox().value, COMMANDER.color)).toBe(false);
  });

  test("passes over a colour a listed role already has", async () => {
    rows = [COMMANDER, { ...RESPONDER, color: Indigo500.toString() }];

    await renderPage();
    await openCreate();

    expect(colorBox().value).toBe(Amber600.toString());

    for (const role of rows) {
      expect(areSimilarColors(colorBox().value, role.color)).toBe(false);
    }
  });

  test("creates a role from its name alone, saving the colour it picked", async () => {
    await renderPage();
    await openCreate();

    fireEvent.change(
      within(dialog()).getByPlaceholderText(
        IncidentRoleSettingsCopy.namePlaceholder,
      ),
      { target: { value: "Scribe" } },
    );

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]!.data["name"]).toBe("Scribe");
    expect(saved[0]!.data["color"]).toEqual({
      _type: "Color",
      value: Indigo500.toString(),
    });
    // No icon was picked, and none is needed.
    expect(saved[0]!.data["roleIcon"]).toBeUndefined();
    // Not opened, so the switch is sent as it started: off.
    expect(saved[0]!.data["canAssignMultipleUsers"]).toBe(false);
  });

  test("suggests a role to add, not the Incident Commander every project already has", async () => {
    await renderPage();
    await openCreate();

    const name: HTMLElement = within(dialog()).getByPlaceholderText(
      IncidentRoleSettingsCopy.namePlaceholder,
    );

    expect(name).toHaveAttribute("placeholder", "Responder");
    expect(
      within(dialog()).queryByPlaceholderText("Incident Commander"),
    ).toBeNull();
  });

  test("still offers Allow Multiple Users after Incident Commander was edited", async () => {
    rows = [COMMANDER, RESPONDER];

    await renderPage();
    await openEdit(COMMANDER);

    expect(multipleUsersSwitch()).toBeNull();

    fireEvent.click(within(dialog()).getByTestId("close-button"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await openCreate();

    expect(advancedHeader()).not.toBeNull();
    expect(multipleUsersSwitch()).not.toBeNull();
  });
});

// One page: Save Changes is right there, with no step list to walk.
async function saveChanges(): Promise<void> {
  expect(
    within(dialog()).queryByRole("navigation", { name: "Progress" }),
  ).toBeNull();

  fireEvent.click(
    await within(dialog()).findByTestId("modal-footer-submit-button"),
  );
}

describe("editing a role", () => {
  test("Incident Commander's form has no Allow Multiple Users: More fields holds only its icon and colour", async () => {
    rows = [COMMANDER, RESPONDER];

    await renderPage();
    await openEdit(COMMANDER);

    expect(itemRequests).toEqual([COMMANDER._id]);
    expect(listedNames(advancedHeader())).toEqual([
      IncidentRoleSettingsCopy.iconFieldTitle,
      IncidentRoleSettingsCopy.colorFieldTitle,
    ]);
    expect(multipleUsersSwitch()).toBeNull();
    expect(
      within(dialog()).queryByText(
        IncidentRoleSettingsCopy.allowMultipleUsersTitle,
      ),
    ).toBeNull();

    // Its name and description are still there to change.
    expect(
      (
        within(dialog()).getByPlaceholderText(
          IncidentRoleSettingsCopy.descriptionPlaceholder,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(COMMANDER.description);
  });

  test("a role held by one person: More fields is folded, showing its icon and colour as set, not the switch", async () => {
    rows = [COMMANDER, RESPONDER];

    await renderPage();
    await openEdit(RESPONDER);

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader())).toEqual([
      IncidentRoleSettingsCopy.iconFieldTitle,
      IncidentRoleSettingsCopy.colorFieldTitle,
    ]);
    expect(multipleUsersSwitch()).toHaveAttribute("aria-checked", "false");

    // Its own colour, not a new pick.
    await waitFor(() => {
      expect(colorBox().value).toBe(RESPONDER.color);
    });
  });

  test("a role held by more than one person: More fields shows the switch as on", async () => {
    rows = [COMMANDER, OBSERVER];

    await renderPage();
    await openEdit(OBSERVER);

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(hasSetChip(advancedHeader())).toBe(true);
    expect(setChips(advancedHeader())).toContain(
      `${IncidentRoleSettingsCopy.allowMultipleUsersTitle}: On`,
    );
    expect(multipleUsersSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("switching it on under More fields is saved", async () => {
    rows = [COMMANDER, RESPONDER];

    await renderPage();
    await openEdit(RESPONDER);

    fireEvent.click(advancedHeader()!);
    fireEvent.click(multipleUsersSwitch()!);

    expect(multipleUsersSwitch()).toHaveAttribute("aria-checked", "true");

    await saveChanges();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]!.data["_id"]).toBe(RESPONDER._id);
    expect(saved[0]!.data["canAssignMultipleUsers"]).toBe(true);
    expect(saved[0]!.data["name"]).toBe(RESPONDER.name);
    // The colour it had, untouched.
    expect(saved[0]!.data["color"]).toEqual({
      _type: "Color",
      value: RESPONDER.color,
    });
  });

  test("saving Incident Commander never sends Allow Multiple Users", async () => {
    rows = [COMMANDER, RESPONDER];

    await renderPage();
    await openEdit(COMMANDER);

    await saveChanges();

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    expect(saved[0]!.data["_id"]).toBe(COMMANDER._id);
    expect(saved[0]!.data["canAssignMultipleUsers"]).not.toBe(true);
  });
});
