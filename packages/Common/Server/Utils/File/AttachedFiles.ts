import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import { normalizeFileId } from "./FileOwnership";

/*
 * THE FILES ATTACHED TO WHAT A DELETE TAKES (OneUptime issues #6944, #8895).
 *
 * A note's attachments, an incident's postmortem attachments and a status
 * page announcement's attachments are rows of File - their bytes in
 * Postgres - listed in a join table. Deleting the incident, the alert, the
 * episode or the scheduled maintenance event takes its notes with it (ON
 * DELETE CASCADE), and each note - and each announcement - its join rows,
 * but never the File rows: they stayed, unreachable, outliving the record
 * that was "deleted and can't be brought back", and taking the database
 * space the retention (issue #6903) exists to give back.
 *
 * So a delete of these records - by a person, through the API, or by a
 * retention purge: OneUptime's deletes all remove the row at once - reads
 * the files attached to the rows it removes and to the notes they take with
 * them (ATTACHMENT_SOURCES), before the DELETE; once it is done, each file
 * goes unless something still holds it (CustomFieldFiles.deleteUnheldFiles:
 * any column or join table that points at a File - another note, a
 * template, a status page's logo - or a custom field of a record of its
 * project). Only a file of the project it was uploaded in is deleted.
 * Every join table of the models that lists Files is one of the sources
 * (AttachedFiles.test holds the list to the models).
 *
 * What stays: an image written into a note's or a description's markdown.
 * It is addressed by its token, and copied along with the markdown it sits
 * in (a template's image is in every incident made from it), so nothing
 * here can tell that the last copy went (PublishedImages).
 *
 * Best-effort: a failed read leaves those files where they are, and the
 * delete goes ahead - a file left behind is space, a delete refused is a
 * record a person asked to remove.
 */

export type AttachedFilesQuery = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

/*
 * Where a deleted row's attached files are listed: a join table naming the
 * row itself, or - for the notes a delete takes with it - naming a note of
 * the row.
 */
export interface AttachmentSource {
  // The table whose deleted rows release the files.
  parentTable: string;
  // The join table that lists the files.
  joinTable: string;
  // Its column naming the row the files are attached to.
  joinColumn: string;
  // When they are attached to a note of the row: the note table and its column naming the row.
  through?:
    | {
        table: string;
        foreignKey: string;
      }
    | undefined;
}

// A note table, its join table, and the record it belongs to.
interface NoteAttachments {
  noteTable: string;
  joinTable: string;
  joinColumn: string;
  recordTable: string;
  recordColumn: string;
}

const NOTE_ATTACHMENTS: ReadonlyArray<NoteAttachments> = [
  {
    noteTable: "IncidentInternalNote",
    joinTable: "IncidentInternalNoteFile",
    joinColumn: "incidentInternalNoteId",
    recordTable: "Incident",
    recordColumn: "incidentId",
  },
  {
    noteTable: "IncidentPublicNote",
    joinTable: "IncidentPublicNoteFile",
    joinColumn: "incidentPublicNoteId",
    recordTable: "Incident",
    recordColumn: "incidentId",
  },
  {
    noteTable: "IncidentEpisodeInternalNote",
    joinTable: "IncidentEpisodeInternalNoteFile",
    joinColumn: "incidentEpisodeInternalNoteId",
    recordTable: "IncidentEpisode",
    recordColumn: "incidentEpisodeId",
  },
  {
    noteTable: "IncidentEpisodePublicNote",
    joinTable: "IncidentEpisodePublicNoteFile",
    joinColumn: "incidentEpisodePublicNoteId",
    recordTable: "IncidentEpisode",
    recordColumn: "incidentEpisodeId",
  },
  {
    noteTable: "AlertInternalNote",
    joinTable: "AlertInternalNoteFile",
    joinColumn: "alertInternalNoteId",
    recordTable: "Alert",
    recordColumn: "alertId",
  },
  {
    noteTable: "AlertEpisodeInternalNote",
    joinTable: "AlertEpisodeInternalNoteFile",
    joinColumn: "alertEpisodeInternalNoteId",
    recordTable: "AlertEpisode",
    recordColumn: "alertEpisodeId",
  },
  {
    noteTable: "ScheduledMaintenanceInternalNote",
    joinTable: "ScheduledMaintenanceInternalNoteFile",
    joinColumn: "scheduledMaintenanceInternalNoteId",
    recordTable: "ScheduledMaintenance",
    recordColumn: "scheduledMaintenanceId",
  },
  {
    noteTable: "ScheduledMaintenancePublicNote",
    joinTable: "ScheduledMaintenancePublicNoteFile",
    joinColumn: "scheduledMaintenancePublicNoteId",
    recordTable: "ScheduledMaintenance",
    recordColumn: "scheduledMaintenanceId",
  },
];

/*
 * Every source, held to the models' own join tables and cascades by a test
 * (AttachedFiles.test): a note deleted on its own releases its files, and
 * its record's delete releases them through it; an incident releases its
 * postmortem's attachments too, and an announcement its own.
 */
export const ATTACHMENT_SOURCES: ReadonlyArray<AttachmentSource> = [
  {
    parentTable: "Incident",
    joinTable: "IncidentPostmortemAttachmentFile",
    joinColumn: "incidentId",
  },
  {
    parentTable: "StatusPageAnnouncement",
    joinTable: "StatusPageAnnouncementFile",
    joinColumn: "statusPageAnnouncementId",
  },
  ...NOTE_ATTACHMENTS.flatMap(
    (note: NoteAttachments): Array<AttachmentSource> => {
      return [
        {
          parentTable: note.noteTable,
          joinTable: note.joinTable,
          joinColumn: note.joinColumn,
        },
        {
          parentTable: note.recordTable,
          joinTable: note.joinTable,
          joinColumn: note.joinColumn,
          through: {
            table: note.noteTable,
            foreignKey: note.recordColumn,
          },
        },
      ];
    },
  ),
];

// Whether a delete of the table's rows releases any attached files.
export function hasAttachedFiles(
  tableName: string | null | undefined,
): boolean {
  return ATTACHMENT_SOURCES.some((source: AttachmentSource): boolean => {
    return source.parentTable === tableName;
  });
}

// A table or column name from the registry above, quoted.
function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/*
 * The files a source lists for the rows $1 names, each with the project it
 * was uploaded in (a file uploaded with none is never released).
 */
export function getAttachedFilesSql(source: AttachmentSource): string {
  const join: string = quote(source.joinTable);
  const column: string = quote(source.joinColumn);

  if (!source.through) {
    return `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM ${join} j JOIN "File" f ON f."_id" = j."fileId" WHERE j.${column} = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`;
  }

  return `SELECT DISTINCT j."fileId"::text AS "fileId", f."projectId"::text AS "projectId" FROM ${join} j JOIN ${quote(source.through.table)} n ON n."_id" = j.${column} JOIN "File" f ON f."_id" = j."fileId" WHERE n.${quote(source.through.foreignKey)} = ANY($1::uuid[]) AND f."projectId" IS NOT NULL`;
}

type Row = Record<string, unknown>;

// What a query handed back, as rows: pg's array, or TypeORM's [rows, count].
function readRows(result: unknown): Array<Row> {
  if (!Array.isArray(result)) {
    return [];
  }

  if (result.length === 2 && Array.isArray(result[0])) {
    return result[0] as Array<Row>;
  }

  return result.filter((row: unknown): row is Row => {
    return row !== null && typeof row === "object" && !Array.isArray(row);
  });
}

export default class AttachedFiles {
  /*
   * The files attached to these rows of the table, and to the notes their
   * delete takes with them, by the project each file was uploaded in: read
   * before the delete, as CustomFieldFiles.deleteUnheldFiles takes them
   * after it. Best-effort: a source whose read fails is logged and left
   * out, the others are read.
   */
  public static async readFilesOfRowsDeleted(data: {
    tableName: string | null | undefined;
    ids: Array<ObjectID | string>;
    query: AttachedFilesQuery;
  }): Promise<Map<string, Set<string>>> {
    const released: Map<string, Set<string>> = new Map();

    const ids: Array<string> = data.ids
      .map((id: ObjectID | string): string => {
        return normalizeFileId(id);
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      });

    if (ids.length === 0) {
      return released;
    }

    for (const source of ATTACHMENT_SOURCES) {
      if (source.parentTable !== data.tableName) {
        continue;
      }

      let rows: Array<Row> = [];

      try {
        rows = readRows(await data.query(getAttachedFilesSql(source), [ids]));
      } catch (err) {
        logger.error(
          `Could not read the files of ${source.joinTable} a delete of ${source.parentTable} rows lets go of; they stay: ${String(err)}`,
        );
        continue;
      }

      for (const row of rows) {
        const fileId: string = normalizeFileId(row["fileId"]);
        const projectId: string = normalizeFileId(row["projectId"]);

        if (!ObjectID.isValidUUID(fileId) || !ObjectID.isValidUUID(projectId)) {
          continue;
        }

        if (!released.has(projectId)) {
          released.set(projectId, new Set<string>());
        }

        released.get(projectId)!.add(fileId);
      }
    }

    return released;
  }
}
