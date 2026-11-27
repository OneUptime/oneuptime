/*
 * Which of the devices at a trap's source address it belongs to, by the
 * SNMPv3 context it names.
 *
 * The logical switches of a Brocade chassis with Virtual Fabrics share its
 * management address, and each is its own device here, polled in its own
 * context ("VF:20"): NetworkDevice.snmpV3ContextName. Fabric OS sends its
 * traps over SNMPv3, each in the context of the logical switch that raised
 * it, so a trap naming "VF:20" is that switch's alone - not every device
 * at the address.
 *
 *   - A trap that names no context (v1, v2c, or SNMPv3 in the default
 *     context) goes to every device at the address, as it always has.
 *   - One that names a context goes to the devices polled in it; failing
 *     those, to the devices polled in the default context - a default
 *     logical switch is usually registered with no context at all, and its
 *     traps say "VF:128" - and failing those too, to none: it is about a
 *     logical switch nobody registered, and is logged as unmatched rather
 *     than raised on a neighbour.
 *
 * Contexts are compared without regard to case or surrounding spaces.
 *
 * The context reaches the server once probes receive SNMPv3 traps (#11005,
 * SnmpTrap.contextName). Until then no trap names one, and every trap goes
 * where it went before.
 */
export interface SnmpTrapRoutableDevice {
  snmpV3ContextName?: string | undefined;
}

export default class SnmpTrapContextRouting {
  public static normalizeContext(context: string | undefined): string {
    return (context || "").trim().toLowerCase();
  }

  public static devicesForTrap<T extends SnmpTrapRoutableDevice>(data: {
    devices: Array<T>;
    contextName: string | undefined;
  }): Array<T> {
    const context: string = SnmpTrapContextRouting.normalizeContext(
      data.contextName,
    );

    if (!context) {
      return data.devices;
    }

    const inContext: Array<T> = data.devices.filter((device: T) => {
      return (
        SnmpTrapContextRouting.normalizeContext(device.snmpV3ContextName) ===
        context
      );
    });

    if (inContext.length > 0) {
      return inContext;
    }

    return data.devices.filter((device: T) => {
      return !SnmpTrapContextRouting.normalizeContext(device.snmpV3ContextName);
    });
  }
}
