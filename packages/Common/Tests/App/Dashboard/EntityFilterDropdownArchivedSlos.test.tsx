import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { Mock } from "jest-mock";
import ObjectID from "../../../Types/ObjectID";

/*
 * The entity picker behind dashboard SLO widgets and dashboard variables.
 *
 * An archived SLO is retired - not evaluated, its numbers frozen - so it must
 * not be offered for a NEW widget or variable. But a widget that already points
 * at one keeps loading it by id, and its settings must not pretend nothing is
 * selected: a blank picker over a live selection is how that selection gets
 * silently dropped on the next edit. So the picker searches only live SLOs
 * and, separately, reads every selected SLO by its id, showing it marked
 * "(archived)" - but only when it really is archived: a live SLO is past the
 * first page of a search in a project with many SLOs. An SLO picker
 * searches the server as it is opened and typed in, 50 by name (#10580):
 * nothing is read up front but the saved selection. Only SLOs narrow the
 * search; the by-id lookup itself is shared with every kind searched on the
 * server (see DashboardWidgetEntityPickerSearch.test.tsx).
 */

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface Row {
  _id: string;
  name: string;
  isArchived?: boolean | undefined;
}

interface ListResultShape {
  data: Array<Row>;
  count: number;
  skip: number;
  limit: number;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000007",
);

const getListMock: Mock<(args: ListArgs) => Promise<ListResultShape>> =
  jest.fn<(args: ListArgs) => Promise<ListResultShape>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs): Promise<ListResultShape> => {
        return getListMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import EntityFilterDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import Includes from "../../../Types/BaseDatabase/Includes";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";

const LIVE_SLO: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000101",
  name: "Checkout availability",
  isArchived: false,
};

const ARCHIVED_SLO: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000102",
  name: "Legacy search latency",
  isArchived: true,
};

// Live, but past the list's 1000-row cap in a project with many SLOs.
const LIVE_SLO_PAST_CAP: Row = {
  _id: "0193c0de-7777-4aaa-8bbb-000000000103",
  name: "Zeta payments latency",
  isArchived: false,
};

function listOf(rows: Array<Row>): Promise<ListResultShape> {
  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 1000,
  });
}

/*
 * The server as the picker sees it: a search returns only the live SLO on
 * its first page, and a lookup by id returns whichever SLOs were asked for,
 * archived or not - carrying isArchived only if the lookup selected it.
 */
function serveSlos(args: ListArgs): Promise<ListResultShape> {
  const idFilter: unknown = args.query["_id"];

  if (idFilter instanceof Includes) {
    const ids: Array<string> = (idFilter.values as Array<ObjectID>).map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );

    return listOf(
      [LIVE_SLO, ARCHIVED_SLO, LIVE_SLO_PAST_CAP]
        .filter((row: Row): boolean => {
          return ids.includes(row._id);
        })
        .map((row: Row): Row => {
          return args.select["isArchived"]
            ? row
            : { _id: row._id, name: row.name };
        }),
    );
  }

  return listOf([LIVE_SLO]);
}

function renderPicker(options: {
  type: EntityFilterModelType;
  isMultiSelect?: boolean | undefined;
  value?: string | Array<string> | undefined;
  placeholder?: string | undefined;
}): void {
  render(
    <EntityFilterDropdown
      entityFilterModelType={options.type}
      isMultiSelect={Boolean(options.isMultiSelect)}
      value={options.value}
      placeholder={options.placeholder}
      onChange={() => {
        return undefined;
      }}
    />,
  );
}

async function waitForOptions(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Loading options...")).not.toBeInTheDocument();
  });
}

/*
 * The picker's reads, in the order it made them: a read of saved SLOs by
 * their ids, or a search of the server as the picker is opened and typed
 * in (#10580).
 */
function idReads(): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: [ListArgs]): ListArgs => {
      return call[0];
    })
    .filter((args: ListArgs): boolean => {
      return args.query["_id"] instanceof Includes;
    });
}

function searches(): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: [ListArgs]): ListArgs => {
      return call[0];
    })
    .filter((args: ListArgs): boolean => {
      return !(args.query["_id"] instanceof Includes);
    });
}

function idsOf(args: ListArgs): Array<string> {
  return ((args.query["_id"] as Includes).values as Array<ObjectID>).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );
}

// Opens the picker, which searches the server for the first SLOs by name.
async function openPicker(): Promise<void> {
  const picker: HTMLElement = await screen.findByRole("combobox");

  await act(async () => {
    fireEvent.click(picker);
  });

  await waitFor(() => {
    expect(searches().length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  getListMock.mockReset().mockImplementation(serveSlos);
});

afterEach(() => {
  cleanup();
});

describe("EntityFilterDropdown and archived SLOs", () => {
  test("offers only unarchived SLOs, within the current project", async () => {
    renderPicker({ type: EntityFilterModelType.ServiceLevelObjective });

    // Nothing is read before the picker is opened.
    await screen.findByRole("combobox");
    expect(getListMock).not.toHaveBeenCalled();

    await openPicker();

    /*
     * The search asks for live SLOs only; ModelAPI sends it for the current
     * project, as every read of a project's records.
     */
    const search: ListArgs = searches()[0]!;
    expect(search.modelType).toBe(ServiceLevelObjective);
    expect(search.query["isArchived"]).toBe(false);
    expect(
      await screen.findByRole("option", { name: /Checkout availability/ }),
    ).toBeInTheDocument();
  });

  test("leaves every other entity type's list exactly as it was", async () => {
    renderPicker({ type: EntityFilterModelType.Monitor });

    await openPicker();

    expect(searches()[0]!.modelType).toBe(Monitor);
    // No narrowing of its own: a monitor is never archived away from a widget.
    expect(searches()[0]!.query["isArchived"]).toBeUndefined();
  });

  test("keeps showing an archived SLO a widget already points at, marked as archived", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: ARCHIVED_SLO._id,
    });

    expect(
      await screen.findByText("Legacy search latency (archived)"),
    ).toBeInTheDocument();

    expect(idReads()).toHaveLength(1);

    const lookup: ListArgs = idReads()[0]!;
    expect(lookup.modelType).toBe(ServiceLevelObjective);
    // By id, in the project, and NOT narrowed to live SLOs - that is the point.
    expect(Object.keys(lookup.query).sort()).toEqual(["_id", "projectId"]);
    expect((lookup.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(idsOf(lookup)).toEqual([ARCHIVED_SLO._id]);
    expect(lookup.limit).toBe(1);
    // Fetches isArchived, so the marker is earned rather than assumed.
    expect(lookup.select).toEqual({ isArchived: true, _id: true, name: true });
  });

  test("in a multi-select, reads the selected SLOs by their ids, once, and marks only the archived one", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: [LIVE_SLO._id, ARCHIVED_SLO._id],
    });

    expect(
      await screen.findByText("Legacy search latency (archived)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();

    expect(idReads()).toHaveLength(1);
    expect(idsOf(idReads()[0]!)).toEqual([LIVE_SLO._id, ARCHIVED_SLO._id]);
  });

  test("never sends a malformed saved value to the lookup, so it cannot cost the real selection its label", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: ["not-an-id", ARCHIVED_SLO._id],
    });

    expect(
      await screen.findByText("Legacy search latency (archived)"),
    ).toBeInTheDocument();
    // The value that names no SLO is no longer there, for the reader to take out.
    expect(
      await screen.findByRole("button", { name: "Remove No longer available" }),
    ).toBeInTheDocument();

    // Read by its id once; the malformed value never.
    expect(idReads().map(idsOf)).toEqual([[ARCHIVED_SLO._id]]);
  });

  test("makes no lookup at all when the only saved value is malformed", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: "not-an-id",
    });
    await waitForOptions();

    expect(idReads()).toEqual([]);
  });

  test("reads a live selected SLO by its id once, and names it", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: LIVE_SLO._id,
    });

    expect(
      await screen.findByText("Checkout availability"),
    ).toBeInTheDocument();
    expect(idReads()).toHaveLength(1);
    expect(searches()).toEqual([]);
  });

  test("reads nothing when nothing is selected, until the picker is opened", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: [],
    });
    await waitForOptions();

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a live SLO past the first page of a search is shown by name, not marked archived", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: LIVE_SLO_PAST_CAP._id,
      placeholder: "All SLOs",
    });

    expect(
      await screen.findByText("Zeta payments latency"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\(archived\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("All SLOs")).not.toBeInTheDocument();

    expect(idReads()).toHaveLength(1);
    expect(idsOf(idReads()[0]!)).toEqual([LIVE_SLO_PAST_CAP._id]);
  });

  test("in a multi-select, marks only the archived one of the SLOs it reads by id", async () => {
    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: [LIVE_SLO._id, LIVE_SLO_PAST_CAP._id, ARCHIVED_SLO._id],
    });

    expect(
      await screen.findByRole("button", {
        name: "Remove Legacy search latency (archived)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Zeta payments latency" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Checkout availability" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Zeta payments latency (archived)"),
    ).not.toBeInTheDocument();

    expect(idReads()).toHaveLength(1);
    expect([...idsOf(idReads()[0]!)].sort()).toEqual(
      [LIVE_SLO._id, ARCHIVED_SLO._id, LIVE_SLO_PAST_CAP._id].sort(),
    );
  });

  test("does not mark an SLO archived when the lookup cannot tell", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.query["_id"]) {
        // e.g. the field came back unreadable: no isArchived on the row.
        return listOf([{ _id: ARCHIVED_SLO._id, name: ARCHIVED_SLO.name }]);
      }

      return listOf([LIVE_SLO]);
    });

    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      value: ARCHIVED_SLO._id,
    });

    expect(
      await screen.findByText("Legacy search latency"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\(archived\)/)).not.toBeInTheDocument();
  });

  test("a failed lookup of the saved selection leaves the picker working", async () => {
    getListMock.mockImplementation((args: ListArgs) => {
      if (args.query["_id"]) {
        return Promise.reject(new Error("lookup failed"));
      }

      return listOf([LIVE_SLO]);
    });

    renderPicker({
      type: EntityFilterModelType.ServiceLevelObjective,
      isMultiSelect: true,
      value: [ARCHIVED_SLO._id],
    });
    await waitForOptions();

    await waitFor(() => {
      expect(idReads().length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("lookup failed")).not.toBeInTheDocument();

    // It still searches, and offers the live SLOs.
    await openPicker();
    expect(
      await screen.findByRole("option", { name: /Checkout availability/ }),
    ).toBeInTheDocument();
  });

  test("a short list that fails to read still shows its error, as before", async () => {
    /*
     * SLOs are searched now, and read no list; a kind that is still read
     * whole - the project's incident severities - says why it could not be.
     */
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("list failed"));
    });

    renderPicker({ type: EntityFilterModelType.IncidentSeverity });

    expect(await screen.findByText("list failed")).toBeInTheDocument();
  });
});
