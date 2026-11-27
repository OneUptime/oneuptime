import SnmpTrapContextRouting, {
  SnmpTrapRoutableDevice,
} from "../../../../Server/Utils/Monitor/SnmpTrapContextRouting";
import { describe, expect, test } from "@jest/globals";

/*
 * The logical switches of a Brocade chassis with Virtual Fabrics share its
 * management address; each is its own device, polled in its own SNMPv3
 * context. Fabric OS sends each logical switch's traps over SNMPv3 in that
 * switch's context, so a trap naming "VF:20" belongs to the device polled
 * in VF:20, not to every device at the address. A trap naming no context
 * goes where it always went.
 */

interface Device extends SnmpTrapRoutableDevice {
  name: string;
}

const DEFAULT_SWITCH: Device = { name: "default (no context)" };
const LOGICAL_SWITCH_20: Device = {
  name: "FID 20",
  snmpV3ContextName: "VF:20",
};
const LOGICAL_SWITCH_30: Device = {
  name: "FID 30",
  snmpV3ContextName: "VF:30",
};
const CHASSIS: Array<Device> = [
  DEFAULT_SWITCH,
  LOGICAL_SWITCH_20,
  LOGICAL_SWITCH_30,
];

function route(
  devices: Array<Device>,
  contextName: string | undefined,
): Array<string> {
  return SnmpTrapContextRouting.devicesForTrap({
    devices: devices,
    contextName: contextName,
  }).map((device: Device) => {
    return device.name;
  });
}

describe("SnmpTrapContextRouting.devicesForTrap", () => {
  test("a trap in a logical switch's context goes to that switch alone", () => {
    expect(route(CHASSIS, "VF:20")).toEqual(["FID 20"]);
    expect(route(CHASSIS, "VF:30")).toEqual(["FID 30"]);
  });

  test("a trap naming no context goes to every device at the address, as before", () => {
    expect(route(CHASSIS, undefined)).toEqual([
      "default (no context)",
      "FID 20",
      "FID 30",
    ]);
    expect(route(CHASSIS, "")).toEqual(route(CHASSIS, undefined));
    expect(route(CHASSIS, "   ")).toEqual(route(CHASSIS, undefined));
  });

  test("the default logical switch, registered with no context, gets the traps of a context nobody is polled in", () => {
    // Its traps say VF:128; nobody typed VF:128 on it.
    expect(route(CHASSIS, "VF:128")).toEqual(["default (no context)"]);
  });

  test("a trap from a logical switch nobody registered is no neighbour's: it goes nowhere, to be logged as unmatched", () => {
    expect(route([LOGICAL_SWITCH_20, LOGICAL_SWITCH_30], "VF:128")).toEqual(
      [],
    );
  });

  test("a single device at the address keeps its traps when they name its context or none", () => {
    expect(route([DEFAULT_SWITCH], "VF:128")).toEqual(["default (no context)"]);
    expect(route([LOGICAL_SWITCH_20], "VF:20")).toEqual(["FID 20"]);
    expect(route([LOGICAL_SWITCH_20], undefined)).toEqual(["FID 20"]);
  });

  test("contexts compare without regard to case or surrounding spaces", () => {
    expect(
      route(
        [DEFAULT_SWITCH, { name: "typed", snmpV3ContextName: " vf:20 " }],
        "VF:20",
      ),
    ).toEqual(["typed"]);
    expect(route(CHASSIS, " vf:30")).toEqual(["FID 30"]);
  });

  test("two devices polled in the same context both get its traps", () => {
    const twin: Device = { name: "FID 20 again", snmpV3ContextName: "VF:20" };

    expect(route([...CHASSIS, twin], "VF:20")).toEqual([
      "FID 20",
      "FID 20 again",
    ]);
  });

  test("a device with a blank context is polled in the default one", () => {
    const blank: Device = { name: "blank", snmpV3ContextName: "  " };

    expect(route([blank, LOGICAL_SWITCH_20], "VF:128")).toEqual(["blank"]);
  });

  test("no devices, no devices", () => {
    expect(route([], "VF:20")).toEqual([]);
    expect(route([], undefined)).toEqual([]);
  });

  test("normalizeContext", () => {
    expect(SnmpTrapContextRouting.normalizeContext(" VF:20 ")).toBe("vf:20");
    expect(SnmpTrapContextRouting.normalizeContext(undefined)).toBe("");
  });
});
