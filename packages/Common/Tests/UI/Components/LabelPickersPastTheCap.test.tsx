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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../App/Dashboard/CappedListServer";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import useBulkLabelActions, {
  BulkLabelActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkLabelActions";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { DropdownValue } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  BulkAddedLabel,
} from "../../../UI/Components/EntityDropdown/EntityDropdown";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "../../../UI/Components/EntityDropdown/EntityDropdownNotFound";
import { LABEL_SEARCH_PAGE_SIZE } from "../../../UI/Components/EntityDropdown/LabelSearch";
import EntityFilter from "../../../UI/Components/Filters/EntityFilter";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../UI/Components/Types/FieldType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE LABEL PICKERS AND A LIST'S ENTITY FILTER FIND AND KEEP EVERY RECORD,
 * HOWEVER MANY THE PROJECT HAS (#10646).
 *
 *   - EntityDropdown's Labels tab read the project's first 10,000 labels by
 *     name the first time it opened and filtered them in the browser: a
 *     label past them could never bulk-add what it tags.
 *   - Bulk "Add Labels" read the same 10,000 on mount: a label past them
 *     could not be added.
 *   - A list's "Filter by …" read the filter's first 10,000 records
 *     unsorted, and a filter restored from a link whose record was not
 *     among them showed blank.
 *
 * Each now searches the server as it is typed in, and reads what it holds
 * by its id. ModelAPI answers from a project faked whole (CappedListServer):
 * a read of the first N misses a late-sorting record just as the server
 * would, while a search, or a read by id, finds it.
 */

const LATE_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000ab";
const ARCHIVED_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000ac";
const DELETED_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000dd";
const KIOSK_MONITOR_ID: string = "d0000000-0000-4000-8000-0000000000a1";
const OTHER_KIOSK_MONITOR_ID: string = "d0000000-0000-4000-8000-0000000000a2";
const ITEM_ID: string = "d0000000-0000-4000-8000-0000000000b1";

const LABELS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

/*
 * Each search the fake answers sorts the whole project, more than 10,000
 * rows: on a loaded machine that outlasts the default second of waiting.
 */
configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Label,
    namesSortingFirst(LABELS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Label, [
    {
      _id: LATE_LABEL_ID,
      name: "WB1500KSK kiosks",
      color: "#6366f1",
      isArchived: false,
    },
    {
      _id: OTHER_LATE_LABEL_ID,
      name: "WB1500KSK lobby",
      color: "#22c55e",
      isArchived: false,
    },
    {
      _id: ARCHIVED_LABEL_ID,
      name: "WB1500KSK retired",
      color: "#94a3b8",
      isArchived: true,
    },
  ]);
  /*
   * The monitors the late label tags (the fake matches a label pick on the
   * one label a row names), and the item Add Labels is run on, which has
   * another label, read as a relation.
   */
  server.add(Monitor, [
    { _id: KIOSK_MONITOR_ID, name: "Kiosk 02", labels: LATE_LABEL_ID },
    { _id: OTHER_KIOSK_MONITOR_ID, name: "Kiosk 03", labels: LATE_LABEL_ID },
    {
      _id: ITEM_ID,
      name: "Lobby screen",
      labels: [Object.assign(new Label(), { _id: OTHER_LATE_LABEL_ID })],
    },
  ]);

  server.install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The reads of labels, in order.
function labelReads(): Array<CappedListCall> {
  return server.callsFor(Label);
}

describe("EntityDropdown's Labels tab", () => {
  let onChange: MockFunction;
  let onLabelsBulkAdded: MockFunction;

  beforeEach(() => {
    onChange = getJestMockFunction();
    onLabelsBulkAdded = getJestMockFunction();
  });

  async function openLabelsTab(): Promise<void> {
    render(
      <EntityDropdown
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        isMultiSelect={true}
        ariaLabel="Monitors"
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
        ): void => {
          onChange(value);
        }}
        onLabelsBulkAdded={(labels: Array<BulkAddedLabel>): void => {
          onLabelsBulkAdded(labels);
        }}
      />,
    );

    await act(async () => {
      fireEvent.focus(screen.getByRole("combobox"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));
    });
  }

  async function typeSearch(text: string): Promise<void> {
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: text },
      });
    });
  }

  test("lists 50 labels by name, says how many there are, and never reads the project's 10,000", async () => {
    await openLabelsTab();

    await waitFor(() => {
      expect(screen.getByTestId("entity-dropdown-more-labels")).toBeVisible();
    });

    expect(screen.getByTestId("entity-dropdown-more-labels")).toHaveTextContent(
      /Showing 50 of 10,053\. Type to narrow the list\./,
    );

    for (const call of labelReads()) {
      expect(call.limit).toBe(LABEL_SEARCH_PAGE_SIZE);
    }
  });

  test("finds a label past the project's first 10,000 by its name, on the server", async () => {
    await openLabelsTab();
    await typeSearch("WB1500KSK");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK kiosks/,
    });

    expect(option).toBeVisible();

    const searched: CappedListCall | undefined = labelReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "WB1500KSK",
    );
    expect(searched!.sort).toEqual({ name: SortOrder.Ascending });
  });

  test("bulk-adds every monitor the late label tags, and names the label even after the search moved on", async () => {
    await openLabelsTab();
    await typeSearch("WB1500KSK kiosks");

    const lateLabel: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK kiosks/,
    });

    await act(async () => {
      fireEvent.click(lateLabel);
    });

    // Another search, which does not find the picked label.
    await typeSearch("nothing called this");

    await waitFor(() => {
      expect(
        screen.getByTestId("entity-dropdown-no-matching-labels"),
      ).toHaveTextContent("No labels match “nothing called this”.");
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add entries from 1 label" }),
      );
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.calls[onChange.mock.calls.length - 1]![0]).toEqual([
      KIOSK_MONITOR_ID,
      OTHER_KIOSK_MONITOR_ID,
    ]);
    expect(onLabelsBulkAdded).toHaveBeenCalledWith([
      { id: LATE_LABEL_ID, name: "WB1500KSK kiosks" },
    ]);

    // The entries are read by the label, never the project's monitors whole.
    const byLabel: CappedListCall | undefined = server
      .callsFor(Monitor)
      .find((call: CappedListCall): boolean => {
        return call.query["labels"] instanceof Includes;
      });

    expect((byLabel!.query["labels"] as Includes).values).toEqual([
      LATE_LABEL_ID,
    ]);
  });
});

/*
 * Add Labels, driven through a component that draws the hook's modals, as a
 * list's bulk bar does.
 */
const BulkHarness: FunctionComponent = (): ReactElement => {
  const { bulkActions, modals }: BulkLabelActionsResult<Monitor> =
    useBulkLabelActions<Monitor>({ modelType: Monitor });

  return (
    <div>
      {bulkActions.map((action: BulkActionButtonSchema<Monitor>) => {
        return (
          <button
            key={action.title}
            type="button"
            onClick={() => {
              const item: Monitor = new Monitor();
              item._id = ITEM_ID;

              void action.onClick({
                items: [item],
                onProgressInfo: () => {},
                onBulkActionStart: () => {},
                onBulkActionEnd: () => {},
              } as unknown as BulkActionOnClickProps<Monitor>);
            }}
          >
            {`Trigger ${action.title}`}
          </button>
        );
      })}
      {modals}
    </div>
  );
};

describe("Bulk Add Labels", () => {
  test("reads no label until its picker opens, finds one past the 10,000th, and adds it", async () => {
    const updateById: MockFunction = getJestMockFunction();

    jest.spyOn(ModelAPI, "updateById").mockImplementation((async (
      data: unknown,
    ): Promise<unknown> => {
      updateById(data);
      return {};
    }) as never);

    render(<BulkHarness />);

    expect(labelReads()).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByText("Trigger Add Labels"));
    });

    await act(async () => {
      fireEvent.focus(await screen.findByRole("combobox"));
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "WB1500KSK" },
      });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK kiosks/,
    });

    // An archived label is never offered: nobody adds one to anything.
    expect(
      screen.queryByRole("option", { name: /WB1500KSK retired/ }),
    ).toBeNull();

    for (const call of labelReads()) {
      expect(call.query["isArchived"]).toBe(false);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }

    await act(async () => {
      fireEvent.click(option);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(updateById).toHaveBeenCalledTimes(1);
    });

    // The item's own label kept, the late one added.
    expect(
      (updateById.mock.calls[0]![0] as { data: { labels: Array<string> } }).data
        .labels,
    ).toEqual([OTHER_LATE_LABEL_ID, LATE_LABEL_ID]);
  });
});

describe("a list's entity filter that searches the server", () => {
  let onFilterChanged: MockFunction;

  beforeEach(() => {
    onFilterChanged = getJestMockFunction();
  });

  const LABELS_FILTER: Filter<Monitor> = {
    title: "Labels",
    key: "labels",
    type: FieldType.EntityArray,
    filterDropdownOptions: [],
    entitySearch: {
      modelType: Label,
      labelField: "name",
      valueField: "_id",
      query: {},
      notFoundLabel: ENTITY_DROPDOWN_NOT_FOUND_LABEL,
    },
  };

  function renderFilter(
    filterData: FilterData<Monitor>,
    filter: Filter<Monitor> = LABELS_FILTER,
  ): void {
    render(
      <EntityFilter<Monitor>
        filter={filter}
        filterData={filterData}
        onFilterChanged={(next: FilterData<Monitor>): void => {
          onFilterChanged(next);
        }}
      />,
    );
  }

  function chips(): Array<string> {
    return within(screen.getByTestId("entity-filter-search"))
      .queryAllByTestId("entity-dropdown-chip-label")
      .map((chip: HTMLElement): string => {
        return chip.textContent || "";
      });
  }

  test("names a held label past the 10,000th by its id, and one deleted since as No longer available", async () => {
    renderFilter({ labels: [LATE_LABEL_ID, DELETED_LABEL_ID] });

    await waitFor(() => {
      expect(chips()).toEqual(["WB1500KSK kiosks", "No longer available"]);
    });

    // Read by their ids: never the project's labels whole.
    for (const call of labelReads()) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }

    // Drawing the filter changes nothing it holds.
    expect(onFilterChanged).not.toHaveBeenCalled();

    // The one gone is taken out; the other stays.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    expect(onFilterChanged).toHaveBeenLastCalledWith({
      labels: [LATE_LABEL_ID],
    });
  });

  test("searches the server as it is typed in, keeping the filter's own query, archived labels offered and marked", async () => {
    renderFilter(
      {},
      {
        ...LABELS_FILTER,
        entitySearch: {
          ...LABELS_FILTER.entitySearch!,
          // The filter's own rule, kept in every search.
          query: { color: "#94a3b8" },
        },
      },
    );

    await act(async () => {
      fireEvent.focus(screen.getByRole("combobox"));
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "WB1500KSK" },
      });
    });

    const archived: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK retired/,
    });

    expect(
      within(archived).getByTestId("entity-dropdown-option-archived-tag"),
    ).toBeInTheDocument();
    // The others have another color: the filter's query kept them out.
    expect(
      screen.queryByRole("option", { name: /WB1500KSK kiosks/ }),
    ).toBeNull();

    const searched: CappedListCall | undefined = labelReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect(searched!.query["color"]).toBe("#94a3b8");
    // A filter lists archived values too: no archived condition is added.
    expect(searched!.query).not.toHaveProperty("isArchived");

    await act(async () => {
      fireEvent.click(archived);
    });

    expect(onFilterChanged).toHaveBeenLastCalledWith({
      labels: [ARCHIVED_LABEL_ID],
    });
  });

  test("a held value it was handed the name of is drawn at once, without reading it again", async () => {
    renderFilter(
      { labels: [LATE_LABEL_ID] },
      {
        ...LABELS_FILTER,
        filterDropdownOptions: [
          { value: LATE_LABEL_ID, label: "WB1500KSK kiosks" },
        ],
      },
    );

    expect(chips()).toEqual(["WB1500KSK kiosks"]);
    expect(labelReads()).toHaveLength(0);
  });
});
