import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import NetworkDeviceMonitoringMethod, {
  LEGACY_SNMP_MONITORING_METHOD,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PositiveNumber from "Common/Types/PositiveNumber";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getFleetSummary: jest.fn(),
      getHealthGroups: jest.fn(),
      getVendorBreakdown: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getStatusCounts: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkEndpointService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * Importing the API module registers its routes on the mocked router, so the
 * overview handler can be driven directly with every service call observable.
 */
import NetworkSummaryAPI from "../../FeatureSet/BaseAPI/API/NetworkSummary";

new NetworkSummaryAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const deviceService: {
  findBy: jest.Mock;
  getHealthGroups: jest.Mock;
  getVendorBreakdown: jest.Mock;
} = NetworkDeviceService as unknown as {
  findBy: jest.Mock;
  getHealthGroups: jest.Mock;
  getVendorBreakdown: jest.Mock;
};
const siteService: { findBy: jest.Mock; getStatusCounts: jest.Mock } =
  NetworkSiteService as unknown as {
    findBy: jest.Mock;
    getStatusCounts: jest.Mock;
  };
const endpointService: { countBy: jest.Mock } =
  NetworkEndpointService as unknown as { countBy: jest.Mock };
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

/*
 * The five bounded reads the attention list is assembled from, named. They
 * are told apart by the shape of the query rather than by call order, so a
 * harmless reordering of the reads does not silently re-point a test's rows
 * at a different bucket — which would let an assertion keep passing while
 * describing something that no longer happens.
 */
interface AttentionReads {
  neverAnswered?: Array<NetworkDevice> | undefined;
  unreachable?: Array<NetworkDevice> | undefined;
  monitorOffline?: Array<NetworkDevice> | undefined;
  snmpFailing?: Array<NetworkDevice> | undefined;
  degraded?: Array<NetworkDevice> | undefined;
}

type ReadKind = keyof AttentionReads;

function kindOfQuery(query: JSONObject): ReadKind {
  if (query["monitoringMethod"]) {
    return "monitorOffline";
  }

  if (query["interfacesDown"]) {
    return "degraded";
  }

  if (query["isSnmpReachable"] === false) {
    return "snmpFailing";
  }

  // Both remaining reads filter isReachable=false; only their sort differs.
  return "neverAnswered";
}

function respondTo(reads: AttentionReads): void {
  deviceService.findBy.mockImplementation((options: unknown): unknown => {
    const call: JSONObject = options as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;
    const sort: JSONObject = (call["sort"] || {}) as JSONObject;

    let kind: ReadKind = kindOfQuery(query);

    /*
     * "Never answered" and "answered once, not any more" are the same query
     * apart from a NULL check compiled into a Raw operator; the sort is what
     * separates them readably. The never-answered read deliberately has no
     * sort at all — see the endpoint's comment about NULLS LAST.
     */
    if (kind === "neverAnswered" && sort["lastSeenAt"]) {
      kind = "unreachable";
    }

    return Promise.resolve(reads[kind] || []);
  });
}

function findByCallFor(kind: ReadKind): JSONObject {
  for (const call of deviceService.findBy.mock.calls) {
    const options: JSONObject = call[0] as JSONObject;
    const query: JSONObject = options["query"] as JSONObject;
    const sort: JSONObject = (options["sort"] || {}) as JSONObject;

    let candidate: ReadKind = kindOfQuery(query);
    if (candidate === "neverAnswered" && sort["lastSeenAt"]) {
      candidate = "unreachable";
    }

    if (candidate === kind) {
      return options;
    }
  }

  throw new Error(`No attention-list read matched "${kind}".`);
}

type CallOverviewFunction = () => Promise<NextFunction>;

const callOverview: CallOverviewFunction = async (): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: {} } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/network-device/overview")
    .handlerFunction(req, mockResponse, next);
  return next;
};

function attentionDevices(): JSONArray {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const body: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return body["attentionDevices"] as JSONArray;
}

function namesOnList(): Array<string> {
  return attentionDevices().map((row: JSONObject): string => {
    return row["name"] as string;
  });
}

function rowNamed(name: string): JSONObject | undefined {
  return attentionDevices().find((row: JSONObject): boolean => {
    return row["name"] === name;
  });
}

const OFFLINE_STATUS: MonitorStatus = new MonitorStatus(ObjectID.generate());
OFFLINE_STATUS.name = "Offline";
OFFLINE_STATUS.isOperationalState = false;
OFFLINE_STATUS.isOfflineState = true;

/*
 * A device polled a moment ago, so freshness plays no part in any verdict
 * below and every assertion is about `isReachable` / `isSnmpReachable` and
 * the monitoring method alone.
 */
function makeDevice(data: {
  name: string;
  isReachable?: boolean | undefined;
  isSnmpReachable?: boolean | null | undefined;
  interfacesDown?: number | undefined;
  monitoringMethod?: string | undefined;
  monitorStatusIsOffline?: boolean | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.name = data.name;
  device.lastPolledAt = new Date();
  device.pollingIntervalInMinutes = 5;
  device.interfacesDown = data.interfacesDown ?? 0;
  device.monitoringMethod = (data.monitoringMethod ??
    NetworkDeviceMonitoringMethod.Probe) as NetworkDeviceMonitoringMethod;

  if (data.isReachable !== undefined) {
    device.isReachable = data.isReachable;
  }

  if (data.isReachable) {
    device.lastSeenAt = new Date();
  }

  if (data.isSnmpReachable !== undefined && data.isSnmpReachable !== null) {
    device.isSnmpReachable = data.isSnmpReachable;
  }

  if (data.monitorStatusIsOffline !== undefined) {
    const status: MonitorStatus = new MonitorStatus(ObjectID.generate());
    status.isOfflineState = data.monitorStatusIsOffline;
    device.currentMonitorStatus = status;
  }

  return device;
}

/*
 * Issue #3562 — "SNMP failing" as a state of its own.
 *
 * Every device is now PINGED by its probe, and additionally WALKED over SNMP
 * only when credentials resolve for it. Reachability is "ping answered OR the
 * walk succeeded", so a switch whose community string was rotated out from
 * under it still answers ping and is, correctly, Up: it is not an outage and
 * must not be counted as one.
 *
 * But it is not healthy either. Its interfaces, its inventory and its
 * neighbour tables stopped refreshing the day the walk broke, and every
 * number the product shows for it is frozen at whatever the last successful
 * walk found. Nothing else on the Overview would ever mention it — the fleet
 * tally calls it Up, and the dark-ports read below only fires on
 * interfacesDown > 0, which on a frozen row is a week-old claim.
 *
 * So the attention list grew a third bucket between "down" and "dark ports",
 * and the rows it emits carry `isSnmpFailing` so the Overview can say WHY an
 * Up device is on a list of things to look at.
 */
describe("POST /network-device/overview — the SNMP-failing attention bucket", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: projectId,
    } as never);
    monitorStatusService.findBy.mockResolvedValue([OFFLINE_STATUS] as never);
    siteService.getStatusCounts.mockResolvedValue([] as never);
    siteService.findBy.mockResolvedValue([] as never);
    deviceService.getHealthGroups.mockResolvedValue([] as never);
    deviceService.getVendorBreakdown.mockResolvedValue([] as never);
    endpointService.countBy.mockResolvedValue(new PositiveNumber(0) as never);
    respondTo({});
  });

  test("a device that answers ping but fails its walk is on the list, flagged as the walk and not as dark ports", async () => {
    respondTo({
      snmpFailing: [
        makeDevice({
          name: "branch-sw1",
          isReachable: true,
          isSnmpReachable: false,
        }),
      ],
    });

    const next: NextFunction = await callOverview();
    expect(next).not.toHaveBeenCalled();

    const row: JSONObject | undefined = rowNamed("branch-sw1");
    expect(row).toBeDefined();
    // Up, because ping answers — the same verdict its own row in the list has.
    expect(row!["isDown"]).toBe(false);
    /*
     * ...and this is what stops the Overview printing "0 interfaces down"
     * beside it, which would be true and no help at all.
     */
    expect(row!["isSnmpFailing"]).toBe(true);
  });

  test("the read is bounded and ordered by how long the walk has been broken", async () => {
    await callOverview();

    const options: JSONObject = findByCallFor("snmpFailing");
    const query: JSONObject = options["query"] as JSONObject;

    // Ping answering is what makes this bucket different from "down".
    expect(query["isReachable"]).toBe(true);
    expect(query["isSnmpReachable"]).toBe(false);
    expect(query["isArchived"]).toBe(false);

    /*
     * Longest-broken first, and ASC is NULLS LAST in Postgres — so a device
     * whose walk has never once succeeded sorts behind one that broke last
     * week rather than ahead of the whole list.
     */
    expect((options["sort"] as JSONObject)["lastSnmpSeenAt"]).toBe(
      SortOrder.Ascending,
    );
    // Exactly the rows the teaser shows; this read must not become a fleet scan.
    expect(options["limit"]).toBe(8);
  });

  test("the row's own walk columns are selected, or the flag it carries is decided on undefined", async () => {
    await callOverview();

    const select: JSONObject = findByCallFor("snmpFailing")[
      "select"
    ] as JSONObject;
    expect(select["isSnmpReachable"]).toBe(true);
    // What the sort orders by has to come back with the row.
    expect(select["lastSnmpSeenAt"]).toBe(true);
    // And what decides whether the stamp or the poll judges it.
    expect(select["monitoringMethod"]).toBe(true);
  });

  /*
   * The predicate is applied to the rows the query returned, not assumed from
   * the fact that the query returned them: SQL narrows, the shared rule
   * judges. A row that changed between the read and the verdict — or a filter
   * someone loosens later — must not be able to put a DOWN device on the list
   * wearing an "SNMP failing" label, which would read as "it answers ping"
   * about a device that answers nothing.
   */
  test("a device the shared rule calls Down is not admitted by the SNMP read", async () => {
    respondTo({
      snmpFailing: [
        makeDevice({
          name: "dead-sw",
          isReachable: false,
          isSnmpReachable: false,
        }),
      ],
    });

    await callOverview();

    expect(namesOnList()).toEqual([]);
  });

  /*
   * A monitor-backed device is never polled and never walked, so its walk
   * column is NULL by construction. If one ever carries a stale `false` —
   * a device switched from Probe to Monitor before the residue reset landed,
   * say — it must not resurface as "SNMP failing" for a walk nothing is
   * running.
   */
  test("a monitor-backed device is never labelled SNMP failing, however its walk column reads", async () => {
    respondTo({
      snmpFailing: [
        makeDevice({
          name: "bound-ap",
          isReachable: true,
          isSnmpReachable: false,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
          // Its monitor says it is fine, so the shared rule calls it Up.
          monitorStatusIsOffline: false,
        }),
      ],
    });

    await callOverview();

    expect(namesOnList()).toEqual([]);
  });

  /*
   * The legacy column values. Rows written before ping-first polling hold
   * "SNMP" or NULL, and both parse to Probe — they are probe-polled devices
   * whose walk really can fail. A predicate that compared the raw string to
   * "Probe" would drop every one of them from this bucket, which on an
   * upgraded install is the entire fleet.
   */
  test('a legacy "SNMP" row is probe-polled, so its failing walk still counts', async () => {
    respondTo({
      snmpFailing: [
        makeDevice({
          name: "legacy-sw",
          isReachable: true,
          isSnmpReachable: false,
          monitoringMethod: LEGACY_SNMP_MONITORING_METHOD,
        }),
      ],
    });

    await callOverview();

    expect(rowNamed("legacy-sw")?.["isSnmpFailing"]).toBe(true);
  });

  /*
   * Order is the whole point of a teaser capped at eight rows: what falls off
   * the end must be the least urgent thing. A device that is not answering at
   * all outranks one that answers but has stopped reporting its interfaces,
   * which outranks one that is reporting dark ports perfectly well.
   */
  test("down outranks a failing walk, which outranks dark ports", async () => {
    respondTo({
      unreachable: [makeDevice({ name: "down-rtr", isReachable: false })],
      snmpFailing: [
        makeDevice({
          name: "walk-broken-sw",
          isReachable: true,
          isSnmpReachable: false,
        }),
      ],
      degraded: [
        makeDevice({
          name: "dark-ports-sw",
          isReachable: true,
          interfacesDown: 3,
        }),
      ],
    });

    await callOverview();

    expect(namesOnList()).toEqual([
      "down-rtr",
      "walk-broken-sw",
      "dark-ports-sw",
    ]);

    // And only the middle one claims the walk as its reason.
    expect(rowNamed("down-rtr")?.["isSnmpFailing"]).toBe(false);
    expect(rowNamed("dark-ports-sw")?.["isSnmpFailing"]).toBe(false);
  });

  /*
   * The reads overlap by design — one device can satisfy several — and the
   * list de-duplicates on device id. Without it a single broken switch could
   * take three of the eight rows and hide two other outages.
   */
  test("a device already listed as down is not listed a second time by the walk read", async () => {
    const sameSwitch: NetworkDevice = makeDevice({
      name: "double-listed-sw",
      isReachable: false,
      isSnmpReachable: false,
    });

    respondTo({
      unreachable: [sameSwitch],
      snmpFailing: [sameSwitch],
    });

    await callOverview();

    expect(namesOnList()).toEqual(["double-listed-sw"]);
  });

  /*
   * And the dark-ports read excludes the failing-walk rows outright, in SQL.
   * A device whose walk broke keeps the interface counts the last successful
   * walk left behind, so "3 interfaces down" on such a row is a week-old
   * claim about ports that may all be up. NULL is deliberately let through:
   * a row written before the column existed still carries counts a walk
   * really did collect.
   */
  test("the dark-ports read refuses rows whose interface counts are frozen by a failing walk", async () => {
    await callOverview();

    const query: JSONObject = findByCallFor("degraded")["query"] as JSONObject;
    expect(query["isReachable"]).toBe(true);
    // A Raw operator rather than a literal, because it has to admit NULL too.
    expect(query["isSnmpReachable"]).toBeDefined();
    expect(query["isSnmpReachable"]).not.toBe(false);
  });
});
