import PageMap from "../../Utils/PageMap";
import { IncidentAlertAiSubjectKind } from "Common/Types/AI/IncidentAlertAiLogs";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The AI section of the Incidents and Alerts menus draws the same pages for
 * both products; this is what differs between them. Import-clean (PageMap
 * and Common types only), so the suites read it without a browser.
 */
export interface IncidentAlertAiDescriptor {
  subjectKind: IncidentAlertAiSubjectKind;
  // The section's pages.
  logsPage: PageMap;
  settingsPage: PageMap;
  autoRemediationRulesPage: PageMap;
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
    logsPage: PageMap.INCIDENTS_AI_LOGS,
    settingsPage: PageMap.INCIDENTS_SETTINGS_AI,
    autoRemediationRulesPage: PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES,
    subjectViewPage: PageMap.INCIDENT_VIEW,
    testIdPrefix: "incident-ai",
  },
  alert: {
    subjectKind: "alert",
    logsPage: PageMap.ALERTS_AI_LOGS,
    settingsPage: PageMap.ALERTS_SETTINGS_AI,
    autoRemediationRulesPage: PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
    subjectViewPage: PageMap.ALERT_VIEW,
    testIdPrefix: "alert-ai",
  },
};

export function getIncidentAlertAiDescriptor(
  subjectKind: IncidentAlertAiSubjectKind,
): IncidentAlertAiDescriptor {
  return INCIDENT_ALERT_AI_DESCRIPTORS[subjectKind];
}

// The words "incident" and "alert" as a sentence names them.
export const INCIDENT_ALERT_AI_SUBJECT_TERMS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey("incident"),
  alert: translationKey("alert"),
};
