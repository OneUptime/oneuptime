import "@testing-library/jest-dom";
import {
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

/*
 * A list that turns its rows on and off asks the shared table for it
 * (ModelTable's rowSwitch): each row's ⋯ menu offers the one of Enable and
 * Disable that changes the row, first, ahead of the table's own actions.
 * The table reads the switch with the rows - a list need not show it as a
 * column - writes it through the list's own API, and reads its rows again
 * once it is saved.
 *
 * The real ModelTable is rendered, with its API layer injected.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
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

import ModelTable from "../../../../UI/Components/ModelTable/ModelTable";
import { getBulkSwitchConsequence } from "../../../../UI/Components/BulkUpdate/BulkSwitchConsequences";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const ENABLED_ID: string = "11111111-1111-4111-8111-111111111111";
const DISABLED_ID: string = "11111111-1111-4111-8111-111111111112";

interface Read {
  select: JSONObject;
}

interface Write {
  id: string;
  data: JSONObject;
}

let reads: Array<Read> = [];
let writes: Array<Write> = [];
// The switch as the server holds it, so a read after a write sees it.
let stored: Record<string, boolean> = {};

function makeModelAPI(): typeof ModelAPI {
  return {
    getList: async (data: {
      skip: number;
      limit: number;
      select: JSONObject;
    }): Promise<ListResult<Workflow>> => {
      reads.push({ select: data.select });

      const rows: Array<Workflow> = [
        [ENABLED_ID, "Nightly backup"],
        [DISABLED_ID, "Weekly digest"],
      ].map(([id, name]: Array<string>) => {
        const row: Workflow = new Workflow();
        row._id = id!;
        row.name = name!;
        row.isEnabled = stored[id!]!;

        return row;
      });

      return {
        data: rows,
        count: rows.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    updateById: async (data: {
      id: { toString: () => string };
      data: JSONObject;
    }): Promise<void> => {
      writes.push({ id: data.id.toString(), data: data.data });
      stored[data.id.toString()] = data.data["isEnabled"] as boolean;
    },
    getItem: async (): Promise<null> => {
      return null;
    },
  } as unknown as typeof ModelAPI;
}

function renderTable(withSwitch: boolean): void {
  render(
    <ModelTable<Workflow>
      modelType={Workflow}
      modelAPI={makeModelAPI()}
      id="workflows-row-switch"
      name="Workflows"
      singularName="Workflow"
      pluralName="Workflows"
      userPreferencesKey="workflows-row-switch"
      isCreateable={false}
      isEditable={true}
      isDeleteable={true}
      isViewable={false}
      showViewIdButton={true}
      cardProps={{ title: "Workflows", description: "Workflows" }}
      filters={[]}
      // The list does not show the switch; the table reads it anyway.
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
      ]}
      {...(withSwitch ? { rowSwitch: { column: "isEnabled" } } : {})}
    />,
  );
}

const rowActions: () => Promise<Array<HTMLElement>> = async (): Promise<
  Array<HTMLElement>
> => {
  await waitFor(() => {
    expect(screen.getAllByTestId("row-actions")).toHaveLength(2);
  });

  return screen.getAllByTestId("row-actions");
};

const menuOf: (row: HTMLElement) => HTMLElement = (
  row: HTMLElement,
): HTMLElement => {
  fireEvent.click(within(row).getByTestId("row-actions-more-button"));

  return screen.getByRole("menu");
};

const menuLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

beforeEach(() => {
  reads = [];
  writes = [];
  stored = { [ENABLED_ID]: true, [DISABLED_ID]: false };
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/workflows");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("ModelTable's rowSwitch", () => {
  test("reads the switch with the rows, though the list does not show it", async () => {
    renderTable(true);

    await rowActions();

    expect(reads[0]!.select["isEnabled"]).toBe(true);
  });

  test("offers each row the one that changes it, first in its ⋯ menu", async () => {
    renderTable(true);

    const [enabled, disabled] = await rowActions();

    // Edit stays the row's button.
    expect(
      within(enabled!).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(menuLabels(menuOf(enabled!))).toEqual([
      "Disable",
      "Show ID",
      "Delete",
    ]);

    // The first row's menu closes as the second's trigger is pressed.
    fireEvent.click(within(enabled!).getByTestId("row-actions-more-button"));

    expect(menuLabels(menuOf(disabled!))).toEqual([
      "Enable",
      "Show ID",
      "Delete",
    ]);
  });

  test("writes the row's switch through the list's API, after its question, and reads the rows again", async () => {
    renderTable(true);

    const [enabled] = await rowActions();
    const readsBefore: number = reads.length;

    fireEvent.click(
      within(menuOf(enabled!)).getByRole("menuitem", { name: "Disable" }),
    );

    expect(screen.getByTestId("row-switch-consequence")).toHaveTextContent(
      getBulkSwitchConsequence({
        tableName: "Workflow",
        column: "isEnabled",
        value: false,
      }),
    );

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(reads.length).toBe(readsBefore + 1);
    });
    expect(writes).toEqual([{ id: ENABLED_ID, data: { isEnabled: false } }]);

    // Read again, the row offers the other side.
    const rows: Array<HTMLElement> = await rowActions();

    await waitFor(() => {
      expect(menuLabels(menuOf(rows[0]!))[0]).toBe("Enable");
    });
  });

  test("a list that does not ask for it offers neither", async () => {
    renderTable(false);

    const [enabled] = await rowActions();

    expect(menuLabels(menuOf(enabled!))).toEqual(["Show ID", "Delete"]);
    expect(reads[0]!.select["isEnabled"]).toBeUndefined();
  });
});
