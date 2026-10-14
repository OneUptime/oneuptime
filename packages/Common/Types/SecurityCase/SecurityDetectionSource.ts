/*
 * What raised a detection. Shown on every detection and case so an analyst
 * knows whose judgement they are reading: one of the project's own rules,
 * a threat-intelligence match, a product the project connected (its own
 * alert, imported), or a person.
 */
enum SecurityDetectionSource {
  DetectionRule = "Detection Rule",
  ThreatIntel = "Threat Intel",
  ConnectedProduct = "Connected Product",
  Manual = "Manual",
}

export const SECURITY_DETECTION_SOURCES: ReadonlyArray<SecurityDetectionSource> =
  [
    SecurityDetectionSource.DetectionRule,
    SecurityDetectionSource.ThreatIntel,
    SecurityDetectionSource.ConnectedProduct,
    SecurityDetectionSource.Manual,
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
