import PageMap from "../../Utils/PageMap";
import { IncidentAlertAiSubjectKind } from "Common/Types/AI/IncidentAlertAiLogs";

/*
 * The AI section of the Incidents and Alerts menus draws the same pages for
 * both products; this is what differs between them. Import-clean (PageMap
 * and Common types only), so the suites read it without a browser.
 */
export interface IncidentAlertAiDescriptor {
  subjectKind: IncidentAlertAiSubjectKind;
  // The section's pages.
  insightsPage: PageMap;
  logsPage: PageMap;
  settingsPage: PageMap;
  // Where one incident or alert opens.
  subjectViewPage: PageMap;
  // The data-testid prefix of the section's pages.
  testIdPrefix: string;
}

export const INCIDENT_ALERT_AI_DESCRIPTORS: Record<
  IncidentAlertAiSubjectKind,
  IncidentAlertAiDescriptor
> = {
  incident: {
    subjectKind: "incident",
    insightsPage: PageMap.INCIDENTS_AI_INSIGHTS,
    logsPage: PageMap.INCIDENTS_AI_LOGS,
    settingsPage: PageMap.INCIDENTS_SETTINGS_AI,
    subjectViewPage: PageMap.INCIDENT_VIEW,
    testIdPrefix: "incident-ai",
  },
  alert: {
    subjectKind: "alert",
    insightsPage: PageMap.ALERTS_AI_INSIGHTS,
    logsPage: PageMap.ALERTS_AI_LOGS,
    settingsPage: PageMap.ALERTS_SETTINGS_AI,
    subjectViewPage: PageMap.ALERT_VIEW,
    testIdPrefix: "alert-ai",
  },
};

export function getIncidentAlertAiDescriptor(
  subjectKind: IncidentAlertAiSubjectKind,
): IncidentAlertAiDescriptor {
  return INCIDENT_ALERT_AI_DESCRIPTORS[subjectKind];
}
