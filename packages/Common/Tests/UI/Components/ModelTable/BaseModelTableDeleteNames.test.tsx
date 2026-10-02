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
 * A table's Delete - one row from its menu, or every selected row from Bulk
 * Actions - says which records it is about to delete.
 *
 * The row dialog named rows by `name` or `title` only, so a template was
 * called by the title of the incident it creates, and an endpoint or a source
 * map by nothing. It now reads the model's own name column first. The bulk
 * dialog said only "Are you sure you want to delete 7 monitors?"; it now names
 * the first five under that, and counts the rest.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
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

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import { MAX_DISPLAY_NAME_LENGTH } from "../../../../UI/Utils/ModelDisplayName";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../../Models/DatabaseModels/NetworkEndpoint";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import IconProp from "../../../../Types/Icon/IconProp";

const ARCHIVE_ACTION: unknown = {
  title: "Archive",
  icon: IconProp.Archive,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (): Promise<void> => {
    return Promise.resolve();
  },
};

interface TableOptions {
  modelType: { new (): BaseModel };
  rows: Array<JSONObject>;
  // The column the table shows - and so selects - first.
  columnField: string;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  isDeleteable?: boolean | undefined;
  withBulkActions?: boolean | undefined;
  deleteVerb?: string | undefined;
  deleteConfirmationWarning?: string | undefined;
}

type MakePropsFunction = (
  options: TableOptions,
) => BaseModelTableProps<BaseModel>;

const makeProps: MakePropsFunction = (
  options: TableOptions,
): BaseModelTableProps<BaseModel> => {
  const callbacks: BaseTableCallbacks<BaseModel> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): BaseModel => {
      return item as unknown as BaseModel;
    },
    getJSONFromModel: (item: BaseModel): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<BaseModel>> => {
      return {
        data: options.rows as unknown as Array<BaseModel>,
        count: options.rows.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<BaseModel>;

  return {
    modelType: options.modelType,
    id: "delete-names-table",
    name: "Delete names",
    singularName: options.singularName,
    pluralName: options.pluralName,
    userPreferencesKey: "delete-names-table",
    urlStateKey: "delete-names-table",
    columns: [
      {
        field: { [options.columnField]: true },
        title: "Name",
        type: FieldType.Text,
      },
    ],
    filters: [],
    cardProps: { title: "Things", description: "Things to delete" },
    isCreateable: false,
    isEditable: false,
    isDeleteable: options.isDeleteable ?? true,
    isViewable: false,
    callbacks: callbacks,
    ...(options.withBulkActions
      ? {
          bulkActions: {
            buttons: [ARCHIVE_ACTION],
            ...(options.deleteVerb ? { deleteVerb: options.deleteVerb } : {}),
            ...(options.deleteConfirmationWarning
              ? { deleteConfirmationWarning: options.deleteConfirmationWarning }
              : {}),
          },
        }
      : {}),
  } as unknown as BaseModelTableProps<BaseModel>;
};

type RenderTableFunction = (options: TableOptions) => ReturnType<typeof render>;

const renderTable: RenderTableFunction = (
  options: TableOptions,
): ReturnType<typeof render> => {
  return render(<BaseModelTable<BaseModel> {...makeProps(options)} />);
};

type FindButtonsFunction = (label: string) => Array<HTMLButtonElement>;

const findButtons: FindButtonsFunction = (
  label: string,
): Array<HTMLButtonElement> => {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button: HTMLButtonElement) => {
    return (button.textContent || "").trim() === label;
  });
};

type OpenRowDeleteFunction = (rowIndex: number) => Promise<HTMLElement>;

const openRowDelete: OpenRowDeleteFunction = async (
  rowIndex: number,
): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(findButtons("Delete").length).toBeGreaterThan(rowIndex);
  });

  fireEvent.click(findButtons("Delete")[rowIndex]!);

  return await waitFor(() => {
    return screen.getByTestId("confirm-modal-description");
  });
};

type SelectRowsFunction = (
  container: HTMLElement,
  rowCount: number,
  count: number,
) => Promise<void>;

const selectRows: SelectRowsFunction = async (
  container: HTMLElement,
  rowCount: number,
  count: number,
): Promise<void> => {
  await waitFor(() => {
    expect(
      container.querySelectorAll('input[type="checkbox"]:not([disabled])')
        .length,
    ).toBeGreaterThan(rowCount);
  });

  const checkboxes: Array<HTMLInputElement> = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  const rowCheckboxes: Array<HTMLInputElement> = checkboxes.slice(
    checkboxes.length - rowCount,
  );

  for (let index: number = 0; index < count; index++) {
    fireEvent.click(rowCheckboxes[index]!);
  }
};

type StartBulkDeleteFunction = (
  options: TableOptions,
  count: number,
  menuLabel?: string | undefined,
) => Promise<HTMLElement>;

/* Selects the first `count` rows, opens Bulk Actions and clicks Delete. */
const startBulkDelete: StartBulkDeleteFunction = async (
  options: TableOptions,
  count: number,
  menuLabel?: string | undefined,
): Promise<HTMLElement> => {
  const { container } = renderTable({
    ...options,
    isDeleteable: false,
    withBulkActions: true,
  });

  await selectRows(container, options.rows.length, count);

  await waitFor(() => {
    expect(screen.getByText("Bulk Actions")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText("Bulk Actions"));

  const label: string = menuLabel || "Delete";

  await waitFor(() => {
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).some((item: HTMLElement) => {
        return (item.textContent || "").trim() === label;
      }),
    ).toBe(true);
  });

  fireEvent.click(
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item: HTMLElement) => {
      return (item.textContent || "").trim() === label;
    })!,
  );

  return await waitFor(() => {
    return screen.getByTestId("confirm-modal-description");
  });
};

type ListedNamesFunction = () => Array<string>;

const listedNames: ListedNamesFunction = (): Array<string> => {
  return screen
    .queryAllByTestId("delete-confirmation-item")
    .map((item: HTMLElement) => {
      return item.textContent || "";
    });
};

type MakeDevicesFunction = (count: number) => Array<JSONObject>;

const makeDevices: MakeDevicesFunction = (count: number): Array<JSONObject> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return { _id: `device-${index + 1}`, name: `core-router-${index + 1}` };
  });
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/things");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a row's Delete", () => {
  test("names a template by its own name, not the title it gives incidents", async () => {
    renderTable({
      modelType: IncidentTemplate,
      columnField: "templateName",
      singularName: "Incident Template",
      rows: [
        {
          _id: "template-1",
          templateName: "Database outage",
          title: "Database is down",
        },
      ],
    });

    const description: HTMLElement = await openRowDelete(0);

    expect(description).toHaveTextContent(
      "Are you sure you want to delete Database outage? This action cannot be undone.",
    );
    expect(description).not.toHaveTextContent("Database is down");
  });

  test("names a record by the column its model declares", async () => {
    renderTable({
      modelType: NetworkEndpoint,
      columnField: "ipAddress",
      singularName: "Endpoint",
      rows: [{ _id: "endpoint-1", ipAddress: "10.0.4.12", vendor: "Verifone" }],
    });

    const description: HTMLElement = await openRowDelete(0);

    expect(
      within(description).getByTestId("delete-confirmation-name"),
    ).toHaveTextContent(/^10\.0\.4\.12$/);
  });

  test("names the row that was clicked, not its neighbour", async () => {
    renderTable({
      modelType: NetworkDevice,
      columnField: "name",
      rows: makeDevices(3),
    });

    const description: HTMLElement = await openRowDelete(2);

    expect(
      within(description).getByTestId("delete-confirmation-name"),
    ).toHaveTextContent(/^core-router-3$/);
  });

  /*
   * A team member row carries the user's name, but deleting it only takes the
   * user off the team: "delete Jane Doe" would say something else entirely.
   */
  test("does not name a relationship by what it points at", async () => {
    renderTable({
      modelType: TeamMember,
      columnField: "user",
      singularName: "Team Member",
      rows: [
        {
          _id: "member-1",
          user: { name: "Jane Doe", email: "jane@example.com" },
        },
      ],
    });

    const description: HTMLElement = await openRowDelete(0);

    expect(description).toHaveTextContent(
      "Are you sure you want to delete this team member? This action cannot be undone.",
    );
    expect(description).not.toHaveTextContent("Jane");
  });

  test("shortens a very long name, and shows the whole of it on hover", async () => {
    const longName: string = `router-${"x".repeat(300)}`;

    renderTable({
      modelType: NetworkDevice,
      columnField: "name",
      rows: [{ _id: "device-1", name: longName }],
    });

    const description: HTMLElement = await openRowDelete(0);
    const name: HTMLElement = within(description).getByTestId(
      "delete-confirmation-name",
    );

    expect(Array.from(name.textContent || "")).toHaveLength(
      MAX_DISPLAY_NAME_LENGTH,
    );
    expect(name.textContent?.endsWith("…")).toBe(true);
  });

  test("draws a name with markup in it as text", async () => {
    renderTable({
      modelType: NetworkDevice,
      columnField: "name",
      rows: [{ _id: "device-1", name: "<img src=x onerror=alert(1)>" }],
    });

    const description: HTMLElement = await openRowDelete(0);

    expect(description.querySelector("img")).toBeNull();
    expect(
      within(description).getByTestId("delete-confirmation-name"),
    ).toHaveTextContent("<img src=x onerror=alert(1)>");
  });
});

describe("a bulk Delete", () => {
  test("names the selected records under the count", async () => {
    const description: HTMLElement = await startBulkDelete(
      { modelType: NetworkDevice, columnField: "name", rows: makeDevices(3) },
      3,
    );

    expect(description).toHaveTextContent(
      "Are you sure you want to delete 3 Network Devices? This action cannot be undone.",
    );
    expect(listedNames()).toEqual([
      "core-router-1",
      "core-router-2",
      "core-router-3",
    ]);
    expect(screen.queryByTestId("delete-confirmation-more-items")).toBeNull();
  });

  test("names the first five and counts the rest", async () => {
    await startBulkDelete(
      { modelType: NetworkDevice, columnField: "name", rows: makeDevices(9) },
      9,
    );

    expect(listedNames()).toEqual([
      "core-router-1",
      "core-router-2",
      "core-router-3",
      "core-router-4",
      "core-router-5",
    ]);
    expect(
      screen.getByTestId("delete-confirmation-more-items"),
    ).toHaveTextContent("and 4 more");
  });

  test("lists only what it is about to delete", async () => {
    await startBulkDelete(
      { modelType: NetworkDevice, columnField: "name", rows: makeDevices(4) },
      2,
    );

    expect(listedNames()).toEqual(["core-router-1", "core-router-2"]);
  });

  test("lists nothing, only the count, when the rows have no name", async () => {
    const description: HTMLElement = await startBulkDelete(
      {
        modelType: TeamMember,
        columnField: "user",
        singularName: "Team Member",
        pluralName: "Team Members",
        rows: [
          { _id: "member-1", user: { name: "Jane Doe" } },
          { _id: "member-2", user: { name: "Raj Patel" } },
        ],
      },
      2,
    );

    expect(description).toHaveTextContent(
      "Are you sure you want to delete 2 Team Members?",
    );
    expect(screen.queryByTestId("delete-confirmation-items")).toBeNull();
  });

  test("keeps the list inside the dialog it belongs to", async () => {
    await startBulkDelete(
      { modelType: NetworkDevice, columnField: "name", rows: makeDevices(2) },
      2,
    );

    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");
    const dialog: HTMLElement = dialogs[dialogs.length - 1]!;

    expect(
      within(dialog).getByTestId("delete-confirmation-items"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Delete");
  });

  test("names them for a table whose delete is called something else", async () => {
    await startBulkDelete(
      {
        modelType: NetworkDevice,
        columnField: "name",
        rows: makeDevices(2),
        deleteVerb: "Unlink",
      },
      2,
      "Unlink",
    );

    expect(listedNames()).toEqual(["core-router-1", "core-router-2"]);
  });

  test("names them alongside the table's own warning", async () => {
    const description: HTMLElement = await startBulkDelete(
      {
        modelType: NetworkDevice,
        columnField: "name",
        rows: makeDevices(2),
        deleteConfirmationWarning: "Their interfaces are deleted too.",
      },
      2,
    );

    expect(description).toHaveTextContent("Their interfaces are deleted too.");
    expect(listedNames()).toEqual(["core-router-1", "core-router-2"]);
  });
});
