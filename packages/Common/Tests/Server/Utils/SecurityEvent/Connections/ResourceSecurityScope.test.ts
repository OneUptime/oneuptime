import CloudResourceService from "../../../../../Server/Services/CloudResourceService";
import HostService from "../../../../../Server/Services/HostService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityEntityRiskService from "../../../../../Server/Services/SecurityEntityRiskService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityCaseValues from "../../../../../Server/Utils/SecurityCase/SecurityCaseValues";
import ResourceSecurity, {
  getResourceSecurityEventScope,
} from "../../../../../Server/Utils/SecurityEvent/Connections/ResourceSecurity";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { NETWORK_DEVICE_ID_ATTRIBUTE } from "../../../../../Types/NetworkDevice/NetworkDeviceTelemetryAttribute";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  ResourceSecurityJson,
  ResourceSecurityScopeJson,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SecurityConnectionKind,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { hasSecurityEventScopeMatch } from "../../../../../Types/SecurityEvent/SecurityEventScope";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT A RECORD'S OWN SECURITY EVENTS PAGE READS UNDER (issue #5769).
 *
 * A network device's page reads the events naming its exact identities -
 * the ones its Security card counts by - or read from its own syslog,
 * whatever they name. The server says which: it reads the device with the
 * caller's own permissions and knows which public addresses are the
 * device's own. And the card counts the device's own logs too, so the
 * card and the page agree.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-10-25T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("77777777-7777-4777-8777-777777777777"),
  tenantId: PROJECT_ID,
};

let inUseSpy: jest.SpyInstance;
let countSpy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  inUseSpy = jest
    .spyOn(SecurityEventService, "hasEventsSince")
    .mockResolvedValue(true);
  countSpy = jest
    .spyOn(SecurityEventService, "countEventsNaming")
    .mockResolvedValue({
      eventCount: 12,
      findingCount: 2,
      maxSeverityId: 4,
      lastSeen: new Date("2026-10-25T11:00:00.000Z"),
    });
  jest
    .spyOn(SecurityCaseValues, "getOpenStatusIds")
    .mockResolvedValue([new ObjectID("66666666-6666-4666-8666-666666666666")]);
  jest.spyOn(SecurityCaseService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(SecurityCaseService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(SecurityEntityRiskService, "findBy").mockResolvedValue([]);
  // Nobody else holds an address unless a test says so.
  jest.spyOn(HostService, "findBy").mockResolvedValue([]);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
  jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function readDevice(device: Record<string, unknown> = {}): jest.SpyInstance {
  return jest.spyOn(NetworkDeviceService, "findOneBy").mockResolvedValue({
    id: DEVICE_ID,
    name: "HQ Firewall",
    hostname: "10.0.0.1",
    dnsName: "fw.hq.example",
    otherAddresses: "203.0.113.7, 192.168.1.1",
    ...device,
  } as never);
}

function readScope(
  kind: SecurityConnectionKind = SecurityConnectionKind.NetworkDevice,
  id: ObjectID = DEVICE_ID,
): Promise<ResourceSecurityScopeJson | null> {
  return ResourceSecurity.readScope({
    projectId: PROJECT_ID,
    kind,
    id,
    props: CALLER,
  });
}

describe("ResourceSecurity.readScope: a network device", () => {
  test("its names and own public address, in the usual spellings, or its own logs", async () => {
    readDevice();

    const scope: ResourceSecurityScopeJson | null = await readScope();

    expect(scope).toEqual({
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID.toString(),
      name: "HQ Firewall",
      // Folded, each once; its private addresses left out.
      values: ["hq firewall", "fw.hq.example", "203.0.113.7"],
      isSearchedByLogs: false,
      scope: {
        observables: [
          "hq firewall",
          "HQ FIREWALL",
          "fw.hq.example",
          "FW.HQ.EXAMPLE",
          "203.0.113.7",
        ],
        attributeKey: NETWORK_DEVICE_ID_ATTRIBUTE,
        attributeValues: [DEVICE_ID.toString()],
      },
    });
  });

  test("the device is read as the caller, inside the project", async () => {
    const find: jest.SpyInstance = readDevice();

    await readScope();

    expect(find.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, _id: DEVICE_ID.toString() },
      props: CALLER,
    });
  });

  test("a device the caller may not read, or of another project, has no page to read", async () => {
    jest.spyOn(NetworkDeviceService, "findOneBy").mockResolvedValue(null);

    expect(await readScope()).toBeNull();
  });

  test("read whether or not the project had an event this week, and counts nothing", async () => {
    readDevice();
    inUseSpy.mockResolvedValue(false);

    const scope: ResourceSecurityScopeJson | null = await readScope();

    expect(scope?.values.length).toBeGreaterThan(0);
    expect(inUseSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
  });

  test("a public address another device holds too is left out; the device's own logs are still its own", async () => {
    readDevice();
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        { id: OTHER_DEVICE_ID, otherAddresses: "203.0.113.7" },
      ] as never);

    const scope: ResourceSecurityScopeJson | null = await readScope();

    expect(scope?.values).toEqual(["hq firewall", "fw.hq.example"]);
    expect(scope?.scope.observables).not.toContain("203.0.113.7");
    expect(scope?.scope.attributeValues).toEqual([DEVICE_ID.toString()]);
  });

  test("a hostname that is an address counts as one, never as a name", async () => {
    readDevice({
      name: "edge",
      hostname: "198.51.100.1",
      dnsName: undefined,
      otherAddresses: undefined,
    });

    expect((await readScope())?.values).toEqual(["edge", "198.51.100.1"]);
  });

  test("a device known only by a private address is still read by its own logs", async () => {
    readDevice({
      name: "",
      hostname: "10.0.0.1",
      dnsName: "",
      otherAddresses: "192.168.1.1",
    });

    const scope: ResourceSecurityScopeJson | null = await readScope();

    expect(scope?.values).toEqual([]);
    expect(scope?.scope.observables).toEqual([]);
    expect(scope?.scope.attributeKey).toBe(NETWORK_DEVICE_ID_ATTRIBUTE);
    expect(hasSecurityEventScopeMatch(scope?.scope)).toBe(true);
  });
});

describe("ResourceSecurity.readScope: other records", () => {
  test("a host is read by its names and addresses alone: it has no device logs", async () => {
    jest.spyOn(HostService, "findOneBy").mockResolvedValue({
      id: DEVICE_ID,
      name: "Web One",
      hostIdentifier: "web-1",
      hostIpAddresses: "10.0.0.5, 203.0.113.9",
    } as never);

    const scope: ResourceSecurityScopeJson | null = await readScope(
      SecurityConnectionKind.Host,
    );

    expect(scope?.scope).toEqual({
      observables: ["web-1", "WEB-1", "web one", "WEB ONE", "203.0.113.9"],
    });
  });

  test("a service is read by the events read from its logs", async () => {
    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue({
      id: DEVICE_ID,
      name: "checkout",
    } as never);

    const scope: ResourceSecurityScopeJson | null = await readScope(
      SecurityConnectionKind.Service,
    );

    expect(scope).toMatchObject({
      name: "checkout",
      values: [],
      isSearchedByLogs: true,
      scope: {
        observables: [],
        attributeKey: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
        attributeValues: [DEVICE_ID.toString()],
      },
    });
  });

  test("a cloud resource with no name or address of its own is read by its logs", async () => {
    jest.spyOn(CloudResourceService, "findOneBy").mockResolvedValue({
      id: DEVICE_ID,
      name: "queue",
      providerResourceId: "",
      cloudEndpoints: undefined,
    } as never);

    const scope: ResourceSecurityScopeJson | null = await readScope(
      SecurityConnectionKind.CloudResource,
    );

    expect(scope?.isSearchedByLogs).toBe(true);
    expect(scope?.scope).toEqual({
      observables: [],
      attributeKey: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
      attributeValues: [DEVICE_ID.toString()],
    });
  });
});

describe("ResourceSecurity.read: a network device's Security card counts its own logs", () => {
  test("the events naming it, or read from its own syslog, over the week", async () => {
    readDevice();

    const security: ResourceSecurityJson | null = await ResourceSecurity.read({
      projectId: PROJECT_ID,
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID,
      props: CALLER,
      now: NOW,
    });

    expect(security?.eventCount).toBe(12);
    expect(countSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      values: [
        "hq firewall",
        "HQ FIREWALL",
        "fw.hq.example",
        "FW.HQ.EXAMPLE",
        "203.0.113.7",
      ],
      attribute: {
        key: NETWORK_DEVICE_ID_ATTRIBUTE,
        value: DEVICE_ID.toString(),
      },
      startTime: new Date("2026-10-18T12:00:00.000Z"),
      endTime: NOW,
    });
    // Its own logs are its own: no log resource is asked for besides.
    expect(countSpy.mock.calls[0]![0]).not.toHaveProperty("logResourceId");
  });

  test("a host's card is counted as before: no device attribute", async () => {
    jest.spyOn(HostService, "findOneBy").mockResolvedValue({
      id: DEVICE_ID,
      name: "Web One",
      hostIdentifier: "web-1",
    } as never);

    await ResourceSecurity.read({
      projectId: PROJECT_ID,
      kind: SecurityConnectionKind.Host,
      id: DEVICE_ID,
      props: CALLER,
      now: NOW,
    });

    expect(countSpy.mock.calls[0]![0]).not.toHaveProperty("attribute");
  });

  test("the card and the page are read from the same identities", async () => {
    readDevice();

    const security: ResourceSecurityJson | null = await ResourceSecurity.read({
      projectId: PROJECT_ID,
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID,
      props: CALLER,
      now: NOW,
    });
    const scope: ResourceSecurityScopeJson | null = await readScope();

    expect(scope?.values).toEqual(security?.values);
    expect(scope?.scope.observables).toEqual(countSpy.mock.calls[0]![0].values);
  });
});

describe("getResourceSecurityEventScope", () => {
  test("a record's identities, in the spellings searched for", () => {
    expect(
      getResourceSecurityEventScope({
        id: DEVICE_ID,
        values: ["web-1"],
        isSearchedByLogs: false,
      }),
    ).toEqual({ observables: ["web-1", "WEB-1"] });
  });

  test("and its own logs' attribute, when it has one", () => {
    expect(
      getResourceSecurityEventScope({
        id: DEVICE_ID,
        values: ["edge"],
        isSearchedByLogs: false,
        logAttribute: { key: NETWORK_DEVICE_ID_ATTRIBUTE, value: "device-id" },
      }),
    ).toEqual({
      observables: ["edge", "EDGE"],
      attributeKey: NETWORK_DEVICE_ID_ATTRIBUTE,
      attributeValues: ["device-id"],
    });
  });

  test("a record searched for by its logs names none of its identities", () => {
    expect(
      getResourceSecurityEventScope({
        id: DEVICE_ID,
        values: ["ignored"],
        isSearchedByLogs: true,
      }),
    ).toEqual({
      observables: [],
      attributeKey: SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
      attributeValues: [DEVICE_ID.toString()],
    });
  });

  test("a record with nothing to name and no logs matches nothing", () => {
    expect(
      hasSecurityEventScopeMatch(
        getResourceSecurityEventScope({
          id: DEVICE_ID,
          values: [],
          isSearchedByLogs: false,
        }),
      ),
    ).toBe(false);
  });
});
