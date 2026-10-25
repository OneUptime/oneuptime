import DockerHostService from "../../../../../Server/Services/DockerHostService";
import HostService from "../../../../../Server/Services/HostService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import InventoryItemService from "../../../../../Server/Services/InventoryItemService";
import KubernetesClusterService from "../../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityEntityRiskService from "../../../../../Server/Services/SecurityEntityRiskService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityCaseValues from "../../../../../Server/Utils/SecurityCase/SecurityCaseValues";
import IncidentSecurity, {
  getIncidentLinkedRecords,
} from "../../../../../Server/Utils/SecurityEvent/Connections/IncidentSecurity";
import ResourceSecurity, {
  INVENTORY_MACHINE_TYPES,
  toResourceSecurityCaseJson,
} from "../../../../../Server/Utils/SecurityEvent/Connections/ResourceSecurity";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../../Types/Email";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  IncidentSecurityJson,
  RESOURCE_SECURITY_MAX_CASES,
  RESOURCE_SECURITY_WINDOW_IN_DAYS,
  ResourceSecurityJson,
  SecurityConnectionKind,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import EntityType from "../../../../../Types/Telemetry/EntityType";
import { getEntityRiskKey } from "../../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The way back: what Security Events says about one of the project's own
 * records - and about an incident - for the Security cards on their pages.
 * A record is searched for by its exact identities only, so a guess never
 * puts a case on the wrong host's page; a project that does not use
 * Security Events is told so in one read and nothing else is read; every
 * read is the caller's, inside the project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const HOST_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const CASE_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_CASE_ID: string = "55555555-5555-4555-8555-555555555555";
const OPEN_STATUS: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const NOW: Date = new Date("2026-10-25T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("77777777-7777-4777-8777-777777777777"),
  tenantId: PROJECT_ID,
};

function bound(operator: unknown): Array<unknown> {
  return Object.values(
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {},
  ).flatMap((value: unknown): Array<unknown> => {
    return Array.isArray(value) ? value : [value];
  });
}

let inUseSpy: jest.SpyInstance;
let countSpy: jest.SpyInstance;
let casesSpy: jest.SpyInstance;
let caseCountSpy: jest.SpyInstance;
let riskSpy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  inUseSpy = jest
    .spyOn(SecurityEventService, "hasEventsSince")
    .mockResolvedValue(true);
  countSpy = jest.spyOn(SecurityEventService, "countEventsNaming").mockResolvedValue({
    eventCount: 42,
    findingCount: 3,
    maxSeverityId: 4,
    lastSeen: new Date("2026-10-25T11:00:00.000Z"),
  });
  jest
    .spyOn(SecurityCaseValues, "getOpenStatusIds")
    .mockResolvedValue([OPEN_STATUS]);
  casesSpy = jest.spyOn(SecurityCaseService, "findBy").mockResolvedValue([]);
  caseCountSpy = jest
    .spyOn(SecurityCaseService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  riskSpy = jest
    .spyOn(SecurityEntityRiskService, "findBy")
    .mockResolvedValue([]);
  // Nobody else holds an address unless a test says so.
  jest.spyOn(HostService, "findBy").mockResolvedValue([]);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function readHost(): jest.SpyInstance {
  return jest.spyOn(HostService, "findOneBy").mockResolvedValue({
    id: HOST_ID,
    name: "Web One",
    hostIdentifier: "web-1",
    hostIpAddresses: "10.0.0.5, 203.0.113.9, 127.0.0.1",
  } as never);
}

function read(
  kind: SecurityConnectionKind = SecurityConnectionKind.Host,
  id: ObjectID = HOST_ID,
): Promise<ResourceSecurityJson | null> {
  return ResourceSecurity.read({
    projectId: PROJECT_ID,
    kind,
    id,
    props: CALLER,
    now: NOW,
  });
}

describe("ResourceSecurity.read", () => {
  test("a record the caller may not read, or of another project, is not found", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(HostService, "findOneBy")
      .mockResolvedValue(null);

    expect(await read()).toBeNull();
    expect(find.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, _id: HOST_ID.toString() },
      props: CALLER,
    });
    expect(inUseSpy).not.toHaveBeenCalled();
  });

  test("a project that does not use Security Events is told so in one read, and nothing else is read", async () => {
    readHost();
    inUseSpy.mockResolvedValue(false);

    const security: ResourceSecurityJson | null = await read();

    expect(security).toMatchObject({
      kind: SecurityConnectionKind.Host,
      id: HOST_ID.toString(),
      name: "Web One",
      isInUse: false,
      windowDays: RESOURCE_SECURITY_WINDOW_IN_DAYS,
      eventCount: 0,
      openCases: null,
      risk: null,
    });
    expect(inUseSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      startTime: new Date("2026-10-18T12:00:00.000Z"),
    });
    expect(countSpy).not.toHaveBeenCalled();
    expect(casesSpy).not.toHaveBeenCalled();
  });

  test("a host: its names and its own public address, in the usual spellings, over the week", async () => {
    readHost();

    const security: ResourceSecurityJson | null = await read();

    expect(security?.values).toEqual(["web-1", "web one", "203.0.113.9"]);
    expect(security?.entity).toEqual({
      type: SecurityEntityType.Host,
      value: "web-1",
    });
    expect(countSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      values: [
        "web-1",
        "WEB-1",
        "web one",
        "WEB ONE",
        "203.0.113.9",
      ],
      startTime: new Date("2026-10-18T12:00:00.000Z"),
      endTime: NOW,
    });
    expect(security).toMatchObject({
      eventCount: 42,
      findingCount: 3,
      maxSeverityId: 4,
      lastSeen: "2026-10-25T11:00:00.000Z",
    });
  });

  test("a public address another record holds too is left out: it would only be a possible connection", async () => {
    readHost();
    jest.spyOn(HostService, "findBy").mockResolvedValue([
      { id: new ObjectID(OTHER_HOST_ID), hostIpAddresses: "203.0.113.9" },
    ] as never);

    expect((await read())?.values).toEqual(["web-1", "web one"]);
  });

  test("a near miss of an address is not another holder", async () => {
    readHost();
    jest.spyOn(HostService, "findBy").mockResolvedValue([
      { id: new ObjectID(OTHER_HOST_ID), hostIpAddresses: "203.0.113.90" },
      { id: HOST_ID, hostIpAddresses: "203.0.113.9" },
    ] as never);

    expect((await read())?.values).toContain("203.0.113.9");
  });

  test("the open cases whose entities name it, however they spelled it, the latest first", async () => {
    readHost();
    casesSpy.mockResolvedValue([
      {
        id: new ObjectID(CASE_ID),
        caseNumberWithPrefix: "CASE-142",
        title: "Brute force against web-1",
        lastDetectedAt: new Date("2026-10-25T10:00:00.000Z"),
        securityCasePriority: { name: "High", color: "#f97316" },
        securityCaseStatus: { name: "Investigating", color: "#eab308" },
      },
    ] as never);
    caseCountSpy.mockResolvedValue(new PositiveNumber(4));

    const security: ResourceSecurityJson | null = await read();

    expect(security?.openCases).toEqual({
      count: 4,
      items: [
        {
          id: CASE_ID,
          number: "CASE-142",
          title: "Brute force against web-1",
          priorityName: "High",
          priorityColor: "#f97316",
          statusName: "Investigating",
          statusColor: "#eab308",
          lastDetectedAt: "2026-10-25T10:00:00.000Z",
        },
      ],
    });

    const args: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
      limit: number;
    } = casesSpy.mock.calls[0]![0] as never;

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect(bound(args.query["securityCaseStatusId"])).toEqual([
      OPEN_STATUS.toString(),
    ]);
    expect(bound(args.query["entities"])).toEqual([
      "value",
      "web-1",
      "web one",
      "203.0.113.9",
    ]);
    expect(args.props).toBe(CALLER);
    expect(args.limit).toBe(RESOURCE_SECURITY_MAX_CASES);
  });

  test("its highest risk, by the keys its identities have", async () => {
    readHost();
    riskSpy.mockResolvedValue([
      { entityValue: "web-1", entityType: "Host", riskScore: 150 },
    ] as never);

    const security: ResourceSecurityJson | null = await read();

    expect(security?.risk).toEqual({
      score: 150,
      entityValue: "web-1",
      entityType: "Host",
    });
    expect(
      bound(
        (riskSpy.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
          "entityKey"
        ],
      ),
    ).toEqual(["web-1", getEntityRiskKey("web one"), "203.0.113.9"]);
  });

  test("cases or risk the caller's role cannot read are not known - null - and the counts still show", async () => {
    readHost();
    casesSpy.mockRejectedValue(new NotAuthorizedException("no cases"));
    riskSpy.mockRejectedValue(new Error("db down"));

    const security: ResourceSecurityJson | null = await read();

    expect(security?.openCases).toBeNull();
    expect(security?.risk).toBeNull();
    expect(security?.eventCount).toBe(42);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a service is searched for by the events read from its logs; no case or risk is looked up", async () => {
    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue({
      id: HOST_ID,
      name: "checkout",
    } as never);

    const security: ResourceSecurityJson | null = await read(
      SecurityConnectionKind.Service,
    );

    expect(security?.values).toEqual([]);
    expect(security?.entity).toBeNull();
    expect(countSpy.mock.calls[0]![0]).toMatchObject({
      values: [],
      logResourceId: HOST_ID,
    });
    expect(casesSpy).not.toHaveBeenCalled();
    expect(riskSpy).not.toHaveBeenCalled();
  });

  test("a cluster by its k8s.cluster.name", async () => {
    jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue({
      id: HOST_ID,
      name: "Production EU",
      clusterIdentifier: "prod-eu",
    } as never);

    const security: ResourceSecurityJson | null = await read(
      SecurityConnectionKind.KubernetesCluster,
    );

    expect(security?.name).toBe("Production EU");
    expect(security?.values).toEqual(["prod-eu"]);
    expect(security?.entity).toEqual({
      type: SecurityEntityType.Host,
      value: "prod-eu",
    });
  });

  test("a Docker host by its names", async () => {
    jest.spyOn(DockerHostService, "findOneBy").mockResolvedValue({
      id: HOST_ID,
      name: "dock-1",
      hostIdentifier: "dock-1",
    } as never);

    expect(
      (await read(SecurityConnectionKind.DockerHost))?.values,
    ).toEqual(["dock-1"]);
  });

  test("a network device by its names and addresses: a hostname that is an address counts as one, never as a name", async () => {
    jest.spyOn(NetworkDeviceService, "findOneBy").mockResolvedValue({
      id: HOST_ID,
      name: "edge-fw",
      hostname: "198.51.100.1",
      dnsName: "edge-fw.corp.example",
      otherAddresses: "198.51.100.2, 10.255.0.1",
    } as never);

    expect(
      (await read(SecurityConnectionKind.NetworkDevice))?.values,
    ).toEqual([
      "edge-fw",
      "edge-fw.corp.example",
      "198.51.100.1",
      "198.51.100.2",
    ]);
  });

  test("a user by their email, as a member the caller may see", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "findOneBy")
      .mockResolvedValue({
        userId: HOST_ID,
        user: { name: "Kim Morgan", email: new Email("k.morgan@acme.example") },
      } as never);

    const security: ResourceSecurityJson | null = await read(
      SecurityConnectionKind.User,
    );

    expect(security?.name).toBe("Kim Morgan");
    expect(security?.values).toEqual(["k.morgan@acme.example"]);
    expect(security?.entity).toEqual({
      type: SecurityEntityType.User,
      value: "k.morgan@acme.example",
    });
    expect(find.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, userId: HOST_ID },
      props: CALLER,
    });
  });

  test("an inventory item of a machine by its names and its host.ip; any other item has no card", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(InventoryItemService, "findOneBy")
      .mockResolvedValue({
        id: HOST_ID,
        entityType: EntityType.KubernetesNode,
        displayName: "ip-10-0-1-5.ec2.internal",
        identifyingAttributes: { "k8s.node.name": "ip-10-0-1-5.ec2.internal" },
        descriptiveAttributes: { "host.ip": "10.0.1.5, 52.0.0.9" },
      } as never);

    const security: ResourceSecurityJson | null = await read(
      SecurityConnectionKind.InventoryItem,
    );

    expect(security?.values).toEqual(["ip-10-0-1-5.ec2.internal", "52.0.0.9"]);

    find.mockResolvedValue({
      id: HOST_ID,
      entityType: EntityType.KubernetesPod,
      displayName: "api-7d9",
    } as never);

    expect(await read(SecurityConnectionKind.InventoryItem)).toBeNull();
    expect(INVENTORY_MACHINE_TYPES).not.toContain(EntityType.Service);
  });
});

describe("toResourceSecurityCaseJson", () => {
  test("a case as another page lists it, every missing part left out", () => {
    expect(
      toResourceSecurityCaseJson({
        id: new ObjectID(CASE_ID),
        title: "Untitled",
      } as unknown as SecurityCase),
    ).toEqual({ id: CASE_ID, number: "", title: "Untitled" });
  });
});

describe("IncidentSecurity.read", () => {
  function readIncident(incident: object | null): jest.SpyInstance {
    return jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident as never);
  }

  test("an incident the caller may not read is not found", async () => {
    readIncident(null);

    expect(
      await IncidentSecurity.read({
        projectId: PROJECT_ID,
        incidentId: HOST_ID,
        props: CALLER,
      }),
    ).toBeNull();
  });

  test("the case that declared it, and the open cases naming what it affects - never the same case twice", async () => {
    const find: jest.SpyInstance = readIncident({
      id: HOST_ID,
      hosts: [
        { id: new ObjectID(OTHER_HOST_ID), name: "Web One", hostIdentifier: "web-1" },
      ],
      kubernetesClusters: [
        {
          id: new ObjectID(CASE_ID),
          name: "Prod",
          clusterIdentifier: "prod-eu",
        },
      ],
    });
    casesSpy.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      if (query["incidentId"]) {
        return [
          {
            id: new ObjectID(CASE_ID),
            caseNumberWithPrefix: "CASE-142",
            title: "Brute force",
          },
        ];
      }

      return [
        {
          id: new ObjectID(OTHER_CASE_ID),
          caseNumberWithPrefix: "CASE-150",
          title: "Shell in a pod",
          entities: [{ type: "Host", value: "PROD-EU" }],
        },
      ];
    });
    caseCountSpy.mockResolvedValue(new PositiveNumber(2));

    const security: IncidentSecurityJson | null = await IncidentSecurity.read({
      projectId: PROJECT_ID,
      incidentId: HOST_ID,
      props: CALLER,
    });

    expect(security?.declaredBy.map((item: { number: string }) => {
      return item.number;
    })).toEqual(["CASE-142"]);
    expect(security?.namingItsResources).toEqual([
      expect.objectContaining({
        number: "CASE-150",
        resources: [
          {
            kind: SecurityConnectionKind.KubernetesCluster,
            id: CASE_ID,
            name: "Prod",
          },
        ],
      }),
    ]);
    expect(security?.namingItsResourcesCount).toBe(2);

    expect(find.mock.calls[0]![0]).toMatchObject({
      query: { _id: HOST_ID.toString(), projectId: PROJECT_ID },
      props: CALLER,
    });

    const naming: Record<string, unknown> = (
      casesSpy.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;

    // The declaring case is never listed again.
    expect(bound(naming["_id"])).toEqual([CASE_ID]);
    expect(bound(naming["entities"])).toEqual([
      "value",
      "web-1",
      "web one",
      "prod-eu",
    ]);
  });

  test("an incident that affects no host or cluster looks for no naming case", async () => {
    readIncident({ id: HOST_ID });

    const security: IncidentSecurityJson | null = await IncidentSecurity.read({
      projectId: PROJECT_ID,
      incidentId: HOST_ID,
      props: CALLER,
    });

    expect(security).toEqual({
      declaredBy: [],
      namingItsResources: [],
      namingItsResourcesCount: 0,
    });
    expect(casesSpy).toHaveBeenCalledTimes(1);
  });

  test("getIncidentLinkedRecords: each host, container host and cluster with its exact names", () => {
    expect(
      getIncidentLinkedRecords({
        hosts: [{ id: HOST_ID, name: "Web One", hostIdentifier: "web-1" }],
        dockerHosts: [
          { id: new ObjectID(OTHER_HOST_ID), name: "", hostIdentifier: "dock" },
        ],
      } as unknown as Incident),
    ).toEqual([
      {
        kind: SecurityConnectionKind.Host,
        id: HOST_ID.toString(),
        name: "Web One",
        values: ["web-1", "web one"],
      },
      {
        kind: SecurityConnectionKind.DockerHost,
        id: OTHER_HOST_ID,
        name: "dock",
        values: ["dock"],
      },
    ]);
  });
});
