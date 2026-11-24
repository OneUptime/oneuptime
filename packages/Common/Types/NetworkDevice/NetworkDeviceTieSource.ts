/*
 * WHO SET A MONITOR'S NETWORK DEVICE (Monitor.networkDeviceTieSource,
 * OneUptime issue #9904).
 *
 * A Ping, IP, Port, NTP, Website, API or SSL Certificate monitor is tied to
 * the network device its probes see at the address it checks
 * (Monitor.networkDeviceId, issues #9545 and #9677): by OneUptime, as the
 * monitor is created or its address or probes change, or by a person, from
 * the monitor's form, its Details card or a device's Monitors card.
 *
 * OneUptime keeps its own ties up to date: when the probes a monitor runs
 * on change, it works the tie out again, ties a monitor whose probes now see
 * one device, and unties one it tied whose probes no longer see that
 * device. A person's choice is never changed, the device they picked or the
 * tie they took off: so the column says who set it.
 */
enum NetworkDeviceTieSource {
  // OneUptime set it, by the address the monitor checks seen from its probes.
  Automatic = "Automatic",
  // A person set it: tied the monitor to a device, or took the tie off.
  Person = "Person",
}

export default NetworkDeviceTieSource;

// A column's value as the rule reads it, whatever was stored.
export function readNetworkDeviceTieSource(
  value: unknown,
): NetworkDeviceTieSource | null {
  if (value === NetworkDeviceTieSource.Automatic) {
    return NetworkDeviceTieSource.Automatic;
  }

  if (value === NetworkDeviceTieSource.Person) {
    return NetworkDeviceTieSource.Person;
  }

  return null;
}

/*
 * Whether OneUptime may change this monitor's tie on its own: one it made
 * itself, or a monitor nobody has tied or untied. A tie a person made, or
 * took off, is theirs; and a tie made before who made it was recorded is
 * kept as it is, since it may be a person's.
 */
export function mayOneUptimeChangeTie(data: {
  networkDeviceId: unknown;
  tieSource: unknown;
}): boolean {
  const source: NetworkDeviceTieSource | null = readNetworkDeviceTieSource(
    data.tieSource,
  );

  if (source === NetworkDeviceTieSource.Person) {
    return false;
  }

  if (source === NetworkDeviceTieSource.Automatic) {
    return true;
  }

  return !data.networkDeviceId;
}
