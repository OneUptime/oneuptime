import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Databases list's "Engine metrics" filter. A never-connected row
 * stores no otelCollectorStatus (NULL), but one written before the column's
 * "disconnected" default was dropped still reads "disconnected", so
 * filtering that column alone put those databases found from traces or
 * containers under "Disconnected". Each status is a group of conditions on
 * the status column and collectorLastSeenAt, by the rule
 * getDatabaseEngineMetricsStatus gives a row.
 *
 * The statuses picked are one FilterGroups the list's own query carries
 * (#11211): the chip read each status's ids first - the first 10,000 - and
 * filtered the list by them. What Postgres answers to it, past 10,000
 * databases of a status, is ListFiltersPastTheCapPostgres's.
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
  buildDatabaseEngineMetricsStatusFilter,
  buildDatabaseEngineMetricsStatusQuery,
  getDatabaseEngineMetricsStatusQueryKinds,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseEngineMetricsFilter";
import {
  DatabaseEngineMetricsStatus,
  DatabaseEngineMetricsStatusSource,
  getDatabaseEngineMetricsStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import { buildFacetColumnQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import FilterGroups, {
  FILTER_GROUPS_QUERY_KEY,
  FilterGroup,
  FilterGroupsMatch,
} from "../../../Types/BaseDatabase/FilterGroups";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";

type Kind = "connected" | "reported-and-stopped" | "never-reported";

/*
 * A group read the way Postgres reads it, against one row: an empty column
 * is NULL, which `<>` is never true of and NotEqualOrNull keeps.
 */
function matchesGroup(
  group: FilterGroup,
  row: DatabaseEngineMetricsStatusSource,
): boolean {
  for (const [column, expected] of Object.entries(group)) {
    const actual: unknown = (row as Record<string, unknown>)[column];
    const isEmpty: boolean = actual === null || actual === undefined;

    if (expected instanceof IsNull) {
      if (!isEmpty) {
        return false;
      }
    } else if (expected instanceof NotNull) {
      if (isEmpty) {
        return false;
      }
    } else if (expected instanceof NotEqualOrNull) {
      if (!isEmpty && actual === expected.value) {
        return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }

  return true;
}

// The filter, as the list route answers it, against one row.
function selects(
  filter: FilterGroups,
  row: DatabaseEngineMetricsStatusSource,
): boolean {
  const anyGroup: boolean = filter.groups.some(
    (group: FilterGroup): boolean => {
      return matchesGroup(group, row);
    },
  );

  return filter.match === FilterGroupsMatch.NoneOf ? !anyGroup : anyGroup;
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
  /*
   * A collector reported but its status was never written: the Status
   * column reads it Disconnected, which `<> 'connected'` alone left out.
   */
  {
    otelCollectorStatus: null,
    collectorLastSeenAt: new Date("2026-09-21T10:00:00.000Z"),
  },
  // A status no collector writes today, with and without a sighting.
  {
    otelCollectorStatus: "error",
    collectorLastSeenAt: new Date("2026-09-22T10:00:00.000Z"),
  },
  { otelCollectorStatus: "error", collectorLastSeenAt: null },
];

afterEach(() => {
  getListMock.mockReset();
});

describe("buildDatabaseEngineMetricsStatusQuery", () => {
  test.each([
    ["connected", DatabaseEngineMetricsStatus.Connected],
    ["reported-and-stopped", DatabaseEngineMetricsStatus.Disconnected],
    ["never-reported", DatabaseEngineMetricsStatus.NotConnected],
  ] as Array<[Kind, DatabaseEngineMetricsStatus]>)(
    "%s selects exactly the rows shown as %s",
    (kind: Kind, status: DatabaseEngineMetricsStatus) => {
      const group: FilterGroup = buildDatabaseEngineMetricsStatusQuery(
        kind,
      ) as unknown as FilterGroup;

      for (const row of ROWS) {
        expect({
          row,
          selected: matchesGroup(group, row),
        }).toEqual({
          row,
          selected: getDatabaseEngineMetricsStatus(row) === status,
        });
      }
    },
  );

  test("'Disconnected' never matches a database that never had an agent", () => {
    const group: FilterGroup = buildDatabaseEngineMetricsStatusQuery(
      "reported-and-stopped",
    ) as unknown as FilterGroup;

    expect(group["collectorLastSeenAt"]).toBeInstanceOf(NotNull);
    expect(
      matchesGroup(group, {
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: null,
      }),
    ).toBe(false);
  });

  test("the not-connected statuses keep a row with no status at all", () => {
    for (const kind of ["reported-and-stopped", "never-reported"] as const) {
      const group: FilterGroup = buildDatabaseEngineMetricsStatusQuery(
        kind,
      ) as unknown as FilterGroup;

      expect(group["otelCollectorStatus"]).toBeInstanceOf(NotEqualOrNull);
      expect(
        (group["otelCollectorStatus"] as NotEqualOrNull<string>).value,
      ).toBe("connected");
    }
  });
});

describe("buildDatabaseEngineMetricsStatusFilter", () => {
  // Every set of statuses a person can pick: one, two or all three.
  const PICKS: Array<Array<DatabaseEngineMetricsStatus>> = [
    [DatabaseEngineMetricsStatus.Connected],
    [DatabaseEngineMetricsStatus.Disconnected],
    [DatabaseEngineMetricsStatus.NotConnected],
    [
      DatabaseEngineMetricsStatus.Connected,
      DatabaseEngineMetricsStatus.Disconnected,
    ],
    [
      DatabaseEngineMetricsStatus.Connected,
      DatabaseEngineMetricsStatus.NotConnected,
    ],
    [
      DatabaseEngineMetricsStatus.Disconnected,
      DatabaseEngineMetricsStatus.NotConnected,
    ],
    [
      DatabaseEngineMetricsStatus.Connected,
      DatabaseEngineMetricsStatus.Disconnected,
      DatabaseEngineMetricsStatus.NotConnected,
    ],
  ];

  test.each(PICKS)(
    "%s: 'is' selects exactly the databases shown so, and 'is not' exactly the others",
    (...picked: Array<DatabaseEngineMetricsStatus>) => {
      const is: FilterGroups | null = buildDatabaseEngineMetricsStatusFilter(
        picked,
        "is",
      );
      const isNot: FilterGroups | null = buildDatabaseEngineMetricsStatusFilter(
        picked,
        "is_not",
      );

      expect(is?.match).toBe(FilterGroupsMatch.AnyOf);
      expect(isNot?.match).toBe(FilterGroupsMatch.NoneOf);
      expect(is?.groups).toHaveLength(picked.length);

      for (const row of ROWS) {
        const isPicked: boolean = picked.includes(
          getDatabaseEngineMetricsStatus(row),
        );

        expect({ row, selected: selects(is!, row) }).toEqual({
          row,
          selected: isPicked,
        });
        expect({ row, selected: selects(isNot!, row) }).toEqual({
          row,
          selected: !isPicked,
        });
      }
    },
  );

  test("reads nothing first: the server answers it in the list's own query", () => {
    buildDatabaseEngineMetricsStatusFilter(
      [
        DatabaseEngineMetricsStatus.Connected,
        DatabaseEngineMetricsStatus.NotConnected,
      ],
      "is",
    );

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a saved 'disconnected' chip still works and asks for a past sighting", () => {
    const filter: FilterGroups | null = buildDatabaseEngineMetricsStatusFilter(
      ["disconnected"],
      "is",
    );

    expect(filter?.groups).toHaveLength(1);
    expect(filter!.groups[0]!["collectorLastSeenAt"]).toBeInstanceOf(NotNull);
    expect(filter!.groups[0]!["otelCollectorStatus"]).toBeInstanceOf(
      NotEqualOrNull,
    );
  });

  test("unknown and repeated values cost no extra group, in any case and with spaces", () => {
    expect(
      getDatabaseEngineMetricsStatusQueryKinds([
        "bogus",
        "connected",
        " Connected ",
        "NOT-CONNECTED",
      ]),
    ).toEqual(["connected", "never-reported"]);

    expect(
      buildDatabaseEngineMetricsStatusFilter(
        ["bogus", "connected", " Connected "],
        "is",
      )?.groups,
    ).toEqual([{ otelCollectorStatus: "connected" }]);
  });

  test("no status, or none a status is called by, filters nothing", () => {
    expect(buildDatabaseEngineMetricsStatusFilter([], "is")).toBeNull();
    expect(buildDatabaseEngineMetricsStatusFilter(["bogus"], "is")).toBeNull();
    expect(
      buildDatabaseEngineMetricsStatusFilter(["bogus"], "is_not"),
    ).toBeNull();
  });

  test("the Engine Metrics chip writes it under filterGroups, never a column or the records' ids", () => {
    const facet: ResourceFacet = {
      key: "otelCollectorStatus",
      label: "Engine Metrics",
      isMultiSelect: true,
      supportedOperators: ["is", "is_not"],
      toFilterGroups: buildDatabaseEngineMetricsStatusFilter,
    };

    const written: ReturnType<typeof buildFacetColumnQuery> =
      buildFacetColumnQuery({
        facet: facet,
        operator: "is",
        values: ["connected", "not-connected"],
        existingValue: undefined,
      });

    expect(written?.field).toBe(FILTER_GROUPS_QUERY_KEY);
    expect(written?.value).toBeInstanceOf(FilterGroups);
    expect((written?.value as FilterGroups).groups).toHaveLength(2);

    // Nothing picked, or a valueless operator, writes nothing.
    for (const operator of ["is_empty", "is_not_empty"] as const) {
      expect(
        buildFacetColumnQuery({
          facet: facet,
          operator: operator,
          values: ["connected"],
          existingValue: undefined,
        }),
      ).toBeNull();
    }

    expect(
      buildFacetColumnQuery({
        facet: facet,
        operator: "is",
        values: [],
        existingValue: undefined,
      }),
    ).toBeNull();
  });
});
