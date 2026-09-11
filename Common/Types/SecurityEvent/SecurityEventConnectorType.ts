enum SecurityEventConnectorType {
  AwsSecurityHub = "AWS Security Hub",
  MicrosoftDefender = "Microsoft Defender XDR and Sentinel",
  Cloudflare = "Cloudflare",
  CrowdStrikeFalcon = "CrowdStrike Falcon",
  GoogleSecurityCommandCenter = "Google Security Command Center",
  Okta = "Okta",
  SplunkEnterpriseSecurity = "Splunk Enterprise Security",
}

export const SecurityEventConnectorTypes: Array<SecurityEventConnectorType> =
  Object.values(SecurityEventConnectorType);

export default SecurityEventConnectorType;
