/*
 * The device management services (MDMs) OneUptime reads a fleet of devices
 * from, through their own API, with nothing to install on the devices
 * (OneUptime issue #9586). Each is a row of one design: a connection that
 * holds the service's API key, read on a schedule into ManagedDevice rows,
 * each of which is one host in Inventory.
 *
 * Esper, the Android device management service, is the first row. Intune,
 * SOTI and Workspace ONE would be rows of the same design.
 */
enum DeviceManagementProvider {
  Esper = "esper",
}

export const DEVICE_MANAGEMENT_PROVIDERS: ReadonlyArray<DeviceManagementProvider> =
  [DeviceManagementProvider.Esper];

export function isDeviceManagementProvider(
  value: unknown,
): value is DeviceManagementProvider {
  return (
    typeof value === "string" &&
    (DEVICE_MANAGEMENT_PROVIDERS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * What the product calls the service: a product name, the same in every
 * language.
 */
export function getDeviceManagementProviderTitle(
  provider: DeviceManagementProvider | string | undefined,
): string {
  switch (provider) {
    case DeviceManagementProvider.Esper:
      return "Esper";
    default:
      return "Esper";
  }
}

export default DeviceManagementProvider;
