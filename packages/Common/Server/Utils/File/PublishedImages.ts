import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import { normalizeFileId } from "./FileOwnership";

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
 * DatabaseService keeps this on every write of these records, whoever makes
 * it - the dashboard, the API, Terraform, a workflow, OneUptime itself: a
 * record created or edited to show an image makes it public (afterCreate,
 * afterUpdate), and a record that stops showing it - its switch turned off,
 * the image edited out, the record deleted - makes it private again
 * (afterUpdate, afterDelete), unless another record of the project still
 * shows it to everyone: an image is copied along with the markdown it sits
 * in, so a template's image can be in many incidents at once.
 *
 * Only an image of the record's own project is ever made public or private
 * by it (InlineImageAccessTokenSync): a record of one project never opens
 * another project's image, nor closes one under the status page that shows
 * it. Making images public or private is best-effort: it never fails the
 * write it follows.
 *
 * A file is public for nothing else but a probe's or an AI agent's icon
 * (FileService.makeStoredIconsPublic). Files made public before this rule
 * existed were set to it once (SetFileVisibilityFromPublishedRecords, a data
 * migration that runs PUBLISH_SHOWN_IMAGES_SQL and HIDE_UNSHOWN_FILES_SQL).
 */

// The address of an inline image in markdown, and the token it carries.
const ACCESS_TOKEN_REGEX: RegExp = /\/file\/image\/access-token\/([a-fA-F0-9]+)/g;

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
 * Markdown sent to everyone without being part of PUBLISHED_MARKDOWN: an
 * incident's custom fields, whose rich text values go out in subscriber
 * notifications and whose images are made public as they are sent
 * (IncidentTemplateVariableBuilder). The data migration leaves their images
 * as they are.
 */
export const SENT_MARKDOWN: ReadonlyArray<PublishedMarkdown> = [
  {
    tableName: "Incident",
    markdownColumns: ["customFields"],
    shownWhen: [],
  },
];

// A row as a read hands it over: its columns by name.
type Row = Record<string, unknown>;

// What setImageVisibility is: InlineImageAccessTokenSync's, one image at a time.
type SetImageVisibility = (
  token: string,
  isPublic: boolean,
  projectId: ObjectID | null | undefined,
) => Promise<void>;

// What the still-shown query runs on: FileService's repository.
interface QueryRunnerLike {
  query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
}

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
const getShownTokensSql: (sources: ReadonlyArray<PublishedMarkdown>) => string =
  (sources: ReadonlyArray<PublishedMarkdown>): string => {
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
 * Whether a record of a project still shows an image to everyone: $1 is the
 * project, $2 the image's address as a LIKE pattern.
 */
export const STILL_SHOWN_SQL: string = `${PUBLISHED_MARKDOWN.map(
  (source: PublishedMarkdown): string => {
    return `SELECT 1 AS ${quote("shown")} FROM ${quote(source.tableName)} WHERE ${quote("projectId")} = $1 AND ${getShownWhereSql(source)} AND (${source.markdownColumns
      .map((column: string): string => {
        return `${quote(column)}::text LIKE $2`;
      })
      .join(" OR ")})`;
  },
).join(" UNION ALL ")} LIMIT 1`;

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
 * its id (nothing a status page shows today breaks), or that an incident's
 * custom fields send out.
 */
export const HIDE_UNSHOWN_FILES_SQL: string = `WITH ${quote("shownToken")} AS (SELECT ${quote("token")} FROM (${getShownTokensSql(
  [...PUBLISHED_MARKDOWN, ...SENT_MARKDOWN],
)}) AS ${quote("tokens")}), ${quote("shownId")} AS (SELECT ${quote("fileId")} FROM (${getShownFileIdsSql(
  [...PUBLISHED_MARKDOWN, ...SENT_MARKDOWN],
)}) AS ${quote("ids")}) UPDATE ${quote("File")} AS ${quote("file")} SET ${quote("isPublic")} = false WHERE ${quote("file")}.${quote("isPublic")} = true AND NOT EXISTS (SELECT 1 FROM ${quote("Probe")} WHERE ${quote("Probe")}.${quote("iconFileId")} = ${quote("file")}.${quote("_id")}) AND NOT EXISTS (SELECT 1 FROM ${quote("AIAgent")} WHERE ${quote("AIAgent")}.${quote("iconFileId")} = ${quote("file")}.${quote("_id")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownToken")} WHERE ${quote("shownToken")}.${quote("token")} = ${quote("file")}.${quote("imageAccessToken")}) AND NOT EXISTS (SELECT 1 FROM ${quote("shownId")} WHERE ${quote("shownId")}.${quote("fileId")} = ${quote("file")}.${quote("_id")}::text)`;

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
  public static getColumns(tableName: string | null | undefined): Array<string> {
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

      const writesAnImage: boolean = sources.some(
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

      if (!writesAnImage) {
        return;
      }

      const unknownSwitch: boolean = sources.some(
        (source: PublishedMarkdown): boolean => {
          return source.shownWhen.some((column: string): boolean => {
            return row[column] === undefined;
          });
        },
      );

      if (unknownSwitch) {
        row = {
          ...row,
          ...((await data.readStored(this.getColumns(data.tableName))) || {}),
        };
      }

      await this.setVisibility({
        projectId: row["projectId"],
        publish: this.getShownTokens(data.tableName, row),
        unpublish: new Set<string>(),
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
   * another record of its project still shows them.
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

      for (const rowBefore of data.rowsBefore) {
        const before: Row = (rowBefore || {}) as Row;
        const after: Row = { ...before };

        for (const column of columns) {
          if (written[column] !== undefined) {
            after[column] = written[column];
          }
        }

        const shownBefore: Set<string> = this.getShownTokens(
          data.tableName,
          before,
        );
        const shownAfter: Set<string> = this.getShownTokens(
          data.tableName,
          after,
        );

        const unpublish: Set<string> = new Set<string>();

        for (const token of shownBefore) {
          if (!shownAfter.has(token)) {
            unpublish.add(token);
          }
        }

        await this.setVisibility({
          projectId: before["projectId"],
          publish: shownAfter,
          unpublish: unpublish,
        });
      }
    } catch (err) {
      logger.error(
        `Failed to sync the images of an updated ${String(data.tableName)}: ${String(err)}`,
      );
    }
  }

  /*
   * After records are deleted, from each as it was: the images it showed
   * become private, unless another record of its project still shows them.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rowsDeleted: Array<unknown>;
  }): Promise<void> {
    try {
      if (this.getSources(data.tableName).length === 0) {
        return;
      }

      for (const rowDeleted of data.rowsDeleted) {
        const row: Row = (rowDeleted || {}) as Row;

        await this.setVisibility({
          projectId: row["projectId"],
          publish: new Set<string>(),
          unpublish: this.getShownTokens(data.tableName, row),
        });
      }
    } catch (err) {
      logger.error(
        `Failed to make the images of a deleted ${String(data.tableName)} private: ${String(err)}`,
      );
    }
  }

  /*
   * Whether a record of the project still shows the image to everyone, as
   * the database holds it now. A failed lookup answers yes: an image is
   * never made private on a guess.
   */
  public static async isStillShown(data: {
    projectId: ObjectID | string | null | undefined;
    token: string;
  }): Promise<boolean> {
    const projectId: string = normalizeFileId(data.projectId);

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return true;
    }

    if (!TOKEN_REGEX.test(data.token)) {
      return true;
    }

    try {
      const rows: unknown = await this.getQueryRunner().query(STILL_SHOWN_SQL, [
        projectId,
        `%/file/image/access-token/${data.token}%`,
      ]);

      return Array.isArray(rows) && rows.length > 0;
    } catch (err) {
      logger.error(
        `Could not tell whether an image is still shown, so it is kept as it is: ${String(err)}`,
      );

      return true;
    }
  }

  private static async setVisibility(data: {
    projectId: unknown;
    publish: Set<string>;
    unpublish: Set<string>;
  }): Promise<void> {
    if (data.publish.size === 0 && data.unpublish.size === 0) {
      return;
    }

    const projectId: string = normalizeFileId(data.projectId);

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    const setImageVisibility: SetImageVisibility = this.getSetImageVisibility();

    for (const token of data.publish) {
      await setImageVisibility(token, true, new ObjectID(projectId));
    }

    for (const token of data.unpublish) {
      if (!data.publish.has(token)) {
        await setImageVisibility(token, false, new ObjectID(projectId));
      }
    }
  }

  /*
   * Required rather than imported: both sit behind FileService, which is a
   * DatabaseService, and DatabaseService runs these hooks.
   */
  private static getSetImageVisibility(): SetImageVisibility {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../InlineImageAccessTokenSync").setImageVisibility;
  }

  private static getQueryRunner(): QueryRunnerLike {
    const fileService: {
      getRepository: () => { manager: QueryRunnerLike };
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/FileService").default;

    return fileService.getRepository().manager;
  }
}
