import PublishedImages, {
  CASCADES,
  getCascadedRowsSql,
  getRowsShownUnderSql,
  getShownParentsSql,
  HIDE_HIDDEN_RECORD_IMAGES_SQL,
  HIDE_NOT_YET_SHOWN_IMAGES_SQL,
  HIDE_PRIVATE_RECORD_IMAGES_SQL,
  HIDE_UNSHOWN_FILES_SQL,
  KEPT_MARKDOWN,
  PROJECT_FILES_PRIVATE_SQL,
  PublishedCascade,
  PUBLISHED_MARKDOWN,
  PUBLISH_SHOWN_IMAGES_SQL,
  PUBLISH_WHEN_SHOWN_SQL,
  PublishedMarkdown,
  PublishedParent,
  STILL_SHOWN_SQL,
} from "../../../../Server/Utils/File/PublishedImages";
import UserMiddleware from "../../../../Server/Middleware/UserAuthorization";
import FileService from "../../../../Server/Services/FileService";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import FileViewerAccess from "../../../../Server/Utils/File/FileViewerAccess";
import File from "../../../../Models/DatabaseModels/File";
import OneUptimeDate from "../../../../Types/Date";
import MimeType from "../../../../Types/File/MimeType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The SQL of PublishedImages against a real Postgres, on real rows: the
 * still-shown check DatabaseService asks before it makes images private, the
 * reads of the rows a delete takes with it, the statement a deleted
 * project's files are made private by, the two statements the
 * SetFileVisibilityFromPublishedRecords data migration runs once - images
 * published records show become public, and public files nothing published
 * shows become private - and the one the HideImagesOfPrivateIncidents data
 * migration runs once: images a private incident or episode made public
 * become private. A private incident or episode shows nothing, whatever its
 * Visible on Status Page switch says (StatusPageVisibility).
 *
 * Opt in with RUN_POSTGRES_PUBLISHED_IMAGES_TESTS=true and the normal
 * database credentials; PUBLISHED_IMAGES_TEST_DATABASE_HOST / _PORT point
 * it at a database other than the local development one. Every table is
 * created - with only the columns the SQL reads - in a uniquely named
 * schema, inside a transaction rolled back after each test, and the schema
 * is dropped afterwards: no application row is touched.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PUBLISHED_IMAGES_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_A: string = "a0000000-0000-4000-8000-000000000001";
const PROJECT_B: string = "b0000000-0000-4000-8000-000000000001";

function id(): string {
  return ObjectID.generate().toString();
}

function token(): string {
  return id().replace(/-/g, "") + id().replace(/-/g, "");
}

const byToken: (value: string) => string = (value: string): string => {
  return `Before ![shot](https://oneuptime.example/file/image/access-token/${value}) after`;
};

const byId: (fileId: string) => string = (fileId: string): string => {
  return `![logo](https://oneuptime.example/file/image/${fileId})`;
};

// The tables the SQL reads, with the columns it reads.
function createTablesSql(): Array<string> {
  const statements: Array<string> = [
    `CREATE TABLE "File" ("_id" uuid PRIMARY KEY, "projectId" uuid, "imageAccessToken" character varying(100) UNIQUE, "isPublic" boolean NOT NULL DEFAULT false, "deletedAt" TIMESTAMP WITH TIME ZONE)`,
    `CREATE TABLE "Probe" ("_id" uuid DEFAULT gen_random_uuid(), "projectId" uuid, "iconFileId" uuid)`,
    `CREATE TABLE "AIAgent" ("_id" uuid DEFAULT gen_random_uuid(), "projectId" uuid, "iconFileId" uuid)`,
  ];

  const tables: Map<string, Set<string>> = new Map();

  const columnsOf: (tableName: string) => Set<string> = (
    tableName: string,
  ): Set<string> => {
    if (!tables.has(tableName)) {
      tables.set(
        tableName,
        new Set<string>([
          `"projectId" uuid`,
          `"deletedAt" TIMESTAMP WITH TIME ZONE`,
        ]),
      );
    }

    return tables.get(tableName)!;
  };

  for (const source of [...PUBLISHED_MARKDOWN, ...KEPT_MARKDOWN]) {
    const columns: Set<string> = columnsOf(source.tableName);

    for (const column of source.markdownColumns) {
      columns.add(
        `"${column}" ${column === "customFields" ? "jsonb" : "text"}`,
      );
    }

    for (const column of [...source.shownWhen, ...(source.hiddenWhen || [])]) {
      columns.add(`"${column}" boolean`);
    }

    if (source.shownFrom) {
      columns.add(`"${source.shownFrom}" TIMESTAMP WITH TIME ZONE`);
    }
  }

  // Read by the status page, never by the image rule: ending one hides nothing.
  columnsOf("StatusPageAnnouncement").add(
    `"endAnnouncementAt" TIMESTAMP WITH TIME ZONE`,
  );

  // The column naming the parent row, on every table a delete cascades to.
  for (const cascade of CASCADES) {
    columnsOf(cascade.tableName).add(`"${cascade.foreignKey}" uuid`);
  }

  for (const [table, columns] of tables) {
    statements.push(
      `CREATE TABLE "${table}" ("_id" uuid DEFAULT gen_random_uuid(), ${Array.from(columns).join(", ")})`,
    );
  }

  return statements;
}

describePostgres("PublishedImages against Postgres", () => {
  const schema: string = `published_images_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;
  let runner: QueryRunner;

  async function insertFile(data: {
    projectId: string | null;
    isPublic: boolean;
    imageAccessToken?: string;
  }): Promise<string> {
    const fileId: string = id();

    await runner.query(
      `INSERT INTO "File" ("_id", "projectId", "imageAccessToken", "isPublic") VALUES ($1, $2, $3, $4)`,
      [fileId, data.projectId, data.imageAccessToken || null, data.isPublic],
    );

    return fileId;
  }

  /*
   * A record of a table, with the values given (switches that show it on by
   * default; one that hides it, such as Private, left unset - NULL, off; a
   * time it is shown from, an hour ago). A record shown under another (a
   * public note) is put under a shown one of its project, unless the values
   * name one.
   */
  async function insertRecord(
    source: PublishedMarkdown,
    values: Record<string, unknown>,
  ): Promise<string> {
    const row: Record<string, unknown> = { _id: id() };

    for (const column of source.shownWhen) {
      row[column] = true;
    }

    if (source.shownFrom) {
      row[source.shownFrom] = new Date(Date.now() - 60 * 60 * 1000);
    }

    if (
      source.shownUnder &&
      values[source.shownUnder.foreignKey] === undefined
    ) {
      row[source.shownUnder.foreignKey] = await insertParent(source, {
        projectId: values["projectId"],
      });
    }

    Object.assign(row, values);

    const columns: Array<string> = Object.keys(row);

    await runner.query(
      `INSERT INTO "${source.tableName}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );

    return row["_id"] as string;
  }

  /*
   * The record a source's rows are shown under (shownUnder): shown unless
   * the values say otherwise.
   */
  async function insertParent(
    source: PublishedMarkdown,
    values: Record<string, unknown>,
  ): Promise<string> {
    const parent: PublishedParent = source.shownUnder!;
    const row: Record<string, unknown> = { _id: id() };

    for (const column of parent.shownWhen) {
      row[column] = true;
    }

    Object.assign(row, values);

    const columns: Array<string> = Object.keys(row);

    await runner.query(
      `INSERT INTO "${parent.tableName}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );

    return row["_id"] as string;
  }

  function sourceOf(tableName: string, column: string): PublishedMarkdown {
    const source: PublishedMarkdown | undefined = [
      ...PUBLISHED_MARKDOWN,
      ...KEPT_MARKDOWN,
    ].find((candidate: PublishedMarkdown): boolean => {
      return (
        candidate.tableName === tableName &&
        candidate.markdownColumns.includes(column)
      );
    });

    expect(source).toBeDefined();

    return source!;
  }

  async function isPublic(fileId: string): Promise<boolean> {
    const rows: Array<{ isPublic: boolean }> = await runner.query(
      `SELECT "isPublic" FROM "File" WHERE "_id" = $1`,
      [fileId],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!.isPublic;
  }

  async function affected(
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<number> {
    const result: unknown = await runner.query(sql, parameters);

    return Array.isArray(result) && typeof result[1] === "number"
      ? result[1]
      : -1;
  }

  // Which of the images a record of the project still shows, as asked.
  async function stillShownOf(
    projectId: string,
    imageTokens: Array<string>,
    now: Date = new Date(),
  ): Promise<Array<string>> {
    const rows: Array<{ token: string }> = await runner.query(STILL_SHOWN_SQL, [
      projectId,
      imageTokens.map((imageToken: string): string => {
        return `%/file/image/access-token/${imageToken}%`;
      }),
      imageTokens,
      now,
    ]);

    return rows
      .map((row: { token: string }): string => {
        return row.token;
      })
      .sort();
  }

  async function stillShown(
    projectId: string,
    imageToken: string,
  ): Promise<boolean> {
    return (await stillShownOf(projectId, [imageToken])).length > 0;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["PUBLISHED_IMAGES_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PUBLISHED_IMAGES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    runner = database.createQueryRunner();
    await runner.connect();

    const currentSchema: Array<{ current_schema: string }> = await runner.query(
      "SELECT current_schema()",
    );
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    await runner.startTransaction();

    for (const statement of createTablesSql()) {
      await runner.query(statement);
    }
  });

  afterEach(async () => {
    if (runner?.isTransactionActive) {
      await runner.rollbackTransaction();
    }
  });

  afterAll(async () => {
    if (runner) {
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("PUBLISH_SHOWN_IMAGES_SQL", () => {
    test.each(
      PUBLISHED_MARKDOWN.flatMap((source: PublishedMarkdown) => {
        return source.markdownColumns.map((column: string) => {
          return {
            table: source.tableName,
            column: column,
            source: source,
          };
        });
      }),
    )(
      "makes an image a shown $table $column of its own project public",
      async ({
        column,
        source,
      }: {
        column: string;
        source: PublishedMarkdown;
      }) => {
        const imageToken: string = token();
        const fileId: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: false,
          imageAccessToken: imageToken,
        });

        await insertRecord(source, {
          projectId: PROJECT_A,
          [column]: byToken(imageToken),
        });

        expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(1);
        expect(await isPublic(fileId)).toBe(true);
      },
    );

    test("leaves private what a record does not show: a hidden incident, an unpublished postmortem, a deleted note", async () => {
      const hiddenDescription: string = token();
      const unpublishedPostmortem: string = token();
      const postmortemOfHiddenIncident: string = token();
      const deletedNote: string = token();

      const fileIds: Array<string> = [];

      for (const imageToken of [
        hiddenDescription,
        unpublishedPostmortem,
        postmortemOfHiddenIncident,
        deletedNote,
      ]) {
        fileIds.push(
          await insertFile({
            projectId: PROJECT_A,
            isPublic: false,
            imageAccessToken: imageToken,
          }),
        );
      }

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byToken(hiddenDescription),
        isVisibleOnStatusPage: false,
      });
      await insertRecord(sourceOf("Incident", "postmortemNote"), {
        projectId: PROJECT_A,
        postmortemNote: byToken(unpublishedPostmortem),
        isVisibleOnStatusPage: true,
        showPostmortemOnStatusPage: false,
      });
      await insertRecord(sourceOf("Incident", "postmortemNote"), {
        projectId: PROJECT_A,
        postmortemNote: byToken(postmortemOfHiddenIncident),
        isVisibleOnStatusPage: false,
        showPostmortemOnStatusPage: true,
      });
      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: byToken(deletedNote),
        deletedAt: new Date(),
      });

      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(0);

      for (const fileId of fileIds) {
        expect(await isPublic(fileId)).toBe(false);
      }
    });

    test("leaves private every image of a private incident or episode, even with Visible on Status Page on", async () => {
      const description: string = token();
      const postmortem: string = token();
      const customField: string = token();
      const episodeDescription: string = token();

      const fileIds: Array<string> = [];

      for (const imageToken of [
        description,
        postmortem,
        customField,
        episodeDescription,
      ]) {
        fileIds.push(
          await insertFile({
            projectId: PROJECT_A,
            isPublic: false,
            imageAccessToken: imageToken,
          }),
        );
      }

      await runner.query(
        `INSERT INTO "Incident" ("projectId", "description", "postmortemNote", "customFields", "isVisibleOnStatusPage", "showPostmortemOnStatusPage", "isPrivate") VALUES ($1, $2, $3, $4, true, true, true)`,
        [
          PROJECT_A,
          byToken(description),
          byToken(postmortem),
          JSON.stringify({ impact: { value: byToken(customField) } }),
        ],
      );
      await insertRecord(sourceOf("IncidentEpisode", "description"), {
        projectId: PROJECT_A,
        description: byToken(episodeDescription),
        isPrivate: true,
      });

      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(0);

      for (const fileId of fileIds) {
        expect(await isPublic(fileId)).toBe(false);
      }
    });

    test("a Private never set, or off, publishes as before", async () => {
      const neverSet: string = token();
      const off: string = token();
      const neverSetFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
        imageAccessToken: neverSet,
      });
      const offFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
        imageAccessToken: off,
      });

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byToken(neverSet),
      });
      await insertRecord(sourceOf("IncidentEpisode", "description"), {
        projectId: PROJECT_A,
        description: byToken(off),
        isPrivate: false,
      });

      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(2);
      expect(await isPublic(neverSetFileId)).toBe(true);
      expect(await isPublic(offFileId)).toBe(true);
    });

    test("never makes another project's image, or one with no project, public", async () => {
      const foreign: string = token();
      const unowned: string = token();

      const foreignFileId: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: false,
        imageAccessToken: foreign,
      });
      const unownedFileId: string = await insertFile({
        projectId: null,
        isPublic: false,
        imageAccessToken: unowned,
      });

      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: `${byToken(foreign)} ${byToken(unowned)}`,
      });

      await affected(PUBLISH_SHOWN_IMAGES_SQL);

      expect(await isPublic(foreignFileId)).toBe(false);
      expect(await isPublic(unownedFileId)).toBe(false);
    });

    test("reads every image of a record, and an incident's two texts", async () => {
      const first: string = token();
      const second: string = token();
      const postmortem: string = token();

      const fileIds: Array<string> = [];

      for (const imageToken of [first, second, postmortem]) {
        fileIds.push(
          await insertFile({
            projectId: PROJECT_A,
            isPublic: false,
            imageAccessToken: imageToken,
          }),
        );
      }

      await runner.query(
        `INSERT INTO "Incident" ("projectId", "description", "postmortemNote", "isVisibleOnStatusPage", "showPostmortemOnStatusPage") VALUES ($1, $2, $3, true, true)`,
        [
          PROJECT_A,
          `${byToken(first)}\n\n${byToken(second)}`,
          byToken(postmortem),
        ],
      );

      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(3);

      for (const fileId of fileIds) {
        expect(await isPublic(fileId)).toBe(true);
      }
    });
  });

  describe("HIDE_UNSHOWN_FILES_SQL", () => {
    test("makes a public file nothing published shows private, and leaves private files alone", async () => {
      const orphan: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });
      const alreadyPrivate: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
      expect(await isPublic(orphan)).toBe(false);
      expect(await isPublic(alreadyPrivate)).toBe(false);
    });

    test("keeps every probe's and AI agent's icon public, of any project or none", async () => {
      const probeIcon: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });
      const globalProbeIcon: string = await insertFile({
        projectId: null,
        isPublic: true,
      });
      const agentIcon: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: true,
      });

      await runner.query(
        `INSERT INTO "Probe" ("projectId", "iconFileId") VALUES ($1, $2), (NULL, $3)`,
        [PROJECT_A, probeIcon, globalProbeIcon],
      );
      await runner.query(
        `INSERT INTO "AIAgent" ("projectId", "iconFileId") VALUES ($1, $2)`,
        [PROJECT_B, agentIcon],
      );

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(0);

      for (const fileId of [probeIcon, globalProbeIcon, agentIcon]) {
        expect(await isPublic(fileId)).toBe(true);
      }
    });

    test("keeps an image any project's published record shows, by token or by id", async () => {
      const shownByOtherProject: string = token();
      const otherProjectsImage: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: true,
        imageAccessToken: shownByOtherProject,
      });
      const linkedById: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });

      await insertRecord(sourceOf("StatusPageAnnouncement", "description"), {
        projectId: PROJECT_A,
        description: `${byToken(shownByOtherProject)} ${byId(linkedById.toUpperCase())}`,
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(0);
      expect(await isPublic(otherProjectsImage)).toBe(true);
      expect(await isPublic(linkedById)).toBe(true);
    });

    test("keeps an image a form's public page shows", async () => {
      const onForm: string = token();
      const fileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: onForm,
      });

      await insertRecord(sourceOf("Form", "description"), {
        projectId: PROJECT_A,
        description: byToken(onForm),
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(0);
      expect(await isPublic(fileId)).toBe(true);
    });

    test("keeps an image a shown incident's custom fields send out, not a hidden one's", async () => {
      const sent: string = token();
      const neverSent: string = token();
      const sentFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: sent,
      });
      const neverSentFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: neverSent,
      });

      await runner.query(
        `INSERT INTO "Incident" ("projectId", "customFields", "isVisibleOnStatusPage") VALUES ($1, $2, true), ($1, $3, false)`,
        [
          PROJECT_A,
          JSON.stringify({ impact: { value: byToken(sent) } }),
          JSON.stringify({ impact: { value: byToken(neverSent) } }),
        ],
      );

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
      expect(await isPublic(sentFileId)).toBe(true);
      expect(await isPublic(neverSentFileId)).toBe(false);
    });

    test("makes private an image only a private incident shows, even with Visible on Status Page on", async () => {
      const onPrivateIncident: string = token();
      const fileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: onPrivateIncident,
      });

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byToken(onPrivateIncident),
        isPrivate: true,
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
      expect(await isPublic(fileId)).toBe(false);
    });

    test("makes private an image only a turned-off form shows", async () => {
      const onForm: string = token();
      const fileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: onForm,
      });

      await insertRecord(sourceOf("Form", "description"), {
        projectId: PROJECT_A,
        description: byToken(onForm),
        isEnabled: false,
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
      expect(await isPublic(fileId)).toBe(false);
    });

    test("makes private an image only a hidden or deleted record shows", async () => {
      const hidden: string = token();
      const deleted: string = token();
      const hiddenFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: hidden,
      });
      const deletedFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: deleted,
      });

      await insertRecord(sourceOf("ScheduledMaintenance", "description"), {
        projectId: PROJECT_A,
        description: byToken(hidden),
        isVisibleOnStatusPage: false,
      });
      await insertRecord(sourceOf("StatusPageGroup", "description"), {
        projectId: PROJECT_A,
        description: byToken(deleted),
        deletedAt: new Date(),
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(2);
      expect(await isPublic(hiddenFileId)).toBe(false);
      expect(await isPublic(deletedFileId)).toBe(false);
    });

    test("both statements twice: the second run moves nothing", async () => {
      const shown: string = token();
      const shownFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
        imageAccessToken: shown,
      });
      const orphan: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });

      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: byToken(shown),
      });

      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(1);
      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(0);
      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(0);

      expect(await isPublic(shownFileId)).toBe(true);
      expect(await isPublic(orphan)).toBe(false);
    });
  });

  describe("STILL_SHOWN_SQL", () => {
    test("finds a published record of the project that shows the image", async () => {
      const imageToken: string = token();

      await insertRecord(sourceOf("StatusPage", "overviewPageDescription"), {
        projectId: PROJECT_A,
        overviewPageDescription: byToken(imageToken),
      });

      expect(await stillShown(PROJECT_A, imageToken)).toBe(true);
    });

    test("does not count another project's record, a hidden one, a deleted one, or another image", async () => {
      const imageToken: string = token();

      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_B,
        note: byToken(imageToken),
      });
      await insertRecord(sourceOf("IncidentEpisode", "description"), {
        projectId: PROJECT_A,
        description: byToken(imageToken),
        isVisibleOnStatusPage: false,
      });
      await insertRecord(sourceOf("StatusPageResource", "displayDescription"), {
        projectId: PROJECT_A,
        displayDescription: byToken(imageToken),
        deletedAt: new Date(),
      });
      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: byToken(token()),
      });

      expect(await stillShown(PROJECT_A, imageToken)).toBe(false);
    });

    test("does not count a private incident or episode, even with Visible on Status Page on", async () => {
      const imageToken: string = token();

      await runner.query(
        `INSERT INTO "Incident" ("projectId", "description", "postmortemNote", "customFields", "isVisibleOnStatusPage", "showPostmortemOnStatusPage", "isPrivate") VALUES ($1, $2, $2, $3, true, true, true)`,
        [
          PROJECT_A,
          byToken(imageToken),
          JSON.stringify({ impact: { value: byToken(imageToken) } }),
        ],
      );
      await insertRecord(sourceOf("IncidentEpisode", "description"), {
        projectId: PROJECT_A,
        description: byToken(imageToken),
        isPrivate: true,
      });

      expect(await stillShown(PROJECT_A, imageToken)).toBe(false);

      // Made not private, the same incident shows it again.
      await runner.query(`UPDATE "Incident" SET "isPrivate" = false`);

      expect(await stillShown(PROJECT_A, imageToken)).toBe(true);
    });

    test("an incident's description still shows an image its unpublished postmortem dropped", async () => {
      const imageToken: string = token();

      await runner.query(
        `INSERT INTO "Incident" ("projectId", "description", "postmortemNote", "isVisibleOnStatusPage", "showPostmortemOnStatusPage") VALUES ($1, $2, $2, true, false)`,
        [PROJECT_A, byToken(imageToken)],
      );

      expect(await stillShown(PROJECT_A, imageToken)).toBe(true);
    });

    test("answers every image asked in one statement: those still shown or sent out, each once", async () => {
      const shownByNote: string = token();
      const shownTwice: string = token();
      const onFormPage: string = token();
      const inCustomField: string = token();
      const shownByNothing: string = token();
      const onHiddenIncident: string = token();
      const inHiddenCustomField: string = token();
      const onTurnedOffForm: string = token();

      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: `${byToken(shownByNote)} ${byToken(shownTwice)}`,
      });
      await insertRecord(sourceOf("StatusPageGroup", "description"), {
        projectId: PROJECT_A,
        description: byToken(shownTwice),
      });
      await insertRecord(sourceOf("Form", "successMessage"), {
        projectId: PROJECT_A,
        successMessage: byToken(onFormPage),
      });
      await insertRecord(sourceOf("Form", "description"), {
        projectId: PROJECT_A,
        description: byToken(onTurnedOffForm),
        isEnabled: false,
      });
      // A shown incident sends its custom fields; a hidden one shows nothing.
      await runner.query(
        `INSERT INTO "Incident" ("projectId", "customFields", "isVisibleOnStatusPage") VALUES ($1, $2, true)`,
        [
          PROJECT_A,
          JSON.stringify({ impact: { value: byToken(inCustomField) } }),
        ],
      );
      await runner.query(
        `INSERT INTO "Incident" ("projectId", "customFields", "description", "isVisibleOnStatusPage") VALUES ($1, $2, $3, false)`,
        [
          PROJECT_A,
          JSON.stringify({ impact: { value: byToken(inHiddenCustomField) } }),
          byToken(onHiddenIncident),
        ],
      );

      expect(
        await stillShownOf(PROJECT_A, [
          shownByNote,
          shownTwice,
          onFormPage,
          inCustomField,
          shownByNothing,
          onHiddenIncident,
          inHiddenCustomField,
          onTurnedOffForm,
        ]),
      ).toEqual([shownByNote, shownTwice, onFormPage, inCustomField].sort());

      // Another project's records keep nothing of project A's.
      expect(await stillShownOf(PROJECT_B, [shownByNote, onFormPage])).toEqual(
        [],
      );
    });

    test("never answers an image it was not asked about", async () => {
      const asked: string = token();
      const notAsked: string = token();

      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: `${byToken(asked)} ${byToken(notAsked)}`,
      });

      expect(await stillShownOf(PROJECT_A, [asked])).toEqual([asked]);
    });
  });

  describe("HIDE_PRIVATE_RECORD_IMAGES_SQL", () => {
    test("makes private every public image a private incident or episode of the file's project holds", async () => {
      const description: string = token();
      const postmortem: string = token();
      const customField: string = token();
      const episodeDescription: string = token();

      const fileIds: Array<string> = [];

      for (const imageToken of [
        description,
        postmortem,
        customField,
        episodeDescription,
      ]) {
        fileIds.push(
          await insertFile({
            projectId: PROJECT_A,
            isPublic: true,
            imageAccessToken: imageToken,
          }),
        );
      }

      await runner.query(
        `INSERT INTO "Incident" ("projectId", "description", "postmortemNote", "customFields", "isVisibleOnStatusPage", "showPostmortemOnStatusPage", "isPrivate") VALUES ($1, $2, $3, $4, true, true, true)`,
        [
          PROJECT_A,
          byToken(description),
          byToken(postmortem),
          JSON.stringify({ impact: { value: byToken(customField) } }),
        ],
      );
      await insertRecord(sourceOf("IncidentEpisode", "description"), {
        projectId: PROJECT_A,
        description: byToken(episodeDescription),
        isPrivate: true,
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(4);

      for (const fileId of fileIds) {
        expect(await isPublic(fileId)).toBe(false);
      }
    });

    test("keeps public an image a published record still shows, by its token or by its id", async () => {
      const alsoOnAnnouncement: string = token();
      const alsoLinkedById: string = token();
      const onAnnouncementFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: alsoOnAnnouncement,
      });
      const linkedByIdFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: alsoLinkedById,
      });

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: `${byToken(alsoOnAnnouncement)} ${byToken(alsoLinkedById)}`,
        isPrivate: true,
      });
      await insertRecord(sourceOf("StatusPageAnnouncement", "description"), {
        projectId: PROJECT_A,
        description: `${byToken(alsoOnAnnouncement)} ${byId(linkedByIdFileId)}`,
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(0);
      expect(await isPublic(onAnnouncementFileId)).toBe(true);
      expect(await isPublic(linkedByIdFileId)).toBe(true);
    });

    test("makes private an image a private record holds by its id, as hand-written markdown addresses it", async () => {
      const byIdFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: token(),
      });
      const unownedByIdFileId: string = await insertFile({
        projectId: null,
        isPublic: true,
        imageAccessToken: token(),
      });

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: `${byId(byIdFileId)} ${byId(unownedByIdFileId.toUpperCase())}`,
        isPrivate: true,
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(2);
      expect(await isPublic(byIdFileId)).toBe(false);
      expect(await isPublic(unownedByIdFileId)).toBe(false);
    });

    test("by its id too, moves nothing else: another project's image, one a published record still shows, a hidden record's", async () => {
      const foreignFileId: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: true,
        imageAccessToken: token(),
      });
      const stillShownFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: token(),
      });
      const onHiddenFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: token(),
      });

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: `${byId(foreignFileId)} ${byId(stillShownFileId)}`,
        isPrivate: true,
      });
      await insertRecord(sourceOf("StatusPageAnnouncement", "description"), {
        projectId: PROJECT_A,
        description: byId(stillShownFileId),
      });
      // Hidden, but not private: left to the switch, as before.
      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byId(onHiddenFileId),
        isVisibleOnStatusPage: false,
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(0);

      for (const fileId of [foreignFileId, stillShownFileId, onHiddenFileId]) {
        expect(await isPublic(fileId)).toBe(true);
      }
    });

    test("makes private an image of no project a private record holds: a file from before files had a project", async () => {
      const unowned: string = token();
      const unownedFileId: string = await insertFile({
        projectId: null,
        isPublic: true,
        imageAccessToken: unowned,
      });

      await insertRecord(sourceOf("Incident", "postmortemNote"), {
        projectId: PROJECT_A,
        postmortemNote: byToken(unowned),
        isPrivate: true,
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(1);
      expect(await isPublic(unownedFileId)).toBe(false);
    });

    test("keeps a probe's or an AI agent's icon public", async () => {
      const iconToken: string = token();
      const iconFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: iconToken,
      });

      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byToken(iconToken),
        isPrivate: true,
      });
      await runner.query(
        `INSERT INTO "Probe" ("projectId", "iconFileId") VALUES ($1, $2)`,
        [PROJECT_A, iconFileId],
      );

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(0);
      expect(await isPublic(iconFileId)).toBe(true);
    });

    test("moves nothing else: another project's image, an image no private record holds, a hidden record's, a deleted one's, a private file", async () => {
      const foreign: string = token();
      const orphan: string = token();
      const onHiddenIncident: string = token();
      const onDeletedPrivateIncident: string = token();
      const alreadyPrivate: string = token();

      const foreignFileId: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: true,
        imageAccessToken: foreign,
      });
      const orphanFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: orphan,
      });
      const hiddenFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: onHiddenIncident,
      });
      const deletedFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: onDeletedPrivateIncident,
      });
      const privateFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
        imageAccessToken: alreadyPrivate,
      });

      // Project A's private incident names project B's image.
      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: `${byToken(foreign)} ${byToken(alreadyPrivate)}`,
        isPrivate: true,
      });
      // Hidden, but not private: left to the switch, as before.
      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byToken(onHiddenIncident),
        isVisibleOnStatusPage: false,
      });
      await insertRecord(sourceOf("Incident", "description"), {
        projectId: PROJECT_A,
        description: byToken(onDeletedPrivateIncident),
        isPrivate: true,
        deletedAt: new Date(),
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(0);

      for (const fileId of [
        foreignFileId,
        orphanFileId,
        hiddenFileId,
        deletedFileId,
      ]) {
        expect(await isPublic(fileId)).toBe(true);
      }
      expect(await isPublic(privateFileId)).toBe(false);
    });

    test("a second run moves nothing, and it never makes an image public", async () => {
      const imageToken: string = token();
      const fileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: imageToken,
      });
      const privateImage: string = token();
      const privateFileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
        imageAccessToken: privateImage,
      });

      await insertRecord(sourceOf("IncidentEpisode", "description"), {
        projectId: PROJECT_A,
        description: byToken(imageToken),
        isPrivate: true,
      });
      // Shown by a public note: stays as it is, private.
      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: byToken(privateImage),
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(1);
      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(0);
      expect(await isPublic(fileId)).toBe(false);
      expect(await isPublic(privateFileId)).toBe(false);
    });
  });

  /*
   * A public note is shown on a status page only with its incident, episode
   * or scheduled maintenance event: its images count as shown only while
   * that record is shown, of the note's own project.
   */
  describe("a public note follows the record it is shown under", () => {
    const NOTE_SOURCES: Array<{ table: string; parent: string }> = [
      { table: "IncidentPublicNote", parent: "Incident" },
      { table: "IncidentEpisodePublicNote", parent: "IncidentEpisode" },
      {
        table: "ScheduledMaintenancePublicNote",
        parent: "ScheduledMaintenance",
      },
    ];

    async function noteUnder(data: {
      table: string;
      imageToken?: string;
      note?: string;
      projectId?: string;
      parent: Record<string, unknown>;
      parentProjectId?: string;
    }): Promise<{ noteId: string; parentId: string }> {
      const source: PublishedMarkdown = sourceOf(data.table, "note");
      const parentId: string = await insertParent(source, {
        projectId: data.parentProjectId || data.projectId || PROJECT_A,
        ...data.parent,
      });
      const noteId: string = await insertRecord(source, {
        projectId: data.projectId || PROJECT_A,
        note: data.note || byToken(data.imageToken!),
        [source.shownUnder!.foreignKey]: parentId,
      });

      return { noteId, parentId };
    }

    test.each(NOTE_SOURCES)(
      "STILL_SHOWN_SQL counts a $table note only while its $parent is shown",
      async ({ table }: { table: string; parent: string }) => {
        const shownToken: string = token();
        const hiddenToken: string = token();

        await noteUnder({ table, imageToken: shownToken, parent: {} });
        await noteUnder({
          table,
          imageToken: hiddenToken,
          parent: { isVisibleOnStatusPage: false },
        });

        expect(
          await stillShownOf(PROJECT_A, [shownToken, hiddenToken]),
        ).toEqual([shownToken]);
      },
    );

    test("a note of a private incident or episode is not counted, with Visible on Status Page on", async () => {
      const incidentNote: string = token();
      const episodeNote: string = token();

      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: incidentNote,
        parent: { isPrivate: true },
      });
      await noteUnder({
        table: "IncidentEpisodePublicNote",
        imageToken: episodeNote,
        parent: { isPrivate: true },
      });

      expect(
        await stillShownOf(PROJECT_A, [incidentNote, episodeNote]),
      ).toEqual([]);
    });

    test("a note of a deleted record, or of a record of another project, is not counted", async () => {
      const deletedParent: string = token();
      const otherProjectParent: string = token();

      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: deletedParent,
        parent: { deletedAt: new Date() },
      });
      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: otherProjectParent,
        parent: {},
        parentProjectId: PROJECT_B,
      });

      expect(
        await stillShownOf(PROJECT_A, [deletedParent, otherProjectParent]),
      ).toEqual([]);
    });

    test("PUBLISH_SHOWN_IMAGES_SQL leaves private the images of notes of hidden or private records", async () => {
      const hidden: string = token();
      const privateEpisode: string = token();
      const hiddenEvent: string = token();
      const shown: string = token();

      const fileIds: Map<string, string> = new Map();

      for (const imageToken of [hidden, privateEpisode, hiddenEvent, shown]) {
        fileIds.set(
          imageToken,
          await insertFile({
            projectId: PROJECT_A,
            isPublic: false,
            imageAccessToken: imageToken,
          }),
        );
      }

      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: hidden,
        parent: { isVisibleOnStatusPage: false },
      });
      await noteUnder({
        table: "IncidentEpisodePublicNote",
        imageToken: privateEpisode,
        parent: { isPrivate: true },
      });
      await noteUnder({
        table: "ScheduledMaintenancePublicNote",
        imageToken: hiddenEvent,
        parent: { isVisibleOnStatusPage: false },
      });
      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: shown,
        parent: {},
      });

      expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(1);
      expect(await isPublic(fileIds.get(shown)!)).toBe(true);

      for (const imageToken of [hidden, privateEpisode, hiddenEvent]) {
        expect(await isPublic(fileIds.get(imageToken)!)).toBe(false);
      }
    });

    test("HIDE_UNSHOWN_FILES_SQL makes private an image only a note of a hidden record shows", async () => {
      const hidden: string = token();
      const fileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: hidden,
      });

      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: hidden,
        parent: { isVisibleOnStatusPage: false },
      });

      expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
      expect(await isPublic(fileId)).toBe(false);
    });

    /*
     * A private incident's own image, which one of its own public notes
     * holds too, is no longer kept public by that note.
     */
    test("HIDE_PRIVATE_RECORD_IMAGES_SQL no longer keeps a private incident's image public through its own note", async () => {
      const imageToken: string = token();
      const fileId: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: imageToken,
      });

      const incidentId: string = id();

      await runner.query(
        `INSERT INTO "Incident" ("_id", "projectId", "description", "isVisibleOnStatusPage", "isPrivate") VALUES ($1, $2, $3, true, true)`,
        [incidentId, PROJECT_A, byToken(imageToken)],
      );
      await insertRecord(sourceOf("IncidentPublicNote", "note"), {
        projectId: PROJECT_A,
        note: byToken(imageToken),
        incidentId: incidentId,
      });

      expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(1);
      expect(await isPublic(fileId)).toBe(false);
    });

    test("getShownParentsSql answers the shown records asked about, with their projects", async () => {
      const source: PublishedMarkdown = sourceOf("IncidentPublicNote", "note");
      const shown: string = await insertParent(source, {
        projectId: PROJECT_A,
      });
      const hidden: string = await insertParent(source, {
        projectId: PROJECT_A,
        isVisibleOnStatusPage: false,
      });
      const privateOne: string = await insertParent(source, {
        projectId: PROJECT_A,
        isPrivate: true,
      });
      const deleted: string = await insertParent(source, {
        projectId: PROJECT_A,
        deletedAt: new Date(),
      });
      const notAsked: string = await insertParent(source, {
        projectId: PROJECT_B,
      });

      const rows: Array<{ _id: string; projectId: string }> =
        await runner.query(getShownParentsSql(source.shownUnder!), [
          [shown, hidden, privateOne, deleted],
        ]);

      expect(rows).toEqual([{ _id: shown, projectId: PROJECT_A }]);
      expect(notAsked).toBeDefined();
    });

    test("getRowsShownUnderSql reads the notes of the records asked about that carry an image", async () => {
      const source: PublishedMarkdown = sourceOf("IncidentPublicNote", "note");
      const imageToken: string = token();

      const { noteId, parentId } = await noteUnder({
        table: "IncidentPublicNote",
        imageToken: imageToken,
        parent: {},
      });

      // Without an image, deleted, or of another record: not read.
      await insertRecord(source, {
        projectId: PROJECT_A,
        note: "No pictures.",
        incidentId: parentId,
      });
      await insertRecord(source, {
        projectId: PROJECT_A,
        note: byToken(token()),
        incidentId: parentId,
        deletedAt: new Date(),
      });
      await noteUnder({
        table: "IncidentPublicNote",
        imageToken: token(),
        parent: {},
      });

      const rows: Array<Record<string, unknown>> = await runner.query(
        getRowsShownUnderSql(source),
        [[parentId]],
      );

      expect(rows).toEqual([
        {
          _id: noteId,
          projectId: PROJECT_A,
          incidentId: parentId,
          note: byToken(imageToken),
        },
      ]);
    });
  });

  /*
   * Once, for images public notes made public whatever their record showed,
   * and those a private record kept public through its own notes.
   */
  describe("HIDE_HIDDEN_RECORD_IMAGES_SQL", () => {
    async function noteWith(data: {
      table: string;
      note: string;
      parent: Record<string, unknown>;
      projectId?: string;
    }): Promise<void> {
      const source: PublishedMarkdown = sourceOf(data.table, "note");
      const parentId: string = await insertParent(source, {
        projectId: data.projectId || PROJECT_A,
        ...data.parent,
      });

      await insertRecord(source, {
        projectId: data.projectId || PROJECT_A,
        note: data.note,
        [source.shownUnder!.foreignKey]: parentId,
      });
    }

    test("makes private the public images of notes of hidden or private records, and of private records", async () => {
      const tokens: Array<string> = [
        token(),
        token(),
        token(),
        token(),
        token(),
      ];
      const fileIds: Array<string> = [];

      for (const imageToken of tokens) {
        fileIds.push(
          await insertFile({
            projectId: PROJECT_A,
            isPublic: true,
            imageAccessToken: imageToken,
          }),
        );
      }

      await noteWith({
        table: "IncidentPublicNote",
        note: byToken(tokens[0]!),
        parent: { isVisibleOnStatusPage: false },
      });
      await noteWith({
        table: "IncidentPublicNote",
        note: byToken(tokens[1]!),
        parent: { isPrivate: true },
      });
      await noteWith({
        table: "IncidentEpisodePublicNote",
        note: byToken(tokens[2]!),
        parent: { isVisibleOnStatusPage: false },
      });
      await noteWith({
        table: "ScheduledMaintenancePublicNote",
        note: byToken(tokens[3]!),
        parent: { isVisibleOnStatusPage: false },
      });
      await runner.query(
        `INSERT INTO "Incident" ("projectId", "description", "isVisibleOnStatusPage", "isPrivate") VALUES ($1, $2, true, true)`,
        [PROJECT_A, byToken(tokens[4]!)],
      );

      expect(await affected(HIDE_HIDDEN_RECORD_IMAGES_SQL)).toBe(5);

      for (const fileId of fileIds) {
        expect(await isPublic(fileId)).toBe(false);
      }
    });

    test("by its id too, and an image of no project", async () => {
      const byIdFile: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });
      const noProject: string = token();
      const noProjectFile: string = await insertFile({
        projectId: null,
        isPublic: true,
        imageAccessToken: noProject,
      });

      await noteWith({
        table: "IncidentPublicNote",
        note: `${byId(byIdFile)} ${byToken(noProject)}`,
        parent: { isVisibleOnStatusPage: false },
      });

      expect(await affected(HIDE_HIDDEN_RECORD_IMAGES_SQL)).toBe(2);
      expect(await isPublic(byIdFile)).toBe(false);
      expect(await isPublic(noProjectFile)).toBe(false);
    });

    test("keeps what a shown record still shows, another project's image, and icons", async () => {
      const stillShown: string = token();
      const otherProject: string = token();
      const icon: string = token();

      const stillShownFile: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: stillShown,
      });
      const otherProjectFile: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: true,
        imageAccessToken: otherProject,
      });
      const iconFile: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: icon,
      });

      await runner.query(
        `INSERT INTO "Probe" ("projectId", "iconFileId") VALUES ($1, $2)`,
        [PROJECT_A, iconFile],
      );

      await noteWith({
        table: "IncidentPublicNote",
        note: `${byToken(stillShown)} ${byToken(otherProject)} ${byToken(icon)}`,
        parent: { isVisibleOnStatusPage: false },
      });
      // The same image, in a note of a shown incident.
      await noteWith({
        table: "IncidentPublicNote",
        note: byToken(stillShown),
        parent: {},
      });

      expect(await affected(HIDE_HIDDEN_RECORD_IMAGES_SQL)).toBe(0);

      for (const fileId of [stillShownFile, otherProjectFile, iconFile]) {
        expect(await isPublic(fileId)).toBe(true);
      }
    });

    test("never makes an image public, and a second run moves nothing", async () => {
      const shownButPrivate: string = token();
      const hidden: string = token();

      const shownButPrivateFile: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
        imageAccessToken: shownButPrivate,
      });
      await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
        imageAccessToken: hidden,
      });

      await noteWith({
        table: "IncidentPublicNote",
        note: byToken(shownButPrivate),
        parent: {},
      });
      await noteWith({
        table: "IncidentPublicNote",
        note: byToken(hidden),
        parent: { isVisibleOnStatusPage: false },
      });

      expect(await affected(HIDE_HIDDEN_RECORD_IMAGES_SQL)).toBe(1);
      expect(await affected(HIDE_HIDDEN_RECORD_IMAGES_SQL)).toBe(0);
      expect(await isPublic(shownButPrivateFile)).toBe(false);
    });
  });

  describe("getCascadedRowsSql: the rows a delete takes with it", () => {
    test.each(
      CASCADES.map((cascade: PublishedCascade) => {
        return { ...cascade };
      }),
    )(
      "reads the $tableName rows of a deleted $parentTable ($foreignKey), with what they show",
      async (cascade: PublishedCascade) => {
        const parentId: string = id();
        const otherParentId: string = id();
        const childId: string = id();

        const insertChild: (
          rowId: string,
          parent: string,
          deletedAt: Date | null,
        ) => Promise<void> = async (
          rowId: string,
          parent: string,
          deletedAt: Date | null,
        ): Promise<void> => {
          await runner.query(
            `INSERT INTO "${cascade.tableName}" ("_id", "projectId", "${cascade.foreignKey}", "deletedAt") VALUES ($1, $2, $3, $4)`,
            [rowId, PROJECT_A, parent, deletedAt],
          );
        };

        await insertChild(childId, parentId, null);
        await insertChild(id(), otherParentId, null);
        await insertChild(id(), parentId, new Date());

        const rows: Array<Record<string, unknown>> = await runner.query(
          getCascadedRowsSql(cascade),
          [[parentId]],
        );

        expect(
          rows.map((row: Record<string, unknown>): string => {
            return String(row["_id"]);
          }),
        ).toEqual([childId]);
        expect(rows[0]!["projectId"]).toBe(PROJECT_A);
      },
    );
  });

  /*
   * AN ANNOUNCEMENT SHOWS ITS IMAGES FROM THE TIME IT IS SHOWN FROM.
   *
   * Status pages hold back an announcement scheduled for later and show it
   * from its Start Showing Announcement At on - ended ones too, under their
   * past announcements and by their link. Its images follow, decided by the
   * database: private before, public from then on.
   */
  describe("an announcement shows its images from the time it is shown from", () => {
    const HOUR: number = 60 * 60 * 1000;

    function announcement(): PublishedMarkdown {
      return sourceOf("StatusPageAnnouncement", "description");
    }

    async function insertAnnouncementImage(data: {
      shownFrom: Date;
      endsAt?: Date | undefined;
      projectId?: string | undefined;
      fileProjectId?: string | null | undefined;
      isPublic?: boolean | undefined;
      deletedAt?: Date | undefined;
    }): Promise<{ fileId: string; imageToken: string }> {
      const imageToken: string = token();
      const fileId: string = await insertFile({
        projectId:
          data.fileProjectId === undefined ? PROJECT_A : data.fileProjectId,
        isPublic: data.isPublic === true,
        imageAccessToken: imageToken,
      });

      await insertRecord(announcement(), {
        projectId: data.projectId || PROJECT_A,
        description: byToken(imageToken),
        showAnnouncementAt: data.shownFrom,
        ...(data.endsAt ? { endAnnouncementAt: data.endsAt } : {}),
        ...(data.deletedAt ? { deletedAt: data.deletedAt } : {}),
      });

      return { fileId, imageToken };
    }

    // PUBLISH_WHEN_SHOWN_SQL as the image route runs it, as of `now`.
    async function publishWhenShown(
      fileId: string,
      imageToken: string,
      now: Date,
      projectId: string = PROJECT_A,
    ): Promise<number> {
      return await affected(PUBLISH_WHEN_SHOWN_SQL, [
        fileId,
        projectId,
        imageToken,
        now,
        `%/file/image/access-token/${imageToken}%`,
      ]);
    }

    describe("STILL_SHOWN_SQL", () => {
      test("counts an announcement once its time has come by the time asked, not before", async () => {
        const now: Date = new Date();
        const scheduled: { imageToken: string } = await insertAnnouncementImage(
          {
            shownFrom: new Date(now.getTime() + HOUR),
          },
        );
        const shown: { imageToken: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
        });

        expect(
          await stillShownOf(
            PROJECT_A,
            [scheduled.imageToken, shown.imageToken],
            now,
          ),
        ).toEqual([shown.imageToken]);

        // Asked as of the time the scheduled one starts, both are shown.
        expect(
          await stillShownOf(
            PROJECT_A,
            [scheduled.imageToken, shown.imageToken],
            new Date(now.getTime() + HOUR),
          ),
        ).toEqual([scheduled.imageToken, shown.imageToken].sort());
      });

      test("still counts one that has ended: its status pages still list it", async () => {
        const now: Date = new Date();
        const ended: { imageToken: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() - 2 * HOUR),
        });

        expect(await stillShown(PROJECT_A, ended.imageToken)).toBe(true);
      });

      test("does not count a deleted one, or one of another project", async () => {
        const now: Date = new Date();
        const deleted: { imageToken: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
          deletedAt: now,
        });
        const otherProjects: { imageToken: string } =
          await insertAnnouncementImage({
            shownFrom: new Date(now.getTime() - HOUR),
            projectId: PROJECT_B,
          });

        expect(await stillShown(PROJECT_A, deleted.imageToken)).toBe(false);
        expect(await stillShown(PROJECT_A, otherProjects.imageToken)).toBe(
          false,
        );
      });
    });

    describe("PUBLISH_WHEN_SHOWN_SQL", () => {
      test("refuses a scheduled announcement's image before its start, and makes it public from it on", async () => {
        const startsAt: Date = new Date(Date.now() + HOUR);
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: startsAt,
        });

        expect(
          await publishWhenShown(
            fileId,
            imageToken,
            new Date(startsAt.getTime() - 1),
          ),
        ).toBe(0);
        expect(await isPublic(fileId)).toBe(false);

        expect(await publishWhenShown(fileId, imageToken, startsAt)).toBe(1);
        expect(await isPublic(fileId)).toBe(true);
      });

      test("answers a request at the same moment as the one that made it public: shown now, so served", async () => {
        const now: Date = new Date();
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
        });

        // Two requests that both read it private before either wrote.
        expect(await publishWhenShown(fileId, imageToken, now)).toBe(1);
        expect(await publishWhenShown(fileId, imageToken, now)).toBe(1);
        expect(await isPublic(fileId)).toBe(true);
      });

      test("a public image no announcement shows is not answered as shown", async () => {
        const imageToken: string = token();
        const fileId: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: true,
          imageAccessToken: imageToken,
        });

        expect(await publishWhenShown(fileId, imageToken, new Date())).toBe(0);
        expect(await isPublic(fileId)).toBe(true);
      });

      test("makes an ended announcement's image public: it is still shown", async () => {
        const now: Date = new Date();
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() - 2 * HOUR),
        });

        expect(await publishWhenShown(fileId, imageToken, now)).toBe(1);
        expect(await isPublic(fileId)).toBe(true);
      });

      test("never for a deleted announcement, or one of another project", async () => {
        const now: Date = new Date();
        const deleted: { fileId: string; imageToken: string } =
          await insertAnnouncementImage({
            shownFrom: new Date(now.getTime() - HOUR),
            deletedAt: now,
          });
        // Project B's announcement holds project A's image.
        const othersAnnouncement: { fileId: string; imageToken: string } =
          await insertAnnouncementImage({
            shownFrom: new Date(now.getTime() - HOUR),
            projectId: PROJECT_B,
          });

        for (const image of [deleted, othersAnnouncement]) {
          expect(
            await publishWhenShown(image.fileId, image.imageToken, now),
          ).toBe(0);
          expect(await isPublic(image.fileId)).toBe(false);
        }
      });

      test("never a file the statement does not name, of its project, private and not deleted", async () => {
        const now: Date = new Date();
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
        });

        // Asked as another project, or under another token: nothing.
        expect(await publishWhenShown(fileId, imageToken, now, PROJECT_B)).toBe(
          0,
        );
        expect(await publishWhenShown(fileId, token(), now)).toBe(0);
        expect(await isPublic(fileId)).toBe(false);

        // A deleted file is never made public.
        await runner.query(
          `UPDATE "File" SET "deletedAt" = now() WHERE "_id" = $1`,
          [fileId],
        );
        expect(await publishWhenShown(fileId, imageToken, now)).toBe(0);
      });

      test("reads tokens whole: an image whose token begins another's is not shown by it", async () => {
        const now: Date = new Date();
        const longer: string = token();
        const prefix: string = longer.slice(0, 32);
        const prefixFile: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: false,
          imageAccessToken: prefix,
        });

        await insertRecord(announcement(), {
          projectId: PROJECT_A,
          description: byToken(longer),
          showAnnouncementAt: new Date(now.getTime() - HOUR),
        });

        expect(await publishWhenShown(prefixFile, prefix, now)).toBe(0);
        expect(await isPublic(prefixFile)).toBe(false);
      });

      test("an image another kind of record shows is never made public by it: those are kept in step by their writes", async () => {
        const now: Date = new Date();
        const imageToken: string = token();
        const fileId: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: false,
          imageAccessToken: imageToken,
        });

        await insertRecord(sourceOf("Incident", "description"), {
          projectId: PROJECT_A,
          description: byToken(imageToken),
        });

        expect(await publishWhenShown(fileId, imageToken, now)).toBe(0);
        expect(await isPublic(fileId)).toBe(false);
      });
    });

    describe("the one-off statements", () => {
      test("PUBLISH_SHOWN_IMAGES_SQL leaves a scheduled announcement's image private", async () => {
        const now: Date = new Date();
        const scheduled: { fileId: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() + HOUR),
        });
        const shown: { fileId: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
        });

        expect(await affected(PUBLISH_SHOWN_IMAGES_SQL)).toBe(1);
        expect(await isPublic(scheduled.fileId)).toBe(false);
        expect(await isPublic(shown.fileId)).toBe(true);
      });

      /*
       * The statements that make images private make private only what
       * nothing can make public again: an announcement scheduled for later
       * keeps what it holds public, as before, whatever its time. Its images
       * are for HIDE_NOT_YET_SHOWN_IMAGES_SQL alone, which moves only what
       * the announcement's start makes public again.
       */
      test("HIDE_UNSHOWN_FILES_SQL keeps public what an announcement scheduled for later holds, by its token or by its id, of its project or of none", async () => {
        const later: Date = new Date(Date.now() + HOUR);
        const byItsToken: { fileId: string } = await insertAnnouncementImage({
          shownFrom: later,
          isPublic: true,
        });
        const ofNoProject: { fileId: string } = await insertAnnouncementImage({
          shownFrom: later,
          fileProjectId: null,
          isPublic: true,
        });
        const linkedById: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: true,
        });

        await insertRecord(announcement(), {
          projectId: PROJECT_A,
          description: byId(linkedById),
          showAnnouncementAt: later,
        });

        // A public file nothing holds goes private: the statement ran.
        const heldByNothing: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: true,
        });

        expect(await affected(HIDE_UNSHOWN_FILES_SQL)).toBe(1);
        expect(await isPublic(heldByNothing)).toBe(false);

        for (const fileId of [
          byItsToken.fileId,
          ofNoProject.fileId,
          linkedById,
        ]) {
          expect(await isPublic(fileId)).toBe(true);
        }
      });

      test("the hidden-record statements keep public an image of no project a private incident holds while an announcement scheduled for later holds it too", async () => {
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(Date.now() + HOUR),
          fileProjectId: null,
          isPublic: true,
        });

        await insertRecord(sourceOf("Incident", "description"), {
          projectId: PROJECT_A,
          description: byToken(imageToken),
          isPrivate: true,
        });

        expect(await affected(HIDE_PRIVATE_RECORD_IMAGES_SQL)).toBe(0);
        expect(await affected(HIDE_HIDDEN_RECORD_IMAGES_SQL)).toBe(0);
        expect(await isPublic(fileId)).toBe(true);
      });
    });

    describe("HIDE_NOT_YET_SHOWN_IMAGES_SQL", () => {
      test("makes private the public images of announcements scheduled for later, and nothing shown", async () => {
        const now: Date = new Date();
        const scheduled: { fileId: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() + HOUR),
          isPublic: true,
        });
        const shown: { fileId: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
          isPublic: true,
        });
        const ended: { fileId: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() - 2 * HOUR),
          isPublic: true,
        });

        expect(await affected(HIDE_NOT_YET_SHOWN_IMAGES_SQL)).toBe(1);
        expect(await isPublic(scheduled.fileId)).toBe(false);
        expect(await isPublic(shown.fileId)).toBe(true);
        expect(await isPublic(ended.fileId)).toBe(true);
      });

      test("keeps public an image a published record shows now, by its token or by its id", async () => {
        const now: Date = new Date();
        const alsoOnIncident: { fileId: string; imageToken: string } =
          await insertAnnouncementImage({
            shownFrom: new Date(now.getTime() + HOUR),
            isPublic: true,
          });

        await insertRecord(sourceOf("Incident", "description"), {
          projectId: PROJECT_A,
          description: byToken(alsoOnIncident.imageToken),
        });

        const alsoById: { fileId: string } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() + HOUR),
          isPublic: true,
        });

        await insertRecord(announcement(), {
          projectId: PROJECT_A,
          description: byId(alsoById.fileId),
          showAnnouncementAt: new Date(now.getTime() - HOUR),
        });

        expect(await affected(HIDE_NOT_YET_SHOWN_IMAGES_SQL)).toBe(0);
        expect(await isPublic(alsoOnIncident.fileId)).toBe(true);
        expect(await isPublic(alsoById.fileId)).toBe(true);
      });

      test("moves nothing it could not make public again: an image by its id, a file of no project or of another project", async () => {
        const later: Date = new Date(Date.now() + HOUR);

        // Addressed by its id, in an announcement scheduled for later.
        const linkedById: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: true,
        });

        await insertRecord(announcement(), {
          projectId: PROJECT_A,
          description: byId(linkedById),
          showAnnouncementAt: later,
        });

        const ofNoProject: { fileId: string } = await insertAnnouncementImage({
          shownFrom: later,
          fileProjectId: null,
          isPublic: true,
        });
        const ofAnotherProject: { fileId: string } =
          await insertAnnouncementImage({
            shownFrom: later,
            fileProjectId: PROJECT_B,
            isPublic: true,
          });

        expect(await affected(HIDE_NOT_YET_SHOWN_IMAGES_SQL)).toBe(0);

        for (const fileId of [
          linkedById,
          ofNoProject.fileId,
          ofAnotherProject.fileId,
        ]) {
          expect(await isPublic(fileId)).toBe(true);
        }
      });

      test("keeps a probe's or an AI agent's icon public", async () => {
        const { fileId } = await insertAnnouncementImage({
          shownFrom: new Date(Date.now() + HOUR),
          isPublic: true,
        });

        await runner.query(
          `INSERT INTO "Probe" ("projectId", "iconFileId") VALUES ($1, $2)`,
          [PROJECT_A, fileId],
        );

        expect(await affected(HIDE_NOT_YET_SHOWN_IMAGES_SQL)).toBe(0);
        expect(await isPublic(fileId)).toBe(true);
      });

      test("never makes an image public, a second run moves nothing, and the announcement's start makes it public again", async () => {
        const startsAt: Date = new Date(Date.now() + HOUR);
        const scheduled: { fileId: string; imageToken: string } =
          await insertAnnouncementImage({
            shownFrom: startsAt,
            isPublic: true,
          });
        const privateOne: { fileId: string } = await insertAnnouncementImage({
          shownFrom: startsAt,
        });

        expect(await affected(HIDE_NOT_YET_SHOWN_IMAGES_SQL)).toBe(1);
        expect(await affected(HIDE_NOT_YET_SHOWN_IMAGES_SQL)).toBe(0);
        expect(await isPublic(scheduled.fileId)).toBe(false);
        expect(await isPublic(privateOne.fileId)).toBe(false);

        expect(
          await publishWhenShown(
            scheduled.fileId,
            scheduled.imageToken,
            startsAt,
          ),
        ).toBe(1);
        expect(await isPublic(scheduled.fileId)).toBe(true);
      });
    });

    /*
     * The token image route end to end, on these rows: FileViewerAccess
     * reads and makes public through FileService, here this schema's File
     * table; who is asking is nobody signed in.
     */
    describe("the image route, as nobody signed in asks", () => {
      beforeEach(() => {
        jest.spyOn(FileService, "getRepository").mockReturnValue({
          manager: {
            query: async (
              sql: string,
              parameters?: Array<unknown>,
            ): Promise<unknown> => {
              return await runner.query(sql, parameters);
            },
          },
        } as never);

        jest.spyOn(FileService, "findOneBy").mockImplementation((async (find: {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
        }) => {
          const conditions: Array<string> = [`"deletedAt" IS NULL`];
          const parameters: Array<unknown> = [];

          for (const column of ["imageAccessToken", "_id", "isPublic"]) {
            if (find.query[column] !== undefined) {
              parameters.push(
                column === "_id"
                  ? String(find.query[column])
                  : find.query[column],
              );
              conditions.push(`"${column}" = $${parameters.length}`);
            }
          }

          const rows: Array<Record<string, unknown>> = await runner.query(
            `SELECT "_id", "projectId", "imageAccessToken", "isPublic" FROM "File" WHERE ${conditions.join(" AND ")}`,
            parameters,
          );

          if (!rows[0]) {
            return null;
          }

          const file: File = new File();
          file._id = String(rows[0]["_id"]);

          if (rows[0]["projectId"]) {
            file.projectId = new ObjectID(String(rows[0]["projectId"]));
          }

          file.imageAccessToken = String(rows[0]["imageAccessToken"]);
          file.isPublic = rows[0]["isPublic"] as boolean;
          file.fileType = MimeType.png;

          if (find.select["file"]) {
            file.file = Buffer.from("image-bytes");
          }

          return file;
        }) as never);

        jest
          .spyOn(UserMiddleware, "getSessionUser")
          .mockResolvedValue(null as never);
      });

      afterEach(() => {
        jest.restoreAllMocks();
        PublishedImages.forgetNotShown();
      });

      async function request(imageToken: string): Promise<File | undefined> {
        return await FileViewerAccess.findReadableFile({
          req: {} as ExpressRequest,
          query: { imageAccessToken: imageToken },
        });
      }

      test("a scheduled announcement's image is refused before its start, and served from it on", async () => {
        const startsAt: Date = new Date(Date.now() + HOUR);
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: startsAt,
        });

        expect(await request(imageToken)).toBeUndefined();
        expect(await isPublic(fileId)).toBe(false);

        /*
         * Its start comes - after the moment an image found not shown is
         * not asked about again (PublishedImages.NOT_SHOWN_FOR_MS).
         */
        jest
          .spyOn(OneUptimeDate, "getCurrentDate")
          .mockReturnValue(new Date(startsAt.getTime() + 1000));
        PublishedImages.forgetNotShown();

        expect((await request(imageToken))?.file?.toString()).toBe(
          "image-bytes",
        );
        expect(await isPublic(fileId)).toBe(true);
      });

      test("asked for again and again before its start, the database is asked once in a moment", async () => {
        const { imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(Date.now() + HOUR),
        });

        const asked: Array<string> = [];
        const query: (
          sql: string,
          parameters?: Array<unknown>,
        ) => Promise<unknown> = async (
          sql: string,
          parameters?: Array<unknown>,
        ): Promise<unknown> => {
          asked.push(sql);
          return await runner.query(sql, parameters);
        };

        jest.spyOn(FileService, "getRepository").mockReturnValue({
          manager: { query },
        } as never);

        for (let i: number = 0; i < 5; i++) {
          expect(await request(imageToken)).toBeUndefined();
        }

        expect(
          asked.filter((sql: string): boolean => {
            return sql === PUBLISH_WHEN_SHOWN_SQL;
          }),
        ).toHaveLength(1);
      });

      test("an ended announcement's image is served: its status pages still show it", async () => {
        const now: Date = new Date();
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() - 2 * HOUR),
        });

        expect((await request(imageToken))?.file?.toString()).toBe(
          "image-bytes",
        );
        expect(await isPublic(fileId)).toBe(true);
      });

      test("an image only a hidden incident shows is refused, and stays private", async () => {
        const imageToken: string = token();
        const fileId: string = await insertFile({
          projectId: PROJECT_A,
          isPublic: false,
          imageAccessToken: imageToken,
        });

        await insertRecord(sourceOf("Incident", "description"), {
          projectId: PROJECT_A,
          description: byToken(imageToken),
          isVisibleOnStatusPage: false,
        });

        expect(await request(imageToken)).toBeUndefined();
        expect(await isPublic(fileId)).toBe(false);
      });

      test("an announcement moved to a later time, once written, takes its image back until then", async () => {
        const now: Date = new Date();
        const { fileId, imageToken } = await insertAnnouncementImage({
          shownFrom: new Date(now.getTime() - HOUR),
        });

        expect((await request(imageToken))?.file).toBeDefined();
        expect(await isPublic(fileId)).toBe(true);

        // Moved to tomorrow: nothing of the project shows the image now...
        await runner.query(
          `UPDATE "StatusPageAnnouncement" SET "showAnnouncementAt" = $1`,
          [new Date(now.getTime() + 24 * HOUR)],
        );

        expect(
          await PublishedImages.findStillShown({
            projectId: PROJECT_A,
            tokens: [imageToken],
          }),
        ).toEqual(new Set<string>());

        // ...so the write's hook makes it private, and no request brings it back.
        await runner.query(
          `UPDATE "File" SET "isPublic" = false WHERE "_id" = $1`,
          [fileId],
        );

        expect(await request(imageToken)).toBeUndefined();
        expect(await isPublic(fileId)).toBe(false);
      });
    });
  });

  describe("PROJECT_FILES_PRIVATE_SQL", () => {
    test("makes the deleted projects' public files private, and nothing else", async () => {
      const publicOfA: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });
      const privateOfA: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: false,
      });
      const publicOfB: string = await insertFile({
        projectId: PROJECT_B,
        isPublic: true,
      });
      const publicOfNone: string = await insertFile({
        projectId: null,
        isPublic: true,
      });

      expect(await affected(PROJECT_FILES_PRIVATE_SQL, [[PROJECT_A]])).toBe(1);
      expect(await isPublic(publicOfA)).toBe(false);
      expect(await isPublic(privateOfA)).toBe(false);
      expect(await isPublic(publicOfB)).toBe(true);
      expect(await isPublic(publicOfNone)).toBe(true);
    });

    test("keeps public an icon a probe or an AI agent outside the project still uses", async () => {
      const probeIcon: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });
      const agentIcon: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });
      const unusedIcon: string = await insertFile({
        projectId: PROJECT_A,
        isPublic: true,
      });

      await runner.query(
        `INSERT INTO "Probe" ("projectId", "iconFileId") VALUES (NULL, $1)`,
        [probeIcon],
      );
      await runner.query(
        `INSERT INTO "AIAgent" ("projectId", "iconFileId") VALUES (NULL, $1)`,
        [agentIcon],
      );

      expect(await affected(PROJECT_FILES_PRIVATE_SQL, [[PROJECT_A]])).toBe(1);
      expect(await isPublic(probeIcon)).toBe(true);
      expect(await isPublic(agentIcon)).toBe(true);
      expect(await isPublic(unusedIcon)).toBe(false);
    });
  });
});
