/*
 * The security sources OneUptime can poll through the managed
 * Security Event Connections framework. Each value is the stable
 * identifier stored on SecurityEventConnection.provider, used to look up
 * the server-side connector in SecurityEventConnectorRegistry and the
 * form/help metadata in SecurityEventConnectorCatalog.
 *
 * Google SecOps predates this framework and keeps its own model
 * (GoogleSecOpsConnection) and poller; it is deliberately not listed here.
 */
enum SecurityEventConnectorProvider {
  MicrosoftSentinel = "microsoft-sentinel",
  MicrosoftDefenderXdr = "microsoft-defender-xdr",
  CrowdStrikeFalcon = "crowdstrike-falcon",
  SplunkEnterpriseSecurity = "splunk",
  ElasticSecurity = "elastic-security",
  AwsSecurityHub = "aws-security-hub",
  OktaSystemLog = "okta",
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
  ];

export function isSecurityEventConnectorProvider(
  value: unknown,
): value is SecurityEventConnectorProvider {
  return (
    typeof value === "string" &&
    (AllSecurityEventConnectorProviders as Array<string>).includes(value)
  );
}
