import { afterEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceHydrationUtil, {
  HydratableMonitor,
} from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MonitorStepSnmpMonitor from "../../../../Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "../../../../Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "../../../../Types/Monitor/SnmpMonitor/SnmpV3Auth";
import SnmpSecurityLevel from "../../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "../../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Network Device monitors carry only a reference to a NetworkDevice; the probe
 * is stateless and understands nothing but concrete SNMP config. This util is
 * the single place that turns the stored device into the `snmpMonitor` block a
 * probe can execute, so it is where an SNMP v3 device either gets its
 * credentials or silently loses them.
 *
 * Customer report: "Test Metrics" (Test Monitor) errors for a monitor on a v3
 * device while v2 works. The probe throws when a v3 step reaches it without a
 * v3 username (SnmpMonitor.createSnmpSession fails loudly rather than
 * downgrading to v2c/"public"), so these tests pin exactly when this util does
 * and does not produce snmpV3Auth — and that it hydrates the MonitorTest shape
 * used by Test Monitor, not just saved Monitors.
 */

const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";

/*
 * Columns are assigned loosely so a test can pin a column to undefined, which
 * Partial<NetworkDevice> forbids under exactOptionalPropertyTypes.
 */
type DeviceFields = Record<string, unknown>;

function buildDevice(fields: DeviceFields): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device._id = DEVICE_ID;
  device.hostname = "10.0.0.1";
  Object.assign(device, fields);

  return device;
}

function buildV3Device(fields?: DeviceFields): NetworkDevice {
  return buildDevice({
    snmpVersion: "V3",
    snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: SnmpPrivProtocol.AES,
    snmpV3PrivKey: "priv-passphrase",
    ...fields,
  });
}

/*
 * Structural stand-in for both Monitor and MonitorTest — hydrateNetworkDeviceMonitors
 * accepts either, which is what the Test Monitor path depends on.
 */
function buildMonitor(options?: {
  monitorType?: MonitorType | undefined;
  networkDeviceId?: string | undefined;
  monitorInterfaces?: boolean | undefined;
}): HydratableMonitor {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    networkDeviceMonitor: {
      networkDeviceId:
        options && "networkDeviceId" in options
          ? options.networkDeviceId
          : DEVICE_ID,
      monitorInterfaces: options?.monitorInterfaces ?? true,
      oids: [{ oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" }],
    },
  } as MonitorStep["data"];

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  return {
    id: ObjectID.generate(),
    monitorType: options?.monitorType ?? MonitorType.NetworkDevice,
    monitorSteps: monitorSteps,
  };
}

function mockDevices(devices: Array<NetworkDevice>): void {
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue(devices);
}

function hydratedStep(
  monitor: HydratableMonitor,
): MonitorStepSnmpMonitor | undefined {
  return monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
    ?.snmpMonitor;
}

describe("NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("SNMP v3 credential assembly", () => {
    test("a v3 device hands the probe a complete authPriv SnmpV3Auth", async () => {
      mockDevices([buildV3Device()]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      const snmp: MonitorStepSnmpMonitor | undefined = hydratedStep(monitor);

      expect(snmp?.snmpVersion).toBe(SnmpVersion.V3);
      expect(snmp?.snmpV3Auth).toEqual({
        securityLevel: SnmpSecurityLevel.AuthPriv,
        username: "monitoring",
        authProtocol: SnmpAuthProtocol.SHA,
        authKey: "auth-passphrase",
        privProtocol: SnmpPrivProtocol.AES,
        privKey: "priv-passphrase",
      } as SnmpV3Auth);
    });

    /*
     * The probe refuses to open a v3 session without a username. If this util
     * ever hands back a v3 step with no auth, Test Monitor surfaces that
     * refusal as the error the customer reported — so a fully configured
     * device must never produce one.
     */
    test("a fully configured v3 device never yields a v3 step without credentials", async () => {
      mockDevices([buildV3Device()]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      const snmp: MonitorStepSnmpMonitor | undefined = hydratedStep(monitor);

      expect(snmp?.snmpVersion).toBe(SnmpVersion.V3);
      expect(snmp?.snmpV3Auth?.username).toBeTruthy();
    });

    test("an authNoPriv device carries auth but no privacy material", async () => {
      mockDevices([
        buildV3Device({
          snmpV3SecurityLevel: SnmpSecurityLevel.AuthNoPriv,
          snmpV3PrivProtocol: undefined,
          snmpV3PrivKey: undefined,
        }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      const auth: SnmpV3Auth | undefined = hydratedStep(monitor)?.snmpV3Auth;

      expect(auth?.securityLevel).toBe(SnmpSecurityLevel.AuthNoPriv);
      expect(auth?.authKey).toBe("auth-passphrase");
      expect(auth?.privProtocol).toBeUndefined();
      expect(auth?.privKey).toBeUndefined();
    });

    test("a noAuthNoPriv device carries only the username", async () => {
      mockDevices([
        buildV3Device({
          snmpV3SecurityLevel: SnmpSecurityLevel.NoAuthNoPriv,
          snmpV3AuthProtocol: undefined,
          snmpV3AuthKey: undefined,
          snmpV3PrivProtocol: undefined,
          snmpV3PrivKey: undefined,
        }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      const auth: SnmpV3Auth | undefined = hydratedStep(monitor)?.snmpV3Auth;

      expect(auth?.securityLevel).toBe(SnmpSecurityLevel.NoAuthNoPriv);
      expect(auth?.username).toBe("monitoring");
      expect(auth?.authKey).toBeUndefined();
    });

    test("a v3 device with no username yields no auth at all", async () => {
      mockDevices([
        buildDevice({ snmpVersion: "V3", snmpV3Username: undefined }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.snmpV3Auth).toBeUndefined();
    });

    test("a v3 device with an unset security level defaults to noAuthNoPriv", async () => {
      mockDevices([
        buildDevice({ snmpVersion: "V3", snmpV3Username: "monitoring" }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.snmpV3Auth?.securityLevel).toBe(
        SnmpSecurityLevel.NoAuthNoPriv,
      );
    });
  });

  describe("legacy snmpV3Auth JSON column", () => {
    test("a device predating the flattened columns still authenticates", async () => {
      mockDevices([
        buildDevice({
          snmpVersion: "V3",
          snmpV3Auth: {
            securityLevel: SnmpSecurityLevel.AuthPriv,
            username: "legacy-user",
            authProtocol: SnmpAuthProtocol.MD5,
            authKey: "legacy-auth",
            privProtocol: SnmpPrivProtocol.DES,
            privKey: "legacy-priv",
          },
        }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.snmpV3Auth?.username).toBe("legacy-user");
      expect(hydratedStep(monitor)?.snmpV3Auth?.authProtocol).toBe(
        SnmpAuthProtocol.MD5,
      );
    });

    test("the flattened columns win over a stale legacy blob", async () => {
      mockDevices([
        buildV3Device({
          snmpV3Auth: {
            securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
            username: "stale-legacy-user",
          },
        }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.snmpV3Auth?.username).toBe("monitoring");
    });

    test("a legacy blob with no username is ignored", async () => {
      mockDevices([
        buildDevice({
          snmpVersion: "V3",
          snmpV3Auth: { securityLevel: SnmpSecurityLevel.AuthPriv },
        }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.snmpV3Auth).toBeUndefined();
    });
  });

  describe("SNMP version parsing from the stored column", () => {
    /*
     * The column is free text and both spellings exist in the wild: the
     * dropdown writes enum keys, other writers and older defaults use the enum
     * values. The probe branches on SnmpVersion, so both must map through.
     */
    test.each([
      ["V3", SnmpVersion.V3],
      ["3", SnmpVersion.V3],
      ["v3", SnmpVersion.V3],
      ["V1", SnmpVersion.V1],
      ["1", SnmpVersion.V1],
      ["v1", SnmpVersion.V1],
      ["V2c", SnmpVersion.V2c],
      ["2c", SnmpVersion.V2c],
      ["v2c", SnmpVersion.V2c],
    ])(
      "a device storing snmpVersion=%s polls as %s",
      async (stored: string, expected: SnmpVersion) => {
        mockDevices([buildV3Device({ snmpVersion: stored })]);
        const monitor: HydratableMonitor = buildMonitor();

        await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([
          monitor,
        ]);

        expect(hydratedStep(monitor)?.snmpVersion).toBe(expected);
      },
    );

    test("an unset or unrecognised version falls back to v2c", async () => {
      for (const stored of [undefined, "", "nonsense"]) {
        mockDevices([buildDevice({ snmpVersion: stored })]);
        const monitor: HydratableMonitor = buildMonitor();

        await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([
          monitor,
        ]);

        expect(hydratedStep(monitor)?.snmpVersion).toBe(SnmpVersion.V2c);
      }
    });

    /*
     * A v3 device whose version is stored in enum-value form must still reach
     * the probe as v3 WITH its credentials — parsing the version and building
     * the auth are independent, and getting only one right is what downgrades
     * a device to a cleartext v2c poll.
     */
    test('a v3 device stored as "3" keeps both its version and its credentials', async () => {
      mockDevices([buildV3Device({ snmpVersion: "3" })]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.snmpVersion).toBe(SnmpVersion.V3);
      expect(hydratedStep(monitor)?.snmpV3Auth?.username).toBe("monitoring");
    });
  });

  describe("v1/v2c community polling", () => {
    test("a v2c device carries its community string and no v3 auth", async () => {
      mockDevices([
        buildDevice({ snmpVersion: "V2c", snmpCommunityString: "s3cret" }),
      ]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      const snmp: MonitorStepSnmpMonitor | undefined = hydratedStep(monitor);

      expect(snmp?.snmpVersion).toBe(SnmpVersion.V2c);
      expect(snmp?.communityString).toBe("s3cret");
      expect(snmp?.snmpV3Auth).toBeUndefined();
    });

    test("a v2c device with no community string leaves it unset for the probe to default", async () => {
      mockDevices([buildDevice({ snmpVersion: "V2c" })]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.communityString).toBeUndefined();
    });
  });

  describe("connection details and step options", () => {
    test("hostname, port, oids and interface flag come from the device and step", async () => {
      mockDevices([buildV3Device({ hostname: "192.168.5.9", snmpPort: 1610 })]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      const snmp: MonitorStepSnmpMonitor | undefined = hydratedStep(monitor);

      expect(snmp?.hostname).toBe("192.168.5.9");
      expect(snmp?.port).toBe(1610);
      expect(snmp?.oids).toEqual([
        { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" },
      ]);
      expect(snmp?.monitorInterfaces).toBe(true);
    });

    test("a device with no port falls back to 161", async () => {
      mockDevices([buildV3Device({ snmpPort: undefined })]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.port).toBe(161);
    });

    test("monitorInterfaces=false is respected rather than defaulted on", async () => {
      mockDevices([buildV3Device()]);
      const monitor: HydratableMonitor = buildMonitor({
        monitorInterfaces: false,
      });

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)?.monitorInterfaces).toBe(false);
    });
  });

  describe("guards", () => {
    test("a non-NetworkDevice monitor is left untouched", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceService, "findBy")
        .mockResolvedValue([buildV3Device()]);

      const monitor: HydratableMonitor = buildMonitor({
        monitorType: MonitorType.Website,
      });

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)).toBeUndefined();
      expect(findBy).not.toHaveBeenCalled();
    });

    test("a step referencing a deleted device is not hydrated", async () => {
      mockDevices([]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)).toBeUndefined();
    });

    test("a step with no device reference is skipped without a lookup", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceService, "findBy")
        .mockResolvedValue([]);

      const monitor: HydratableMonitor = buildMonitor({
        networkDeviceId: undefined,
      });

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)).toBeUndefined();
      expect(findBy).not.toHaveBeenCalled();
    });

    test("a device with no hostname is not hydrated", async () => {
      mockDevices([buildV3Device({ hostname: undefined })]);
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitor)).toBeUndefined();
    });

    test("an empty monitor list performs no lookup", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceService, "findBy")
        .mockResolvedValue([]);

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([]);

      expect(findBy).not.toHaveBeenCalled();
    });
  });

  describe("the Test Monitor path", () => {
    /*
     * Test Monitor posts a MonitorTest — a different model from Monitor, but
     * structurally hydratable. It must receive the same v3 credentials the
     * scheduled monitor does, or the test errors while live polling works.
     */
    test("a MonitorTest-shaped object gets the same v3 credentials as a Monitor", async () => {
      mockDevices([buildV3Device()]);

      const monitorTest: HydratableMonitor = buildMonitor();
      const monitor: HydratableMonitor = buildMonitor();

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([
        monitorTest,
      ]);
      mockDevices([buildV3Device()]);
      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors([monitor]);

      expect(hydratedStep(monitorTest)).toEqual(hydratedStep(monitor));
      expect(hydratedStep(monitorTest)?.snmpV3Auth?.username).toBe(
        "monitoring",
      );
    });

    test("many monitors sharing one device are all hydrated from a single lookup", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(NetworkDeviceService, "findBy")
        .mockResolvedValue([buildV3Device()]);

      const monitors: Array<HydratableMonitor> = [
        buildMonitor(),
        buildMonitor(),
        buildMonitor(),
      ];

      await NetworkDeviceHydrationUtil.hydrateNetworkDeviceMonitors(monitors);

      expect(findBy).toHaveBeenCalledTimes(1);

      for (const monitor of monitors) {
        expect(hydratedStep(monitor)?.snmpV3Auth?.username).toBe("monitoring");
      }
    });
  });
});
