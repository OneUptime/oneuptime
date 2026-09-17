/*
 * The security sources OneUptime can poll through the managed
 * Security Event Connections framework. Each value is the stable
 * identifier stored on SecurityEventConnection.provider, used to look up
 * the server-side connector in SecurityEventConnectorRegistry and the
 * form/help metadata in SecurityEventConnectorCatalog.
 *
 * Google SecOps used to have its own model (GoogleSecOpsConnection) and
 * poller. It is now a provider like any other; its value "google-secops"
 * is the identifier its connection tests already stored, so run history
 * carried over from the old model still resolves to this entry.
 */
enum SecurityEventConnectorProvider {
  MicrosoftSentinel = "microsoft-sentinel",
  MicrosoftDefenderXdr = "microsoft-defender-xdr",
  CrowdStrikeFalcon = "crowdstrike-falcon",
  SplunkEnterpriseSecurity = "splunk",
  ElasticSecurity = "elastic-security",
  AwsSecurityHub = "aws-security-hub",
  OktaSystemLog = "okta",
  GoogleSecOps = "google-secops",
}

export default SecurityEventConnectorProvider;

export const AllSecurityEventConnectorProviders: Array<SecurityEventConnectorProvider> =
  [
    SecurityEventConnectorProvider.MicrosoftSentinel,
    SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    SecurityEventConnectorProvider.CrowdStrikeFalcon,
    SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    SecurityEventConnectorProvider.ElasticSecurity,
    SecurityEventConnectorProvider.AwsSecurityHub,
    SecurityEventConnectorProvider.OktaSystemLog,
    SecurityEventConnectorProvider.GoogleSecOps,
  ];

export function isSecurityEventConnectorProvider(
  value: unknown,
): value is SecurityEventConnectorProvider {
  return (
    typeof value === "string" &&
    (AllSecurityEventConnectorProviders as Array<string>).includes(value)
  );
}
