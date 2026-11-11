import { translationKey } from "Common/Types/Translator";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";

/*
 * The words of one kind of workspace summary table - Incident, Alert,
 * Incident Episode, Alert Episode - each a whole sentence of its own.
 *
 * The table used to build them from the kind's name ("Set up recurring
 * ${type} summary reports ..."), which only English can read: German joins
 * "Vorfall" and "Zusammenfassung" into one word, and other languages put
 * the kind somewhere else in the sentence. So every kind has its own
 * sentences, looked up whole. {{workspace}} is the product's name (Slack,
 * Microsoft Teams, Mattermost), which is never translated.
 *
 * singularName and pluralName are terms the table itself looks up (it puts
 * them into "Create {{itemName}}" and the like), so they stay the English
 * keys here.
 */
export interface WorkspaceSummaryTypeCopy {
  singularName: string;
  pluralName: string;
  // "Incident Summary - {{workspace}}"
  cardTitle: string;
  cardDescription: string;
  noItemsMessage: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
}

export const WORKSPACE_SUMMARY_TYPE_COPY: Record<
  WorkspaceNotificationSummaryType,
  WorkspaceSummaryTypeCopy
> = {
  [WorkspaceNotificationSummaryType.Incident]: {
    singularName: translationKey("Incident Summary"),
    pluralName: translationKey("Incident Summaries"),
    cardTitle: translationKey("Incident Summary - {{workspace}}"),
    cardDescription: translationKey(
      "Set up recurring incident summary reports posted to {{workspace}}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of incidents with links.",
    ),
    noItemsMessage: translationKey(
      "No incident summary rules configured yet. Create one to start receiving periodic reports.",
    ),
    namePlaceholder: translationKey("Weekly Incident Summary"),
    descriptionPlaceholder: translationKey(
      "e.g., Weekly incident summary for the engineering team.",
    ),
  },
  [WorkspaceNotificationSummaryType.Alert]: {
    singularName: translationKey("Alert Summary"),
    pluralName: translationKey("Alert Summaries"),
    cardTitle: translationKey("Alert Summary - {{workspace}}"),
    cardDescription: translationKey(
      "Set up recurring alert summary reports posted to {{workspace}}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of alerts with links.",
    ),
    noItemsMessage: translationKey(
      "No alert summary rules configured yet. Create one to start receiving periodic reports.",
    ),
    namePlaceholder: translationKey("Weekly Alert Summary"),
    descriptionPlaceholder: translationKey(
      "e.g., Weekly alert summary for the engineering team.",
    ),
  },
  [WorkspaceNotificationSummaryType.IncidentEpisode]: {
    singularName: translationKey("Incident Episode Summary"),
    pluralName: translationKey("Incident Episode Summaries"),
    cardTitle: translationKey("Incident Episode Summary - {{workspace}}"),
    cardDescription: translationKey(
      "Set up recurring incident episode summary reports posted to {{workspace}}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of incident episodes with links.",
    ),
    noItemsMessage: translationKey(
      "No incident episode summary rules configured yet. Create one to start receiving periodic reports.",
    ),
    namePlaceholder: translationKey("Weekly Incident Episode Summary"),
    descriptionPlaceholder: translationKey(
      "e.g., Weekly incident episode summary for the engineering team.",
    ),
  },
  [WorkspaceNotificationSummaryType.AlertEpisode]: {
    singularName: translationKey("Alert Episode Summary"),
    pluralName: translationKey("Alert Episode Summaries"),
    cardTitle: translationKey("Alert Episode Summary - {{workspace}}"),
    cardDescription: translationKey(
      "Set up recurring alert episode summary reports posted to {{workspace}}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of alert episodes with links.",
    ),
    noItemsMessage: translationKey(
      "No alert episode summary rules configured yet. Create one to start receiving periodic reports.",
    ),
    namePlaceholder: translationKey("Weekly Alert Episode Summary"),
    descriptionPlaceholder: translationKey(
      "e.g., Weekly alert episode summary for the engineering team.",
    ),
  },
};
