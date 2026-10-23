/*
 * The cloud-managed networks OneUptime reads traffic from through their
 * own controller's API, with nothing to set up on the devices (OneUptime
 * issue #5140). Each is a row of one design: a connection that holds the
 * controller's read-only API key, read on a schedule into the Traffic
 * pages (NetworkControllerConnection, NetworkTrafficUsage).
 *
 * Cisco Meraki, through the Meraki dashboard API, is the first row.
 */
enum NetworkControllerProvider {
  Meraki = "meraki",
}

export const NETWORK_CONTROLLER_PROVIDERS: ReadonlyArray<NetworkControllerProvider> =
  [NetworkControllerProvider.Meraki];

export function isNetworkControllerProvider(
  value: unknown,
): value is NetworkControllerProvider {
  return (
    typeof value === "string" &&
    (NETWORK_CONTROLLER_PROVIDERS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * What the product calls the controller: a product name, the same in every
 * language.
 */
export function getNetworkControllerProviderTitle(
  provider: NetworkControllerProvider,
): string {
  switch (provider) {
    case NetworkControllerProvider.Meraki:
      return "Cisco Meraki";
  }
}

export default NetworkControllerProvider;
