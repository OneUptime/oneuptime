import NetworkControllerApplianceLink, {
  LinkableDeviceIdentity,
  NetworkControllerApplianceLinkOutcome,
  rankLinkableAppliances,
} from "../../../../Server/Utils/NetworkController/NetworkControllerApplianceLink";
import NetworkControllerDeviceMatcher, {
  NetworkControllerDeviceMatches,
} from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceMatcher";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkTrafficUsageAggregationService, {
  NetworkTrafficUsageApplianceRow,
  NetworkTrafficUsageRefile,
} from "../../../../Server/Services/NetworkTrafficUsageAggregationService";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import {
  MAX_LISTED_APPLIANCES,
  NetworkControllerLinkableAppliance,
  NetworkControllerLinkableApplianceList,
} from "../../../../Types/NetworkController/NetworkControllerApplianceLink";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../../../Types/ObjectID";
import { NameLikenessReason } from "../../../../Utils/NetworkDevice/DeviceNameLikeness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Linking a device to the Meraki appliance it is, on the server (OneUptime
 * issue #5762): the appliances offered (whose traffic the person may read,
 * the likely ones first), the link (the serial number written as the
 * person, one appliance one device, the stored traffic filed under the
 * device) and the unlink (both undone). The refile never fails a link.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CONNECTION: string = "20000000-0000-4000-8000-000000000001";
const ROUTER: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000002");
const OTHER: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000003");
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("60000000-0000-4000-8000-000000000001"),
};

function row(
  overrides: Partial<NetworkTrafficUsageApplianceRow> = {},
): NetworkTrafficUsageApplianceRow {
  return {
    serial: "Q2PN-LDS0-0012",
    name: "LDS MX68",
    controllerNetworkId: "L_12",
    controllerNetworkName: "Branch 012 · Leeds",
    connectionId: CONNECTION,
    networkDeviceId: PROJECT.toString(),
    lastWindowEndAt: "2026-10-24T11:55:00.000Z",
    octets: 1000,
    ...overrides,
  };
}

function routerIdentity(
  overrides: Partial<LinkableDeviceIdentity> = {},
): LinkableDeviceIdentity {
  return {
    id: ROUTER.toString(),
    names: ["BR012-EDGE-GW01"],
    serials: [],
    serialNumber: "",
    ...overrides,
  };
}

function rank(data: {
  rows: Array<NetworkTrafficUsageApplianceRow>;
  device?: LinkableDeviceIdentity;
  search?: string;
  linkedDeviceNames?: Map<string, string>;
}): NetworkControllerLinkableApplianceList {
  return rankLinkableAppliances({
    device: data.device || routerIdentity(),
    projectId: PROJECT.toString(),
    rows: data.rows,
    connectionNames: new Map([[CONNECTION, "Acme Networks"]]),
    linkedDeviceNames: data.linkedDeviceNames || new Map(),
    search: data.search || "",
  });
}

function serialsOf(
  list: NetworkControllerLinkableApplianceList,
): Array<string> {
  return list.appliances.map(
    (appliance: NetworkControllerLinkableAppliance): string => {
      return appliance.serial;
    },
  );
}

describe("the appliances offered", () => {
  test("the likely ones first, each saying why; then the rest by name, numbers in their order", () => {
    const list: NetworkControllerLinkableApplianceList = rank({
      rows: [
        row({
          serial: "Q2-10",
          name: "Store 10 MX",
          controllerNetworkName: "Store 10",
        }),
        row({
          serial: "Q2-2",
          name: "Store 2 MX",
          controllerNetworkName: "Store 2",
        }),
        row({
          serial: "Q2-12",
          name: "LDS MX68",
          controllerNetworkName: "Branch 012 · Leeds",
        }),
      ],
    });

    expect(serialsOf(list)).toEqual(["Q2-12", "Q2-2", "Q2-10"]);
    expect(list.appliances[0]).toMatchObject({
      isLikely: true,
      likenessReason: NameLikenessReason.Number,
      likenessShared: "12",
      connectionName: "Acme Networks",
    });
    expect(list.appliances[1]!.isLikely).toBe(false);
    expect(list.total).toBe(3);
    expect(list.matching).toBe(3);
  });

  test("of several likely ones, the most alike first, then the busiest; never more than three", () => {
    const list: NetworkControllerLinkableApplianceList = rank({
      device: routerIdentity({ names: ["Store 2207 router", "STORE2207-MX"] }),
      rows: [
        row({
          serial: "Q2-A",
          name: "Store 2207 annex",
          controllerNetworkName: "",
          octets: 10,
        }),
        row({
          serial: "Q2-B",
          name: "store2207-mx",
          controllerNetworkName: "",
          octets: 1,
        }),
        row({
          serial: "Q2-C",
          name: "2207 spare",
          controllerNetworkName: "",
          octets: 99,
        }),
        row({
          serial: "Q2-D",
          name: "Depot 2207",
          controllerNetworkName: "",
          octets: 50,
        }),
        row({
          serial: "Q2-E",
          name: "Kiosk 2207",
          controllerNetworkName: "",
          octets: 5,
        }),
      ],
    });

    expect(
      list.appliances
        .filter((appliance: NetworkControllerLinkableAppliance) => {
          return appliance.isLikely;
        })
        .map((appliance: NetworkControllerLinkableAppliance) => {
          return appliance.serial;
        }),
    ).toEqual(["Q2-B", "Q2-C", "Q2-D"]);
  });

  test("an appliance another device is already: listed, saying which, and never offered first", () => {
    const list: NetworkControllerLinkableApplianceList = rank({
      rows: [row({ networkDeviceId: OTHER.toString() })],
      linkedDeviceNames: new Map([[OTHER.toString(), "Leeds edge router"]]),
    });

    expect(list.appliances[0]).toMatchObject({
      serial: "Q2PN-LDS0-0012",
      linkedDeviceId: OTHER.toString(),
      linkedDeviceName: "Leeds edge router",
      isLikely: false,
    });
  });

  test("another device the person may not read is named by no one", () => {
    const list: NetworkControllerLinkableApplianceList = rank({
      rows: [row({ networkDeviceId: OTHER.toString() })],
    });

    expect(list.appliances[0]!.linkedDeviceId).toBe(OTHER.toString());
    expect(list.appliances[0]!.linkedDeviceName).toBeUndefined();
  });

  test("the project's bucket is no device: its appliances are free to link", () => {
    expect(
      rank({ rows: [row()] }).appliances[0]!.linkedDeviceId,
    ).toBeUndefined();
  });

  test("the appliance this device is already can still be offered first", () => {
    const list: NetworkControllerLinkableApplianceList = rank({
      rows: [row({ networkDeviceId: ROUTER.toString() })],
    });

    expect(list.appliances[0]).toMatchObject({
      isLikely: true,
      linkedDeviceId: ROUTER.toString(),
    });
  });

  test("a search narrows by name, serial number, network or connection, case aside", () => {
    const rows: Array<NetworkTrafficUsageApplianceRow> = [
      row({
        serial: "Q2-AAAA-0001",
        name: "Leeds MX",
        controllerNetworkName: "North",
      }),
      row({
        serial: "Q2-BBBB-0002",
        name: "Bristol MX",
        controllerNetworkName: "South",
      }),
    ];

    expect(serialsOf(rank({ rows, search: "LEEDS" }))).toEqual([
      "Q2-AAAA-0001",
    ]);
    expect(serialsOf(rank({ rows, search: "bbbb" }))).toEqual(["Q2-BBBB-0002"]);
    expect(serialsOf(rank({ rows, search: "south" }))).toEqual([
      "Q2-BBBB-0002",
    ]);
    expect(rank({ rows, search: "acme" }).matching).toBe(2);

    const none: NetworkControllerLinkableApplianceList = rank({
      rows,
      search: "coventry",
    });
    expect(none.appliances).toEqual([]);
    expect(none.matching).toBe(0);
    expect(none.total).toBe(2);
  });

  test("at most fifty are listed: the search finds the rest", () => {
    const rows: Array<NetworkTrafficUsageApplianceRow> = [];

    for (let index: number = 0; index < 120; index++) {
      rows.push(
        row({
          serial: `Q2-${String(index).padStart(4, "0")}`,
          name: `Kiosk ${index}`,
          controllerNetworkName: "",
        }),
      );
    }

    const list: NetworkControllerLinkableApplianceList = rank({
      rows,
      device: routerIdentity({ names: ["nothing alike"] }),
    });

    expect(list.appliances).toHaveLength(MAX_LISTED_APPLIANCES);
    expect(list.total).toBe(120);
    expect(list.matching).toBe(120);
    // Numbers in their order: Kiosk 0, 1, 2 ... never Kiosk 0, 1, 10.
    expect(list.appliances[2]!.name).toBe("Kiosk 2");
  });
});

describe("the names a device is known by", () => {
  test("its name, its system names, Meraki's name for it and its host name; its serial numbers", () => {
    const device: NetworkDevice = new NetworkDevice(ROUTER);
    device.name = "BR012-EDGE-GW01";
    device.sysName = "br012-rtr";
    device.hostname = "203.0.113.12";
    device.serialNumber = " q2pn-lds0-0012 ";
    device.discoveredDetails = {
      sysName: {
        value: "br012-rtr.example",
        method: "snmp",
        readBy: { type: "discoveryScan", id: CONNECTION, name: "Scan" },
        readAt: "2026-10-24T11:00:00.000Z",
      },
      controller: {
        provider: NetworkControllerProvider.Meraki,
        readBy: { type: "networkController", id: CONNECTION, name: "Acme" },
        readAt: "2026-10-24T11:00:00.000Z",
        values: { name: "LDS MX68", serialNumber: "Q2PN-LDS0-0012" },
      },
    };

    const identity: LinkableDeviceIdentity =
      NetworkControllerApplianceLink.getDeviceIdentity(device);

    expect(identity.id).toBe(ROUTER.toString());
    expect(identity.names).toEqual([
      "BR012-EDGE-GW01",
      "br012-rtr",
      "br012-rtr.example",
      "LDS MX68",
      "203.0.113.12",
    ]);
    expect(identity.serials).toEqual(["Q2PN-LDS0-0012", "Q2PN-LDS0-0012"]);
    expect(identity.serialNumber).toBe("Q2PN-LDS0-0012");
  });
});

describe("as the person asks", () => {
  let device: NetworkDevice;
  let readable: boolean;
  let deviceLookups: Array<{ select: unknown; props: unknown }>;
  let connections: Array<NetworkControllerConnection>;
  let appliances: Array<NetworkTrafficUsageApplianceRow>;
  let applianceAsks: Array<{
    serials?: Array<string> | undefined;
    controllerNetworkIds?: Array<string> | undefined;
    since: Date;
    limit: number;
    devices: TelemetryServiceFilter;
  }>;
  let holders: Array<NetworkDevice>;
  let named: Array<NetworkDevice>;
  let updates: Array<{ data: unknown; props: unknown }>;
  let refiles: Array<NetworkTrafficUsageRefile>;
  let refileFails: boolean;
  let networkOwner: ObjectID;
  let scope: TelemetryReadScope;

  beforeEach(() => {
    device = new NetworkDevice(ROUTER);
    device.name = "BR012-EDGE-GW01";
    readable = true;
    deviceLookups = [];
    const connection: NetworkControllerConnection =
      new NetworkControllerConnection();
    connection.id = new ObjectID(CONNECTION);
    connection.name = "Acme Networks";
    connections = [connection];
    appliances = [row()];
    applianceAsks = [];
    holders = [];
    named = [];
    updates = [];
    refiles = [];
    refileFails = false;
    networkOwner = ROUTER;
    scope = TelemetryReadScopeUtil.getUnrestrictedScope();

    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockImplementation((async (data: {
        select: unknown;
        props: unknown;
      }) => {
        deviceLookups.push({ select: data.select, props: data.props });
        return readable ? device : null;
      }) as never);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockImplementation((async (data: { select: { name?: boolean } }) => {
        return data.select.name ? named : holders;
      }) as never);
    jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockImplementation((async (data: { data: unknown; props: unknown }) => {
        updates.push({ data: data.data, props: data.props });
        return 1;
      }) as never);
    jest
      .spyOn(NetworkControllerConnectionService, "findBy")
      .mockImplementation((async () => {
        return connections;
      }) as never);
    jest
      .spyOn(TelemetryReadAccess, "getScope")
      .mockImplementation(async (): Promise<TelemetryReadScope> => {
        return scope;
      });
    jest
      .spyOn(NetworkTrafficUsageAggregationService, "getAppliances")
      .mockImplementation((async (data: {
        serials?: Array<string>;
        controllerNetworkIds?: Array<string>;
        since: Date;
        limit: number;
        devices: TelemetryServiceFilter;
      }) => {
        applianceAsks.push(data);
        return appliances.filter(
          (candidate: NetworkTrafficUsageApplianceRow) => {
            return !data.serials || data.serials.includes(candidate.serial);
          },
        );
      }) as never);
    jest
      .spyOn(NetworkTrafficUsageAggregationService, "refile")
      .mockImplementation((async (refile: NetworkTrafficUsageRefile) => {
        if (refileFails) {
          throw new Error("ClickHouse refused the mutation");
        }

        refiles.push(refile);
        return true;
      }) as never);
    jest
      .spyOn(NetworkTrafficUsageAggregationService, "getStorageTable")
      .mockReturnValue({
        databaseName: "oneuptime",
        storageTable: "NetworkTrafficUsageV1Local",
        onCluster: "",
      });
    jest
      .spyOn(NetworkControllerDeviceMatcher, "match")
      .mockImplementation((async (data: {
        appliances: Array<{ serial: string; controllerNetworkId: string }>;
      }): Promise<NetworkControllerDeviceMatches> => {
        return {
          bySerial: new Map(),
          byNetwork: new Map([
            [data.appliances[0]?.controllerNetworkId || "", networkOwner],
          ]),
        };
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the list", () => {
    test("of a device the person may not read: not found", async () => {
      readable = false;

      await expect(
        NetworkControllerApplianceLink.listAppliances({
          props: PROPS,
          request: { networkDeviceId: ROUTER, search: "" },
          now: NOW,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    test("the device is found as the person first, then read as the server", async () => {
      await NetworkControllerApplianceLink.listAppliances({
        props: PROPS,
        request: { networkDeviceId: ROUTER, search: "" },
        now: NOW,
      });

      expect(deviceLookups[0]).toEqual({ select: { _id: true }, props: PROPS });
      expect(deviceLookups[1]!.props).toEqual({ isRoot: true });
    });

    test("a project with no connection the person may read: nothing to link to, and ClickHouse not asked", async () => {
      connections = [];

      expect(
        await NetworkControllerApplianceLink.listAppliances({
          props: PROPS,
          request: { networkDeviceId: ROUTER, search: "" },
          now: NOW,
        }),
      ).toEqual({ appliances: [], total: 0, matching: 0 });
      expect(applianceAsks).toHaveLength(0);
    });

    test("a person who may not read connections: nothing to link to", async () => {
      jest
        .spyOn(NetworkControllerConnectionService, "findBy")
        .mockImplementation((async () => {
          throw new NotAuthorizedException("No");
        }) as never);

      expect(
        (
          await NetworkControllerApplianceLink.listAppliances({
            props: PROPS,
            request: { networkDeviceId: ROUTER, search: "" },
            now: NOW,
          })
        ).total,
      ).toBe(0);
    });

    test("the appliances of the last week the person may read, the likely first", async () => {
      appliances = [
        row({
          serial: "Q2-B",
          name: "Bristol MX",
          controllerNetworkName: "Branch 047",
        }),
        row(),
      ];

      const list: NetworkControllerLinkableApplianceList =
        await NetworkControllerApplianceLink.listAppliances({
          props: PROPS,
          request: { networkDeviceId: ROUTER, search: "" },
          now: NOW,
        });

      expect(serialsOf(list)).toEqual(["Q2PN-LDS0-0012", "Q2-B"]);
      expect(applianceAsks[0]!.since.toISOString()).toBe(
        "2026-10-17T12:00:00.000Z",
      );
      expect(applianceAsks[0]!.serials).toBeUndefined();
      expect(applianceAsks[0]!.devices.serviceIds).toBeUndefined();
    });

    test("a person limited to some devices reads only those devices' appliances", async () => {
      scope = { readableIds: [OTHER.toString()], blockedIds: [] } as never;

      await NetworkControllerApplianceLink.listAppliances({
        props: PROPS,
        request: { networkDeviceId: ROUTER, search: "" },
        now: NOW,
      });

      expect(
        applianceAsks[0]!.devices.serviceIds?.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([OTHER.toString()]);
    });

    test("the devices the appliances are already are named as the person may read them", async () => {
      appliances = [row({ networkDeviceId: OTHER.toString() })];
      const other: NetworkDevice = new NetworkDevice(OTHER);
      other.name = "Leeds edge router";
      named = [other];

      const list: NetworkControllerLinkableApplianceList =
        await NetworkControllerApplianceLink.listAppliances({
          props: PROPS,
          request: { networkDeviceId: ROUTER, search: "" },
          now: NOW,
        });

      expect(list.appliances[0]!.linkedDeviceName).toBe("Leeds edge router");
    });
  });

  describe("a link", () => {
    async function link(
      serial: string = "Q2PN-LDS0-0012",
    ): Promise<NetworkControllerApplianceLinkOutcome> {
      return await NetworkControllerApplianceLink.link({
        props: PROPS,
        request: { networkDeviceId: ROUTER, deviceSerial: serial },
        now: NOW,
      });
    }

    test("writes the serial number as the person, and files the appliance's stored traffic under the device", async () => {
      expect(await link()).toEqual({
        deviceSerial: "Q2PN-LDS0-0012",
        isRefiled: true,
      });

      expect(updates).toEqual([
        { data: { serialNumber: "Q2PN-LDS0-0012" }, props: PROPS },
      ]);
      expect(refiles).toEqual([
        {
          projectId: PROJECT,
          fromDeviceId: PROJECT,
          appliances: [{ serial: "Q2PN-LDS0-0012", deviceId: ROUTER }],
          networks: [{ controllerNetworkId: "L_12", deviceId: ROUTER }],
          since: new Date("2026-09-22T12:00:00.000Z"),
        },
      ]);
    });

    test("the network's applications and clients only when the device is the appliance they go to", async () => {
      networkOwner = OTHER;

      await link();

      expect(refiles[0]!.networks).toEqual([]);
      expect(refiles[0]!.appliances).toHaveLength(1);
    });

    test("an appliance the connections did not report lately is refused, and nothing is written", async () => {
      await expect(link("Q2PN-NONE-0001")).rejects.toThrow(
        "No Meraki connection of this project reported an appliance with serial number Q2PN-NONE-0001 in the last 7 days.",
      );
      expect(updates).toEqual([]);
      expect(refiles).toEqual([]);
    });

    test("an appliance another device is already is refused, naming that device", async () => {
      appliances = [row({ networkDeviceId: OTHER.toString() })];
      const other: NetworkDevice = new NetworkDevice(OTHER);
      other.name = "Leeds edge router";
      named = [other];

      await expect(link()).rejects.toThrow(
        "This appliance is linked to Leeds edge router already. Unlink it there first.",
      );
      expect(updates).toEqual([]);
    });

    test("another device holding the serial number - linked a moment ago - is refused too", async () => {
      holders = [new NetworkDevice(OTHER)];

      await expect(link()).rejects.toThrow(
        "This appliance is linked to another device already. Unlink it there first.",
      );
      expect(updates).toEqual([]);
    });

    test("a device with another serial number is refused: one device is one appliance", async () => {
      device.serialNumber = "FOC1932X0K1";

      await expect(link()).rejects.toThrow(BadDataException);
      expect(updates).toEqual([]);
    });

    test("linking again what the device is: nothing written, its traffic filed all the same", async () => {
      device.serialNumber = "q2pn-lds0-0012";
      holders = [device];

      await link();

      expect(updates).toEqual([]);
      expect(refiles).toHaveLength(1);
    });

    test("a person who may not change a device's serial number is refused, and nothing is filed", async () => {
      jest
        .spyOn(NetworkDeviceService, "updateOneById")
        .mockImplementation((async () => {
          throw new NotAuthorizedException(
            "You do not have permission to update serialNumber",
          );
        }) as never);

      await expect(link()).rejects.toThrow(NotAuthorizedException);
      expect(refiles).toEqual([]);
    });

    test("a refile that fails never fails the link: the next read files it", async () => {
      refileFails = true;

      expect(await link()).toEqual({
        deviceSerial: "Q2PN-LDS0-0012",
        isRefiled: false,
      });
      expect(updates).toHaveLength(1);
    });

    test("of a device the person may not read: not found, nothing written", async () => {
      readable = false;

      await expect(link()).rejects.toThrow(NotFoundException);
      expect(updates).toEqual([]);
    });
  });

  describe("an unlink", () => {
    async function unlink(): Promise<NetworkControllerApplianceLinkOutcome> {
      return await NetworkControllerApplianceLink.unlink({
        props: PROPS,
        request: { networkDeviceId: ROUTER },
        now: NOW,
      });
    }

    test("takes the serial number off as the person, and returns the traffic to the network's page", async () => {
      device.serialNumber = "Q2PN-LDS0-0012";

      expect(await unlink()).toEqual({
        deviceSerial: "Q2PN-LDS0-0012",
        isRefiled: true,
      });
      expect(updates).toEqual([{ data: { serialNumber: null }, props: PROPS }]);
      expect(refiles).toEqual([
        {
          projectId: PROJECT,
          fromDeviceId: ROUTER,
          appliances: [{ serial: "Q2PN-LDS0-0012", deviceId: PROJECT }],
          networks: [{ controllerNetworkId: "L_12", deviceId: PROJECT }],
          since: new Date("2026-09-22T12:00:00.000Z"),
        },
      ]);
    });

    test("a device with no serial number on it is not linked by one: refused", async () => {
      await expect(unlink()).rejects.toThrow(
        "This device is not linked to a Meraki appliance by its serial number.",
      );
      expect(updates).toEqual([]);
    });

    test("a refile that fails never fails the unlink", async () => {
      device.serialNumber = "Q2PN-LDS0-0012";
      refileFails = true;

      expect((await unlink()).isRefiled).toBe(false);
      expect(updates).toHaveLength(1);
    });
  });
});
