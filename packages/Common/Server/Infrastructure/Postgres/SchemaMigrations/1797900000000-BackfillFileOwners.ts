import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Files learn who uploaded them (File.createdByUserId, stamped by
 * FileService from the signed-in user), and files uploaded before files
 * recorded their owner get one from the records that use them.
 *
 * A record may point only at its own files: a project's records at files
 * uploaded in that project, a person's profile picture at a file they
 * uploaded (Server/Utils/File/FileOwnership), and the pages that serve them
 * check the same. Files uploaded before File.projectId existed
 * (AddFormBranding1797700000000) have no project, so on their own they
 * would vanish from every status page, dashboard and note that shows them.
 * So, once:
 *
 *   - a file without a project takes the project of the records that point
 *     at it - a status page's logo, favicon or cover image, a dashboard's
 *     logo or favicon, a form's images, a probe's or an AI agent's icon,
 *     the attachments of notes, announcements and postmortems - when they
 *     are all records of one project. A file records of two projects point
 *     at stays without one: nothing says which of them it belongs to, so
 *     it is shown by neither until it is uploaded again. Records outside
 *     any project (global probes and AI agents) claim nothing;
 *   - a profile picture takes its user as its uploader, when only one user
 *     has it.
 *
 * Every record, archived or deleted ones too, counts as pointing at its
 * files. A file that already has a project, or an uploader, keeps it.
 *
 * The column was generated against the model; the backfill is the
 * migration's own. down() drops the column; the projects a file was given
 * are its own from then on and are kept.
 */

// A place a record of a project points at a File.
export interface FileProjectReference {
  // The table holding the file's id.
  table: string;
  // Its column holding the file's id.
  fileIdColumn: string;
  /*
   * For a list of files (a join table): the record the list belongs to,
   * which holds the project, and the join table's column pointing at it.
   * Without one, the table itself holds the project.
   */
  owner?: { table: string; idColumn: string } | undefined;
}

export const FILE_PROJECT_REFERENCES: Array<FileProjectReference> = [
  { table: "StatusPage", fileIdColumn: "logoFileId" },
  { table: "StatusPage", fileIdColumn: "faviconFileId" },
  { table: "StatusPage", fileIdColumn: "coverImageFileId" },
  { table: "Dashboard", fileIdColumn: "logoFileId" },
  { table: "Dashboard", fileIdColumn: "faviconFileId" },
  { table: "Form", fileIdColumn: "logoFileId" },
  { table: "Form", fileIdColumn: "faviconFileId" },
  { table: "Probe", fileIdColumn: "iconFileId" },
  { table: "AIAgent", fileIdColumn: "iconFileId" },
  {
    table: "IncidentPostmortemAttachmentFile",
    fileIdColumn: "fileId",
    owner: { table: "Incident", idColumn: "incidentId" },
  },
  {
    table: "IncidentPublicNoteFile",
    fileIdColumn: "fileId",
    owner: { table: "IncidentPublicNote", idColumn: "incidentPublicNoteId" },
  },
  {
    table: "IncidentInternalNoteFile",
    fileIdColumn: "fileId",
    owner: {
      table: "IncidentInternalNote",
      idColumn: "incidentInternalNoteId",
    },
  },
  {
    table: "IncidentEpisodePublicNoteFile",
    fileIdColumn: "fileId",
    owner: {
      table: "IncidentEpisodePublicNote",
      idColumn: "incidentEpisodePublicNoteId",
    },
  },
  {
    table: "IncidentEpisodeInternalNoteFile",
    fileIdColumn: "fileId",
    owner: {
      table: "IncidentEpisodeInternalNote",
      idColumn: "incidentEpisodeInternalNoteId",
    },
  },
  {
    table: "AlertInternalNoteFile",
    fileIdColumn: "fileId",
    owner: { table: "AlertInternalNote", idColumn: "alertInternalNoteId" },
  },
  {
    table: "AlertEpisodeInternalNoteFile",
    fileIdColumn: "fileId",
    owner: {
      table: "AlertEpisodeInternalNote",
      idColumn: "alertEpisodeInternalNoteId",
    },
  },
  {
    table: "ScheduledMaintenancePublicNoteFile",
    fileIdColumn: "fileId",
    owner: {
      table: "ScheduledMaintenancePublicNote",
      idColumn: "scheduledMaintenancePublicNoteId",
    },
  },
  {
    table: "ScheduledMaintenanceInternalNoteFile",
    fileIdColumn: "fileId",
    owner: {
      table: "ScheduledMaintenanceInternalNote",
      idColumn: "scheduledMaintenanceInternalNoteId",
    },
  },
  {
    table: "StatusPageAnnouncementFile",
    fileIdColumn: "fileId",
    owner: {
      table: "StatusPageAnnouncement",
      idColumn: "statusPageAnnouncementId",
    },
  },
];

type GetFileProjectReferenceSqlFunction = (
  reference: FileProjectReference,
) => string;

// Every file one place points at, with the project of the record pointing.
export const getFileProjectReferenceSql: GetFileProjectReferenceSqlFunction = (
  reference: FileProjectReference,
): string => {
  if (reference.owner) {
    return `SELECT "link"."${reference.fileIdColumn}" AS "fileId", "owner"."projectId" AS "projectId" FROM "${reference.table}" AS "link" INNER JOIN "${reference.owner.table}" AS "owner" ON "owner"."_id" = "link"."${reference.owner.idColumn}"`;
  }

  return `SELECT "${reference.fileIdColumn}" AS "fileId", "projectId" AS "projectId" FROM "${reference.table}"`;
};

/*
 * A file without a project takes the one project whose records point at
 * it. Postgres has no min() for uuid, so the one project is read as text.
 */
export const BACKFILL_FILE_PROJECT_SQL: string = `UPDATE "File" AS "file" SET "projectId" = "owner"."projectId" FROM (SELECT "reference"."fileId" AS "fileId", MIN("reference"."projectId"::text)::uuid AS "projectId" FROM (${FILE_PROJECT_REFERENCES.map(
  getFileProjectReferenceSql,
).join(
  " UNION ALL ",
)}) AS "reference" WHERE "reference"."fileId" IS NOT NULL AND "reference"."projectId" IS NOT NULL GROUP BY "reference"."fileId" HAVING COUNT(DISTINCT "reference"."projectId") = 1) AS "owner" WHERE "file"."_id" = "owner"."fileId" AND "file"."projectId" IS NULL`;

// A profile picture only one user has takes that user as its uploader.
export const BACKFILL_FILE_UPLOADER_SQL: string = `UPDATE "File" AS "file" SET "createdByUserId" = "owner"."userId" FROM (SELECT "profilePictureId" AS "fileId", MIN("_id"::text)::uuid AS "userId" FROM "User" WHERE "profilePictureId" IS NOT NULL GROUP BY "profilePictureId" HAVING COUNT(*) = 1) AS "owner" WHERE "file"."_id" = "owner"."fileId" AND "file"."createdByUserId" IS NULL`;

export class BackfillFileOwners1797900000000 implements MigrationInterface {
  public name: string = "BackfillFileOwners1797900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "File" ADD "createdByUserId" uuid`);
    await queryRunner.query(BACKFILL_FILE_PROJECT_SQL);
    await queryRunner.query(BACKFILL_FILE_UPLOADER_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "File" DROP COLUMN "createdByUserId"`);
  }
}
