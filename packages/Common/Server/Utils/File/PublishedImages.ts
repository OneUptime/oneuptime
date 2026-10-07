import QueryHelper from "../../Types/Database/QueryHelper";
import File from "../../../Models/DatabaseModels/File";
import OneUptimeDate from "../../../Types/Date";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import FileOwnership, { normalizeFileId } from "./FileOwnership";

/*
 * The images a record shows to everyone, and for how long.
 *
 * What people write with the markdown editor carries its images by address,
 * /file/image/access-token/<token>: each image is a file of the record's
 * project, private from its upload on (FileService) and shown to the people
 * who may see it (FileViewerAccess). Some of what people write is shown to
 * everyone - on a status page, to its visitors whether they are signed in
 * or not, and in the emails its subscribers get. An image in it is public
 * exactly while the record shows it:
 *
 *   - an incident's description, while the incident is shown on status
 *     pages - Visible on Status Page on, and not private
 *     (StatusPageVisibility) - and its postmortem once it is published
 *     there too;
 *   - an episode's description, and a scheduled maintenance event's, while
 *     the episode or the event is shown on status pages (an episode, like an
 *     incident, never while it is private);
 *   - a public note of an incident, an episode or a scheduled maintenance
 *     event while that record is shown on status pages - a note is shown on
 *     its record's page, never without it (shownUnder);
 *   - an announcement's description from the time it is shown from (Start
 *     Showing Announcement At) on, ended or not - the page lists an ended
 *     one under its past announcements, and its own link keeps working - but
 *     never before (shownFrom): an announcement scheduled for later shows
 *     nothing yet, and its images stay private until then;
 *   - a status page's overview description, and the descriptions of its
 *     groups and resources, always;
 *   - a form's description and thank-you message, on its public page,
 *     while the form accepts submissions.
 *
 * A status page that asks its visitors to sign in shows the same, to people
 * who are not members of the project; the image routes can serve them only a
 * public image, so its images are public by their unguessable address while
 * it shows them.
 *
 * DatabaseService keeps this on every write of these records, whoever makes
 * it - the dashboard, the API, Terraform, a workflow, OneUptime itself: a
 * record created or edited to show an image makes it public (afterCreate,
 * afterUpdate), and a record that stops showing it - its switch turned off,
 * the record it is shown under hidden, an announcement moved to a later
 * time, the image edited out, the record deleted, or the record it belongs
 * to deleted with it (CASCADES), or its project deleted - makes it private
 * again (afterUpdate, afterDelete),
 * unless another record of the project still shows it: an image is copied
 * along with the markdown it sits in, so a template's image can be in many
 * incidents at once. An update decides each row by what its own write
 * stored (DatabaseService hands back the row as written), and an image it
 * no longer shows is made private only once the database says nothing of
 * the project shows it (findStillShown) - so a write read before another
 * landed never leaves an image public that nothing shows.
 *
 * Only an image of the record's own project is ever made public or private
 * by it: a record of one project never opens another project's image, nor
 * closes one under the status page that shows it. Making images public or
 * private is best-effort: it never fails the write it follows.
 *
 * A record that starts showing an image with no write at that moment - an
 * announcement whose time to be shown has come - makes it public then, on
 * the first request for it that the image route would otherwise refuse
 * (publishWhenShown): one statement that makes the image public only if,
 * as the database holds it then, a record of the image's own project shows
 * it. Images of announcements scheduled before this rule were made private
 * once (HideImagesOfScheduledAnnouncements, HIDE_NOT_YET_SHOWN_IMAGES_SQL).
 *
 * A file is public for nothing else but a probe's or an AI agent's icon
 * (FileService.makeStoredIconsPublic), and the images of what goes out to
 * everyone without a page of its own (KEPT_MARKDOWN). Rows a delete takes
 * with it unseen are read before it (CASCADES), and a deleted project's
 * files are made private (PROJECT_FILES_PRIVATE_SQL). Files made public
 * before this rule existed were set to it once
 * (SetFileVisibilityFromPublishedRecords, a data migration that runs
 * PUBLISH_SHOWN_IMAGES_SQL and HIDE_UNSHOWN_FILES_SQL), and so were images
 * made public by a private record (HideImagesOfPrivateIncidents,
 * HIDE_PRIVATE_RECORD_IMAGES_SQL) or by a public note of a record no status
 * page shows (HideImagesOfHiddenRecordNotes, HIDE_HIDDEN_RECORD_IMAGES_SQL).
 */

// The address of an inline image in markdown, and the token it carries.
const ACCESS_TOKEN_REGEX: RegExp =
  /\/file\/image\/access-token\/([a-fA-F0-9]+)/g;

// What a token may hold: the hex FileService generates.
const TOKEN_REGEX: RegExp = /^[a-fA-F0-9]+$/;

// The same address as a Postgres regular expression, capturing the token.
export const INLINE_IMAGE_TOKEN_PATTERN: string =
  "/file/image/access-token/([a-fA-F0-9]+)";

/*
 * An image addressed by its file's id, /file/image/<id>, as markdown written
 * by hand before images had tokens may hold one: kept public by the data
 * migration when a published record shows it, so nothing it shows breaks.
 */
export const IMAGE_BY_ID_PATTERN: string =
  "/file/image/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";

// Every distinct image token in a piece of markdown, in the order written.
export const extractImageAccessTokens: (
  markdown: string | null | undefined,
) => Array<string> = (markdown: string | null | undefined): Array<string> => {
  if (!markdown || typeof markdown !== "string") {
    return [];
  }

  const tokens: Set<string> = new Set<string>();

  for (const match of markdown.matchAll(ACCESS_TOKEN_REGEX)) {
    if (match[1]) {
      tokens.add(match[1]);
    }
  }

  return Array.from(tokens);
};

// One kind of record that shows what people write to everyone.
export interface PublishedMarkdown {
  // The record's table.
  tableName: string;
  // The markdown it shows.
  markdownColumns: Array<string>;
  /*
   * The record's switches that must all be on for it to show that markdown,
   * as the page reads them; none for a record that always does.
   */
  shownWhen: Array<string>;
  /*
   * The record's switches any one of which, on, hides that markdown however
   * the switches above are set: Private, on an incident or an episode
   * (StatusPageVisibility). A switch never set (null) is off, as the status
   * page reads it.
   */
  hiddenWhen?: Array<string> | undefined;
  /*
   * The record this one is shown under, for a record a status page shows
   * only on that record's page: a public note, under its incident, episode
   * or scheduled maintenance event. Its markdown is shown only while that
   * record is shown too, whatever this record's own switches say.
   */
  shownUnder?: PublishedParent | undefined;
  /*
   * The record's time its markdown is shown from (a date column), as the
   * page reads it: before that time the record shows none of it, whatever
   * its switches say - an announcement scheduled for later. None for a
   * record shown whatever the time.
   */
  shownFrom?: string | undefined;
  // Where everyone sees it.
  shownOn: "statusPage" | "formPage" | "notifications";
}

// The record a published record is shown under, and when it is shown.
export interface PublishedParent {
  // Its table.
  tableName: string;
  // The column of the record shown under it that names it.
  foreignKey: string;
  // Its switches that must all be on for it to be shown.
  shownWhen: Array<string>;
  // Its switches any one of which, on, hides it (null is off).
  hiddenWhen?: Array<string> | undefined;
}

// An incident is shown while visible and not private (StatusPageVisibility).
const INCIDENT_PARENT: Omit<PublishedParent, "foreignKey"> = {
  tableName: "Incident",
  shownWhen: ["isVisibleOnStatusPage"],
  hiddenWhen: ["isPrivate"],
};

// So is an episode.
const EPISODE_PARENT: Omit<PublishedParent, "foreignKey"> = {
  tableName: "IncidentEpisode",
  shownWhen: ["isVisibleOnStatusPage"],
  hiddenWhen: ["isPrivate"],
};

// A scheduled maintenance event, while visible: it has no Private switch.
const SCHEDULED_MAINTENANCE_PARENT: Omit<PublishedParent, "foreignKey"> = {
  tableName: "ScheduledMaintenance",
  shownWhen: ["isVisibleOnStatusPage"],
};

export const PUBLISHED_MARKDOWN: ReadonlyArray<PublishedMarkdown> = [
  {
    tableName: "Incident",
    markdownColumns: ["description"],
    shownWhen: ["isVisibleOnStatusPage"],
    hiddenWhen: ["isPrivate"],
    shownOn: "statusPage",
  },
  {
    tableName: "Incident",
    markdownColumns: ["postmortemNote"],
    shownWhen: ["isVisibleOnStatusPage", "showPostmortemOnStatusPage"],
    hiddenWhen: ["isPrivate"],
    shownOn: "statusPage",
  },
  {
    tableName: "IncidentPublicNote",
    markdownColumns: ["note"],
    shownWhen: [],
    shownUnder: { ...INCIDENT_PARENT, foreignKey: "incidentId" },
    shownOn: "statusPage",
  },
  {
    tableName: "IncidentEpisode",
    markdownColumns: ["description"],
    shownWhen: ["isVisibleOnStatusPage"],
    hiddenWhen: ["isPrivate"],
    shownOn: "statusPage",
  },
  {
    tableName: "IncidentEpisodePublicNote",
    markdownColumns: ["note"],
    shownWhen: [],
    shownUnder: { ...EPISODE_PARENT, foreignKey: "incidentEpisodeId" },
    shownOn: "statusPage",
  },
  {
    tableName: "ScheduledMaintenance",
    markdownColumns: ["description"],
    shownWhen: ["isVisibleOnStatusPage"],
    shownOn: "statusPage",
  },
  {
    tableName: "ScheduledMaintenancePublicNote",
    markdownColumns: ["note"],
    shownWhen: [],
    shownUnder: {
      ...SCHEDULED_MAINTENANCE_PARENT,
      foreignKey: "scheduledMaintenanceId",
    },
    shownOn: "statusPage",
  },
  {
    tableName: "StatusPageAnnouncement",
    markdownColumns: ["description"],
    shownWhen: [],
    shownFrom: "showAnnouncementAt",
    shownOn: "statusPage",
  },
  {
    tableName: "StatusPage",
    markdownColumns: ["overviewPageDescription"],
    shownWhen: [],
    shownOn: "statusPage",
  },
  {
    tableName: "StatusPageGroup",
    markdownColumns: ["description"],
    shownWhen: [],
    shownOn: "statusPage",
  },
  {
    tableName: "StatusPageResource",
    markdownColumns: ["displayDescription"],
    shownWhen: [],
    shownOn: "statusPage",
  },
  {
    tableName: "Form",
    markdownColumns: ["description", "successMessage"],
    shownWhen: ["isEnabled"],
    shownOn: "formPage",
  },
];

/*
 * Markdown that goes out to everyone without being kept in step here: an
 * incident's custom fields, whose rich text values are sent in subscriber
 * notifications - of an incident shown on status pages - and whose images
 * are made public as they are sent (IncidentTemplateVariableBuilder). An
 * image they show is never made private here while the incident is shown,
 * by an edit elsewhere or by the data migration.
 */
export const KEPT_MARKDOWN: ReadonlyArray<PublishedMarkdown> = [
  {
    tableName: "Incident",
    markdownColumns: ["customFields"],
    shownWhen: ["isVisibleOnStatusPage"],
    hiddenWhen: ["isPrivate"],
    shownOn: "notifications",
  },
];

/*
 * Rows of a published table the database deletes along with a row of
 * another table (a foreign key ON DELETE CASCADE): the notes of a deleted
 * incident, the groups and resources of a deleted status page. DatabaseService
 * never sees those rows go, so it reads them before it deletes their parent.
 * A deleted project's files are all made private instead
 * (PROJECT_FILES_PRIVATE_SQL). Held to the models' own relations by a test.
 */
export interface PublishedCascade {
  // The table whose deleted rows take the published rows with them.
  parentTable: string;
  // The published table.
  tableName: string;
  // Its column naming the parent row.
  foreignKey: string;
}

export const CASCADES: ReadonlyArray<PublishedCascade> = [
  {
    parentTable: "Incident",
    tableName: "IncidentPublicNote",
    foreignKey: "incidentId",
  },
  {
    parentTable: "IncidentEpisode",
    tableName: "IncidentEpisodePublicNote",
    foreignKey: "incidentEpisodeId",
  },
  {
    parentTable: "ScheduledMaintenance",
    tableName: "ScheduledMaintenancePublicNote",
    foreignKey: "scheduledMaintenanceId",
  },
  { parentTable: "File", tableName: "StatusPage", foreignKey: "logoFileId" },
  {
    parentTable: "File",
    tableName: "StatusPage",
    foreignKey: "faviconFileId",
  },
  {
    parentTable: "File",
    tableName: "StatusPage",
    foreignKey: "coverImageFileId",
  },
  {
    parentTable: "StatusPage",
    tableName: "StatusPageGroup",
    foreignKey: "statusPageId",
  },
  {
    parentTable: "StatusPageGroup",
    tableName: "StatusPageGroup",
    foreignKey: "parentStatusPageGroupId",
  },
  {
    parentTable: "StatusPage",
    tableName: "StatusPageResource",
    foreignKey: "statusPageId",
  },
  {
    parentTable: "StatusPageGroup",
    tableName: "StatusPageResource",
    foreignKey: "statusPageGroupId",
  },
  {
    parentTable: "Monitor",
    tableName: "StatusPageResource",
    foreignKey: "monitorId",
  },
  {
    parentTable: "MonitorGroup",
    tableName: "StatusPageResource",
    foreignKey: "monitorGroupId",
  },
  {
    parentTable: "StatusPageMonitorRule",
    tableName: "StatusPageResource",
    foreignKey: "statusPageMonitorRuleId",
  },
  // A page's or a group's monitor rules go with it, and their resources too.
  {
    parentTable: "StatusPage",
    tableName: "StatusPageMonitorRule",
    foreignKey: "statusPageId",
  },
  {
    parentTable: "StatusPageGroup",
    tableName: "StatusPageMonitorRule",
    foreignKey: "statusPageGroupId",
  },
];

// The table whose deleted rows take every file of theirs out of view.
const PROJECT_TABLE_NAME: string = "Project";

// A row as a read hands it over: its columns by name.
type Row = Record<string, unknown>;

// A published row a delete takes with it, as it was.
export interface CascadedRow {
  tableName: string;
  row: Row;
}

// Runs one statement: a repository's manager, or a query runner.
export type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

// What changes an image's visibility: FileService.
interface FileWriter {
  findBy: (data: unknown) => Promise<Array<File>>;
  updateBy: (data: unknown) => Promise<number>;
  getRepository: () => { manager: { query: QueryFunction } };
}

// The images to make public and private, per project.
type ImageChanges = Map<
  string,
  { publish: Set<string>; unpublish: Set<string> }
>;

const quote: (name: string) => string = (name: string): string => {
  return `"${name}"`;
};

// A record's markdown columns as one text, for a single scan of each row.
const getTextSql: (source: PublishedMarkdown) => string = (
  source: PublishedMarkdown,
): string => {
  return `concat_ws(' ', ${source.markdownColumns
    .map((column: string): string => {
      return `${quote(column)}::text`;
    })
    .join(", ")})`;
};

// The alias a record's parent is read under, inside its source's query.
const PARENT_ALIAS: string = "parentRecord";

/*
 * Whether the record a row is shown under is shown (shownUnder): the row's
 * parent, of the row's own project, not deleted, every switch of it on and
 * none that hides it on. `rowTable` is how the row's table is named in the
 * query around it.
 */
const getParentShownSql: (
  parent: PublishedParent,
  rowTable: string,
) => string = (parent: PublishedParent, rowTable: string): string => {
  const alias: string = quote(PARENT_ALIAS);

  return `EXISTS (SELECT 1 FROM ${quote(parent.tableName)} AS ${alias} WHERE ${[
    `${alias}.${quote("_id")} = ${rowTable}.${quote(parent.foreignKey)}`,
    `${alias}.${quote("projectId")} = ${rowTable}.${quote("projectId")}`,
    `${alias}.${quote("deletedAt")} IS NULL`,
    ...parent.shownWhen.map((column: string): string => {
      return `${alias}.${quote(column)} = true`;
    }),
    ...(parent.hiddenWhen || []).map((column: string): string => {
      return `${alias}.${quote(column)} IS NOT TRUE`;
    }),
  ].join(" AND ")})`;
};

/*
 * What the one-off statements of the data migrations take as now: the
 * database's own time. The statements OneUptime runs as it works are asked
 * with the time of the request instead (a parameter), so they decide as the
 * code around them does.
 */
const DATABASE_NOW_SQL: string = "now()";

/*
 * The rows of a source that show their markdown: not deleted, every switch
 * on, and no switch that hides it on (NULL is off, as for isPrivate) - and,
 * for a record shown under another, that record shown too; for a record
 * shown from a time (shownFrom), that time come by `now`.
 */
const getShownWhereSql: (source: PublishedMarkdown, now: string) => string = (
  source: PublishedMarkdown,
  now: string,
): string => {
  return [
    `${quote("deletedAt")} IS NULL`,
    ...source.shownWhen.map((column: string): string => {
      return `${quote(column)} = true`;
    }),
    ...(source.hiddenWhen || []).map((column: string): string => {
      return `${quote(column)} IS NOT TRUE`;
    }),
    ...(source.shownUnder
      ? [getParentShownSql(source.shownUnder, quote(source.tableName))]
      : []),
    ...(source.shownFrom ? [`${quote(source.shownFrom)} <= ${now}`] : []),
  ].join(" AND ");
};

/*
 * Every image token the published records show, with the project of the
 * record showing it - one scan of each table, its markdown read as one text.
 */
const getShownTokensSql: (
  sources: ReadonlyArray<PublishedMarkdown>,
) => string = (sources: ReadonlyArray<PublishedMarkdown>): string => {
  return sources
    .map((source: PublishedMarkdown): string => {
      const text: string = getTextSql(source);

      return `SELECT ${quote("projectId")} AS ${quote("projectId")}, (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${getShownWhereSql(source, DATABASE_NOW_SQL)} AND ${text} LIKE '%/file/image/access-token/%'`;
    })
    .join(" UNION ALL ");
};

// Every file id the published records show by its id address.
const getShownFileIdsSql: (
  sources: ReadonlyArray<PublishedMarkdown>,
) => string = (sources: ReadonlyArray<PublishedMarkdown>): string => {
  return sources
    .map((source: PublishedMarkdown): string => {
      const text: string = getTextSql(source);

      return `SELECT lower((regexp_matches(${text}, '${IMAGE_BY_ID_PATTERN}', 'g'))[1]) AS ${quote("fileId")} FROM ${quote(source.tableName)} WHERE ${getShownWhereSql(source, DATABASE_NOW_SQL)} AND ${text} LIKE '%/file/image/%'`;
    })
    .join(" UNION ALL ");
};

/*
 * Which of some images a record of a project still shows to everyone, or
 * sends out: $1 is the project, $2 the images' addresses as LIKE patterns,
 * $3 their tokens, $4 the time it is now. One statement for every image a
 * write stopped showing.
 */
export const STILL_SHOWN_SQL: string = `SELECT DISTINCT ${quote("shown")}.${quote("token")} AS ${quote("token")} FROM (${[
  ...PUBLISHED_MARKDOWN,
  ...KEPT_MARKDOWN,
]
  .map((source: PublishedMarkdown): string => {
    const text: string = getTextSql(source);

    return `SELECT (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${quote("projectId")} = $1 AND ${getShownWhereSql(source, "$4::timestamptz")} AND ${text} LIKE ANY($2)`;
  })
  .join(
    " UNION ALL ",
  )}) AS ${quote("shown")} WHERE ${quote("shown")}.${quote("token")} = ANY($3)`;

/*
 * The records that start showing their markdown with no write at that
 * moment: those shown from a time (shownFrom) - announcements.
 */
export const SOURCES_SHOWN_FROM_A_TIME: ReadonlyArray<PublishedMarkdown> =
  PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
    return Boolean(source.shownFrom);
  });

/*
 * An image a record shown from a time shows now becomes public: $1 is the
 * file, $2 its project, $3 its token, $4 the time it is now, $5 its address
 * as a LIKE pattern. Only a not deleted file of that project, and only while
 * a record of the same project shows it - as the database holds that record
 * when the file is written. Hands back the file when a record shows it now,
 * made public by this statement or already public - by a request for it
 * that came at the same moment (publishWhenShown).
 */
export const PUBLISH_WHEN_SHOWN_SQL: string = `UPDATE ${quote("File")} SET ${quote("isPublic")} = true WHERE ${quote("_id")} = $1 AND ${quote("projectId")} = $2 AND ${quote("imageAccessToken")} = $3 AND ${quote("deletedAt")} IS NULL AND EXISTS (SELECT 1 FROM (${SOURCES_SHOWN_FROM_A_TIME.map(
  (source: PublishedMarkdown): string => {
    const text: string = getTextSql(source);

    return `SELECT (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${quote("projectId")} = $2 AND ${getShownWhereSql(source, "$4::timestamptz")} AND ${text} LIKE $5`;
  },
).join(
  " UNION ALL ",
)}) AS ${quote("shown")} WHERE ${quote("shown")}.${quote("token")} = $3) RETURNING ${quote("_id")}`;

/*
 * A probe's or an AI agent's icon is public for as long as one uses it,
 * whichever project it was uploaded in (FileService.makeStoredIconsPublic).
 */
const getNotAnIconSql: (fileAlias: string) => string = (
  fileAlias: string,
): string => {
  return ["Probe", "AIAgent"]
    .map((table: string): string => {
      return `NOT EXISTS (SELECT 1 FROM ${quote(table)} WHERE ${quote(table)}.${quote("iconFileId")} = ${quote(fileAlias)}.${quote("_id")})`;
    })
    .join(" AND ");
};

/*
 * A deleted project's files are nobody's to show any more, but for an icon
 * something outside the project still uses: $1 is the projects.
 */
export const PROJECT_FILES_PRIVATE_SQL: string = `UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = false WHERE ${quote("file")}.${quote("isPublic")} = true AND ${quote("file")}.${quote("projectId")} = ANY($1::uuid[]) AND ${getNotAnIconSql("file")}`;

/*
 * Once, for files from before this rule: every image a published record of
 * its own project shows becomes public - a public note posted before notes
 * made their images public, an incident's description on a status page.
 */
export const PUBLISH_SHOWN_IMAGES_SQL: string = `UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = true FROM (${getShownTokensSql(
  PUBLISHED_MARKDOWN,
)}) AS ${quote("shown")} WHERE ${quote("file")}.${quote("imageAccessToken")} = ${quote("shown")}.${quote("token")} AND ${quote("file")}.${quote("projectId")} = ${quote("shown")}.${quote("projectId")} AND ${quote("file")}.${quote("isPublic")} = false AND ${quote("file")}.${quote("deletedAt")} IS NULL`;

/*
 * Once, for files from before this rule: a public file nothing published
 * shows becomes private - a file uploaded through the API while uploads
 * still started public. Kept public: a probe's or an AI agent's icon, and
 * every image a published record of any project shows, by its token or by
 * its id (nothing a status page shows today breaks), or that markdown sent
 * out to everyone shows (KEPT_MARKDOWN).
 */
export const HIDE_UNSHOWN_FILES_SQL: string = `WITH ${quote("shownToken")} AS (SELECT ${quote("token")} FROM (${getShownTokensSql(
  [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN],
)}) AS ${quote("tokens")}), ${quote("shownId")} AS (SELECT ${quote("fileId")} FROM (${getShownFileIdsSql(
  [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN],
)}) AS ${quote("ids")}) UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = false WHERE ${quote("file")}.${quote("isPublic")} = true AND ${getNotAnIconSql("file")} AND NOT EXISTS (SELECT 1 FROM ${quote("shownToken")} WHERE ${quote("shownToken")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownId")} WHERE ${quote("shownId")}.${quote("fileId")} = ${quote("file")}.${quote("_id")}::text)`;

/*
 * The rows of a source that hold markdown they do not show, not deleted: a
 * record a switch hides (hiddenWhen: a private incident or episode) - and,
 * with `underHidden`, a record shown under one that is not shown
 * (shownUnder: a public note of a hidden or private incident, episode or
 * scheduled maintenance event). Null for a source neither can hide.
 */
const getHiddenWhereSql: (
  source: PublishedMarkdown,
  underHidden: boolean,
) => string | null = (
  source: PublishedMarkdown,
  underHidden: boolean,
): string | null => {
  const isHidden: Array<string> = [];

  if ((source.hiddenWhen || []).length > 0) {
    isHidden.push(
      (source.hiddenWhen || [])
        .map((column: string): string => {
          return `${quote(column)} IS TRUE`;
        })
        .join(" OR "),
    );
  }

  if (underHidden && source.shownUnder) {
    isHidden.push(
      `NOT ${getParentShownSql(source.shownUnder, quote(source.tableName))}`,
    );
  }

  if (isHidden.length === 0) {
    return null;
  }

  return `${quote("deletedAt")} IS NULL AND (${isHidden.join(" OR ")})`;
};

/*
 * Every image a hidden row (getHiddenWhereSql) holds in the markdown it
 * would otherwise show, with the row's project: by its token, or (byId) by
 * its file's id address (/file/image/<id>, markdown written by hand).
 */
const getHiddenImagesSql: (
  sources: ReadonlyArray<PublishedMarkdown>,
  underHidden: boolean,
  byId: boolean,
) => string = (
  sources: ReadonlyArray<PublishedMarkdown>,
  underHidden: boolean,
  byId: boolean,
): string => {
  const selects: Array<string> = [];

  for (const source of sources) {
    const where: string | null = getHiddenWhereSql(source, underHidden);

    if (!where) {
      continue;
    }

    const text: string = getTextSql(source);

    selects.push(
      byId
        ? `SELECT ${quote("projectId")} AS ${quote("projectId")}, lower((regexp_matches(${text}, '${IMAGE_BY_ID_PATTERN}', 'g'))[1]) AS ${quote("fileId")} FROM ${quote(source.tableName)} WHERE ${where} AND ${text} LIKE '%/file/image/%'`
        : `SELECT ${quote("projectId")} AS ${quote("projectId")}, (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${where} AND ${text} LIKE '%/file/image/access-token/%'`,
    );
  }

  return selects.join(" UNION ALL ");
};

// A file of the record's own project, or of no project, as the record holds it.
const getSameProjectOrNoneSql: (alias: string) => string = (
  alias: string,
): string => {
  return `(${quote("file")}.${quote("projectId")} IS NULL OR ${quote(alias)}.${quote("projectId")} = ${quote("file")}.${quote("projectId")})`;
};

/*
 * Every public image a hidden row holds (getHiddenWhereSql), of the row's
 * own project or of no project (a file from before File.projectId was
 * stamped), by its token or by its id, becomes private - unless a published
 * record of any project still shows it, by its token or by its id, or it is
 * an icon, exactly as HIDE_UNSHOWN_FILES_SQL keeps them. Nothing else moves,
 * and nothing is made public.
 */
const getHideHiddenImagesSql: (underHidden: boolean) => string = (
  underHidden: boolean,
): string => {
  const sources: Array<PublishedMarkdown> = [
    ...PUBLISHED_MARKDOWN,
    ...KEPT_MARKDOWN,
  ];

  return `WITH ${quote("hiddenToken")} AS (SELECT ${quote("projectId")}, ${quote("token")} FROM (${getHiddenImagesSql(
    sources,
    underHidden,
    false,
  )}) AS ${quote("hidden")}), ${quote("hiddenId")} AS (SELECT ${quote("projectId")}, ${quote("fileId")} FROM (${getHiddenImagesSql(
    sources,
    underHidden,
    true,
  )}) AS ${quote("hiddenIds")}), ${quote("shownToken")} AS (SELECT ${quote("token")} FROM (${getShownTokensSql(
    sources,
  )}) AS ${quote("tokens")}), ${quote("shownId")} AS (SELECT ${quote("fileId")} FROM (${getShownFileIdsSql(
    sources,
  )}) AS ${quote("ids")}) UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = false WHERE ${quote("file")}.${quote("isPublic")} = true AND ${getNotAnIconSql("file")} AND (EXISTS (SELECT 1 FROM ${quote("hiddenToken")} WHERE ${quote("hiddenToken")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")} AND ${getSameProjectOrNoneSql("hiddenToken")}) OR EXISTS (SELECT 1 FROM ${quote("hiddenId")} WHERE ${quote("hiddenId")}.${quote("fileId")} = ${quote("file")}.${quote("_id")}::text AND ${getSameProjectOrNoneSql("hiddenId")})) AND NOT EXISTS (SELECT 1 FROM ${quote("shownToken")} WHERE ${quote("shownToken")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownId")} WHERE ${quote("shownId")}.${quote("fileId")} = ${quote("file")}.${quote("_id")}::text)`;
};

/*
 * Once, for images made public before a private record stopped showing
 * them: an incident or an episode stored private with Visible on Status Page
 * still on showed its description, postmortem and custom fields as published
 * then, so their images were made public, or kept public when addressed by
 * the file's id. Each such image becomes private, as getHideHiddenImagesSql
 * says. (HideImagesOfPrivateIncidents runs it.)
 */
export const HIDE_PRIVATE_RECORD_IMAGES_SQL: string =
  getHideHiddenImagesSql(false);

/*
 * Once, for images made public before public notes followed the record they
 * are shown under: a public note made its images public whatever its
 * incident, episode or scheduled maintenance event showed, and kept a
 * private record's own images public when it held them too. Each image a
 * private incident or episode holds, or a public note of a record that is
 * not shown (hidden, or private), becomes private, as getHideHiddenImagesSql
 * says. (HideImagesOfHiddenRecordNotes runs it.)
 */
export const HIDE_HIDDEN_RECORD_IMAGES_SQL: string =
  getHideHiddenImagesSql(true);

/*
 * Once, for images made public before a record shown from a time kept them
 * private until then: an announcement made its images public when it was
 * created, scheduled for later or not. Every public image an announcement
 * whose time to be shown has not come (shownFrom after now) holds by its
 * token, of the announcement's own project, becomes private - unless a
 * published record of any project shows it now, by its token or by its id,
 * or it is an icon, as HIDE_UNSHOWN_FILES_SQL keeps them. The first request
 * for it once the announcement is shown makes it public again
 * (publishWhenShown), which only an image addressed by its token, of the
 * announcement's own project, can be - so nothing else is made private:
 * not an image addressed by its file's id, nor a file of no project. Never
 * makes a file public. (HideImagesOfScheduledAnnouncements runs it.)
 */
export const HIDE_NOT_YET_SHOWN_IMAGES_SQL: string = `WITH ${quote("notYetShown")} AS (SELECT ${quote("projectId")}, ${quote("token")} FROM (${SOURCES_SHOWN_FROM_A_TIME.map(
  (source: PublishedMarkdown): string => {
    const text: string = getTextSql(source);

    return `SELECT ${quote("projectId")} AS ${quote("projectId")}, (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${quote("deletedAt")} IS NULL AND ${quote(source.shownFrom!)} > ${DATABASE_NOW_SQL} AND ${text} LIKE '%/file/image/access-token/%'`;
  },
).join(
  " UNION ALL ",
)}) AS ${quote("held")}), ${quote("shownToken")} AS (SELECT ${quote("token")} FROM (${getShownTokensSql(
  [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN],
)}) AS ${quote("tokens")}), ${quote("shownId")} AS (SELECT ${quote("fileId")} FROM (${getShownFileIdsSql(
  [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN],
)}) AS ${quote("ids")}) UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = false WHERE ${quote("file")}.${quote("isPublic")} = true AND ${getNotAnIconSql("file")} AND EXISTS (SELECT 1 FROM ${quote("notYetShown")} WHERE ${quote("notYetShown")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")} AND ${quote("notYetShown")}.${quote("projectId")} = ${quote("file")}.${quote("projectId")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownToken")} WHERE ${quote("shownToken")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownId")} WHERE ${quote("shownId")}.${quote("fileId")} = ${quote("file")}.${quote("_id")}::text)`;

// The published rows of a table a delete of its parent takes with it.
export const getCascadedRowsSql: (cascade: PublishedCascade) => string = (
  cascade: PublishedCascade,
): string => {
  const columns: Array<string> = [
    "_id",
    "projectId",
    ...PublishedImages.getColumns(cascade.tableName),
  ];

  return `SELECT ${columns
    .map((column: string): string => {
      return quote(column);
    })
    .join(", ")} FROM ${quote(cascade.tableName)} WHERE ${quote(
    cascade.foreignKey,
  )} = ANY($1::uuid[]) AND ${quote("deletedAt")} IS NULL`;
};

/*
 * Which of some records published records are shown under are shown now,
 * with each one's project: $1 is their ids.
 */
export const getShownParentsSql: (parent: PublishedParent) => string = (
  parent: PublishedParent,
): string => {
  return `SELECT ${quote("_id")}, ${quote("projectId")} FROM ${quote(parent.tableName)} WHERE ${quote("_id")} = ANY($1::uuid[]) AND ${[
    `${quote("deletedAt")} IS NULL`,
    ...parent.shownWhen.map((column: string): string => {
      return `${quote(column)} = true`;
    }),
    ...(parent.hiddenWhen || []).map((column: string): string => {
      return `${quote(column)} IS NOT TRUE`;
    }),
  ].join(" AND ")}`;
};

/*
 * The rows of a source shown under other records (shownUnder) that carry an
 * image, of those records: $1 is their ids.
 */
export const getRowsShownUnderSql: (source: PublishedMarkdown) => string = (
  source: PublishedMarkdown,
): string => {
  const foreignKey: string = source.shownUnder?.foreignKey || "";

  return `SELECT ${["_id", "projectId", foreignKey, ...source.markdownColumns]
    .map((column: string): string => {
      return quote(column);
    })
    .join(", ")} FROM ${quote(source.tableName)} WHERE ${quote(
    foreignKey,
  )} = ANY($1::uuid[]) AND ${quote("deletedAt")} IS NULL AND ${getTextSql(
    source,
  )} LIKE '%/file/image/access-token/%'`;
};

/*
 * The records some rows are shown under that are shown now, by id, each
 * with its project (readShownParents).
 */
export type ShownParents = Map<string, string>;

// A row as it was before an update, and as the update left it.
interface UpdatedRow {
  before: Row;
  after: Row;
}

export default class PublishedImages {
  // The kinds of published markdown a table has.
  public static getSources(
    tableName: string | null | undefined,
  ): Array<PublishedMarkdown> {
    return PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
      return Boolean(tableName) && source.tableName === tableName;
    });
  }

  /*
   * The kinds of published markdown shown under a table's records: the
   * public notes of an incident, an episode or a scheduled maintenance
   * event. They show their images only while the record does.
   */
  public static getSourcesShownUnder(
    tableName: string | null | undefined,
  ): Array<PublishedMarkdown> {
    return PUBLISHED_MARKDOWN.filter((source: PublishedMarkdown): boolean => {
      return Boolean(tableName) && source.shownUnder?.tableName === tableName;
    });
  }

  /*
   * The columns that decide what a table's records show to everyone: their
   * markdown, their switches, the column naming the record they are shown
   * under, and the time they are shown from. Empty for a table that shows
   * nothing.
   */
  public static getColumns(
    tableName: string | null | undefined,
  ): Array<string> {
    const columns: Set<string> = new Set<string>();

    for (const source of this.getSources(tableName)) {
      for (const column of [
        ...source.markdownColumns,
        ...source.shownWhen,
        ...(source.hiddenWhen || []),
        ...(source.shownUnder ? [source.shownUnder.foreignKey] : []),
        ...(source.shownFrom ? [source.shownFrom] : []),
      ]) {
        columns.add(column);
      }
    }

    return Array.from(columns);
  }

  // Whether a write of these columns can change what a record shows.
  public static isWrittenBy(
    tableName: string | null | undefined,
    writtenColumns: Array<string>,
  ): boolean {
    const columns: Array<string> = this.getColumns(tableName);

    return writtenColumns.some((column: string): boolean => {
      return columns.includes(column);
    });
  }

  /*
   * Whether a record shows a kind of markdown: every switch of it is on, and
   * none that hides it is (one that is neither false nor unset hides it) -
   * and, for a record shown under another (shownUnder), that record is
   * shown, of the same project: `shownParents`, the shown ones as
   * readShownParents reads them. With none read, it is not shown. A record
   * shown from a time (shownFrom) shows nothing before it (hasTimeCome).
   */
  public static isShown(
    source: PublishedMarkdown,
    row: Row,
    shownParents?: ShownParents | undefined,
    now?: Date | undefined,
  ): boolean {
    if (
      !this.areSwitchesShowing(
        { shownWhen: source.shownWhen, hiddenWhen: source.hiddenWhen },
        row,
      ) ||
      !this.hasTimeCome(source, row, now)
    ) {
      return false;
    }

    if (!source.shownUnder) {
      return true;
    }

    const parentProjectId: string | undefined = shownParents?.get(
      normalizeFileId(row[source.shownUnder.foreignKey]),
    );

    return (
      Boolean(parentProjectId) &&
      parentProjectId === normalizeFileId(row["projectId"])
    );
  }

  /*
   * Whether a record a published record is shown under is shown, by its
   * own switches as a row holds them.
   */
  public static isParentShown(parent: PublishedParent, row: Row): boolean {
    return this.areSwitchesShowing(parent, row);
  }

  /*
   * Whether the time a record shows a kind of markdown from (shownFrom) has
   * come by `now` (the current time when not given) - as the status page
   * reads it: an announcement is shown once its Start Showing Announcement
   * At is not after now, and stays shown after it ends. A time not set, or
   * not a time, has not come. A record shown whatever the time is shown.
   */
  public static hasTimeCome(
    source: PublishedMarkdown,
    row: Row,
    now?: Date | undefined,
  ): boolean {
    if (!source.shownFrom) {
      return true;
    }

    const value: unknown = row[source.shownFrom];

    if (
      !(value instanceof Date) &&
      typeof value !== "string" &&
      typeof value !== "number"
    ) {
      return false;
    }

    const shownFrom: number = new Date(value).getTime();

    return (
      Number.isFinite(shownFrom) &&
      shownFrom <= (now || OneUptimeDate.getCurrentDate()).getTime()
    );
  }

  // The image tokens a record shows to everyone.
  public static getShownTokens(
    tableName: string | null | undefined,
    row: Row | null | undefined,
    shownParents?: ShownParents | undefined,
    now?: Date | undefined,
  ): Set<string> {
    const tokens: Set<string> = new Set<string>();

    if (!row) {
      return tokens;
    }

    for (const source of this.getSources(tableName)) {
      if (!this.isShown(source, row, shownParents, now)) {
        continue;
      }

      for (const token of this.getTokensOf(source, row)) {
        tokens.add(token);
      }
    }

    return tokens;
  }

  /*
   * The image tokens a record holds in what it shows to everyone when it
   * is shown, whether it is shown or not: what it may have shown, to ask
   * whether anything still shows it once the record no longer does.
   */
  public static getHeldTokens(
    tableName: string | null | undefined,
    row: Row | null | undefined,
  ): Set<string> {
    const tokens: Set<string> = new Set<string>();

    if (!row) {
      return tokens;
    }

    for (const source of this.getSources(tableName)) {
      for (const token of this.getTokensOf(source, row)) {
        tokens.add(token);
      }
    }

    return tokens;
  }

  /*
   * Of the records rows of a table are shown under (shownUnder), those
   * shown now, as the database holds them, each with its project. Empty for
   * a table shown under nothing, or rows that name no such record. A failed
   * read counts none as shown: an image is never made public on a guess.
   */
  public static async readShownParents(
    tableName: string | null | undefined,
    rows: Array<Row>,
  ): Promise<ShownParents> {
    const shown: ShownParents = new Map();

    for (const source of this.getSources(tableName)) {
      const parent: PublishedParent | undefined = source.shownUnder;

      if (!parent) {
        continue;
      }

      const parentIds: Array<string> = Array.from(
        new Set<string>(
          rows
            .map((row: Row): string => {
              return normalizeFileId(row[parent.foreignKey]);
            })
            .filter((id: string): boolean => {
              return ObjectID.isValidUUID(id);
            }),
        ),
      );

      if (parentIds.length === 0) {
        continue;
      }

      try {
        const found: unknown = await this.getFileWriter()
          .getRepository()
          .manager.query(getShownParentsSql(parent), [parentIds]);

        for (const record of Array.isArray(found)
          ? (found as Array<Row>)
          : []) {
          shown.set(
            normalizeFileId(record["_id"]),
            normalizeFileId(record["projectId"]),
          );
        }
      } catch (err) {
        logger.error(
          `Could not tell whether the ${parent.tableName} records ${String(
            tableName,
          )} rows are shown under are shown, so none is taken as shown: ${String(err)}`,
        );
      }
    }

    return shown;
  }

  /*
   * After a record is created: the images it shows become public - an
   * announcement's, only once its time to be shown has come (one scheduled
   * for later leaves them private: publishWhenShown makes them public then).
   * When a switch or the time it shows them by was left to the column's
   * default, the stored record is read for it (readStored); a record shown
   * under another shows them only while that record is shown, as it is now
   * (readShownParents).
   */
  public static async afterCreate(data: {
    tableName: string | null | undefined;
    row: unknown;
    readStored: (columns: Array<string>) => Promise<Row | null>;
  }): Promise<void> {
    try {
      const sources: Array<PublishedMarkdown> = this.getSources(data.tableName);

      if (sources.length === 0) {
        return;
      }

      let row: Row = (data.row || {}) as Row;

      // The kinds of markdown the new record carries an image in.
      const withImages: Array<PublishedMarkdown> = sources.filter(
        (source: PublishedMarkdown): boolean => {
          return this.getTokensOf(source, row).length > 0;
        },
      );

      if (withImages.length === 0) {
        return;
      }

      /*
       * The switches - and the time - that show it which it was created
       * without, as the column defaults set them. A switch that hides it
       * (hiddenWhen) left out is off, read or not: those columns default to
       * off (pinned by PublishedImages' tests), so a create that leaves one
       * out stores it off.
       */
      const unknownSwitches: Array<string> = Array.from(
        new Set<string>(
          withImages.flatMap((source: PublishedMarkdown): Array<string> => {
            return [
              ...source.shownWhen,
              ...(source.shownFrom ? [source.shownFrom] : []),
            ].filter((column: string): boolean => {
              return row[column] === undefined;
            });
          }),
        ),
      );

      if (unknownSwitches.length > 0) {
        const stored: Row = (await data.readStored(unknownSwitches)) || {};

        row = { ...row };

        for (const column of unknownSwitches) {
          row[column] = stored[column];
        }
      }

      await this.setImagesVisibility({
        projectId: row["projectId"],
        publish: this.getShownTokens(
          data.tableName,
          row,
          await this.readShownParents(data.tableName, [row]),
        ),
        unpublish: [],
      });
    } catch (err) {
      logger.error(
        `Failed to make the images of a new ${String(data.tableName)} public: ${String(err)}`,
      );
    }
  }

  /*
   * After records are updated, from each record as it was (read with every
   * column getColumns names) and as its write stored it (rowsAfter): the
   * images each shows now become public, and every other image it held
   * before or holds now is made private unless a record of its project still
   * shows it (findStillShown) - so an image is decided by what the database
   * holds, never by a read made before another write landed. A record
   * shown under another shows its images only while that record is shown,
   * as it is now; and when a write turns the switches of records others are
   * shown under, those others' images follow (their public notes). The
   * images of all the rows are looked up together, a project at a time.
   */
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rowsBefore: Array<unknown>;
    written: unknown;
    /*
     * Each row as its own write stored it, in the order of rowsBefore: what
     * the database handed back of it (DatabaseService), which decides over
     * what the update asked to write. A row with none is taken as it was
     * with what the update wrote.
     */
    rowsAfter?: Array<unknown> | undefined;
  }): Promise<void> {
    try {
      const columns: Array<string> = this.getColumns(data.tableName);
      const written: Row = (data.written || {}) as Row;

      if (
        !this.isWrittenBy(
          data.tableName,
          Object.keys(written).filter((column: string): boolean => {
            return written[column] !== undefined;
          }),
        )
      ) {
        return;
      }

      const rows: Array<UpdatedRow> = data.rowsBefore.map(
        (rowBefore: unknown, index: number): UpdatedRow => {
          const before: Row = (rowBefore || {}) as Row;
          const after: Row = { ...before };

          for (const column of columns) {
            if (written[column] !== undefined) {
              after[column] = written[column];
            }
          }

          const stored: unknown = data.rowsAfter?.[index];

          if (stored && typeof stored === "object") {
            for (const [column, value] of Object.entries(stored as Row)) {
              if (value !== undefined) {
                after[column] = value;
              }
            }
          }

          return { before, after };
        },
      );

      // The records the rows are shown under, as they are now.
      const shownParents: ShownParents = await this.readShownParents(
        data.tableName,
        rows.map((row: UpdatedRow): Row => {
          return row.after;
        }),
      );

      const changes: ImageChanges = new Map();

      for (const row of rows) {
        const shownAfter: Set<string> = this.getShownTokens(
          data.tableName,
          row.after,
          shownParents,
        );

        const held: Set<string> = new Set<string>([
          ...this.getHeldTokens(data.tableName, row.before),
          ...this.getHeldTokens(data.tableName, row.after),
        ]);

        this.addChanges(changes, row.before["projectId"], {
          publish: shownAfter,
          unpublish: Array.from(held).filter((token: string): boolean => {
            return !shownAfter.has(token);
          }),
        });
      }

      await this.addChangesShownUnder({
        changes: changes,
        tableName: data.tableName,
        rows: rows,
        written: written,
      });

      await this.applyChanges(changes);
    } catch (err) {
      logger.error(
        `Failed to sync the images of an updated ${String(data.tableName)}: ${String(err)}`,
      );
    }
  }

  /*
   * The records shown under the updated rows (getSourcesShownUnder: their
   * public notes) show their images only while the row is shown: when the
   * update writes a switch that decides it, each such record's images are
   * made public if its row is shown as the write left it, and private
   * otherwise unless something else still shows them. Best-effort: a read
   * that fails leaves those images as they are.
   */
  private static async addChangesShownUnder(data: {
    changes: ImageChanges;
    tableName: string | null | undefined;
    rows: Array<UpdatedRow>;
    written: Row;
  }): Promise<void> {
    for (const source of this.getSourcesShownUnder(data.tableName)) {
      const parent: PublishedParent = source.shownUnder!;

      const writesASwitch: boolean = [
        ...parent.shownWhen,
        ...(parent.hiddenWhen || []),
      ].some((column: string): boolean => {
        return data.written[column] !== undefined;
      });

      if (!writesASwitch) {
        continue;
      }

      // Each updated row, by id: its project while it is shown, else null.
      const shownProjectById: Map<string, string | null> = new Map();

      for (const row of data.rows) {
        const id: string = normalizeFileId(row.before["_id"]);

        if (!ObjectID.isValidUUID(id)) {
          continue;
        }

        shownProjectById.set(
          id,
          this.isParentShown(parent, row.after)
            ? normalizeFileId(row.before["projectId"])
            : null,
        );
      }

      if (shownProjectById.size === 0) {
        continue;
      }

      let shownUnder: unknown = [];

      try {
        shownUnder = await this.getFileWriter()
          .getRepository()
          .manager.query(getRowsShownUnderSql(source), [
            Array.from(shownProjectById.keys()),
          ]);
      } catch (err) {
        logger.error(
          `Failed to read the ${source.tableName} rows shown under updated ${parent.tableName} rows: ${String(err)}`,
        );
        continue;
      }

      for (const record of Array.isArray(shownUnder)
        ? (shownUnder as Array<Row>)
        : []) {
        const shownProjectId: string | null | undefined = shownProjectById.get(
          normalizeFileId(record[parent.foreignKey]),
        );
        const tokens: Array<string> = this.getTokensOf(source, record);
        const isShown: boolean =
          Boolean(shownProjectId) &&
          shownProjectId === normalizeFileId(record["projectId"]);

        this.addChanges(data.changes, record["projectId"], {
          publish: isShown ? tokens : [],
          unpublish: isShown ? [] : tokens,
        });
      }
    }
  }

  /*
   * The published rows a delete of these rows takes with it (CASCADES),
   * read before the delete, since the database removes them unseen - and
   * the rows those take with them in turn (a group's sub-groups), a table
   * at a time, each row once. Best-effort: the images of rows a failed read
   * would have found are left as they are, the other reads go on, and the
   * delete goes ahead.
   */
  public static async readCascadedRows(data: {
    tableName: string | null | undefined;
    ids: Array<ObjectID | string>;
    query: QueryFunction;
  }): Promise<Array<CascadedRow>> {
    const cascaded: Array<CascadedRow> = [];
    const rootTable: string = data.tableName || "";

    // Every row met so far, the deleted ones included, as "table:id".
    const seen: Set<string> = new Set<string>();

    let pending: Map<string, Set<string>> = new Map([
      [
        rootTable,
        new Set<string>(
          data.ids
            .map((id: ObjectID | string): string => {
              return normalizeFileId(id);
            })
            .filter((id: string): boolean => {
              return ObjectID.isValidUUID(id);
            }),
        ),
      ],
    ]);

    for (const id of pending.get(rootTable)!) {
      seen.add(`${rootTable}:${id}`);
    }

    while (pending.size > 0) {
      const next: Map<string, Set<string>> = new Map();

      for (const [parentTable, parentIdSet] of pending) {
        const parentIds: Array<string> = Array.from(parentIdSet);

        if (parentIds.length === 0) {
          continue;
        }

        for (const cascade of CASCADES) {
          if (cascade.parentTable !== parentTable) {
            continue;
          }

          let rows: unknown = [];

          try {
            rows = await data.query(getCascadedRowsSql(cascade), [parentIds]);
          } catch (err) {
            logger.error(
              `Failed to read the ${cascade.tableName} rows a delete of ${parentTable} takes with it: ${String(err)}`,
            );
            continue;
          }

          for (const row of Array.isArray(rows) ? (rows as Array<Row>) : []) {
            const rowId: string = normalizeFileId(row["_id"]);
            const key: string = `${cascade.tableName}:${rowId}`;

            if (!ObjectID.isValidUUID(rowId) || seen.has(key)) {
              continue;
            }

            seen.add(key);
            cascaded.push({ tableName: cascade.tableName, row: row });

            if (!next.has(cascade.tableName)) {
              next.set(cascade.tableName, new Set<string>());
            }

            next.get(cascade.tableName)!.add(rowId);
          }
        }
      }

      pending = next;
    }

    return cascaded;
  }

  /*
   * After records are deleted, from each as it was, and the published rows
   * the delete took with it: the images they held become private, unless
   * another record of their project still shows them. A deleted project's
   * files all become private.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rowsDeleted: Array<unknown>;
    cascaded?: Array<CascadedRow> | undefined;
  }): Promise<void> {
    try {
      if (data.tableName === PROJECT_TABLE_NAME) {
        await this.makeProjectFilesPrivate(data.rowsDeleted);
        return;
      }

      if (
        this.getSources(data.tableName).length === 0 &&
        (data.cascaded || []).length === 0
      ) {
        return;
      }

      const changes: ImageChanges = new Map();

      const deleted: Array<CascadedRow> = [
        ...data.rowsDeleted.map((row: unknown): CascadedRow => {
          return { tableName: data.tableName || "", row: (row || {}) as Row };
        }),
        ...(data.cascaded || []),
      ];

      /*
       * Every image a deleted row held, shown or not - a public note's
       * record may have shown it - becomes private unless a record of its
       * project still shows it.
       */
      for (const entry of deleted) {
        this.addChanges(changes, entry.row["projectId"], {
          publish: [],
          unpublish: this.getHeldTokens(entry.tableName, entry.row),
        });
      }

      await this.applyChanges(changes);
    } catch (err) {
      logger.error(
        `Failed to make the images of a deleted ${String(data.tableName)} private: ${String(err)}`,
      );
    }
  }

  /**
   * Makes images of a project public, or private: only images of that
   * project, only those not so already, and private only when no record of
   * the project still shows them to everyone or sends them out
   * (findStillShown). Every image is looked up in one query. Best-effort:
   * a failure is logged, never thrown.
   */
  public static async setImagesVisibility(data: {
    projectId: ObjectID | string | null | undefined | unknown;
    publish: Iterable<string>;
    unpublish: Iterable<string>;
  }): Promise<void> {
    const projectId: string = normalizeFileId(data.projectId);

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    const publish: Set<string> = new Set<string>(
      Array.from(data.publish).filter((token: string): boolean => {
        return TOKEN_REGEX.test(token);
      }),
    );
    const unpublish: Set<string> = new Set<string>(
      Array.from(data.unpublish).filter((token: string): boolean => {
        return TOKEN_REGEX.test(token) && !publish.has(token);
      }),
    );

    if (publish.size === 0 && unpublish.size === 0) {
      return;
    }

    try {
      const fileWriter: FileWriter = this.getFileWriter();

      const files: Array<File> = await fileWriter.findBy({
        query: {
          imageAccessToken: QueryHelper.any([...publish, ...unpublish]),
        },
        select: {
          _id: true,
          projectId: true,
          isPublic: true,
          imageAccessToken: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      // Strictly true, as FileViewerAccess reads it: anything else is private.
      const isPublic: (file: File) => boolean = (file: File): boolean => {
        return (file.isPublic as unknown) === true;
      };

      const own: Array<File> = files.filter((file: File): boolean => {
        return (
          Boolean(file._id) &&
          FileOwnership.isFileOfProject(file, projectId) &&
          Boolean(file.imageAccessToken)
        );
      });

      const toPublic: Array<File> = own.filter((file: File): boolean => {
        return publish.has(file.imageAccessToken!) && !isPublic(file);
      });

      const candidates: Array<File> = own.filter((file: File): boolean => {
        return unpublish.has(file.imageAccessToken!) && isPublic(file);
      });

      const stillShown: Set<string> =
        candidates.length > 0
          ? await this.findStillShown({
              projectId: projectId,
              tokens: candidates.map((file: File): string => {
                return file.imageAccessToken!;
              }),
            })
          : new Set<string>();

      const toPrivate: Array<File> = candidates.filter(
        (file: File): boolean => {
          return !stillShown.has(file.imageAccessToken!);
        },
      );

      await this.writeVisibility(fileWriter, toPublic, true);
      await this.writeVisibility(fileWriter, toPrivate, false);
    } catch (err) {
      logger.error(
        `Failed to change the visibility of images of project ${projectId}: ${String(err)}`,
      );
    }
  }

  /*
   * Which of these images a record of the project still shows to everyone,
   * or sends out, as the database holds it now - by `now`, the current time
   * when not given. A failed lookup answers all of them: an image is never
   * made private on a guess.
   */
  public static async findStillShown(data: {
    projectId: ObjectID | string | null | undefined;
    tokens: Array<string>;
    now?: Date | undefined;
  }): Promise<Set<string>> {
    const tokens: Array<string> = Array.from(new Set<string>(data.tokens));
    const projectId: string = normalizeFileId(data.projectId);

    if (
      !projectId ||
      !ObjectID.isValidUUID(projectId) ||
      tokens.some((token: string): boolean => {
        return !TOKEN_REGEX.test(token);
      })
    ) {
      return new Set<string>(tokens);
    }

    if (tokens.length === 0) {
      return new Set<string>();
    }

    try {
      const rows: unknown = await this.getFileWriter()
        .getRepository()
        .manager.query(STILL_SHOWN_SQL, [
          projectId,
          tokens.map((token: string): string => {
            return `%/file/image/access-token/${token}%`;
          }),
          tokens,
          data.now || OneUptimeDate.getCurrentDate(),
        ]);

      const shown: Set<string> = new Set<string>();

      for (const row of Array.isArray(rows) ? (rows as Array<Row>) : []) {
        if (typeof row["token"] === "string") {
          shown.add(row["token"]);
        }
      }

      return shown;
    } catch (err) {
      logger.error(
        `Could not tell whether images are still shown, so they are kept as they are: ${String(err)}`,
      );

      return new Set<string>(tokens);
    }
  }

  /**
   * Makes public a private image a record shown from a time shows now - an
   * announcement whose Start Showing Announcement At has come since it was
   * last written, which no write made public at that moment. The image
   * route asks it of an image it would otherwise refuse
   * (FileViewerAccess.findReadableFile). One statement decides and writes:
   * the file of that project, not deleted, is made public only while a
   * record of its own project shows it, by `now` (the current time when not
   * given). True when a record shows it now, so it is public: made so by
   * this call, or by a request for it at the same moment. Never throws: an
   * image is never made public on a guess, and one that cannot be is
   * refused as before.
   */
  public static async publishWhenShown(
    file:
      | {
          _id?: unknown;
          projectId?: unknown;
          imageAccessToken?: unknown;
          isPublic?: unknown;
        }
      | null
      | undefined,
    now?: Date | undefined,
  ): Promise<boolean> {
    const fileId: string = normalizeFileId(file?._id);
    const projectId: string = normalizeFileId(file?.projectId);
    const token: string =
      typeof file?.imageAccessToken === "string" ? file.imageAccessToken : "";

    if (
      SOURCES_SHOWN_FROM_A_TIME.length === 0 ||
      !ObjectID.isValidUUID(fileId) ||
      !ObjectID.isValidUUID(projectId) ||
      !TOKEN_REGEX.test(token) ||
      (file?.isPublic as unknown) === true
    ) {
      return false;
    }

    try {
      const result: unknown = await this.getFileWriter()
        .getRepository()
        .manager.query(PUBLISH_WHEN_SHOWN_SQL, [
          fileId,
          projectId,
          token,
          now || OneUptimeDate.getCurrentDate(),
          `%/file/image/access-token/${token}%`,
        ]);

      return this.countWritten(result) > 0;
    } catch (err) {
      logger.error(
        `Could not tell whether an image a record shows from a time is shown now, so it stays private: ${String(err)}`,
      );

      return false;
    }
  }

  /*
   * How many rows an UPDATE ... RETURNING wrote, as the driver answers it:
   * [rows, count], or the rows alone.
   */
  private static countWritten(result: unknown): number {
    if (!Array.isArray(result)) {
      return 0;
    }

    if (typeof result[1] === "number") {
      return result[1];
    }

    const rows: Array<unknown> = Array.isArray(result[0]) ? result[0] : result;

    return rows.filter((row: unknown): boolean => {
      return Boolean(row) && typeof row === "object" && "_id" in (row as Row);
    }).length;
  }

  private static addChanges(
    changes: ImageChanges,
    projectIdValue: unknown,
    data: { publish: Iterable<string>; unpublish: Iterable<string> },
  ): void {
    const projectId: string = normalizeFileId(projectIdValue);

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    if (!changes.has(projectId)) {
      changes.set(projectId, {
        publish: new Set<string>(),
        unpublish: new Set<string>(),
      });
    }

    const change: { publish: Set<string>; unpublish: Set<string> } =
      changes.get(projectId)!;

    for (const token of data.publish) {
      change.publish.add(token);
    }

    for (const token of data.unpublish) {
      change.unpublish.add(token);
    }
  }

  // A project at a time: one that cannot be set leaves the others to be set.
  private static async applyChanges(changes: ImageChanges): Promise<void> {
    for (const [projectId, change] of changes) {
      if (change.publish.size === 0 && change.unpublish.size === 0) {
        continue;
      }

      try {
        await this.setImagesVisibility({
          projectId: projectId,
          publish: change.publish,
          unpublish: change.unpublish,
        });
      } catch (err) {
        logger.error(
          `Failed to change the visibility of images of project ${projectId}: ${String(err)}`,
        );
      }
    }
  }

  /*
   * Every file in one write; when that fails, a file at a time, so one that
   * cannot be written leaves the others to be.
   */
  private static async writeVisibility(
    fileWriter: FileWriter,
    files: Array<File>,
    isPublic: boolean,
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const write: (batch: Array<File>) => Promise<void> = async (
      batch: Array<File>,
    ): Promise<void> => {
      await fileWriter.updateBy({
        query: {
          _id: QueryHelper.any(
            batch.map((file: File): string => {
              return file._id!.toString();
            }),
          ),
        },
        data: {
          isPublic: isPublic,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    };

    try {
      await write(files);
      return;
    } catch (err) {
      if (files.length === 1) {
        logger.error(
          `Failed to make an image ${isPublic ? "public" : "private"}: ${String(err)}`,
        );
        return;
      }
    }

    for (const file of files) {
      try {
        await write([file]);
      } catch (err) {
        logger.error(
          `Failed to make image ${String(file._id)} ${isPublic ? "public" : "private"}: ${String(err)}`,
        );
      }
    }
  }

  private static async makeProjectFilesPrivate(
    rowsDeleted: Array<unknown>,
  ): Promise<void> {
    const projectIds: Array<string> = rowsDeleted
      .map((row: unknown): string => {
        return normalizeFileId(((row || {}) as Row)["_id"]);
      })
      .filter((projectId: string): boolean => {
        return ObjectID.isValidUUID(projectId);
      });

    if (projectIds.length === 0) {
      return;
    }

    await this.getFileWriter()
      .getRepository()
      .manager.query(PROJECT_FILES_PRIVATE_SQL, [projectIds]);
  }

  /*
   * Whether a record's switches show it: every one that must be on is on
   * (true, as the database stores it), and none that hides it is - one that
   * is neither false nor unset hides it.
   */
  private static areSwitchesShowing(
    switches: {
      shownWhen: Array<string>;
      hiddenWhen?: Array<string> | undefined;
    },
    row: Row,
  ): boolean {
    return (
      switches.shownWhen.every((column: string): boolean => {
        return row[column] === true;
      }) &&
      (switches.hiddenWhen || []).every((column: string): boolean => {
        const value: unknown = row[column];

        return value === undefined || value === null || value === false;
      })
    );
  }

  // The image tokens a row holds in one kind of markdown, each once.
  private static getTokensOf(
    source: PublishedMarkdown,
    row: Row,
  ): Array<string> {
    const tokens: Set<string> = new Set<string>();

    for (const column of source.markdownColumns) {
      const value: unknown = row[column];

      for (const token of extractImageAccessTokens(
        typeof value === "string" ? value : null,
      )) {
        tokens.add(token);
      }
    }

    return Array.from(tokens);
  }

  /*
   * Required rather than imported: FileService is a DatabaseService, and
   * DatabaseService runs these hooks - imported at the top, FileService
   * would be loaded before the class it extends (FileOwnership.readFileOwners
   * does the same).
   */
  private static getFileWriter(): FileWriter {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/FileService").default;
  }
}
