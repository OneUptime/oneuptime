import ProjectService from "../../../Server/Services/ProjectService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { AddDataResidencyToProject1793300000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1793300000000-AddDataResidencyToProject";
import Entities from "../../../Models/DatabaseModels/Index";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Project.dataResidency end to end against a real Postgres: the migration's
 * DDL, then a master admin's write and a customer's read going through the
 * whole ProjectService pipeline - hooks, permission checks, the column's
 * max-length check and the actual UPDATE/SELECT.
 *
 * Opt in with RUN_POSTGRES_PROJECT_DATA_RESIDENCY_TESTS=true and the normal
 * database credentials. Uses the local development Postgres port unless
 * overridden by PROJECT_DATA_RESIDENCY_TEST_DATABASE_HOST /
 * PROJECT_DATA_RESIDENCY_TEST_DATABASE_PORT. The database must already be
 * migrated (the Project table is cloned from public). All writes go to a
 * uniquely named schema that is dropped afterwards; no project data is read
 * or modified.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
});

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROJECT_DATA_RESIDENCY_TESTS"] === "true"
    ? describe
    : describe.skip;

const USER_ID: ObjectID = ObjectID.generate();

function memberProps(
  projectId: ObjectID,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

interface ColumnInfo {
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

const EXPECTED_COLUMN: ColumnInfo = {
  data_type: "character varying",
  character_maximum_length: 100,
  is_nullable: "YES",
  column_default: null,
};

describePostgres("Project.dataResidency against Postgres", () => {
  const schema: string = `project_data_residency_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let columnsBeforeMigration: Array<ColumnInfo> = [];
  let columnsAfterMigration: Array<ColumnInfo> = [];

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function columnInfo(): Promise<Array<ColumnInfo>> {
    return database.query(
      `SELECT data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Project' AND column_name = 'dataResidency'`,
      [schema],
    );
  }

  async function storedDataResidency(projectId: ObjectID): Promise<unknown> {
    const rows: Array<{ dataResidency: string | null }> = await database.query(
      `SELECT "dataResidency" FROM "${schema}"."Project" WHERE "_id" = $1`,
      [projectId.toString()],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.dataResidency;
  }

  async function seedProject(dataResidency: string | null): Promise<ObjectID> {
    const projectId: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "dataResidency")
       VALUES ($1, $2, $3, 1, $4)`,
      [
        projectId.toString(),
        "Data Residency Test Project",
        `data-residency-test-${projectId.toString()}`,
        dataResidency,
      ],
    );

    return projectId;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PROJECT_DATA_RESIDENCY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROJECT_DATA_RESIDENCY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Project" (LIKE public."Project" INCLUDING ALL)`,
    );

    /*
     * Start from the table as it was BEFORE the migration, so the migration
     * below is what adds the column - whether or not the source database has
     * already run it.
     */
    await database.query(
      `ALTER TABLE "${schema}"."Project" DROP COLUMN IF EXISTS "dataResidency"`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    columnsBeforeMigration = await columnInfo();

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddDataResidencyToProject1793300000000().up(queryRunner);
    });

    columnsAfterMigration = await columnInfo();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("the migration", () => {
    test("up() adds a nullable varchar(100) with no default", async () => {
      expect(columnsBeforeMigration).toEqual([]);
      expect(columnsAfterMigration).toEqual([EXPECTED_COLUMN]);
    });

    test("an existing project reads as not set once the column exists", async () => {
      const projectId: ObjectID = await seedProject(null);

      expect(await storedDataResidency(projectId)).toBeNull();
    });
  });

  describe("a master admin setting it", () => {
    const admin: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      isMasterAdmin: true,
    };

    test("stores the trimmed label", async () => {
      const projectId: ObjectID = await seedProject(null);

      await ProjectService.updateOneById({
        id: projectId,
        data: { dataResidency: "  EU (Frankfurt)  " },
        props: admin,
      });

      expect(await storedDataResidency(projectId)).toBe("EU (Frankfurt)");
    });

    test("replaces an existing label", async () => {
      const projectId: ObjectID = await seedProject("US East");

      await ProjectService.updateOneById({
        id: projectId,
        data: { dataResidency: "EU (Frankfurt)" },
        props: admin,
      });

      expect(await storedDataResidency(projectId)).toBe("EU (Frankfurt)");
    });

    test("clearing the field stores NULL, not an empty string", async () => {
      const projectId: ObjectID = await seedProject("US East");

      await ProjectService.updateOneById({
        id: projectId,
        data: { dataResidency: "" },
        props: admin,
      });

      expect(await storedDataResidency(projectId)).toBeNull();
    });

    test("a label longer than the column is refused and nothing is written", async () => {
      const projectId: ObjectID = await seedProject("US East");

      await expect(
        ProjectService.updateOneById({
          id: projectId,
          data: { dataResidency: "a".repeat(101) },
          props: admin,
        }),
      ).rejects.toThrow("Data residency cannot be more than 100 characters.");

      expect(await storedDataResidency(projectId)).toBe("US East");
    });

    test("renaming the project leaves its residency alone", async () => {
      const projectId: ObjectID = await seedProject("US East");

      await ProjectService.updateOneById({
        id: projectId,
        data: { name: "Renamed Project" },
        props: admin,
      });

      expect(await storedDataResidency(projectId)).toBe("US East");
    });
  });

  describe("a project owner", () => {
    test("cannot set it", async () => {
      const projectId: ObjectID = await seedProject(null);

      await expect(
        ProjectService.updateOneById({
          id: projectId,
          data: { dataResidency: "EU (Frankfurt)" },
          props: memberProps(projectId, [Permission.ProjectOwner]),
        }),
      ).rejects.toThrow();

      expect(await storedDataResidency(projectId)).toBeNull();
    });

    test("cannot clear one staff set", async () => {
      const projectId: ObjectID = await seedProject("EU (Frankfurt)");

      await expect(
        ProjectService.updateOneById({
          id: projectId,
          data: { dataResidency: null } as any,
          props: memberProps(projectId, [Permission.ProjectOwner]),
        }),
      ).rejects.toThrow();

      expect(await storedDataResidency(projectId)).toBe("EU (Frankfurt)");
    });
  });

  describe("a project member reading it", () => {
    test("gets the label staff set", async () => {
      const projectId: ObjectID = await seedProject("EU (Frankfurt)");

      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { _id: true, name: true, dataResidency: true },
        props: memberProps(projectId, [Permission.ProjectMember]),
      });

      expect(project?.dataResidency).toBe("EU (Frankfurt)");
    });

    test("gets nothing for a project with no residency", async () => {
      const projectId: ObjectID = await seedProject(null);

      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { _id: true, name: true, dataResidency: true },
        props: memberProps(projectId, [Permission.ProjectMember]),
      });

      expect(project).not.toBeNull();
      expect(project?.dataResidency ?? null).toBeNull();
    });
  });

  describe("rolling the migration back", () => {
    test("down() drops the column, and up() can add it again", async () => {
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddDataResidencyToProject1793300000000().down(queryRunner);
      });

      expect(await columnInfo()).toEqual([]);

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddDataResidencyToProject1793300000000().up(queryRunner);
      });

      expect(await columnInfo()).toEqual([EXPECTED_COLUMN]);
    });
  });
});
