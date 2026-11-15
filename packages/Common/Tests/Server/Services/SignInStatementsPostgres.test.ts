/*
 * HOW MANY POSTGRES STATEMENTS A SIGN-IN, AND A REQUEST ACROSS SOMEONE'S
 * PROJECTS, COST.
 *
 * A customer's install ran out of Postgres connections: every pool slot
 * busy, sign-ins timing out, the dashboard's header failing to load. Two of
 * the paths that held those connections are pinned here, against a real
 * Postgres:
 *
 *   - a sign-in rebuilds the person's permission set in every project
 *     (AccessTokenService.refreshUserAllPermissions). It read their
 *     memberships, then each project's memberships and permission rows in
 *     turn: 1 + 3 x N statements, one after another - 4 for one project, 31
 *     for ten, 901 for three hundred. Now: their memberships once and their
 *     teams' permission rows once (two statements, as TypeORM pages a read
 *     that selects labels), however many projects.
 *   - a request across the person's projects (is-multi-tenant-query; the
 *     header sends five on every page) asked every project's questions at
 *     once. With this server's minute-long answers run out, each project
 *     cost a read of its row for whether it is blocked and another of the
 *     same row for its sign-in rule: 590 statements for the 300 projects
 *     here, 300 at once - and three more a project with the permission
 *     cache lost too (1,437). Now: one read of every project's row, and
 *     with the permission cache lost, the same two-statement rebuild a
 *     sign-in makes.
 *
 * Also pinned: every set a sign-in writes is row for row the set the
 * per-project path (refreshUserTenantAccessPermission, unchanged) builds,
 * for owners, members, custom roles with label-limited rows and blocks, and
 * Owned rows; a request across projects answers each project as its own
 * lookups answer it; and a person's memberships are read through the
 * ("userId", "projectId") index (AddTeamMemberUserProjectIndex1809168000000).
 *
 * The services run for real against a migrated Postgres, the statements
 * they issue counted off the DataSource's logger. Stubbed: Redis (kept in
 * memory, values serialised as GlobalCache serialises them), the realtime
 * announcements, and the server's own Require SSO for Login (one read per
 * server a minute, whatever the number of projects).
 *
 * Opt in with RUN_POSTGRES_SIGN_IN_STATEMENTS_TESTS=true against a Postgres
 * migrated to head, e.g. the Postgres Schema Drift workflow's database
 * (.github/workflows/postgres-schema-drift.yaml runs it):
 *
 *   RUN_POSTGRES_SIGN_IN_STATEMENTS_TESTS=true \
 *   SIGN_IN_STATEMENTS_TEST_DATABASE_HOST=127.0.0.1 \
 *   SIGN_IN_STATEMENTS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/SignInStatementsPostgres.test.ts
 *
 * SIGN_IN_STATEMENTS_PRINT=true prints every statement counted. The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards; every row is synthetic.
 */

import Entities from "../../../Models/DatabaseModels/Index";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
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
import { DataSource, Logger, QueryRunner } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SIGN_IN_STATEMENTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const PRINT_STATEMENTS: boolean =
  process.env["SIGN_IN_STATEMENTS_PRINT"] === "true";

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

// Cloning the tables and loading every entity takes a while on a busy runner.
const SETUP_TIMEOUT_MS: number = 5 * 60 * 1000;
const TEST_TIMEOUT_MS: number = 2 * 60 * 1000;

const DASHES: RegExp = /-/g;

// Transaction control is not a statement of its own for this count.
const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i;

/*
 * The most statements each may issue. A change that takes one out lowers
 * its number here; one that needs another says why, here.
 */
const MOST_STATEMENTS: Readonly<Record<string, number>> = {
  // Memberships, and permission rows (TypeORM pages a read with labels in two).
  signIn: 3,
  // Every project's row, in one statement.
  acrossProjectsWithPermissionsCached: 1,
  // The global permission, the rows, and the two-read rebuild of every set.
  acrossProjectsWithNothingCached: 5,
};

/*
 * What main issued for the same work, counted the same way on the same
 * rows (ten of the 300 projects are blocked: main read only whether those
 * were blocked, and two reads of every other row).
 */
const MAIN_STATEMENTS: Readonly<Record<string, number>> = {
  signIn1: 4,
  signIn10: 31,
  signIn300: 901,
  acrossProjectsWithPermissionsCached: 590,
  acrossProjectsWithNothingCached: 1437,
};

const BASE_TABLES: Array<string> = ["Project", "Team", "TeamMember"];

// A statement that reads the table, its schema named or not.
const READS_TABLE: (table: string) => RegExp = (table: string): RegExp => {
  return new RegExp(`FROM ("[^"]+"\\.)?"${table}" "${table}"`);
};

// Every statement the DataSource runs while counting is on.
class StatementLog implements Logger {
  public statements: Array<{ query: string; parameters: Array<unknown> }> = [];
  public isCounting: boolean = false;

  public logQuery(
    query: string,
    parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isCounting && !TRANSACTION_CONTROL.test(query)) {
      this.statements.push({ query, parameters: parameters || [] });
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

interface SeededProject {
  projectId: ObjectID;
  ownersTeamId: ObjectID;
  membersTeamId: ObjectID;
  customRoleTeamId: ObjectID;
  ownedScopeTeamId: ObjectID;
}

describePostgres(
  "statements a sign-in and a request across projects cost (Postgres)",
  () => {
    const schema: string = `sign_in_statements_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    const statementLog: StatementLog = new StatementLog();
    let database: DataSource;

    // Three people: in one project, in ten, in all three hundred.
    const personIn1: ObjectID = ObjectID.generate();
    const personIn10: ObjectID = ObjectID.generate();
    const personIn300: ObjectID = ObjectID.generate();

    const projects: Array<SeededProject> = [];

    // Redis, in memory, keyed as GlobalCache keys it.
    const cache: Map<string, string> = new Map<string, string>();

    let rowNumber: number = 0;

    const request: ExpressRequest = {
      headers: {},
      cookies: {},
    } as unknown as ExpressRequest;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SIGN_IN_STATEMENTS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SIGN_IN_STATEMENTS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SIGN_IN_STATEMENTS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: statementLog,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      const tables: Set<string> = new Set<string>(BASE_TABLES);

      const labels: RelationMetadata | undefined = database
        .getMetadata(TeamPermission)
        .findRelationWithPropertyPath("labels");

      expect(labels?.junctionEntityMetadata).toBeTruthy();

      tables.add(database.getMetadata(TeamPermission).tableName);
      tables.add(labels!.junctionEntityMetadata!.tableName);
      tables.add(labels!.inverseEntityMetadata.tableName);

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // A fixture names only what the paths read; keys stay NOT NULL.
      const columns: Array<{ table_name: string; column_name: string }> =
        await database.query(
          `SELECT c.table_name, c.column_name FROM information_schema.columns c
           WHERE c.table_schema = $1 AND c.is_nullable = 'NO'
             AND NOT EXISTS (
               SELECT 1 FROM information_schema.table_constraints t
               JOIN information_schema.key_column_usage k
                 ON k.constraint_name = t.constraint_name
                AND k.table_schema = t.table_schema
               WHERE t.constraint_type = 'PRIMARY KEY'
                 AND t.table_schema = c.table_schema
                 AND k.table_name = c.table_name
                 AND k.column_name = c.column_name
             )`,
          [schema],
        );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      await seed();

      for (const table of tables) {
        await database.query(`ANALYZE "${schema}"."${table}"`);
      }
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      jest.spyOn(RealtimeAccessChanges, "announce").mockImplementation(() => {
        return undefined;
      });

      // Read once per server a minute, whatever the number of projects.
      jest
        .spyOn(GlobalConfigService, "getRequireSsoForLogin")
        .mockResolvedValue(false);

      stubCache();
      cache.clear();
      forgetEveryProject();
    });

    afterEach(() => {
      jest.restoreAllMocks();
      statementLog.isCounting = false;
    });

    // Redis, in memory: the string calls every GlobalCache read and write goes through.
    function stubCache(): void {
      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (namespace: string, key: string) => {
          return cache.get(`${namespace}-${key}`) ?? null;
        });

      jest
        .spyOn(GlobalCache, "getStrings")
        .mockImplementation(async (namespace: string, keys: Array<string>) => {
          return keys.map((key: string) => {
            return cache.get(`${namespace}-${key}`) ?? null;
          });
        });

      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            cache.set(`${namespace}-${key}`, value);
          },
        );

      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (namespace: string, key: string) => {
          cache.delete(`${namespace}-${key}`);
        });
    }

    // This server's minute-long answers about every project, run out.
    function forgetEveryProject(): void {
      ProjectService.forgetSignInRules();

      for (const project of projects) {
        ProjectService.forgetBlockedStatus(project.projectId);
      }
    }

    async function counted<T>(
      description: string,
      work: () => Promise<T>,
    ): Promise<{ result: T; statements: Array<string> }> {
      statementLog.statements = [];
      statementLog.isCounting = true;

      let result: T;

      try {
        result = await work();
      } finally {
        statementLog.isCounting = false;
      }

      const statements: Array<string> = statementLog.statements.map(
        (statement: { query: string }) => {
          return statement.query;
        },
      );

      if (PRINT_STATEMENTS) {
        // eslint-disable-next-line no-console
        console.log(
          `${description}: ${statements.length} statement(s)\n${statements
            .map((statement: string, index: number) => {
              return `  ${index + 1}. ${statement.slice(0, 400)}`;
            })
            .join("\n")}`,
        );
      }

      return { result, statements };
    }

    function nextId(): ObjectID {
      rowNumber++;
      return new ObjectID(
        `5e000000-0000-4000-8000-${rowNumber.toString(16).padStart(12, "0")}`,
      );
    }

    async function insertRows(
      table: string,
      columns: Array<string>,
      rows: Array<Array<string | number | boolean | null>>,
    ): Promise<void> {
      for (let start: number = 0; start < rows.length; start += 500) {
        const batch: Array<Array<string | number | boolean | null>> =
          rows.slice(start, start + 500);
        const parameters: Array<string | number | boolean | null> = [];

        const values: string = batch
          .map((row: Array<string | number | boolean | null>) => {
            return `(${row
              .map((value: string | number | boolean | null) => {
                parameters.push(value);
                return `$${parameters.length}`;
              })
              .join(", ")})`;
          })
          .join(", ");

        await database.query(
          `INSERT INTO "${table}" (${columns
            .map((column: string) => {
              return `"${column}"`;
            })
            .join(", ")}) VALUES ${values}`,
          parameters,
        );
      }
    }

    /*
     * Three hundred projects, set up as the permission suites set one up:
     * Owners and Members teams with their roles, a custom role whose rows
     * are limited to labels and block another, an Owned-scope team. The
     * person in all of them is in Owners and Members everywhere, the
     * custom role in every third project and the Owned team in every fifth,
     * and invited to (not yet in) Owners of every seventh; the others are
     * in the first ten projects and the first one. Four thousand
     * memberships of other people fill the table around theirs.
     */
    async function seed(): Promise<void> {
      const projectRows: Array<Array<string | number | boolean | null>> = [];
      const teamRows: Array<Array<string | number | boolean | null>> = [];
      const labelRows: Array<Array<string | number | boolean | null>> = [];
      const permissionRows: Array<Array<string | number | boolean | null>> = [];
      const permissionLabelRows: Array<
        Array<string | number | boolean | null>
      > = [];
      const memberRows: Array<Array<string | number | boolean | null>> = [];

      let createdAt: number = Date.UTC(2026, 0, 1);

      const at: () => string = (): string => {
        createdAt += 1000;
        return new Date(createdAt).toISOString();
      };

      const grant: (data: {
        project: SeededProject;
        teamId: ObjectID;
        permission: Permission;
        isBlockPermission?: boolean;
        scope?: PermissionScope;
        labelIds?: Array<ObjectID>;
      }) => void = (data: {
        project: SeededProject;
        teamId: ObjectID;
        permission: Permission;
        isBlockPermission?: boolean;
        scope?: PermissionScope;
        labelIds?: Array<ObjectID>;
      }): void => {
        const permissionId: ObjectID = nextId();

        permissionRows.push([
          permissionId.toString(),
          data.project.projectId.toString(),
          data.teamId.toString(),
          data.permission,
          data.isBlockPermission || false,
          data.scope || PermissionScope.All,
          at(),
          1,
        ]);

        for (const labelId of data.labelIds || []) {
          permissionLabelRows.push([
            permissionId.toString(),
            labelId.toString(),
          ]);
        }
      };

      const member: (
        userId: ObjectID,
        project: SeededProject,
        teamId: ObjectID,
        hasAcceptedInvitation?: boolean,
      ) => void = (
        userId: ObjectID,
        project: SeededProject,
        teamId: ObjectID,
        hasAcceptedInvitation: boolean = true,
      ): void => {
        memberRows.push([
          nextId().toString(),
          project.projectId.toString(),
          teamId.toString(),
          userId.toString(),
          hasAcceptedInvitation,
          at(),
          1,
        ]);
      };

      for (let index: number = 0; index < 300; index++) {
        const project: SeededProject = {
          projectId: nextId(),
          ownersTeamId: nextId(),
          membersTeamId: nextId(),
          customRoleTeamId: nextId(),
          ownedScopeTeamId: nextId(),
        };

        projects.push(project);

        projectRows.push([
          project.projectId.toString(),
          `Project ${index}`,
          project.projectId.toString(),
          // Every 29th is blocked; every 37th asks for SSO.
          index % 29 === 28,
          index % 37 === 36,
          at(),
          1,
        ]);

        for (const [teamId, name] of [
          [project.ownersTeamId, "Owners"],
          [project.membersTeamId, "Members"],
          [project.customRoleTeamId, "Monitor editors"],
          [project.ownedScopeTeamId, "Incident owners"],
        ] as Array<[ObjectID, string]>) {
          teamRows.push([
            teamId.toString(),
            project.projectId.toString(),
            name,
            at(),
            1,
          ]);
        }

        const labelA: ObjectID = nextId();
        const labelB: ObjectID = nextId();

        for (const [labelId, name] of [
          [labelA, "Production"],
          [labelB, "Critical"],
        ] as Array<[ObjectID, string]>) {
          labelRows.push([
            labelId.toString(),
            project.projectId.toString(),
            name,
            at(),
            1,
          ]);
        }

        grant({
          project,
          teamId: project.ownersTeamId,
          permission: Permission.ProjectOwner,
        });

        for (const permission of [
          Permission.ProjectMember,
          Permission.ReadProjectIncident,
          Permission.EditProjectIncident,
          Permission.CreateIncidentPublicNote,
        ]) {
          grant({ project, teamId: project.membersTeamId, permission });
        }

        grant({
          project,
          teamId: project.customRoleTeamId,
          permission: Permission.ReadProjectMonitor,
          scope: PermissionScope.Labels,
          labelIds: [labelA, labelB],
        });
        grant({
          project,
          teamId: project.customRoleTeamId,
          permission: Permission.EditProjectMonitor,
          scope: PermissionScope.Labels,
          labelIds: [labelB],
        });
        grant({
          project,
          teamId: project.customRoleTeamId,
          permission: Permission.DeleteProjectMonitor,
          isBlockPermission: true,
        });
        grant({
          project,
          teamId: project.ownedScopeTeamId,
          permission: Permission.EditProjectIncident,
          scope: PermissionScope.Owned,
        });

        member(personIn300, project, project.ownersTeamId, index % 7 !== 6);
        member(personIn300, project, project.membersTeamId);

        if (index % 3 === 0) {
          member(personIn300, project, project.customRoleTeamId);
        }

        if (index % 5 === 0) {
          member(personIn300, project, project.ownedScopeTeamId);
        }

        if (index < 10) {
          member(personIn10, project, project.membersTeamId);
          member(personIn10, project, project.customRoleTeamId);
        }

        if (index === 0) {
          member(personIn1, project, project.ownersTeamId);
        }

        for (let other: number = 0; other < 13; other++) {
          member(
            new ObjectID(
              `5f000000-0000-4000-8000-${(index * 13 + other)
                .toString(16)
                .padStart(12, "0")}`,
            ),
            project,
            other % 2 === 0 ? project.membersTeamId : project.ownersTeamId,
            other % 4 !== 3,
          );
        }
      }

      await insertRows(
        "Project",
        [
          "_id",
          "name",
          "slug",
          "isBlocked",
          "requireSsoForLogin",
          "createdAt",
          "version",
        ],
        projectRows,
      );
      await insertRows(
        "Team",
        ["_id", "projectId", "name", "createdAt", "version"],
        teamRows,
      );
      await insertRows(
        "Label",
        ["_id", "projectId", "name", "createdAt", "version"],
        labelRows,
      );
      await insertRows(
        "TeamPermission",
        [
          "_id",
          "projectId",
          "teamId",
          "permission",
          "isBlockPermission",
          "scope",
          "createdAt",
          "version",
        ],
        permissionRows,
      );
      await insertRows(
        "TeamPermissionLabel",
        ["teamPermissionId", "labelId"],
        permissionLabelRows,
      );
      await insertRows(
        "TeamMember",
        [
          "_id",
          "projectId",
          "teamId",
          "userId",
          "hasAcceptedInvitation",
          "createdAt",
          "version",
        ],
        memberRows,
      );
    }

    function rowsOf(
      permission: UserTenantAccessPermission | null | undefined,
    ): Array<UserPermission> {
      if (!permission) {
        return [];
      }

      /*
       * A row's labels are a set: neither path orders the labels it reads
       * of a row, so they are compared in one order.
       */
      return (
        JSON.parse(JSON.stringify(JSONFunctions.serialize(permission))) as {
          permissions: Array<UserPermission>;
        }
      ).permissions.map((row: UserPermission): UserPermission => {
        return {
          ...row,
          labelIds: [...(row.labelIds || [])].sort(
            (a: unknown, b: unknown): number => {
              return JSON.stringify(a).localeCompare(JSON.stringify(b));
            },
          ) as Array<ObjectID>,
        };
      });
    }

    function cachedSet(
      userId: ObjectID,
      projectId: ObjectID,
    ): UserTenantAccessPermission | null {
      const raw: string | undefined = cache.get(
        `project-permissions-${userId.toString()}:${projectId.toString()}`,
      );

      return raw
        ? (JSONFunctions.deserialize(
            JSONFunctions.parse(raw) as never,
          ) as unknown as UserTenantAccessPermission)
        : null;
    }

    describe("a sign-in", () => {
      for (const [label, personOf, projectCount] of [
        [
          "one project",
          (): ObjectID => {
            return personIn1;
          },
          1,
        ],
        [
          "ten projects",
          (): ObjectID => {
            return personIn10;
          },
          10,
        ],
        [
          "three hundred projects",
          (): ObjectID => {
            return personIn300;
          },
          300,
        ],
      ] as Array<[string, () => ObjectID, number]>) {
        test(
          `someone in ${label}: at most ${MOST_STATEMENTS["signIn"]} statements (main: ${MAIN_STATEMENTS[`signIn${projectCount}`]})`,
          async () => {
            const { statements } = await counted(`sign-in, ${label}`, () => {
              return AccessTokenService.refreshUserAllPermissions(personOf());
            });

            expect(statements.length).toBeLessThanOrEqual(
              MOST_STATEMENTS["signIn"]!,
            );
            expect(statements.length).toBeLessThan(
              MAIN_STATEMENTS[`signIn${projectCount}`]!,
            );

            const global: UserGlobalAccessPermission =
              (await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(
                personOf(),
              ))!;

            expect(global.projectIds).toHaveLength(projectCount);

            for (const projectId of global.projectIds) {
              expect(cachedSet(personOf(), projectId)).not.toBeNull();
            }
          },
          TEST_TIMEOUT_MS,
        );
      }

      test(
        "every set it writes is the set the per-project path builds from Postgres, row for row and in order",
        async () => {
          await AccessTokenService.refreshUserAllPermissions(personIn300);

          const written: Map<string, Array<UserPermission>> = new Map();

          for (const project of projects) {
            written.set(
              project.projectId.toString(),
              rowsOf(cachedSet(personIn300, project.projectId)),
            );
          }

          let labelLimited: number = 0;
          let blocks: number = 0;
          let owned: number = 0;

          for (const project of projects) {
            const perProject: UserTenantAccessPermission | null =
              await AccessTokenService.refreshUserTenantAccessPermission(
                personIn300,
                project.projectId,
                { forgetLiveUpdateReaders: false },
              );

            const rows: Array<UserPermission> = written.get(
              project.projectId.toString(),
            )!;

            expect(rows).toEqual(rowsOf(perProject));
            expect(rows.length).toBeGreaterThan(3);

            labelLimited += rows.filter((row: UserPermission) => {
              return row.labelIds.length > 0;
            }).length;
            blocks += rows.filter((row: UserPermission) => {
              return row.isBlockPermission === true;
            }).length;
            owned += rows.filter((row: UserPermission) => {
              return row.scope === PermissionScope.Owned;
            }).length;
          }

          // Each kind of row was compared, in many projects.
          expect(labelLimited).toBe(200);
          expect(blocks).toBe(100);
          expect(owned).toBe(60);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("a request across someone's three hundred projects", () => {
      // What the middleware reads for one: the global permission, then every project.
      async function requestAcrossProjects(): Promise<Dictionary<UserTenantAccessPermission> | null> {
        const global: UserGlobalAccessPermission | null =
          await AccessTokenService.getUserGlobalAccessPermission(personIn300);

        return await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
          request,
          personIn300,
          global!.projectIds,
          global,
        );
      }

      test(
        `this server's answers run out, the permission cache kept: ${MOST_STATEMENTS["acrossProjectsWithPermissionsCached"]} statement (main: ${MAIN_STATEMENTS["acrossProjectsWithPermissionsCached"]})`,
        async () => {
          await AccessTokenService.refreshUserAllPermissions(personIn300);
          forgetEveryProject();

          const { statements } = await counted(
            "across projects, permissions cached",
            requestAcrossProjects,
          );

          expect(statements).toHaveLength(
            MOST_STATEMENTS["acrossProjectsWithPermissionsCached"]!,
          );
          expect(statements[0]).toMatch(READS_TABLE("Project"));

          // And the next request reads nothing.
          const { statements: again } = await counted(
            "across projects, again",
            requestAcrossProjects,
          );

          expect(again).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );

      test(
        `everything run out, the permission cache lost too: ${MOST_STATEMENTS["acrossProjectsWithNothingCached"]} statements (main: ${MAIN_STATEMENTS["acrossProjectsWithNothingCached"]})`,
        async () => {
          const { result, statements } = await counted(
            "across projects, nothing cached",
            requestAcrossProjects,
          );

          expect(statements.length).toBeLessThanOrEqual(
            MOST_STATEMENTS["acrossProjectsWithNothingCached"]!,
          );

          // The sets it rebuilt are kept: the next request reads nothing.
          expect(Object.keys(result || {}).length).toBeGreaterThan(250);

          const { statements: again } = await counted(
            "across projects, after the rebuild",
            requestAcrossProjects,
          );

          expect(again).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );

      test(
        "each project is answered as its own lookups answer it: blocked left out, SSO not met the default set, members their sets",
        async () => {
          await AccessTokenService.refreshUserAllPermissions(personIn300);
          forgetEveryProject();

          const result: Dictionary<UserTenantAccessPermission> =
            (await requestAcrossProjects())!;

          const global: UserGlobalAccessPermission =
            (await AccessTokenService.getUserGlobalAccessPermission(
              personIn300,
            ))!;

          for (const projectId of global.projectIds) {
            const index: number = projects.findIndex(
              (project: SeededProject) => {
                return project.projectId.toString() === projectId.toString();
              },
            );

            if (index % 29 === 28) {
              expect(result[projectId.toString()]).toBeUndefined();
              continue;
            }

            if (index % 37 === 36) {
              expect(rowsOf(result[projectId.toString()])).toEqual(
                rowsOf(
                  UserPermissionUtil.getDefaultUserTenantAccessPermission(
                    projectId,
                  ),
                ),
              );
              continue;
            }

            expect(rowsOf(result[projectId.toString()])).toEqual(
              rowsOf(
                await AccessTokenService.getUserTenantAccessPermission(
                  personIn300,
                  projectId,
                  { userGlobalAccessPermission: global },
                ),
              ),
            );
          }

          expect(Object.keys(result)).toHaveLength(
            300 -
              projects.filter((_project: SeededProject, index: number) => {
                return index % 29 === 28;
              }).length,
          );
        },
        TEST_TIMEOUT_MS,
      );

      test(
        "a project deleted since the person's list was read is left out, for one more statement of its own",
        async () => {
          await AccessTokenService.refreshUserAllPermissions(personIn300);
          forgetEveryProject();

          const global: UserGlobalAccessPermission =
            (await AccessTokenService.getUserGlobalAccessPermission(
              personIn300,
            ))!;
          const gone: ObjectID = new ObjectID(
            "5d000000-0000-4000-8000-000000000001",
          );

          const { result, statements } = await counted(
            "across projects, one deleted",
            () => {
              return UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
                request,
                personIn300,
                [...global.projectIds, gone],
                global,
              );
            },
          );

          expect(result?.[gone.toString()]).toBeUndefined();
          expect(statements).toHaveLength(2);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("a person's memberships are read through their index", () => {
      test("the migration built ('userId', 'projectId') on TeamMember, as the model declares it", async () => {
        const indexes: Array<{ indexdef: string }> = await database.query(
          `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'TeamMember' AND indexname = 'IDX_2b0c3c8c89e21cadd48af0c979'`,
        );

        expect(indexes).toHaveLength(1);
        expect(indexes[0]!.indexdef).toContain(`("userId", "projectId")`);
      });

      test(
        "the sign-in's read of them uses it, not a scan of the table",
        async () => {
          statementLog.statements = [];
          statementLog.isCounting = true;

          try {
            await AccessTokenService.refreshUserAllPermissions(personIn10);
          } finally {
            statementLog.isCounting = false;
          }

          const read: { query: string; parameters: Array<unknown> } =
            statementLog.statements.find((statement: { query: string }) => {
              return READS_TABLE("TeamMember").test(statement.query);
            })!;

          expect(read).toBeTruthy();

          const plan: Array<{ "QUERY PLAN": unknown }> = await database.query(
            `EXPLAIN (FORMAT JSON) ${read.query}`,
            read.parameters,
          );
          const planText: string = JSON.stringify(plan);

          expect(planText).toMatch(/"Index Name":"[^"]*userId[^"]*"/);
          expect(planText).not.toContain(`"Node Type":"Seq Scan"`);
        },
        TEST_TIMEOUT_MS,
      );
    });
  },
);
