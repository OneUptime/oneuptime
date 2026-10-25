import { EventNoteKind } from "../EventNotes/EventNoteKind";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A case's notes, written in the same composer as an incident's private
 * notes. They stay with the team that works security cases: a case has no
 * public side, no templates and no attachments - so the page says what the
 * notes are for, not that they never reach a status page or subscribers,
 * which a case has neither of.
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
  };
}
