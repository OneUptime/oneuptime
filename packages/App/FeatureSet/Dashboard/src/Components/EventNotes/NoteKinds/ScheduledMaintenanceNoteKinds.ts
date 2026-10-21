import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import {
  INTERNAL_NOTE_TEMPLATES,
  PUBLIC_NOTE_TEMPLATES,
} from "Common/UI/Components/AI/AITemplates";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { EventNoteKind, EventNotesTemplatesConfig } from "../EventNoteKind";
import { getNoteGenerator } from "../GenerateNoteWithAI";

/*
 * A scheduled maintenance event's public and private notes, as its Public
 * Notes and Private Notes pages and the Scheduled Maintenance Feed's
 * "Add Public Note" / "Add Private Note" all write them.
 */

function getScheduledMaintenanceNoteTemplates(): EventNotesTemplatesConfig {
  return {
    modelType: ScheduledMaintenanceNoteTemplate,
    settingsRoute: RouteUtil.populateRouteParams(
      RouteMap[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
      ] as Route,
    ),
  };
}

export function getScheduledMaintenancePublicNoteKind(data: {
  scheduledMaintenanceId: ObjectID;
  /*
   * Where "Notify status page subscribers" starts: off when the event was
   * created without notifying subscribers
   * - PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance.
   */
  isNotifyingByDefault: boolean;
}): EventNoteKind<ScheduledMaintenancePublicNote> {
  const scheduledMaintenanceId: ObjectID = data.scheduledMaintenanceId;

  return {
    modelType: ScheduledMaintenancePublicNote,
    visibility: "public",
    eventNoun: "scheduled maintenance event",
    parentIdField: "scheduledMaintenanceId",
    parentId: scheduledMaintenanceId,
    attachmentApiPath: "/scheduled-maintenance-public-note/attachment",
    subscriberNotifications: {
      isNotifyingByDefault: data.isNotifyingByDefault,
      quietDescription:
        PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    },
    templates: getScheduledMaintenanceNoteTemplates(),
    ai: {
      title: "Generate Public Note with AI",
      description:
        "AI will analyze the scheduled maintenance data and generate a customer-facing public note.",
      templates: PUBLIC_NOTE_TEMPLATES,
      generate: getNoteGenerator({
        apiPath: "/scheduled-maintenance/generate-note-from-ai",
        eventId: scheduledMaintenanceId,
        noteType: "public",
      }),
    },
    siblingRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE] as Route,
      { modelId: scheduledMaintenanceId },
    ),
  };
}

export function getScheduledMaintenancePrivateNoteKind(data: {
  scheduledMaintenanceId: ObjectID;
}): EventNoteKind<ScheduledMaintenanceInternalNote> {
  const scheduledMaintenanceId: ObjectID = data.scheduledMaintenanceId;

  return {
    modelType: ScheduledMaintenanceInternalNote,
    visibility: "private",
    eventNoun: "scheduled maintenance event",
    parentIdField: "scheduledMaintenanceId",
    parentId: scheduledMaintenanceId,
    attachmentApiPath: "/scheduled-maintenance-internal-note/attachment",
    templates: getScheduledMaintenanceNoteTemplates(),
    ai: {
      title: "Generate Private Note with AI",
      description:
        "AI will analyze the scheduled maintenance data and generate an internal technical note.",
      templates: INTERNAL_NOTE_TEMPLATES,
      generate: getNoteGenerator({
        apiPath: "/scheduled-maintenance/generate-note-from-ai",
        eventId: scheduledMaintenanceId,
        noteType: "internal",
      }),
    },
    siblingRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE] as Route,
      { modelId: scheduledMaintenanceId },
    ),
  };
}
