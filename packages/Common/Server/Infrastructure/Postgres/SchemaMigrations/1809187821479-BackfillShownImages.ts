import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The records written before ShownImage existed, read into it once
 * (#11478).
 *
 * An inline image's address, /file/image/access-token/<token>, now opens a
 * private image only for a person who may read a record of its project
 * that shows it (FileViewerAccess), and the image route finds those records
 * in ShownImage, which DatabaseService fills as records are written
 * (Server/Utils/File/ShownImages). This fills it for every record already
 * there, so an image keeps showing to the people who may read the record
 * it is in:
 *
 *   - each table whose records can show images when this was written - its
 *     Markdown columns, the Markdown it keeps in JSON (a monitor's criteria,
 *     a playbook's steps) and its custom fields - but the feeds and the
 *     state and status timelines: OneUptime writes most of them itself, and
 *     they are the largest tables (BackfillFileOwners1797900000000 leaves
 *     them out for the same reason). An image a feed entry copied from a
 *     note is found through the note;
 *   - each image is a file of the record's own project, not deleted, that
 *     the record's text names by its address: a token of another project,
 *     of a deleted file, or of no file names nothing;
 *   - records not deleted.
 *
 * One statement: each table is read once, its columns side by side as one
 * text, and only its rows that hold an image address are matched. Writing a
 * row twice is nothing (ON CONFLICT DO NOTHING), so a write that recorded a
 * row while this ran is kept as it is.
 *
 * Only a server of this release records new rows: a record that a server
 * of the release before writes while this one rolls out shows a new image
 * only to its uploader until the record is saved again.
 *
 * down() removes every row: the table goes with AddShownImages1809187821478.
 */

// A table whose records show images, and the columns they show them in.
export interface ShownImageSource {
  table: string;
  columns: Array<string>;
  // The column naming the record's project: projectId but on Project.
  tenantColumn?: string | undefined;
}

export const SHOWN_IMAGE_SOURCES: Array<ShownImageSource> = [
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
  { table: "AutoRemediationRule", columns: ["aiContext"] },
  { table: "DataAsset", columns: ["description"] },
  { table: "DataPipeline", columns: ["description"] },
  {
    table: "DataSecurityAiProposal",
    columns: [
      "changeMarkdown",
      "reasonMarkdown",
      "proofMarkdown",
      "undoMarkdown",
    ],
  },
  { table: "Form", columns: ["description", "successMessage"] },
  {
    table: "Incident",
    columns: [
      "description",
      "rootCause",
      "postmortemNote",
      "remediationNotes",
      "customFields",
    ],
  },
  {
    table: "IncidentEpisode",
    columns: ["description", "rootCause", "remediationNotes", "postmortemNote"],
  },
  { table: "IncidentEpisodeInternalNote", columns: ["note"] },
  { table: "IncidentEpisodePublicNote", columns: ["note", "pendingNote"] },
  { table: "IncidentInternalNote", columns: ["note"] },
  { table: "IncidentNoteTemplate", columns: ["note"] },
  { table: "IncidentPostmortemActionItem", columns: ["description"] },
  { table: "IncidentPostmortemTemplate", columns: ["postmortemNote"] },
  { table: "IncidentPublicNote", columns: ["note", "pendingNote"] },
  {
    table: "IncidentSlaRule",
    columns: ["internalNoteReminderTemplate", "publicNoteReminderTemplate"],
  },
  { table: "IncidentTemplate", columns: ["description", "customFields"] },
  { table: "InventoryItem", columns: ["customFields"] },
  { table: "Monitor", columns: ["monitorSteps", "customFields"] },
  { table: "MonitorTemplate", columns: ["monitorSteps", "customFields"] },
  { table: "OnCallDutyPolicy", columns: ["customFields"] },
  { table: "Project", columns: ["aiContext"], tenantColumn: "_id" },
  { table: "ProjectUserProfile", columns: ["customFields"] },
  { table: "ScheduledMaintenance", columns: ["description", "customFields"] },
  { table: "ScheduledMaintenanceInternalNote", columns: ["note"] },
  { table: "ScheduledMaintenanceNoteTemplate", columns: ["note"] },
  { table: "ScheduledMaintenancePublicNote", columns: ["note", "pendingNote"] },
  {
    table: "ScheduledMaintenanceTemplate",
    columns: ["description", "customFields"],
  },
  {
    table: "SecurityCase",
    columns: ["description", "closingNote", "aiTriageReport", "customFields"],
  },
  { table: "SecurityCaseNote", columns: ["note"] },
  { table: "SecurityCaseNoteTemplate", columns: ["note"] },
  { table: "SecurityDetection", columns: ["description"] },
  { table: "SecurityPlaybook", columns: ["steps"] },
  {
    table: "ServiceLevelObjectiveBurnRateRule",
    columns: [
      "alertDescriptionTemplate",
      "alertRemediationNotes",
      "incidentDescriptionTemplate",
      "incidentRemediationNotes",
    ],
  },
  {
    table: "ServiceLevelObjectiveErrorBudgetPolicyTier",
    columns: [
      "whatWeDo",
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

// An inline image's address, capturing its token.
export const SHOWN_IMAGE_TOKEN_PATTERN: string =
  "/file/image/access-token/([a-fA-F0-9]+)";

type GetShownImageSourceSqlFunction = (source: ShownImageSource) => string;

/*
 * Every image address one table's records hold, with the record and its
 * project: the table read once, its columns side by side as text.
 */
export const getShownImageSourceSql: GetShownImageSourceSqlFunction = (
  source: ShownImageSource,
): string => {
  const text: string = `concat_ws(' ', ${source.columns
    .map((column: string): string => {
      return `"${column}"::text`;
    })
    .join(", ")})`;

  return `SELECT "${source.tenantColumn || "projectId"}" AS "projectId", '${source.table}'::text AS "recordTableName", "_id" AS "recordId", (regexp_matches(${text}, '${SHOWN_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS "token" FROM "${source.table}" WHERE "deletedAt" IS NULL AND ${text} LIKE '%/file/image/access-token/%'`;
};

/*
 * Each record and each image of its own project it shows, once: the images
 * named by a token that a file of the record's project has, not deleted.
 */
export const BACKFILL_SHOWN_IMAGES_SQL: string = `INSERT INTO "ShownImage" ("projectId", "fileId", "recordTableName", "recordId", "version") SELECT DISTINCT "shown"."projectId", "file"."_id", "shown"."recordTableName", "shown"."recordId", 1 FROM (${SHOWN_IMAGE_SOURCES.map(
  getShownImageSourceSql,
).join(
  " UNION ALL ",
)}) AS "shown" INNER JOIN "File" AS "file" ON "file"."imageAccessToken" = "shown"."token" AND "file"."projectId" = "shown"."projectId" AND "file"."deletedAt" IS NULL WHERE "shown"."projectId" IS NOT NULL ON CONFLICT ("fileId", "recordTableName", "recordId") DO NOTHING`;

export class BackfillShownImages1809187821479 implements MigrationInterface {
  public name: string = "BackfillShownImages1809187821479";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(BACKFILL_SHOWN_IMAGES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "ShownImage"`);
  }
}
