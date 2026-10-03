import ProjectAPI from "../../../Server/API/ProjectAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectService from "../../../Server/Services/ProjectService";
import Entities from "../../../Models/DatabaseModels/Index";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import {
  globalPermissionFor,
  ownerOf,
  postProject,
  putIdOnProjectAfterTheHooks,
  ProjectRouteResult,
  stubProjectCreateSideEffects,
  stubSignedInUser,
} from "./ProjectCreateTestHelpers";
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
import { DataSource } from "typeorm";

/*
 * POST /api/project with a tenant header, against a real, migrated Project
 * table - the one place the difference between an INSERT and an UPDATE of
 * the tenant's own project can actually be seen.
 *
 * DatabaseService.create used to stamp the request's tenant onto Project's
 * tenant column, which is its primary key, so the new project carried the id
 * of the project the header named. save() UPDATEs the row an entity's id
 * names. The request failed with a 500 only because the stamped id was an
 * ObjectID, which Postgres cannot read as a uuid - the first describe below
 * shows both halves of that against this table, so the suite cannot pass
 * against a harness that could never see the hazard. The rest shows that now
 * a new project is inserted beside the existing ones, which are left exactly
 * as they were, and that a create carrying the tenant's id is refused before
 * anything is written.
 *
 * The request goes through the route, the real user middleware,
 * BaseAPI.createItem and ProjectService.create (ProjectCreateTestHelpers);
 * the user and permission lookups and the post-create seeding of other
 * tables are stubbed. ProjectAPICreateWithTenantHeader.test.ts covers the
 * same request without a database.
 *
 * Opt in with RUN_POSTGRES_PROJECT_TENANT_CREATE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PROJECT_TENANT_CREATE_TESTS=true \
 *   PROJECT_TENANT_CREATE_TEST_DATABASE_HOST=127.0.0.1 \
 *   PROJECT_TENANT_CREATE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/ProjectCreateWithTenantHeaderPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * Project table's definition is copied from public, into a uniquely named
 * schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROJECT_TENANT_CREATE_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
    NotificationSlackWebhookOnCreateProject: "",
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

type ProjectRow = Dictionary<unknown>;

describePostgres("POST /api/project with a tenant header, on Postgres", () => {
  const schema: string = `project_tenant_create_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const userId: ObjectID = ObjectID.generate();

  let database: DataSource;

  // The caller's project, which the tenant header names.
  let ownedProjectId: ObjectID;

  // Someone else's project.
  let foreignProjectId: ObjectID;

  const readRow: (id: string) => Promise<ProjectRow | null> = async (
    id: string,
  ): Promise<ProjectRow | null> => {
    const rows: Array<ProjectRow> = await database.query(
      `SELECT * FROM "${schema}"."Project" WHERE "_id" = $1`,
      [id],
    );

    return rows[0] || null;
  };

  const projectIds: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."Project" ORDER BY "_id"`,
    );

    return rows.map((row: { _id: string }) => {
      return row._id;
    });
  };

  const seedProject: (name: string) => Promise<ObjectID> = async (
    name: string,
  ): Promise<ObjectID> => {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1)`,
      [id.toString(), name, `${name.toLowerCase()}-${id.toString()}`],
    );

    return id;
  };

  const ownerProps: (tenantId: ObjectID) => DatabaseCommonInteractionProps = (
    tenantId: ObjectID,
  ): DatabaseCommonInteractionProps => {
    return {
      userId: userId,
      userType: UserType.User,
      tenantId: tenantId,
      userGlobalAccessPermission: globalPermissionFor(ownedProjectId),
      userTenantAccessPermission: {
        [ownedProjectId.toString()]: ownerOf(ownedProjectId),
      },
    };
  };

  const aProject: () => Project = (): Project => {
    const project: Project = new Project();
    project.name = "x";
    return project;
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PROJECT_TENANT_CREATE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROJECT_TENANT_CREATE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROJECT_TENANT_CREATE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Project" (LIKE public."Project" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    mockRouter.routes.length = 0;
    new ProjectAPI();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    ownedProjectId = await seedProject("Owned");
    foreignProjectId = await seedProject("Foreign");

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    stubSignedInUser({ userId: userId, ownedProjectId: ownedProjectId });
    stubProjectCreateSideEffects();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the hazard: save() inserts or updates by the id it is handed", () => {
    test("an existing project's id as a plain string UPDATEs that project in place", async () => {
      const idsBefore: Array<string> = await projectIds();

      const entity: Project = aProject();
      entity._id = ownedProjectId.toString();
      entity.name = "Overwritten";

      await database.getRepository(Project).save(entity);

      expect((await readRow(ownedProjectId.toString()))?.["name"]).toBe(
        "Overwritten",
      );
      expect(await projectIds()).toEqual(idsBefore);
    });

    test("as an ObjectID it fails the way POST /api/project did, as invalid uuid syntax", async () => {
      const rowBefore: ProjectRow | null = await readRow(
        ownedProjectId.toString(),
      );

      const entity: Project = aProject();
      (entity as unknown as Dictionary<unknown>)["_id"] = ownedProjectId;

      await expect(
        database.getRepository(Project).save(entity),
      ).rejects.toThrow(/invalid input syntax for type uuid/);

      expect(await readRow(ownedProjectId.toString())).toEqual(rowBefore);
    });
  });

  describe("a project create made in a project", () => {
    async function expectANewProjectBesideTheOthers(
      create: () => Promise<Project | undefined>,
    ): Promise<void> {
      const idsBefore: Array<string> = await projectIds();
      const ownedBefore: ProjectRow | null = await readRow(
        ownedProjectId.toString(),
      );
      const foreignBefore: ProjectRow | null = await readRow(
        foreignProjectId.toString(),
      );

      const created: Project | undefined = await create();
      const createdId: string = created!._id!;

      // A row of its own, beside the two that were there...
      expect([
        ownedProjectId.toString(),
        foreignProjectId.toString(),
      ]).not.toContain(createdId);
      expect(await projectIds()).toEqual([...idsBefore, createdId].sort());

      const createdRow: ProjectRow | null = await readRow(createdId);
      expect(createdRow?.["name"]).toBe("x");
      expect(createdRow?.["createdByUserId"]).toBe(userId.toString());

      // ...which are exactly as they were.
      expect(await readRow(ownedProjectId.toString())).toEqual(ownedBefore);
      expect(await readRow(foreignProjectId.toString())).toEqual(foreignBefore);
    }

    test("tenantid and projectid headers naming the caller's project: a new project is inserted, theirs is untouched", async () => {
      await expectANewProjectBesideTheOthers(async () => {
        const result: ProjectRouteResult = await postProject({
          tenantid: ownedProjectId.toString(),
          projectid: ownedProjectId.toString(),
        });

        expect(result.forwardedError).toBeUndefined();

        return result.sentProject;
      });
    });

    test("a tenant header naming someone else's project: the same, and that project is untouched too", async () => {
      await expectANewProjectBesideTheOthers(async () => {
        const result: ProjectRouteResult = await postProject({
          tenantid: foreignProjectId.toString(),
        });

        expect(result.forwardedError).toBeUndefined();

        return result.sentProject;
      });
    });

    test("a tenant id that reaches ProjectService.create as a plain string: a new project too", async () => {
      await expectANewProjectBesideTheOthers(async () => {
        return await ProjectService.create({
          data: aProject(),
          props: ownerProps(ownedProjectId.toString() as unknown as ObjectID),
        });
      });
    });
  });

  describe("a create that would reach save() carrying the tenant's id is refused, and nothing is written", () => {
    async function expectNothingWritten(
      create: () => Promise<unknown>,
      message: string,
    ): Promise<void> {
      const idsBefore: Array<string> = await projectIds();
      const ownedBefore: ProjectRow | null = await readRow(
        ownedProjectId.toString(),
      );

      await expect(create()).rejects.toThrow(new BadDataException(message));

      expect(await projectIds()).toEqual(idsBefore);
      expect(await readRow(ownedProjectId.toString())).toEqual(ownedBefore);
    }

    test.each([
      [
        "a plain string",
        (): unknown => {
          return ownedProjectId.toString();
        },
      ],
      [
        "an ObjectID",
        (): unknown => {
          return ownedProjectId;
        },
      ],
    ])(
      "a member's create, with the id put on it after the hooks as %s",
      async (_label: string, id: () => unknown) => {
        putIdOnProjectAfterTheHooks(id());

        await expectNothingWritten(async () => {
          return await ProjectService.create({
            data: aProject(),
            props: ownerProps(ownedProjectId),
          });
        }, "An id cannot be supplied when creating Project.");
      },
    );

    // As a workflow component's create would arrive: root, with a tenant.
    test("a root create made in the project, carrying the project's id as a plain string", async () => {
      const project: Project = aProject();
      project._id = ownedProjectId.toString();

      await expectNothingWritten(async () => {
        return await ProjectService.create({
          data: project,
          props: {
            isRoot: true,
            userId: userId,
            tenantId: ownedProjectId,
          },
        });
      }, "A new Project cannot take the id of the Project this request is made in.");
    });
  });
});
