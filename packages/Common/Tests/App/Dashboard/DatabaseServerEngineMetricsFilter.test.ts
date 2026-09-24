import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Databases list's "Engine metrics" filter. A never-connected row
 * stores otelCollectorStatus "disconnected" (the column default), so
 * filtering that column alone put every database found from traces or
 * containers under "Disconnected". The filter resolves each status to the
 * rows getDatabaseEngineMetricsStatus gives it, through collectorLastSeenAt
 * as well as the status column.
 */

const getListMock: MockFunction = getJestMockFunction();

// The arrow wrapper is load bearing: jest.mock is hoisted above the mock.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import {
  buildDatabaseEngineMetricsStatusQuery,
  computeDatabaseServerIdsForEngineMetricsStatuses,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseEngineMetricsFilter";
import {
  DatabaseEngineMetricsStatus,
  DatabaseEngineMetricsStatusSource,
  getDatabaseEngineMetricsStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b2f5b1c-0000-4000-8000-000000000001",
);

interface GetListArgs {
  modelType: { name: string };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

function calls(): Array<GetListArgs> {
  return getListMock.mock.calls.map((call: Array<unknown>): GetListArgs => {
    return call[0] as GetListArgs;
  });
}

/*
 * A tiny in-memory evaluator for the three query shapes, so the filter can
 * be checked against the rows getDatabaseEngineMetricsStatus classifies.
 */
function matches(
  query: Record<string, unknown>,
  row: DatabaseEngineMetricsStatusSource,
): boolean {
  for (const [column, expected] of Object.entries(query)) {
    if (column === "projectId") {
      continue;
    }
    const actual: unknown = (row as Record<string, unknown>)[column];
    const isEmpty: boolean =
      actual === null || actual === undefined || actual === "";
    if (expected instanceof IsNull) {
      if (!isEmpty) {
        return false;
      }
    } else if (expected instanceof NotNull) {
      if (isEmpty) {
        return false;
      }
    } else if (expected instanceof NotEqual) {
      if (isEmpty || actual === expected.value) {
        return false;
      }
    } else if (expected instanceof EqualToOrNull) {
      if (!isEmpty && actual !== expected.value) {
        return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

const ROWS: Array<DatabaseEngineMetricsStatusSource> = [
  // A collector is reporting.
  {
    otelCollectorStatus: "connected",
    collectorLastSeenAt: new Date("2026-09-24T10:00:00.000Z"),
  },
  // A collector reported, then the sweeper marked it disconnected.
  {
    otelCollectorStatus: "disconnected",
    collectorLastSeenAt: new Date("2026-09-20T10:00:00.000Z"),
  },
  // Found from traces / Kubernetes / Docker: the column default, no agent.
  { otelCollectorStatus: "disconnected", collectorLastSeenAt: null },
  // A column without a default: no status at all.
  { otelCollectorStatus: null, collectorLastSeenAt: null },
];

afterEach(() => {
  getListMock.mockReset();
});

describe("buildDatabaseEngineMetricsStatusQuery", () => {
  test.each([
    ["connected", DatabaseEngineMetricsStatus.Connected],
    ["reported-and-stopped", DatabaseEngineMetricsStatus.Disconnected],
    ["never-reported", DatabaseEngineMetricsStatus.NotConnected],
  ] as Array<
    [
      "connected" | "reported-and-stopped" | "never-reported",
      DatabaseEngineMetricsStatus,
    ]
  >)(
    "%s selects exactly the rows shown as %s",
    (
      kind: "connected" | "reported-and-stopped" | "never-reported",
      status: DatabaseEngineMetricsStatus,
    ) => {
      const query: Record<string, unknown> =
        buildDatabaseEngineMetricsStatusQuery(kind) as Record<string, unknown>;
      for (const row of ROWS) {
        expect({
          row,
          selected: matches(query, row),
        }).toEqual({
          row,
          selected: getDatabaseEngineMetricsStatus(row) === status,
        });
      }
    },
  );

  test("'Disconnected' never matches a database that never had an agent", () => {
    const query: Record<string, unknown> =
      buildDatabaseEngineMetricsStatusQuery("reported-and-stopped") as Record<
        string,
        unknown
      >;
    expect(query["collectorLastSeenAt"]).toBeInstanceOf(NotNull);
    expect(
      matches(query, {
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: null,
      }),
    ).toBe(false);
  });
});

describe("computeDatabaseServerIdsForEngineMetricsStatuses", () => {
  test("one project-scoped id query per chosen status, unioned", async () => {
    getListMock.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (args as GetListArgs).query;
      if (query["otelCollectorStatus"] === "connected") {
        return { data: [{ _id: "a" }, { _id: "b" }], count: 2 };
      }
      return { data: [{ _id: "b" }, { _id: "c" }, { _id: undefined }] };
    });

    const ids: Array<string> =
      await computeDatabaseServerIdsForEngineMetricsStatuses(PROJECT_ID, [
        "connected",
        "not-connected",
      ]);

    expect(ids.sort()).toEqual(["a", "b", "c"]);
    expect(calls()).toHaveLength(2);
    for (const call of calls()) {
      expect(call.modelType.name).toBe("DatabaseServer");
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(call.select).toEqual({ _id: true });
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
    }
    expect(calls()[1]!.query["collectorLastSeenAt"]).toBeInstanceOf(IsNull);
  });

  test("a saved 'disconnected' chip still works and asks for a past sighting", async () => {
    getListMock.mockResolvedValue({ data: [{ _id: "d" }] });

    expect(
      await computeDatabaseServerIdsForEngineMetricsStatuses(PROJECT_ID, [
        "disconnected",
      ]),
    ).toEqual(["d"]);
    expect(calls()[0]!.query["collectorLastSeenAt"]).toBeInstanceOf(NotNull);
    expect(calls()[0]!.query["otelCollectorStatus"]).toBeInstanceOf(NotEqual);
  });

  test("unknown and repeated values cost no extra query", async () => {
    getListMock.mockResolvedValue({ data: [] });

    expect(
      await computeDatabaseServerIdsForEngineMetricsStatuses(PROJECT_ID, [
        "bogus",
        "connected",
        " Connected ",
      ]),
    ).toEqual([]);
    expect(calls()).toHaveLength(1);

    getListMock.mockReset();
    expect(
      await computeDatabaseServerIdsForEngineMetricsStatuses(PROJECT_ID, []),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});
