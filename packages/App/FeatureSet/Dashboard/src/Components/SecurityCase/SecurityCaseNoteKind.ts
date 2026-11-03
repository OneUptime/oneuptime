import { EventNoteKind } from "../EventNotes/EventNoteKind";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import SecurityCaseNoteTemplate from "Common/Models/DatabaseModels/SecurityCaseNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A case's notes, written in the same composer as an incident's private
 * notes. They stay with the team that works security cases: a case has no
 * public side and no attachments - so the page says what the notes are for,
 * not that they never reach a status page or subscribers, which a case has
 * neither of.
 *
 * The composer's Templates menu offers the project's case note templates
 * (Security Events > Settings > Note Templates), and links there to manage
 * them, as an incident's and an alert's do.
 */
export const SECURITY_CASE_NOTES_DESCRIPTION: string = translationKey(
  "Notes for the team working this case: what you found, what you decided and what comes next.",
);

export function getSecurityCaseNoteKind(data: {
  securityCaseId: ObjectID;
}): EventNoteKind<SecurityCaseNote> {
  return {
    modelType: SecurityCaseNote,
    visibility: "private",
    eventNoun: translationKey("case"),
    description: SECURITY_CASE_NOTES_DESCRIPTION,
    parentIdField: "securityCaseId",
    parentId: data.securityCaseId,
    templates: {
      modelType: SecurityCaseNoteTemplate,
      settingsRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_NOTE_TEMPLATES] as Route,
      ),
    },
  };
}
