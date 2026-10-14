import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Query from "../../../../Server/Types/Database/Query";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import UUIDColumnFilter from "../../../../Server/Types/Database/UUIDColumnFilter";
import PostgresErrorTranslator, {
  TranslatedPostgresException,
} from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  DataSource,
  FindOptionsWhere,
  Logger,
  QueryFailedError,
} from "typeorm";

/*
 * Filters on a uuid column against a migrated Postgres.
 *
 * Opt in with RUN_POSTGRES_UUID_COLUMN_FILTER_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_UUID_COLUMN_FILTER_TESTS=true \
 *   UUID_COLUMN_FILTER_TEST_DATABASE_HOST=127.0.0.1 \
 *   UUID_COLUMN_FILTER_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Types/Database/UUIDColumnFilterPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, after that job
 * has applied every registered migration to an empty database.
 *
 * Production Postgres logged, about once a minute for more than a day,
 *
 *   ERROR: invalid input syntax for type uuid: "[object Object]"
 *   STATEMENT: SELECT "Incident"."_id" AS "Incident__id", "Incident"."createdAt"
 *     AS "Incident_createdAt" FROM "Incident" "Incident" WHERE ((("Incident".
 *     "projectId" = $1)) AND ("Incident"."currentIncidentStateId" = $2)) AND
 *     ("Incident"."deletedAt" IS NULL) ORDER BY "Incident_createdAt" DESC,
 *     "Incident__id" ASC LIMIT 25 OFFSET 0
 *
 * and the API answered each with a 500. The first test makes that statement
 * again; the rest pin what UUIDColumnFilter (run by QueryUtil.serializeQuery)
 * does instead, against the column Postgres actually has. One pins its one
 * claim that only Postgres can judge: what it reads as a uuid is exactly
 * what Postgres's uuid input accepts, so no filter that worked is refused.
 * The last two are about writes: what the write check
 * (UUIDColumnFilter.normalizeWrittenValue) writes for each form of an id,
 * Postgres stores as that id; and a non-id that reaches Postgres anyway is
 * the production error, which PostgresErrorTranslator answers with a 400.
 *
 * Every row lives in a uniquely named schema holding a structure-only clone
 * of Incident (LIKE ... INCLUDING ALL: the migrated column types, defaults
 * and indexes), dropped afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_UUID_COLUMN_FILTER_TESTS"] === "true"
    ? describe
    : describe.skip;

// Every statement TypeORM sends, so a test can say none was sent.
class StatementLog implements Logger {
  public statements: Array<string> = [];

  public logQuery(query: string): void {
    this.statements.push(query);
  }

  public logQueryError(_error: string | Error, query: string): void {
    this.statements.push(query);
  }

  public logQuerySlow(_time: number, query: string): void {
    this.statements.push(query);
  }

  public logSchemaBuild(): void {}

  public logMigration(): void {}

  public log(): void {}
}

describePostgres("filters on a uuid column against a migrated Postgres", () => {
  const schema: string = `uuid_filter_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: string = ObjectID.generate().toString();
  const otherProjectId: string = ObjectID.generate().toString();
  const openStateId: string = ObjectID.generate().toString();
  const resolvedStateId: string = ObjectID.generate().toString();
  const severityId: string = ObjectID.generate().toString();

  // Oldest first.
  const openIncidentIds: Array<string> = [
    ObjectID.generate().toString(),
    ObjectID.generate().toString(),
  ];

  const statementLog: StatementLog = new StatementLog();
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["UUID_COLUMN_FILTER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["UUID_COLUMN_FILTER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["UUID_COLUMN_FILTER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["query", "error"],
      logger: statementLog,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Incident" (LIKE public."Incident" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    const seed: Array<[string, string, string, string]> = [
      [openIncidentIds[0]!, projectId, openStateId, "2026-01-01T00:00:00Z"],
      [openIncidentIds[1]!, projectId, openStateId, "2026-01-02T00:00:00Z"],
      [
        ObjectID.generate().toString(),
        projectId,
        resolvedStateId,
        "2026-01-03T00:00:00Z",
      ],
      // Another project's incident in the same state: never in these lists.
      [
        ObjectID.generate().toString(),
        otherProjectId,
        openStateId,
        "2026-01-04T00:00:00Z",
      ],
    ];

    for (const [id, project, state, createdAt] of seed) {
      await database.query(
        `INSERT INTO "Incident" ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version", "createdAt") VALUES ($1, $2, 'An incident', $3, $4, $5, 1, $6)`,
        [id, project, `incident-${id}`, state, severityId, createdAt],
      );
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  // The production statement's shape: no select but the id, newest first, 25.
  const find: (where: Query<Incident>) => Promise<Array<string>> = async (
    where: Query<Incident>,
  ): Promise<Array<string>> => {
    const incidents: Array<Incident> = await database
      .getRepository(Incident)
      .find({
        select: { _id: true, createdAt: true },
        where: where as unknown as FindOptionsWhere<Incident>,
        order: { createdAt: "DESC", _id: "ASC" },
        take: 25,
        skip: 0,
      });

    return incidents.map((incident: Incident): string => {
      return incident._id!;
    });
  };

  // As every read does: the query QueryUtil.serializeQuery makes of it.
  const findInProject: (query: JSONObject) => Promise<Array<string>> = async (
    query: JSONObject,
  ): Promise<Array<string>> => {
    return await find(
      QueryUtil.serializeQuery(Incident, {
        projectId: new ObjectID(projectId),
        ...JSONFunctions.deserialize(query),
      } as Query<Incident>),
    );
  };

  const newestOpenFirst: () => Array<string> = (): Array<string> => {
    return [...openIncidentIds].reverse();
  };

  /*
   * The request as it reached TypeORM before: the object kept as it came,
   * the project pinned the way the tenant scope pins it. The column's
   * transformer made "[object Object]" of the object.
   */
  test("the production statement: Postgres refuses the object, made text by the column's transformer", async () => {
    const query: JSONObject = JSONFunctions.deserialize({
      currentIncidentStateId: { _id: openStateId },
    });

    let failure: unknown = null;

    try {
      await find({
        projectId: QueryHelper.equalTo(projectId),
        ...query,
      } as Query<Incident>);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(QueryFailedError);
    expect(
      (failure as { driverError?: { code?: string } }).driverError?.code,
    ).toBe("22P02");
    expect((failure as Error).message).toBe(
      'invalid input syntax for type uuid: "[object Object]"',
    );

    // The statement production logged, parentheses and all.
    expect(statementLog.statements.join("\n")).toContain(
      '((("Incident"."projectId" = $1)) AND ("Incident"."currentIncidentStateId" = $2))',
    );
  });

  test("the same request is refused with a 400 before a statement is sent", async () => {
    statementLog.statements = [];

    await expect(
      findInProject({ currentIncidentStateId: { _id: openStateId } }),
    ).rejects.toThrow(BadDataException);

    await expect(
      findInProject({
        currentIncidentStateId:
          "{{local.components.monitor-find-one-1.returnValues.model._id}}",
      }),
    ).rejects.toThrow('Invalid ID for "currentIncidentStateId"');

    expect(statementLog.statements).toEqual([]);
  });

  test("a serialized ObjectID finds the incidents it names, as an object or as JSON text", async () => {
    const serialized: JSONObject = { _type: "ObjectID", value: openStateId };

    expect(await findInProject({ currentIncidentStateId: serialized })).toEqual(
      newestOpenFirst(),
    );

    expect(
      await findInProject({
        currentIncidentStateId: JSON.stringify(serialized, null, 2),
      }),
    ).toEqual(newestOpenFirst());

    expect(
      await findInProject({
        currentIncidentStateId: {
          _type: "EqualTo",
          value: serialized,
        } as unknown as JSONObject,
      }),
    ).toEqual(newestOpenFirst());

    expect(
      await findInProject({
        currentIncidentStateId: {
          _type: "Includes",
          value: [serialized, resolvedStateId],
        },
      }),
    ).toHaveLength(3);
  });

  /*
   * Postgres reads more than the canonical form as a uuid, and the filter
   * passes each on as written: the same incidents, no error.
   */
  test("every way of writing an id Postgres reads finds the same incidents", async () => {
    const written: Array<string> = [
      openStateId,
      openStateId.toUpperCase(),
      `{${openStateId}}`,
      openStateId.replace(/-/g, ""),
      openStateId
        .replace(/-/g, "")
        .replace(/(.{4})/g, "$1-")
        .slice(0, -1),
    ];

    for (const id of written) {
      expect(UUIDColumnFilter.isUUIDText(id)).toBe(true);
      expect(await findInProject({ currentIncidentStateId: id })).toEqual(
        newestOpenFirst(),
      );
    }
  });

  /*
   * An empty id matched no incident before - the transformer wrote it as
   * NULL - and still matches none, without an error.
   */
  test("an empty id matches no incident, before and after", async () => {
    expect(
      await find({
        projectId: QueryHelper.equalTo(projectId),
        currentIncidentStateId: "",
      } as unknown as Query<Incident>),
    ).toEqual([]);

    expect(await findInProject({ currentIncidentStateId: "" })).toEqual([]);
    expect(await findInProject({ _id: "" })).toEqual([]);
  });

  /*
   * What isUUIDText accepts is exactly what Postgres's uuid input accepts:
   * accepting less would refuse filters that work, accepting more would let
   * a 500 through. Asked of hand-picked texts and of seeded mutations of
   * real ids - hyphens added and taken away, braces, case, a digit changed,
   * dropped or added, spaces.
   */
  test("reads as a uuid exactly what Postgres reads as one", async () => {
    const random: SeededRandom = seededRandom(4823);
    const hexDigits: string = "0123456789abcdef";

    const texts: Array<string> = [
      "",
      "[object Object]",
      "{{local.components.monitor-find-one-1.returnValues.model._id}}",
      "{}",
      "-",
      `{${openStateId}`,
      `${openStateId}}`,
      `{{${openStateId}}}`,
      `${openStateId}-`,
      `-${openStateId}`,
      openStateId.replace("-", "--"),
      ` ${openStateId}`,
      `${openStateId} `,
      `${openStateId}\n`,
    ];

    const pickIndex: (length: number) => number = (length: number): number => {
      return random(length);
    };

    for (let draw: number = 0; draw < 400; draw++) {
      let digits: string = "";

      for (let i: number = 0; i < 32; i++) {
        digits += hexDigits[random(16)];
      }

      let text: string = digits;

      // Hyphens after some groups of four, or anywhere at all.
      const hyphens: number = random(4);

      if (hyphens < 2) {
        text = digits.replace(/(.{4})/g, (group: string): string => {
          return random(2) === 0 ? `${group}-` : group;
        });
        text = text.endsWith("-") && random(2) === 0 ? text.slice(0, -1) : text;
      } else if (hyphens === 2) {
        const at: number = pickIndex(text.length + 1);
        text = `${text.slice(0, at)}-${text.slice(at)}`;
      } else {
        text = `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(
          12,
          16,
        )}-${digits.slice(16, 20)}-${digits.slice(20)}`;
      }

      switch (random(8)) {
        case 0:
          text = text.toUpperCase();
          break;
        case 1: {
          const at: number = pickIndex(text.length);
          text = `${text.slice(0, at)}${"gz {}-"[random(6)]}${text.slice(at + 1)}`;
          break;
        }
        case 2: {
          const at: number = pickIndex(text.length);
          text = `${text.slice(0, at)}${text.slice(at + 1)}`;
          break;
        }
        case 3:
          text = `${text}${hexDigits[random(16)]}`;
          break;
        default:
          break;
      }

      switch (random(6)) {
        case 0:
          text = `{${text}}`;
          break;
        case 1:
          text = random(2) === 0 ? `{${text}` : `${text}}`;
          break;
        case 2:
          text = random(2) === 0 ? ` ${text}` : `${text} `;
          break;
        default:
          break;
      }

      texts.push(text);
    }

    const disagreements: Array<string> = [];
    let acceptedByPostgres: number = 0;

    for (const text of texts) {
      let postgresReadsIt: boolean = true;

      try {
        await database.query("SELECT CAST($1 AS uuid)", [text]);
      } catch {
        postgresReadsIt = false;
      }

      if (postgresReadsIt) {
        acceptedByPostgres++;
      }

      if (UUIDColumnFilter.isUUIDText(text) !== postgresReadsIt) {
        disagreements.push(
          `${JSON.stringify(text)} (Postgres: ${postgresReadsIt})`,
        );
      }
    }

    // Both kinds were asked about, so the agreement means something.
    expect(acceptedByPostgres).toBeGreaterThan(50);
    expect(texts.length - acceptedByPostgres).toBeGreaterThan(50);
    expect(disagreements).toEqual([]);
  });

  // The state the newest open incident is in, as Postgres stores it.
  const storedStateOfNewest: () => Promise<string> =
    async (): Promise<string> => {
      const rows: Array<{ currentIncidentStateId: string }> =
        await database.query(
          `SELECT "currentIncidentStateId" FROM "Incident" WHERE "_id" = $1`,
          [openIncidentIds[1]],
        );

      return rows[0]!.currentIncidentStateId;
    };

  /*
   * A create or an update gives an id in any form the check keeps or
   * rewrites - text Postgres reads, an ObjectID, a serialized ObjectID as an
   * object or as the JSON text a workflow writes for a quoted reference -
   * and through the column's own transformer Postgres stores each as the id.
   */
  test("what the write check writes for each form of an id, Postgres stores as that id", async () => {
    const column: TableColumnMetadata = new Incident().getTableColumnMetadata(
      "currentIncidentStateId",
    );

    const forms: Array<unknown> = [
      resolvedStateId,
      resolvedStateId.toUpperCase(),
      `{${resolvedStateId}}`,
      resolvedStateId.replace(/-/g, ""),
      new ObjectID(resolvedStateId),
      { _type: "ObjectID", value: resolvedStateId },
      JSON.stringify({ _type: "ObjectID", value: resolvedStateId }, null, 2),
    ];

    try {
      for (const form of forms) {
        const written: unknown = UUIDColumnFilter.normalizeWrittenValue({
          columnName: "currentIncidentStateId",
          column: column,
          value: form,
        });

        await database
          .getRepository(Incident)
          .update(
            { _id: openIncidentIds[1]! },
            { currentIncidentStateId: written as ObjectID },
          );

        expect(await storedStateOfNewest()).toBe(resolvedStateId);

        // Put back between forms, so each is seen to write the id itself.
        await database
          .getRepository(Incident)
          .update(
            { _id: openIncidentIds[1]! },
            { currentIncidentStateId: new ObjectID(openStateId) },
          );
      }
    } finally {
      await database
        .getRepository(Incident)
        .update(
          { _id: openIncidentIds[1]! },
          { currentIncidentStateId: new ObjectID(openStateId) },
        );
    }

    expect(await storedStateOfNewest()).toBe(openStateId);
  });

  /*
   * The write check refuses a non-id before anything is written. Should one
   * reach Postgres some other way - server code, a statement written by
   * hand - it is the production error, and the translator answers it with a
   * 400 that does not repeat what was bound.
   */
  test("a write Postgres refuses as a uuid is answered with a 400", async () => {
    let failure: unknown = null;

    try {
      await database
        .getRepository(Incident)
        .update(
          { _id: openIncidentIds[1]! },
          { currentIncidentStateId: "not-a-state" as unknown as ObjectID },
        );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(QueryFailedError);
    expect((failure as Error).message).toBe(
      'invalid input syntax for type uuid: "not-a-state"',
    );
    expect(await storedStateOfNewest()).toBe(openStateId);

    const translated: unknown = PostgresErrorTranslator.translate(failure);

    expect(translated).toBeInstanceOf(BadDataException);
    expect((translated as TranslatedPostgresException).postgresErrorCode).toBe(
      "22P02",
    );
    expect((translated as Error).message).not.toContain("not-a-state");

    // Any other value Postgres cannot read is left to its own error.
    let otherFailure: unknown = null;

    try {
      await database.query("SELECT CAST($1 AS integer)", ["not-a-number"]);
    } catch (error) {
      otherFailure = error;
    }

    expect(otherFailure).toBeInstanceOf(QueryFailedError);
    expect(PostgresErrorTranslator.translate(otherFailure)).toBe(otherFailure);
  });
});
