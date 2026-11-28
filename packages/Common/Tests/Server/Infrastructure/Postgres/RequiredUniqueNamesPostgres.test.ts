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
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../../Models/DatabaseModels/Index";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../../Models/DatabaseModels/MonitorGroup";
import Project from "../../../../Models/DatabaseModels/Project";
import TableView from "../../../../Models/DatabaseModels/TableView";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { AddProjectRequireUniqueNames1809187640000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187640000-AddProjectRequireUniqueNames";
import { AddUniqueNameIndexes1809187640010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187640010-AddUniqueNameIndexes";
import MonitorGroupService from "../../../../Server/Services/MonitorGroupService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ProjectService from "../../../../Server/Services/ProjectService";
import TableViewService from "../../../../Server/Services/TableViewService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import RequiredUniqueNames from "../../../../Server/Utils/Database/RequiredUniqueNames";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DuplicateNamesOfKind } from "../../../../Types/Database/RequiredUniqueNames";
import { SharedNamesAnswer } from "../../../../Types/Database/SharedNames";
import { getUniqueNameWhenRequiredColumn } from "../../../../Types/Database/UniqueNameWhenRequired";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NameTakenException from "../../../../Types/Exception/NameTakenException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../../Spy";
import { DataSource, EntityMetadata, QueryRunner } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

/*
 * REQUIRE UNIQUE NAMES, ON POSTGRES (#10761).
 *
 * On real rows, in a schema of its own made from the models' columns and
 * dropped afterwards:
 *
 *   - the migration adds Project "requireUniqueNames" off for every project
 *     that existed, and every index of the kinds the setting holds, online
 *     and valid;
 *   - the lookup a create or a rename makes - the name as it reads, bound as
 *     QueryHelper.findWithSameName binds it - is served by its kind's index;
 *   - through the real services, as a project member: names repeat while
 *     the setting is off; while it is on a second record of one name, in
 *     any case or spacing, is refused and never written - eight creates of
 *     one name at once leave one row - and so is a rename onto it; records
 *     that shared a name before stay valid, are listed, edited and renamed
 *     apart; a kind the setting leaves out repeats its names.
 *
 * The lock is held in memory (InMemoryLocks), as Valkey holds it. CI's
 * Common test job sets the flag for the Postgres test-setup.sh starts.
 * Locally, against a throwaway container:
 *
 *   docker run -d --name required-unique-names-pg -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb -p 127.0.0.1:55434:5432 postgres:15
 *   RUN_POSTGRES_REQUIRED_UNIQUE_NAME_TESTS=true \
 *   UNIQUE_NAME_TEST_DATABASE_HOST=127.0.0.1 \
 *   UNIQUE_NAME_TEST_DATABASE_PORT=55434 \
 *   DATABASE_PASSWORD=password \
 *     npx jest Tests/Server/Infrastructure/Postgres/RequiredUniqueNamesPostgres.test.ts
 *   docker rm -f required-unique-names-pg
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_REQUIRED_UNIQUE_NAME_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA: string = `required_unique_names_${process.pid}_${Date.now()}`;

// The kinds the setting holds: their tables, for the index migration.
const HELD_MODELS: Array<{ new (): BaseModel }> = Entities.filter(
  (modelType: { new (): BaseModel }): boolean => {
    return Boolean(getUniqueNameWhenRequiredColumn(new modelType()));
  },
);

// Projects that existed before the migration, and two made after it.
const EXISTING_PROJECT_IDS: Array<ObjectID> = [
  ObjectID.generate(),
  ObjectID.generate(),
];
const REQUIRING_PROJECT_ID: ObjectID = ObjectID.generate();
const LETTING_PROJECT_ID: ObjectID = ObjectID.generate();

describePostgres("Require Unique Names, on Postgres", () => {
  let database: DataSource;
  let locks: InMemoryLocks;

  const tableOf: (model: { new (): BaseModel }) => string = (model: {
    new (): BaseModel;
  }): string => {
    return `"${SCHEMA}"."${database.getMetadata(model).tableName}"`;
  };

  // A model's own columns, without its foreign keys: its rows stand alone.
  async function createTable(
    model: { new (): BaseModel },
    leaveOut: Array<string> = [],
  ): Promise<void> {
    const metadata: EntityMetadata = database.getMetadata(model);
    const columns: Map<string, string> = new Map<string, string>();

    for (const column of metadata.columns as Array<ColumnMetadata>) {
      if (
        columns.has(column.databaseName) ||
        leaveOut.includes(column.databaseName)
      ) {
        continue;
      }

      let definition: string = database.driver.normalizeType(column);

      if (column.isPrimary) {
        definition += " PRIMARY KEY DEFAULT gen_random_uuid()";
      } else if (column.isCreateDate || column.isUpdateDate) {
        definition += " NOT NULL DEFAULT now()";
      } else if (column.isVersion) {
        definition += " NOT NULL DEFAULT 1";
      } else if (
        typeof column.default === "boolean" ||
        typeof column.default === "number"
      ) {
        // A switch's or a count's default, as the migrations give it.
        definition += ` DEFAULT ${column.default}`;
      }

      columns.set(column.databaseName, definition);
    }

    await database.query(
      `CREATE TABLE ${tableOf(model)} (${Array.from(columns.entries())
        .map(([name, definition]: [string, string]): string => {
          return `"${name}" ${definition}`;
        })
        .join(", ")})`,
    );
  }

  async function insertProject(
    id: ObjectID,
    requireUniqueNames?: boolean,
  ): Promise<void> {
    await database.query(
      requireUniqueNames === undefined
        ? `INSERT INTO ${tableOf(Project)} ("_id", "name") VALUES ($1, $2)`
        : `INSERT INTO ${tableOf(Project)} ("_id", "name", "requireUniqueNames") VALUES ($1, $2, $3)`,
      requireUniqueNames === undefined
        ? [id.toString(), `Project ${id.toString()}`]
        : [id.toString(), `Project ${id.toString()}`, requireUniqueNames],
    );
  }

  async function insertGroup(
    projectId: ObjectID,
    name: string,
  ): Promise<string> {
    const rows: Array<{ _id: string }> = await database.query(
      `INSERT INTO ${tableOf(MonitorGroup)} ("projectId", "name", "slug") VALUES ($1, $2, $3) RETURNING "_id"`,
      [projectId.toString(), name, name.toLowerCase().replace(/\s+/g, "-")],
    );

    return rows[0]!._id;
  }

  async function groupNames(projectId: ObjectID): Promise<Array<string>> {
    const rows: Array<{ name: string }> = await database.query(
      `SELECT "name" FROM ${tableOf(MonitorGroup)} WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
      [projectId.toString()],
    );

    // In code point order, whatever the database's collation says.
    return rows
      .map((row: { name: string }): string => {
        return row.name;
      })
      .sort();
  }

  function member(projectId: ObjectID): DatabaseCommonInteractionProps {
    return {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId: projectId,
      }),
      ...ON_HIGHEST_PLAN,
    };
  }

  async function createGroup(
    projectId: ObjectID,
    name: string,
  ): Promise<MonitorGroup> {
    const group: MonitorGroup = new MonitorGroup();
    group.name = name;
    group.projectId = projectId;

    return await MonitorGroupService.create({
      data: group,
      props: member(projectId),
    });
  }

  async function updateGroup(
    projectId: ObjectID,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await MonitorGroupService.updateOneById({
      id: new ObjectID(id),
      data: data as never,
      props: member(projectId),
    });
  }

  async function refusalOf(write: Promise<unknown>): Promise<BadDataException> {
    try {
      await write;
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return error as BadDataException;
    }

    throw new Error("Expected the write to be refused.");
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["UNIQUE_NAME_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["UNIQUE_NAME_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["UNIQUE_NAME_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: SCHEMA,
      synchronize: false,
      extra: {
        options: `-c search_path=${SCHEMA}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${SCHEMA}"`);

    // The project table as it was before the migration.
    await createTable(Project, ["requireUniqueNames"]);

    for (const model of [...HELD_MODELS, TableView]) {
      await createTable(model);
    }

    for (const projectId of EXISTING_PROJECT_IDS) {
      await insertProject(projectId);
    }

    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      await new AddProjectRequireUniqueNames1809187640000().up(queryRunner);
      await new AddUniqueNameIndexes1809187640010().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    await insertProject(REQUIRING_PROJECT_ID, true);
    await insertProject(LETTING_PROJECT_ID, false);
  }, 300_000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`TRUNCATE ${tableOf(MonitorGroup)}`);
    await database.query(`TRUNCATE ${tableOf(TableView)}`);

    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // A monitor group's create tells its workflows: no workflow server here.
    getJestSpyOn(API, "post").mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}),
    );

    locks = new InMemoryLocks();
    locks.install();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the migration", () => {
    test("leaves every project that existed letting names repeat", async () => {
      const rows: Array<{ requireUniqueNames: boolean }> = await database.query(
        `SELECT "requireUniqueNames" FROM ${tableOf(Project)} WHERE "_id" = ANY($1::uuid[])`,
        [
          EXISTING_PROJECT_IDS.map((id: ObjectID): string => {
            return id.toString();
          }),
        ],
      );

      expect(rows).toEqual([
        { requireUniqueNames: false },
        { requireUniqueNames: false },
      ]);

      const columns: Array<{
        column_default: string;
        is_nullable: string;
      }> = await database.query(
        `SELECT column_default, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'Project' AND column_name = 'requireUniqueNames'`,
        [SCHEMA],
      );

      expect(columns).toEqual([{ column_default: "false", is_nullable: "NO" }]);
    });

    test("builds every index of the kinds the setting holds, valid", async () => {
      const rows: Array<{ name: string; isValid: boolean }> =
        await database.query(
          `SELECT c.relname AS "name", x.indisvalid AS "isValid" FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname LIKE 'IDX\\_%\\_PROJECT\\_NAME\\_KEY'`,
          [SCHEMA],
        );

      expect(
        rows
          .map((row: { name: string; isValid: boolean }): string => {
            return `${row.name}:${row.isValid}`;
          })
          .sort(),
      ).toEqual(
        HELD_MODELS.map((model: { new (): BaseModel }): string => {
          return `IDX_${(new model().tableName || "").toUpperCase()}_PROJECT_NAME_KEY:true`;
        }).sort(),
      );
    });

    test("is safe to run again: every index already valid is left as it is", async () => {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await new AddUniqueNameIndexes1809187640010().up(queryRunner);
      } finally {
        await queryRunner.release();
      }
    });
  });

  describe("the lookup of a name", () => {
    test("is served by its kind's index, the pattern bound as the server binds it", async () => {
      for (let n: number = 0; n < 200; n++) {
        await insertGroup(REQUIRING_PROJECT_ID, `Group ${n}`);
      }

      await database.query(`ANALYZE ${tableOf(MonitorGroup)}`);

      const [sql, parameters] = database
        .getRepository(MonitorGroup)
        .createQueryBuilder("MonitorGroup")
        .select("MonitorGroup._id")
        .where({
          projectId: REQUIRING_PROJECT_ID,
          name: QueryHelper.findWithSameName("  group   42 "),
        })
        .andWhere(`"MonitorGroup"."deletedAt" IS NULL`)
        .getQueryAndParameters();

      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await queryRunner.query(`SET enable_seqscan = off`);

        const plan: Array<{ "QUERY PLAN": string }> = await queryRunner.query(
          `EXPLAIN ${sql}`,
          parameters,
        );

        expect(
          plan
            .map((line: { "QUERY PLAN": string }): string => {
              return line["QUERY PLAN"];
            })
            .join("\n"),
        ).toContain("IDX_MONITORGROUP_PROJECT_NAME_KEY");

        const found: Array<unknown> = await queryRunner.query(sql, parameters);
        expect(found).toHaveLength(1);
      } finally {
        await queryRunner.query(`RESET enable_seqscan`);
        await queryRunner.release();
      }
    });
  });

  describe("a project's setting, read by the server", () => {
    test("is on for a project made with it on, and off for one made before", async () => {
      expect(
        await RequiredUniqueNames.isRequiredInProject(REQUIRING_PROJECT_ID),
      ).toBe(true);
      expect(
        await RequiredUniqueNames.isRequiredInProject(LETTING_PROJECT_ID),
      ).toBe(false);
      expect(
        await RequiredUniqueNames.isRequiredInProject(EXISTING_PROJECT_IDS[0]!),
      ).toBe(false);
    });

    test("is turned on for a new project, unless its create says otherwise", () => {
      const unset: { requireUniqueNames?: boolean | null } = {};
      const off: { requireUniqueNames?: boolean | null } = {
        requireUniqueNames: false,
      };

      ProjectService.applyNewProjectNameDefaults(unset);
      ProjectService.applyNewProjectNameDefaults(off);

      expect(unset.requireUniqueNames).toBe(true);
      expect(off.requireUniqueNames).toBe(false);
    });
  });

  describe("monitor groups written through their service by a member", () => {
    test("repeat their names in a project that lets them", async () => {
      await createGroup(LETTING_PROJECT_ID, "Production");
      await createGroup(LETTING_PROJECT_ID, "production");

      expect(await groupNames(LETTING_PROJECT_ID)).toEqual([
        "Production",
        "production",
      ]);
    });

    test("never repeat one in a project that requires unique names, in any case or spacing", async () => {
      await createGroup(REQUIRING_PROJECT_ID, "Production APIs");

      const refusal: BadDataException = await refusalOf(
        createGroup(REQUIRING_PROJECT_ID, "  production  apis "),
      );

      expect(refusal).toBeInstanceOf(NameTakenException);
      expect(refusal.message).toBe(
        "Another monitor group in this project is already called Production APIs, and the project requires unique names. Pick another name.",
      );
      expect(await groupNames(REQUIRING_PROJECT_ID)).toEqual([
        "Production APIs",
      ]);
    });

    test("eight creates of one name at the same moment leave one row", async () => {
      const results: Array<PromiseSettledResult<MonitorGroup>> =
        await Promise.allSettled(
          Array.from({ length: 8 }, (_value: unknown, n: number) => {
            return createGroup(
              REQUIRING_PROJECT_ID,
              n % 2 === 0 ? "Shared" : " shared ",
            );
          }),
        );

      expect(
        results.filter((result: PromiseSettledResult<MonitorGroup>) => {
          return result.status === "fulfilled";
        }),
      ).toHaveLength(1);

      for (const result of results) {
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(NameTakenException);
        }
      }

      expect(await groupNames(REQUIRING_PROJECT_ID)).toHaveLength(1);
    });

    test("cannot be renamed onto another's name", async () => {
      await insertGroup(REQUIRING_PROJECT_ID, "Production");
      const staging: string = await insertGroup(
        REQUIRING_PROJECT_ID,
        "Staging",
      );

      await refusalOf(
        updateGroup(REQUIRING_PROJECT_ID, staging, { name: "PRODUCTION" }),
      );

      expect(await groupNames(REQUIRING_PROJECT_ID)).toEqual([
        "Production",
        "Staging",
      ]);
    });

    test("that shared a name before stay valid: listed, edited, and renamed apart", async () => {
      const first: string = await insertGroup(
        REQUIRING_PROJECT_ID,
        "Production",
      );
      const second: string = await insertGroup(
        REQUIRING_PROJECT_ID,
        "production ",
      );

      const listed: DuplicateNamesOfKind | null =
        await RequiredUniqueNames.findDuplicatesOfKind({
          service: MonitorGroupService,
          projectId: REQUIRING_PROJECT_ID,
          props: member(REQUIRING_PROJECT_ID),
        });

      expect(listed?.groupCount).toBe(1);
      expect(
        listed?.groups[0]!.records.map((record: { id: string }): string => {
          return record.id;
        }).sort(),
      ).toEqual([first, second].sort());

      // An edit that sends its name back, as every edit form does.
      await updateGroup(REQUIRING_PROJECT_ID, second, {
        name: "production ",
        description: "The old one",
      });

      // Its own name in another case is still its own name: no rename.
      await updateGroup(REQUIRING_PROJECT_ID, second, { name: "PRODUCTION " });

      // But never onto another record's name.
      await insertGroup(REQUIRING_PROJECT_ID, "Staging");
      await refusalOf(
        updateGroup(REQUIRING_PROJECT_ID, second, { name: "staging" }),
      );

      // Renamed apart.
      await updateGroup(REQUIRING_PROJECT_ID, second, {
        name: "Production (old)",
      });

      expect(await groupNames(REQUIRING_PROJECT_ID)).toEqual([
        "Production",
        "Production (old)",
        "Staging",
      ]);
      expect(
        await RequiredUniqueNames.findDuplicatesOfKind({
          service: MonitorGroupService,
          projectId: REQUIRING_PROJECT_ID,
          props: member(REQUIRING_PROJECT_ID),
        }),
      ).toBeNull();
    });
  });

  /*
   * #11021: the twins every list of a kind the setting holds marks - the
   * real query, on real rows: names as the rule compares them, in the
   * project, archived records apart from those in service, deleted ones
   * none, read back with the reader's own permissions, with when each was
   * made.
   */
  describe("the twins a list marks", () => {
    async function insertMonitor(
      projectId: ObjectID,
      name: string,
      isArchived: boolean = false,
    ): Promise<string> {
      const rows: Array<{ _id: string }> = await database.query(
        `INSERT INTO ${tableOf(Monitor)} ("projectId", "name", "isArchived") VALUES ($1, $2, $3) RETURNING "_id"`,
        [projectId.toString(), name, isArchived],
      );

      return rows[0]!._id;
    }

    const sortedGroups: (
      groups: Array<Array<string>>,
    ) => Array<Array<string>> = (
      groups: Array<Array<string>>,
    ): Array<Array<string>> => {
      return groups
        .map((group: Array<string>): Array<string> => {
          return [...group].sort();
        })
        .sort((a: Array<string>, b: Array<string>): number => {
          return a[0]!.localeCompare(b[0]!);
        });
    };

    beforeEach(async () => {
      await database.query(`TRUNCATE ${tableOf(Monitor)}`);
    });

    test("are the records whose names read alike, those in service and the archived ones apart, with when each was made", async () => {
      const first: string = await insertMonitor(
        REQUIRING_PROJECT_ID,
        "API Health Check",
      );
      const second: string = await insertMonitor(
        REQUIRING_PROJECT_ID,
        "  api   health CHECK ",
      );
      const archived: string = await insertMonitor(
        REQUIRING_PROJECT_ID,
        "API health check",
        true,
      );
      const archivedTwin: string = await insertMonitor(
        REQUIRING_PROJECT_ID,
        "api health check",
        true,
      );
      await insertMonitor(REQUIRING_PROJECT_ID, "Checkout");
      // Another project's monitor of the name is no twin here.
      await insertMonitor(LETTING_PROJECT_ID, "API Health Check");

      const answer: SharedNamesAnswer =
        await RequiredUniqueNames.findTwinsOfKind({
          service: MonitorService,
          projectId: REQUIRING_PROJECT_ID,
          props: member(REQUIRING_PROJECT_ID),
        });

      expect(sortedGroups(answer.groups)).toEqual(
        sortedGroups([
          [first, second],
          [archived, archivedTwin],
        ]),
      );
      expect(Object.keys(answer.createdAt || {}).sort()).toEqual(
        [first, second, archived, archivedTwin].sort(),
      );
      for (const date of Object.values(answer.createdAt || {})) {
        expect(isNaN(new Date(date).getTime())).toBe(false);
      }
    });

    test("one in service whose only namesake is archived, or deleted, is no twin", async () => {
      const live: string = await insertMonitor(REQUIRING_PROJECT_ID, "Billing");
      await insertMonitor(REQUIRING_PROJECT_ID, "billing", true);
      const deleted: string = await insertMonitor(
        REQUIRING_PROJECT_ID,
        "BILLING",
      );
      await database.query(
        `UPDATE ${tableOf(Monitor)} SET "deletedAt" = now() WHERE "_id" = $1`,
        [deleted],
      );

      const answer: SharedNamesAnswer =
        await RequiredUniqueNames.findTwinsOfKind({
          service: MonitorService,
          projectId: REQUIRING_PROJECT_ID,
          props: member(REQUIRING_PROJECT_ID),
        });

      expect(answer.groups).toEqual([]);
      expect(JSON.stringify(answer)).not.toContain(live);
    });

    test("a kind with no archive counts every record of a name together, whatever the project requires", async () => {
      const first: string = await insertGroup(LETTING_PROJECT_ID, "Edge");
      const second: string = await insertGroup(LETTING_PROJECT_ID, "edge ");
      await insertGroup(LETTING_PROJECT_ID, "Core");

      const answer: SharedNamesAnswer =
        await RequiredUniqueNames.findTwinsOfKind({
          service: MonitorGroupService,
          projectId: LETTING_PROJECT_ID,
          props: member(LETTING_PROJECT_ID),
        });

      expect(sortedGroups(answer.groups)).toEqual([[first, second].sort()]);
    });
  });

  describe("a kind the setting leaves out", () => {
    test("table views repeat their names, even where the project requires unique names", async () => {
      for (const name of ["Errors", "errors"]) {
        const view: TableView = new TableView();
        view.name = name;
        view.projectId = REQUIRING_PROJECT_ID;
        view.tableId = "monitors";
        view.query = {} as never;
        view.sort = {} as never;
        view.itemsOnPage = 10;

        await TableViewService.create({
          data: view,
          props: member(REQUIRING_PROJECT_ID),
        });
      }

      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM ${tableOf(TableView)} WHERE "projectId" = $1`,
        [REQUIRING_PROJECT_ID.toString()],
      );

      expect(Number(rows[0]!.count)).toBe(2);
    });
  });
});
