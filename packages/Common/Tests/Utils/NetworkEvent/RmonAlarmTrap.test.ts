import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import RmonAlarmTrapUtil, {
  RMON_FALLING_ALARM_TRAP_OIDS,
  RMON_RISING_ALARM_TRAP_OIDS,
  RmonAlarm,
  RmonAlarmDirection,
} from "../../../Utils/NetworkEvent/RmonAlarmTrap";
import { describe, expect, test } from "@jest/globals";

/*
 * An MDS port-monitor policy pages through RMON: when a port's counter
 * (credit loss, timeout discards, invalid CRCs ...) crosses the policy's
 * threshold, the switch sends an alarm trap whose varbinds name the
 * counter's OID - its column and the interface's ifIndex - the sampled
 * value and the threshold it crossed. Three families carry them, each with
 * its own varbind columns:
 *
 *   RMON-MIB risingAlarm / fallingAlarm (1.3.6.1.2.1.16.0.1 / .2):
 *     alarmEntry (1.3.6.1.2.1.16.3.1.1) 3 variable, 5 value,
 *     7 rising threshold, 8 falling threshold - 32-bit counters.
 *   HC-ALARM-MIB hcRisingAlarm / hcFallingAlarm (1.3.6.1.2.1.16.29.2.0.1 / .2):
 *     hcAlarmEntry (1.3.6.1.2.1.16.29.1.1.1.1) 3 variable, 5 absolute
 *     value, 8 / 9 rising threshold low and high halves, 11 / 12 falling -
 *     what an MDS sends for a 64-bit counter.
 *   CISCO-HC-ALARM-MIB cHcRisingAlarm / cHcFallingAlarm
 *     (1.3.6.1.4.1.9.10.93.2.0.1 / .2): the same columns under Cisco's arc.
 */

const FC_IF_ERROR: string = "1.3.6.1.4.1.9.9.289.1.2.1.1";
const FC1_5: number = 0x1000000 + 4 * 0x1000;

function trap(
  trapOid: string,
  varbinds: Array<[string, string]>,
): Pick<SnmpTrap, "trapOid" | "varbinds"> {
  return {
    trapOid: trapOid,
    varbinds: varbinds.map(([oid, value]: [string, string]) => {
      return { oid: oid, value: value };
    }),
  };
}

describe("isRmonAlarmTrap", () => {
  test("every family's rising and falling alarm", () => {
    expect(RMON_RISING_ALARM_TRAP_OIDS).toEqual([
      "1.3.6.1.2.1.16.0.1",
      "1.3.6.1.2.1.16.29.2.0.1",
      "1.3.6.1.4.1.9.10.93.2.0.1",
    ]);
    expect(RMON_FALLING_ALARM_TRAP_OIDS).toEqual([
      "1.3.6.1.2.1.16.0.2",
      "1.3.6.1.2.1.16.29.2.0.2",
      "1.3.6.1.4.1.9.10.93.2.0.2",
    ]);

    for (const oid of [
      ...RMON_RISING_ALARM_TRAP_OIDS,
      ...RMON_FALLING_ALARM_TRAP_OIDS,
    ]) {
      expect(RmonAlarmTrapUtil.isRmonAlarmTrap(oid)).toBe(true);
      expect(RmonAlarmTrapUtil.isRmonAlarmTrap(`.${oid}`)).toBe(true);
    }
  });

  test.each([
    undefined,
    "",
    // linkDown, coldStart, an RMON event that is not an alarm.
    "1.3.6.1.6.3.1.1.5.3",
    "1.3.6.1.6.3.1.1.5.1",
    "1.3.6.1.2.1.16.0.3",
    "1.3.6.1.2.1.16.0.1.1",
  ])("%j is no alarm", (oid: string | undefined) => {
    expect(RmonAlarmTrapUtil.isRmonAlarmTrap(oid)).toBe(false);
  });
});

describe("decode", () => {
  test("RMON-MIB risingAlarm on an MDS interface's invalid CRCs", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.2.1.16.0.1", [
        ["1.3.6.1.2.1.16.3.1.1.1.2", "2"],
        ["1.3.6.1.2.1.16.3.1.1.3.2", `${FC_IF_ERROR}.6.${FC1_5}`],
        ["1.3.6.1.2.1.16.3.1.1.4.2", "2"],
        ["1.3.6.1.2.1.16.3.1.1.5.2", "120"],
        ["1.3.6.1.2.1.16.3.1.1.7.2", "5"],
      ]),
    );

    expect(alarm).toEqual({
      direction: RmonAlarmDirection.Rising,
      variableOid: `${FC_IF_ERROR}.6.${FC1_5}`,
      counterName: "Invalid CRCs",
      interfaceIndex: FC1_5,
      value: "120",
      threshold: "5",
    });
  });

  test("RMON-MIB fallingAlarm reads the falling threshold, not the rising one", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.2.1.16.0.2", [
        ["1.3.6.1.2.1.16.3.1.1.3.7", `${FC_IF_ERROR}.6.${FC1_5}`],
        ["1.3.6.1.2.1.16.3.1.1.5.7", "0"],
        ["1.3.6.1.2.1.16.3.1.1.7.7", "5"],
        ["1.3.6.1.2.1.16.3.1.1.8.7", "1"],
      ]),
    );

    expect(alarm?.direction).toBe(RmonAlarmDirection.Falling);
    expect(alarm?.threshold).toBe("1");
    expect(alarm?.value).toBe("0");
  });

  test("HC-ALARM-MIB hcRisingAlarm on credit loss, a 64-bit counter", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.2.1.16.29.2.0.1", [
        ["1.3.6.1.2.1.16.29.1.1.1.1.3.4", `${FC_IF_ERROR}.37.${FC1_5}`],
        ["1.3.6.1.2.1.16.29.1.1.1.1.4.4", "2"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.5.4", "3"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.6.4", "2"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.8.4", "1"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.9.4", "0"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.10.4", "2"],
      ]),
    );

    expect(alarm).toEqual({
      direction: RmonAlarmDirection.Rising,
      variableOid: `${FC_IF_ERROR}.37.${FC1_5}`,
      counterName: "Credit loss",
      interfaceIndex: FC1_5,
      value: "3",
      threshold: "1",
    });
  });

  test("a 64-bit threshold sent in two halves is put back together", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.2.1.16.29.2.0.1", [
        ["1.3.6.1.2.1.16.29.1.1.1.1.3.1", `${FC_IF_ERROR}.35.${FC1_5}`],
        ["1.3.6.1.2.1.16.29.1.1.1.1.8.1", "5"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.9.1", "1"],
      ]),
    );

    // 1 * 2^32 + 5.
    expect(alarm?.threshold).toBe("4294967301");
  });

  test("hcFallingAlarm reads the falling halves", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.2.1.16.29.2.0.2", [
        ["1.3.6.1.2.1.16.29.1.1.1.1.3.1", `${FC_IF_ERROR}.35.${FC1_5}`],
        ["1.3.6.1.2.1.16.29.1.1.1.1.8.1", "5"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.11.1", "2"],
        ["1.3.6.1.2.1.16.29.1.1.1.1.12.1", "0"],
      ]),
    );

    expect(alarm?.direction).toBe(RmonAlarmDirection.Falling);
    expect(alarm?.threshold).toBe("2");
  });

  test("CISCO-HC-ALARM-MIB cHcRisingAlarm, on Cisco's arc", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.4.1.9.10.93.2.0.1", [
        ["1.3.6.1.4.1.9.10.93.1.1.1.1.3.9", `${FC_IF_ERROR}.35.${FC1_5}`],
        ["1.3.6.1.4.1.9.10.93.1.1.1.1.5.9", "40"],
        ["1.3.6.1.4.1.9.10.93.1.1.1.1.8.9", "10"],
      ]),
    );

    expect(alarm).toEqual({
      direction: RmonAlarmDirection.Rising,
      variableOid: `${FC_IF_ERROR}.35.${FC1_5}`,
      counterName: "Timeout discards",
      interfaceIndex: FC1_5,
      value: "40",
      threshold: "10",
    });
  });

  test("varbinds with a leading dot, and an alarm variable with one, read the same", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap(".1.3.6.1.2.1.16.0.1", [
        [".1.3.6.1.2.1.16.3.1.1.3.2", `.${FC_IF_ERROR}.6.${FC1_5}`],
        [".1.3.6.1.2.1.16.3.1.1.5.2", "9"],
      ]),
    );

    expect(alarm?.variableOid).toBe(`${FC_IF_ERROR}.6.${FC1_5}`);
    expect(alarm?.interfaceIndex).toBe(FC1_5);
    expect(alarm?.value).toBe("9");
  });

  test("an alarm on a counter OneUptime does not know still decodes, unnamed", () => {
    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(
      trap("1.3.6.1.2.1.16.0.1", [
        ["1.3.6.1.2.1.16.3.1.1.3.2", "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1"],
      ]),
    );

    expect(alarm).toEqual({
      direction: RmonAlarmDirection.Rising,
      variableOid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1",
    });
  });

  test("an alarm with no varbinds is still an alarm, with nothing more to say", () => {
    expect(RmonAlarmTrapUtil.decode(trap("1.3.6.1.2.1.16.0.2", []))).toEqual({
      direction: RmonAlarmDirection.Falling,
    });
  });

  test("varbinds that are not an array are none", () => {
    expect(
      RmonAlarmTrapUtil.decode({
        trapOid: "1.3.6.1.2.1.16.0.1",
        varbinds: undefined as unknown as SnmpTrap["varbinds"],
      }),
    ).toEqual({ direction: RmonAlarmDirection.Rising });
  });

  test("anything but an alarm decodes to null", () => {
    expect(RmonAlarmTrapUtil.decode(trap("1.3.6.1.6.3.1.1.5.3", []))).toBe(
      null,
    );
    expect(RmonAlarmTrapUtil.decode(null)).toBe(null);
    expect(RmonAlarmTrapUtil.decode(undefined)).toBe(null);
  });
});

describe("readCounter", () => {
  test.each([
    [`${FC_IF_ERROR}.1.16777216`, "Link failures"],
    [`${FC_IF_ERROR}.2.16777216`, "Loss of sync"],
    [`${FC_IF_ERROR}.3.16777216`, "Loss of signal"],
    [`${FC_IF_ERROR}.5.16777216`, "Invalid transmission words"],
    [`${FC_IF_ERROR}.6.16777216`, "Invalid CRCs"],
    [`${FC_IF_ERROR}.26.16777216`, "Frames discarded"],
    [`${FC_IF_ERROR}.35.16777216`, "Timeout discards"],
    [`${FC_IF_ERROR}.37.16777216`, "Credit loss"],
    ["1.3.6.1.4.1.9.9.289.1.2.3.1.5.16777216", "Class 3 discards"],
    ["1.3.6.1.2.1.2.2.1.14.3", "Inbound errors"],
    ["1.3.6.1.2.1.31.1.1.1.6.3", "Inbound octets"],
  ])("%s is %s", (variableOid: string, name: string) => {
    expect(RmonAlarmTrapUtil.readCounter(variableOid)?.name).toBe(name);
  });

  test("the interface is the last arc, when it is an ifIndex", () => {
    expect(RmonAlarmTrapUtil.readCounter(`${FC_IF_ERROR}.37.16793600`)).toEqual(
      { name: "Credit loss", interfaceIndex: 16793600 },
    );
    // Not an InterfaceIndex: zero, too large, not a number.
    expect(RmonAlarmTrapUtil.readCounter(`${FC_IF_ERROR}.37.0`)).toEqual({
      name: "Credit loss",
    });
    expect(
      RmonAlarmTrapUtil.readCounter(`${FC_IF_ERROR}.37.2147483648`),
    ).toEqual({ name: "Credit loss" });
  });

  test.each(["", "1", "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1", FC_IF_ERROR])(
    "%j is no counter OneUptime knows",
    (variableOid: string) => {
      expect(RmonAlarmTrapUtil.readCounter(variableOid)).toBeUndefined();
    },
  );
});

describe("mdsInterfaceName", () => {
  test.each([
    [0x1000000, "fc1/1"],
    [0x1001000, "fc1/2"],
    [0x1000000 + 47 * 0x1000, "fc1/48"],
    [0x1000000 + 95 * 0x1000, "fc1/96"],
    // Slot 2 starts 128 ports on.
    [0x1000000 + 128 * 0x1000, "fc2/1"],
    [0x1000000 + 130 * 0x1000, "fc2/3"],
    [0x4000000, "port-channel1"],
    [0x4000000 + 9, "port-channel10"],
  ])("ifIndex %s is %s", (interfaceIndex: number, name: string) => {
    expect(RmonAlarmTrapUtil.mdsInterfaceName(interfaceIndex)).toBe(name);
  });

  test.each([0, 1, 0x1000001, 0x0fff000, 0x2000000, 0x4000000 + 256, 0x5000000])(
    "ifIndex %s is no interface by MDS numbering",
    (interfaceIndex: number) => {
      expect(RmonAlarmTrapUtil.mdsInterfaceName(interfaceIndex)).toBeUndefined();
    },
  );
});

describe("describeInterface and describe", () => {
  const creditLoss: RmonAlarm = {
    direction: RmonAlarmDirection.Rising,
    variableOid: `${FC_IF_ERROR}.37.${FC1_5}`,
    counterName: "Credit loss",
    interfaceIndex: FC1_5,
    value: "3",
    threshold: "1",
  };

  test("the name the device's walk recorded wins", () => {
    expect(RmonAlarmTrapUtil.describeInterface(creditLoss, " fc1/5 ")).toBe(
      "fc1/5",
    );
    expect(RmonAlarmTrapUtil.describe(creditLoss, "esx13-hba0")).toBe(
      "Credit loss on esx13-hba0 rose past its threshold (value 3, threshold 1)",
    );
  });

  test("else an MDS counter's interface by MDS numbering", () => {
    expect(RmonAlarmTrapUtil.describeInterface(creditLoss)).toBe("fc1/5");
    expect(RmonAlarmTrapUtil.describe(creditLoss)).toBe(
      "Credit loss on fc1/5 rose past its threshold (value 3, threshold 1)",
    );
  });

  test("else, and for anything but a Cisco FC counter, the ifIndex itself", () => {
    const inErrors: RmonAlarm = {
      direction: RmonAlarmDirection.Falling,
      variableOid: `1.3.6.1.2.1.2.2.1.14.${FC1_5}`,
      counterName: "Inbound errors",
      interfaceIndex: FC1_5,
    };

    expect(RmonAlarmTrapUtil.describeInterface(inErrors)).toBe(
      `ifIndex ${FC1_5}`,
    );
    expect(RmonAlarmTrapUtil.describe(inErrors)).toBe(
      `Inbound errors on ifIndex ${FC1_5} fell back below its threshold`,
    );
  });

  test("an alarm about no interface says so plainly", () => {
    expect(
      RmonAlarmTrapUtil.describe({
        direction: RmonAlarmDirection.Rising,
        variableOid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1",
        value: "97",
      }),
    ).toBe("1.3.6.1.4.1.9.9.109.1.1.1.1.7.1 rose past its threshold (value 97)");
    expect(
      RmonAlarmTrapUtil.describe({ direction: RmonAlarmDirection.Falling }),
    ).toBe("An RMON alarm fell back below its threshold");
  });
});
