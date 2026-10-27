import ChangeEvent from "../../../../../Models/AnalyticsModels/ChangeEvent";
import Host from "../../../../../Models/DatabaseModels/Host";
import InventoryItem from "../../../../../Models/DatabaseModels/InventoryItem";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import HostOwnerTeamService from "../../../../../Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../../../Server/Services/HostOwnerUserService";
import HostService from "../../../../../Server/Services/HostService";
import InventoryItemService from "../../../../../Server/Services/InventoryItemService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import NetworkFlowService from "../../../../../Server/Services/NetworkFlowService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import ServiceOwnerTeamService from "../../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../../Server/Services/ServiceOwnerUserService";
import StatusPageResourceService from "../../../../../Server/Services/StatusPageResourceService";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../Server/Utils/Logger";
import SecurityCaseImpact, {
  buildFlowPeersStatement,
  buildReachedRequestsStatement,
  getCaseAddresses,
} from "../../../../../Server/Utils/SecurityCase/Context/SecurityCaseImpact";
import SecurityConnections from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TopologyQueries from "../../../../../Server/Utils/Topology/TopologyQueries";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseExposureEvidenceKind,
  SecurityCaseImpactJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseImpactSource,
  SecurityCaseInternetExposure,
} from "../../../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  TopologyConnectionRowJSON,
  TopologyConnectionSectionJSON,
  TopologyEntityResponseJSON,
} from "../../../../../Types/Topology/TopologyApi";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a case puts at risk: what its records call and what calls them, the
 * monitors and status pages watching them, who owns them, what last changed
 * on them, the machines its addresses talked to - and whether OneUptime has
 * seen them reached from the internet, on evidence only. With the reader's
 * own permissions; a refusal or a failure said, never shown as nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const HOST_ID: string = "44444444-4444-4444-8444-444444444444";
const ITEM_ID: string = "55555555-5555-4555-8555-555555555555";
const MONITOR_ID: string = "66666666-6666-4666-8666-666666666666";
const STATUS_PAGE_ID: string = "77777777-7777-4777-8777-777777777777";
const TEAM_ID: string = "88888888-8888-4888-8888-888888888888";
const USER_ID: string = "99999999-9999-4999-8999-999999999999";

const FIRST: Date = new Date("2026-10-27T06:00:00.000Z");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  tenantId: PROJECT_ID,
};

function at(minutes: number): Date {
  return new Date(FIRST.getTime() + minutes * 60 * 1000);
}

function connectedResource(
  kind: SecurityConnectionKind,
  id: string,
  name: string,
  extra: Partial<SecurityConnectedResourceJson> = {},
): SecurityConnectedResourceJson {
  return {
    kind,
    id,
    name,
    certainty: SecurityConnectionCertainty.Exact,
    matches: [],
    activeIncidents: { count: 0, items: [] },
    activeAlerts: { count: 0, items: [] },
    monitors: { count: 0, items: [] },
    recentChanges: [],
    ...extra,
  };
}

function connections(
  overrides: Partial<SecurityConnectionsJson> = {},
): SecurityConnectionsJson {
  return {
    windowStart: at(-30).toISOString(),
    windowEnd: at(90).toISOString(),
    resources: [
      connectedResource(
        SecurityConnectionKind.Service,
        SERVICE_ID,
        "checkout",
        {
          inventoryItemId: ITEM_ID,
          monitors: {
            count: 1,
            items: [{ id: MONITOR_ID, title: "Checkout API" }],
          },
        },
      ),
      connectedResource(SecurityConnectionKind.Host, HOST_ID, "web-1"),
    ],
    hasMoreResources: false,
    unmatched: [],
    unreadableKinds: [],
    failedKinds: [],
    ...overrides,
  };
}

function section(
  rows: Array<Partial<TopologyConnectionRowJSON>>,
): TopologyConnectionSectionJSON {
  return {
    total: rows.length,
    unknownTotal: 0,
    nextOffset: null,
    rows: rows.map((row: Partial<TopologyConnectionRowJSON>) => {
      return {
        relationshipType: "depends-on",
        direction: "out" as const,
        otherKey: "k",
        otherKnown: true,
        otherName: null,
        otherType: "Service",
        callCount: 1,
        errorCount: 0,
        avgDurationMs: 5,
        lastSeenAt: null,
        ...row,
      };
    }),
  };
}

function queryResult(rows: Array<JSONObject>): never {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows } as unknown as JSONObject;
    },
  } as never;
}

let permissionCheck: jest.SpyInstance;
let topologyRead: jest.SpyInstance;
let flowQuery: jest.SpyInstance;
let eventQuery: jest.SpyInstance;

function caseRead(entities: Array<JSONObject>): void {
  jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
    _id: CASE_ID.toString(),
    id: CASE_ID,
    projectId: PROJECT_ID,
    entities,
    createdAt: at(1),
    firstDetectedAt: at(0),
    lastDetectedAt: at(60),
  } as never);
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  caseRead([
    { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    { type: SecurityEntityType.Host, value: "web-1" },
  ]);
  jest.spyOn(SecurityConnections, "forCase").mockResolvedValue(connections());

  permissionCheck = jest
    .spyOn(ModelPermission, "checkReadQueryPermission")
    .mockResolvedValue({} as never);

  const item: InventoryItem = new InventoryItem();
  item._id = ITEM_ID;
  item.entityKey = "service:checkout";
  jest.spyOn(InventoryItemService, "findBy").mockResolvedValue([item]);

  topologyRead = jest.spyOn(TopologyQueries, "getEntity").mockResolvedValue({
    entity: { key: "service:checkout" },
    sections: {
      calls: section([
        { otherKey: "service:payments", otherName: "payments", callCount: 40 },
        { otherKey: "db:orders", otherName: "orders", otherType: "Database" },
      ]),
      calledBy: section([{ otherKey: "service:web", otherName: "web" }]),
      runsOn: section([{ otherKey: "host:web-1", otherName: "web-1" }]),
      related: section([]),
    },
    isScanLimited: false,
  } as unknown as TopologyEntityResponseJSON);

  jest.spyOn(ServiceOwnerTeamService, "findBy").mockResolvedValue([
    {
      serviceId: new ObjectID(SERVICE_ID),
      team: { _id: TEAM_ID, name: "Payments" },
    },
  ] as never);
  jest.spyOn(ServiceOwnerUserService, "findBy").mockResolvedValue([
    {
      serviceId: new ObjectID(SERVICE_ID),
      user: { _id: USER_ID, name: "", email: "kim@acme.example" },
    },
  ] as never);
  jest.spyOn(HostOwnerTeamService, "findBy").mockResolvedValue([]);
  jest.spyOn(HostOwnerUserService, "findBy").mockResolvedValue([]);

  const deploy: ChangeEvent = new ChangeEvent();
  deploy._id = new ObjectID("abababab-abab-4bab-8bab-abababababab");
  deploy.time = at(-120);
  deploy.title = "checkout v1.4.2";
  deploy.eventType = "deployment";
  deploy.primaryEntityId = new ObjectID(SERVICE_ID);
  deploy.attributes = { "service.version": "v1.4.2" } as never;
  jest.spyOn(ChangeEventService, "findBy").mockResolvedValue([deploy]);

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation(async (data: unknown): Promise<Array<Monitor>> => {
      return (data as { query: JSONObject }).query["services"] ? [monitor] : [];
    });

  const shown: StatusPageResource = new StatusPageResource();
  shown.statusPageId = new ObjectID(STATUS_PAGE_ID);
  shown.monitorId = new ObjectID(MONITOR_ID);
  const page: StatusPage = new StatusPage();
  page.name = "Acme Status";
  shown.statusPage = page;
  jest.spyOn(StatusPageResourceService, "findBy").mockResolvedValue([shown]);

  // Every device's flows: a project-wide read, nothing blocked.
  jest
    .spyOn(TelemetryReadAccess, "getScope")
    .mockResolvedValue({ readableIds: null, blockedIds: [] } as never);
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({} as never);
  flowQuery = jest.spyOn(NetworkFlowService, "executeQuery").mockResolvedValue(
    queryResult([
      {
        caseAddress: "203.0.113.7",
        peerAddress: "10.0.3.17",
        direction: "out",
        bytes: "1048576",
        packets: "900",
        lastSeen: "2026-10-27 06:40:00.000000000",
      },
    ]),
  );
  eventQuery = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockResolvedValue(
      queryResult([
        {
          principalIp: "203.0.113.7",
          requestOutcome: "Reached App",
          firstSeen: "2026-10-27 06:05:00.000000000",
        },
      ]),
    );

  const host: Host = new Host();
  host._id = HOST_ID;
  host.name = "web-1";
  host.hostIpAddresses = "10.0.0.5, 198.51.100.20";
  jest.spyOn(HostService, "findBy").mockResolvedValue([host]);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function impact(): Promise<SecurityCaseImpactJson> {
  const read: SecurityCaseImpactJson | null = await SecurityCaseImpact.build({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    props: CALLER,
    now: NOW,
  });

  expect(read).not.toBeNull();

  return read!;
}

function recordOf(
  json: SecurityCaseImpactJson,
  kind: SecurityConnectionKind,
): SecurityCaseImpactRecordJson {
  return json.records.find((record: SecurityCaseImpactRecordJson): boolean => {
    return record.kind === kind;
  })!;
}

describe("SecurityCaseImpact.build", () => {
  test("a case the reader may not read, or of another project, has no impact", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);

    expect(
      await SecurityCaseImpact.build({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("says what each record calls, what calls it and what it runs on", async () => {
    const service: SecurityCaseImpactRecordJson = recordOf(
      await impact(),
      SecurityConnectionKind.Service,
    );

    expect(
      service.calls?.map((peer: { name: string }): string => {
        return peer.name;
      }),
    ).toEqual(["payments", "orders"]);
    expect(service.calledBy?.[0]?.name).toBe("web");
    expect(service.runsOn?.[0]?.name).toBe("web-1");
    expect(topologyRead).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        entityKey: "service:checkout",
      }),
    );
    // A record with no inventory item has no place on the map: not known.
    expect(
      recordOf(await impact(), SecurityConnectionKind.Host).calls,
    ).toBeNull();
  });

  test("reads the service map over the last week, as the Topology pages allow", async () => {
    await impact();

    const request: { rangeStart: Date } = topologyRead.mock.calls[0]![0] as {
      rangeStart: Date;
    };

    expect(request.rangeStart.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(permissionCheck).toHaveBeenCalledTimes(2);
  });

  test("says who owns each record, the monitors watching it and the status pages that show them", async () => {
    const json: SecurityCaseImpactJson = await impact();
    const service: SecurityCaseImpactRecordJson = recordOf(
      json,
      SecurityConnectionKind.Service,
    );

    expect(service.owners).toEqual({
      teams: [{ id: TEAM_ID, name: "Payments" }],
      users: [{ id: USER_ID, name: "kim@acme.example" }],
    });
    expect(recordOf(json, SecurityConnectionKind.Host).owners).toEqual({
      teams: [],
      users: [],
    });
    expect(service.monitors).toEqual({
      count: 1,
      items: [{ id: MONITOR_ID, title: "Checkout API" }],
    });
    expect(json.statusPages).toEqual([
      { id: STATUS_PAGE_ID, name: "Acme Status", monitorIds: [MONITOR_ID] },
    ]);
  });

  test("says what last changed on each record before the first detection, with its version", async () => {
    expect(
      recordOf(await impact(), SecurityConnectionKind.Service).lastChange,
    ).toEqual({
      id: "abababab-abab-4bab-8bab-abababababab",
      time: at(-120).toISOString(),
      title: "checkout v1.4.2",
      eventType: "deployment",
      version: "v1.4.2",
      isBeforeFirstDetection: true,
    });
  });

  test("lists the machines the case's addresses talked to, the busiest first", async () => {
    const json: SecurityCaseImpactJson = await impact();

    expect(json.flowPeers).toEqual([
      {
        caseAddress: "203.0.113.7",
        peerAddress: "10.0.3.17",
        direction: "out",
        bytes: 1048576,
        packets: 900,
        lastSeen: "2026-10-27T06:40:00.000Z",
      },
    ]);

    const statement: Statement = flowQuery.mock.calls[0]![0] as Statement;

    expect(Object.values(statement.query_params)).toContainEqual([
      "203.0.113.7",
    ]);
  });

  test("says the records are reachable from the internet, on evidence: a public request that reached the app, then a public address", async () => {
    const json: SecurityCaseImpactJson = await impact();

    expect(json.internet).toEqual({
      exposure: SecurityCaseInternetExposure.Yes,
      evidence: [
        {
          kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
          address: "203.0.113.7",
          time: at(5).toISOString(),
          requestOutcome: "Reached App",
        },
        {
          kind: SecurityCaseExposureEvidenceKind.PublicAddress,
          address: "198.51.100.20",
          recordName: "web-1",
        },
      ],
    });
    expect(json.unreadableSources).toEqual([]);
    expect(json.failedSources).toEqual([]);
    expect(eventQuery).toHaveBeenCalledTimes(1);
  });

  test("a case naming no address reads no flows and no requests, and knows nothing to say about the internet but its records' own addresses", async () => {
    caseRead([{ type: SecurityEntityType.Host, value: "web-1" }]);
    jest.spyOn(HostService, "findBy").mockResolvedValue([]);

    const json: SecurityCaseImpactJson = await impact();

    expect(flowQuery).not.toHaveBeenCalled();
    expect(eventQuery).not.toHaveBeenCalled();
    expect(json.flowPeers).toEqual([]);
    expect(json.internet).toEqual({
      exposure: SecurityCaseInternetExposure.Unknown,
      evidence: [],
    });
  });

  test("says which facts the reader's role cannot read, never showing them as nothing", async () => {
    permissionCheck.mockRejectedValue(new NotAuthorizedException("no"));
    jest
      .spyOn(ServiceOwnerTeamService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no"));
    jest
      .spyOn(TelemetryReadAccess, "getScope")
      .mockRejectedValue(new NotAuthorizedException("no"));

    const json: SecurityCaseImpactJson = await impact();
    const service: SecurityCaseImpactRecordJson = recordOf(
      json,
      SecurityConnectionKind.Service,
    );

    expect(json.unreadableSources).toEqual([
      SecurityCaseImpactSource.Dependencies,
      SecurityCaseImpactSource.NetworkFlows,
      SecurityCaseImpactSource.Owners,
    ]);
    expect(service.calls).toBeNull();
    expect(service.owners).toBeNull();
    expect(json.flowPeers).toBeNull();
    // The rest is still told.
    expect(json.statusPages).toHaveLength(1);
    expect(topologyRead).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("says which facts could not be read this time", async () => {
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    const json: SecurityCaseImpactJson = await impact();

    expect(json.statusPages).toBeNull();
    expect(json.failedSources).toEqual([SecurityCaseImpactSource.StatusPages]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("says some records are hidden when the reader's role cannot read every kind the case names", async () => {
    jest.spyOn(SecurityConnections, "forCase").mockResolvedValue(
      connections({
        unreadableKinds: [SecurityConnectionKind.NetworkDevice],
        hasMoreResources: true,
      }),
    );

    const json: SecurityCaseImpactJson = await impact();

    expect(json.unreadableSources).toEqual([SecurityCaseImpactSource.Records]);
    expect(json.hasMoreRecords).toBe(true);
  });

  test("reads every fact as the reader", async () => {
    await impact();

    for (const spy of [
      InventoryItemService.findBy,
      ServiceOwnerTeamService.findBy,
      ServiceOwnerUserService.findBy,
      ChangeEventService.findBy,
      MonitorService.findBy,
      StatusPageResourceService.findBy,
      HostService.findBy,
    ] as Array<unknown>) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ props: CALLER }),
      );
    }
  });
});

describe("the reads an impact is made of", () => {
  test("the case's addresses: each once, in one spelling, only its addresses", () => {
    expect(
      getCaseAddresses([
        { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
        { type: SecurityEntityType.IpAddress, value: " 203.0.113.7 " },
        { type: SecurityEntityType.IpAddress, value: "::ffff:203.0.113.7" },
        { type: SecurityEntityType.IpAddress, value: "2001:0DB8::7" },
        { type: SecurityEntityType.IpAddress, value: "not an address" },
        { type: SecurityEntityType.Host, value: "198.51.100.1" },
      ]),
    ).toEqual(["203.0.113.7", "2001:db8:0:0:0:0:0:7"]);
  });

  test("the flows' SQL binds the addresses and keeps to the reader's devices", () => {
    const statement: Statement = buildFlowPeersStatement({
      projectId: PROJECT_ID,
      addresses: ["203.0.113.7'); DROP TABLE x; --"],
      start: at(0),
      end: at(60),
      devices: { serviceIds: [new ObjectID(HOST_ID)] },
      limit: 10,
    });

    expect(statement.query).not.toContain("DROP TABLE");
    expect(statement.query).toContain("networkDeviceId IN (");
    expect(statement.query).toContain(
      "GROUP BY caseAddress, peerAddress, direction",
    );
  });

  test("the requests' SQL asks only for those that reached the app", () => {
    const statement: Statement = buildReachedRequestsStatement({
      projectId: PROJECT_ID,
      addresses: ["203.0.113.7"],
      start: at(0),
      end: at(60),
      serviceFilter: {},
      limit: 10,
    });

    expect(statement.query).toContain("requestOutcome IN (");
    expect(JSON.stringify(statement.query_params)).toContain("Reached App");
    expect(JSON.stringify(statement.query_params)).toContain(
      "Reached Database",
    );
    expect(JSON.stringify(statement.query_params)).not.toContain("Rejected");
  });
});
