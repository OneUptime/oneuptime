import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  DeviceNameSource,
  readDeviceNameSource,
} from "Common/Types/NetworkDevice/DeviceNameSource";
import { isDeviceStillNamedByDiscovery } from "Common/Utils/NetworkDevice/DeviceNameRule";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the device Overview says about where a device's name came from
 * (OneUptime issue #4518).
 *
 * A discovery scan names a device by the best name it finds — its own name
 * first, then its DNS name, then its address — and a later scan that finds a
 * better one renames it, for as long as nobody has renamed it. A device that
 * can rename itself has to say so somewhere, or the day it does reads as a
 * bug. This is that place: one quiet row on the Overview, beside the DNS Name
 * and System Name rows that hold the other names, shown only while the name
 * is still the one discovery gave it. A device a person named, made by hand,
 * or imported before #4518 shows nothing.
 *
 * React-free, so the App and Common suites can test it without a renderer.
 */

/*
 * The row's value for each source: the kind of name, in the words the
 * Discovery page and the docs use for it. English keys, looked up where the
 * row is drawn.
 */
const DEVICE_NAME_SOURCE_LABELS: Record<DeviceNameSource, string> = {
  [DeviceNameSource.SystemName]: translationKey("SNMP system name"),
  [DeviceNameSource.NetbiosName]: translationKey("NetBIOS (Windows) name"),
  [DeviceNameSource.DnsName]: translationKey("Reverse-DNS name"),
  [DeviceNameSource.Address]: translationKey("IP address"),
};

export const DEVICE_NAME_SOURCE_FIELD_TITLE: string =
  translationKey("Name Source");

/*
 * Under the row's title: what the value means and what will happen to the
 * name. Says the two things an operator needs before the scan does anything —
 * that a better name will replace this one, and how to stop that.
 */
export const DEVICE_NAME_SOURCE_FIELD_DESCRIPTION: string = translationKey(
  "A discovery scan named this device. A later scan that finds a better name, such as the device's own name instead of its DNS name or IP address, renames it. Rename it yourself to keep a name of your own.",
);

/**
 * The English label of the source a device is named from, or undefined when
 * the row should not be shown: discovery did not name the device, the source
 * is unreadable, or a person has renamed it since.
 */
export function getDeviceNameSourceLabel(
  device: Pick<NetworkDevice, "name" | "discoveredName" | "discoveredNameSource">,
): string | undefined {
  if (!isDeviceStillNamedByDiscovery(device)) {
    return undefined;
  }

  const source: DeviceNameSource | undefined = readDeviceNameSource(
    device.discoveredNameSource,
  );

  return source ? DEVICE_NAME_SOURCE_LABELS[source] : undefined;
}
