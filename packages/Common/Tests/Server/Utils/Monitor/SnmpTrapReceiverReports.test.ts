import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import GlobalProbeSnmpTrapReportService from "../../../../Server/Services/GlobalProbeSnmpTrapReportService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import SnmpTrapReceiverReports from "../../../../Server/Utils/Monitor/SnmpTrapReceiverReports";
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
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHERE A PROBE'S RECEIVER REPORT IS KEPT, AND FOR WHOM (#11173).
 *
 * A project's own probe keeps its report whole. A global probe keeps what
 * belongs to no project on itself, and each project's refused traps for that
 * project alone, split as the report arrives by the probe's own devices'
 * addresses and the user names each project handed it.
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

function device(projectId: string, hostname: string): NetworkDevice {
  const model: NetworkDevice = new NetworkDevice(ObjectID.generate());
  model.projectId = new ObjectID(projectId);
  model.hostname = hostname;
  return model;
}

let recordOnProbe: MockFunction;
let recordShares: MockFunction;
let findDevices: MockFunction;

beforeEach(() => {
  recordOnProbe = jest
    .spyOn(ProbeService, "recordSnmpTrapReceiverReport")
    .mockResolvedValue({ isKept: true, isGlobalProbe: false } as never) as unknown as MockFunction;
  recordShares = jest
    .spyOn(GlobalProbeSnmpTrapReportService, "recordShares")
    .mockResolvedValue(undefined as never) as unknown as MockFunction;
  findDevices = jest
    .spyOn(NetworkDeviceService, "findDevicesAtAddressesOnProbe")
    .mockResolvedValue([
      device(ACME, "203.0.113.10"),
      device(GLOBEX, "198.51.100.20"),
    ] as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project's own probe", () => {
  test("keeps the report whole on the probe, and splits nothing", async () => {
    expect(
      await SnmpTrapReceiverReports.record({
        probeId: PROBE,
        report: REPORT,
        users: [],
      }),
    ).toBe(true);

    expect(recordOnProbe).toHaveBeenCalledWith({
      probeId: PROBE,
      report: REPORT,
    });
    expect(findDevices).not.toHaveBeenCalled();
    expect(recordShares).not.toHaveBeenCalled();
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
      refusal({ sourceAddress: "203.0.113.10", userName: "monitor" }),
    ]);

    // Globex handed no "globex-traps": from its side, an unknown user.
    expect(shares.get(GLOBEX)).toEqual([
      refusal({
        sourceAddress: "198.51.100.20",
        userName: "globex-traps",
        reason: SnmpTrapRefusalReason.UnknownUser,
      }),
    ]);

    // The scanner's address is nobody's.
    expect(JSON.stringify(Array.from(shares.values()))).not.toContain(
      "192.0.2.99",
    );
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
  recordOnProbe.mockResolvedValue({ isKept: false, isGlobalProbe: false } as never);

  expect(
    await SnmpTrapReceiverReports.record({
      probeId: PROBE,
      report: REPORT,
      users: [],
    }),
  ).toBe(false);
  expect(recordShares).not.toHaveBeenCalled();
});
