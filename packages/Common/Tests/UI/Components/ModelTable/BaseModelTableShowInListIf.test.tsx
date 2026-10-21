import "@testing-library/jest-dom";
import {
  cleanup,
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

/*
 * A column that is drawn on an item's card only when the item has
 * something for it (Column.showInListIf).
 *
 * A ModelTable shown as a list draws each item as a card, one row per
 * column, label over value. A column the item has nothing for - a rule
 * without a description, a setting the item does not use - drew its label
 * over nothing ("Rule Description", and below it, nothing at all). The
 * column can say when its row belongs on a card; a table keeps every
 * column for every row, so it does not read it.
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
  ShowAs,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const TABLE_ID: string = "show-in-list-if";

const ROWS: Array<JSONObject> = [
  {
    _id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
    name: "Checkout API",
    description: "Payments",
  },
  {
    _id: "2a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
    name: "Status page",
    description: "",
  },
];

function columns(withCondition: boolean): Columns<Monitor> {
  return [
    { field: { name: true }, title: "Name", type: FieldType.Text },
    {
      field: { description: true },
      title: "Description",
      type: FieldType.Text,
      ...(withCondition
        ? {
            showInListIf: (item: Monitor): boolean => {
              return Boolean(item.description);
            },
          }
        : {}),
    },
  ];
}

function renderTable(data: { showAs: ShowAs; withCondition: boolean }): void {
  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (list: {
      skip: number;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      return {
        data: ROWS as unknown as Array<Monitor>,
        count: ROWS.length,
        skip: list.skip,
        limit: list.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  const props: BaseModelTableProps<Monitor> = {
    modelType: Monitor,
    id: TABLE_ID,
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: TABLE_ID,
    urlStateKey: TABLE_ID,
    columns: columns(data.withCondition),
    filters: [],
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    showAs: data.showAs,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;

  render(<BaseModelTable<Monitor> {...props} />);
}

// Each card of the list, and the names of its rows, top to bottom.
async function cardRowNames(): Promise<Array<Array<string>>> {
  await waitFor(() => {
    expect(document.getElementById(`${TABLE_ID}-body`)?.children.length).toBe(
      ROWS.length,
    );
  });

  return Array.from(document.getElementById(`${TABLE_ID}-body`)!.children).map(
    (card: Element): Array<string> => {
      return Array.from(card.querySelectorAll("label")).map(
        (label: HTMLLabelElement): string => {
          return (label.textContent || "").trim();
        },
      );
    },
  );
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a column drawn on a card only when the item has something for it", () => {
  test("is left off the cards of the items it says no to", async () => {
    renderTable({ showAs: ShowAs.List, withCondition: true });

    expect(await cardRowNames()).toEqual([["Name", "Description"], ["Name"]]);
    expect(screen.getByText("Payments")).toBeVisible();
  });

  test("without the condition, every card has every row, as before", async () => {
    renderTable({ showAs: ShowAs.List, withCondition: false });

    expect(await cardRowNames()).toEqual([
      ["Name", "Description"],
      ["Name", "Description"],
    ]);
  });

  test("a table keeps the column for every row", async () => {
    renderTable({ showAs: ShowAs.Table, withCondition: true });

    // Both rows, once the list has loaded.
    expect(await screen.findByText("Checkout API")).toBeVisible();

    const table: HTMLElement = screen.getByRole("table");

    expect(
      within(table).getByRole("columnheader", { name: /Description/ }),
    ).toBeInTheDocument();
    expect(within(table).getByText("Payments")).toBeVisible();
    // The second row is there, with its (empty) description cell.
    expect(within(table).getByText("Status page")).toBeVisible();
  });
});
