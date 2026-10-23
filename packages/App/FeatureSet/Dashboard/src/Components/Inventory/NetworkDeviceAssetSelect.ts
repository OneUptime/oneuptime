import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Select from "Common/Types/BaseDatabase/Select";

/*
 * Every column of a Network Device its asset facts are read from, and where
 * each came from (Common/Utils/NetworkDevice/NetworkDeviceAssetFacts, issues
 * #4569 and #5185): the columns its poll and its people write, what discovery
 * read about it, and when its own poll last read it - without which a value
 * discovery read later could not be told apart from an older poll's.
 *
 * One list for every Dashboard read that shows the facts, so the Inventory
 * card, the device's Overview and the Devices list cannot drift into showing
 * the same device differently. React-free, so the App's tests can read it.
 */
export const NETWORK_DEVICE_ASSET_FACT_COLUMNS: Select<NetworkDevice> = {
  name: true,
  hostname: true,
  dnsName: true,
  sysName: true,
  discoveredName: true,
  discoveredNameSource: true,
  macAddress: true,
  isMacAddressLearned: true,
  vendor: true,
  deviceModel: true,
  serialNumber: true,
  firmwareVersion: true,
  softwareVersion: true,
  sysDescr: true,
  sysObjectId: true,
  sysLocation: true,
  sysContact: true,
  lastSnmpSeenAt: true,
  discoveredDetails: true,
};

/*
 * The same, with the two relations the facts read: the site a device is
 * filed under and the role someone assigned it. For a direct read; a model
 * detail card declares relations as fields instead.
 */
export const NETWORK_DEVICE_ASSET_FACT_SELECT: Select<NetworkDevice> = {
  ...NETWORK_DEVICE_ASSET_FACT_COLUMNS,
  site: {
    name: true,
  },
  networkDeviceRole: {
    key: true,
    name: true,
  },
};

export default NETWORK_DEVICE_ASSET_FACT_SELECT;
