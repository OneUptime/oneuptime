import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { DeviceNameSource } from "../../Types/NetworkDevice/DeviceNameSource";
import { DiscoveredDeviceImportFacts } from "../../Types/NetworkDevice/DiscoveredDevice";
import { DiscoveryImportSettings } from "../../Types/NetworkDevice/DiscoveryImport";
import NetworkDeviceMonitoringMethod from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../Types/ObjectID";
import { MAX_DEVICE_NAME_LENGTH } from "./DiscoveredDeviceBuilder";

/*
 * THE NETWORK DEVICE A DISCOVERED DEVICE IMPORTS AS (OneUptime issue #5775).
 *
 * A device a switch's tables or a network controller saw - a printer, a
 * camera, a register - added to monitoring from the Discovered Devices list:
 *
 *   - polled by a probe at the address it was seen at: the probe that polls
 *     the switch that saw it, which is on the same network. A device with
 *     none takes its site's probe when it is created
 *     (NetworkDeviceService), as every device created into a site does;
 *   - in the site it was seen in;
 *   - with the MAC it was seen with, marked learned - discovery read it, no
 *     one typed it - so a controller's traffic still finds the device by it
 *     (MerakiTrafficReader matches by serial, then MAC) and a later walk
 *     may correct it;
 *   - as what the person said it is, when they said (its role), and walked
 *     with the SNMP credentials they picked; with none, a device in a site
 *     with credentials is walked with the site's (read at each poll), and
 *     one in no such site is checked by ping;
 *   - polled as often as the person chose, and given its vendor's health
 *     template when it answers SNMP and they asked for that.
 *
 * Its name is the name the list showed (the classification a person gave
 * it, the name its controller or DHCP gave it, else its address). A device
 * named by its address records that, so its first SNMP poll may give it the
 * name it gives itself - as a device imported from a scan by its address.
 */
export function buildNetworkDeviceFromDiscoveredDevice(data: {
  projectId: ObjectID;
  ipAddress: string;
  facts: DiscoveredDeviceImportFacts;
  settings: DiscoveryImportSettings;
  name?: string | undefined;
}): NetworkDevice {
  const address: string = data.ipAddress.trim();
  const name: string = (data.name || data.facts.name || address)
    .trim()
    .substring(0, MAX_DEVICE_NAME_LENGTH);

  const device: NetworkDevice = new NetworkDevice();
  device.projectId = data.projectId;
  device.name = name;
  device.hostname = address;

  if (name === address) {
    device.discoveredNameSource = DeviceNameSource.Address;
    device.discoveredName = name;
  }

  if (data.facts.macAddress) {
    device.macAddress = data.facts.macAddress;
    device.isMacAddressLearned = true;
  }

  if (data.facts.siteId) {
    device.siteId = new ObjectID(data.facts.siteId);
  }

  if (data.facts.probeId) {
    device.probeId = new ObjectID(data.facts.probeId);
  }

  device.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
  device.isPollingEnabled = true;
  device.pollingIntervalInMinutes = data.settings.pollingIntervalInMinutes;

  if (data.settings.networkDeviceRoleId) {
    device.networkDeviceRoleId = new ObjectID(
      data.settings.networkDeviceRoleId,
    );
  }

  if (data.settings.snmpCredentialProfileId) {
    device.snmpCredentialProfileId = new ObjectID(
      data.settings.snmpCredentialProfileId,
    );
  }

  if (data.settings.applyVendorTemplates) {
    device.autoApplyVendorHealthTemplate = true;
  }

  return device;
}

/*
 * The name to try when another device already has this one: the same with
 * the address added, cut so the whole still fits. Device names are unique
 * per project, and fifty printers a person classified "Printer" are fifty
 * devices.
 */
export function buildDiscoveredDeviceFallbackName(
  name: string,
  ipAddress: string,
): string {
  const address: string = ipAddress.trim();
  const base: string = name.trim() || address;

  if (!address || base === address) {
    return base.substring(0, MAX_DEVICE_NAME_LENGTH);
  }

  const suffix: string = ` (${address})`;

  return (
    base.substring(0, Math.max(1, MAX_DEVICE_NAME_LENGTH - suffix.length)) +
    suffix
  ).substring(0, MAX_DEVICE_NAME_LENGTH);
}
