import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
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

configure({ asyncUtilTimeout: 15000 });

/*
 * A bulk Delete that empties the page it was started on.
 *
 * Select every row of the last page, Delete, Close: the table used to read
 * the same page again - now past the end - and draw an empty table under
 * "Showing 21-20 of 20", as if everything were gone. It now goes to the last
 * page that has rows. A Delete that leaves rows on its page stays there, and
 * only a bulk action's end does this: an ordinary reload of an empty page is
 * left as it is.
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
        return false;
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
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

type Row = {
  _id: string;
  name: string;
};

// The project's status pages, as the server holds them.
let stored: Array<Row> = [];
let reads: Array<{ skip: number; limit: number }> = [];

const pageNames: (count: number) => Array<Row> = (
  count: number,
): Array<Row> => {
  const rows: Array<Row> = [];
  for (let index: number = 1; index <= count; index++) {
    rows.push({
      _id: `page-${index}`,
      name: `Status Page ${String(index).padStart(2, "0")}`,
    });
  }
  return rows;
};

const makeProps: () => BaseModelTableProps<StatusPage> =
  (): BaseModelTableProps<StatusPage> => {
    const callbacks: BaseTableCallbacks<StatusPage> = {
      deleteItem: async (item: StatusPage): Promise<void> => {
        const id: string = String((item as unknown as Row)._id);
        stored = stored.filter((row: Row): boolean => {
          return row._id !== id;
        });
      },
      getModelFromJSON: (item: JSONObject): StatusPage => {
        return item as unknown as StatusPage;
      },
      getJSONFromModel: (item: StatusPage): JSONObject => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown): unknown => {
        return select;
      },
      getList: async (data: {
        skip: number;
        limit: number;
      }): Promise<ListResult<StatusPage>> => {
        reads.push({ skip: data.skip, limit: data.limit });

        return {
          data: stored.slice(
            data.skip,
            data.skip + data.limit,
          ) as unknown as Array<StatusPage>,
          count: stored.length,
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
    } as unknown as BaseTableCallbacks<StatusPage>;

    return {
      modelType: StatusPage,
      id: "status-pages-table",
      name: "Status Pages",
      urlStateKey: "status-pages-paging-table",
      initialItemsOnPage: 10,
      columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
      filters: [],
      cardProps: {
        title: "Status Pages",
        description: "Every status page in this project",
      },
      isCreateable: false,
      isEditable: false,
      isDeleteable: true,
      isViewable: false,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<StatusPage>;
  };

const rowCheckbox: (name: string) => HTMLInputElement = (
  name: string,
): HTMLInputElement => {
  return screen
    .getByText(name)
    .closest("tr")!
    .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
};

const goToNextPage: () => Promise<void> = async (): Promise<void> => {
  fireEvent.click(screen.getAllByTestId("pagination-next-button")[0]!);
};

const bulkDeleteSelection: () => Promise<void> = async (): Promise<void> => {
  fireEvent.click(await screen.findByText("Bulk Actions"));

  const deleteItem: HTMLElement = await waitFor((): HTMLElement => {
    const item: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === "Delete";
    });

    if (!item) {
      throw new Error("No Delete in Bulk Actions yet");
    }

    return item;
  });

  fireEvent.click(deleteItem);

  // The confirmation, then the result.
  fireEvent.click(await screen.findByTestId("modal-footer-submit-button"));
  await screen.findByText("Completed");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
};

beforeEach(() => {
  permissionsForTest = [Permission.ProjectOwner];
  stored = [];
  reads = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/pages");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a bulk Delete that empties the page it was started on", () => {
  test("goes to the last page that has rows, never drawing the empty one", async () => {
    stored = pageNames(12);

    render(<BaseModelTable<StatusPage> {...makeProps()} />);

    await screen.findByText("Status Page 01");
    await goToNextPage();
    await screen.findByText("Status Page 11");

    fireEvent.click(rowCheckbox("Status Page 11"));
    fireEvent.click(rowCheckbox("Status Page 12"));

    await bulkDeleteSelection();

    // Page 1, with its ten rows.
    await screen.findByText("Status Page 01");
    expect(screen.getByText("Status Page 10")).toBeInTheDocument();
    expect(screen.queryByText("Status Page 11")).toBeNull();
    expect(stored.length).toBe(10);

    // The read after the delete found page 2 empty; the next one is page 1.
    const lastTwo: Array<{ skip: number; limit: number }> = reads.slice(-2);
    expect(lastTwo).toEqual([
      { skip: 10, limit: 10 },
      { skip: 0, limit: 10 },
    ]);
  });

  test("a Delete that leaves rows on its page stays on that page", async () => {
    stored = pageNames(13);

    render(<BaseModelTable<StatusPage> {...makeProps()} />);

    await screen.findByText("Status Page 01");
    await goToNextPage();
    await screen.findByText("Status Page 11");

    fireEvent.click(rowCheckbox("Status Page 11"));

    await bulkDeleteSelection();

    await waitFor(() => {
      expect(screen.queryByText("Status Page 11")).toBeNull();
    });

    // Still page 2: the rows that were after the deleted one.
    expect(screen.getByText("Status Page 12")).toBeInTheDocument();
    expect(screen.getByText("Status Page 13")).toBeInTheDocument();
    expect(screen.queryByText("Status Page 01")).toBeNull();
    expect(reads[reads.length - 1]).toEqual({ skip: 10, limit: 10 });
  });

  test("a delete that empties page 1 shows the empty list", async () => {
    stored = pageNames(2);

    render(<BaseModelTable<StatusPage> {...makeProps()} />);

    await screen.findByText("Status Page 01");

    fireEvent.click(rowCheckbox("Status Page 01"));
    fireEvent.click(rowCheckbox("Status Page 02"));

    await bulkDeleteSelection();

    await waitFor(() => {
      expect(screen.queryByText("Status Page 01")).toBeNull();
    });

    expect(stored).toEqual([]);
    expect(reads[reads.length - 1]).toEqual({ skip: 0, limit: 10 });
  });
});
