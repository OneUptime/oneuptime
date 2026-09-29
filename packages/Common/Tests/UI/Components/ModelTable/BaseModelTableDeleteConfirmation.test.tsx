import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Removing a user from a team is a per-row Delete on a TeamMember table, and
 * the table's own sentence for that was "Are you sure you want to delete this
 * ?" - the Teams tab passes a blank singularName so its create button reads
 * "Invite", and the dialog read it verbatim. Worse, no sentence the table can
 * build knows that deleting a user's last membership removes them from the
 * project.
 *
 * So the table now takes the wording from the caller when it has something to
 * say, and stops treating a blank name as a name when it does not. This file
 * pins both.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
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
  DeleteConfirmation,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const NAMED_ROWS: Array<JSONObject> = [
  { _id: "monitor-1", name: "Checkout API", description: "Payments" },
  { _id: "monitor-2", name: "Billing Worker", description: "Invoices" },
];

// Neither `name` nor `title` - like a TeamMember row, which names nothing.
const UNNAMED_ROWS: Array<JSONObject> = [
  { _id: "monitor-9", description: "No name on this one" },
];

interface TableOptions {
  rows?: Array<JSONObject> | undefined;
  singularName?: string | undefined;
  getDeleteConfirmation?:
    | ((item: Monitor) => Promise<DeleteConfirmation>)
    | undefined;
  onBeforeDelete?: ((item: Monitor) => Promise<Monitor>) | undefined;
  deleteItem?: MockFunction | undefined;
  /*
   * Hand the table real Monitor instances rather than bare JSON. Only needed
   * where a test goes all the way through the delete: BaseModelTable reads the
   * row's `id` getter before deleting, which plain objects do not have.
   */
  asModels?: boolean | undefined;
}

type MakePropsFunction = (
  options: TableOptions,
) => BaseModelTableProps<Monitor>;

const makeProps: MakePropsFunction = (
  options: TableOptions,
): BaseModelTableProps<Monitor> => {
  const rows: Array<JSONObject> = options.rows ?? NAMED_ROWS;

  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem:
      options.deleteItem ||
      (async (): Promise<void> => {
        return undefined;
      }),
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      return {
        data: options.asModels
          ? rows.map((row: JSONObject) => {
              return Monitor.fromJSONObject(row, Monitor);
            })
          : (rows as unknown as Array<Monitor>),
        count: rows.length,
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
  } as unknown as BaseTableCallbacks<Monitor>;

  return {
    modelType: Monitor,
    id: "monitors-table",
    name: "Monitors",
    singularName:
      options.singularName === undefined ? "Monitor" : options.singularName,
    pluralName: "Monitors",
    userPreferencesKey: "monitors-delete-confirmation-table",
    urlStateKey: "monitors-delete-confirmation-table",
    columns: [
      {
        field: { name: true },
        title: "Name",
        type: FieldType.Text,
      },
      {
        field: { description: true },
        title: "Description",
        type: FieldType.LongText,
      },
    ],
    filters: [],
    cardProps: { title: "Monitors", description: "All monitors" },
    isCreateable: false,
    isEditable: false,
    isDeleteable: true,
    isViewable: false,
    deleteButtonText: "Remove",
    getDeleteConfirmation: options.getDeleteConfirmation,
    onBeforeDelete: options.onBeforeDelete,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;
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

type ClickRemoveFunction = (rowIndex: number) => Promise<void>;

const clickRemove: ClickRemoveFunction = async (
  rowIndex: number,
): Promise<void> => {
  await waitFor(() => {
    expect(findButtons("Remove").length).toBeGreaterThan(rowIndex);
  });

  fireEvent.click(findButtons("Remove")[rowIndex]!);
};

type RenderTableFunction = (options?: TableOptions) => void;

const renderTable: RenderTableFunction = (options?: TableOptions): void => {
  render(<BaseModelTable<Monitor> {...makeProps(options || {})} />);
};

const waitForDialog: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    return await waitFor(() => {
      return screen.getByTestId("confirm-modal-description");
    });
  };

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("getDeleteConfirmation", () => {
  test("replaces the title, the sentence and the button", async () => {
    renderTable({
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        return {
          title: "Remove from Team and Project",
          description:
            "This is their only team in this project, so they will also be removed from the project.",
          submitButtonText: "Remove from Team and Project",
        };
      },
    });

    await clickRemove(0);

    expect(await waitForDialog()).toHaveTextContent(
      "This is their only team in this project, so they will also be removed from the project.",
    );
    expect(
      screen.getByTestId("confirm-modal-description"),
    ).not.toHaveTextContent("Are you sure you want to delete");
    expect(
      screen.getAllByText("Remove from Team and Project").length,
    ).toBeGreaterThanOrEqual(2); // the title and the button
    expect(findButtons("Remove from Team and Project")).toHaveLength(1);
    expect(findButtons("Delete")).toHaveLength(0);
  });

  test("is asked about the row that was clicked", async () => {
    const getDeleteConfirmation: MockFunction = getJestMockFunction();
    getDeleteConfirmation.mockImplementation(
      async (item: Monitor): Promise<DeleteConfirmation> => {
        return {
          description: `About ${(item as unknown as JSONObject)["name"]}`,
        };
      },
    );

    renderTable({ getDeleteConfirmation: getDeleteConfirmation });

    await clickRemove(1);

    expect(await waitForDialog()).toHaveTextContent("About Billing Worker");
    expect(getDeleteConfirmation).toHaveBeenCalledTimes(1);
    expect(
      (getDeleteConfirmation.mock.calls[0]![0] as unknown as JSONObject)["_id"],
    ).toBe("monitor-2");
  });

  test("keeps the table's title and button when only a sentence is supplied", async () => {
    renderTable({
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        return { description: "Custom sentence." };
      },
    });

    await clickRemove(0);

    expect(await waitForDialog()).toHaveTextContent("Custom sentence.");
    expect(screen.getByText("Delete Monitor")).toBeInTheDocument();
    expect(findButtons("Delete")).toHaveLength(1);
  });

  test("accepts an element as well as a string", async () => {
    renderTable({
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        return {
          description: <span data-testid="custom-element">Rich text</span>,
        };
      },
    });

    await clickRemove(0);
    await waitForDialog();

    expect(screen.getByTestId("custom-element")).toHaveTextContent("Rich text");
  });

  test("confirming still deletes the row that was clicked", async () => {
    const deleteItem: MockFunction = getJestMockFunction();
    deleteItem.mockResolvedValue(undefined);

    renderTable({
      asModels: true,
      deleteItem: deleteItem,
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        return {
          description: "Sure?",
          submitButtonText: "Remove from Team",
        };
      },
    });

    await clickRemove(1);
    await waitForDialog();

    fireEvent.click(findButtons("Remove from Team")[0]!);

    await waitFor(() => {
      expect(deleteItem).toHaveBeenCalledTimes(1);
    });

    expect((deleteItem.mock.calls[0]![0] as Monitor).id?.toString()).toBe(
      "monitor-2",
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });
  });

  test("cancelling deletes nothing", async () => {
    const deleteItem: MockFunction = getJestMockFunction();
    deleteItem.mockResolvedValue(undefined);

    renderTable({
      deleteItem: deleteItem,
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        return { description: "Sure?" };
      },
    });

    await clickRemove(0);
    await waitForDialog();

    fireEvent.click(findButtons("Cancel")[0]!);

    await waitFor(() => {
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });
    expect(deleteItem).not.toHaveBeenCalled();
  });

  /*
   * The dialog is shared across rows. A second click must not reopen it with
   * the first row's consequences - "they will be removed from the project"
   * shown for someone who will not be is the worst thing this can get wrong.
   */
  test("does not carry one row's wording over to the next", async () => {
    renderTable({
      getDeleteConfirmation: async (
        item: Monitor,
      ): Promise<DeleteConfirmation> => {
        return {
          description: `About ${(item as unknown as JSONObject)["name"]}`,
        };
      },
    });

    await clickRemove(0);
    expect(await waitForDialog()).toHaveTextContent("About Checkout API");

    fireEvent.click(findButtons("Cancel")[0]!);
    await waitFor(() => {
      expect(
        screen.queryByTestId("confirm-modal-description"),
      ).not.toBeInTheDocument();
    });

    await clickRemove(1);
    expect(await waitForDialog()).toHaveTextContent("About Billing Worker");
    expect(
      screen.getByTestId("confirm-modal-description"),
    ).not.toHaveTextContent("Checkout API");
  });

  test("runs after onBeforeDelete, on the row it returned", async () => {
    const order: Array<string> = [];

    renderTable({
      onBeforeDelete: async (item: Monitor): Promise<Monitor> => {
        order.push("onBeforeDelete");
        return {
          ...(item as unknown as JSONObject),
          name: "Adjusted",
        } as unknown as Monitor;
      },
      getDeleteConfirmation: async (
        item: Monitor,
      ): Promise<DeleteConfirmation> => {
        order.push("getDeleteConfirmation");
        return {
          description: `About ${(item as unknown as JSONObject)["name"]}`,
        };
      },
    });

    await clickRemove(0);

    expect(await waitForDialog()).toHaveTextContent("About Adjusted");
    expect(order).toEqual(["onBeforeDelete", "getDeleteConfirmation"]);
  });

  /*
   * If the table cannot find out what a removal will do, it must not fall back
   * to its vague default and let the user confirm blind.
   */
  test("does not open the dialog when the wording cannot be worked out, and says why", async () => {
    const deleteItem: MockFunction = getJestMockFunction();
    deleteItem.mockResolvedValue(undefined);

    renderTable({
      deleteItem: deleteItem,
      getDeleteConfirmation: async (): Promise<DeleteConfirmation> => {
        throw new Error("Could not load this user's teams.");
      },
    });

    await clickRemove(0);

    await waitFor(() => {
      expect(
        screen.getByText("Could not load this user's teams."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Delete Monitor")).not.toBeInTheDocument();
    expect(screen.queryByText(/Are you sure you want to delete/)).toBeNull();
    expect(deleteItem).not.toHaveBeenCalled();
  });

  test("leaves the default dialog alone when not supplied", async () => {
    renderTable();

    await clickRemove(1);

    expect(await waitForDialog()).toHaveTextContent(
      'Are you sure you want to delete "Billing Worker"? This action cannot be undone.',
    );
    expect(screen.getByText("Delete Monitor")).toBeInTheDocument();
  });
});

describe("a blank singularName", () => {
  // The exact sentence from the bug report.
  test('no longer produces "delete this  ?"', async () => {
    renderTable({ rows: UNNAMED_ROWS, singularName: " " });

    await clickRemove(0);

    const description: HTMLElement = await waitForDialog();

    expect(description.textContent).not.toMatch(/this\s+\?/);
    expect(description).toHaveTextContent(
      "Are you sure you want to delete this monitor?",
    );
  });

  test("falls back to the model's name in the title too", async () => {
    renderTable({ rows: UNNAMED_ROWS, singularName: "   " });

    await clickRemove(0);
    await waitForDialog();

    expect(screen.getByText("Delete Monitor")).toBeInTheDocument();
  });

  test("an empty string behaves the same", async () => {
    renderTable({ rows: UNNAMED_ROWS, singularName: "" });

    await clickRemove(0);

    expect(await waitForDialog()).toHaveTextContent(
      "Are you sure you want to delete this monitor?",
    );
  });
});
