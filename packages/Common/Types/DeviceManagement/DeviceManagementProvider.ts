/*
 * The device management services (MDMs) OneUptime reads a fleet of devices
 * from, through their own API, with nothing to install on the devices
 * (OneUptime issue #9586). Each is a row of one design: a connection that
 * holds the service's credentials, read on a schedule into ManagedDevice
 * rows, each of which is one host in Inventory.
 *
 * Esper was the first row (#9586), and Microsoft Intune the second (#9837).
 * Workspace ONE and SOTI MobiControl would be rows of the same design.
 */
enum DeviceManagementProvider {
  Esper = "esper",
  Intune = "intune",
}

export const DEVICE_MANAGEMENT_PROVIDERS: ReadonlyArray<DeviceManagementProvider> =
  [DeviceManagementProvider.Esper, DeviceManagementProvider.Intune];

export function isDeviceManagementProvider(
  value: unknown,
): value is DeviceManagementProvider {
  return (
    typeof value === "string" &&
    (DEVICE_MANAGEMENT_PROVIDERS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * A stored provider, read without trusting it: none (a connection made
 * before there was a choice) is Esper, and so is anything unknown.
 */
export function readDeviceManagementProvider(
  value: unknown,
): DeviceManagementProvider {
  return isDeviceManagementProvider(value)
    ? value
    : DeviceManagementProvider.Esper;
}

/*
 * What the product calls the service: a product name, the same in every
 * language.
 */
export function getDeviceManagementProviderTitle(
  provider: DeviceManagementProvider | string | undefined,
): string {
  switch (provider) {
    case DeviceManagementProvider.Intune:
      return "Microsoft Intune";
    case DeviceManagementProvider.Esper:
    default:
      return "Esper";
  }
}

/*
 * The service's short name, where its full one would crowd a line: an
 * incident's title, a monitor's name. A product name too.
 */
export function getDeviceManagementProviderShortTitle(
  provider: DeviceManagementProvider | string | undefined,
): string {
  switch (provider) {
    case DeviceManagementProvider.Intune:
      return "Intune";
    case DeviceManagementProvider.Esper:
    default:
      return "Esper";
  }
}

export default DeviceManagementProvider;
