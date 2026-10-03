import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { INTERNAL_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { EventNoteKind } from "../EventNoteKind";
import { getNoteGenerator } from "../GenerateNoteWithAI";

/*
 * An alert's private notes, as its Private Notes page and the Alert Feed's
 * "Add Private Note" both write them. Alerts have no public notes.
 */
export function getAlertPrivateNoteKind(data: {
  alertId: ObjectID;
}): EventNoteKind<AlertInternalNote> {
  const alertId: ObjectID = data.alertId;

  return {
    modelType: AlertInternalNote,
    visibility: "private",
    eventNoun: "alert",
    parentIdField: "alertId",
    parentId: alertId,
    attachmentApiPath: "/alert-internal-note/attachment",
    templates: {
      modelType: AlertNoteTemplate,
      settingsRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route,
      ),
    },
    ai: {
      title: "Generate Private Note with AI",
      description:
        "AI will analyze the alert data and generate an internal technical note.",
      templates: INTERNAL_NOTE_TEMPLATES,
      // Alerts only have private notes, so their endpoint takes no type.
      generate: getNoteGenerator({
        apiPath: "/alert/generate-note-from-ai",
        eventId: alertId,
      }),
    },
  };
}
