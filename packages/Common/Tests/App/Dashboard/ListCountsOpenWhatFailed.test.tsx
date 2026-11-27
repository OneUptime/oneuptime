/**
 * @timezone UTC
 */
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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A COUNT ON A LIST OR AN OVERVIEW OPENS WHAT FAILED AND WHY (#9751).
 *
 *   - Ceph's Clusters list drew "ERR" and "WARN" from Ceph's verdict alone;
 *     reaching why took a click and a page. Each is now a pill that opens
 *     what needs attention on the cluster by the Overview's own rules:
 *     Ceph's checks on the cluster's row, then each OSD, monitor and pool,
 *     a step from each page, read when pressed.
 *   - App Platforms' Overview said "2 environments disconnected" and linked
 *     nowhere, and All Environments could not be filtered to them. The list
 *     has a Status chip now (Connected, Disconnected, Waiting) by its Status
 *     column's own rule, and the line opens the list with it set.
 *
 * OpenStack bare metal's "Failed: N" is held in OpenStackBareMetalPages,
 * over its own harness.
 */

const fetchCephResourcesMock: MockFunction = getJestMockFunction();
const loadCephHealthChecksMock: MockFunction = getJestMockFunction();
const loadCephPgStatesMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephResourceUtils",
  () => {
    return {
      __esModule: true,
      fetchCephResources: (...args: Array<unknown>) => {
        return fetchCephResourcesMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephReadings",
  () => {
    return {
      __esModule: true,
      loadCephHealthChecks: (...args: Array<unknown>) => {
        return loadCephHealthChecksMock(...args);
      },
      loadCephPgStates: (...args: Array<unknown>) => {
        return loadCephPgStatesMock(...args);
      },
    };
  },
);

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import CephClusterHealthPill, {
  CephClusterHealthSubject,
  loadCephClusterAttention,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephClusterHealthPill";
import {
  ResourceAttentionItem,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourceAttentionDialogRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import {
  CLOUD_ENVIRONMENT_STATUS_LABELS,
  CloudEnvironmentStatus,
  ENVIRONMENT_STATUS_FACET_KEY,
  buildCloudEnvironmentStatusFilter,
  buildCloudEnvironmentStatusQuery,
  getCloudEnvironmentStatus,
  getEnvironmentStatusFacet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsEnvironmentStatus";
import { getAppPlatformsEnvironmentsRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsListRoutes";
import {
  APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
  CLOUD_ACCOUNT_FACET_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import {
  CloudFleetCounts,
  CloudFleetSummaryTile,
  SHOW_DISCONNECTED_ENVIRONMENTS,
  summarizeCloudFleet,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudFleetSummary";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import Route from "../../../Types/API/Route";
import FilterGroups, {
  FILTER_GROUPS_QUERY_KEY,
  FilterGroup,
  FilterGroupsMatch,
} from "../../../Types/BaseDatabase/FilterGroups";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { buildFacetColumnQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function cephRow(fields: Partial<CephResource>): CephResource {
  return Object.assign(new CephResource(), {
    hostname: "ceph-a",
    metricsUpdatedAt: minutesBefore(1),
    lastSeenAt: minutesBefore(1),
    ...fields,
  });
}

const CLUSTER: CephClusterHealthSubject = {
  id: CLUSTER_ID,
  name: "ceph-prod",
  healthStatus: 2,
  capacityUsedPercent: 41,
};

const ROWS: Array<CephResource> = [
  cephRow({ kind: "Osd", externalId: "osd.1", isUp: true, isIn: true }),
  cephRow({ kind: "Osd", externalId: "osd.2", isUp: false, isIn: true }),
  cephRow({ kind: "Pool", externalId: "1", name: "rbd" }),
];

function keysOf(items: Array<ResourceAttentionItem>): Array<string> {
  return items.map((item: ResourceAttentionItem): string => {
    return item.key;
  });
}

// A link's facet state, as All Environments reads it back.
function facetStateOf(route: Route): JSONObject {
  const url: URL = new URL(route.toString(), "https://oneuptime.example");
  const raw: string | null = url.searchParams.get(
    TableFilterUrlState.getParamName(
      APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
      "facets",
    ),
  );

  expect(raw).not.toBeNull();

  return JSONFunctions.deserialize(
    JSONFunctions.parseJSONObject(raw as string),
  ) as JSONObject;
}

beforeEach(() => {
  fetchCephResourcesMock.mockReset();
  loadCephHealthChecksMock.mockReset();
  loadCephPgStatesMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);

  fetchCephResourcesMock.mockResolvedValue(ROWS as never);
  loadCephHealthChecksMock.mockResolvedValue({
    checks: [
      { name: "PG_DEGRADED", severity: "HEALTH_WARN" },
      { name: "OSD_DOWN", severity: "HEALTH_ERR" },
    ],
    isExported: true,
  } as never);
  loadCephPgStatesMock.mockResolvedValue({
    byPool: new Map(),
    totals: null,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("a Ceph cluster's ERR or WARN on the Clusters list", () => {
  test("lists what needs attention as the Overview does: the cluster's checks, the worst first, then each part", async () => {
    const read: ResourceAttentionDialogRead = await loadCephClusterAttention(
      CLUSTER,
      NOW,
    );

    expect(keysOf(read.items)).toEqual(["Cluster", "Osd:osd.2"]);

    const cluster: ResourceAttentionItem = read.items[0]!;

    // Ceph's own codes, as Ceph names them, the error first.
    expect(
      cluster.reasons.map((reason: ResourceAttentionText) => {
        return reason.values?.["check"];
      }),
    ).toEqual(["OSD_DOWN", "PG_DEGRADED"]);
    // From the list, the cluster's row is a step from its Overview.
    expect(cluster.route?.toString()).toContain(
      `/ceph/${CLUSTER_ID.toString()}`,
    );
    // Each part a step from its own page.
    expect(read.items[1]!.route?.toString()).toContain("osd.2");
  });

  test("reads the cluster's inventory, checks and placement groups by its name, once pressed", async () => {
    await loadCephClusterAttention(CLUSTER, NOW);

    expect(fetchCephResourcesMock).toHaveBeenCalledWith({
      cephClusterId: CLUSTER_ID,
      kinds: ["Osd", "Pool", "Mon"],
    });
    expect(loadCephHealthChecksMock).toHaveBeenCalledWith("ceph-prod");
    expect(loadCephPgStatesMock).toHaveBeenCalledWith("ceph-prod");
  });

  test("checks it cannot read leave Ceph's verdict on the cluster's row, as on the Overview", async () => {
    loadCephHealthChecksMock.mockRejectedValue(new Error("down") as never);
    loadCephPgStatesMock.mockRejectedValue(new Error("down") as never);

    const read: ResourceAttentionDialogRead = await loadCephClusterAttention(
      CLUSTER,
      NOW,
    );

    expect(read.items[0]!.reasons).toEqual([
      { text: "Ceph reports {{status}}", values: { status: "HEALTH_ERR" } },
    ]);
  });

  test("a Ceph that exports no checks says its verdict alone", async () => {
    loadCephHealthChecksMock.mockResolvedValue({
      checks: [],
      isExported: false,
    } as never);

    const read: ResourceAttentionDialogRead = await loadCephClusterAttention(
      { ...CLUSTER, healthStatus: 1 },
      NOW,
    );

    // The down OSD is the most urgent; the cluster's WARN comes after it.
    expect(keysOf(read.items)).toEqual(["Osd:osd.2", "Cluster"]);
    expect(read.items[1]!.reasons).toEqual([
      { text: "Ceph reports {{status}}", values: { status: "HEALTH_WARN" } },
    ]);
  });

  test("an inventory it cannot read is an error the dialog says, never an empty list", async () => {
    fetchCephResourcesMock.mockRejectedValue(new Error("down") as never);

    await expect(loadCephClusterAttention(CLUSTER, NOW)).rejects.toThrow(
      "down",
    );
  });

  test("ERR is a red pill, WARN an amber one, each in Ceph's own word", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CephClusterHealthPill cluster={CLUSTER} />
          <CephClusterHealthPill
            cluster={{
              ...CLUSTER,
              id: new ObjectID("44444444-4444-4444-8444-444444444444"),
              healthStatus: 1,
            }}
          />
        </MemoryRouter>,
      );
    });

    const error: HTMLElement = screen.getByTestId(
      `ceph-cluster-health-${CLUSTER_ID.toString()}`,
    );
    const warning: HTMLElement = screen.getByTestId(
      "ceph-cluster-health-44444444-4444-4444-8444-444444444444",
    );

    expect(error.tagName).toBe("BUTTON");
    expect(error).toHaveTextContent("ERR");
    expect(error).toHaveAttribute("data-tone", "danger");
    expect(warning).toHaveTextContent("WARN");
    expect(warning).toHaveAttribute("data-tone", "warning");
    // Nothing is read until it is pressed.
    expect(fetchCephResourcesMock).not.toHaveBeenCalled();
  });

  test("pressed, it opens why, titled with the cluster and Ceph's verdict", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CephClusterHealthPill cluster={CLUSTER} />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`ceph-cluster-health-${CLUSTER_ID.toString()}`),
      );
    });

    const dialogId: string = `ceph-cluster-health-${CLUSTER_ID.toString()}-dialog`;

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Why ceph-prod reports HEALTH_ERR",
    );

    const items: Array<HTMLElement> = within(
      screen.getByTestId(dialogId),
    ).getAllByTestId(`${dialogId}-item`);

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-key");
      }),
    ).toEqual(["Cluster", "Osd:osd.2"]);
    expect(
      within(items[0]!).getAllByTestId(`${dialogId}-reason`)[0],
    ).toHaveTextContent("OSD_DOWN");
    expect(
      within(items[0]!).getByTestId(`${dialogId}-view`).getAttribute("href"),
    ).toContain(`/ceph/${CLUSTER_ID.toString()}`);
  });
});

describe("an App Platforms environment's status", () => {
  test("is the Status column's rule: connected, gone quiet, or never heard from", () => {
    expect(
      getCloudEnvironmentStatus({
        otelCollectorStatus: "connected",
        lastSeenAt: NOW,
      }),
    ).toBe(CloudEnvironmentStatus.Connected);
    expect(
      getCloudEnvironmentStatus({
        otelCollectorStatus: "disconnected",
        lastSeenAt: NOW,
      }),
    ).toBe(CloudEnvironmentStatus.Disconnected);
    // A row that never reported stores no status.
    expect(
      getCloudEnvironmentStatus({ otelCollectorStatus: null, lastSeenAt: NOW }),
    ).toBe(CloudEnvironmentStatus.Disconnected);
    for (const otelCollectorStatus of [null, undefined, "disconnected"]) {
      expect(
        getCloudEnvironmentStatus({
          otelCollectorStatus: otelCollectorStatus,
          lastSeenAt: null,
        }),
      ).toBe(CloudEnvironmentStatus.Waiting);
    }
  });

  test("as queries: each status the same rule, any status but connected read as not connected", () => {
    expect(
      buildCloudEnvironmentStatusQuery(CloudEnvironmentStatus.Connected),
    ).toEqual({ otelCollectorStatus: "connected" });

    const disconnected: JSONObject = buildCloudEnvironmentStatusQuery(
      CloudEnvironmentStatus.Disconnected,
    ) as unknown as JSONObject;

    // A row that never reported stores none: NotEqualOrNull keeps it.
    expect(disconnected["otelCollectorStatus"]).toBeInstanceOf(NotEqualOrNull);
    expect(
      (disconnected["otelCollectorStatus"] as unknown as NotEqualOrNull<string>)
        .value,
    ).toBe("connected");
    expect(disconnected["lastSeenAt"]).toBeInstanceOf(NotNull);

    const waiting: JSONObject = buildCloudEnvironmentStatusQuery(
      CloudEnvironmentStatus.Waiting,
    ) as unknown as JSONObject;

    expect(waiting["otelCollectorStatus"]).toBeInstanceOf(NotEqualOrNull);
    expect(waiting["lastSeenAt"]).toBeInstanceOf(IsNull);
  });

  /*
   * Every row the Status column can draw, against each status's query read
   * the way Postgres reads it: the queries split the rows exactly as the
   * column does, whatever the status column holds.
   */
  const ENVIRONMENT_ROWS: Array<{
    otelCollectorStatus: string | null;
    lastSeenAt: Date | null;
  }> = [
    { otelCollectorStatus: "connected", lastSeenAt: NOW },
    { otelCollectorStatus: "connected", lastSeenAt: null },
    { otelCollectorStatus: "disconnected", lastSeenAt: NOW },
    { otelCollectorStatus: "disconnected", lastSeenAt: null },
    { otelCollectorStatus: null, lastSeenAt: NOW },
    { otelCollectorStatus: null, lastSeenAt: null },
    // A status the collector path never writes, read as not connected.
    { otelCollectorStatus: "error", lastSeenAt: NOW },
    { otelCollectorStatus: "error", lastSeenAt: null },
  ];

  const matchesGroup: (
    group: FilterGroup,
    row: { otelCollectorStatus: string | null; lastSeenAt: Date | null },
  ) => boolean = (
    group: FilterGroup,
    row: { otelCollectorStatus: string | null; lastSeenAt: Date | null },
  ): boolean => {
    return Object.entries(group).every(
      ([column, expected]: [string, unknown]): boolean => {
        const actual: unknown = (row as Record<string, unknown>)[column];

        if (expected instanceof IsNull) {
          return actual === null;
        }

        if (expected instanceof NotNull) {
          return actual !== null;
        }

        if (expected instanceof NotEqualOrNull) {
          return actual === null || actual !== expected.value;
        }

        return actual === expected;
      },
    );
  };

  test.each(Object.values(CloudEnvironmentStatus))(
    "the %s query selects exactly the rows the Status column draws so",
    (status: CloudEnvironmentStatus) => {
      const group: FilterGroup = buildCloudEnvironmentStatusQuery(
        status,
      ) as unknown as FilterGroup;

      for (const row of ENVIRONMENT_ROWS) {
        expect({ row, selected: matchesGroup(group, row) }).toEqual({
          row,
          selected: getCloudEnvironmentStatus(row) === status,
        });
      }
    },
  );

  // Every set of statuses a person can pick: one, two or all three.
  const PICKS: Array<Array<CloudEnvironmentStatus>> = [
    [CloudEnvironmentStatus.Connected],
    [CloudEnvironmentStatus.Disconnected],
    [CloudEnvironmentStatus.Waiting],
    [CloudEnvironmentStatus.Connected, CloudEnvironmentStatus.Disconnected],
    [CloudEnvironmentStatus.Connected, CloudEnvironmentStatus.Waiting],
    [CloudEnvironmentStatus.Disconnected, CloudEnvironmentStatus.Waiting],
    Object.values(CloudEnvironmentStatus),
  ];

  test.each(PICKS)(
    "the Status chip set to %s is one filter of the list's own query: 'is' selects exactly those rows, 'is not' exactly the others",
    (...picked: Array<CloudEnvironmentStatus>) => {
      for (const operator of ["is", "is_not"] as const) {
        const filter: FilterGroups | null = buildCloudEnvironmentStatusFilter(
          picked,
          operator,
        );

        expect(filter).toBeInstanceOf(FilterGroups);
        expect(filter!.match).toBe(
          operator === "is"
            ? FilterGroupsMatch.AnyOf
            : FilterGroupsMatch.NoneOf,
        );
        expect(filter!.groups).toHaveLength(picked.length);

        for (const row of ENVIRONMENT_ROWS) {
          const anyGroup: boolean = filter!.groups.some(
            (group: FilterGroup): boolean => {
              return matchesGroup(group, row);
            },
          );
          const isPicked: boolean = picked.includes(
            getCloudEnvironmentStatus(row),
          );

          expect({
            row,
            selected: operator === "is" ? anyGroup : !anyGroup,
          }).toEqual({
            row,
            selected: operator === "is" ? isPicked : !isPicked,
          });
        }
      }
    },
  );

  test("the Status chip reads nothing first: the server answers it", () => {
    buildCloudEnvironmentStatusFilter(
      [CloudEnvironmentStatus.Disconnected, CloudEnvironmentStatus.Waiting],
      "is",
    );

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a status picked twice is one group, and a value that is no status is left out", () => {
    const filter: FilterGroups | null = buildCloudEnvironmentStatusFilter(
      [
        CloudEnvironmentStatus.Disconnected,
        "not-a-status",
        CloudEnvironmentStatus.Disconnected,
      ],
      "is",
    );

    expect(filter!.groups).toEqual([
      buildCloudEnvironmentStatusQuery(CloudEnvironmentStatus.Disconnected),
    ]);
  });

  test("no status picked, or none a status is called by, filters nothing", () => {
    expect(buildCloudEnvironmentStatusFilter([], "is")).toBeNull();
    expect(buildCloudEnvironmentStatusFilter(["nope"], "is_not")).toBeNull();
  });

  test("the chip offers the three, worded as the Status column words them, and writes its filter under filterGroups", () => {
    const facet: ReturnType<typeof getEnvironmentStatusFacet> =
      getEnvironmentStatusFacet();

    expect(facet.key).toBe(ENVIRONMENT_STATUS_FACET_KEY);
    expect(facet.isMultiSelect).toBe(true);
    expect(facet.supportedOperators).toEqual(["is", "is_not"]);
    expect(
      (facet.options || []).map((option: { value: string; label: string }) => {
        return [option.value, option.label];
      }),
    ).toEqual([
      [
        "connected",
        CLOUD_ENVIRONMENT_STATUS_LABELS[CloudEnvironmentStatus.Connected],
      ],
      [
        "disconnected",
        CLOUD_ENVIRONMENT_STATUS_LABELS[CloudEnvironmentStatus.Disconnected],
      ],
      [
        "waiting",
        CLOUD_ENVIRONMENT_STATUS_LABELS[CloudEnvironmentStatus.Waiting],
      ],
    ]);

    const written: ReturnType<typeof buildFacetColumnQuery> =
      buildFacetColumnQuery({
        facet: facet,
        operator: "is_not",
        values: ["disconnected"],
        existingValue: undefined,
      });

    expect(written?.field).toBe(FILTER_GROUPS_QUERY_KEY);
    expect(written?.value).toBeInstanceOf(FilterGroups);
    expect((written?.value as FilterGroups).match).toBe(
      FilterGroupsMatch.NoneOf,
    );

    // As it crosses the wire to the list route, and back.
    const sent: JSONObject = JSONFunctions.deserialize(
      JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize({
            [FILTER_GROUPS_QUERY_KEY]: written!.value,
          } as unknown as JSONObject),
        ),
      ) as JSONObject,
    );

    expect(sent[FILTER_GROUPS_QUERY_KEY]).toBeInstanceOf(FilterGroups);
    expect(
      (sent[FILTER_GROUPS_QUERY_KEY] as FilterGroups).groups[0]![
        "otelCollectorStatus"
      ],
    ).toBeInstanceOf(NotEqualOrNull);
  });
});

describe("All Environments, opened from a count", () => {
  test("with the Status chip set to Disconnected", () => {
    const state: JSONObject = facetStateOf(
      getAppPlatformsEnvironmentsRoute([], {
        statuses: [CloudEnvironmentStatus.Disconnected],
      }),
    );

    expect(state["facetSelections"]).toEqual({
      [ENVIRONMENT_STATUS_FACET_KEY]: ["disconnected"],
    });
    expect(state["facetOperators"]).toEqual({
      [ENVIRONMENT_STATUS_FACET_KEY]: "is",
    });
  });

  test("with an account and a status, both chips", () => {
    const state: JSONObject = facetStateOf(
      getAppPlatformsEnvironmentsRoute([" 123456789012 "], {
        statuses: [
          CloudEnvironmentStatus.Disconnected,
          CloudEnvironmentStatus.Disconnected,
        ],
      }),
    );

    expect(state["facetSelections"]).toEqual({
      [CLOUD_ACCOUNT_FACET_KEY]: ["123456789012"],
      [ENVIRONMENT_STATUS_FACET_KEY]: ["disconnected"],
    });
  });

  test("with neither, the whole list, as before", () => {
    const route: Route = getAppPlatformsEnvironmentsRoute();

    expect(route.toString()).not.toContain("?");
  });
});

describe("App Platforms' Environments tile", () => {
  const COUNTS: CloudFleetCounts = {
    total: 6,
    connected: 3,
    waiting: 1,
    disconnected: 2,
    byProvider: { aws: 6 },
    liveInstances: 4,
    apps: 5,
    runningApps: 5,
    deploys: 0,
  };
  const DISCONNECTED_ROUTE: Route = new Route("/environments?status=quiet");

  function environmentsTile(counts: CloudFleetCounts): CloudFleetSummaryTile {
    return summarizeCloudFleet(counts, {
      disconnectedEnvironmentsRoute: DISCONNECTED_ROUTE,
    }).find((tile: CloudFleetSummaryTile): boolean => {
      return tile.title === "Environments";
    }) as CloudFleetSummaryTile;
  }

  test("its disconnected line opens those environments", () => {
    const tile: CloudFleetSummaryTile = environmentsTile(COUNTS);

    expect(tile.sublabel).toBe("2 environments disconnected");
    expect(tile.sublabelRoute).toBe(DISCONNECTED_ROUTE);
    expect(tile.sublabelRouteTitle).toBe(SHOW_DISCONNECTED_ENVIRONMENTS);
  });

  test("with none disconnected, the line opens nothing", () => {
    for (const counts of [
      { ...COUNTS, connected: 5, disconnected: 0 },
      { ...COUNTS, connected: 6, waiting: 0, disconnected: 0 },
    ]) {
      const tile: CloudFleetSummaryTile = environmentsTile(counts);

      expect(tile.sublabelRoute).toBeUndefined();
      expect(tile.sublabelRouteTitle).toBeUndefined();
    }
  });

  test("no other tile opens anything", () => {
    for (const tile of summarizeCloudFleet(COUNTS, {
      disconnectedEnvironmentsRoute: DISCONNECTED_ROUTE,
    })) {
      if (tile.title !== "Environments") {
        expect(tile.sublabelRoute).toBeUndefined();
      }
    }
  });
});
