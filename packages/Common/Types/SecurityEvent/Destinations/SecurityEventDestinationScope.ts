/*
 * What a destination is sent. Two choices, because there are two reasons
 * to send OneUptime's security events to another SIEM:
 *
 *   - Detections: what OneUptime found - its detection rules' and threat
 *     intel's matches, and the alerts it imported from connected security
 *     products. A handful a day, each one worth an analyst's look, so the
 *     SIEM a team already works in sees OneUptime's findings next to its
 *     own. The default.
 *   - All events: every security event the project stores, so the SIEM can
 *     search and correlate them too. As many as OneUptime receives.
 *
 * "Detections" is the OCSF Findings category (categoryUid 2): Detection
 * Finding is what rules and threat intel write, and an imported alert is a
 * Detection, Incident or Compliance Finding depending on its product.
 */
enum SecurityEventDestinationScope {
  Detections = "detections",
  AllEvents = "all-events",
}

export default SecurityEventDestinationScope;

// The OCSF category every finding belongs to (OcsfEventClass: Findings).
export const SECURITY_FINDINGS_CATEGORY_UID: number = 2;

export const DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE: SecurityEventDestinationScope =
  SecurityEventDestinationScope.Detections;

export interface SecurityEventDestinationScopeOption {
  scope: SecurityEventDestinationScope;
  title: string;
  description: string;
}

// In the order the form offers them: the recommended choice first.
export const SECURITY_EVENT_DESTINATION_SCOPES: ReadonlyArray<SecurityEventDestinationScopeOption> =
  [
    {
      scope: SecurityEventDestinationScope.Detections,
      title: "Detections only",
      description:
        "What your detection rules and threat intel found, and the alerts your connected products raised.",
    },
    {
      scope: SecurityEventDestinationScope.AllEvents,
      title: "All security events",
      description:
        "Every security event OneUptime receives, so your SIEM can search them too.",
    },
  ];

export function isSecurityEventDestinationScope(
  value: unknown,
): value is SecurityEventDestinationScope {
  return (
    value === SecurityEventDestinationScope.Detections ||
    value === SecurityEventDestinationScope.AllEvents
  );
}

export function getSecurityEventDestinationScopeTitle(value: unknown): string {
  const option: SecurityEventDestinationScopeOption | undefined =
    SECURITY_EVENT_DESTINATION_SCOPES.find(
      (candidate: SecurityEventDestinationScopeOption): boolean => {
        return candidate.scope === value;
      },
    );

  return option ? option.title : "";
}
