import CloudResourceService from "../../../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../../../Server/Services/DockerHostService";
import HostService from "../../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../../Server/Services/KubernetesClusterService";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import PodmanHostService from "../../../../../Server/Services/PodmanHostService";
import ServerlessFunctionService from "../../../../../Server/Services/ServerlessFunctionService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import UserService from "../../../../../Server/Services/UserService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityConnectedRecords, {
  LOG_RESOURCE_KINDS,
  MAX_MONITORS_READ,
  MAX_ROWS_PER_READ,
  SecurityConnectedRecord,
  SecurityConnectedRecordsResult,
  getLogResourceKind,
  isRefusedRead,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import {
  SECURITY_CONNECTION_LOOKUP_KINDS,
  wasLookedUpEverywhere,
} from "../../../../../Utils/SecurityCase/SecurityConnectionMatch";
import Hostname from "../../../../../Types/API/Hostname";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "../../../../../Types/Color";
import Email from "../../../../../Types/Email";
import IP from "../../../../../Types/IP/IP";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Which of the project's own records a case's, an event's or an entity's
 * values are: the reads behind Connected Signals. Every read is inside the
 * project and bounded; names are read with the caller's permissions, an
 * address's holders are counted among all of the project's records and only
 * the ones the caller may read are listed; a refused read says the kind is
 * unreadable, a failed one that it failed, and the rest still answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_HOST_ID: string = "44444444-4444-4444-8444-444444444444";
const CLUSTER_ID: string = "55555555-5555-4555-8555-555555555555";
const DEVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const SERVICE_ID: string = "77777777-7777-4777-8777-777777777777";
const MEMBER_ID: string = "88888888-8888-4888-8888-888888888888";
const MONITOR_ID: string = "99999999-9999-4999-8999-999999999991";
const OTHER_MONITOR_ID: string = "99999999-9999-4999-8999-999999999992";
const CLOUD_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER_CLOUD_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const FUNCTION_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const CALLER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

interface FindArgs {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  limit?: number;
}

// The values a Raw operator binds (a case-insensitive IN, a LIKE, an id list).
function boundValues(operator: unknown): Array<unknown> {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};

  return Object.values(parameters).flatMap((value: unknown): Array<unknown> => {
    return Array.isArray(value) ? value : [value];
  });
}

function host(
  id: string,
  hostIdentifier: string,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    id: new ObjectID(id),
    _id: id,
    hostIdentifier,
    name: hostIdentifier,
    ...extra,
  };
}

// A monitor checking these destinations, with its status as the read selects it.
function monitor(
  id: string,
  name: string,
  destinations: Array<URL | Hostname | IP>,
  status: { name: string; color: string } = {
    name: "Operational",
    color: "#22c55e",
  },
): unknown {
  const steps: MonitorSteps = new MonitorSteps();

  steps.setMonitorStepsInstanceArray(
    destinations.map((destination: URL | Hostname | IP): MonitorStep => {
      return new MonitorStep().setMonitorDestination(destination);
    }),
  );

  return {
    id: new ObjectID(id),
    _id: id,
    name,
    monitorSteps: steps,
    currentMonitorStatus: {
      name: status.name,
      color: new Color(status.color),
    },
  };
}

function cloudResource(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): unknown {
  return { id: new ObjectID(id), _id: id, name, ...extra };
}

let spies: Record<string, jest.SpyInstance>;

function resolve(
  entities: Array<SecurityEntity>,
  props: DatabaseCommonInteractionProps = CALLER,
  logResources: Array<{ type: string; id: string }> = [],
): Promise<SecurityConnectedRecordsResult> {
  return SecurityConnectedRecords.resolve({
    projectId: PROJECT_ID,
    entities,
    logResources,
    props,
  });
}

function record(
  result: SecurityConnectedRecordsResult,
  kind: SecurityConnectionKind,
  id: string,
): SecurityConnectedRecord | undefined {
  return result.records.find((item: SecurityConnectedRecord): boolean => {
    return item.kind === kind && item.id === id;
  });
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  spies = {
    host: jest.spyOn(HostService, "findBy").mockResolvedValue([]),
    docker: jest.spyOn(DockerHostService, "findBy").mockResolvedValue([]),
    podman: jest.spyOn(PodmanHostService, "findBy").mockResolvedValue([]),
    cluster: jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([]),
    openStackCloud: jest
      .spyOn(OpenStackCloudService, "findBy")
      .mockResolvedValue([]),
    device: jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]),
    service: jest.spyOn(ServiceService, "findBy").mockResolvedValue([]),
    user: jest.spyOn(UserService, "findBy").mockResolvedValue([]),
    member: jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]),
    monitor: jest.spyOn(MonitorService, "findBy").mockResolvedValue([]),
    cloud: jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([]),
    serverless: jest
      .spyOn(ServerlessFunctionService, "findBy")
      .mockResolvedValue([]),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the kinds of record a log row names", () => {
  test("a service's, a host's, a container host's, a cluster's, a device's, a cloud resource's and a function's logs; nothing else", () => {
    expect(getLogResourceKind(ServiceType.OpenTelemetry)).toBe(
      SecurityConnectionKind.Service,
    );
    expect(getLogResourceKind(ServiceType.Host)).toBe(
      SecurityConnectionKind.Host,
    );
    expect(getLogResourceKind(ServiceType.KubernetesCluster)).toBe(
      SecurityConnectionKind.KubernetesCluster,
    );
    expect(getLogResourceKind(ServiceType.OpenStackCloud)).toBe(
      SecurityConnectionKind.OpenStackCloud,
    );
    expect(getLogResourceKind(ServiceType.CloudResource)).toBe(
      SecurityConnectionKind.CloudResource,
    );
    expect(getLogResourceKind(ServiceType.ServerlessFunction)).toBe(
      SecurityConnectionKind.ServerlessFunction,
    );
    // A monitor's logs are OneUptime's own checks of it, not its target's.
    expect(getLogResourceKind(ServiceType.Monitor)).toBeNull();
    expect(getLogResourceKind("Unknown")).toBeNull();
    expect(LOG_RESOURCE_KINDS.length).toBe(9);
  });

  test("a read refused for who is asking is told from one that failed", () => {
    expect(isRefusedRead(new NotAuthorizedException("no"))).toBe(true);
    expect(isRefusedRead(new PaymentRequiredException("plan"))).toBe(true);
    expect(isRefusedRead(new Error("db down"))).toBe(false);
  });
});

describe("names", () => {
  test("a host by the name it reports: exact, read with the caller's own permissions, inside the project", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (args as FindArgs).query;

      return boundValues(query["hostIdentifier"]).includes("web-1")
        ? [host(HOST_ID, "web-1", { name: "Web One" })]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "WEB-1" },
    ]);

    expect(result.records).toEqual([
      {
        kind: SecurityConnectionKind.Host,
        id: HOST_ID,
        name: "Web One",
        identity: "web-1",
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entity: { type: SecurityEntityType.Host, value: "WEB-1" },
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.HostName,
            matchedValue: "web-1",
          },
        ],
      },
    ]);
    expect(result.unmatched).toEqual([]);

    for (const call of spies["host"]!.mock.calls) {
      const args: FindArgs = call[0] as FindArgs;
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.props).toBe(CALLER);
      expect(args.limit).toBeLessThanOrEqual(50);
    }
  });

  test("a bare name and the host reporting its full name: possible, said why", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (args as FindArgs).query;

      // The full names a bare one starts.
      return boundValues(query["hostIdentifier"]).includes("web-1.%")
        ? [host(HOST_ID, "web-1.acme.internal")]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "web-1" },
    ]);

    expect(
      record(result, SecurityConnectionKind.Host, HOST_ID)?.matches,
    ).toEqual([
      {
        entity: { type: SecurityEntityType.Host, value: "web-1" },
        certainty: SecurityConnectionCertainty.Possible,
        reason: SecurityConnectionReason.ShortHostName,
        matchedValue: "web-1.acme.internal",
      },
    ]);
  });

  test("a full name is also looked up by its short form", async () => {
    await resolve([
      { type: SecurityEntityType.Domain, value: "db-1.acme.internal" },
    ]);

    const values: Array<unknown> = boundValues(
      (spies["host"]!.mock.calls[0]![0] as FindArgs).query["hostIdentifier"],
    );

    expect(values).toEqual(["db-1.acme.internal", "db-1"]);
  });

  test("an untyped value with a cluster's name: only possible", async () => {
    spies["cluster"]!.mockResolvedValue([
      {
        id: new ObjectID(CLUSTER_ID),
        name: "Production",
        clusterIdentifier: "production",
      },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: "production" },
    ]);

    expect(
      record(result, SecurityConnectionKind.KubernetesCluster, CLUSTER_ID),
    ).toMatchObject({
      name: "Production",
      identity: "production",
      certainty: SecurityConnectionCertainty.Possible,
      matches: [{ reason: SecurityConnectionReason.UntypedValue }],
    });
  });

  test("an OpenStack cloud by its openstack.cloud.name, whole: never by a short form", async () => {
    spies["openStackCloud"]!.mockResolvedValue([
      { id: new ObjectID(CLUSTER_ID), name: "prod-eu" },
    ] as never);

    const exact: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "prod-eu" },
    ]);

    expect(
      record(exact, SecurityConnectionKind.OpenStackCloud, CLUSTER_ID)
        ?.matches[0],
    ).toMatchObject({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.CloudName,
    });

    const short: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "prod-eu.example.internal" },
    ]);

    expect(
      record(short, SecurityConnectionKind.OpenStackCloud, CLUSTER_ID),
    ).toBeUndefined();
  });

  test("an OpenStack cloud a case only says the name of may be another thing of that name", async () => {
    spies["openStackCloud"]!.mockResolvedValue([
      { id: new ObjectID(CLUSTER_ID), name: "prod-eu" },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: "prod-eu" },
    ]);

    expect(
      record(result, SecurityConnectionKind.OpenStackCloud, CLUSTER_ID)
        ?.matches[0],
    ).toMatchObject({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.UntypedValue,
    });
  });

  test("a project and an instance a case names are not looked for among the machines", async () => {
    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: "project payments" },
      { type: SecurityEntityType.Other, value: "instance web-1" },
    ]);

    expect(result.records).toEqual([]);
    expect(spies["host"]).not.toHaveBeenCalled();
    expect(spies["openStackCloud"]).not.toHaveBeenCalled();
  });

  test("a cluster by its k8s.cluster.name, whole: never by a short form", async () => {
    spies["cluster"]!.mockResolvedValue([
      {
        id: new ObjectID(CLUSTER_ID),
        name: "prod-eu",
        clusterIdentifier: "prod-eu",
      },
    ] as never);

    const exact: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "prod-eu" },
    ]);

    expect(
      record(exact, SecurityConnectionKind.KubernetesCluster, CLUSTER_ID)
        ?.matches[0],
    ).toMatchObject({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.ClusterName,
    });

    const short: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "prod-eu.k8s.acme" },
    ]);

    expect(short.records).toEqual([]);
  });

  test("a network device by its name, hostname or DNS name", async () => {
    spies["device"]!.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (args as FindArgs).query;

      return query["dnsName"]
        ? [
            {
              id: new ObjectID(DEVICE_ID),
              name: "core-sw-01",
              hostname: "10.255.0.1",
              dnsName: "core-sw-01.corp.example",
            },
          ]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Domain, value: "core-sw-01.corp.example" },
    ]);

    expect(
      record(result, SecurityConnectionKind.NetworkDevice, DEVICE_ID),
    ).toMatchObject({
      name: "core-sw-01",
      certainty: SecurityConnectionCertainty.Exact,
      matches: [
        {
          reason: SecurityConnectionReason.DeviceName,
          matchedValue: "core-sw-01.corp.example",
        },
      ],
    });
  });

  test("Docker and Podman hosts by the names they report", async () => {
    spies["docker"]!.mockResolvedValue([host(HOST_ID, "dock-1")] as never);
    spies["podman"]!.mockResolvedValue([
      host(OTHER_HOST_ID, "dock-1"),
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "dock-1" },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord): string => {
        return item.kind;
      }),
    ).toEqual([
      SecurityConnectionKind.DockerHost,
      SecurityConnectionKind.PodmanHost,
    ]);
  });
});

describe("addresses", () => {
  /*
   * Whether a text column's stored value is found by its filter, as the
   * database finds it: a contains-any filter (textContainsAnyOf) by any of
   * its patterns, an equals-any filter (findWithSameTextAnyOf) by any of
   * its texts, both without case.
   */
  function isFoundBy(filter: unknown, stored: string): boolean {
    const text: string = stored.toLowerCase();

    return boundValues(filter).some((bound: unknown): boolean => {
      const value: string = String(bound).toLowerCase();

      return value.startsWith("%") && value.endsWith("%")
        ? text.includes(value.slice(1, -1))
        : text === value;
    });
  }

  /*
   * An IPv6 address is looked up written out (the one spelling a case keeps
   * it in), while a host's agent and a device's owner most often write it
   * compressed: a lookup in that one spelling found no record holding an
   * IPv6 address, so a false positive step never said it was the project's
   * own (#10744). Each record is looked for under every spelling, and then
   * held to the address itself.
   */
  test.each([
    "2001:db8:0:0:0:0:0:7",
    "2001:db8::7",
    "2001:0DB8:0000:0000:0000:0000:0000:0007",
  ])(
    "an IPv6 address the case writes %s finds the host and the device that hold it compressed",
    async (value: string) => {
      spies["host"]!.mockImplementation(async (args: unknown) => {
        const call: FindArgs = args as FindArgs;
        const stored: string = "2001:db8::7, 10.0.0.5";

        if (call.query["hostIpAddresses"]) {
          return isFoundBy(call.query["hostIpAddresses"], stored)
            ? [host(HOST_ID, "web-1", { hostIpAddresses: stored })]
            : [];
        }

        return call.query["_id"] ? [host(HOST_ID, "web-1")] : [];
      });
      spies["device"]!.mockImplementation(async (args: unknown) => {
        const call: FindArgs = args as FindArgs;
        const device: Record<string, unknown> = {
          id: new ObjectID(DEVICE_ID),
          _id: DEVICE_ID,
          name: "core-sw-1",
          hostname: "2001:DB8::7",
          otherAddresses: "",
        };

        if (call.query["hostname"]) {
          return isFoundBy(call.query["hostname"], "2001:DB8::7")
            ? [device]
            : [];
        }

        return call.query["_id"] ? [device] : [];
      });

      const result: SecurityConnectedRecordsResult = await resolve([
        { type: SecurityEntityType.IpAddress, value },
      ]);

      expect(
        record(result, SecurityConnectionKind.Host, HOST_ID),
      ).toBeDefined();
      expect(
        record(result, SecurityConnectionKind.NetworkDevice, DEVICE_ID),
      ).toBeDefined();
    },
  );

  test("a record holding a near miss of an IPv6 address is found by the search, and held to the address", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;
      const stored: string = "2001:db8::70";

      if (call.query["hostIpAddresses"]) {
        return isFoundBy(call.query["hostIpAddresses"], stored)
          ? [host(HOST_ID, "web-1", { hostIpAddresses: stored })]
          : [];
      }

      return call.query["_id"] ? [host(HOST_ID, "web-1")] : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "2001:db8:0:0:0:0:0:7" },
    ]);

    expect(
      record(result, SecurityConnectionKind.Host, HOST_ID),
    ).toBeUndefined();
  });

  test("a public address only one host holds: exact - counted as OneUptime, listed with the caller's permissions", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["hostIpAddresses"]) {
        // A search is a substring: the near miss is held to the address.
        return [
          host(HOST_ID, "web-1", { hostIpAddresses: "203.0.113.9, 10.0.0.5" }),
          host(OTHER_HOST_ID, "web-2", { hostIpAddresses: "203.0.113.90" }),
        ];
      }

      if (call.query["_id"]) {
        return [host(HOST_ID, "web-1")];
      }

      return [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
    ]);

    expect(result.records).toEqual([
      expect.objectContaining({
        kind: SecurityConnectionKind.Host,
        id: HOST_ID,
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entity: {
              type: SecurityEntityType.IpAddress,
              value: "203.0.113.9",
            },
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.Address,
            matchedValue: "203.0.113.9",
          },
        ],
      }),
    ]);

    const holders: FindArgs = spies["host"]!.mock.calls.map(
      (call: Array<unknown>): FindArgs => {
        return call[0] as FindArgs;
      },
    ).find((args: FindArgs): boolean => {
      return Boolean(args.query["hostIpAddresses"]);
    })!;
    const visible: FindArgs = spies["host"]!.mock.calls.map(
      (call: Array<unknown>): FindArgs => {
        return call[0] as FindArgs;
      },
    ).find((args: FindArgs): boolean => {
      return Boolean(args.query["_id"]);
    })!;

    expect(holders.props).toEqual({ isRoot: true });
    expect(holders.query["projectId"]).toBe(PROJECT_ID);
    expect(visible.props).toBe(CALLER);
    expect(boundValues(visible.query["_id"])).toEqual([HOST_ID]);
  });

  test("a host the caller may not read is not listed, even when it holds the address", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return call.query["hostIpAddresses"]
        ? [host(HOST_ID, "web-1", { hostIpAddresses: "203.0.113.9" })]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
    ]);

    expect(result.records).toEqual([]);
    expect(result.unmatched).toEqual([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
    ]);
  });

  test("a private address, and one two records hold: possible", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.props.isRoot && call.query["hostIpAddresses"]) {
        const search: Array<unknown> = boundValues(
          call.query["hostIpAddresses"],
        );

        if (search.includes("%10.0.3.17%")) {
          return [host(HOST_ID, "db-1", { hostIpAddresses: "10.0.3.17" })];
        }

        return [
          host(HOST_ID, "db-1", { hostIpAddresses: "198.51.100.4" }),
          host(OTHER_HOST_ID, "db-2", { hostIpAddresses: "198.51.100.4" }),
        ];
      }

      return [host(HOST_ID, "db-1"), host(OTHER_HOST_ID, "db-2")];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "10.0.3.17" },
      { type: SecurityEntityType.IpAddress, value: "198.51.100.4" },
    ]);

    expect(
      record(result, SecurityConnectionKind.Host, HOST_ID)?.matches.map(
        (match: { reason: SecurityConnectionReason }) => {
          return match.reason;
        },
      ),
    ).toEqual([
      SecurityConnectionReason.PrivateAddress,
      SecurityConnectionReason.SharedAddress,
    ]);
    expect(
      record(result, SecurityConnectionKind.Host, OTHER_HOST_ID),
    ).toMatchObject({
      certainty: SecurityConnectionCertainty.Possible,
      matches: [{ reason: SecurityConnectionReason.SharedAddress }],
    });
  });

  test("a network device's polled address, or one it sends from", async () => {
    spies["device"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["otherAddresses"]) {
        return [
          {
            id: new ObjectID(DEVICE_ID),
            name: "edge-fw",
            hostname: "edge-fw.corp.example",
            otherAddresses: "198.51.100.1, 198.51.100.2",
          },
        ];
      }

      if (call.query["_id"]) {
        return [{ id: new ObjectID(DEVICE_ID) }];
      }

      return [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "198.51.100.2" },
    ]);

    expect(
      record(result, SecurityConnectionKind.NetworkDevice, DEVICE_ID),
    ).toMatchObject({
      name: "edge-fw",
      certainty: SecurityConnectionCertainty.Exact,
      matches: [{ reason: SecurityConnectionReason.Address }],
    });
  });

  test("as OneUptime itself (the triage), every holder is listed without a second read", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return call.query["hostIpAddresses"]
        ? [host(HOST_ID, "web-1", { hostIpAddresses: "203.0.113.9" })]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve(
      [{ type: SecurityEntityType.IpAddress, value: "203.0.113.9" }],
      { isRoot: true },
    );

    expect(result.records.length).toBe(1);
    expect(
      spies["host"]!.mock.calls.some((call: Array<unknown>): boolean => {
        return Boolean((call[0] as FindArgs).query["_id"]);
      }),
    ).toBe(false);
  });
});

describe("members", () => {
  test("the project's member with the email: found as OneUptime, kept only as a member the caller may see", async () => {
    spies["user"]!.mockResolvedValue([
      {
        id: new ObjectID(MEMBER_ID),
        name: "Kim Morgan",
        email: new Email("k.morgan@acme.example"),
      },
    ] as never);
    spies["member"]!.mockResolvedValue([
      { userId: new ObjectID(MEMBER_ID) },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.User, value: "K.Morgan@acme.example" },
      { type: SecurityEntityType.User, value: "root" },
    ]);

    expect(result.records).toEqual([
      {
        kind: SecurityConnectionKind.User,
        id: MEMBER_ID,
        name: "Kim Morgan",
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entity: {
              type: SecurityEntityType.User,
              value: "K.Morgan@acme.example",
            },
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.Email,
            matchedValue: "k.morgan@acme.example",
          },
        ],
      },
    ]);

    const users: FindArgs = spies["user"]!.mock.calls[0]![0] as FindArgs;
    const members: FindArgs = spies["member"]!.mock.calls[0]![0] as FindArgs;

    expect(users.props).toEqual({ isRoot: true });
    expect(boundValues(users.query["email"])).toEqual([
      "k.morgan@acme.example",
    ]);
    expect(users.select).toEqual({ _id: true, name: true, email: true });
    expect(members.props).toBe(CALLER);
    expect(members.query["projectId"]).toBe(PROJECT_ID);
    /*
     * The caller's read is of the memberships alone: a member's user is a
     * column fewer of a membership's readers may read than the membership.
     */
    expect(members.select).toEqual({ userId: true });
  });

  test("a user OneUptime found whom the caller's read of the members does not find is not shown", async () => {
    spies["user"]!.mockResolvedValue([
      {
        id: new ObjectID(MEMBER_ID),
        name: "Kim Morgan",
        email: new Email("k.morgan@acme.example"),
      },
    ] as never);
    spies["member"]!.mockResolvedValue([]);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
    ]);

    expect(result.records).toEqual([]);
  });

  test("a user who is no member of the project is not shown, and is not found", async () => {
    spies["user"]!.mockResolvedValue([
      { id: new ObjectID(MEMBER_ID) },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.User, value: "someone@elsewhere.example" },
    ]);

    expect(result.records).toEqual([]);
    expect(result.unmatched).toEqual([
      { type: SecurityEntityType.User, value: "someone@elsewhere.example" },
    ]);
  });
});

describe("the logs an event was read from", () => {
  test("the host and the service whose logs they were: exact, by id, inside the project", async () => {
    spies["host"]!.mockResolvedValue([host(HOST_ID, "web-1")] as never);
    spies["service"]!.mockResolvedValue([
      { id: new ObjectID(SERVICE_ID), name: "checkout" },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([], CALLER, [
      { type: ServiceType.Host, id: HOST_ID },
      { type: ServiceType.OpenTelemetry, id: SERVICE_ID },
      // Not a record a connection names, nor a real id: never read.
      { type: ServiceType.Monitor, id: OTHER_HOST_ID },
      { type: ServiceType.Host, id: "project-1" },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return [item.kind, item.id, item.matches[0]?.reason];
      }),
    ).toEqual([
      [
        SecurityConnectionKind.Host,
        HOST_ID,
        SecurityConnectionReason.LogSource,
      ],
      [
        SecurityConnectionKind.Service,
        SERVICE_ID,
        SecurityConnectionReason.LogSource,
      ],
    ]);

    const serviceRead: FindArgs = spies["service"]!.mock
      .calls[0]![0] as FindArgs;
    expect(serviceRead.query["projectId"]).toBe(PROJECT_ID);
    expect(boundValues(serviceRead.query["_id"])).toEqual([SERVICE_ID]);
    expect(serviceRead.props).toBe(CALLER);
  });

  test("a cloud resource and a serverless function whose logs they were: exact, by id, with the caller's permissions", async () => {
    spies["cloud"]!.mockResolvedValue([
      cloudResource(CLOUD_ID, "checkout-alb", {
        providerResourceId:
          "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/checkout/1",
      }),
    ] as never);
    spies["serverless"]!.mockResolvedValue([
      {
        id: new ObjectID(FUNCTION_ID),
        name: "",
        functionIdentifier: "checkout-handler",
      },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([], CALLER, [
      { type: ServiceType.CloudResource, id: CLOUD_ID },
      { type: ServiceType.ServerlessFunction, id: FUNCTION_ID },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return [
          item.kind,
          item.id,
          item.name,
          item.identity,
          item.certainty,
          item.matches[0]?.reason,
        ];
      }),
    ).toEqual([
      [
        SecurityConnectionKind.CloudResource,
        CLOUD_ID,
        "checkout-alb",
        undefined,
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.LogSource,
      ],
      [
        SecurityConnectionKind.ServerlessFunction,
        FUNCTION_ID,
        // Unnamed: its faas.name stands for it.
        "checkout-handler",
        "checkout-handler",
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.LogSource,
      ],
    ]);

    for (const spy of [spies["cloud"]!, spies["serverless"]!]) {
      const read: FindArgs = spy.mock.calls[0]![0] as FindArgs;

      expect(read.query["projectId"]).toBe(PROJECT_ID);
      expect(read.props).toBe(CALLER);
    }

    expect(
      boundValues(
        (spies["serverless"]!.mock.calls[0]![0] as FindArgs).query["_id"],
      ),
    ).toEqual([FUNCTION_ID]);
  });
});

/*
 * #10033: an event read from a cloud resource's or a serverless function's
 * own logs carries the ID its stream stamped on the line and the faas.name
 * the line or span was of - the line itself is filed under the connection's
 * service, or the service of the function's name. Each is connected
 * exactly, read with the caller's own permissions, as the record's own
 * Security Events page reads its events.
 */
describe("the cloud resource and the function whose own logs an event was read from", () => {
  const VAULT_ID: string =
    "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments";
  const TABLE_ARN: string =
    "arn:aws:dynamodb:us-east-1:111122223333:table/Orders";

  function resolveOwners(
    logOwners: Array<{ kind: SecurityConnectionKind; value: string }>,
    props: DatabaseCommonInteractionProps = CALLER,
  ): Promise<SecurityConnectedRecordsResult> {
    return SecurityConnectedRecords.resolve({
      projectId: PROJECT_ID,
      entities: [],
      logOwners,
      props,
    });
  }

  test("the cloud resource its stream stamped the line with: exact, an Azure ID whatever its case, as the caller", async () => {
    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return boundValues(call.query["providerResourceId"]).includes(
        VAULT_ID.toLowerCase(),
      )
        ? [
            cloudResource(CLOUD_ID, "kv-Payments", {
              providerResourceId: VAULT_ID,
            }),
          ]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolveOwners([
      // As every event keeps it: by its key, in lower case (#10034).
      {
        kind: SecurityConnectionKind.CloudResource,
        value: VAULT_ID.toLowerCase(),
      },
    ]);

    expect(result.records).toEqual([
      {
        kind: SecurityConnectionKind.CloudResource,
        id: CLOUD_ID,
        name: "kv-Payments",
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entity: { type: SecurityEntityType.Other, value: "kv-Payments" },
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.LogSource,
            matchedValue: VAULT_ID,
          },
        ],
      },
    ]);

    const read: FindArgs = spies["cloud"]!.mock.calls[0]![0] as FindArgs;

    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.props).toBe(CALLER);
    expect(read.limit).toBeLessThanOrEqual(50);
  });

  test("an ARN or a stand-in its stream stamped is held to exactly: another case is another resource", async () => {
    // The lower-cased lookup returns both tables; only the one stamped is the line's.
    spies["cloud"]!.mockResolvedValue([
      cloudResource(CLOUD_ID, "Orders", { providerResourceId: TABLE_ARN }),
      cloudResource(OTHER_CLOUD_ID, "orders", {
        providerResourceId: TABLE_ARN.toLowerCase(),
      }),
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolveOwners([
      { kind: SecurityConnectionKind.CloudResource, value: TABLE_ARN },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord): string => {
        return item.id;
      }),
    ).toEqual([CLOUD_ID]);

    spies["cloud"]!.mockResolvedValue([
      cloudResource(CLOUD_ID, "orders-broker", {
        providerResourceId: "AWS/AmazonMQ Broker=orders",
      }),
    ] as never);

    expect(
      (
        await resolveOwners([
          {
            kind: SecurityConnectionKind.CloudResource,
            value: "AWS/AmazonMQ Broker=ORDERS",
          },
        ])
      ).records,
    ).toEqual([]);
    expect(
      (
        await resolveOwners([
          {
            kind: SecurityConnectionKind.CloudResource,
            value: "AWS/AmazonMQ Broker=orders",
          },
        ])
      ).records.length,
    ).toBe(1);
  });

  test("the function whose faas.name the line or span carried: exact, by its unique name, as the caller", async () => {
    spies["serverless"]!.mockResolvedValue([
      {
        id: new ObjectID(FUNCTION_ID),
        name: "Checkout",
        functionIdentifier: "checkout-handler",
      },
      // A function of another case is another function: never the line's.
      {
        id: new ObjectID(OTHER_HOST_ID),
        name: "CHECKOUT-HANDLER",
        functionIdentifier: "CHECKOUT-HANDLER",
      },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolveOwners([
      {
        kind: SecurityConnectionKind.ServerlessFunction,
        value: "checkout-handler",
      },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return [
          item.kind,
          item.id,
          item.name,
          item.identity,
          item.certainty,
          item.matches[0]?.reason,
          item.matches[0]?.matchedValue,
        ];
      }),
    ).toEqual([
      [
        SecurityConnectionKind.ServerlessFunction,
        FUNCTION_ID,
        "Checkout",
        "checkout-handler",
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.LogSource,
        "checkout-handler",
      ],
    ]);

    const read: FindArgs = spies["serverless"]!.mock.calls[0]![0] as FindArgs;

    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(boundValues(read.query["functionIdentifier"])).toEqual([
      "checkout-handler",
    ]);
    expect(read.props).toBe(CALLER);
  });

  test("a role that cannot read cloud resources or functions is told so, and none of them is shown", async () => {
    spies["cloud"]!.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read Cloud Resource.",
      ),
    );
    spies["serverless"]!.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read Serverless Function.",
      ),
    );

    const result: SecurityConnectedRecordsResult = await resolveOwners([
      { kind: SecurityConnectionKind.CloudResource, value: TABLE_ARN },
      {
        kind: SecurityConnectionKind.ServerlessFunction,
        value: "checkout-handler",
      },
    ]);

    expect(result.records).toEqual([]);
    expect(result.unreadableKinds.sort()).toEqual(
      [
        SecurityConnectionKind.CloudResource,
        SecurityConnectionKind.ServerlessFunction,
      ].sort(),
    );
    expect(result.failedKinds).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("one record named by its ID and read from its own logs is one record, its log first", async () => {
    spies["cloud"]!.mockResolvedValue([
      cloudResource(CLOUD_ID, "Orders", { providerResourceId: TABLE_ARN }),
    ] as never);

    const result: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId: PROJECT_ID,
        entities: [{ type: SecurityEntityType.Other, value: TABLE_ARN }],
        logOwners: [
          { kind: SecurityConnectionKind.CloudResource, value: TABLE_ARN },
        ],
        props: CALLER,
      });

    expect(result.records).toHaveLength(1);
    expect(
      result.records[0]!.matches.map((match: { reason: string }): string => {
        return match.reason;
      }),
    ).toEqual([
      SecurityConnectionReason.LogSource,
      SecurityConnectionReason.ResourceId,
    ]);
  });

  test("nothing to look for reads nothing", async () => {
    await resolveOwners([
      { kind: SecurityConnectionKind.CloudResource, value: "  " },
      { kind: SecurityConnectionKind.Host, value: "web-1" },
    ]);

    expect(spies["cloud"]).not.toHaveBeenCalled();
    expect(spies["serverless"]).not.toHaveBeenCalled();
  });
});

describe("the names of the records log lines and spans were sent under", () => {
  test("each kind read once, by id, inside the project, with the caller's permissions; by kind and id", async () => {
    spies["host"]!.mockResolvedValue([host(HOST_ID, "edge-1")] as never);
    spies["service"]!.mockResolvedValue([
      { id: new ObjectID(SERVICE_ID), name: "checkout-api" },
    ] as never);
    spies["cloud"]!.mockResolvedValue([
      cloudResource(CLOUD_ID, "checkout-alb"),
    ] as never);

    const names: Map<string, { kind: SecurityConnectionKind; name: string }> =
      await SecurityConnectedRecords.readNamesOfLogResources({
        projectId: PROJECT_ID,
        resources: [
          { type: ServiceType.Host, id: HOST_ID },
          { type: ServiceType.OpenTelemetry, id: SERVICE_ID },
          // The same record twice is read once.
          { type: ServiceType.OpenTelemetry, id: SERVICE_ID.toUpperCase() },
          { type: ServiceType.CloudResource, id: CLOUD_ID },
          // A kind no connection names, and an id that is none: never read.
          { type: ServiceType.Monitor, id: OTHER_HOST_ID },
          { type: ServiceType.Host, id: "edge-1" },
        ],
        props: CALLER,
      });

    expect(Array.from(names.entries())).toEqual(
      expect.arrayContaining([
        [
          `${SecurityConnectionKind.Host}:${HOST_ID}`,
          { kind: SecurityConnectionKind.Host, name: "edge-1" },
        ],
        [
          `${SecurityConnectionKind.Service}:${SERVICE_ID}`,
          { kind: SecurityConnectionKind.Service, name: "checkout-api" },
        ],
        [
          `${SecurityConnectionKind.CloudResource}:${CLOUD_ID}`,
          { kind: SecurityConnectionKind.CloudResource, name: "checkout-alb" },
        ],
      ]),
    );
    expect(names.size).toBe(3);

    expect(spies["host"]).toHaveBeenCalledTimes(1);
    expect(spies["service"]).toHaveBeenCalledTimes(1);
    expect(spies["monitor"]).not.toHaveBeenCalled();

    const serviceRead: FindArgs = spies["service"]!.mock
      .calls[0]![0] as FindArgs;

    expect(serviceRead.query["projectId"]).toBe(PROJECT_ID);
    expect(boundValues(serviceRead.query["_id"])).toEqual([SERVICE_ID]);
    expect(serviceRead.props).toBe(CALLER);
  });

  test("a kind the caller's role cannot read names none of its records, and is not an error", async () => {
    spies["host"]!.mockRejectedValue(new NotAuthorizedException("no"));
    spies["service"]!.mockRejectedValue(new Error("Postgres is down"));
    spies["cloud"]!.mockResolvedValue([
      cloudResource(CLOUD_ID, "checkout-alb"),
    ] as never);

    const names: Map<string, { kind: SecurityConnectionKind; name: string }> =
      await SecurityConnectedRecords.readNamesOfLogResources({
        projectId: PROJECT_ID,
        resources: [
          { type: ServiceType.Host, id: HOST_ID },
          { type: ServiceType.OpenTelemetry, id: SERVICE_ID },
          { type: ServiceType.CloudResource, id: CLOUD_ID },
        ],
        props: CALLER,
      });

    expect(Array.from(names.keys())).toEqual([
      `${SecurityConnectionKind.CloudResource}:${CLOUD_ID}`,
    ]);
    // The refusal is no error; the failure is.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String((logger.error as jest.Mock).mock.calls[0]![0])).toContain(
      "Service",
    );
  });

  test("a record with no name is not named; nothing to read reads nothing", async () => {
    spies["service"]!.mockResolvedValue([
      { id: new ObjectID(SERVICE_ID), name: "" },
    ] as never);

    expect(
      (
        await SecurityConnectedRecords.readNamesOfLogResources({
          projectId: PROJECT_ID,
          resources: [{ type: ServiceType.OpenTelemetry, id: SERVICE_ID }],
          props: CALLER,
        })
      ).size,
    ).toBe(0);

    spies["service"]!.mockClear();

    expect(
      (
        await SecurityConnectedRecords.readNamesOfLogResources({
          projectId: PROJECT_ID,
          resources: [],
          props: CALLER,
        })
      ).size,
    ).toBe(0);
    expect(spies["service"]).not.toHaveBeenCalled();
  });

  test(`at most ${MAX_ROWS_PER_READ} of one kind`, async () => {
    const resources: Array<{ type: string; id: string }> = [];

    for (let index: number = 0; index < MAX_ROWS_PER_READ + 5; index++) {
      resources.push({
        type: ServiceType.OpenTelemetry,
        id: ObjectID.generate().toString(),
      });
    }

    await SecurityConnectedRecords.readNamesOfLogResources({
      projectId: PROJECT_ID,
      resources,
      props: CALLER,
    });

    const read: FindArgs = spies["service"]!.mock.calls[0]![0] as FindArgs;

    expect(boundValues(read.query["_id"]).length).toBe(MAX_ROWS_PER_READ);
    expect(read.limit).toBe(MAX_ROWS_PER_READ);
  });
});

describe("monitors", () => {
  test("a monitor checking the host a case names: exact, with its status, read with the caller's own permissions", async () => {
    spies["monitor"]!.mockResolvedValue([
      monitor(MONITOR_ID, "Checkout site", [
        URL.fromString("https://shop.acme.example/health"),
      ]),
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Domain, value: "SHOP.acme.example" },
    ]);

    expect(result.records).toEqual([
      {
        kind: SecurityConnectionKind.Monitor,
        id: MONITOR_ID,
        name: "Checkout site",
        status: { name: "Operational", color: "#22c55e" },
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entity: {
              type: SecurityEntityType.Domain,
              value: "SHOP.acme.example",
            },
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.MonitorTarget,
            matchedValue: "shop.acme.example",
          },
        ],
      },
    ]);
    expect(result.unmatched).toEqual([]);

    const read: FindArgs = spies["monitor"]!.mock.calls[0]![0] as FindArgs;

    expect(read.query["projectId"]).toBe(PROJECT_ID);
    // An archived monitor checks nothing.
    expect(read.query["isArchived"]).toBe(false);
    expect(read.props).toBe(CALLER);
    expect(read.limit).toBe(MAX_MONITORS_READ);
    // Narrowed in the database to the monitors whose steps mention the value.
    expect(boundValues(read.query["monitorSteps"])).toEqual([
      '%"shop.acme.example"%',
      "%//shop.acme.example%",
      "%@shop.acme.example%",
      '%"shop"%',
      "%//shop/%",
      "%//shop:%",
      '%//shop"%',
    ]);
    expect(read.select).toEqual(
      expect.objectContaining({
        monitorSteps: true,
        currentMonitorStatus: { name: true, color: true },
      }),
    );
  });

  test("a URL on the host it checks, a public address and a private one: exact, exact, possible", async () => {
    spies["monitor"]!.mockResolvedValue([
      monitor(MONITOR_ID, "Checkout site", [
        URL.fromString("https://shop.acme.example/"),
      ]),
      monitor(OTHER_MONITOR_ID, "Edge ping", [
        new IP("203.0.113.7"),
        new IP("10.0.3.17"),
      ]),
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      {
        type: SecurityEntityType.Url,
        value: "https://shop.acme.example/admin/login",
      },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
      { type: SecurityEntityType.IpAddress, value: "10.0.3.17" },
    ]);
    const checkout: SecurityConnectedRecord | undefined = record(
      result,
      SecurityConnectionKind.Monitor,
      MONITOR_ID,
    );
    const edge: SecurityConnectedRecord | undefined = record(
      result,
      SecurityConnectionKind.Monitor,
      OTHER_MONITOR_ID,
    );

    expect(checkout?.matches).toEqual([
      {
        entity: {
          type: SecurityEntityType.Url,
          value: "https://shop.acme.example/admin/login",
        },
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.MonitorTarget,
        matchedValue: "shop.acme.example",
      },
    ]);
    expect(
      edge?.matches.map((match: { reason: SecurityConnectionReason }) => {
        return match.reason;
      }),
    ).toEqual([
      SecurityConnectionReason.MonitorTarget,
      SecurityConnectionReason.PrivateAddress,
    ]);
    expect(edge?.certainty).toBe(SecurityConnectionCertainty.Exact);
    expect(result.unmatched).toEqual([]);
  });

  test("a mention that is not what it checks - a header, a criterion, a longer name - is dropped", async () => {
    spies["monitor"]!.mockResolvedValue([
      monitor(MONITOR_ID, "Checkout API", [
        URL.fromString("https://api.acme.example/"),
      ]),
      monitor(OTHER_MONITOR_ID, "Web 10", [
        new Hostname("web-10.acme.example"),
      ]),
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "web-1.acme.example" },
    ]);

    expect(result.records).toEqual([]);
    expect(result.unmatched).toEqual([
      { type: SecurityEntityType.Host, value: "web-1.acme.example" },
    ]);
  });

  test("a short form, or a value not said to be a host: possible", async () => {
    spies["monitor"]!.mockResolvedValue([
      monitor(MONITOR_ID, "Web 1", [new Hostname("web-1.acme.internal")]),
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "web-1" },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return [
          item.certainty,
          item.matches[0]?.reason,
          item.matches[0]?.matchedValue,
        ];
      }),
    ).toEqual([
      [
        SecurityConnectionCertainty.Possible,
        SecurityConnectionReason.ShortHostName,
        "web-1.acme.internal",
      ],
    ]);
  });

  test("monitors the role cannot read are unreadable, and a value they could be is never called not in OneUptime", async () => {
    spies["monitor"]!.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read monitors.",
      ),
    );

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Url, value: "https://shop.acme.example/" },
      { type: SecurityEntityType.Host, value: "db-9" },
    ]);

    expect(result.unreadableKinds).toEqual([SecurityConnectionKind.Monitor]);
    expect(result.unmatched).toEqual([]);
  });

  test("nothing a monitor could check reads no monitor", async () => {
    await resolve([
      { type: SecurityEntityType.User, value: "kim@acme.example" },
      {
        type: SecurityEntityType.Other,
        value: "arn:aws:s3:::acme-prod-data",
      },
    ]);

    expect(spies["monitor"]).not.toHaveBeenCalled();
  });
});

describe("cloud resources", () => {
  test("by its own ID: exact, read with the caller's own permissions", async () => {
    const arn: string = "arn:aws:s3:::acme-prod-data";

    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return call.query["providerResourceId"] &&
        boundValues(call.query["providerResourceId"]).includes(arn)
        ? [
            cloudResource(CLOUD_ID, "acme-prod-data", {
              providerResourceId: arn,
            }),
          ]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: ` ${arn} ` },
    ]);

    expect(result.records).toEqual([
      {
        kind: SecurityConnectionKind.CloudResource,
        id: CLOUD_ID,
        name: "acme-prod-data",
        certainty: SecurityConnectionCertainty.Exact,
        matches: [
          {
            entity: {
              type: SecurityEntityType.Other,
              value: arn,
            },
            certainty: SecurityConnectionCertainty.Exact,
            reason: SecurityConnectionReason.ResourceId,
            matchedValue: arn,
          },
        ],
      },
    ]);

    const read: FindArgs = spies["cloud"]!.mock.calls.map(
      (call: Array<unknown>): FindArgs => {
        return call[0] as FindArgs;
      },
    ).find((args: FindArgs): boolean => {
      return Boolean(args.query["providerResourceId"]);
    })!;

    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(read.props).toBe(CALLER);
  });

  /*
   * #10034: an Azure resource ID is the resource whatever case it was
   * written in - Azure compares IDs without case - while an ARN or a Google
   * Cloud name of another case is another resource. Both are looked up by
   * LOWER(providerResourceId), which an index serves; each row is then held
   * to its cloud's rule.
   */
  test("by an Azure ID in any case: exact; looked up by its lower case", async () => {
    const id: string =
      "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments";

    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return call.query["providerResourceId"] &&
        boundValues(call.query["providerResourceId"]).includes(id.toLowerCase())
        ? [
            cloudResource(CLOUD_ID, "kv-Payments", {
              providerResourceId: id,
            }),
          ]
        : [];
    });

    const exported: string = id.toUpperCase();
    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: exported },
    ]);

    expect(
      record(result, SecurityConnectionKind.CloudResource, CLOUD_ID),
    ).toMatchObject({
      certainty: SecurityConnectionCertainty.Exact,
      matches: [
        {
          entity: { type: SecurityEntityType.Other, value: exported },
          reason: SecurityConnectionReason.ResourceId,
          matchedValue: id,
        },
      ],
    });
    expect(result.unmatched).toEqual([]);
  });

  test("an ARN or a Google Cloud name of another case is another resource: listed as unmatched, never matched", async () => {
    const table: string =
      "arn:aws:dynamodb:us-east-1:111122223333:table/Orders";
    const dataset: string =
      "//bigquery.googleapis.com/projects/acme-prod/datasets/MyDataset";

    // The index returns every row of the same lower case; the rule then decides.
    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (!call.query["providerResourceId"]) {
        return [];
      }

      const values: Array<unknown> = boundValues(
        call.query["providerResourceId"],
      );

      return [
        ...(values.includes(table.toLowerCase())
          ? [cloudResource(CLOUD_ID, "Orders", { providerResourceId: table })]
          : []),
        ...(values.includes(dataset.toLowerCase())
          ? [
              cloudResource(OTHER_CLOUD_ID, "MyDataset", {
                providerResourceId: dataset,
              }),
            ]
          : []),
      ];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: table.toLowerCase() },
      { type: SecurityEntityType.Other, value: dataset.toLowerCase() },
    ]);

    expect(result.records).toEqual([]);
    expect(result.unmatched).toEqual([
      { type: SecurityEntityType.Other, value: table.toLowerCase() },
      { type: SecurityEntityType.Other, value: dataset.toLowerCase() },
    ]);

    // Named as written, each is its resource; the other case of each stays unmatched.
    const both: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Other, value: table },
      { type: SecurityEntityType.Other, value: table.toLowerCase() },
    ]);

    expect(
      record(both, SecurityConnectionKind.CloudResource, CLOUD_ID)?.matches,
    ).toEqual([
      {
        entity: { type: SecurityEntityType.Other, value: table },
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.ResourceId,
        matchedValue: table,
      },
    ]);
    expect(both.unmatched).toEqual([
      { type: SecurityEntityType.Other, value: table.toLowerCase() },
    ]);
  });

  test("by a name it answers on: exact when the event says it is a host, possible when it does not, never by a short form", async () => {
    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return call.query["cloudEndpoints"]
        ? [
            cloudResource(CLOUD_ID, "checkout-alb", {
              cloudEndpoints: [
                "checkout-1234.us-east-1.elb.amazonaws.com",
                "203.0.113.50",
              ],
            }),
          ]
        : [];
    });

    const typed: SecurityConnectedRecordsResult = await resolve([
      {
        type: SecurityEntityType.Domain,
        value: "checkout-1234.us-east-1.elb.amazonaws.com",
      },
    ]);

    expect(
      typed.records.map((item: SecurityConnectedRecord) => {
        return [item.kind, item.certainty, item.matches[0]?.reason];
      }),
    ).toEqual([
      [
        SecurityConnectionKind.CloudResource,
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.CloudEndpoint,
      ],
    ]);

    const untyped: SecurityConnectedRecordsResult = await resolve([
      {
        type: SecurityEntityType.Other,
        value: "checkout-1234.us-east-1.elb.amazonaws.com",
      },
    ]);

    expect(untyped.records[0]?.certainty).toBe(
      SecurityConnectionCertainty.Possible,
    );

    // "checkout-1234" is the endpoint's first label, and names nothing on its own.
    const short: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "checkout-1234" },
    ]);

    expect(
      short.records.filter((item: SecurityConnectedRecord): boolean => {
        return item.kind === SecurityConnectionKind.CloudResource;
      }),
    ).toEqual([]);
  });

  test("by an address it answers on: counted among the cloud resources alone, so the host it runs stays exact too", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["hostIpAddresses"]) {
        return [host(HOST_ID, "web-1", { hostIpAddresses: "203.0.113.50" })];
      }

      return call.query["_id"] ? [host(HOST_ID, "web-1")] : [];
    });
    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["_id"]) {
        return [cloudResource(CLOUD_ID, "i-0abc (web-1)")];
      }

      return call.query["cloudEndpoints"]
        ? [
            cloudResource(CLOUD_ID, "i-0abc (web-1)", {
              cloudEndpoints: ["203.0.113.50"],
            }),
            // Mentions it inside a longer address: not one of its own.
            cloudResource(OTHER_CLOUD_ID, "other", {
              cloudEndpoints: ["203.0.113.501.example"],
            }),
          ]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.50" },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return [item.kind, item.id, item.certainty, item.matches[0]?.reason];
      }),
    ).toEqual([
      [
        SecurityConnectionKind.Host,
        HOST_ID,
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.Address,
      ],
      [
        SecurityConnectionKind.CloudResource,
        CLOUD_ID,
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.Address,
      ],
    ]);

    const holders: FindArgs = spies["cloud"]!.mock.calls.map(
      (call: Array<unknown>): FindArgs => {
        return call[0] as FindArgs;
      },
    ).find((args: FindArgs): boolean => {
      return (
        Boolean(args.query["cloudEndpoints"]) && Boolean(args.props.isRoot)
      );
    })!;
    const visible: FindArgs = spies["cloud"]!.mock.calls.map(
      (call: Array<unknown>): FindArgs => {
        return call[0] as FindArgs;
      },
    ).find((args: FindArgs): boolean => {
      return Boolean(args.query["_id"]);
    })!;

    // Counted as OneUptime, listed only as the caller may read them.
    expect(holders.props).toEqual({ isRoot: true });
    expect(visible.props).toBe(CALLER);
    expect(boundValues(visible.query["_id"])).toEqual([CLOUD_ID]);
  });

  test("two cloud resources answering on one address: each only possible", async () => {
    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["_id"]) {
        return [
          cloudResource(CLOUD_ID, "a"),
          cloudResource(OTHER_CLOUD_ID, "b"),
        ];
      }

      return call.query["cloudEndpoints"]
        ? [
            cloudResource(CLOUD_ID, "a", { cloudEndpoints: ["203.0.113.60"] }),
            cloudResource(OTHER_CLOUD_ID, "b", {
              cloudEndpoints: ["203.0.113.60"],
            }),
          ]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.60" },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return [item.id, item.certainty, item.matches[0]?.reason];
      }),
    ).toEqual([
      [
        CLOUD_ID,
        SecurityConnectionCertainty.Possible,
        SecurityConnectionReason.SharedAddress,
      ],
      [
        OTHER_CLOUD_ID,
        SecurityConnectionCertainty.Possible,
        SecurityConnectionReason.SharedAddress,
      ],
    ]);
  });

  test("a cloud resource the caller may not read is not listed, and the kind is said to be unreadable", async () => {
    spies["cloud"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["_id"]) {
        throw new NotAuthorizedException(
          "You do not have permission to read cloud resources.",
        );
      }

      return call.query["cloudEndpoints"]
        ? [cloudResource(CLOUD_ID, "a", { cloudEndpoints: ["203.0.113.60"] })]
        : [];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.60" },
    ]);

    expect(result.records).toEqual([]);
    expect(result.unreadableKinds).toEqual([
      SecurityConnectionKind.CloudResource,
    ]);
    expect(result.unmatched).toEqual([]);
  });
});

describe("one record, every way it is named", () => {
  test("a host named and holding the address: one record, exact first", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      if (call.query["hostIpAddresses"]) {
        return [host(HOST_ID, "web-1", { hostIpAddresses: "10.0.0.5" })];
      }

      return [host(HOST_ID, "web-1")];
    });

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.IpAddress, value: "10.0.0.5" },
      { type: SecurityEntityType.Host, value: "web-1" },
    ]);

    expect(result.records.length).toBe(1);
    expect(result.records[0]!.certainty).toBe(
      SecurityConnectionCertainty.Exact,
    );
    expect(
      result.records[0]!.matches.map(
        (match: { reason: SecurityConnectionReason }) => {
          return match.reason;
        },
      ),
    ).toEqual([
      SecurityConnectionReason.HostName,
      SecurityConnectionReason.PrivateAddress,
    ]);
  });

  test("exact records first, then by kind", async () => {
    spies["host"]!.mockImplementation(async (args: unknown) => {
      const call: FindArgs = args as FindArgs;

      return boundValues(call.query["hostIdentifier"]).includes("web-1.%")
        ? [host(HOST_ID, "web-1.acme.internal")]
        : [];
    });
    spies["cluster"]!.mockResolvedValue([
      {
        id: new ObjectID(CLUSTER_ID),
        name: "prod-eu",
        clusterIdentifier: "prod-eu",
      },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "web-1" },
      { type: SecurityEntityType.Host, value: "prod-eu" },
    ]);

    expect(
      result.records.map((item: SecurityConnectedRecord): string => {
        return `${item.kind}:${item.certainty}`;
      }),
    ).toEqual(["KubernetesCluster:Exact", "Host:Possible"]);
  });
});

describe("what the caller's role keeps from them, and what fails", () => {
  test("a refused kind is unreadable, a failed one failed, and the others still answer", async () => {
    spies["host"]!.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read hosts."),
    );
    spies["docker"]!.mockRejectedValue(new Error("connection reset"));
    spies["cluster"]!.mockResolvedValue([
      {
        id: new ObjectID(CLUSTER_ID),
        name: "prod-eu",
        clusterIdentifier: "prod-eu",
      },
    ] as never);

    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.Host, value: "prod-eu" },
    ]);

    expect(result.unreadableKinds).toEqual([SecurityConnectionKind.Host]);
    expect(result.failedKinds).toEqual([SecurityConnectionKind.DockerHost]);
    expect(
      result.records.map((item: SecurityConnectedRecord) => {
        return item.kind;
      }),
    ).toEqual([SecurityConnectionKind.KubernetesCluster]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a value that could not be looked up everywhere is never said to be not in OneUptime", async () => {
    // The members cannot be read; the hosts and devices answer, and hold nothing.
    spies["user"]!.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read users."),
    );

    const refused: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.User, value: "kim@acme.example" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
      { type: SecurityEntityType.Host, value: "db-9" },
    ]);

    expect(refused.unreadableKinds).toEqual([SecurityConnectionKind.User]);
    // The email may be a member's the role cannot see: it is not listed.
    expect(refused.unmatched).toEqual([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
      { type: SecurityEntityType.Host, value: "db-9" },
    ]);

    // A device read that fails leaves an address and a name unsure too.
    spies["user"]!.mockResolvedValue([]);
    spies["device"]!.mockRejectedValue(new Error("connection reset"));

    const failed: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.User, value: "kim@acme.example" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
      { type: SecurityEntityType.Host, value: "db-9" },
    ]);

    expect(failed.failedKinds).toEqual([SecurityConnectionKind.NetworkDevice]);
    expect(failed.unmatched).toEqual([
      { type: SecurityEntityType.User, value: "kim@acme.example" },
    ]);
  });

  test("wasLookedUpEverywhere: a name among the machines, clusters and devices, an address among the hosts and devices, an email among the members", () => {
    const unsure: (
      ...kinds: Array<SecurityConnectionKind>
    ) => ReadonlySet<SecurityConnectionKind> = (
      ...kinds: Array<SecurityConnectionKind>
    ): ReadonlySet<SecurityConnectionKind> => {
      return new Set(kinds);
    };
    const host: SecurityEntity = {
      type: SecurityEntityType.Host,
      value: "web-1",
    };
    const address: SecurityEntity = {
      type: SecurityEntityType.IpAddress,
      value: "203.0.113.9",
    };
    const email: SecurityEntity = {
      type: SecurityEntityType.User,
      value: "kim@acme.example",
    };

    expect(wasLookedUpEverywhere(host, unsure())).toBe(true);
    expect(
      wasLookedUpEverywhere(
        host,
        unsure(SecurityConnectionKind.KubernetesCluster),
      ),
    ).toBe(false);
    // Services are not looked up by name: an unreadable one changes nothing.
    expect(
      wasLookedUpEverywhere(host, unsure(SecurityConnectionKind.Service)),
    ).toBe(true);
    expect(
      wasLookedUpEverywhere(address, unsure(SecurityConnectionKind.User)),
    ).toBe(true);
    expect(
      wasLookedUpEverywhere(address, unsure(SecurityConnectionKind.Host)),
    ).toBe(false);
    expect(
      wasLookedUpEverywhere(email, unsure(SecurityConnectionKind.Host)),
    ).toBe(true);
    expect(
      wasLookedUpEverywhere(email, unsure(SecurityConnectionKind.User)),
    ).toBe(false);
    expect(SECURITY_CONNECTION_LOOKUP_KINDS.email).toEqual([
      SecurityConnectionKind.User,
    ]);
  });

  test("nothing to look up reads nothing", async () => {
    const result: SecurityConnectedRecordsResult = await resolve([
      { type: SecurityEntityType.User, value: "root" },
      {
        type: SecurityEntityType.FileHash,
        value: "44d88612fea8a8f36de82e1278abb02f",
      },
      { type: SecurityEntityType.Process, value: "powershell.exe -enc" },
      // A URL on a local address names no machine.
      { type: SecurityEntityType.Url, value: "http://127.0.0.1/admin" },
    ]);

    expect(result).toEqual({
      records: [],
      unmatched: [],
      unreadableKinds: [],
      failedKinds: [],
    });

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
