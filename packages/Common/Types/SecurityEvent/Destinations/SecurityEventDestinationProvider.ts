/*
 * The SIEMs OneUptime can SEND security events to - the other direction of
 * a Security Event Connection, which brings a product's alerts in. Stored
 * on SecurityEventDestination.provider, looked up in
 * SecurityEventDestinationCatalog (what the form asks for, where the docs
 * are) and, on the server, in SecurityEventDestinationRegistry (the code
 * that sends).
 *
 * A value names the same product as the inbound connector of that product
 * (SecurityEventConnectorProvider), so "google-secops" is Google SecOps
 * whichever way the events flow. Splunk, Microsoft Sentinel and Elastic
 * follow as one entry here, one in the catalog and one sender each.
 */
enum SecurityEventDestinationProvider {
  GoogleSecOps = "google-secops",
}

export default SecurityEventDestinationProvider;

export const AllSecurityEventDestinationProviders: Array<SecurityEventDestinationProvider> =
  [SecurityEventDestinationProvider.GoogleSecOps];

export function isSecurityEventDestinationProvider(
  value: unknown,
): value is SecurityEventDestinationProvider {
  return (
    typeof value === "string" &&
    (AllSecurityEventDestinationProviders as Array<string>).includes(value)
  );
}
