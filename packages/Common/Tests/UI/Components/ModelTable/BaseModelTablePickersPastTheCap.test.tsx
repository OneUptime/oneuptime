import "@testing-library/jest-dom";
import {
  act,
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

/*
 * Permissions and the signed-in user are stubbed to their permissive form,
 * as in BaseModelTableSearchLabels: who may read what is not the subject.
 */
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

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../../App/Dashboard/CappedListServer";
import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  TABLE_LABEL_SUGGESTIONS_SHOWN,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
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
 * A LIST'S "@LABEL" SUGGESTIONS AND ITS "FILTER BY …" FILTERS, PAST THE
 * PROJECT'S FIRST RECORDS (#10646).
 *
 *   - The search box's "@" read the first 200 labels by name once and
 *     suggested from them: a label past them was never suggested, and a
 *     label chip restored from a link that named one kept its raw id.
 *   - Each entity filter read its first 10,000 records unsorted - the
 *     newest kept - so an older one could not be picked, and a filter
 *     restored from a link showed blank; the Admin Dashboard's Project
 *     filter listed every project on the instance.
 *
 * Both search the server now, through the list's own reads (its callbacks),
 * and read what they hold by its id: a value deleted since reads "No longer
 * available", still narrows the list as it was saved, and can be taken
 * out. The list's reads are answered by a project faked whole
 * (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

const LATE_LABEL_ID: string = "e0000000-0000-4000-8000-0000000000aa";
const DELETED_LABEL_ID: string = "e0000000-0000-4000-8000-0000000000dd";
const LATE_TEAM_ID: string = "f0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_TEAM_ID: string = "f0000000-0000-4000-8000-0000000000ab";
const DELETED_TEAM_ID: string = "f0000000-0000-4000-8000-0000000000dd";

// More than the "@" suggestions ever read, all named before "WB".
const LABELS_BEFORE_WB: number = 250;
const TEAMS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

const LABELS_FILTER: Filter<Monitor> = {
  title: "Labels",
  type: FieldType.EntityArray,
  field: { labels: { name: true, color: true } },
  filterEntityType: Label,
  // The filter's own rule: the labels of the project's monitors' kind.
  filterQuery: { color: "#6366f1" },
  filterDropdownField: { label: "name", value: "_id" },
} as unknown as Filter<Monitor>;

const OWNER_TEAMS_FILTER: Filter<Monitor> = {
  title: "Owner Team",
  type: FieldType.EntityArray,
  field: { ownerTeams: { name: true } },
  filterEntityType: Team,
  filterQuery: {},
  filterDropdownField: { label: "name", value: "_id" },
} as unknown as Filter<Monitor>;

let server: CappedListServer;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Label,
    namesSortingFirst(LABELS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          color: "#6366f1",
        };
      },
    ),
  );
  server.add(Label, [
    { _id: LATE_LABEL_ID, name: "WB1500KSK kiosks", color: "#6366f1" },
    // Another kind's label: the filter's own query never offers it.
    {
      _id: ObjectID.generate().toString(),
      name: "WB1500KSK other kind",
      color: "#22c55e",
    },
  ]);

  server.add(
    Team,
    namesSortingFirst(TEAMS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Team, [
    { _id: LATE_TEAM_ID, name: "WB1500KSK on-site" },
    { _id: OTHER_LATE_TEAM_ID, name: "WB1500KSK remote" },
  ]);

  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function makeProps(
  filters: Array<Filter<Monitor>>,
): BaseModelTableProps<Monitor> {
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
    // Every read of the list - its rows, its pickers - answered by the fake.
    getList: async (data: unknown): Promise<ListResult<Monitor>> => {
      return server.list(data as never) as unknown as ListResult<Monitor>;
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

  return {
    modelType: Monitor,
    id: "monitors-table",
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: "monitors-table",
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: filters,
    cardProps: { title: "Monitors", description: "All monitors" },
    isDeleteable: false,
    isCreateable: false,
    isViewable: false,
    isEditable: false,
    callbacks: callbacks,
    searchableFields: ["name"] as Array<keyof Monitor>,
  } as unknown as BaseModelTableProps<Monitor>;
}

function renderTable(filters: Array<Filter<Monitor>>): void {
  render(<BaseModelTable<Monitor> {...makeProps(filters)} />);
}

// The list's reads of its rows, newest last.
function rowReads(): Array<CappedListCall> {
  return server.callsFor(Monitor);
}

function lastRowQuery(): Record<string, unknown> {
  return rowReads()[rowReads().length - 1]!.query;
}

// What the applied filters' chips say, joined.
function appliedChips(): string {
  return screen
    .queryAllByTestId("applied-filter-chip")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    })
    .join(" | ");
}

function labelChips(): Array<HTMLElement> {
  return screen.queryAllByTestId("table-search-label-chip");
}

describe('the search box\'s "@" label suggestions', () => {
  async function typeInSearch(text: string): Promise<void> {
    const open: HTMLElement = await screen.findByRole("button", {
      name: "Open search",
    });

    await act(async () => {
      fireEvent.click(open);
    });

    const input: HTMLElement =
      await screen.findByPlaceholderText(/try @ for labels/);

    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: text } });
    });
  }

  test("suggests a label past the first 200 by name, searched on the server within the filter's own rule", async () => {
    renderTable([LABELS_FILTER]);

    await typeInSearch("@WB1500");

    expect(await screen.findByText("WB1500KSK kiosks")).toBeVisible();
    // Another kind's label is never suggested: the filter's rule is kept.
    expect(screen.queryByText("WB1500KSK other kind")).toBeNull();

    const searches: Array<CappedListCall> = server
      .callsFor(Label)
      .filter((call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      });

    expect(
      (
        searches[searches.length - 1]!.query["name"] as Search<string>
      ).toString(),
    ).toBe("WB1500");
    expect(searches[searches.length - 1]!.query["color"]).toBe("#6366f1");

    // A page of suggestions, never the first 200 by name.
    for (const call of server.callsFor(Label)) {
      expect(call.limit).toBeLessThanOrEqual(TABLE_LABEL_SUGGESTIONS_SHOWN);
    }
  });

  test("picking a suggestion narrows the list by it", async () => {
    renderTable([LABELS_FILTER]);

    await typeInSearch("@WB1500");

    const suggestion: HTMLElement = await screen.findByText("WB1500KSK kiosks");

    await act(async () => {
      fireEvent.click(suggestion);
    });

    await waitFor(() => {
      expect(lastRowQuery()["labels"]).toBeInstanceOf(Includes);
    });
    expect((lastRowQuery()["labels"] as Includes).values).toEqual([
      LATE_LABEL_ID,
    ]);
  });
});

describe("label chips restored from a link", () => {
  test("are named by their ids, past the first 200, and a deleted one reads No longer available until it is taken out", async () => {
    TableFilterUrlState.write("monitors-table", "view", {
      labels: [LATE_LABEL_ID, DELETED_LABEL_ID],
    });

    renderTable([LABELS_FILTER]);

    await waitFor(() => {
      expect(
        labelChips().map((chip: HTMLElement): string => {
          return chip.textContent || "";
        }),
      ).toEqual(["WB1500KSK kiosks", "No longer available"]);
    });

    expect(labelChips()[1]!).toHaveAttribute("data-not-found", "true");

    // Read by their ids: never the project's labels whole.
    for (const call of server.callsFor(Label)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }

    // The one gone still narrows the list, as the link was saved.
    expect((lastRowQuery()["labels"] as Includes).values).toEqual([
      LATE_LABEL_ID,
      DELETED_LABEL_ID,
    ]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    await waitFor(() => {
      expect((lastRowQuery()["labels"] as Includes).values).toEqual([
        LATE_LABEL_ID,
      ]);
    });

    await waitFor(() => {
      expect(TableFilterUrlState.read("monitors-table", "view")).toEqual({
        labels: [LATE_LABEL_ID],
      });
    });
  });
});

describe("an entity filter restored from a link", () => {
  test("names a team past the 10,000th by its id, says No longer available for one deleted since, and keeps both", async () => {
    TableFilterUrlState.write("monitors-table", "filter", {
      ownerTeams: [LATE_TEAM_ID, DELETED_TEAM_ID],
    });

    renderTable([OWNER_TEAMS_FILTER]);

    await waitFor(() => {
      expect(appliedChips()).toMatch(
        /Owner Team is any of: WB1500KSK on-site, No longer available/,
      );
    });

    // Read by their ids: never the filter's first 10,000 records.
    for (const call of server.callsFor(Team)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }

    // The filter is applied as it was saved, the deleted team with it.
    expect(TableFilterUrlState.read("monitors-table", "filter")).toEqual({
      ownerTeams: [LATE_TEAM_ID, DELETED_TEAM_ID],
    });
  });

  test("its picker in the filter form searches the server, finds a team past the 10,000th and names it once picked", async () => {
    renderTable([OWNER_TEAMS_FILTER]);

    fireEvent.click(
      await screen.findByRole("button", { name: "More options" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));

    const picker: HTMLElement = await screen.findByPlaceholderText(
      "Filter by Owner Team",
    );

    // Opening the form read no team.
    expect(server.callsFor(Team)).toHaveLength(0);

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "WB1500KSK" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK remote/,
    });

    for (const call of server.callsFor(Team)) {
      expect(call.limit).toBeLessThanOrEqual(50);
    }

    await act(async () => {
      fireEvent.click(option);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    // Applied, the pick narrows the list and its chip names it.
    await waitFor(() => {
      expect(appliedChips()).toMatch(/Owner Team is WB1500KSK remote/);
    });
    expect(TableFilterUrlState.read("monitors-table", "filter")).toEqual({
      ownerTeams: [OTHER_LATE_TEAM_ID],
    });
  });
});
