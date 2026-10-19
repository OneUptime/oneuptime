import { jest } from "@jest/globals";
import PrivateRecordNoteRule from "../../../Server/Utils/Notes/PrivateRecordPublicNoteRule";
import { PrivateRecordKind } from "../../../Types/StatusPage/PrivateRecordPublicNotes";
import ObjectID from "../../../Types/ObjectID";

/*
 * Answers whether an incident or an episode is private, the way the database
 * would, without one.
 *
 * A private incident or episode takes no public notes
 * (Types/StatusPage/PrivateRecordPublicNotes), so every way a public note is
 * made outside its service's own create - a state change's note, a 📣 in
 * Slack or Microsoft Teams, a chat's Add Note form - first asks whether the
 * record is private (PrivateRecordPublicNoteRule.isPrivate), one read as
 * OneUptime. A suite about something else answers it here:
 *
 *   stubPrivateRecords();               // no record is private
 *   stubPrivateRecords([INCIDENT_ID]);  // only these are
 *
 * It hands back the reads asked, in order. Ids are compared lower-cased, as
 * Postgres renders a uuid.
 */

export interface PrivateRecordLookup {
  kind: PrivateRecordKind;
  recordId: string;
  projectId: string | null;
}

export function stubPrivateRecords(
  privateIds: Array<ObjectID | string> = [],
): Array<PrivateRecordLookup> {
  const lookups: Array<PrivateRecordLookup> = [];
  const privateSet: Set<string> = new Set<string>(
    privateIds.map((id: ObjectID | string): string => {
      return id.toString().toLowerCase();
    }),
  );

  jest
    .spyOn(PrivateRecordNoteRule, "isPrivate")
    .mockImplementation(
      async (data: {
        kind: PrivateRecordKind;
        recordId: ObjectID;
        projectId?: ObjectID | null | undefined;
      }): Promise<boolean> => {
        const recordId: string = data.recordId.toString().toLowerCase();

        lookups.push({
          kind: data.kind,
          recordId: recordId,
          projectId: data.projectId ? data.projectId.toString() : null,
        });

        return privateSet.has(recordId);
      },
    );

  return lookups;
}
