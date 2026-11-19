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
  buildCloudEnvironmentStatusQuery,
  computeCloudEnvironmentIdsForStatuses,
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
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Route from "../../../Types/API/Route";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
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

  test("as queries: each status the same rule, a NULL status read as not connected", () => {
    expect(
      buildCloudEnvironmentStatusQuery(CloudEnvironmentStatus.Connected),
    ).toEqual({ otelCollectorStatus: "connected" });

    const disconnected: JSONObject = buildCloudEnvironmentStatusQuery(
      CloudEnvironmentStatus.Disconnected,
    ) as unknown as JSONObject;

    expect(disconnected["otelCollectorStatus"]).toBeInstanceOf(EqualToOrNull);
    expect(
      (disconnected["otelCollectorStatus"] as unknown as EqualToOrNull<string>)
        .value,
    ).toBe("disconnected");
    expect(disconnected["lastSeenAt"]).toBeInstanceOf(NotNull);

    const waiting: JSONObject = buildCloudEnvironmentStatusQuery(
      CloudEnvironmentStatus.Waiting,
    ) as unknown as JSONObject;

    expect(waiting["otelCollectorStatus"]).toBeInstanceOf(EqualToOrNull);
    expect(waiting["lastSeenAt"]).toBeInstanceOf(IsNull);
  });

  test("the Status chip resolves the statuses picked to the listed environments' ids, unioned", async () => {
    getListMock.mockImplementation(((data: { query: JSONObject }) => {
      const lastSeenAt: unknown = data.query["lastSeenAt"];
      return Promise.resolve({
        data:
          lastSeenAt instanceof NotNull
            ? [{ _id: "env-quiet" }]
            : lastSeenAt instanceof IsNull
              ? [{ _id: "env-new" }, { _id: "env-quiet" }]
              : [],
        count: 0,
      });
    }) as never);

    const ids: Array<string> = await computeCloudEnvironmentIdsForStatuses(
      PROJECT_ID,
      [
        CloudEnvironmentStatus.Disconnected,
        CloudEnvironmentStatus.Waiting,
        "not-a-status",
        CloudEnvironmentStatus.Disconnected,
      ],
    );

    expect(ids.sort()).toEqual(["env-new", "env-quiet"]);
    // One read a status, of this project's listed environments.
    expect(getListMock).toHaveBeenCalledTimes(2);

    const query: JSONObject = (
      getListMock.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["isArchived"]).toBe(false);
    expect(query["cloudResourceKind"]).toBe(CloudResourceKind.Environment);
    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(CloudResource);
  });

  test("a status nobody picked reads nothing", async () => {
    expect(
      await computeCloudEnvironmentIdsForStatuses(PROJECT_ID, ["nope"]),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("the chip offers the three, worded as the Status column words them, and resolves through its own rule", async () => {
    const resolve: MockFunction = getJestMockFunction();
    resolve.mockResolvedValue(["env-1"] as never);

    const facet: ReturnType<typeof getEnvironmentStatusFacet> =
      getEnvironmentStatusFacet(
        resolve as unknown as (
          projectId: ObjectID,
          values: Array<string>,
        ) => Promise<Array<string>>,
      );

    expect(facet.key).toBe(ENVIRONMENT_STATUS_FACET_KEY);
    expect(facet.isMultiSelect).toBe(true);
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
    expect(
      await facet.computeMatchingResourceIds!(
        PROJECT_ID,
        ["disconnected"],
        "is",
      ),
    ).toEqual(["env-1"]);
    expect(resolve).toHaveBeenCalledWith(PROJECT_ID, ["disconnected"]);
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
