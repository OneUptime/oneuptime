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
import React, { ReactElement } from "react";
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
 * WHAT A ROLE SCOPED TO OWNED DOES NOT REACH IS LOCKED, SAYING WHY (#11436),
 * AND A COLUMN READ ON SOME LABELS ONLY IS NO SORT AND NO BLANK SAVE (#11437).
 *
 * A Viewer over the whole project who is a Monitor Admin of what their team
 * owns could press Edit and Delete on any monitor: the Dashboard could not
 * tell who owns one, and the server refused after the click. A record's
 * page now asks the server once who owns it (POST /monitor
 * /record-ownership), a list once for its rows, and the shared rule locks
 * what the server would refuse:
 *
 *   - a monitor neither the reader nor their grant's team owns: Delete
 *     locked - "Your permission is limited to monitors you or your teams
 *     own."; one they or that team own: as before;
 *   - beside labels: "... limited to monitors labelled Production and to
 *     monitors you or your teams own.";
 *   - while the answer is read, Delete is not offered at all; with no
 *     answer, it is offered, and the server keeps the last word;
 *   - a reader with no grant scoped to Owned never asks;
 *   - the Monitors list locks each row by who owns it, and bulk Delete
 *     leaves those rows out.
 *
 * And a column the reader reads on some labels only (a monitor's secret
 * key, for the customer's team): its header is not offered as a sort, its
 * (i) says why, and a sort a list asks for by it is not sent; an edit form
 * of a monitor the key was withheld from keeps the stored key when the
 * field is left blank.
 */

const getListCalls: Array<{ modelType: unknown; sort: unknown }> = [];
let deletedIds: Array<string> = [];
const ownershipAsks: Array<Array<string>> = [];

// Who owns each monitor, as the server answers: by monitor id.
let ownedBy: Record<string, { isOwnedByCaller: boolean; teamIds: Array<string> }> =
  {};
// The answer held back until a test lets it go, or failing.
let ownershipAnswer: "now" | "never" | "fails" = "now";
let releaseOwnership: (() => void) | null = null;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: unknown;
        id: { toString: () => string };
      }): Promise<unknown> => {
        return fakeApi.getItem(data.modelType, data.id.toString());
      },
      getList: async (data: {
        modelType: unknown;
        sort?: unknown;
        skip?: number;
        limit?: number;
      }): Promise<unknown> => {
        getListCalls.push({ modelType: data.modelType, sort: data.sort });
        const rows: Array<unknown> = fakeApi.getList(data.modelType);
        return {
          data: rows,
          count: rows.length,
          skip: data.skip || 0,
          limit: data.limit || 10,
        };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (data: {
        id: { toString: () => string };
      }): Promise<void> => {
        deletedIds.push(data.id.toString());
      },
      updateById: async (): Promise<void> => {
        // not exercised
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import ModelTable from "../../../UI/Components/ModelTable/ModelTable";
import FieldType from "../../../UI/Components/Types/FieldType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import { clearLabelNames } from "../../../UI/Utils/RecordLabelLock";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import UniqueNamesApi from "../../../UI/Utils/UniqueNamesApi";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";

const PROJECT_ID: string = "11436000-0000-4000-8000-000000000201";
const LABEL_ID: string = "11436000-0000-4000-8000-0000000002a1";
const SUPPORT_TEAM: string = "11436000-0000-4000-8000-0000000002b1";
const OPS_TEAM: string = "11436000-0000-4000-8000-0000000002b2";

// Monitor A carries Production; the others carry none.
const MONITOR_A: string = "11436000-0000-4000-8000-0000000002c1";
const NOBODYS: string = "11436000-0000-4000-8000-0000000002c2";
const READERS: string = "11436000-0000-4000-8000-0000000002c3";
const SUPPORTS: string = "11436000-0000-4000-8000-0000000002c4";
const OPS: string = "11436000-0000-4000-8000-0000000002c5";

const NAMES: Record<string, string> = {
  [MONITOR_A]: "Website A",
  [NOBODYS]: "Nobody's",
  [READERS]: "The reader's own",
  [SUPPORTS]: "Support's",
  [OPS]: "Ops'",
};

const OWNED: string = "Your permission is limited to monitors you or your teams own.";
const LABELS_OR_OWNED: string =
  "Your permission is limited to monitors labelled Production and to monitors you or your teams own.";

const label: () => Label = (): Label => {
  const value: Label = new Label();
  value._id = LABEL_ID;
  value.name = "Production";
  return value;
};

const monitor: (id: string) => Monitor = (id: string): Monitor => {
  const value: Monitor = new Monitor();
  value._id = id;
  value.name = NAMES[id] || id;
  value.labels = id === MONITOR_A ? [label()] : [];

  // Monitor A's key is read; every other monitor's is withheld from the customer.
  if (id === MONITOR_A) {
    value.serverMonitorSecretKey = new ObjectID(
      "11436000-0000-4000-8000-0000000002d1",
    );
  }

  return value;
};

const fakeApi: {
  getItem: (modelType: unknown, id: string) => unknown;
  getList: (modelType: unknown) => Array<unknown>;
} = {
  getItem: (modelType: unknown, id: string): unknown => {
    return modelType === Monitor ? monitor(id.toLowerCase()) : null;
  },
  getList: (modelType: unknown): Array<unknown> => {
    if (modelType === Label) {
      return [label()];
    }

    if (modelType === Monitor) {
      return [monitor(MONITOR_A), monitor(NOBODYS), monitor(READERS)];
    }

    return [];
  },
};

const row: (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    scope?: PermissionScope;
    teamId?: string;
  },
) => UserPermission = (
  permission: Permission,
  options?: { labelIds?: Array<string>; scope?: PermissionScope; teamId?: string },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (options?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: false,
    ...(options?.scope ? { scope: options.scope } : {}),
    ...(options?.teamId ? { teamId: new ObjectID(options.teamId) } : {}),
  };
};

// Viewer over the project, Monitor Admin of what Support owns.
const OWNED_ADMIN: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All, teamId: SUPPORT_TEAM }),
  row(Permission.MonitorAdmin, {
    scope: PermissionScope.Owned,
    teamId: SUPPORT_TEAM,
  }),
];

// The customer's team, with Monitor Admin of what Ops owns beside it.
const LABELS_AND_OWNED: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All, teamId: SUPPORT_TEAM }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_ID],
    teamId: SUPPORT_TEAM,
  }),
  row(Permission.MonitorAdmin, { scope: PermissionScope.Owned, teamId: OPS_TEAM }),
];

// The customer's team, exactly: no grant scoped to Owned.
const CUSTOMER: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All, teamId: SUPPORT_TEAM }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_ID],
    teamId: SUPPORT_TEAM,
  }),
];

const signInAs: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [Permission.Public, Permission.User, Permission.CurrentUser],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [row(Permission.ProjectUser), ...rows],
  });
};

// The server's answer about the records asked for: the tables, and who owns each.
const ownershipJson: (ids: Array<string>) => JSONObject = (
  ids: Array<string>,
): JSONObject => {
  const records: JSONObject = {};

  for (const id of ids) {
    records[id.toLowerCase()] = ownedBy[id.toLowerCase()] || {
      isOwnedByCaller: false,
      teamIds: [],
    };
  }

  return {
    tableName: "Monitor",
    tables: [
      { tableName: "Monitor", key: "_id", operations: ["read", "update", "delete"] },
      {
        tableName: "MonitorOwnerUser",
        key: "monitorId",
        operations: ["create", "update", "delete"],
      },
    ],
    records: records,
  };
};

const findButton: (text: string) => HTMLButtonElement | null = (
  text: string,
): HTMLButtonElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(text);
      },
    ) || null
  );
};

const tooltipOf: (button: HTMLElement) => Promise<string> = async (
  button: HTMLElement,
): Promise<string> => {
  fireEvent.mouseEnter(button.parentElement as HTMLElement);

  return (await screen.findByRole("tooltip")).textContent || "";
};

/*
 * Waits for the page's ask of who owns its records, and for its answer to
 * land and the page to draw again - until then what the owners decide is
 * held back (not offered, nothing said).
 */
const answered: (asks?: number) => Promise<void> = async (
  asks: number = 1,
): Promise<void> => {
  await waitFor(() => {
    expect(ownershipAsks.length).toBe(asks);
  });

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

// The Delete card's button, once drawn.
const deleteButton: () => Promise<HTMLButtonElement> =
  async (): Promise<HTMLButtonElement> => {
    await waitFor(() => {
      expect(findButton("Delete Monitor")).not.toBeNull();
    });

    return findButton("Delete Monitor")!;
  };

const deletePageOf: (id: string) => ReactElement = (id: string): ReactElement => {
  return (
    <ModelPage
      title="Monitor"
      modelType={Monitor}
      modelId={new ObjectID(id)}
      modelNameField="name"
    >
      <ModelDelete<Monitor>
        modelType={Monitor}
        modelId={new ObjectID(id)}
        onDeleteSuccess={() => {}}
      />
    </ModelPage>
  );
};

const monitorsList: (data: {
  key: string;
  withKeyColumn?: boolean;
  sortBy?: keyof Monitor;
}) => ReactElement = (data: {
  key: string;
  withKeyColumn?: boolean;
  sortBy?: keyof Monitor;
}): ReactElement => {
  return (
    <ModelTable<Monitor>
      modelType={Monitor}
      id={`monitors-${data.key}`}
      name="Monitors"
      userPreferencesKey={`monitors-${data.key}`}
      urlStateKey={`monitors-${data.key}`}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        ...(data.withKeyColumn
          ? [
              {
                field: { serverMonitorSecretKey: true },
                title: "Secret Key",
                type: FieldType.Text,
              },
            ]
          : []),
      ]}
      filters={[]}
      {...(data.sortBy ? { sortBy: data.sortBy } : {})}
      cardProps={{
        title: "Monitors",
        description: "What OneUptime checks, and how often.",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={false}
      isViewable={false}
      formFields={[
        { field: { name: true }, title: "Name", fieldType: FormFieldSchemaType.Text },
      ]}
    />
  );
};

const tableRowOf: (name: string) => HTMLElement | null = (
  name: string,
): HTMLElement | null => {
  for (const element of screen.queryAllByText(name)) {
    const tableRow: HTMLElement | null = element.closest("tr");

    if (tableRow) {
      return tableRow;
    }
  }

  return null;
};

const openRowMenu: (name: string) => Promise<HTMLElement> = async (
  name: string,
): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(tableRowOf(name)).not.toBeNull();
  });

  fireEvent.click(within(tableRowOf(name)!).getByTestId("row-actions-more-button"));

  return screen.getByRole("menu");
};

const reasonOf: (item: HTMLElement) => string | null = (
  item: HTMLElement,
): string | null => {
  const describedBy: string | null = item.getAttribute("aria-describedby");
  return describedBy ? document.getElementById(describedBy)?.textContent || null : null;
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();
  clearLabelNames();
  getListCalls.length = 0;
  ownershipAsks.length = 0;
  deletedIds = [];
  ownedBy = {
    [READERS]: { isOwnedByCaller: true, teamIds: [] },
    [SUPPORTS]: { isOwnedByCaller: false, teamIds: [SUPPORT_TEAM] },
    [OPS]: { isOwnedByCaller: false, teamIds: [OPS_TEAM] },
  };
  ownershipAnswer = "now";
  releaseOwnership = null;

  jest.spyOn(UniqueNamesApi, "readSharedNames").mockResolvedValue({
    groups: [],
    createdAt: {},
  });

  // POST /monitor/record-ownership, answered from `ownedBy`.
  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: { toString: () => string };
    data: { ids: Array<string> };
  }) => {
    expect(data.url.toString()).toContain("/monitor/record-ownership");
    ownershipAsks.push([...data.data.ids]);

    if (ownershipAnswer === "fails") {
      return new HTTPErrorResponse(500, { message: "Server Error" }, {});
    }

    if (ownershipAnswer === "never") {
      await new Promise<void>((resolve: () => void) => {
        releaseOwnership = resolve;
      });
    }

    return new HTTPResponse<JSONObject>(200, ownershipJson(data.data.ids), {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a monitor's page, for a Viewer who is a Monitor Admin of what Support owns", () => {
  test("Delete is locked on a monitor nobody of theirs owns, saying so", async () => {
    signInAs(OWNED_ADMIN);
    render(deletePageOf(NOBODYS));
    await answered();

    const button: HTMLButtonElement = await deleteButton();
    expect(button).toBeDisabled();
    expect(await tooltipOf(button)).toBe(
      `You do not have permission to delete this Monitor. ${OWNED}`,
    );

    // One ask, of this monitor alone.
    expect(ownershipAsks).toEqual([[NOBODYS]]);
  });

  test.each([
    ["their own", READERS],
    ["their grant's team's", SUPPORTS],
  ])("Delete works on a monitor of %s", async (_name: string, id: string) => {
    signInAs(OWNED_ADMIN);
    render(deletePageOf(id));
    await answered();

    expect(await deleteButton()).not.toBeDisabled();
  });

  test("Ops owning it lets nothing through: Ops holds no grant scoped to Owned", async () => {
    signInAs(OWNED_ADMIN);
    // The server names only the teams of the reader's Owned grants.
    ownedBy[OPS] = { isOwnedByCaller: false, teamIds: [] };
    render(deletePageOf(OPS));
    await answered();

    const button: HTMLButtonElement = await deleteButton();
    expect(button).toBeDisabled();
    expect(await tooltipOf(button)).toBe(
      `You do not have permission to delete this Monitor. ${OWNED}`,
    );
  });

  test("while who owns it is read, Delete is held back - drawn, nothing said - and then locked with why", async () => {
    signInAs(OWNED_ADMIN);
    ownershipAnswer = "never";
    render(deletePageOf(NOBODYS));

    await waitFor(() => {
      expect(ownershipAsks.length).toBe(1);
    });

    // Not offered: locked with nothing to say yet, as while a snapshot loads.
    const held: HTMLButtonElement = await deleteButton();
    expect(held).toBeDisabled();
    fireEvent.mouseEnter(held.parentElement as HTMLElement);
    expect(screen.queryByRole("tooltip")).toBeNull();

    await act(async () => {
      releaseOwnership?.();
    });
    await answered();

    const locked: HTMLButtonElement = await deleteButton();
    expect(locked).toBeDisabled();
    expect(await tooltipOf(locked)).toBe(
      `You do not have permission to delete this Monitor. ${OWNED}`,
    );
  });

  test("while who owns it is read, a monitor they own is held back too - and then offered", async () => {
    signInAs(OWNED_ADMIN);
    ownershipAnswer = "never";
    render(deletePageOf(READERS));

    await waitFor(() => {
      expect(ownershipAsks.length).toBe(1);
    });
    expect(await deleteButton()).toBeDisabled();

    await act(async () => {
      releaseOwnership?.();
    });
    await answered();

    expect(await deleteButton()).not.toBeDisabled();
  });

  test("with no answer it is offered, and the server keeps the last word", async () => {
    signInAs(OWNED_ADMIN);
    ownershipAnswer = "fails";
    render(deletePageOf(NOBODYS));
    await answered();

    expect(await deleteButton()).not.toBeDisabled();
  });
});

describe("beside labels: the customer's team, with Monitor Admin of what Ops owns", () => {
  test("a monitor carrying none of the labels and owned by neither is locked, naming both", async () => {
    signInAs(LABELS_AND_OWNED);
    render(deletePageOf(NOBODYS));
    await answered();

    const button: HTMLButtonElement = await deleteButton();
    expect(button).toBeDisabled();
    expect(await tooltipOf(button)).toBe(
      `You do not have permission to delete this Monitor. ${LABELS_OR_OWNED}`,
    );
  });

  test.each([
    ["owned by Ops", OPS],
    ["labelled Production", MONITOR_A],
  ])("a monitor %s may be deleted", async (_name: string, id: string) => {
    signInAs(LABELS_AND_OWNED);
    render(deletePageOf(id));
    await answered();

    expect(await deleteButton()).not.toBeDisabled();
  });
});

describe("a reader with no grant scoped to Owned", () => {
  test("never asks who owns a monitor, and is locked by its labels as before", async () => {
    signInAs(CUSTOMER);
    render(deletePageOf(NOBODYS));

    await waitFor(() => {
      expect(findButton("Delete Monitor")).not.toBeNull();
    });

    expect(findButton("Delete Monitor")).toBeDisabled();
    expect(await tooltipOf(findButton("Delete Monitor")!)).toBe(
      "You do not have permission to delete this Monitor. Your permission is limited to monitors labelled Production.",
    );
    expect(ownershipAsks).toEqual([]);
  });
});

describe("the Monitors list, for a Monitor Admin of what Support owns", () => {
  test("asks once who owns the rows on screen, and locks the rows of nobody of theirs, saying why", async () => {
    signInAs(OWNED_ADMIN);
    render(monitorsList({ key: "owned" }));
    await answered();

    expect([...ownershipAsks[0]!].sort()).toEqual(
      [MONITOR_A, NOBODYS, READERS].sort(),
    );

    const menu: HTMLElement = await openRowMenu("Nobody's");
    const remove: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(remove)).toBe(
      `You do not have permission to delete this Monitor. ${OWNED}`,
    );
    fireEvent.keyDown(menu, { key: "Escape" });

    const own: HTMLElement = await openRowMenu("The reader's own");
    expect(
      within(own).getByRole("menuitem", { name: "Delete" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("bulk Delete deletes the rows they own, sends nothing for the others, and says why", async () => {
    signInAs(OWNED_ADMIN);
    render(monitorsList({ key: "bulk" }));
    await answered();

    await waitFor(() => {
      expect(tableRowOf("Nobody's")).not.toBeNull();
    });

    for (const name of ["The reader's own", "Nobody's"]) {
      fireEvent.click(tableRowOf(name)!.querySelector('input[type="checkbox"]')!);
    }

    fireEvent.click(await screen.findByText("Bulk Actions"));

    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('[role="menuitem"]')).some(
          (item: Element) => {
            return (item.textContent || "").trim() === "Delete";
          },
        ),
      ).toBe(true);
    });

    fireEvent.click(
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (item: HTMLElement) => {
          return (item.textContent || "").trim() === "Delete";
        },
      )!,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="modal-footer"]')).not.toBeNull();
    });

    fireEvent.click(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="modal-footer"] button',
        ),
      ).find((button: HTMLButtonElement) => {
        return (button.textContent || "").trim() === "Delete";
      })!,
    );

    await waitFor(() => {
      expect(
        deletedIds.map((id: string) => {
          return id.toLowerCase();
        }),
      ).toEqual([READERS]);
    });

    await waitFor(() => {
      expect(document.body.textContent || "").toContain(OWNED);
    });
  });
});

describe("a column read on some labels only (#11437)", () => {
  const headerOf: (title: string) => HTMLElement = (title: string): HTMLElement => {
    return screen.getAllByRole("columnheader").find((header: HTMLElement) => {
      return (header.textContent || "").includes(title);
    })!;
  };

  test("its header is no sort for the customer, and its (i) says why", async () => {
    signInAs(CUSTOMER);
    render(monitorsList({ key: "sort", withKeyColumn: true }));

    await waitFor(() => {
      expect(tableRowOf("Nobody's")).not.toBeNull();
    });

    const keyHeader: HTMLElement = headerOf("Secret Key");
    expect(keyHeader).not.toHaveAttribute("aria-sort");
    expect(within(keyHeader).queryByRole("button", { name: "Secret Key" })).toBeNull();

    const about: HTMLElement = within(keyHeader).getByRole("button", {
      name: "About Secret Key",
    });
    fireEvent.mouseEnter(about);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "You can read this only on monitors labelled Production, so the list cannot be sorted by it.",
    );

    // The name still sorts.
    expect(headerOf("Name")).toHaveAttribute("aria-sort");
  });

  test("a list's own sort by it is not sent", async () => {
    signInAs(CUSTOMER);
    render(
      monitorsList({
        key: "sort-asked",
        withKeyColumn: true,
        sortBy: "serverMonitorSecretKey",
      }),
    );

    await waitFor(() => {
      expect(
        getListCalls.filter((call: { modelType: unknown }) => {
          return call.modelType === Monitor;
        }).length,
      ).toBeGreaterThan(0);
    });

    for (const call of getListCalls.filter((item: { modelType: unknown }) => {
      return item.modelType === Monitor;
    })) {
      expect(Object.keys((call.sort as object) || {})).not.toContain(
        "serverMonitorSecretKey",
      );
    }
  });

  test("a Project Member over the whole project may sort by it, as before", async () => {
    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);
    render(monitorsList({ key: "sort-member", withKeyColumn: true }));

    await waitFor(() => {
      expect(tableRowOf("Nobody's")).not.toBeNull();
    });

    expect(headerOf("Secret Key")).toHaveAttribute("aria-sort");
  });
});

describe("an edit form of a field read on some labels only (#11437)", () => {
  /*
   * A reader who may change every monitor through the operational-resource
   * wildcard, and reads its key only where Project Member reaches: the
   * monitors labelled Production.
   */
  const WILDCARD_EDITOR: Array<UserPermission> = [
    row(Permission.Viewer, { scope: PermissionScope.All }),
    row(Permission.EditAllOperationalResources, { scope: PermissionScope.All }),
    row(Permission.ProjectMember, {
      scope: PermissionScope.Labels,
      labelIds: [LABEL_ID],
    }),
  ];

  const FIELDS: Array<ModelField<Monitor>> = [
    {
      field: { name: true },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Monitor name",
    },
    {
      field: { serverMonitorSecretKey: true },
      title: "Secret Key",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "The agent's key",
    },
  ];

  let saved: Array<JSONObject> = [];

  const renderForm: (id: string) => Promise<void> = async (
    id: string,
  ): Promise<void> => {
    await act(async () => {
      render(
        <ModelForm<Monitor>
          modelType={Monitor}
          modelAPI={
            {
              ...ModelAPI,
              createOrUpdate: async (data: { model: Monitor }) => {
                saved.push(Monitor.toJSON(data.model, Monitor));
                return { data: {} };
              },
            } as unknown as typeof ModelAPI
          }
          id="monitor-edit-form"
          name="Monitor"
          fields={FIELDS}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(id)}
          submitButtonText="Save"
          onSuccess={() => {}}
        />,
      );
    });

    await screen.findByPlaceholderText("Monitor name");
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(saved.length).toBe(1);
    });
  };

  beforeEach(() => {
    saved = [];
  });

  test("on a monitor its key was withheld from, the field keeps what is stored when left blank", async () => {
    signInAs(WILDCARD_EDITOR);
    await renderForm(NOBODYS);

    await waitFor(() => {
      expect(screen.getByText("Leave blank to keep the stored value.")).toBeInTheDocument();
    });

    await save();

    expect(Object.keys(saved[0]!)).not.toContain("serverMonitorSecretKey");
  });

  test("on a monitor its key was read on, the field shows it, and saves it", async () => {
    signInAs(WILDCARD_EDITOR);
    await renderForm(MONITOR_A);

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText("The agent's key") as HTMLInputElement).value,
      ).toBe("11436000-0000-4000-8000-0000000002d1");
    });

    expect(screen.queryByText("Leave blank to keep the stored value.")).toBeNull();

    await save();

    expect(saved[0]!["serverMonitorSecretKey"]).toBeTruthy();
  });
});
