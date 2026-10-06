import QueryHelper from "../../Types/Database/QueryHelper";
import File from "../../../Models/DatabaseModels/File";
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
 *     pages, and its postmortem once it is published there too;
 *   - an episode's description, and a scheduled maintenance event's, while
 *     the episode or the event is shown on status pages;
 *   - public notes (of incidents, episodes and scheduled maintenance) and
 *     announcements, always;
 *   - a status page's overview description, and the descriptions of its
 *     groups and resources, always.
 *
 * A status page that asks its visitors to sign in shows the same, to people
 * who are not members of the project; the image routes can serve them only a
 * public image, so its images are public by their unguessable address, as
 * its announcements' and public notes' always were.
 *
 * DatabaseService keeps this on every write of these records, whoever makes
 * it - the dashboard, the API, Terraform, a workflow, OneUptime itself: a
 * record created or edited to show an image makes it public (afterCreate,
 * afterUpdate), and a record that stops showing it - its switch turned off,
 * the image edited out, the record deleted, or the record it belongs to
 * deleted with it (CASCADES), or its project deleted - makes it private again
 * (afterUpdate, afterDelete), unless another record of the project still
 * shows it: an image is copied along with the markdown it sits in, so a
 * template's image can be in many incidents at once.
 *
 * Only an image of the record's own project is ever made public or private
 * by it: a record of one project never opens another project's image, nor
 * closes one under the status page that shows it. Making images public or
 * private is best-effort: it never fails the write it follows.
 *
 * A file is public for nothing else but a probe's or an AI agent's icon
 * (FileService.makeStoredIconsPublic), and the images of what goes out to
 * everyone without a page of its own (KEPT_MARKDOWN). Files made public
 * before this rule existed were set to it once
 * (SetFileVisibilityFromPublishedRecords, a data migration that runs
 * PUBLISH_SHOWN_IMAGES_SQL and HIDE_UNSHOWN_FILES_SQL).
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
   * as the status page reads them; none for a record that always does.
   */
  shownWhen: Array<string>;
}

export const PUBLISHED_MARKDOWN: ReadonlyArray<PublishedMarkdown> = [
  {
    tableName: "Incident",
    markdownColumns: ["description"],
    shownWhen: ["isVisibleOnStatusPage"],
  },
  {
    tableName: "Incident",
    markdownColumns: ["postmortemNote"],
    shownWhen: ["isVisibleOnStatusPage", "showPostmortemOnStatusPage"],
  },
  {
    tableName: "IncidentPublicNote",
    markdownColumns: ["note"],
    shownWhen: [],
  },
  {
    tableName: "IncidentEpisode",
    markdownColumns: ["description"],
    shownWhen: ["isVisibleOnStatusPage"],
  },
  {
    tableName: "IncidentEpisodePublicNote",
    markdownColumns: ["note"],
    shownWhen: [],
  },
  {
    tableName: "ScheduledMaintenance",
    markdownColumns: ["description"],
    shownWhen: ["isVisibleOnStatusPage"],
  },
  {
    tableName: "ScheduledMaintenancePublicNote",
    markdownColumns: ["note"],
    shownWhen: [],
  },
  {
    tableName: "StatusPageAnnouncement",
    markdownColumns: ["description"],
    shownWhen: [],
  },
  {
    tableName: "StatusPage",
    markdownColumns: ["overviewPageDescription"],
    shownWhen: [],
  },
  {
    tableName: "StatusPageGroup",
    markdownColumns: ["description"],
    shownWhen: [],
  },
  {
    tableName: "StatusPageResource",
    markdownColumns: ["displayDescription"],
    shownWhen: [],
  },
];

/*
 * Markdown that goes out to everyone without being kept in step here: an
 * incident's custom fields, whose rich text values are sent in subscriber
 * notifications and whose images are made public as they are sent
 * (IncidentTemplateVariableBuilder), and a form's description and success
 * message, shown on its public page (a form takes no image uploads, but its
 * markdown may name one). An image any of them shows is never made private
 * here, by an edit elsewhere or by the data migration.
 */
export const KEPT_MARKDOWN: ReadonlyArray<PublishedMarkdown> = [
  {
    tableName: "Incident",
    markdownColumns: ["customFields"],
    shownWhen: [],
  },
  {
    tableName: "Form",
    markdownColumns: ["description", "successMessage"],
    shownWhen: [],
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

// The rows of a source that show their markdown: not deleted, every switch on.
const getShownWhereSql: (source: PublishedMarkdown) => string = (
  source: PublishedMarkdown,
): string => {
  return [
    `${quote("deletedAt")} IS NULL`,
    ...source.shownWhen.map((column: string): string => {
      return `${quote(column)} = true`;
    }),
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

      return `SELECT ${quote("projectId")} AS ${quote("projectId")}, (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${getShownWhereSql(source)} AND ${text} LIKE '%/file/image/access-token/%'`;
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

      return `SELECT lower((regexp_matches(${text}, '${IMAGE_BY_ID_PATTERN}', 'g'))[1]) AS ${quote("fileId")} FROM ${quote(source.tableName)} WHERE ${getShownWhereSql(source)} AND ${text} LIKE '%/file/image/%'`;
    })
    .join(" UNION ALL ");
};

/*
 * Which of some images a record of a project still shows to everyone, or
 * sends out: $1 is the project, $2 the images' addresses as LIKE patterns,
 * $3 their tokens. One statement for every image a write stopped showing.
 */
export const STILL_SHOWN_SQL: string = `SELECT DISTINCT ${quote("shown")}.${quote("token")} AS ${quote("token")} FROM (${[
  ...PUBLISHED_MARKDOWN,
  ...KEPT_MARKDOWN,
]
  .map((source: PublishedMarkdown): string => {
    const text: string = getTextSql(source);

    return `SELECT (regexp_matches(${text}, '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS ${quote("token")} FROM ${quote(source.tableName)} WHERE ${quote("projectId")} = $1 AND ${getShownWhereSql(source)} AND ${text} LIKE ANY($2)`;
  })
  .join(
    " UNION ALL ",
  )}) AS ${quote("shown")} WHERE ${quote("shown")}.${quote("token")} = ANY($3)`;

// A deleted project's files are nobody's to show any more: $1 is the projects.
export const PROJECT_FILES_PRIVATE_SQL: string = `UPDATE ${quote("File")} SET ${quote("isPublic")} = false WHERE ${quote("isPublic")} = true AND ${quote("projectId")} = ANY($1::uuid[])`;

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
)}) AS ${quote("ids")}) UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = false WHERE ${quote("file")}.${quote("isPublic")} = true AND NOT EXISTS (SELECT 1 FROM ${quote("Probe")} WHERE ${quote("Probe")}.${quote("iconFileId")} = ${quote("file")}.${quote("_id")}) AND NOT EXISTS (SELECT 1 FROM ${quote("AIAgent")} WHERE ${quote("AIAgent")}.${quote("iconFileId")} = ${quote("file")}.${quote("_id")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownToken")} WHERE ${quote("shownToken")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownId")} WHERE ${quote("shownId")}.${quote("fileId")} = ${quote("file")}.${quote("_id")}::text)`;

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
   * The columns that decide what a table's records show to everyone: their
   * markdown and their switches. Empty for a table that shows nothing.
   */
  public static getColumns(
    tableName: string | null | undefined,
  ): Array<string> {
    const columns: Set<string> = new Set<string>();

    for (const source of this.getSources(tableName)) {
      for (const column of [...source.markdownColumns, ...source.shownWhen]) {
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

  // Whether a record shows a kind of markdown: every switch of it is on.
  public static isShown(source: PublishedMarkdown, row: Row): boolean {
    return source.shownWhen.every((column: string): boolean => {
      return row[column] === true;
    });
  }

  // The image tokens a record shows to everyone.
  public static getShownTokens(
    tableName: string | null | undefined,
    row: Row | null | undefined,
  ): Set<string> {
    const tokens: Set<string> = new Set<string>();

    if (!row) {
      return tokens;
    }

    for (const source of this.getSources(tableName)) {
      if (!this.isShown(source, row)) {
        continue;
      }

      for (const column of source.markdownColumns) {
        const value: unknown = row[column];

        for (const token of extractImageAccessTokens(
          typeof value === "string" ? value : null,
        )) {
          tokens.add(token);
        }
      }
    }

    return tokens;
  }

  /*
   * After a record is created: the images it shows become public. When a
   * switch it shows them by was left to the column's default, the stored
   * record is read for it (readStored).
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
          return source.markdownColumns.some((column: string): boolean => {
            const value: unknown = row[column];

            return (
              typeof value === "string" &&
              extractImageAccessTokens(value).length > 0
            );
          });
        },
      );

      if (withImages.length === 0) {
        return;
      }

      // The switches it was created without, as the column defaults set them.
      const unknownSwitches: Array<string> = Array.from(
        new Set<string>(
          withImages.flatMap((source: PublishedMarkdown): Array<string> => {
            return source.shownWhen.filter((column: string): boolean => {
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
        publish: this.getShownTokens(data.tableName, row),
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
   * column getColumns names) and what the update wrote: the images each
   * shows now become public, and those it no longer shows private, unless
   * another record of its project still shows them. The images of all the
   * rows are looked up together, a project at a time.
   */
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rowsBefore: Array<unknown>;
    written: unknown;
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

      const changes: ImageChanges = new Map();

      for (const rowBefore of data.rowsBefore) {
        const before: Row = (rowBefore || {}) as Row;
        const after: Row = { ...before };

        for (const column of columns) {
          if (written[column] !== undefined) {
            after[column] = written[column];
          }
        }

        const shownAfter: Set<string> = this.getShownTokens(
          data.tableName,
          after,
        );

        this.addChanges(changes, before["projectId"], {
          publish: shownAfter,
          unpublish: Array.from(
            this.getShownTokens(data.tableName, before),
          ).filter((token: string): boolean => {
            return !shownAfter.has(token);
          }),
        });
      }

      await this.applyChanges(changes);
    } catch (err) {
      logger.error(
        `Failed to sync the images of an updated ${String(data.tableName)}: ${String(err)}`,
      );
    }
  }

  /*
   * The published rows a delete of these rows takes with it (CASCADES),
   * read before the delete, since the database removes them unseen - and
   * the rows those take with them in turn (a group's sub-groups). Best-
   * effort: the images of rows a failed read would have found are left as
   * they are, and the delete goes ahead.
   */
  public static async readCascadedRows(data: {
    tableName: string | null | undefined;
    ids: Array<ObjectID | string>;
    query: QueryFunction;
  }): Promise<Array<CascadedRow>> {
    const cascaded: Array<CascadedRow> = [];

    try {
      const seen: Set<string> = new Set<string>();
      let pending: Array<{ tableName: string; ids: Array<string> }> = [
        {
          tableName: data.tableName || "",
          ids: data.ids.map((id: ObjectID | string): string => {
            return normalizeFileId(id);
          }),
        },
      ];

      while (pending.length > 0) {
        const next: Array<{ tableName: string; ids: Array<string> }> = [];

        for (const parent of pending) {
          const parentIds: Array<string> = parent.ids.filter(
            (id: string): boolean => {
              return ObjectID.isValidUUID(id);
            },
          );

          if (parentIds.length === 0) {
            continue;
          }

          for (const cascade of CASCADES) {
            if (cascade.parentTable !== parent.tableName) {
              continue;
            }

            const rows: unknown = await data.query(
              getCascadedRowsSql(cascade),
              [parentIds],
            );

            const childIds: Array<string> = [];

            for (const row of Array.isArray(rows) ? (rows as Array<Row>) : []) {
              const rowId: string = normalizeFileId(row["_id"]);
              const key: string = `${cascade.tableName}:${rowId}`;

              if (!rowId || seen.has(key)) {
                continue;
              }

              seen.add(key);
              cascaded.push({ tableName: cascade.tableName, row: row });
              childIds.push(rowId);
            }

            if (childIds.length > 0) {
              next.push({ tableName: cascade.tableName, ids: childIds });
            }
          }
        }

        pending = next;
      }
    } catch (err) {
      logger.error(
        `Failed to read what a delete of ${String(data.tableName)} takes with it: ${String(err)}`,
      );
    }

    return cascaded;
  }

  /*
   * After records are deleted, from each as it was, and the published rows
   * the delete took with it: the images they showed become private, unless
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

      const changes: ImageChanges = new Map();

      const deleted: Array<CascadedRow> = [
        ...data.rowsDeleted.map((row: unknown): CascadedRow => {
          return { tableName: data.tableName || "", row: (row || {}) as Row };
        }),
        ...(data.cascaded || []),
      ];

      for (const entry of deleted) {
        this.addChanges(changes, entry.row["projectId"], {
          publish: [],
          unpublish: this.getShownTokens(entry.tableName, entry.row),
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
   * or sends out, as the database holds it now. A failed lookup answers all
   * of them: an image is never made private on a guess.
   */
  public static async findStillShown(data: {
    projectId: ObjectID | string | null | undefined;
    tokens: Array<string>;
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

  private static async writeVisibility(
    fileWriter: FileWriter,
    files: Array<File>,
    isPublic: boolean,
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }

    try {
      await fileWriter.updateBy({
        query: {
          _id: QueryHelper.any(
            files.map((file: File): string => {
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
    } catch (err) {
      logger.error(
        `Failed to make ${files.length} image(s) ${isPublic ? "public" : "private"}: ${String(err)}`,
      );
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
