import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import GlobalProbeSnmpTrapReportService from "../../../../Server/Services/GlobalProbeSnmpTrapReportService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import SnmpTrapReceiverReports, {
  MAX_DNS_NAMED_DEVICES_PER_REPORT,
} from "../../../../Server/Utils/Monitor/SnmpTrapReceiverReports";
import SnmpAuthProtocol from "../../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpSecurityLevel from "../../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import ObjectID from "../../../../Types/ObjectID";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "../../../../Types/Probe/SnmpTrapReceiver";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE A PROBE'S RECEIVER REPORT IS KEPT, AND FOR WHOM (#11173, #11406).
 *
 * A project's own probe keeps its report whole, each refusal naming the
 * devices it came from. A global probe keeps what belongs to no project on
 * itself, and each project's refused traps for that project alone, split as
 * the report arrives by the probe's own devices' addresses - typed, or what
 * their DNS names resolve to - and the user names each project handed it.
 */

const PROBE: ObjectID = new ObjectID("11730000-0000-4000-8000-000000000001");
const ACME: string = "11730000-0000-4000-8000-00000000ac0e";
const GLOBEX: string = "11730000-0000-4000-8000-000000060be8";

function refusal(fields: Partial<SnmpTrapRefusal>): SnmpTrapRefusal {
  return {
    sourceAddress: "203.0.113.10",
    reason: SnmpTrapRefusalReason.WrongDigest,
    userName: "monitor",
    count: 2,
    firstSeenAt: "2026-11-27T08:00:00.000Z",
    lastSeenAt: "2026-11-27T09:00:00.000Z",
    ...fields,
  };
}

const REPORT: SnmpTrapReceiverReport = {
  isEnabled: true,
  port: 162,
  engineId: "8000B98380A1B2C3D4E5F60718293A4B",
  userCount: 4,
  lastReceivedAt: "2026-11-27T09:30:00.000Z",
  refusals: [
    refusal({ sourceAddress: "203.0.113.10", userName: "monitor" }),
    refusal({ sourceAddress: "198.51.100.20", userName: "globex-traps" }),
    refusal({ sourceAddress: "192.0.2.99", userName: "scanner" }),
  ],
};

function user(
  userName: string,
  projectIds: Array<string>,
): SnmpTrapReceiverUser {
  return {
    userName: userName,
    securityLevel: SnmpSecurityLevel.AuthNoPriv,
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: "auth-passphrase",
    addresses: [],
    heldBy: { projectIds: projectIds },
  };
}

function device(
  projectId: string,
  hostname: string,
  otherAddresses?: string,
): NetworkDevice {
  const model: NetworkDevice = new NetworkDevice(ObjectID.generate());
  model.projectId = new ObjectID(projectId);
  model.hostname = hostname;

  if (otherAddresses) {
    model.otherAddresses = otherAddresses;
  }

  return model;
}

function idOf(model: NetworkDevice): string {
  return model.id!.toString().toLowerCase();
}

const ACME_SWITCH: NetworkDevice = device(ACME, "203.0.113.10");
const GLOBEX_SWITCH: NetworkDevice = device(GLOBEX, "198.51.100.20");

let recordOnProbe: MockFunction;
let recordShares: MockFunction;
let findDevices: MockFunction;
let findDnsNamed: MockFunction;
let resolveHostnames: MockFunction;

// What the report was kept as on the probe's own row.
function keptOnTheProbe(): SnmpTrapReceiverReport {
  return (recordOnProbe.mock.calls[0]![0] as { report: SnmpTrapReceiverReport })
    .report;
}

function sharesRecorded(): Map<string, Array<SnmpTrapRefusal>> {
  return (
    recordShares.mock.calls[0]![0] as {
      sharesByProject: Map<string, Array<SnmpTrapRefusal>>;
    }
  ).sharesByProject;
}

beforeEach(() => {
  recordOnProbe = jest
    .spyOn(ProbeService, "recordSnmpTrapReceiverReport")
    .mockResolvedValue({
      isKept: true,
      isGlobalProbe: false,
    } as never) as unknown as MockFunction;
  recordShares = jest
    .spyOn(GlobalProbeSnmpTrapReportService, "recordShares")
    .mockResolvedValue(undefined as never) as unknown as MockFunction;
  findDevices = jest
    .spyOn(NetworkDeviceService, "findDevicesAtAddressesOnProbe")
    .mockResolvedValue([
      ACME_SWITCH,
      GLOBEX_SWITCH,
    ] as never) as unknown as MockFunction;
  findDnsNamed = jest
    .spyOn(NetworkDeviceService, "findDnsNamedDevicesOnProbe")
    .mockResolvedValue([] as never) as unknown as MockFunction;
  resolveHostnames = jest.spyOn(
    NetworkDeviceHydrationUtil,
    "resolveHostnames",
  ) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project's own probe", () => {
  test("keeps the report whole on the probe, each refusal naming the devices it came from, and splits nothing", async () => {
    expect(
      await SnmpTrapReceiverReports.record({
        probeId: PROBE,
        report: REPORT,
        users: [],
      }),
    ).toBe(true);

    expect(recordOnProbe).toHaveBeenCalledWith({
      probeId: PROBE,
      report: {
        ...REPORT,
        refusals: [
          { ...REPORT.refusals[0]!, deviceIds: [idOf(ACME_SWITCH)] },
          { ...REPORT.refusals[1]!, deviceIds: [idOf(GLOBEX_SWITCH)] },
          // The scanner's: no device sent it, and the probe's page still lists it.
          REPORT.refusals[2]!,
        ],
      },
    });
    expect(findDevices).toHaveBeenCalledWith({
      probeId: PROBE,
      addresses: ["203.0.113.10", "198.51.100.20", "192.0.2.99"],
    });
    expect(recordShares).not.toHaveBeenCalled();
  });

  test("nothing refused: nothing read, and the report kept as it came", async () => {
    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: { ...REPORT, refusals: [] },
      users: [],
    });

    expect(findDevices).not.toHaveBeenCalled();
    expect(findDnsNamed).not.toHaveBeenCalled();
    expect(resolveHostnames).not.toHaveBeenCalled();
    expect(keptOnTheProbe()).toEqual({ ...REPORT, refusals: [] });
  });

  test("a device added by its DNS name is named on the refusal from the address its name resolves to (#11406)", async () => {
    const dnsNamed: NetworkDevice = device(ACME, "core-sw-01.acme.example");

    findDevices.mockResolvedValue([] as never);
    findDnsNamed.mockResolvedValue([dnsNamed] as never);
    resolveHostnames.mockResolvedValue(
      new Map([["core-sw-01.acme.example", ["203.0.113.10"]]]) as never,
    );

    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [],
    });

    expect(findDnsNamed).toHaveBeenCalledWith({
      probeId: PROBE,
      limit: MAX_DNS_NAMED_DEVICES_PER_REPORT,
    });
    expect(resolveHostnames).toHaveBeenCalledWith({
      hostnames: ["core-sw-01.acme.example"],
    });
    expect(
      keptOnTheProbe().refusals.map((kept: SnmpTrapRefusal) => {
        return kept.deviceIds;
      }),
    ).toEqual([[idOf(dnsNamed)], undefined, undefined]);
  });

  test("what a probe said of a refusal's devices is never kept: only what OneUptime found", async () => {
    findDevices.mockResolvedValue([] as never);

    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: {
        ...REPORT,
        refusals: [
          {
            ...REPORT.refusals[0]!,
            deviceIds: ["11730000-0000-4000-8000-00000000dead"],
          },
        ],
      },
      users: [],
    });

    expect(keptOnTheProbe().refusals[0]).not.toHaveProperty("deviceIds");
  });
});

describe("a global probe", () => {
  beforeEach(() => {
    recordOnProbe.mockResolvedValue({
      isKept: true,
      isGlobalProbe: true,
    } as never);
  });

  test("keeps each project's refusals for that project alone", async () => {
    expect(
      await SnmpTrapReceiverReports.record({
        probeId: PROBE,
        report: REPORT,
        users: [user("monitor", [ACME])],
      }),
    ).toBe(true);

    expect(findDevices).toHaveBeenCalledWith({
      probeId: PROBE,
      addresses: ["203.0.113.10", "198.51.100.20", "192.0.2.99"],
    });

    const shares: Map<string, Array<SnmpTrapRefusal>> = (
      recordShares.mock.calls[0]![0] as {
        sharesByProject: Map<string, Array<SnmpTrapRefusal>>;
      }
    ).sharesByProject;

    expect(Array.from(shares.keys()).sort()).toEqual([ACME, GLOBEX].sort());

    // Acme handed "monitor": its wrong key is a wrong key.
    expect(shares.get(ACME)).toEqual([
      {
        ...refusal({ sourceAddress: "203.0.113.10", userName: "monitor" }),
        deviceIds: [idOf(ACME_SWITCH)],
      },
    ]);

    // Globex handed no "globex-traps": from its side, an unknown user.
    expect(shares.get(GLOBEX)).toEqual([
      {
        ...refusal({
          sourceAddress: "198.51.100.20",
          userName: "globex-traps",
          reason: SnmpTrapRefusalReason.UnknownUser,
        }),
        deviceIds: [idOf(GLOBEX_SWITCH)],
      },
    ]);

    // The scanner's address is nobody's.
    expect(JSON.stringify(Array.from(shares.values()))).not.toContain(
      "192.0.2.99",
    );
  });

  test("a refusal from the address a DNS-named device's name resolves to goes to its project, naming it (#11406)", async () => {
    const dnsNamed: NetworkDevice = device(GLOBEX, "edge.globex.example");

    findDevices.mockResolvedValue([ACME_SWITCH] as never);
    findDnsNamed.mockResolvedValue([dnsNamed] as never);
    resolveHostnames.mockResolvedValue(
      new Map([["edge.globex.example", ["198.51.100.20"]]]) as never,
    );

    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [],
    });

    expect(sharesRecorded().get(GLOBEX)).toEqual([
      expect.objectContaining({
        sourceAddress: "198.51.100.20",
        deviceIds: [idOf(dnsNamed)],
      }),
    ]);
    expect(JSON.stringify(sharesRecorded().get(ACME))).not.toContain(
      idOf(dnsNamed),
    );
  });

  test("a name that resolves to an address another project's device has typed in gives the refusal to neither (#11406)", async () => {
    // Globex's name resolves to the address Acme's switch was added by.
    findDnsNamed.mockResolvedValue([
      device(GLOBEX, "spoof.globex.example"),
    ] as never);
    resolveHostnames.mockResolvedValue(
      new Map([["spoof.globex.example", ["203.0.113.10"]]]) as never,
    );

    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [user("monitor", [ACME])],
    });

    expect(sharesRecorded().has(ACME)).toBe(false);
    expect(JSON.stringify(Array.from(sharesRecorded().values()))).not.toContain(
      "203.0.113.10",
    );
    // Globex's own, by its typed address, is still Globex's.
    expect(sharesRecorded().get(GLOBEX)).toHaveLength(1);
  });

  test("a name that resolves to none of the refusals' sources concerns no refusal", async () => {
    findDevices.mockResolvedValue([] as never);
    findDnsNamed.mockResolvedValue([
      device(ACME, "elsewhere.acme.example"),
    ] as never);
    resolveHostnames.mockResolvedValue(
      new Map([["elsewhere.acme.example", ["10.99.0.1"]]]) as never,
    );

    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [],
    });

    expect(sharesRecorded()).toEqual(new Map());
  });

  test("a DNS-named device that also has an Other Address there is one device, named once", async () => {
    const both: NetworkDevice = device(
      ACME,
      "core.acme.example",
      "203.0.113.10",
    );

    findDevices.mockResolvedValue([both] as never);
    findDnsNamed.mockResolvedValue([both] as never);
    resolveHostnames.mockResolvedValue(
      new Map([["core.acme.example", ["203.0.113.10"]]]) as never,
    );

    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [],
    });

    expect(sharesRecorded().get(ACME)?.[0]?.deviceIds).toEqual([idOf(both)]);
  });

  test("a report with nothing refused clears every project's share", async () => {
    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: { ...REPORT, refusals: [] },
      users: [],
    });

    expect(findDevices).not.toHaveBeenCalled();
    expect(recordShares).toHaveBeenCalledWith({
      probeId: PROBE,
      sharesByProject: new Map(),
    });
  });

  test("a receiver that is off clears them too", async () => {
    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: { isEnabled: false, refusals: [] },
      users: [],
    });

    expect(recordShares).toHaveBeenCalledWith({
      probeId: PROBE,
      sharesByProject: new Map(),
    });
  });
});

test("a probe that keeps no report splits nothing", async () => {
  recordOnProbe.mockResolvedValue({
    isKept: false,
    isGlobalProbe: false,
  } as never);

  expect(
    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [],
    }),
  ).toBe(false);
  expect(recordShares).not.toHaveBeenCalled();
});
