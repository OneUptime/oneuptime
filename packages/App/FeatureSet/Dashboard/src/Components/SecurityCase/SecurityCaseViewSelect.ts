import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Select from "Common/Types/BaseDatabase/Select";

/*
 * What a case's pages read of it, once, in their layout: its header (number,
 * pills, title, description, labels, who has it, the status steps and the
 * facts), its Overview's figures and ATT&CK tactics, the entities its
 * Entities page shows, the incident it was declared as, and OneUptime AI's
 * triage for the AI card. Every page under the case reads from this one row,
 * so the header and the page below it never disagree.
 */
export const SECURITY_CASE_VIEW_SELECT: Select<SecurityCase> = {
  _id: true,
  caseNumberWithPrefix: true,
  title: true,
  description: true,
  securityCaseStatusId: true,
  securityCasePriorityId: true,
  verdict: true,
  closingNote: true,
  source: true,
  entities: true,
  mitreTactics: true,
  mitreTechniques: true,
  detectionCount: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  acknowledgedAt: true,
  containedAt: true,
  closedAt: true,
  createdAt: true,
  incidentId: true,
  incident: {
    _id: true,
    incidentNumberWithPrefix: true,
  },
  assignedToUserId: true,
  assignedToUser: {
    _id: true,
    name: true,
    email: true,
    profilePictureId: true,
  },
  assignedToTeamId: true,
  assignedToTeam: {
    _id: true,
    name: true,
  },
  labels: {
    _id: true,
    name: true,
    color: true,
  },
  // OneUptime AI's triage of the case, for its AI card.
  aiVerdict: true,
  aiSuggestedSecurityCasePriorityId: true,
  aiSuggestedPlaybookId: true,
  aiTriageReport: true,
  aiTriagedAt: true,
  aiTriagePromptInjectionSuspected: true,
};

/*
 * What the crumb that stands for the case calls it, and the browser tab:
 * its number - "CASE-142", short, and the way a security team names its
 * cases - or its title for a case with none.
 */
export function getSecurityCaseRecordName(
  securityCase: SecurityCase,
): string | null {
  const number: string = (securityCase.caseNumberWithPrefix || "").trim();

  if (number) {
    return number;
  }

  const title: string = (securityCase.title || "").trim();

  return title || null;
}
