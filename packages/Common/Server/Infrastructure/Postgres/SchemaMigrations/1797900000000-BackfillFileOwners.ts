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
 *     the attachments of notes, announcements and postmortems, and the
 *     inline images in what people write (notes, descriptions,
 *     postmortems, templates, status page text, custom fields), which only
 *     the record's own project may make public or private
 *     (InlineImageAccessTokenSync) - when they are all records of one
 *     project. A file records of two projects point at stays without one:
 *     nothing says which of them it belongs to, so it is shown by neither
 *     until it is uploaded again. Records outside any project (global
 *     probes and AI agents) claim nothing;
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

/*
 * A table whose markdown carries inline images by token
 * (/file/image/access-token/<token>, InlineImageAccessTokenSync), and the
 * columns it carries them in: everything people write with the markdown
 * editor - notes, descriptions, root causes, remediation notes,
 * postmortems, templates, status page text, rules' message templates - and
 * custom fields (JSON, whose rich text values are markdown). The feeds and
 * the state timelines are left out: OneUptime writes most of them itself,
 * and they are the largest tables.
 */
export interface MarkdownImageReference {
  table: string;
  columns: Array<string>;
}

export const MARKDOWN_IMAGE_REFERENCES: Array<MarkdownImageReference> = [
  {
    table: "Alert",
    columns: ["description", "rootCause", "remediationNotes", "customFields"],
  },
  {
    table: "AlertEpisode",
    columns: ["description", "rootCause", "remediationNotes"],
  },
  { table: "AlertEpisodeInternalNote", columns: ["note"] },
  { table: "AlertInternalNote", columns: ["note"] },
  { table: "AlertNoteTemplate", columns: ["note"] },
  { table: "Form", columns: ["description", "successMessage"] },
  {
    table: "Incident",
    columns: [
      "description",
      "rootCause",
      "remediationNotes",
      "postmortemNote",
      "customFields",
    ],
  },
  {
    table: "IncidentEpisode",
    columns: ["description", "rootCause", "remediationNotes", "postmortemNote"],
  },
  { table: "IncidentEpisodeInternalNote", columns: ["note"] },
  { table: "IncidentEpisodePublicNote", columns: ["note"] },
  { table: "IncidentInternalNote", columns: ["note"] },
  { table: "IncidentNoteTemplate", columns: ["note"] },
  { table: "IncidentPostmortemTemplate", columns: ["postmortemNote"] },
  { table: "IncidentPublicNote", columns: ["note"] },
  {
    table: "IncidentSlaRule",
    columns: ["internalNoteReminderTemplate", "publicNoteReminderTemplate"],
  },
  { table: "IncidentTemplate", columns: ["description", "customFields"] },
  { table: "InventoryItem", columns: ["customFields"] },
  { table: "Monitor", columns: ["customFields"] },
  { table: "MonitorTemplate", columns: ["customFields"] },
  { table: "OnCallDutyPolicy", columns: ["customFields"] },
  { table: "ProjectUserProfile", columns: ["customFields"] },
  { table: "ScheduledMaintenance", columns: ["description", "customFields"] },
  { table: "ScheduledMaintenanceInternalNote", columns: ["note"] },
  { table: "ScheduledMaintenanceNoteTemplate", columns: ["note"] },
  { table: "ScheduledMaintenancePublicNote", columns: ["note"] },
  {
    table: "ScheduledMaintenanceTemplate",
    columns: ["description", "customFields"],
  },
  {
    table: "ServiceLevelObjectiveBurnRateRule",
    columns: [
      "alertDescriptionTemplate",
      "alertRemediationNotes",
      "incidentDescriptionTemplate",
      "incidentRemediationNotes",
    ],
  },
  { table: "StatusPage", columns: ["overviewPageDescription", "customFields"] },
  { table: "StatusPageAnnouncement", columns: ["description"] },
  { table: "StatusPageAnnouncementTemplate", columns: ["description"] },
  { table: "StatusPageGroup", columns: ["description"] },
  { table: "StatusPageResource", columns: ["displayDescription"] },
  { table: "StatusPageSubscriber", columns: ["internalNote"] },
  { table: "Team", columns: ["customFields"] },
];

// The inline image address in markdown, as InlineImageAccessTokenSync reads it.
export const INLINE_IMAGE_TOKEN_PATTERN: string =
  "/file/image/access-token/([a-fA-F0-9]+)";

type GetMarkdownImageReferenceSqlFunction = (
  reference: MarkdownImageReference,
) => string;

/*
 * Every inline image one table's markdown shows, with the project of its
 * record: the table is read once, its columns side by side as text.
 */
export const getMarkdownImageReferenceSql: GetMarkdownImageReferenceSqlFunction =
  (reference: MarkdownImageReference): string => {
    const text: string = `concat_ws(' ', ${reference.columns
      .map((column: string): string => {
        return `"${column}"::text`;
      })
      .join(", ")})`;

    return `SELECT "file"."_id" AS "fileId", "markdown"."projectId" AS "projectId" FROM (SELECT "projectId", (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS "token" FROM "${reference.table}" WHERE ${text} LIKE '%/file/image/access-token/%') AS "markdown" INNER JOIN "File" AS "file" ON "file"."imageAccessToken" = "markdown"."token"`;
  };

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
export const BACKFILL_FILE_PROJECT_SQL: string = `UPDATE "File" AS "file" SET "projectId" = "owner"."projectId" FROM (SELECT "reference"."fileId" AS "fileId", MIN("reference"."projectId"::text)::uuid AS "projectId" FROM (${[
  ...FILE_PROJECT_REFERENCES.map(getFileProjectReferenceSql),
  ...MARKDOWN_IMAGE_REFERENCES.map(getMarkdownImageReferenceSql),
].join(
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
