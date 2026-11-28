import "@testing-library/jest-dom";
import {
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
 * THE CUSTOMER'S ROLES IN THE DASHBOARD (#11259).
 *
 * A team held Viewer over the whole project and Project Member on the
 * monitors labelled Production. Monitor A carries the label; monitor B
 * carries none. Opening B's Delete page showed "Delete Monitor" active, with
 * no reason; confirming failed on the server: "You do not have permission to
 * delete Monitor without any labels." The same went for the Monitors list's
 * row Edit and Delete, its bulk Delete, and B's key reset.
 *
 * Rendered here as the Dashboard draws them - the record's layout
 * (ModelPage, which reads the record's labels with its header) around the
 * Delete card and a key reset, and the Monitors list (ModelTable) - against
 * a fake API, with the customer's permission snapshot in the tab:
 *
 *   - B's Delete and reset are locked, saying the permission is limited to
 *     monitors labelled Production; A's work;
 *   - the list locks B's row Edit and Delete, saying why, and not A's, and
 *     reads its rows' label ids to do it; bulk Delete deletes A, sends
 *     nothing for B and lists it with the reason;
 *   - a list of monitors on B's own page locks each row by its own labels,
 *     not by B's;
 *   - a Viewer alone and a Project Member over the whole project see what
 *     they always saw.
 */

const getItemCalls: Array<{ modelType: unknown; id: string }> = [];
const getListCalls: Array<{ modelType: unknown; select: unknown }> = [];
let deletedIds: Array<string> = [];
let updatedIds: Array<string> = [];

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
        modelType: { new (): { tableName?: string } };
        id: { toString: () => string };
      }): Promise<unknown> => {
        getItemCalls.push({
          modelType: data.modelType,
          id: data.id.toString(),
        });
        return fakeApi.getItem(data.modelType, data.id.toString());
      },
      getList: async (data: {
        modelType: { new (): { tableName?: string } };
        select: unknown;
        skip?: number;
        limit?: number;
      }): Promise<unknown> => {
        getListCalls.push({ modelType: data.modelType, select: data.select });
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
      updateById: async (data: {
        id: { toString: () => string };
      }): Promise<void> => {
        updatedIds.push(data.id.toString());
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import ModelTable from "../../../UI/Components/ModelTable/ModelTable";
import ResetObjectID from "../../../UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import { clearLabelNames } from "../../../UI/Utils/RecordLabelLock";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";

const PROJECT_ID: string = "11259000-0000-4000-8000-000000000201";
const LABEL_ID: string = "11259000-0000-4000-8000-0000000002a1";
const LABEL_NAME: string = "Production";
const MONITOR_A: string = "11259000-0000-4000-8000-0000000002c1";
const MONITOR_B: string = "11259000-0000-4000-8000-0000000002c2";

const LIMITED: string = `Your permission is limited to monitors labelled ${LABEL_NAME}.`;

const label: () => Label = (): Label => {
  const value: Label = new Label();
  value._id = LABEL_ID;
  value.name = LABEL_NAME;
  return value;
};

const monitor: (id: string, name: string, labels: Array<Label>) => Monitor = (
  id: string,
  name: string,
  labels: Array<Label>,
): Monitor => {
  const value: Monitor = new Monitor();
  value._id = id;
  value.name = name;
  value.labels = labels;
  return value;
};

// What the fake API holds: monitor A, labelled Production, and monitor B.
const fakeApi: {
  getItem: (modelType: unknown, id: string) => unknown;
  getList: (modelType: unknown) => Array<unknown>;
} = {
  getItem: (modelType: unknown, id: string): unknown => {
    if (modelType !== Monitor) {
      return null;
    }

    return id.toLowerCase() === MONITOR_A
      ? monitor(MONITOR_A, "Website A", [label()])
      : monitor(MONITOR_B, "Website B", []);
  },
  getList: (modelType: unknown): Array<unknown> => {
    if (modelType === Label) {
      return [label()];
    }

    if (modelType === Monitor) {
      return [
        monitor(MONITOR_A, "Website A", [label()]),
        monitor(MONITOR_B, "Website B", []),
      ];
    }

    return [];
  },
};

const row: (
  permission: Permission,
  options?: { labelIds?: Array<string>; scope?: PermissionScope },
) => UserPermission = (
  permission: Permission,
  options?: { labelIds?: Array<string>; scope?: PermissionScope },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (options?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: false,
    ...(options?.scope ? { scope: options.scope } : {}),
  };
};

// The customer's team, exactly.
const CUSTOMER: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_ID],
  }),
];

const signInAs: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [row(Permission.ProjectUser), ...rows],
  });
};

const findButton: (label: string) => HTMLButtonElement | null = (
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

const tooltipOf: (button: HTMLButtonElement) => Promise<string> = async (
  button: HTMLButtonElement,
): Promise<string> => {
  fireEvent.mouseEnter(button.parentElement as HTMLElement);

  return (await screen.findByRole("tooltip")).textContent || "";
};

// Monitor `id`'s page, as its layout draws one, around `children`.
const pageOf: (id: string, children: ReactElement) => ReactElement = (
  id: string,
  children: ReactElement,
): ReactElement => {
  return (
    <ModelPage
      title="Monitor"
      modelType={Monitor}
      modelId={new ObjectID(id)}
      modelNameField="name"
    >
      {children}
    </ModelPage>
  );
};

const deletePageOf: (id: string) => ReactElement = (
  id: string,
): ReactElement => {
  return pageOf(
    id,
    <ModelDelete<Monitor>
      modelType={Monitor}
      modelId={new ObjectID(id)}
      onDeleteSuccess={() => {}}
    />,
  );
};

const monitorsList: (key: string) => ReactElement = (
  key: string,
): ReactElement => {
  return (
    <ModelTable<Monitor>
      modelType={Monitor}
      id={`monitors-${key}`}
      name="Monitors"
      userPreferencesKey={`monitors-${key}`}
      urlStateKey={`monitors-${key}`}
      columns={[{ field: { name: true }, title: "Name", type: FieldType.Text }]}
      filters={[]}
      cardProps={{
        title: "Monitors",
        description: "What OneUptime checks, and how often.",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={false}
      isViewable={false}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
        },
      ]}
    />
  );
};

// The table row that shows `name` - the page's header may show it too.
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

// The ⋯ menu of the row that shows `name`.
const openRowMenu: (name: string) => Promise<HTMLElement> = async (
  name: string,
): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(tableRowOf(name)).not.toBeNull();
  });

  fireEvent.click(
    within(tableRowOf(name)!).getByTestId("row-actions-more-button"),
  );

  return screen.getByRole("menu");
};

const reasonOf: (item: HTMLElement) => string | null = (
  item: HTMLElement,
): string | null => {
  const describedBy: string | null = item.getAttribute("aria-describedby");
  return describedBy
    ? document.getElementById(describedBy)?.textContent || null
    : null;
};

const menuItem: (menu: HTMLElement, name: string) => HTMLElement = (
  menu: HTMLElement,
  name: string,
): HTMLElement => {
  return within(menu).getByRole("menuitem", { name: name });
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();
  clearLabelNames();
  getItemCalls.length = 0;
  getListCalls.length = 0;
  deletedIds = [];
  updatedIds = [];
});

afterEach(() => {
  cleanup();
});

describe("monitor B's pages, for the customer's team", () => {
  test("Delete Monitor is locked, saying the permission is limited to monitors labelled Production", async () => {
    signInAs(CUSTOMER);

    render(deletePageOf(MONITOR_B));

    await waitFor(() => {
      expect(findButton("Delete Monitor")).toBeDisabled();
    });

    await waitFor(async () => {
      expect(await tooltipOf(findButton("Delete Monitor")!)).toContain(
        `You do not have permission to delete this Monitor. ${LIMITED}`,
      );
    });

    // Pressing it opens no confirmation and deletes nothing.
    fireEvent.click(findButton("Delete Monitor")!);
    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
    expect(deletedIds).toEqual([]);
  });

  test("monitor A's Delete works: it carries the label the role is limited to", async () => {
    signInAs(CUSTOMER);

    render(deletePageOf(MONITOR_A));

    await waitFor(() => {
      expect(findButton("Delete Monitor")).not.toBeNull();
    });
    expect(findButton("Delete Monitor")).not.toBeDisabled();

    fireEvent.click(findButton("Delete Monitor")!);

    expect(
      await screen.findByTestId("confirm-modal-description"),
    ).toBeInTheDocument();
  });

  test("the key reset is locked on B, with the same reason, and works on A", async () => {
    signInAs(CUSTOMER);

    const resetOf: (id: string) => ReactElement = (id: string) => {
      return pageOf(
        id,
        <ResetObjectID<Monitor>
          modelType={Monitor}
          modelId={new ObjectID(id)}
          fieldName={"serverMonitorSecretKey"}
          title="Reset Server Monitor Secret Key"
          description="The agent signs in with this key."
          onUpdateComplete={() => {}}
        />,
      );
    };

    const { unmount } = render(resetOf(MONITOR_B));

    await waitFor(() => {
      expect(findButton("Reset Server Monitor Secret Key")).toBeDisabled();
    });
    await waitFor(async () => {
      expect(
        await tooltipOf(findButton("Reset Server Monitor Secret Key")!),
      ).toContain(LIMITED);
    });

    unmount();
    render(resetOf(MONITOR_A));

    await waitFor(() => {
      expect(findButton("Reset Server Monitor Secret Key")).not.toBeNull();
    });
    expect(findButton("Reset Server Monitor Secret Key")).not.toBeDisabled();
  });

  test("a Viewer alone is told the permission they lack, as before", async () => {
    signInAs([row(Permission.Viewer, { scope: PermissionScope.All })]);

    render(deletePageOf(MONITOR_B));

    await waitFor(() => {
      expect(findButton("Delete Monitor")).toBeDisabled();
    });

    const tooltip: string = await tooltipOf(findButton("Delete Monitor")!);

    expect(tooltip).toContain(
      "You do not have permission to delete this Monitor.",
    );
    expect(tooltip).not.toContain("labelled");
  });

  test("a Project Member over the whole project deletes B, and nothing reads label names", async () => {
    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);

    render(deletePageOf(MONITOR_B));

    await waitFor(() => {
      expect(findButton("Delete Monitor")).not.toBeNull();
    });
    expect(findButton("Delete Monitor")).not.toBeDisabled();
    expect(
      getListCalls.some((call: { modelType: unknown }): boolean => {
        return call.modelType === Label;
      }),
    ).toBe(false);
  });
});

describe("the Monitors list, for the customer's team", () => {
  test("B's row Edit and Delete are locked, saying why; A's are not", async () => {
    signInAs(CUSTOMER);

    render(monitorsList("rows"));

    // Delete, in the row's ⋯ menu.
    const bMenu: HTMLElement = await openRowMenu("Website B");
    const bDelete: HTMLElement = menuItem(bMenu, "Delete");

    expect(bDelete).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(reasonOf(bDelete)).toBe(
        `You do not have permission to delete this Monitor. ${LIMITED}`,
      );
    });

    fireEvent.keyDown(bMenu, { key: "Escape" });

    // Edit, the row's own button: with no View, it is the row's one action.
    const bEdit: HTMLButtonElement = within(tableRowOf("Website B")!).getByRole(
      "button",
      { name: "Edit" },
    ) as HTMLButtonElement;

    expect(bEdit).toBeDisabled();
    await waitFor(async () => {
      expect(await tooltipOf(bEdit)).toContain(
        `You do not have permission to update this Monitor. ${LIMITED}`,
      );
    });

    const aEdit: HTMLButtonElement = within(tableRowOf("Website A")!).getByRole(
      "button",
      { name: "Edit" },
    ) as HTMLButtonElement;

    expect(aEdit).not.toBeDisabled();

    const aMenu: HTMLElement = await openRowMenu("Website A");

    expect(menuItem(aMenu, "Delete")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("the rows are read with their labels' ids, to lock them by", async () => {
    signInAs(CUSTOMER);

    render(monitorsList("select"));

    await waitFor(() => {
      expect(screen.getByText("Website B")).toBeInTheDocument();
    });

    const monitorRead: { select: unknown } | undefined = getListCalls.find(
      (call: { modelType: unknown }): boolean => {
        return call.modelType === Monitor;
      },
    );

    expect(
      (monitorRead!.select as { labels?: { _id?: boolean } }).labels?._id,
    ).toBe(true);
  });

  test("bulk Delete deletes A, sends nothing for B, and lists B with the reason", async () => {
    signInAs(CUSTOMER);

    render(monitorsList("bulk"));

    await waitFor(() => {
      expect(screen.getByText("Website B")).toBeInTheDocument();
    });

    for (const name of ["Website A", "Website B"]) {
      const tableRow: HTMLElement = screen.getByText(name).closest("tr")!;
      fireEvent.click(tableRow.querySelector('input[type="checkbox"]')!);
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
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item: HTMLElement) => {
        return (item.textContent || "").trim() === "Delete";
      })!,
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="modal-footer"]'),
      ).not.toBeNull();
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
      expect(deletedIds).toEqual([MONITOR_A]);
    });

    await waitFor(() => {
      expect(document.body.textContent || "").toContain(LIMITED);
    });
  });

  test("a list of monitors on B's own page locks each row by its own labels, not by B's", async () => {
    signInAs(CUSTOMER);

    render(pageOf(MONITOR_B, monitorsList("on-page")));

    const aMenu: HTMLElement = await openRowMenu("Website A");

    expect(menuItem(aMenu, "Delete")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.keyDown(aMenu, { key: "Escape" });

    const bMenu: HTMLElement = await openRowMenu("Website B");

    expect(menuItem(bMenu, "Delete")).toHaveAttribute("aria-disabled", "true");
  });

  test("a Project Member over the whole project sees no row locked", async () => {
    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);

    render(monitorsList("member"));

    const bMenu: HTMLElement = await openRowMenu("Website B");

    expect(menuItem(bMenu, "Delete")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
