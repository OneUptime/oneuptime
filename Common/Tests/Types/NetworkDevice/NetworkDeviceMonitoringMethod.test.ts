import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * The column is free text and pre-existing rows hold NULL, so the whole point
 * of the util is that anything it does not positively recognise as
 * monitor-backed reads as SNMP. Getting that default wrong silently stops a
 * device being polled, which is why it is worth pinning down every branch.
 */
describe("NetworkDeviceMonitoringMethod enum", () => {
  test("Snmp is the string SNMP", () => {
    expect(NetworkDeviceMonitoringMethod.Snmp).toBe("SNMP");
  });

  test("Monitor is the string Monitor", () => {
    expect(NetworkDeviceMonitoringMethod.Monitor).toBe("Monitor");
  });

  test("has exactly the two known methods", () => {
    expect(Object.values(NetworkDeviceMonitoringMethod).sort()).toEqual([
      "Monitor",
      "SNMP",
    ]);
  });
});

describe("NetworkDeviceMonitoringMethodUtil.parse", () => {
  test.each([null, undefined, "", "   "])(
    "reads %p as Snmp (the legacy default)",
    (value: string | null | undefined) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Snmp,
      );
    },
  );

  test.each(["monitor", "Monitor", "MONITOR", "  monitor  ", "\tMoNiToR\n"])(
    "reads %p as Monitor, case- and whitespace-insensitively",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Monitor,
      );
    },
  );

  test.each(["SNMP", "snmp", "Snmp", " snmp "])(
    "reads the SNMP spelling %p as Snmp",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Snmp,
      );
    },
  );

  test.each(["ping", "unknown", "monitor-backed", "monitors", "SNMPv3", "0"])(
    "falls back to Snmp for the unrecognised value %p",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Snmp,
      );
    },
  );

  test("does not treat a string merely containing 'monitor' as monitor-backed", () => {
    // Only an exact (trimmed, lowercased) 'monitor' qualifies.
    expect(NetworkDeviceMonitoringMethodUtil.parse("monitor device")).toBe(
      NetworkDeviceMonitoringMethod.Snmp,
    );
  });
});

describe("NetworkDeviceMonitoringMethodUtil.isMonitorBacked", () => {
  test.each(["monitor", "Monitor", "  MONITOR  "])(
    "is true for %p",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.isMonitorBacked(value)).toBe(
        true,
      );
    },
  );

  test.each([null, undefined, "", "SNMP", "snmp", "ping", "monitorish"])(
    "is false for %p",
    (value: string | null | undefined) => {
      expect(NetworkDeviceMonitoringMethodUtil.isMonitorBacked(value)).toBe(
        false,
      );
    },
  );

  test("agrees with parse for every input", () => {
    const inputs: Array<string | null | undefined> = [
      null,
      undefined,
      "",
      "monitor",
      "Monitor",
      "SNMP",
      "ping",
    ];

    for (const input of inputs) {
      expect(NetworkDeviceMonitoringMethodUtil.isMonitorBacked(input)).toBe(
        NetworkDeviceMonitoringMethodUtil.parse(input) ===
          NetworkDeviceMonitoringMethod.Monitor,
      );
    }
  });
});
