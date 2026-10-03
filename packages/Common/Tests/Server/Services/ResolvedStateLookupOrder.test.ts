import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Which state auto-resolution moves an incident or an alert into, when the
 * project defines more than one resolved state.
 *
 * isResolvedState means "customer impact has ended", and a project may put a
 * further state after it - a post-incident review stage that is also closed.
 * Both rows then match the lookup, and an unsorted query is free to return
 * either, which lands the record in the later state and skips the earlier one
 * entirely.
 *
 * The database is replaced by a list of states. The fake honours a sort on
 * `order` and, with no sort, returns the row the ordered query would NOT have
 * picked - standing in for a database that may answer in any order.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194b2f8-0000-4000-8000-000000000001",
);

const RESOLVED_ID: string = "0194b2f8-0000-4000-8000-0000000000a1";
const FINISHED_ID: string = "0194b2f8-0000-4000-8000-0000000000a2";

interface StateRow {
  id: string;
  order: number;
}

// Resolved comes first, the extra closed state after it.
const ROWS: Array<StateRow> = [
  { id: RESOLVED_ID, order: 5 },
  { id: FINISHED_ID, order: 6 },
];

type Lookup = {
  query: { isResolvedState?: boolean };
  sort?: { order?: SortOrder } | undefined;
};

function answer(lookup: Lookup, rows: Array<StateRow>): StateRow | null {
  if (rows.length === 0) {
    return null;
  }

  if (lookup.sort?.order === SortOrder.Ascending) {
    return [...rows].sort((a: StateRow, b: StateRow) => {
      return a.order - b.order;
    })[0]!;
  }

  // No sort: answer with the highest order, as an unordered query may.
  return [...rows].sort((a: StateRow, b: StateRow) => {
    return b.order - a.order;
  })[0]!;
}

function stubIncidentStates(rows: Array<StateRow>): void {
  jest.spyOn(IncidentStateService, "findOneBy").mockImplementation((async (
    lookup: Lookup,
  ): Promise<IncidentState | null> => {
    const row: StateRow | null = answer(lookup, rows);

    if (!row) {
      return null;
    }

    const state: IncidentState = new IncidentState();
    state.id = new ObjectID(row.id);
    state.order = row.order;
    return state;
  }) as never);
}

function stubAlertStates(rows: Array<StateRow>): void {
  jest.spyOn(AlertStateService, "findOneBy").mockImplementation((async (
    lookup: Lookup,
  ): Promise<AlertState | null> => {
    const row: StateRow | null = answer(lookup, rows);

    if (!row) {
      return null;
    }

    const state: AlertState = new AlertState();
    state.id = new ObjectID(row.id);
    state.order = row.order;
    return state;
  }) as never);
}

describe("getResolvedStateIdForProject with two resolved states", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("incidents resolve into the earliest resolved state by order", async () => {
    stubIncidentStates(ROWS);

    const stateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        PROJECT_ID,
      );

    expect(stateId.toString()).toBe(RESOLVED_ID);
  });

  test("alerts resolve into the earliest resolved state by order", async () => {
    stubAlertStates(ROWS);

    const stateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(PROJECT_ID);

    expect(stateId.toString()).toBe(RESOLVED_ID);
  });

  test("a project with no resolved state still raises", async () => {
    stubIncidentStates([]);

    await expect(
      IncidentStateTimelineService.getResolvedStateIdForProject(PROJECT_ID),
    ).rejects.toThrow("No resolved state found for the project");
  });
});
