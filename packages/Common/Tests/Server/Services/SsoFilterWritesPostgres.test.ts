import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import StatementOutcome from "../../../Server/Utils/Database/StatementOutcome";
import logger from "../../../Server/Utils/Logger";
import ProjectSsoProviderChanges, {
  PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Entities from "../../../Models/DatabaseModels/Index";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
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
import { DataSource, DataSourceOptions, QueryRunner } from "typeorm";

/*
 * A SIGN-IN CHANGE THAT NAMES ITS ROWS BY A FILTER WRITES EXACTLY THE ROWS
 * IT CHECKED, AGAINST POSTGRES (ProjectSsoProviderChanges.
 * writeOnlyTheRowsRead).
 *
 * The services' real update, delete and hard delete paths - DatabaseService
 * and the hooks - on real rows in the migrated tables. What their hooks
 * read under the lock, and what the database then writes, are the SQL the
 * narrowed write turns into: the ids read (IN), and, for a delete that read
 * none, rows deleted before (deletedAt IS NOT NULL, together with whatever
 * the delete asks of deletedAt itself - the retention job's purge asks for
 * rows deleted more than a month ago). A row lands at the moment another
 * server's write would - while the write waits for its lock, once it has
 * read under it, or once it read nothing - and is left alone:
 *
 *   - a project's SAML providers turned off by a filter: one created after
 *     the check read stays on; a hard delete that read none purges only rows
 *     deleted before, and the retention job's purge still removes them;
 *   - global SAML providers turned off by a filter, and attachments removed
 *     by one: one created or attached afterwards is left as it is; hard
 *     deletes and the purge reach only rows deleted before;
 *   - Require SSO for Login turned on for projects named by a filter: a
 *     project created between the two reads refuses the write, and nothing
 *     is written; one that comes to match the filter after the locked read
 *     keeps its rule;
 *   - a Require SSO for Login save whose UPDATE does not finish in time:
 *     one the client stopped waiting for keeps its lock - and lands once the
 *     row is free, after the save was reported as failed - while one the
 *     database cancelled at its statement timeout writes nothing, and gives
 *     its lock back at once (StatementOutcome tells them apart from the
 *     errors node-postgres and TypeORM really throw).
 *
 * The locks are held in memory (Semaphore stubbed, as in
 * ProjectCreateSsoWayInPostgres); SsoProviderChangesValkey keeps real ones.
 * The in-memory suites (ProjectSsoProviderChanges, GlobalSsoProviderChanges,
 * SsoRequirementFilterWrites, SsoSignInChangeWriteHold) cover the rest.
 *
 * Opt in with RUN_POSTGRES_SSO_FILTER_WRITES_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SSO_FILTER_WRITES_TESTS=true \
 *   SSO_FILTER_WRITES_TEST_DATABASE_HOST=127.0.0.1 \
 *   SSO_FILTER_WRITES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/SsoFilterWritesPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * tables' definitions are copied from public, into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SSO_FILTER_WRITES_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

const TABLES: Array<string> = [
  "Project",
  "GlobalConfig",
  "ProjectSSO",
  "ProjectOIDC",
  "GlobalSSO",
  "GlobalOIDC",
  "GlobalSSOProject",
  "GlobalOIDCProject",
];

describePostgres("sign-in changes named by a filter, on Postgres", () => {
  const schema: string = `sso_filter_writes_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;

  // What lands at a step of the write, as another server's write would, once.
  let onLock: (() => Promise<void>) | null;
  let onKeep: (() => Promise<void>) | null;

  // The locks taken and not yet given back (Semaphore, held in memory).
  let heldLocks: Set<string>;

  // Every lock handed out, as it was handed out.
  let handedOut: Array<{ key: string }>;

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

  const daysAgo: (days: number) => Date = (days: number): Date => {
    return new Date(Date.now() - days * DAY_IN_MS);
  };

  const addProject: (
    name: string,
    requireSsoForLogin?: boolean,
  ) => Promise<string> = async (
    name: string,
    requireSsoForLogin?: boolean,
  ): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "requireSsoForLogin") VALUES ($1, $2, $3, 1, $4)`,
      [id, name, `project-${id}`, requireSsoForLogin === true],
    );

    return id;
  };

  const addProjectSaml: (data: {
    projectId: string;
    name: string;
    isEnabled: boolean;
    deletedAt?: Date;
  }) => Promise<string> = async (data: {
    projectId: string;
    name: string;
    isEnabled: boolean;
    deletedAt?: Date;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."ProjectSSO" ("_id", "version", "projectId", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled", "deletedAt") VALUES ($1, 1, $2, $3, 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', $4, $5)`,
      [id, data.projectId, data.name, data.isEnabled, data.deletedAt || null],
    );

    return id;
  };

  const addGlobalSaml: (data: {
    name: string;
    isEnabled: boolean;
    deletedAt?: Date;
  }) => Promise<string> = async (data: {
    name: string;
    isEnabled: boolean;
    deletedAt?: Date;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."GlobalSSO" ("_id", "version", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled", "restrictToAttachedProjects", "deletedAt") VALUES ($1, 1, $2, 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', $3, false, $4)`,
      [id, data.name, data.isEnabled, data.deletedAt || null],
    );

    return id;
  };

  const attachGlobalSaml: (data: {
    providerId: string;
    projectId: string;
    deletedAt?: Date;
  }) => Promise<string> = async (data: {
    providerId: string;
    projectId: string;
    deletedAt?: Date;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."GlobalSSOProject" ("_id", "version", "globalSsoId", "projectId", "isEnabled", "deletedAt") VALUES ($1, 1, $2, $3, true, $4)`,
      [id, data.providerId, data.projectId, data.deletedAt || null],
    );

    return id;
  };

  // The rows of a table, deleted ones included, by id: whether each is on, and its rule.
  const rowsOf: (
    table: string,
  ) => Promise<Map<string, Record<string, unknown>>> = async (
    table: string,
  ): Promise<Map<string, Record<string, unknown>>> => {
    const rows: Array<Record<string, unknown>> = await query(
      `SELECT * FROM "${schema}"."${table}"`,
    );

    return new Map<string, Record<string, unknown>>(
      rows.map(
        (row: Record<string, unknown>): [string, Record<string, unknown>] => {
          return [String(row["_id"]), row];
        },
      ),
    );
  };

  /*
   * Runs `landing` once, right after the first read `service` answers with
   * findAllBy - the hooks' own read of the rows a write names - as another
   * server's write landing then would.
   */
  const afterFirstRead: (
    service: DatabaseService<any>,
    landing: () => Promise<void>,
  ) => void = (
    service: DatabaseService<any>,
    landing: () => Promise<void>,
  ): void => {
    const findAllBy: (...args: Array<unknown>) => Promise<unknown> =
      service.findAllBy.bind(service) as unknown as (
        ...args: Array<unknown>
      ) => Promise<unknown>;
    let hasLanded: boolean = false;

    getJestSpyOn(service, "findAllBy").mockImplementation((async (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      const answer: unknown = await findAllBy(...args);

      if (!hasLanded) {
        hasLanded = true;
        await landing();
      }

      return answer;
    }) as never);
  };

  const refusalOf: (write: Promise<unknown>) => Promise<unknown> = async (
    write: Promise<unknown>,
  ): Promise<unknown> => {
    try {
      return await write;
    } catch (err) {
      if (err instanceof BadDataException) {
        return err.message;
      }

      throw err;
    }
  };

  // A pool on the test's schema, with whatever else node-postgres is given.
  const optionsWith: (extra?: Record<string, unknown>) => DataSourceOptions = (
    extra?: Record<string, unknown>,
  ): DataSourceOptions => {
    return {
      type: "postgres",
      host: process.env["SSO_FILTER_WRITES_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SSO_FILTER_WRITES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SSO_FILTER_WRITES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public`, ...(extra || {}) },
    };
  };

  beforeAll(async () => {
    database = new DataSource(optionsWith());
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

    onLock = null;
    onKeep = null;
    heldLocks = new Set<string>();
    handedOut = [];

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    // What follows a write: workflows, live updates, the audit log, every server told.
    for (const service of [
      ProjectService,
      ProjectSsoService,
      GlobalSsoService,
      GlobalSsoProjectService,
    ] as Array<DatabaseService<any>>) {
      getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
        undefined as never,
      );
    }

    for (const recorded of ["recordUpdate", "recordDelete", "recordCreate"]) {
      getJestSpyOn(AuditLogService, recorded).mockResolvedValue(
        undefined as never,
      );
    }

    getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
      undefined as never,
    );

    // The locks, held in memory: what lands while a write waits for one lands first.
    getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
      key: string;
    }): Promise<unknown> => {
      if (onLock) {
        const landing: () => Promise<void> = onLock;
        onLock = null;
        await landing();
      }

      heldLocks.add(data.key);

      const mutex: { key: string } = { key: data.key };
      handedOut.push(mutex);
      return mutex;
    }) as never);
    getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
      key: string;
    }): Promise<void> => {
      heldLocks.delete(mutex.key);
    }) as never);
    getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
      key: string;
    }): Promise<boolean> => {
      if (onKeep) {
        const landing: () => Promise<void> = onKeep;
        onKeep = null;
        await landing();
      }

      return heldLocks.has(mutex.key);
    }) as never);
  });

  afterEach(() => {
    // Every write, written or refused, gave its locks back.
    expect(Array.from(heldLocks)).toEqual([]);
    jest.restoreAllMocks();
  });

  describe("a project's SAML providers", () => {
    test("turned off by a filter: the providers read under the lock are turned off, and one created after that read stays on", async () => {
      const projectId: string = await addProject("Acme");
      // Another of its own providers, which no write here touches: the project keeps a way in.
      await addProjectSaml({ projectId, name: "Backup", isEnabled: true });
      const read: string = await addProjectSaml({
        projectId,
        name: "Okta",
        isEnabled: true,
      });

      let createdLater: string = "";
      onKeep = async (): Promise<void> => {
        createdLater = await addProjectSaml({
          projectId,
          name: "Okta",
          isEnabled: true,
        });
      };

      await expect(
        ProjectSsoService.updateBy({
          query: { projectId: new ObjectID(projectId), name: "Okta" },
          data: { isEnabled: false },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "ProjectSSO",
      );

      expect(createdLater).not.toBe("");
      expect(rows.get(read)?.["isEnabled"]).toBe(false);
      expect(rows.get(read)?.["signInsEndedAt"]).toBeInstanceOf(Date);
      expect(rows.get(createdLater)?.["isEnabled"]).toBe(true);
      expect(rows.get(createdLater)?.["signInsEndedAt"]).toBeNull();
    });

    test("a filter that comes to reach another project between the reads is refused, and nothing is written", async () => {
      const acme: string = await addProject("Acme");
      const beta: string = await addProject("Beta");
      await addProjectSaml({
        projectId: acme,
        name: "Backup",
        isEnabled: true,
      });
      const read: string = await addProjectSaml({
        projectId: acme,
        name: "Okta",
        isEnabled: true,
      });

      // Created in Beta while the write waits for Acme's lock.
      let createdLater: string = "";
      onLock = async (): Promise<void> => {
        createdLater = await addProjectSaml({
          projectId: beta,
          name: "Okta",
          isEnabled: true,
        });
      };

      await expect(
        refusalOf(
          ProjectSsoService.updateBy({
            query: { name: "Okta" },
            data: { isEnabled: false },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          }),
        ),
      ).resolves.toBe(PROVIDER_CHANGE_IN_PROGRESS_MESSAGE);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "ProjectSSO",
      );

      expect(rows.get(read)?.["isEnabled"]).toBe(true);
      expect(rows.get(createdLater)?.["isEnabled"]).toBe(true);
    });

    test("a hard delete by a filter that read no provider purges only rows deleted before: not one created a moment later", async () => {
      const projectId: string = await addProject("Acme");
      const deletedBefore: string = await addProjectSaml({
        projectId,
        name: "Retired",
        isEnabled: true,
        deletedAt: daysAgo(40),
      });

      let createdLater: string = "";
      afterFirstRead(
        ProjectSsoService as unknown as DatabaseService<any>,
        async (): Promise<void> => {
          createdLater = await addProjectSaml({
            projectId,
            name: "Retired",
            isEnabled: true,
          });
        },
      );

      await expect(
        ProjectSsoService.hardDeleteBy({
          query: { projectId: new ObjectID(projectId), name: "Retired" },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "ProjectSSO",
      );

      expect(rows.has(deletedBefore)).toBe(false);
      expect(rows.get(createdLater)?.["isEnabled"]).toBe(true);
    });

    test("the retention job's purge removes providers deleted more than a month ago, and no other", async () => {
      const projectId: string = await addProject("Acme");
      const deletedLongAgo: string = await addProjectSaml({
        projectId,
        name: "Okta",
        isEnabled: true,
        deletedAt: daysAgo(40),
      });
      const deletedLastWeek: string = await addProjectSaml({
        projectId,
        name: "Okta",
        isEnabled: true,
        deletedAt: daysAgo(7),
      });
      const there: string = await addProjectSaml({
        projectId,
        name: "Okta",
        isEnabled: true,
      });

      await expect(
        ProjectSsoService.hardDeleteBy({
          query: {
            deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "ProjectSSO",
      );

      expect(rows.has(deletedLongAgo)).toBe(false);
      expect(rows.has(deletedLastWeek)).toBe(true);
      expect(rows.has(there)).toBe(true);
    });
  });

  describe("global SAML providers and their attachments", () => {
    test("turned off by a filter: the providers read under the lock are turned off, and one created after that read stays on", async () => {
      await addProject("Acme");
      const read: string = await addGlobalSaml({
        name: "Okta",
        isEnabled: true,
      });

      let createdLater: string = "";
      onKeep = async (): Promise<void> => {
        createdLater = await addGlobalSaml({ name: "Okta", isEnabled: true });
      };

      await expect(
        GlobalSsoService.updateBy({
          query: { name: "Okta" },
          data: { isEnabled: false },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "GlobalSSO",
      );

      expect(createdLater).not.toBe("");
      expect(rows.get(read)?.["isEnabled"]).toBe(false);
      expect(rows.get(read)?.["signInsEndedAt"]).toBeInstanceOf(Date);
      expect(rows.get(createdLater)?.["isEnabled"]).toBe(true);
      expect(rows.get(createdLater)?.["signInsEndedAt"]).toBeNull();
    });

    test("a hard delete by a filter that read no provider purges only rows deleted before: not one created a moment later", async () => {
      const deletedBefore: string = await addGlobalSaml({
        name: "Retired",
        isEnabled: true,
        deletedAt: daysAgo(40),
      });

      // Created once the hard delete read, under the lock, that none is there.
      let createdLater: string = "";
      onKeep = async (): Promise<void> => {
        createdLater = await addGlobalSaml({
          name: "Retired",
          isEnabled: true,
        });
      };

      await expect(
        GlobalSsoService.hardDeleteBy({
          query: { name: "Retired" },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "GlobalSSO",
      );

      expect(createdLater).not.toBe("");
      expect(rows.has(deletedBefore)).toBe(false);
      expect(rows.get(createdLater)?.["isEnabled"]).toBe(true);
    });

    test("the retention job's purge removes providers deleted more than a month ago, and no other", async () => {
      const deletedLongAgo: string = await addGlobalSaml({
        name: "Okta",
        isEnabled: true,
        deletedAt: daysAgo(40),
      });
      const deletedLastWeek: string = await addGlobalSaml({
        name: "Okta",
        isEnabled: true,
        deletedAt: daysAgo(7),
      });
      const there: string = await addGlobalSaml({
        name: "Okta",
        isEnabled: true,
      });

      await expect(
        GlobalSsoService.hardDeleteBy({
          query: {
            deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "GlobalSSO",
      );

      expect(rows.has(deletedLongAgo)).toBe(false);
      expect(rows.has(deletedLastWeek)).toBe(true);
      expect(rows.has(there)).toBe(true);
    });

    test("attachments removed by a filter: the ones read under the lock are removed, and one attached after that read stays", async () => {
      const acme: string = await addProject("Acme");
      const beta: string = await addProject("Beta");
      const providerId: string = await addGlobalSaml({
        name: "Okta",
        isEnabled: true,
      });
      const read: string = await attachGlobalSaml({
        providerId,
        projectId: acme,
      });

      let attachedLater: string = "";
      onKeep = async (): Promise<void> => {
        attachedLater = await attachGlobalSaml({
          providerId,
          projectId: beta,
        });
      };

      await expect(
        GlobalSsoProjectService.deleteBy({
          query: { globalSsoId: new ObjectID(providerId) },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "GlobalSSOProject",
      );

      expect(attachedLater).not.toBe("");
      expect(rows.has(read)).toBe(false);
      expect(rows.has(attachedLater)).toBe(true);
    });

    test("a hard delete of attachments by a filter that read none purges only rows deleted before", async () => {
      const acme: string = await addProject("Acme");
      const providerId: string = await addGlobalSaml({
        name: "Okta",
        isEnabled: true,
      });
      const deletedBefore: string = await attachGlobalSaml({
        providerId,
        projectId: acme,
        deletedAt: daysAgo(40),
      });

      let attachedLater: string = "";
      onKeep = async (): Promise<void> => {
        attachedLater = await attachGlobalSaml({
          providerId,
          projectId: acme,
        });
      };

      await expect(
        GlobalSsoProjectService.hardDeleteBy({
          query: { globalSsoId: new ObjectID(providerId) },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "GlobalSSOProject",
      );

      expect(attachedLater).not.toBe("");
      expect(rows.has(deletedBefore)).toBe(false);
      expect(rows.has(attachedLater)).toBe(true);
    });
  });

  describe("Require SSO for Login turned on for projects named by a filter", () => {
    const GROUP: string = "Acme Group";

    // Each project of the group keeps a way in of its own.
    const addGroupProject: () => Promise<string> =
      async (): Promise<string> => {
        const projectId: string = await addProject(GROUP);
        await addProjectSaml({ projectId, name: "Okta", isEnabled: true });
        return projectId;
      };

    const requireSsoForGroup: () => Promise<unknown> =
      async (): Promise<unknown> => {
        return await refusalOf(
          ProjectService.updateBy({
            query: { name: GROUP },
            data: { requireSsoForLogin: true },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          }),
        );
      };

    test("the projects read under the lock are written: one that comes to match the filter after that read keeps its rule", async () => {
      const eu: string = await addGroupProject();
      const us: string = await addGroupProject();
      const other: string = await addProject("Other");

      let createdLater: string = "";
      onKeep = async (): Promise<void> => {
        createdLater = await addProject(GROUP);
      };

      await expect(requireSsoForGroup()).resolves.toBe(2);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "Project",
      );

      expect(createdLater).not.toBe("");
      expect(rows.get(eu)?.["requireSsoForLogin"]).toBe(true);
      expect(rows.get(us)?.["requireSsoForLogin"]).toBe(true);
      expect(rows.get(createdLater)?.["requireSsoForLogin"]).toBe(false);
      expect(rows.get(other)?.["requireSsoForLogin"]).toBe(false);
    });

    test("a project created between the two reads refuses the write, and no project is written", async () => {
      const eu: string = await addGroupProject();
      const us: string = await addGroupProject();

      let createdLater: string = "";
      onLock = async (): Promise<void> => {
        createdLater = await addProject(GROUP);
      };

      await expect(requireSsoForGroup()).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "Project",
      );

      expect(createdLater).not.toBe("");
      expect(rows.get(eu)?.["requireSsoForLogin"]).toBe(false);
      expect(rows.get(us)?.["requireSsoForLogin"]).toBe(false);
      expect(rows.get(createdLater)?.["requireSsoForLogin"]).toBe(false);
    });

    test("a filter that names no project writes none: not one created a moment later", async () => {
      let createdLater: string = "";
      afterFirstRead(
        ProjectService as unknown as DatabaseService<any>,
        async (): Promise<void> => {
          createdLater = await addProject(GROUP);
        },
      );

      await expect(requireSsoForGroup()).resolves.toBe(0);

      const rows: Map<string, Record<string, unknown>> = await rowsOf(
        "Project",
      );

      expect(createdLater).not.toBe("");
      expect(rows.get(createdLater)?.["requireSsoForLogin"]).toBe(false);
    });
  });

  /*
   * node-postgres' own query timeout (DATABASE_QUERY_TIMEOUT_MS) stops
   * waiting for a statement without cancelling it: the database runs it on,
   * and may commit it after the save was reported as failed. So the save's
   * lock is kept - never given back - until the database would have
   * cancelled it; a statement the database cancelled itself, and said so,
   * wrote nothing, and its lock goes back at once. Each save runs on a pool
   * of its own with the timeouts it needs (as the app's pool is given them,
   * DataSourceOptions), its UPDATE held behind the project's row, which
   * another connection holds meanwhile.
   */
  describe("a Require SSO for Login save whose UPDATE does not finish in time", () => {
    const NAME: string = "Acme Slow";

    const pools: Array<DataSource> = [];

    afterAll(async () => {
      for (const pool of pools) {
        if (pool.isInitialized) {
          await pool.destroy();
        }
      }
    });

    // The pool the services run on, with these timeouts.
    const runOnPoolWith: (timeouts: {
      statement_timeout: number;
      query_timeout: number;
    }) => Promise<void> = async (timeouts: {
      statement_timeout: number;
      query_timeout: number;
    }): Promise<void> => {
      const pool: DataSource = new DataSource(optionsWith(timeouts));
      await pool.initialize();
      pools.push(pool);

      jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(pool);
    };

    // Another connection takes the project's row, and holds it until told.
    const holdRow: (projectId: string) => Promise<QueryRunner> = async (
      projectId: string,
    ): Promise<QueryRunner> => {
      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT "_id" FROM "${schema}"."Project" WHERE "_id" = $1 FOR UPDATE`,
        [projectId],
      );

      return holder;
    };

    const letGo: (holder: QueryRunner) => Promise<void> = async (
      holder: QueryRunner,
    ): Promise<void> => {
      if (holder.isTransactionActive) {
        await holder.commitTransaction();
      }

      if (!holder.isReleased) {
        await holder.release();
      }
    };

    const failureOfSave: () => Promise<unknown> =
      async (): Promise<unknown> => {
        try {
          await ProjectService.updateBy({
            query: { name: NAME },
            data: { requireSsoForLogin: true },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          });
        } catch (err) {
          return err;
        }

        return null;
      };

    const ruleOf: (projectId: string) => Promise<unknown> = async (
      projectId: string,
    ): Promise<unknown> => {
      return (await rowsOf("Project")).get(projectId)?.["requireSsoForLogin"];
    };

    test("the client stopped waiting for it: the project's lock is kept, not given back - and the write lands once the row is free", async () => {
      const projectId: string = await addProject(NAME);
      await addProjectSaml({ projectId, name: "Okta", isEnabled: true });

      await runOnPoolWith({ statement_timeout: 20_000, query_timeout: 1_000 });
      const holder: QueryRunner = await holdRow(projectId);

      try {
        const failure: unknown = await failureOfSave();

        expect((failure as Error | null)?.message).toBe("Query read timeout");
        expect(StatementOutcome.mayStillApply(failure)).toBe(true);

        // Not given back, and kept alive: the database may still apply the write.
        expect(heldLocks.has(projectId)).toBe(true);

        const projectLock: { key: string } | undefined = handedOut.find(
          (mutex: { key: string }): boolean => {
            return mutex.key === projectId;
          },
        );

        expect(
          ProjectSsoProviderChanges.isKeptForWrite(projectLock as never),
        ).toBe(true);
        expect(await ruleOf(projectId)).toBe(false);

        // The row is free: the UPDATE the client gave up on runs on, and lands.
        await letGo(holder);

        let rule: unknown = false;

        for (
          let attempt: number = 0;
          attempt < 50 && rule !== true;
          attempt++
        ) {
          await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, 100);
          });
          rule = await ruleOf(projectId);
        }

        expect(rule).toBe(true);
      } finally {
        await letGo(holder);
        await ProjectSsoProviderChanges.releaseSignInChange(handedOut as never);
      }
    });

    test("the database cancelled it at its statement timeout, and said so: nothing is written, and the lock goes back at once", async () => {
      const projectId: string = await addProject(NAME);
      await addProjectSaml({ projectId, name: "Okta", isEnabled: true });

      await runOnPoolWith({ statement_timeout: 1_000, query_timeout: 20_000 });
      const holder: QueryRunner = await holdRow(projectId);

      try {
        const failure: unknown = await failureOfSave();

        expect((failure as Error | null)?.message).toBe(
          "canceling statement due to statement timeout",
        );
        expect(StatementOutcome.mayStillApply(failure)).toBe(false);
        expect(Array.from(heldLocks)).toEqual([]);

        await letGo(holder);

        expect(await ruleOf(projectId)).toBe(false);
      } finally {
        await letGo(holder);
      }
    });
  });
});
