import { mayOneUptimeChangeTie } from "../../Types/NetworkDevice/NetworkDeviceTieSource";
import { toIdKey } from "./DeviceAddressScope";

/*
 * A MONITOR'S TIE WHEN ITS PROBES CHANGE (OneUptime issue #9904).
 *
 * A monitor is tied to the network device its probes see at the address it
 * checks (Monitor.networkDeviceId; issues #9545, #9677): which device that
 * is depends on where its probes are. Move a Ping monitor of 10.0.0.5 from
 * branch A's probe to branch B's, and it checks branch B's 10.0.0.5 - yet it
 * stayed tied to branch A's, listed on branch A's device and linking what it
 * raised to it.
 *
 * So when its probes change the rule is asked again, and:
 *
 *   - a monitor tied to no device, whose probes now see one, is tied to it;
 *   - a tie OneUptime made, whose probes now see another device, moves to it;
 *   - a tie OneUptime made, whose probes no longer see that device - none
 *     there, or devices they cannot tell apart - is taken off.
 *
 * Never a tie a person made, or one they took off, and never a tie made
 * before who made it was recorded (NetworkDeviceTieSource
 * .mayOneUptimeChangeTie); never a monitor an import or a rule made for a
 * device, which is that device's by its provenance.
 *
 * Pure: the server reads the monitor and asks the rule, and decides here.
 */

export type MonitorTieChange =
  // Tied to no device before.
  | { kind: "tie"; deviceId: string }
  // Tied to another device before.
  | { kind: "retie"; fromDeviceId: string; deviceId: string }
  // Tied, and now to none.
  | { kind: "untie"; fromDeviceId: string };

type IdLike = { toString(): string } | string | null | undefined;

/*
 * What changes, or null for nothing: the monitor as it is stored, and the
 * device its probes see at the address it checks now (none when they see
 * none there, or cannot tell which, or it checks no single address).
 */
export function decideTieAfterProbeChange(data: {
  linkedDeviceId: IdLike;
  tieSource: unknown;
  isMadeForDevice: boolean;
  seenDeviceId: IdLike;
}): MonitorTieChange | null {
  if (data.isMadeForDevice) {
    return null;
  }

  if (
    !mayOneUptimeChangeTie({
      networkDeviceId: toIdKey(data.linkedDeviceId),
      tieSource: data.tieSource,
    })
  ) {
    return null;
  }

  const linked: string = toIdKey(data.linkedDeviceId);
  const seen: string = toIdKey(data.seenDeviceId);

  if (linked === seen) {
    return null;
  }

  if (!linked) {
    return { kind: "tie", deviceId: seen };
  }

  if (!seen) {
    return { kind: "untie", fromDeviceId: linked };
  }

  return { kind: "retie", fromDeviceId: linked, deviceId: seen };
}
