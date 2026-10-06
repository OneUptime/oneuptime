import {
  CASCADES,
  getCascadedRowsSql,
  HIDE_UNSHOWN_FILES_SQL,
  KEPT_MARKDOWN,
  PROJECT_FILES_PRIVATE_SQL,
  PublishedCascade,
  PUBLISHED_MARKDOWN,
  PUBLISH_SHOWN_IMAGES_SQL,
  PublishedMarkdown,
  STILL_SHOWN_SQL,
} from "../../../../Server/Utils/File/PublishedImages";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The SQL of PublishedImages against a real Postgres, on real rows: the
 * still-shown check DatabaseService asks before it makes images private, the
 * reads of the rows a delete takes with it, the statement a deleted
 * project's files are made private by, and the two statements the
 * SetFileVisibilityFromPublishedRecords data migration runs once - images
 * published records show become public, and public files nothing published
 * shows become private.
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

    for (const column of source.shownWhen) {
      columns.add(`"${column}" boolean`);
    }
  }

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

  // A record of a table, with the values given (switches on by default).
  async function insertRecord(
    source: PublishedMarkdown,
    values: Record<string, unknown>,
  ): Promise<void> {
    const row: Record<string, unknown> = {};

    for (const column of source.shownWhen) {
      row[column] = true;
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
  ): Promise<Array<string>> {
    const rows: Array<{ token: string }> = await runner.query(STILL_SHOWN_SQL, [
      projectId,
      imageTokens.map((imageToken: string): string => {
        return `%/file/image/access-token/${imageToken}%`;
      }),
      imageTokens,
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
