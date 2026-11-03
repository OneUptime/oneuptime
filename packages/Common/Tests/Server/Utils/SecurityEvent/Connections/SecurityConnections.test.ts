import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertStateService from "../../../../../Server/Services/AlertStateService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../../Server/Services/IncidentStateService";
import InventoryItemService from "../../../../../Server/Services/InventoryItemService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../../../Server/Services/OnCallDutyPolicyScheduleService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityConnectedRecords, {
  SecurityConnectedRecord,
  SecurityConnectedRecordsResult,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityConnections, {
  MAX_CHANGES_READ,
  MAX_FACT_ROWS_READ,
  MONITOR_ALERTS_COLUMN,
  MONITOR_INCIDENTS_COLUMN,
  RECORD_RELATION_COLUMNS,
  hasRecentChanges,
  linkIncidentToConnectedRecords,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CONNECTION_MAX_LISTED,
  SECURITY_CONNECTION_MAX_RESOURCES,
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionsJson,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "../../../../../Utils/Telemetry/EntityKey";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Connected Signals: a case's, an event's or an entity's records with what
 * is happening on each - the incidents and alerts open on it, the monitors
 * watching it, what changed on it in the window, its inventory item - in a
 * few bounded reads in all, with the caller's own permissions; a fact that
 * cannot be read is "not known", never zero.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const CLUSTER_ID: string = "44444444-4444-4444-8444-444444444444";
const SERVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const MEMBER_ID: string = "66666666-6666-4666-8666-666666666666";
const INCIDENT_ID: string = "77777777-7777-4777-8777-777777777777";
const OPEN_STATE: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const NOW: Date = new Date("2026-10-25T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("99999999-9999-4999-8999-999999999999"),
  tenantId: PROJECT_ID,
};

function connected(
  kind: SecurityConnectionKind,
  id: string,
  name: string,
  certainty: SecurityConnectionCertainty = SecurityConnectionCertainty.Exact,
  identity?: string,
): SecurityConnectedRecord {
  return {
    kind,
    id,
    name,
    ...(identity ? { identity } : {}),
    certainty,
    matches: [
      {
        entity: { type: SecurityEntityType.Host, value: name },
        certainty,
        reason:
          certainty === SecurityConnectionCertainty.Exact
            ? SecurityConnectionReason.HostName
            : SecurityConnectionReason.ShortHostName,
        matchedValue: name,
      },
    ],
  };
}

const RESOLVED: SecurityConnectedRecordsResult = {
  records: [
    connected(
      SecurityConnectionKind.Host,
      HOST_ID,
      "web-1",
      undefined,
      "web-1",
    ),
    connected(
      SecurityConnectionKind.KubernetesCluster,
      CLUSTER_ID,
      "prod-eu",
      undefined,
      "prod-eu",
    ),
    connected(SecurityConnectionKind.Service, SERVICE_ID, "checkout"),
    connected(SecurityConnectionKind.User, MEMBER_ID, "Kim Morgan"),
  ],
  unmatched: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
  unreadableKinds: [],
  failedKinds: [SecurityConnectionKind.NetworkDevice],
};

let resolveSpy: jest.SpyInstance;
let incidentSpy: jest.SpyInstance;
let alertSpy: jest.SpyInstance;
let monitorSpy: jest.SpyInstance;
let changeSpy: jest.SpyInstance;
let inventorySpy: jest.SpyInstance;
let logResourcesSpy: jest.SpyInstance;
let layerUserSpy: jest.SpyInstance;
let scheduleSpy: jest.SpyInstance;
let teamSpy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  resolveSpy = jest
    .spyOn(SecurityConnectedRecords, "resolve")
    .mockResolvedValue(RESOLVED);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([OPEN_STATE]);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_STATE]);
  incidentSpy = jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
  alertSpy = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
  monitorSpy = jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
  changeSpy = jest.spyOn(ChangeEventService, "findBy").mockResolvedValue([]);
  inventorySpy = jest
    .spyOn(InventoryItemService, "findBy")
    .mockResolvedValue([]);
  logResourcesSpy = jest
    .spyOn(SecurityEventService, "findLogResourcesNaming")
    .mockResolvedValue([]);
  layerUserSpy = jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockResolvedValue([]);
  scheduleSpy = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue([]);
  teamSpy = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function resource(
  json: SecurityConnectionsJson,
  kind: SecurityConnectionKind,
): SecurityConnectedResourceJson {
  return json.resources.find((item: SecurityConnectedResourceJson): boolean => {
    return item.kind === kind;
  })!;
}

function caseRead(overrides: Record<string, unknown> = {}): jest.SpyInstance {
  return jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
    id: CASE_ID,
    _id: CASE_ID.toString(),
    projectId: PROJECT_ID,
    entities: [
      { type: SecurityEntityType.Host, value: "web-1" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ],
    firstDetectedAt: new Date("2026-10-25T09:00:00.000Z"),
    lastDetectedAt: new Date("2026-10-25T10:00:00.000Z"),
    createdAt: new Date("2026-10-25T09:00:00.000Z"),
    ...overrides,
  } as never);
}

describe("SecurityConnections.forCase", () => {
  test("a case nobody may read, or of another project, is not found", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);

    expect(
      await SecurityConnections.forCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
      }),
    ).toBeNull();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("its entities and the logs behind its events, around its detections, read as the caller", async () => {
    const read: jest.SpyInstance = caseRead();
    logResourcesSpy.mockResolvedValue([
      { type: "OpenTelemetry", id: SERVICE_ID, eventCount: 4 },
    ]);

    const json: SecurityConnectionsJson | null =
      await SecurityConnections.forCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      });

    expect(read.mock.calls[0]![0]).toMatchObject({
      query: { _id: CASE_ID, projectId: PROJECT_ID },
      props: CALLER,
    });
    expect(json?.windowStart).toBe("2026-10-25T08:30:00.000Z");
    expect(json?.windowEnd).toBe("2026-10-25T10:30:00.000Z");
    expect(logResourcesSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      values: ["web-1", "203.0.113.7"],
      startTime: new Date("2026-10-25T08:30:00.000Z"),
      endTime: new Date("2026-10-25T10:30:00.000Z"),
    });
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      props: CALLER,
      logResources: [{ type: "OpenTelemetry", id: SERVICE_ID }],
    });
    expect(json?.unmatched).toEqual(RESOLVED.unmatched);
    expect(json?.failedKinds).toEqual([SecurityConnectionKind.NetworkDevice]);
    expect(json?.hasMoreResources).toBe(false);
  });

  test("the logs behind its events that cannot be read are left out; the rest still answers", async () => {
    caseRead();
    logResourcesSpy.mockRejectedValue(new Error("clickhouse timed out"));

    const json: SecurityConnectionsJson | null =
      await SecurityConnections.forCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      });

    expect(json?.resources.length).toBe(4);
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({ logResources: [] });
  });
});

describe("the facts on each record", () => {
  test("open incidents and alerts, attributed to each record by its relation, a few listed and all counted", async () => {
    caseRead();
    incidentSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      if (query["hosts"]) {
        return [1, 2, 3, 4].map((index: number) => {
          return {
            id: new ObjectID(`7777777${index}-7777-4777-8777-777777777777`),
            title: `CPU ${index}`,
            incidentNumber: index,
            incidentNumberWithPrefix: `INC-${index}`,
            currentIncidentState: { name: "Investigating", color: "#f59e0b" },
            hosts: [
              { _id: HOST_ID },
              { _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            ],
          };
        });
      }

      return [];
    });
    alertSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      return query["kubernetesClusters"]
        ? [
            {
              id: new ObjectID(INCIDENT_ID),
              title: "Pod crash looping",
              alertNumber: 7,
              kubernetesClusters: [{ _id: CLUSTER_ID }],
            },
          ]
        : [];
    });

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    const web: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.Host,
    );

    expect(web.activeIncidents?.count).toBe(4);
    expect(web.activeIncidents?.items.length).toBe(
      SECURITY_CONNECTION_MAX_LISTED,
    );
    expect(web.activeIncidents?.items[0]).toEqual({
      id: "77777771-7777-4777-8777-777777777777",
      title: "CPU 1",
      number: "INC-1",
      stateName: "Investigating",
      stateColor: "#f59e0b",
    });
    expect(web.activeAlerts).toEqual({ count: 0, items: [] });

    const cluster: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.KubernetesCluster,
    );

    expect(cluster.activeAlerts).toEqual({
      count: 1,
      items: [{ id: INCIDENT_ID, title: "Pod crash looping", number: "#7" }],
    });

    // A user has no incidents, alerts or monitors of their own.
    const member: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.User,
    );

    expect(member.activeIncidents).toBeNull();
    expect(member.monitors).toBeNull();
    expect(member.recentChanges).toBeNull();
  });

  test("each fact is read once per kind of record, inside the project, bounded, as the caller, open ones only", async () => {
    caseRead();

    await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    });

    const columns: Array<string> = incidentSpy.mock.calls.map(
      (call: Array<unknown>): string => {
        const query: Record<string, unknown> = (
          call[0] as { query: Record<string, unknown> }
        ).query;

        return Object.keys(query).find((key: string): boolean => {
          return Object.values(RECORD_RELATION_COLUMNS).includes(key);
        })!;
      },
    );

    expect(columns.sort()).toEqual(["hosts", "kubernetesClusters", "services"]);

    for (const spy of [incidentSpy, alertSpy, monitorSpy]) {
      for (const call of spy.mock.calls) {
        const args: {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
          limit: number;
        } = call[0] as never;

        expect(args.query["projectId"]).toBe(PROJECT_ID);
        expect(args.props).toBe(CALLER);
        expect(args.limit).toBe(MAX_FACT_ROWS_READ);
      }
    }

    expect(
      Object.keys(
        (incidentSpy.mock.calls[0]![0] as { query: Record<string, unknown> })
          .query,
      ),
    ).toContain("currentIncidentStateId");
    expect(
      Object.keys(
        (alertSpy.mock.calls[0]![0] as { query: Record<string, unknown> })
          .query,
      ),
    ).toContain("currentAlertStateId");
  });

  test("a fact the caller's role cannot read is not known - null, never zero - and the others still show", async () => {
    caseRead();
    incidentSpy.mockRejectedValue(new NotAuthorizedException("no incidents"));
    monitorSpy.mockRejectedValue(new Error("db down"));

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;
    const web: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.Host,
    );

    expect(web.activeIncidents).toBeNull();
    expect(web.monitors).toBeNull();
    expect(web.activeAlerts).toEqual({ count: 0, items: [] });
    // Only the failure is logged: a refusal is the reader's role, not a fault.
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a project with no open incident state looks for no incident", async () => {
    caseRead();
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([]);

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    expect(incidentSpy).not.toHaveBeenCalled();
    expect(resource(json, SecurityConnectionKind.Host).activeIncidents).toEqual(
      { count: 0, items: [] },
    );
  });

  test("what changed in the window: a service's deploys by the service, a cluster's rollouts and a host's fixes by their ids", async () => {
    caseRead();
    changeSpy.mockResolvedValue([
      {
        _id: "c1",
        time: new Date("2026-10-25T09:45:00.000Z"),
        eventType: "deployment",
        title: "checkout v2.3.1",
        primaryEntityId: new ObjectID(SERVICE_ID),
        attributes: {},
      },
      {
        _id: "c2",
        time: new Date("2026-10-25T09:40:00.000Z"),
        eventType: "deployment",
        title: "api rollout",
        attributes: { "oneuptime.kubernetes.cluster.id": CLUSTER_ID },
      },
      {
        _id: "c3",
        time: new Date("2026-10-25T09:30:00.000Z"),
        eventType: "remediation",
        title: "restart nginx",
        attributes: { "oneuptime.resource.id": HOST_ID },
      },
      {
        _id: "c4",
        time: new Date("2026-10-25T09:20:00.000Z"),
        eventType: "deployment",
        title: "someone else's service",
        primaryEntityId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        attributes: {},
      },
      // No time: not a change anyone can place.
      { _id: "c5", title: "no time", attributes: {} },
    ] as never);

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    expect(
      resource(json, SecurityConnectionKind.Service).recentChanges,
    ).toEqual([
      {
        id: "c1",
        time: "2026-10-25T09:45:00.000Z",
        title: "checkout v2.3.1",
        eventType: "deployment",
      },
    ]);
    expect(
      resource(json, SecurityConnectionKind.KubernetesCluster)
        .recentChanges?.[0]?.title,
    ).toBe("api rollout");
    expect(
      resource(json, SecurityConnectionKind.Host).recentChanges?.[0]?.title,
    ).toBe("restart nginx");

    const changeRead: {
      query: Record<string, unknown>;
      limit: number;
      props: DatabaseCommonInteractionProps;
    } = changeSpy.mock.calls[0]![0] as never;

    expect(changeRead.query["projectId"]).toBe(PROJECT_ID);
    expect(changeRead.limit).toBe(MAX_CHANGES_READ);
    expect(changeRead.props).toBe(CALLER);
  });

  test("each record's inventory item, by the key Inventory gives it", async () => {
    caseRead();
    inventorySpy.mockResolvedValue([
      {
        id: new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        entityKey: keyForHost(PROJECT_ID.toString(), "web-1"),
      },
    ] as never);

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    expect(resource(json, SecurityConnectionKind.Host).inventoryItemId).toBe(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    expect(
      resource(json, SecurityConnectionKind.KubernetesCluster).inventoryItemId,
    ).toBeUndefined();

    const keys: Array<unknown> = Object.values(
      (
        (inventorySpy.mock.calls[0]![0] as { query: Record<string, unknown> })
          .query["entityKey"] as {
          objectLiteralParameters: Record<string, unknown>;
        }
      ).objectLiteralParameters,
    ).flat();

    expect(keys).toEqual(
      expect.arrayContaining([
        keyForHost(PROJECT_ID.toString(), "web-1"),
        keyForKubernetesCluster(PROJECT_ID.toString(), "prod-eu"),
      ]),
    );
  });

  test("at most ten records, exact ones first, and the rest said to exist", async () => {
    caseRead();
    const many: Array<SecurityConnectedRecord> = [];

    for (let index: number = 0; index < 14; index++) {
      many.push(
        connected(
          SecurityConnectionKind.Host,
          `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
          `host-${index}`,
        ),
      );
    }

    resolveSpy.mockResolvedValue({
      ...RESOLVED,
      records: many,
    });

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    expect(json.resources.length).toBe(SECURITY_CONNECTION_MAX_RESOURCES);
    expect(json.hasMoreResources).toBe(true);
  });
});

describe("SecurityConnections.forEntities", () => {
  test("an event's entities in the hour around it, with the record its log line was sent under", async () => {
    const json: SecurityConnectionsJson = await SecurityConnections.forEntities(
      {
        projectId: PROJECT_ID,
        entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
        time: new Date("2026-10-25T10:00:00.000Z"),
        logResources: [{ type: "Host", id: HOST_ID }],
        props: CALLER,
        now: NOW,
      },
    );

    expect(json.windowStart).toBe("2026-10-25T09:30:00.000Z");
    expect(json.windowEnd).toBe("2026-10-25T10:30:00.000Z");
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({
      logResources: [{ type: "Host", id: HOST_ID }],
    });
    // An event says where its own line came from: nothing is read for it.
    expect(logResourcesSpy).not.toHaveBeenCalled();
  });

  test("an entity's page reads the logs behind its events too; a time ahead of now is now", async () => {
    logResourcesSpy.mockResolvedValue([
      { type: "Host", id: HOST_ID, eventCount: 2 },
    ]);

    const json: SecurityConnectionsJson = await SecurityConnections.forEntities(
      {
        projectId: PROJECT_ID,
        entities: [{ type: SecurityEntityType.User, value: "k@acme.example" }],
        time: new Date("2026-10-26T10:00:00.000Z"),
        readLogResources: true,
        props: CALLER,
        now: NOW,
      },
    );

    expect(json.windowEnd).toBe(NOW.toISOString());
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({
      logResources: [{ type: "Host", id: HOST_ID }],
    });
  });
});

describe("the logs behind the events, of the sources the reader may read", () => {
  test("a case's and an entity's are read from the events the caller's read of security events keeps to", async () => {
    caseRead();
    const sources: TelemetryServiceFilter = {
      serviceIds: [new ObjectID(SERVICE_ID)],
    };
    const scope: jest.SpyInstance = jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue(sources);

    await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    });
    await SecurityConnections.forEntities({
      projectId: PROJECT_ID,
      entities: [{ type: SecurityEntityType.User, value: "k@acme.example" }],
      readLogResources: true,
      props: CALLER,
      now: NOW,
    });

    expect(scope).toHaveBeenCalledTimes(2);
    expect(logResourcesSpy).toHaveBeenCalledTimes(2);

    for (const call of scope.mock.calls) {
      expect(call[0]).toEqual({ modelType: SecurityEvent, props: CALLER });
    }

    for (const call of logResourcesSpy.mock.calls) {
      expect(call[0]).toMatchObject({ serviceFilter: sources });
    }
  });

  test("a caller whose role may not read security events gets none of the logs behind them, and that is no failure to log", async () => {
    caseRead();
    logResourcesSpy.mockResolvedValue([
      { type: "Host", id: HOST_ID, eventCount: 3 },
    ]);
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You are not authorized to read Security Event.",
        ),
      );

    const json: SecurityConnectionsJson | null =
      await SecurityConnections.forCase({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      });

    expect(logResourcesSpy).not.toHaveBeenCalled();
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({ logResources: [] });
    expect(json?.resources.length).toBe(4);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("the incident a case declares", () => {
  test("is linked to the case's exact connections among what an incident names - read as OneUptime", async () => {
    caseRead();
    resolveSpy.mockResolvedValue({
      ...RESOLVED,
      records: [
        ...RESOLVED.records,
        connected(
          SecurityConnectionKind.Host,
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          "web-1.staging",
          SecurityConnectionCertainty.Possible,
        ),
        connected(
          SecurityConnectionKind.NetworkDevice,
          "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          "edge-fw",
        ),
      ],
    });

    const links: Array<SecurityConnectedRecord> =
      await SecurityConnections.readIncidentLinks({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        now: NOW,
      });

    expect(
      links.map((item: SecurityConnectedRecord): string => {
        return `${item.kind}:${item.name}`;
      }),
    ).toEqual(["Host:web-1", "KubernetesCluster:prod-eu", "Service:checkout"]);
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });

    // The logs behind every source's events: OneUptime decides what the incident is about.
    const sources: TelemetryServiceFilter | undefined = (
      logResourcesSpy.mock.calls[0]![0] as {
        serviceFilter?: TelemetryServiceFilter | undefined;
      }
    ).serviceFilter;

    expect(sources?.serviceIds).toBeUndefined();
    expect(sources?.excludedServiceIds).toBeUndefined();
  });

  test("linkIncidentToConnectedRecords: each relation of the incident, exact records only", () => {
    const incident: Incident = new Incident();

    linkIncidentToConnectedRecords(incident, [
      connected(SecurityConnectionKind.Host, HOST_ID, "web-1"),
      connected(SecurityConnectionKind.Host, HOST_ID, "web-1"),
      connected(SecurityConnectionKind.KubernetesCluster, CLUSTER_ID, "prod"),
      connected(SecurityConnectionKind.Service, SERVICE_ID, "checkout"),
      connected(
        SecurityConnectionKind.DockerHost,
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "dock",
        SecurityConnectionCertainty.Possible,
      ),
      connected(SecurityConnectionKind.User, MEMBER_ID, "Kim"),
    ]);

    expect(
      (incident.hosts || []).map((row: { id?: ObjectID | null }) => {
        return row.id?.toString();
      }),
    ).toEqual([HOST_ID]);
    expect(incident.kubernetesClusters?.[0]?.id?.toString()).toBe(CLUSTER_ID);
    expect(incident.services?.[0]?.id?.toString()).toBe(SERVICE_ID);
    // A possible connection is never linked; an incident names no user.
    expect(incident.dockerHosts).toBeUndefined();
    expect(incident.podmanHosts).toBeUndefined();
  });

  test("a cloud resource the case names exactly is linked; a monitor never is", () => {
    const CLOUD_ID: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const MONITOR_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const incident: Incident = new Incident();

    linkIncidentToConnectedRecords(incident, [
      connected(SecurityConnectionKind.CloudResource, CLOUD_ID, "checkout-alb"),
      connected(SecurityConnectionKind.Monitor, MONITOR_ID, "Checkout site"),
      connected(
        SecurityConnectionKind.ServerlessFunction,
        "ffffffff-ffff-4fff-8fff-fffffffffff1",
        "checkout-handler",
      ),
    ]);

    expect(incident.cloudResources?.[0]?.id?.toString()).toBe(CLOUD_ID);
    // An incident on a monitor can change its status and show on its status pages.
    expect(incident.monitors).toBeUndefined();
  });

  test("the incident's links: a cloud resource among them, a monitor and a function never", async () => {
    caseRead();
    resolveSpy.mockResolvedValue({
      ...RESOLVED,
      records: [
        connected(
          SecurityConnectionKind.CloudResource,
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
          "checkout-alb",
        ),
        connected(
          SecurityConnectionKind.Monitor,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          "Checkout site",
        ),
        connected(
          SecurityConnectionKind.ServerlessFunction,
          "ffffffff-ffff-4fff-8fff-fffffffffff1",
          "checkout-handler",
        ),
      ],
    });

    const links: Array<SecurityConnectedRecord> =
      await SecurityConnections.readIncidentLinks({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        now: NOW,
      });

    expect(
      links.map((item: SecurityConnectedRecord): string => {
        return `${item.kind}:${item.name}`;
      }),
    ).toEqual(["CloudResource:checkout-alb"]);
  });
});

describe("a monitor's facts", () => {
  const MONITOR_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function monitorRecord(): SecurityConnectedRecord {
    return {
      ...connected(SecurityConnectionKind.Monitor, MONITOR_ID, "Checkout site"),
      status: { name: "Degraded", color: "#f59e0b" },
    };
  }

  test("its status, and the incidents and alerts open on it - an incident by its monitors, an alert by its one monitor", async () => {
    caseRead();
    resolveSpy.mockResolvedValue({ ...RESOLVED, records: [monitorRecord()] });
    incidentSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      return query[MONITOR_INCIDENTS_COLUMN]
        ? [
            {
              id: new ObjectID(INCIDENT_ID),
              title: "Checkout returns 502s",
              incidentNumberWithPrefix: "INC-42",
              monitors: [{ _id: MONITOR_ID }],
            },
          ]
        : [];
    });
    alertSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      return query[MONITOR_ALERTS_COLUMN]
        ? [
            {
              id: new ObjectID(INCIDENT_ID),
              title: "Slow checkout",
              alertNumber: 9,
              monitorId: new ObjectID(MONITOR_ID),
            },
          ]
        : [];
    });

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;
    const site: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.Monitor,
    );

    expect(site.status).toEqual({ name: "Degraded", color: "#f59e0b" });
    expect(site.activeIncidents).toEqual({
      count: 1,
      items: [
        { id: INCIDENT_ID, title: "Checkout returns 502s", number: "INC-42" },
      ],
    });
    expect(site.activeAlerts).toEqual({
      count: 1,
      items: [{ id: INCIDENT_ID, title: "Slow checkout", number: "#9" }],
    });
    // A monitor is watched by no monitor, and records no change of its own.
    expect(site.monitors).toBeNull();
    expect(site.recentChanges).toBeNull();
    expect(monitorSpy).not.toHaveBeenCalled();
    // And no member's facts.
    expect(site).not.toHaveProperty("onCallSchedules");
    expect(site).not.toHaveProperty("teams");

    // An alert names one monitor: read by its id, not as a list...
    const alertRead: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = alertSpy.mock.calls[0]![0] as never;

    expect(alertRead.select[MONITOR_ALERTS_COLUMN]).toBe(true);
    expect(alertRead.query[MONITOR_ALERTS_COLUMN]).toBeInstanceOf(FindOperator);
    expect(
      JSON.stringify(
        (
          alertRead.query[MONITOR_ALERTS_COLUMN] as {
            objectLiteralParameters?: unknown;
          }
        ).objectLiteralParameters,
      ),
    ).toContain(MONITOR_ID);

    // ...and an incident lists its monitors, read through the relation.
    const incidentRead: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = incidentSpy.mock.calls[0]![0] as never;

    expect(incidentRead.select[MONITOR_INCIDENTS_COLUMN]).toEqual({
      _id: true,
    });
    expect(
      (incidentRead.query[MONITOR_INCIDENTS_COLUMN] as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([MONITOR_ID]);
  });

  test("its incidents and alerts are read with the caller's own permissions, inside the project", async () => {
    caseRead();
    resolveSpy.mockResolvedValue({ ...RESOLVED, records: [monitorRecord()] });

    await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    });

    for (const spy of [incidentSpy, alertSpy]) {
      const read: {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
        limit: number;
      } = spy.mock.calls[0]![0] as never;

      expect(read.query["projectId"]).toBe(PROJECT_ID);
      expect(read.props).toBe(CALLER);
      expect(read.limit).toBe(MAX_FACT_ROWS_READ);
    }
  });

  test("the kinds whose changes are read: never a person's, a device's or a monitor's", () => {
    expect(hasRecentChanges(SecurityConnectionKind.Host)).toBe(true);
    expect(hasRecentChanges(SecurityConnectionKind.CloudResource)).toBe(true);
    expect(hasRecentChanges(SecurityConnectionKind.ServerlessFunction)).toBe(
      true,
    );
    expect(hasRecentChanges(SecurityConnectionKind.User)).toBe(false);
    expect(hasRecentChanges(SecurityConnectionKind.NetworkDevice)).toBe(false);
    expect(hasRecentChanges(SecurityConnectionKind.Monitor)).toBe(false);
  });
});

describe("a member's on-call schedules and teams", () => {
  const PRIMARY: string = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const SECONDARY: string = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
  const OVERRIDE: string = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
  const OTHER_MEMBER: string = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
  const PLATFORM_TEAM: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const SRE_TEAM: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

  async function member(): Promise<SecurityConnectedResourceJson> {
    caseRead();

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    return resource(json, SecurityConnectionKind.User);
  }

  test("the schedules their rotations list and those they are on call for now, on call now first, then by name", async () => {
    layerUserSpy.mockResolvedValue([
      {
        userId: new ObjectID(MEMBER_ID),
        onCallDutyPolicyScheduleId: new ObjectID(SECONDARY),
      },
      {
        userId: new ObjectID(MEMBER_ID),
        onCallDutyPolicyScheduleId: new ObjectID(PRIMARY),
      },
      // Another member's rotation.
      {
        userId: new ObjectID(OTHER_MEMBER),
        onCallDutyPolicyScheduleId: new ObjectID(PRIMARY),
      },
    ] as never);
    scheduleSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      // On call now: for the primary by rotation, and by an override.
      if (query["currentUserIdOnRoster"]) {
        return [
          {
            id: new ObjectID(PRIMARY),
            name: "Platform primary",
            currentUserIdOnRoster: new ObjectID(MEMBER_ID),
          },
          {
            id: new ObjectID(OVERRIDE),
            name: "Database escalations",
            currentUserIdOnRoster: new ObjectID(MEMBER_ID),
          },
        ];
      }

      return [{ id: new ObjectID(SECONDARY), name: "Platform secondary" }];
    });

    expect((await member()).onCallSchedules).toEqual({
      count: 3,
      items: [
        { id: OVERRIDE, name: "Database escalations", isOnCallNow: true },
        { id: PRIMARY, name: "Platform primary", isOnCallNow: true },
        { id: SECONDARY, name: "Platform secondary", isOnCallNow: false },
      ],
    });

    // Each read inside the project, as the caller, bounded.
    for (const spy of [layerUserSpy, scheduleSpy]) {
      for (const call of spy.mock.calls) {
        const read: {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
          limit: number;
        } = call[0] as never;

        expect(read.query["projectId"]).toBe(PROJECT_ID);
        expect(read.props).toBe(CALLER);
        expect(read.limit).toBeLessThanOrEqual(MAX_FACT_ROWS_READ);
      }
    }
  });

  test(`at most ${SECURITY_CONNECTION_MAX_LISTED} listed, all counted; a schedule the caller cannot read is left out`, async () => {
    layerUserSpy.mockResolvedValue(
      ["01", "02", "03", "04", "05"].map((suffix: string) => {
        return {
          userId: new ObjectID(MEMBER_ID),
          onCallDutyPolicyScheduleId: new ObjectID(
            `dddddddd-dddd-4ddd-8ddd-dddddddddd${suffix}`,
          ),
        };
      }) as never,
    );
    // The caller may read four of the five.
    scheduleSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      if (query["currentUserIdOnRoster"]) {
        return [];
      }

      return ["01", "02", "03", "04"].map((suffix: string) => {
        return {
          id: new ObjectID(`dddddddd-dddd-4ddd-8ddd-dddddddddd${suffix}`),
          name: `Schedule ${suffix}`,
        };
      });
    });

    const schedules: SecurityConnectedResourceJson["onCallSchedules"] = (
      await member()
    ).onCallSchedules;

    expect(schedules?.count).toBe(4);
    expect(schedules?.items.length).toBe(SECURITY_CONNECTION_MAX_LISTED);
    expect(schedules?.items[0]).toEqual({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      name: "Schedule 01",
      isOnCallNow: false,
    });
  });

  test("on no schedule: none, never unknown; a role that cannot read schedules is told nothing (null)", async () => {
    expect((await member()).onCallSchedules).toEqual({ count: 0, items: [] });

    scheduleSpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read schedules.",
      ),
    );

    expect((await member()).onCallSchedules).toBeNull();
  });

  test("the teams they joined, by name - an invitation not yet accepted is no membership", async () => {
    teamSpy.mockResolvedValue([
      {
        userId: new ObjectID(MEMBER_ID),
        teamId: new ObjectID(SRE_TEAM),
        team: { name: "SRE" },
      },
      {
        userId: new ObjectID(MEMBER_ID),
        teamId: new ObjectID(PLATFORM_TEAM),
        team: { name: "Platform" },
      },
      // The same team twice: once.
      {
        userId: new ObjectID(MEMBER_ID),
        teamId: new ObjectID(SRE_TEAM),
        team: { name: "SRE" },
      },
    ] as never);

    expect((await member()).teams).toEqual({
      count: 2,
      items: [
        { id: PLATFORM_TEAM, title: "Platform" },
        { id: SRE_TEAM, title: "SRE" },
      ],
    });

    const read: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = teamSpy.mock.calls[0]![0] as never;

    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.query["hasAcceptedInvitation"]).toBe(true);
    expect(read.props).toBe(CALLER);
  });

  test("teams that cannot be read are not known (null), and a failure is logged", async () => {
    teamSpy.mockRejectedValue(new Error("connection reset"));

    expect((await member()).teams).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  test("no member among the records reads no schedule and no team", async () => {
    caseRead();
    resolveSpy.mockResolvedValue({
      ...RESOLVED,
      records: RESOLVED.records.filter(
        (record: SecurityConnectedRecord): boolean => {
          return record.kind !== SecurityConnectionKind.User;
        },
      ),
    });

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;

    expect(layerUserSpy).not.toHaveBeenCalled();
    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(teamSpy).not.toHaveBeenCalled();
    expect(resource(json, SecurityConnectionKind.Host)).not.toHaveProperty(
      "onCallSchedules",
    );
  });
});

describe("a cloud resource's facts", () => {
  test("the incidents, alerts and monitors on it, through its cloudResources relation", async () => {
    const CLOUD_ID: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    caseRead();
    resolveSpy.mockResolvedValue({
      ...RESOLVED,
      records: [
        connected(
          SecurityConnectionKind.CloudResource,
          CLOUD_ID,
          "checkout-alb",
        ),
      ],
    });
    incidentSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      return query["cloudResources"]
        ? [
            {
              id: new ObjectID(INCIDENT_ID),
              title: "5xx on the load balancer",
              incidentNumber: 3,
              cloudResources: [{ _id: CLOUD_ID }],
            },
          ]
        : [];
    });

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;
    const alb: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.CloudResource,
    );

    expect(alb.activeIncidents?.count).toBe(1);
    expect(alb.activeAlerts).toEqual({ count: 0, items: [] });
    expect(alb.monitors).toEqual({ count: 0, items: [] });
    expect(alb.recentChanges).toEqual([]);
    expect(RECORD_RELATION_COLUMNS[SecurityConnectionKind.CloudResource]).toBe(
      "cloudResources",
    );
  });

  test("a serverless function has no incidents, alerts or monitors of its own to read", async () => {
    caseRead();
    resolveSpy.mockResolvedValue({
      ...RESOLVED,
      records: [
        connected(
          SecurityConnectionKind.ServerlessFunction,
          "ffffffff-ffff-4fff-8fff-fffffffffff1",
          "checkout-handler",
        ),
      ],
    });

    const json: SecurityConnectionsJson = (await SecurityConnections.forCase({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    }))!;
    const handler: SecurityConnectedResourceJson = resource(
      json,
      SecurityConnectionKind.ServerlessFunction,
    );

    expect(handler.activeIncidents).toBeNull();
    expect(handler.activeAlerts).toBeNull();
    expect(handler.monitors).toBeNull();
    expect(handler.recentChanges).toEqual([]);
    expect(incidentSpy).not.toHaveBeenCalled();
  });
});
