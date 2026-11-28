import logger from "../Logger";
import { normalizeFileId } from "./FileOwnership";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { readImageTokens } from "../../../Types/File/MarkdownFiles";
import {
  canShowImages,
  getImageColumns,
} from "../../../Types/File/MarkdownRecords";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHICH RECORDS SHOW EACH INLINE IMAGE (#11478).
 *
 * An image pasted into the Markdown editor is a private file of the
 * record's project, carried in the Markdown by its address,
 * /file/image/access-token/<token>. That address opens it for a person only
 * when they may read a record of the project that shows it (FileViewerAccess,
 * ShownImageAccess) - the rule API keys and workflows were held to first
 * (MarkdownFiles): a member whose role reads only monitors does not open the
 * image in an incident because someone forwarded its address.
 *
 * Finding those records by reading the project's records would read every
 * row of every table whose records can show images, for every image a page
 * draws: on a busy project, hundreds of milliseconds an image. So each
 * record that shows an image is kept in ShownImage as it is written:
 *
 *   - after every create and update of a record that can show images
 *     (Types/File/MarkdownRecords: canShowImages), DatabaseService hands the
 *     row as written here. The images it names in the columns the write set
 *     - its Markdown, the Markdown it keeps in JSON, its custom fields - are
 *     recorded against it: images of the record's own project only, not
 *     deleted. One statement per write, and none for a write that names no
 *     image, which is most of them. Records written before were read in
 *     once (BackfillShownImages1809187821479);
 *   - a row is never taken back: an image edited out, or a record deleted,
 *     leaves its row, which opens nothing - the record is read again, as the
 *     person asking, every time it is asked (ShownImageAccess).
 *
 * Recording is best-effort: it never fails the write it follows. An image a
 * record shows without a row here is shown only to its uploader, never to
 * anyone it should not be. Nothing here reads a service at load: this file
 * is DatabaseService's, which every service extends.
 */

// The most records looked at for one image, the newest first.
export const MAX_RECORDS_SHOWING_AN_IMAGE: number = 1000;

// A record that shows an image.
export interface RecordShowingImage {
  tableName: string;
  recordId: string;
}

// A record as written, by what it is called.
type Row = Record<string, unknown>;

// Runs one statement, as OneUptime.
export type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

// What a raw query handed back, as rows: pg's array, or TypeORM's [rows, count].
const readRows: (result: unknown) => Array<Row> = (
  result: unknown,
): Array<Row> => {
  if (!Array.isArray(result)) {
    return [];
  }

  const rows: Array<unknown> =
    result.length === 2 && Array.isArray(result[0]) ? result[0] : result;

  return rows.filter((row: unknown): row is Row => {
    return typeof row === "object" && row !== null && !Array.isArray(row);
  });
};

/*
 * Each record of one write and the images it names, recorded in one
 * statement: $1 the record's table, $2 the records, $3 their projects (in
 * the same order), $4 the tokens. Each token is matched to a file of the
 * record's own project, not deleted; a row there already is kept.
 */
export const RECORD_SHOWN_IMAGES_SQL: string = `INSERT INTO "ShownImage" ("projectId", "fileId", "recordTableName", "recordId", "version") SELECT DISTINCT "record"."projectId", "file"."_id", $1::text, "record"."recordId", 1 FROM unnest($2::uuid[], $3::uuid[]) AS "record"("recordId", "projectId") INNER JOIN "File" AS "file" ON "file"."projectId" = "record"."projectId" AND "file"."imageAccessToken" = ANY($4::text[]) AND "file"."deletedAt" IS NULL ON CONFLICT ("fileId", "recordTableName", "recordId") DO NOTHING`;

/*
 * The records of a project that show an image: $1 the file, $2 its
 * project, $3 how many at most. The newest first: the record it was last
 * put in is the likeliest to be the one being looked at.
 */
export const RECORDS_SHOWING_IMAGE_SQL: string = `SELECT "recordTableName", "recordId" FROM "ShownImage" WHERE "fileId" = $1 AND "projectId" = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT $3`;

export default class ShownImages {
  /*
   * The columns of a write that can name an image: those of
   * getImageColumns it set. Empty for a model whose records show no images.
   */
  public static getWrittenColumns(
    model: BaseModel,
    written: Row,
  ): Array<string> {
    if (!canShowImages(model)) {
      return [];
    }

    return getImageColumns(model).filter((column: string): boolean => {
      return written[column] !== undefined && written[column] !== null;
    });
  }

  // The image tokens a row names in these columns, each once.
  public static readTokens(row: Row, columns: Array<string>): Array<string> {
    const tokens: Array<string> = [];

    for (const column of columns) {
      for (const token of readImageTokens(row[column])) {
        if (!tokens.includes(token)) {
          tokens.push(token);
        }
      }
    }

    return tokens;
  }

  // A record's project, as a row names it: its tenant column.
  public static readProjectId(model: BaseModel, row: Row): string {
    const tenantColumn: string | null = model.getTenantColumn();
    const projectId: string = tenantColumn
      ? normalizeFileId(row[tenantColumn])
      : "";

    return ObjectID.isValidUUID(projectId) ? projectId : "";
  }

  // A record's own id, as a row names it.
  public static readRecordId(row: Row): string {
    const id: string = normalizeFileId(row["_id"] || row["id"]);

    return ObjectID.isValidUUID(id) ? id : "";
  }

  /*
   * After a record is created: the images its columns name, recorded
   * against it. `row` is the record as it was inserted. Best-effort.
   */
  public static async afterCreate(data: {
    model: BaseModel;
    row: unknown;
  }): Promise<void> {
    await this.afterWrite({
      model: data.model,
      written: (data.row || {}) as Row,
      rows: [data.row],
    });
  }

  /*
   * After an update: the images the columns it wrote name, recorded against
   * each record it changed. `written` is what the update set, `rows` the
   * records it changed, each with its id and project. Best-effort.
   */
  public static async afterUpdate(data: {
    model: BaseModel;
    written: unknown;
    rows: Array<unknown>;
  }): Promise<void> {
    await this.afterWrite({
      model: data.model,
      written: (data.written || {}) as Row,
      rows: data.rows,
    });
  }

  private static async afterWrite(data: {
    model: BaseModel;
    written: Row;
    rows: Array<unknown>;
  }): Promise<void> {
    try {
      const columns: Array<string> = this.getWrittenColumns(
        data.model,
        data.written,
      );

      if (columns.length === 0) {
        return;
      }

      const tokens: Array<string> = this.readTokens(data.written, columns);

      if (tokens.length === 0) {
        return;
      }

      const recordIds: Array<string> = [];
      const projectIds: Array<string> = [];

      for (const row of data.rows) {
        const values: Row = (row || {}) as Row;
        const recordId: string = this.readRecordId(values);
        const projectId: string = this.readProjectId(data.model, values);

        if (recordId && projectId && !recordIds.includes(recordId)) {
          recordIds.push(recordId);
          projectIds.push(projectId);
        }
      }

      await this.record({
        tableName: data.model.tableName || "",
        recordIds: recordIds,
        projectIds: projectIds,
        tokens: tokens,
      });
    } catch (err) {
      logger.error(
        `Could not record the images a ${String(data.model.tableName)} shows, so only their uploaders see them until it is saved again: ${String(err)}`,
      );
    }
  }

  /*
   * That each of these records (with the project in the same place of
   * projectIds) shows the images these tokens address: one statement, for
   * the images of each record's own project.
   */
  public static async record(data: {
    tableName: string;
    recordIds: Array<string>;
    projectIds: Array<string>;
    tokens: Array<string>;
  }): Promise<void> {
    if (
      !data.tableName ||
      data.recordIds.length === 0 ||
      data.recordIds.length !== data.projectIds.length ||
      data.tokens.length === 0
    ) {
      return;
    }

    await this.getQuery()(RECORD_SHOWN_IMAGES_SQL, [
      data.tableName,
      data.recordIds,
      data.projectIds,
      data.tokens,
    ]);
  }

  // The records of the image's project that show it, the newest first.
  public static async findRecords(data: {
    fileId: ObjectID | string;
    projectId: ObjectID | string;
  }): Promise<Array<RecordShowingImage>> {
    const fileId: string = normalizeFileId(data.fileId);
    const projectId: string = normalizeFileId(data.projectId);

    if (!ObjectID.isValidUUID(fileId) || !ObjectID.isValidUUID(projectId)) {
      return [];
    }

    const records: Array<RecordShowingImage> = [];

    for (const row of readRows(
      await this.getQuery()(RECORDS_SHOWING_IMAGE_SQL, [
        fileId,
        projectId,
        MAX_RECORDS_SHOWING_AN_IMAGE,
      ]),
    )) {
      const recordId: string = normalizeFileId(row["recordId"]);
      const tableName: unknown = row["recordTableName"];

      if (
        typeof tableName === "string" &&
        tableName &&
        ObjectID.isValidUUID(recordId)
      ) {
        records.push({ tableName: tableName, recordId: recordId });
      }
    }

    return records;
  }

  /*
   * What runs this file's statements, as OneUptime: ShownImageService's
   * connection. Required rather than imported: ShownImageService is a
   * DatabaseService, and DatabaseService records what is written here.
   */
  public static getQuery(): QueryFunction {
    const service: {
      getRepository: () => { manager: { query: QueryFunction } };
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/ShownImageService").default;

    return async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      return await service.getRepository().manager.query(sql, parameters);
    };
  }
}
