import DatabaseConfig from "../../../Server/DatabaseConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import {
  NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
  SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
} from "../../../Server/Utils/SsoRequirementChanges";
import Entities from "../../../Models/DatabaseModels/Index";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
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
 * A PROJECT IS CREATED WITH A WAY IN, AGAINST POSTGRES
 * (SsoRequirementChanges.beforeProjectCreate, from ProjectService.create).
 *
 * The check reads the server's Require SSO for Login from GlobalConfig and
 * the global SAML and OIDC providers that are on - with, for the ones
 * restricted to the projects they are attached to, their attachments - and
 * here those are real rows in the migrated tables, read by the real
 * services. A new project has no provider of its own yet:
 *
 *   - while the server requires SSO for everyone, it is created only when a
 *     global provider that is on signs people in to every project; refused
 *     otherwise, in words that name a server admin, and no project row is
 *     written. A master admin is not held to the server's rule;
 *   - created with Require SSO for Login on, it needs the same, whoever
 *     creates it, and is refused in the words an update is refused in;
 *   - with neither rule, the create goes through without reading a
 *     provider.
 *
 * SsoRequirementProjectCreate.test.ts covers the same path in memory: the
 * lock on the server's sign-in rules around the check and the write, and
 * the seeding that follows. Here the creator's user row, the seeding after
 * the create and the lock (held in memory) are stubbed.
 *
 * Opt in with RUN_POSTGRES_PROJECT_CREATE_SSO_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PROJECT_CREATE_SSO_TESTS=true \
 *   PROJECT_CREATE_SSO_TEST_DATABASE_HOST=127.0.0.1 \
 *   PROJECT_CREATE_SSO_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/ProjectCreateSsoWayInPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * tables' definitions are copied from public, into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROJECT_CREATE_SSO_TESTS"] === "true"
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

const TABLES: Array<string> = [
  "Project",
  "GlobalConfig",
  "GlobalSSO",
  "GlobalOIDC",
  "GlobalSSOProject",
  "GlobalOIDCProject",
];

// The creators: someone signed in to the Dashboard, a server admin, and OneUptime itself.
type Creator = "member" | "masterAdmin" | "root";

describePostgres("a project created with a way in, on Postgres", () => {
  const schema: string = `project_create_sso_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const userId: ObjectID = ObjectID.generate();

  // A project that is there already, which providers may be attached to.
  const otherProjectId: ObjectID = ObjectID.generate();

  let database: DataSource;
  let creatorIsMasterAdmin: boolean;

  // The locks taken and not yet given back (Semaphore, held in memory).
  let heldLocks: Set<string>;

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  const projectIds: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const rows: Array<{ _id: string }> = await query(
      `SELECT "_id" FROM "${schema}"."Project" ORDER BY "_id"`,
    );

    return rows.map((row: { _id: string }): string => {
      return row._id;
    });
  };

  // The server's Require SSO for Login, as the Admin Dashboard saves it.
  const setServerRule: (requireSsoForLogin: boolean) => Promise<void> = async (
    requireSsoForLogin: boolean,
  ): Promise<void> => {
    await query(
      `INSERT INTO "${schema}"."GlobalConfig" ("_id", "version", "requireSsoForLogin") VALUES ($1, 1, $2)`,
      [ObjectID.generate().toString(), requireSsoForLogin],
    );
  };

  const addGlobalSaml: (data: {
    isEnabled: boolean;
    restrictToAttachedProjects: boolean;
    attachedTo?: Array<ObjectID>;
  }) => Promise<void> = async (data: {
    isEnabled: boolean;
    restrictToAttachedProjects: boolean;
    attachedTo?: Array<ObjectID>;
  }): Promise<void> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."GlobalSSO" ("_id", "version", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled", "restrictToAttachedProjects") VALUES ($1, 1, 'Company SAML', 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', $2, $3)`,
      [id, data.isEnabled, data.restrictToAttachedProjects],
    );

    for (const projectId of data.attachedTo || []) {
      await query(
        `INSERT INTO "${schema}"."GlobalSSOProject" ("_id", "version", "globalSsoId", "projectId", "isEnabled") VALUES ($1, 1, $2, $3, true)`,
        [ObjectID.generate().toString(), id, projectId.toString()],
      );
    }
  };

  const addGlobalOidc: (data: {
    isEnabled: boolean;
    restrictToAttachedProjects: boolean;
    attachedTo?: Array<ObjectID>;
  }) => Promise<void> = async (data: {
    isEnabled: boolean;
    restrictToAttachedProjects: boolean;
    attachedTo?: Array<ObjectID>;
  }): Promise<void> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."GlobalOIDC" ("_id", "version", "name", "description", "discoveryURL", "issuerURL", "clientId", "clientSecret", "scopes", "emailClaimName", "nameClaimName", "isEnabled", "restrictToAttachedProjects") VALUES ($1, 1, 'Company OIDC', 'Synthetic', 'https://idp.example.com/.well-known/openid-configuration', 'https://idp.example.com', 'synthetic-client', 'synthetic-secret', 'openid email profile', 'email', 'name', $2, $3)`,
      [id, data.isEnabled, data.restrictToAttachedProjects],
    );

    for (const projectId of data.attachedTo || []) {
      await query(
        `INSERT INTO "${schema}"."GlobalOIDCProject" ("_id", "version", "globalOidcId", "projectId", "isEnabled") VALUES ($1, 1, $2, $3, true)`,
        [ObjectID.generate().toString(), id, projectId.toString()],
      );
    }
  };

  const propsOf: (creator: Creator) => DatabaseCommonInteractionProps = (
    creator: Creator,
  ): DatabaseCommonInteractionProps => {
    if (creator === "root") {
      return { userId: userId, isRoot: true };
    }

    return {
      userId: userId,
      ...(creator === "masterAdmin" ? { isMasterAdmin: true } : {}),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public, Permission.User],
        projectIds: [],
        _type: "UserGlobalAccessPermission",
      },
    } as DatabaseCommonInteractionProps;
  };

  /*
   * Creates a project as `creator`: the new row's Require SSO for Login, or
   * the words the create was refused in - in which case no row was written.
   */
  const create: (
    creator: Creator,
    rule?: { requireSsoForLogin: boolean },
  ) => Promise<{ createdWithRule: boolean | null } | string> = async (
    creator: Creator,
    rule?: { requireSsoForLogin: boolean },
  ): Promise<{ createdWithRule: boolean | null } | string> => {
    creatorIsMasterAdmin = creator === "masterAdmin";

    const idsBefore: Array<string> = await projectIds();

    const project: Project = new Project();
    project.name = `Acme ${ObjectID.generate().toString()}`;

    if (rule) {
      project.requireSsoForLogin = rule.requireSsoForLogin;
    }

    try {
      const created: Project = await ProjectService.create({
        data: project,
        props: propsOf(creator),
      });

      const createdId: string = created.id!.toString();

      expect(await projectIds()).toEqual([...idsBefore, createdId].sort());

      const rows: Array<{ requireSsoForLogin: boolean | null }> = await query(
        `SELECT "requireSsoForLogin" FROM "${schema}"."Project" WHERE "_id" = $1`,
        [createdId],
      );

      return { createdWithRule: rows[0]?.requireSsoForLogin ?? null };
    } catch (err) {
      if (!(err instanceof BadDataException)) {
        throw err;
      }

      expect(await projectIds()).toEqual(idsBefore);

      return err.message;
    }
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["PROJECT_CREATE_SSO_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["PROJECT_CREATE_SSO_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROJECT_CREATE_SSO_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> = await query(
      "SELECT current_schema()",
    );
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const table of TABLES) {
      await query(`DELETE FROM "${schema}"."${table}"`);
    }

    await query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, 'Other', $2, 1)`,
      [otherProjectId.toString(), `other-${otherProjectId.toString()}`],
    );

    creatorIsMasterAdmin = false;
    heldLocks = new Set<string>();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    // The creator: a master admin or not.
    getJestSpyOn(UserService, "findOneById").mockImplementation((async () => {
      const user: User = new User();
      user.id = userId;
      user.isMasterAdmin = creatorIsMasterAdmin;
      return user;
    }) as never);
    getJestSpyOn(
      DatabaseConfig,
      "shouldDisableUserProjectCreation",
    ).mockResolvedValue(false as never);

    // What follows a write: workflows, live updates, the audit log, the seeding.
    getJestSpyOn(ProjectService, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(ProjectService, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(ProductAnalytics, "capture").mockReturnValue(undefined);
    getJestSpyOn(ProjectService, "onCreateSuccess").mockImplementation((async (
      _onCreate: OnCreate<Project>,
      createdItem: Project,
    ): Promise<Project> => {
      return createdItem;
    }) as never);

    // The lock on the server's sign-in rules, held in memory.
    getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
      key: string;
    }): Promise<unknown> => {
      heldLocks.add(data.key);
      return { key: data.key };
    }) as never);
    getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
      key: string;
    }): Promise<void> => {
      heldLocks.delete(mutex.key);
    }) as never);
    getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
      key: string;
    }): Promise<boolean> => {
      return heldLocks.has(mutex.key);
    }) as never);
  });

  afterEach(() => {
    // Every create, written or refused, gave its locks back.
    expect(Array.from(heldLocks)).toEqual([]);
    jest.restoreAllMocks();
  });

  describe("while the server requires SSO for everyone", () => {
    beforeEach(async () => {
      await setServerRule(true);
    });

    test("with every global provider off, a member's create is refused in words that name a server admin, and no project row is written", async () => {
      await addGlobalSaml({ isEnabled: false, restrictToAttachedProjects: false });
      await addGlobalOidc({ isEnabled: false, restrictToAttachedProjects: false });

      await expect(create("member")).resolves.toBe(
        SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
      );
    });

    test("a global SAML provider on for every project lets it through, and the project is written", async () => {
      await addGlobalSaml({ isEnabled: true, restrictToAttachedProjects: false });

      await expect(create("member")).resolves.toEqual({
        createdWithRule: false,
      });
    });

    test("a global OIDC provider on for every project counts the same", async () => {
      await addGlobalOidc({ isEnabled: true, restrictToAttachedProjects: false });

      await expect(create("member")).resolves.toEqual({
        createdWithRule: false,
      });
    });

    test("a global provider that signs people in only to the projects it is attached to does not count: a new project is attached to none", async () => {
      await addGlobalSaml({
        isEnabled: true,
        restrictToAttachedProjects: true,
        attachedTo: [otherProjectId],
      });
      await addGlobalOidc({
        isEnabled: true,
        restrictToAttachedProjects: true,
        attachedTo: [otherProjectId],
      });

      await expect(create("member")).resolves.toBe(
        SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
      );
    });

    test("a master admin's create goes through without one: the server's rule does not hold server admins", async () => {
      await expect(create("masterAdmin")).resolves.toEqual({
        createdWithRule: false,
      });
    });
  });

  describe("created with Require SSO for Login on", () => {
    beforeEach(async () => {
      await setServerRule(false);
    });

    test.each(["masterAdmin", "root"] as Array<Creator>)(
      "by %s, with no global provider on for every project, is refused in the words an update is refused in, and nothing is written",
      async (creator: Creator) => {
        await addGlobalSaml({
          isEnabled: true,
          restrictToAttachedProjects: true,
          attachedTo: [otherProjectId],
        });
        await addGlobalOidc({
          isEnabled: false,
          restrictToAttachedProjects: false,
        });

        await expect(create(creator, { requireSsoForLogin: true })).resolves.toBe(
          NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
        );
      },
    );

    test("with a global provider on for every project, it is written with the rule on", async () => {
      await addGlobalOidc({ isEnabled: true, restrictToAttachedProjects: false });

      await expect(
        create("masterAdmin", { requireSsoForLogin: true }),
      ).resolves.toEqual({ createdWithRule: true });
    });
  });

  describe("with neither rule", () => {
    test("a member's create goes through with no provider anywhere", async () => {
      await setServerRule(false);

      await expect(create("member")).resolves.toEqual({
        createdWithRule: false,
      });
    });

    test("and on a server with no settings row yet, the same", async () => {
      await expect(create("member")).resolves.toEqual({
        createdWithRule: false,
      });
    });
  });
});
