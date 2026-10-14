import { EventNoteKind } from "../EventNotes/EventNoteKind";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A case's notes, written in the same composer as an incident's private
 * notes. They stay with the team that works security cases: a case has no
 * public side, no templates and no attachments.
 */
export function getSecurityCaseNoteKind(data: {
  securityCaseId: ObjectID;
}): EventNoteKind<SecurityCaseNote> {
  return {
    modelType: SecurityCaseNote,
    visibility: "private",
    eventNoun: translationKey("case"),
    parentIdField: "securityCaseId",
    parentId: data.securityCaseId,
  };
}
