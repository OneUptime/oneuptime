import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import CappedListServer from "../../App/Dashboard/CappedListServer";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";
import { DropdownValue } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import { withSearchIn } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN ENTITY DROPDOWN THAT HOLDS ANOTHER COLUMN THAN THE RECORD'S ID (#10646).
 *
 * A telemetry monitor filters on inventory items by their entityKey, an
 * OpenStack budget on a project by the cloud's own id for it (externalId),
 * a metric picker on a metric by its name. EntityDropdown read and
 * resolved by `_id` alone: a search's options carried each record's id as
 * their value, and a value held was looked up as an id, so neither named
 * it. Now, opt in, backwards compatible:
 *
 *   - valueField is read from each record (search and look-up both select
 *     it), and a held value is read by it, within heldValueQuery;
 *   - searchFields: the columns the reader's search looks in;
 *   - descriptionField: a column drawn beside each option's name.
 *
 * A dropdown by id with none of them reads exactly as it did.
 */

const ITEM_ID: string = "11111111-0000-4000-8000-000000000001";
const OTHER_ITEM_ID: string = "11111111-0000-4000-8000-000000000002";
const POD_KEY: string = "k8s.pod/checkout-7d9f";
const NODE_KEY: string = "k8s.node/ip-10-0-0-1";

let server: CappedListServer;
let onChange: MockFunction;

beforeEach(() => {
  server = new CappedListServer();
  server.add(InventoryItem, [
    {
      _id: ITEM_ID,
      entityKey: POD_KEY,
      entityType: "Pod",
      displayName: "checkout-7d9f",
    },
    {
      _id: OTHER_ITEM_ID,
      entityKey: NODE_KEY,
      entityType: "Node",
      displayName: "",
    },
  ]);
  server.add(Monitor, [{ _id: ITEM_ID, name: "API" }]);
  server.install();
  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderInventoryPicker(data: {
  value: Array<string>;
  heldValueQuery?: Record<string, unknown> | undefined;
}): Promise<void> {
  await act(async () => {
    render(
      <EntityDropdown
        modelType={InventoryItem}
        isMultiSelect={true}
        labelField="displayName"
        valueField="entityKey"
        searchFields={["displayName", "entityKey"]}
        descriptionField="entityType"
        heldValueQuery={data.heldValueQuery}
        notFoundLabel="No longer available"
        value={data.value}
        dataTestId="inventory-picker"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          onChange(value);
        }}
      />,
    );
  });
}

function chips(): Array<string> {
  return screen
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

describe("a value held in another column than the id", () => {
  test("is read by that column, within heldValueQuery, and named", async () => {
    await renderInventoryPicker({
      value: [POD_KEY],
      heldValueQuery: { entityType: "Pod" },
    });

    await waitFor(() => {
      expect(chips()).toEqual(["checkout-7d9f"]);
    });

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = server.callsFor(InventoryItem)[0]!;

    expect(read.query["entityKey"]).toBeInstanceOf(Includes);
    expect((read.query["entityKey"] as Includes).values).toEqual([POD_KEY]);
    expect(read.query["entityType"]).toBe("Pod");
    // Never looked up as an id, which a key is not.
    expect(read.query["_id"]).toBeUndefined();
    expect(read.select["entityKey"]).toBe(true);
    expect(read.select["entityType"]).toBe(true);
  });

  test("one no record holds any more reads as not found, and stays until it is taken out", async () => {
    await renderInventoryPicker({ value: ["k8s.pod/gone-1234", POD_KEY] });

    await waitFor(() => {
      expect(chips()).toEqual(["No longer available", "checkout-7d9f"]);
    });
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith([POD_KEY]);
  });

  test("a record without a name reads as its value", async () => {
    await renderInventoryPicker({ value: [NODE_KEY] });

    await waitFor(() => {
      expect(chips()).toEqual([NODE_KEY]);
    });
  });
});

describe("the search", () => {
  test("looks in every search field, offers each record by its value, its description beside its name", async () => {
    await renderInventoryPicker({ value: [] });

    await act(async () => {
      fireEvent.focus(screen.getByTestId("inventory-picker"));
      fireEvent.change(screen.getByTestId("inventory-picker"), {
        target: { value: "ip-10" },
      });
    });

    // Found by its key: it has no name.
    const option: HTMLElement = await screen.findByRole("option", {
      name: /ip-10-0-0-1/,
    });

    expect(option).toHaveTextContent("Node");

    const search: Record<string, unknown> | undefined = server
      .callsFor(InventoryItem)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      })
      .find((query: Record<string, unknown>): boolean => {
        return Object.values(query).some((condition: unknown): boolean => {
          return condition instanceof MultiSearch;
        });
      });

    expect(search).toBeDefined();

    await act(async () => {
      fireEvent.click(option);
    });

    // The value is the record's entityKey, never its id.
    expect(onChange).toHaveBeenLastCalledWith([NODE_KEY]);
  });

  test("withSearchIn: one field is withSearch, several one MultiSearch kept beside the caller's conditions", () => {
    expect(withSearchIn({ projectId: "p" }, ["name"], " WB ")).toEqual({
      projectId: "p",
      name: new Search("WB"),
    });

    const query: Record<string, unknown> = withSearchIn(
      { displayName: "kept" },
      ["displayName", "entityKey"],
      "pod",
    );

    expect(query["displayName"]).toBe("kept");
    expect(
      Object.values(query).filter((condition: unknown): boolean => {
        return condition instanceof MultiSearch;
      }),
    ).toHaveLength(1);
    expect(withSearchIn({ a: 1 }, ["x", "y"], "  ")).toEqual({ a: 1 });
  });
});

describe("a dropdown by id, with none of the new props", () => {
  test("reads a held value by its id alone, as before", async () => {
    await act(async () => {
      render(
        <EntityDropdown
          modelType={Monitor}
          isMultiSelect={true}
          labelField="name"
          valueField="_id"
          value={[ITEM_ID]}
        />,
      );
    });

    await waitFor(() => {
      expect(chips()).toEqual(["API"]);
    });

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    } = server.callsFor(Monitor)[0]!;

    expect(Object.keys(read.query)).toEqual(["_id"]);
    expect(read.limit).toBe(1);
    // Its id and its name: no value column and no description to read.
    expect(Object.keys(read.select).sort()).toEqual(["_id", "name"]);
  });
});
