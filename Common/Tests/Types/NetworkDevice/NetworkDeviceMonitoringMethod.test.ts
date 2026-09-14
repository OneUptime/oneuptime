import NetworkDeviceMonitoringMethod, {
  LEGACY_SNMP_MONITORING_METHOD,
  NetworkDeviceMonitoringMethodUtil,
} from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * The column is free text and pre-existing rows hold NULL or the legacy
 * "SNMP", so the whole point of the util is that anything it does not
 * positively recognise as monitor-backed reads as Probe — the assigned probe
 * polls the device. Getting that default wrong silently stops a device being
 * polled, which is why every branch is pinned.
 */
describe("NetworkDeviceMonitoringMethod enum", () => {
  test("Probe is the string Probe", () => {
    expect(NetworkDeviceMonitoringMethod.Probe).toBe("Probe");
  });

  test("Monitor is the string Monitor", () => {
    expect(NetworkDeviceMonitoringMethod.Monitor).toBe("Monitor");
  });

  test("has exactly the two known methods", () => {
    expect(Object.values(NetworkDeviceMonitoringMethod).sort()).toEqual([
      "Monitor",
      "Probe",
    ]);
  });

  /*
   * The value the product no longer writes, kept by name for the parser,
   * the normalising migration and these tests. It must never come back as
   * a member: a form would offer it again.
   */
  test("SNMP is the legacy value, not a member", () => {
    expect(LEGACY_SNMP_MONITORING_METHOD).toBe("SNMP");
    expect(Object.values(NetworkDeviceMonitoringMethod)).not.toContain(
      LEGACY_SNMP_MONITORING_METHOD,
    );
  });
});

describe("NetworkDeviceMonitoringMethodUtil.parse", () => {
  test.each([null, undefined, "", "   "])(
    "reads %p as Probe (every row written before the column existed)",
    (value: string | null | undefined) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Probe,
      );
    },
  );

  test.each(["Probe", "probe", "PROBE", "  probe  "])(
    "reads the Probe spelling %p as Probe",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Probe,
      );
    },
  );

  /*
   * Rows from the SNMP-first era were probe-polled devices all along; the
   * probe just did not ping them yet.
   */
  test.each([LEGACY_SNMP_MONITORING_METHOD, "snmp", "Snmp", " snmp "])(
    "reads the legacy SNMP spelling %p as Probe",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Probe,
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

  test.each(["ping", "unknown", "monitor-backed", "monitors", "SNMPv3", "0"])(
    "falls back to Probe for the unrecognised value %p",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.parse(value)).toBe(
        NetworkDeviceMonitoringMethod.Probe,
      );
    },
  );

  test("does not treat a string merely containing 'monitor' as monitor-backed", () => {
    // Only an exact (trimmed, lowercased) 'monitor' qualifies.
    expect(NetworkDeviceMonitoringMethodUtil.parse("monitor device")).toBe(
      NetworkDeviceMonitoringMethod.Probe,
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

  test.each([
    null,
    undefined,
    "",
    "Probe",
    "probe",
    LEGACY_SNMP_MONITORING_METHOD,
    "snmp",
    "ping",
    "monitorish",
  ])("is false for %p", (value: string | null | undefined) => {
    expect(NetworkDeviceMonitoringMethodUtil.isMonitorBacked(value)).toBe(
      false,
    );
  });

  test("agrees with parse for every input", () => {
    const inputs: Array<string | null | undefined> = [
      null,
      undefined,
      "",
      "monitor",
      "Monitor",
      "Probe",
      LEGACY_SNMP_MONITORING_METHOD,
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

/*
 * The other half of the same question, for callers that ask "does the
 * assigned probe poll this device?" rather than "is a monitor its status?".
 * There is no third state, so the two must be exact complements.
 */
describe("NetworkDeviceMonitoringMethodUtil.isProbePolled", () => {
  test.each([
    null,
    undefined,
    "",
    "Probe",
    "probe",
    LEGACY_SNMP_MONITORING_METHOD,
    "snmp",
    "ping",
    "monitorish",
  ])("is true for %p", (value: string | null | undefined) => {
    expect(NetworkDeviceMonitoringMethodUtil.isProbePolled(value)).toBe(true);
  });

  test.each(["monitor", "Monitor", "  MONITOR  "])(
    "is false for %p",
    (value: string) => {
      expect(NetworkDeviceMonitoringMethodUtil.isProbePolled(value)).toBe(
        false,
      );
    },
  );

  test("is the exact complement of isMonitorBacked for every input", () => {
    const inputs: Array<string | null | undefined> = [
      null,
      undefined,
      "",
      "   ",
      "monitor",
      "Monitor",
      "  MONITOR  ",
      "Probe",
      "probe",
      LEGACY_SNMP_MONITORING_METHOD,
      "snmp",
      "ping",
      "monitor device",
    ];

    for (const input of inputs) {
      expect(NetworkDeviceMonitoringMethodUtil.isProbePolled(input)).toBe(
        !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(input),
      );
    }
  });
});
