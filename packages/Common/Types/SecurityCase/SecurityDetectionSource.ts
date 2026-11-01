/*
 * What raised a detection. Shown on every detection and case so an analyst
 * knows whose judgement they are reading: one of the project's own rules,
 * a threat-intelligence match, a product the project connected (its own
 * alert, imported), a person, an entity's risk - everything those found
 * about one user, host or address adding up to the project's threshold
 * (Types/SecurityCase/SecurityEntityRisk) - or Data Security, when a data
 * store's Critical issue opens (Server/Utils/DataSecurity/DataSecurityIntegrations).
 */
enum SecurityDetectionSource {
  DetectionRule = "Detection Rule",
  ThreatIntel = "Threat Intel",
  ConnectedProduct = "Connected Product",
  Manual = "Manual",
  EntityRisk = "Entity Risk",
  DataSecurity = "Data Security",
}

export const SECURITY_DETECTION_SOURCES: ReadonlyArray<SecurityDetectionSource> =
  [
    SecurityDetectionSource.DetectionRule,
    SecurityDetectionSource.ThreatIntel,
    SecurityDetectionSource.ConnectedProduct,
    SecurityDetectionSource.Manual,
    SecurityDetectionSource.EntityRisk,
    SecurityDetectionSource.DataSecurity,
  ];

export function isSecurityDetectionSource(
  value: unknown,
): value is SecurityDetectionSource {
  return (
    typeof value === "string" &&
    (SECURITY_DETECTION_SOURCES as ReadonlyArray<string>).includes(value)
  );
}

export default SecurityDetectionSource;
