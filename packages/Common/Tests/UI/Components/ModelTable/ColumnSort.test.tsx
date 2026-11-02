import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
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

/*
 * A column that draws its own thing from a record's id - its owners - is
 * keyed by the id only because it needs one, and sorted, it ordered the list
 * by the id: a random order under the name "Owners". Some sixty lists'
 * Owners headers sorted so, and a list drawn as cards offered "Sort by
 * Owners" in the band over them (TableCardsHeader). Such a column does not
 * sort; one that shows the id itself still does.
 */

// A real BaseModelTable mounts a card, a header and a table before its row.
configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
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
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
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
import ModelTableColumn from "../../../../UI/Components/ModelTable/Column";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import { isDrawnFromRecordId } from "../../../../UI/Components/ModelTable/ColumnSort";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const OWNERS: ModelTableColumn<Monitor> = {
  field: { _id: true },
  title: "Owners",
  type: FieldType.Element,
  getElement: (): ReactElement => {
    return <span data-testid="cell-owners">Ada Lovelace</span>;
  },
} as unknown as ModelTableColumn<Monitor>;

const MONITOR_ID: ModelTableColumn<Monitor> = {
  field: { _id: true },
  title: "Monitor ID",
  type: FieldType.ObjectID,
} as unknown as ModelTableColumn<Monitor>;

const NAME: ModelTableColumn<Monitor> = {
  field: { name: true },
  title: "Name",
  type: FieldType.Element,
  getElement: (): ReactElement => {
    return <span data-testid="cell-name">api-gateway</span>;
  },
} as unknown as ModelTableColumn<Monitor>;

describe("isDrawnFromRecordId", () => {
  test("a column that draws its own thing from the record's id", () => {
    expect(isDrawnFromRecordId<Monitor>(OWNERS, "_id")).toBe(true);
  });

  test("not a column that shows the id itself", () => {
    expect(isDrawnFromRecordId<Monitor>(MONITOR_ID, "_id")).toBe(false);
  });

  test("not a column that draws a field of the record", () => {
    expect(isDrawnFromRecordId<Monitor>(NAME, "name")).toBe(false);
    expect(isDrawnFromRecordId<Monitor>(NAME, null)).toBe(false);
  });
});

describe("a list's headers sort by what they show", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async () => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject) => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor) => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown) => {
      return select;
    },
    getList: async (data: { limit: number }): Promise<ListResult<Monitor>> => {
      return {
        data: [
          {
            _id: "8a3e36cc-1b1f-4f4b-9a63-38e1f0b7c111",
            name: "api-gateway",
          } as unknown as Monitor,
        ],
        count: 1,
        skip: 0,
        limit: data.limit,
      };
    },
    toJSONArray: () => {
      return [];
    },
    updateById: async () => {
      return undefined;
    },
    showCreateEditModal: () => {
      return <></>;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  const renderTable: () => void = (): void => {
    const props: BaseModelTableProps<Monitor> = {
      modelType: Monitor,
      id: "monitors-table",
      name: "Monitors",
      userPreferencesKey: "monitors-id-column-sort",
      cardProps: { title: "Monitors" },
      columns: [NAME, OWNERS, MONITOR_ID] as Columns<Monitor>,
      filters: [],
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      disableUrlState: true,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<Monitor>;

    render(<BaseModelTable<Monitor> {...props} />);
  };

  const header: (title: string) => HTMLElement = (
    title: string,
  ): HTMLElement => {
    return screen.getByRole("columnheader", { name: title });
  };

  test("the Owners header does not sort - it would sort by the id - while a field's and the id's do", async () => {
    renderTable();

    await waitFor(() => {
      expect(screen.queryByTestId("cell-owners")).not.toBeNull();
    });

    expect(header("Owners")).not.toHaveAttribute("aria-sort");
    expect(
      header("Owners").querySelector('[data-testid="table-sort-hint"]'),
    ).toBeNull();

    expect(header("Name")).toHaveAttribute("aria-sort", "none");
    expect(header("Monitor ID")).toHaveAttribute("aria-sort", "none");
  });
});
