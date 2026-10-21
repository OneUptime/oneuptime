import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { EventNoteKind } from "../EventNoteKind";

/*
 * An alert episode's private notes, as its Private Notes page and the Episode
 * Feed's "Add Private Note" both write them. Alert episodes have no public
 * notes; they use the alerts' note templates and have no Draft with AI.
 */
export function getAlertEpisodePrivateNoteKind(data: {
  alertEpisodeId: ObjectID;
}): EventNoteKind<AlertEpisodeInternalNote> {
  const alertEpisodeId: ObjectID = data.alertEpisodeId;

  return {
    modelType: AlertEpisodeInternalNote,
    visibility: "private",
    eventNoun: "episode",
    parentIdField: "alertEpisodeId",
    parentId: alertEpisodeId,
    /*
     * No attachmentApiPath: episode private notes have no download route, so
     * files attached to one could never be opened again.
     */
    templates: {
      modelType: AlertNoteTemplate,
      settingsRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route,
      ),
    },
  };
}
