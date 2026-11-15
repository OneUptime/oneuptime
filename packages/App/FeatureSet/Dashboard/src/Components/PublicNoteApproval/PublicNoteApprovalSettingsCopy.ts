import { PublicNoteApprovalEventType } from "Common/Types/StatusPage/PublicNoteApproval";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Settings > Public Note Approval for each kind of event, and
 * the Project switch each page turns (Project.requireApprovalFor*PublicNotes).
 * React-free, so the two pages' words and switches are pinned in plain tests.
 */

export type PublicNoteApprovalSwitchColumn =
  | "requireApprovalForIncidentPublicNotes"
  | "requireApprovalForScheduledMaintenancePublicNotes";

export interface PublicNoteApprovalSettingsCopy {
  cardDescription: string;
  switchDescription: string;
  tableName: string;
}

export const PUBLIC_NOTE_APPROVAL_SETTINGS_COPY: Record<
  PublicNoteApprovalEventType,
  PublicNoteApprovalSettingsCopy
> = {
  [PublicNoteApprovalEventType.Incident]: {
    cardDescription: translationKey(
      "Have someone approve public notes on incidents and episodes before customers see them. Off by default: notes are published as soon as they are posted.",
    ),
    switchDescription: translationKey(
      "A new public note, or an edit of one, waits until it is approved. Until then it is not on status pages, no subscriber is told, and it is not posted to chat channels.",
    ),
    tableName: "Settings > Incident Public Note Approval",
  },
  [PublicNoteApprovalEventType.ScheduledMaintenance]: {
    cardDescription: translationKey(
      "Have someone approve public notes on maintenance events before customers see them. Off by default: notes are published as soon as they are posted.",
    ),
    switchDescription: translationKey(
      "A new public note, or an edit of one, waits until it is approved. Until then it is not on status pages, no subscriber is told, and it is not posted to chat channels.",
    ),
    tableName: "Settings > Scheduled Maintenance Public Note Approval",
  },
};

export function getPublicNoteApprovalSwitchColumn(
  eventType: PublicNoteApprovalEventType,
): PublicNoteApprovalSwitchColumn {
  return eventType === PublicNoteApprovalEventType.ScheduledMaintenance
    ? "requireApprovalForScheduledMaintenancePublicNotes"
    : "requireApprovalForIncidentPublicNotes";
}
