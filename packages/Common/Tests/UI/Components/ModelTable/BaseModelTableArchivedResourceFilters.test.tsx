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
 * The signed-in user is a master admin unless a test says otherwise, as in
 * BaseModelTablePickersPastTheCap: who may read what is only the subject
 * of the tests that change it.
 */
const mockUser: { isMasterAdmin: boolean } = { isMasterAdmin: true };

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
        return mockUser.isMasterAdmin;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../../App/Dashboard/CappedListServer";
import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  isMarkingArchivedRecords,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Team from "../../../../Models/DatabaseModels/Team";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import Search from "../../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A LIST'S RESOURCE FILTERS MARK THE ARCHIVED RECORDS THEY OFFER (#10921).
 *
 * A list's entity filters marked archived records only for archivable
 * values - states, severities, labels - and for a filter that opted in (the
 * telemetry lists' Service filters, #10764). A resource such as a monitor
 * was offered unmarked: an archived "Checkout API" sat beside the live one
 * of the same name, with nothing to tell them apart. Every filter of a
 * model whose records carry an archive switch the reader may read marks
 * them now, wherever it offers or holds one: its search, a value restored
 * from a link, the chip. A filter can still say no. The list's reads are
 * answered by a project faked whole (CappedListServer), with more monitors
 * than a filter ever read.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

const LIVE_MONITOR_ID: string = "a0000000-0000-4000-8000-0000000000aa";
const ARCHIVED_MONITOR_ID: string = "a0000000-0000-4000-8000-0000000000ac";
const DELETED_MONITOR_ID: string = "a0000000-0000-4000-8000-0000000000dd";
const ARCHIVED_LABEL_ID: string = "e0000000-0000-4000-8000-0000000000ac";

const MONITORS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

const MONITORS_FILTER: Filter<Incident> = {
  title: "Monitors",
  type: FieldType.EntityArray,
  field: { monitors: { name: true } },
  filterEntityType: Monitor,
  filterQuery: {},
  filterDropdownField: { label: "name", value: "_id" },
} as unknown as Filter<Incident>;

let server: CappedListServer;

beforeEach(() => {
  mockUser.isMasterAdmin = true;
  server = new CappedListServer();

  server.add(
    Monitor,
    namesSortingFirst(MONITORS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Monitor, [
    { _id: LIVE_MONITOR_ID, name: "WB1500KSK checkout api" },
    {
      _id: ARCHIVED_MONITOR_ID,
      name: "WB1500KSK checkout api (old)",
      isArchived: true,
    },
  ]);
  server.add(Label, [
    {
      _id: ARCHIVED_LABEL_ID,
      name: "WB1500KSK retired label",
      color: "#6366f1",
      isArchived: true,
    },
  ]);

  window.history.replaceState(window.history.state, "", "/dashboard/incidents");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// A row as the server answers a read: its id and the columns selected.
function onlySelected(
  row: BaseModel,
  select: Record<string, unknown>,
): BaseModel {
  const answered: BaseModel = new (row.constructor as { new (): BaseModel })();
  const source: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  const target: Record<string, unknown> = answered as unknown as Record<
    string,
    unknown
  >;

  target["_id"] = source["_id"];

  for (const column of Object.keys(select)) {
    if (source[column] !== undefined) {
      target[column] = source[column];
    }
  }

  return answered;
}

function makeProps(
  filters: Array<Filter<Incident>>,
): BaseModelTableProps<Incident> {
  const callbacks: BaseTableCallbacks<Incident> = {
    deleteItem: async () => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject) => {
      return item as unknown as Incident;
    },
    getJSONFromModel: (item: Incident) => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown) => {
      return select;
    },
    /*
     * Every read of the list - its rows, its pickers - answered by the
     * fake, with only the columns the read selected, as the server answers:
     * a record's archive switch comes back only when it was asked for.
     */
    getList: async (data: unknown): Promise<ListResult<Incident>> => {
      const read: { select?: Record<string, unknown> } = data as {
        select?: Record<string, unknown>;
      };
      const page: ListResult<BaseModel> = server.list(
        data as never,
      ) as unknown as ListResult<BaseModel>;

      return {
        ...page,
        data: page.data.map((row: BaseModel): BaseModel => {
          return onlySelected(row, read.select || {});
        }),
      } as unknown as ListResult<Incident>;
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
  } as unknown as BaseTableCallbacks<Incident>;

  return {
    modelType: Incident,
    id: "incidents-table",
    name: "Incidents",
    singularName: "Incident",
    pluralName: "Incidents",
    userPreferencesKey: "incidents-table",
    columns: [{ field: { title: true }, title: "Title", type: FieldType.Text }],
    filters: filters,
    cardProps: { title: "Incidents", description: "All incidents" },
    isDeleteable: false,
    isCreateable: false,
    isViewable: false,
    isEditable: false,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Incident>;
}

function renderTable(filters: Array<Filter<Incident>>): void {
  render(<BaseModelTable<Incident> {...makeProps(filters)} />);
}

function monitorReads(): Array<CappedListCall> {
  return server.callsFor(Monitor);
}

async function openFilterPicker(title: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "More options" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));

  return await screen.findByPlaceholderText(`Filter by ${title}`);
}

async function search(picker: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: text } });
  });
}

function optionTexts(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

describe("a list's filter of a resource that can be archived", () => {
  test("its search finds a monitor past the 10,000th and marks the archived one, without the filter opting in", async () => {
    renderTable([MONITORS_FILTER]);

    const picker: HTMLElement = await openFilterPicker("Monitors");

    await search(picker, "WB1500KSK");

    await waitFor(() => {
      expect(optionTexts()).toEqual([
        "WB1500KSK checkout api",
        "WB1500KSK checkout api (old)Archived",
      ]);
    });

    const archived: HTMLElement = screen.getByRole("option", {
      name: /checkout api \(old\)/,
    });

    expect(
      within(archived).getByTestId("entity-dropdown-option-archived-tag"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("option", { name: /^WB1500KSK checkout api$/ }),
      ).queryByTestId("entity-dropdown-option-archived-tag"),
    ).toBeNull();

    // A page of the search, its archive switch read, archived ones offered.
    const searched: Array<CappedListCall> = monitorReads().filter(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect(searched.length).toBeGreaterThan(0);

    for (const call of searched) {
      expect(call.select["isArchived"]).toBe(true);
      expect(call.limit).toBeLessThanOrEqual(50);
      // A list's filter keeps archived records findable: never left out.
      expect(call.query["isArchived"]).toBeUndefined();
    }
  });

  test("an archived monitor picked from the search narrows the list by its id", async () => {
    renderTable([MONITORS_FILTER]);

    const picker: HTMLElement = await openFilterPicker("Monitors");

    await search(picker, "WB1500KSK");

    const archived: HTMLElement = await screen.findByRole("option", {
      name: /checkout api \(old\)/,
    });

    await act(async () => {
      fireEvent.click(archived);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(TableFilterUrlState.read("incidents-table", "filter")).toEqual({
        monitors: [ARCHIVED_MONITOR_ID],
      });
    });

    const rowReads: Array<CappedListCall> = server.callsFor(Incident);

    expect(
      (rowReads[rowReads.length - 1]!.query["monitors"] as Includes).values,
    ).toEqual([ARCHIVED_MONITOR_ID]);
  });

  test("restored from a link, an archived monitor past the 10,000th keeps its name, is read with its archive switch and survives, beside one deleted since", async () => {
    TableFilterUrlState.write("incidents-table", "filter", {
      monitors: [ARCHIVED_MONITOR_ID, DELETED_MONITOR_ID],
    });

    renderTable([MONITORS_FILTER]);

    await waitFor(() => {
      expect(
        screen
          .queryAllByTestId("applied-filter-chip")
          .map((chip: HTMLElement): string => {
            return chip.textContent || "";
          })
          .join(" | "),
      ).toMatch(
        /Monitors is any of: WB1500KSK checkout api \(old\), No longer available/,
      );
    });

    // Read by their ids, with the archive switch: never the first 10,000.
    const held: Array<CappedListCall> = monitorReads().filter(
      (call: CappedListCall): boolean => {
        return call.query["_id"] instanceof Includes;
      },
    );

    expect(held.length).toBeGreaterThan(0);

    for (const call of held) {
      expect(call.select["isArchived"]).toBe(true);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }

    // As the link saved it: the archived one and the one gone both kept.
    expect(TableFilterUrlState.read("incidents-table", "filter")).toEqual({
      monitors: [ARCHIVED_MONITOR_ID, DELETED_MONITOR_ID],
    });
  });

  test("a filter that says no keeps its records unmarked, and never reads their switch", async () => {
    renderTable([
      {
        ...MONITORS_FILTER,
        marksArchivedRecords: false,
      } as unknown as Filter<Incident>,
    ]);

    const picker: HTMLElement = await openFilterPicker("Monitors");

    await search(picker, "WB1500KSK");

    await waitFor(() => {
      expect(optionTexts()).toEqual([
        "WB1500KSK checkout api",
        "WB1500KSK checkout api (old)",
      ]);
    });

    for (const call of monitorReads()) {
      expect(call.select["isArchived"]).toBeUndefined();
    }
  });

  test("a reader who may not read the archive switch is never asked for it: the search still works, unmarked", async () => {
    mockUser.isMasterAdmin = false;
    jest.spyOn(PermissionGate, "canReadColumn").mockImplementation(((
      _model: unknown,
      column: string,
    ): boolean => {
      return column !== "isArchived";
    }) as never);

    renderTable([MONITORS_FILTER]);

    const picker: HTMLElement = await openFilterPicker("Monitors");

    await search(picker, "WB1500KSK");

    await waitFor(() => {
      expect(optionTexts()).toEqual([
        "WB1500KSK checkout api",
        "WB1500KSK checkout api (old)",
      ]);
    });

    // The server refuses a whole read that names a column it may not read.
    for (const call of monitorReads()) {
      expect(call.select["isArchived"]).toBeUndefined();
    }
  });
});

describe("which filters mark archived records", () => {
  const filterOf: (
    modelType: { new (): unknown },
    extra?: Partial<Filter<Incident>>,
  ) => Filter<Incident> = (
    modelType: { new (): unknown },
    extra?: Partial<Filter<Incident>>,
  ): Filter<Incident> => {
    return {
      title: "X",
      type: FieldType.EntityArray,
      field: { monitors: { name: true } },
      filterEntityType: modelType,
      filterDropdownField: { label: "name", value: "_id" },
      ...(extra || {}),
    } as unknown as Filter<Incident>;
  };

  test("a resource with the switch, read by a reader who may read it", () => {
    expect(isMarkingArchivedRecords(filterOf(Monitor))).toBe(true);
  });

  test("not a value - marked as a value - nor a model without the switch", () => {
    expect(isMarkingArchivedRecords(filterOf(Label))).toBe(false);
    expect(isMarkingArchivedRecords(filterOf(Team))).toBe(false);
  });

  test("what the filter says wins, either way", () => {
    expect(
      isMarkingArchivedRecords(
        filterOf(Monitor, { marksArchivedRecords: false }),
      ),
    ).toBe(false);
    expect(
      isMarkingArchivedRecords(filterOf(Team, { marksArchivedRecords: true })),
    ).toBe(true);
  });

  test("not for a reader who may not read the switch", () => {
    mockUser.isMasterAdmin = false;
    jest.spyOn(PermissionGate, "canReadColumn").mockReturnValue(false);

    expect(isMarkingArchivedRecords(filterOf(Monitor))).toBe(false);
  });

  test("not for a filter of something other than the database's records", () => {
    expect(
      isMarkingArchivedRecords(
        filterOf(class NotAModel {} as unknown as { new (): unknown }),
      ),
    ).toBe(false);
  });
});

describe("an archivable value's filter is marked as before", () => {
  test("an archived label is offered marked, with no opt-in", async () => {
    renderTable([
      {
        title: "Labels",
        type: FieldType.EntityArray,
        field: { labels: { name: true, color: true } },
        filterEntityType: Label,
        filterQuery: {},
        filterDropdownField: { label: "name", value: "_id" },
      } as unknown as Filter<Incident>,
    ]);

    const picker: HTMLElement = await openFilterPicker("Labels");

    await search(picker, "WB1500KSK");

    await waitFor(() => {
      expect(optionTexts()).toEqual(["WB1500KSK retired labelArchived"]);
    });
  });
});
