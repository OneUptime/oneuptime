import { RemoveServiceTelemetryLinkPermissions1809176500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809176500000-RemoveServiceTelemetryLinkPermissions";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The RemoveServiceTelemetryLinkPermissions migration against a real
 * Postgres, on real rows: the four Service Telemetry Link permissions leave
 * every team, API key and custom role - a team's own rows, allow and
 * block, and the copies of a role's rows its teams and keys hold - and
 * every other permission stays, those whose names are nearly theirs too. A
 * role that held one has its permission count counted again without it,
 * as CustomRolePermissionService counts it (a soft-deleted row is not
 * counted); a role that held none keeps its count as it was, right or not.
 * Run twice, the second run changes nothing.
 *
 * Opt in with RUN_POSTGRES_SERVICE_TELEMETRY_LINK_TESTS=true and the normal
 * database credentials; SERVICE_TELEMETRY_LINK_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database needs no migrations: the four tables the migration writes are
 * made, with the columns and foreign keys it relies on, in a uniquely named
 * schema that is dropped afterwards, so no other row is read or modified.
 * (The Postgres Schema Drift workflow runs the migration itself on the real
 * tables, empty, with every other one.)
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SERVICE_TELEMETRY_LINK_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT: string = ObjectID.generate().toString();
const OTHER_PROJECT: string = ObjectID.generate().toString();

function id(): string {
  return ObjectID.generate().toString();
}

// The roles, by what they hold.
const ROLE_WITH_TWO_OF_THE_FOUR: string = id();
const ROLE_WITH_ONLY_ONE_OF_THEM: string = id();
const ROLE_WITH_NONE: string = id();
const ROLE_WITH_A_SOFT_DELETED_ROW: string = id();

interface RoleSeed {
  label: string;
  id: string;
  projectId: string;
  permissionCount: number;
  // What the count is after the migration.
  expectedCount: number;
}

const ROLES: Array<RoleSeed> = [
  {
    label: "a role with two of the four and two others",
    id: ROLE_WITH_TWO_OF_THE_FOUR,
    projectId: PROJECT,
    permissionCount: 4,
    expectedCount: 2,
  },
  {
    label: "a role with only one of the four",
    id: ROLE_WITH_ONLY_ONE_OF_THEM,
    projectId: PROJECT,
    permissionCount: 1,
    expectedCount: 0,
  },
  // Wrong on purpose: a role that held none of the four is not written.
  {
    label: "a role with none of the four, whose count is wrong",
    id: ROLE_WITH_NONE,
    projectId: OTHER_PROJECT,
    permissionCount: 7,
    expectedCount: 7,
  },
  {
    label: "a role with one of the four, one other and a soft-deleted row",
    id: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permissionCount: 3,
    expectedCount: 1,
  },
];

interface PermissionRowSeed {
  id: string;
  permission: string;
  // Whether the migration takes the row away.
  removed: boolean;
}

interface RolePermissionSeed extends PermissionRowSeed {
  customRoleId: string;
  projectId: string;
  deleted?: boolean | undefined;
}

const ROLE_ROWS: Array<RolePermissionSeed> = [
  {
    id: id(),
    customRoleId: ROLE_WITH_TWO_OF_THE_FOUR,
    projectId: PROJECT,
    permission: "ReadServiceTelemetryService",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_TWO_OF_THE_FOUR,
    projectId: PROJECT,
    permission: "EditServiceTelemetryService",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_TWO_OF_THE_FOUR,
    projectId: PROJECT,
    permission: "ReadService",
    removed: false,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_TWO_OF_THE_FOUR,
    projectId: PROJECT,
    permission: "IncidentMember",
    removed: false,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_ONLY_ONE_OF_THEM,
    projectId: PROJECT,
    permission: "CreateServiceTelemetryService",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_NONE,
    projectId: OTHER_PROJECT,
    permission: "ReadTelemetryServiceLog",
    removed: false,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permission: "DeleteServiceTelemetryService",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permission: "CreateService",
    removed: false,
  },
  // Soft-deleted: still a row, but not counted, as countBy does not count it.
  {
    id: id(),
    customRoleId: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permission: "ReadProjectIncident",
    removed: false,
    deleted: true,
  },
];

function roleRow(permission: string, roleId: string): RolePermissionSeed {
  const row: RolePermissionSeed | undefined = ROLE_ROWS.find(
    (candidate: RolePermissionSeed): boolean => {
      return (
        candidate.permission === permission && candidate.customRoleId === roleId
      );
    },
  );

  if (!row) {
    throw new Error(`No role row of ${permission}`);
  }

  return row;
}

interface GrantSeed extends PermissionRowSeed {
  isBlockPermission: boolean;
  // The role row this is a copy of (CustomRoleSync), if it is one.
  customRolePermissionId?: string | undefined;
}

const TEAM_ROWS: Array<GrantSeed> = [
  {
    id: id(),
    permission: "ReadServiceTelemetryService",
    isBlockPermission: false,
    removed: true,
  },
  // A block of one goes too: it blocked nothing.
  {
    id: id(),
    permission: "DeleteServiceTelemetryService",
    isBlockPermission: true,
    removed: true,
  },
  {
    id: id(),
    permission: "ReadService",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "ReadTelemetryServiceLog",
    isBlockPermission: true,
    removed: false,
  },
  // Nearly the four's names: kept.
  {
    id: id(),
    permission: "ReadServiceCatalog",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "readservicetelemetryservice",
    isBlockPermission: false,
    removed: false,
  },
  // The team's copies of a role's rows.
  {
    id: id(),
    permission: "ReadServiceTelemetryService",
    isBlockPermission: false,
    customRolePermissionId: roleRow(
      "ReadServiceTelemetryService",
      ROLE_WITH_TWO_OF_THE_FOUR,
    ).id,
    removed: true,
  },
  {
    id: id(),
    permission: "ReadService",
    isBlockPermission: false,
    customRolePermissionId: roleRow("ReadService", ROLE_WITH_TWO_OF_THE_FOUR)
      .id,
    removed: false,
  },
];

const API_KEY_ROWS: Array<GrantSeed> = [
  {
    id: id(),
    permission: "EditServiceTelemetryService",
    isBlockPermission: false,
    removed: true,
  },
  {
    id: id(),
    permission: "CreateServiceTelemetryService",
    isBlockPermission: true,
    removed: true,
  },
  {
    id: id(),
    permission: "ReadService",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "CreateServiceTelemetryService",
    isBlockPermission: false,
    customRolePermissionId: roleRow(
      "CreateServiceTelemetryService",
      ROLE_WITH_ONLY_ONE_OF_THEM,
    ).id,
    removed: true,
  },
  {
    id: id(),
    permission: "IncidentMember",
    isBlockPermission: false,
    customRolePermissionId: roleRow("IncidentMember", ROLE_WITH_TWO_OF_THE_FOUR)
      .id,
    removed: false,
  },
];

describePostgres(
  "RemoveServiceTelemetryLinkPermissions against Postgres",
  () => {
    const schema: string = `service_telemetry_link_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    const TEAM: string = id();
    const API_KEY: string = id();

    interface Snapshot {
      roleCounts: Map<string, number>;
      rolePermissionIds: Array<string>;
      teamPermissionIds: Array<string>;
      apiKeyPermissionIds: Array<string>;
    }

    let afterUp: Snapshot;
    let afterSecondUp: Snapshot;

    async function up(): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await queryRunner.query(`SET search_path TO "${schema}"`);
        await queryRunner.startTransaction();
        await new RemoveServiceTelemetryLinkPermissions1809176500000().up(
          queryRunner,
        );
        await queryRunner.commitTransaction();
      } catch (err) {
        await queryRunner.rollbackTransaction();
        throw err;
      } finally {
        await queryRunner.release();
      }
    }

    async function ids(table: string): Promise<Array<string>> {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."${table}" ORDER BY "_id"`,
      );

      return rows.map((row: { _id: string }): string => {
        return row._id;
      });
    }

    async function snapshot(): Promise<Snapshot> {
      const roles: Array<{ _id: string; permissionCount: number }> =
        await database.query(
          `SELECT "_id", "permissionCount" FROM "${schema}"."CustomRole"`,
        );

      return {
        roleCounts: new Map<string, number>(
          roles.map((role: { _id: string; permissionCount: number }) => {
            return [role._id, role.permissionCount];
          }),
        ),
        rolePermissionIds: await ids("CustomRolePermission"),
        teamPermissionIds: await ids("TeamPermission"),
        apiKeyPermissionIds: await ids("ApiKeyPermission"),
      };
    }

    function kept(rows: Array<PermissionRowSeed>): Array<string> {
      return rows
        .filter((row: PermissionRowSeed): boolean => {
          return !row.removed;
        })
        .map((row: PermissionRowSeed): string => {
          return row.id;
        })
        .sort();
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SERVICE_TELEMETRY_LINK_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["SERVICE_TELEMETRY_LINK_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SERVICE_TELEMETRY_LINK_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        synchronize: false,
      });
      await database.initialize();

      // The columns and keys the migration reads and writes, as the models make them.
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."CustomRole" ("_id" uuid NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "permissionCount" integer NOT NULL DEFAULT '0', "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_CustomRole" PRIMARY KEY ("_id"))`,
      );
      await database.query(
        `CREATE TABLE "${schema}"."CustomRolePermission" ("_id" uuid NOT NULL, "projectId" uuid NOT NULL, "customRoleId" uuid NOT NULL, "permission" character varying(100) NOT NULL, "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_CustomRolePermission" PRIMARY KEY ("_id"), CONSTRAINT "FK_CustomRolePermission_role" FOREIGN KEY ("customRoleId") REFERENCES "${schema}"."CustomRole"("_id") ON DELETE CASCADE)`,
      );
      for (const table of ["TeamPermission", "ApiKeyPermission"]) {
        const owner: string =
          table === "TeamPermission" ? "teamId" : "apiKeyId";

        await database.query(
          `CREATE TABLE "${schema}"."${table}" ("_id" uuid NOT NULL, "projectId" uuid NOT NULL, "${owner}" uuid, "permission" character varying(100) NOT NULL, "isBlockPermission" boolean NOT NULL DEFAULT false, "customRolePermissionId" uuid, "deletedAt" TIMESTAMP, CONSTRAINT "PK_${table}" PRIMARY KEY ("_id"), CONSTRAINT "FK_${table}_copy" FOREIGN KEY ("customRolePermissionId") REFERENCES "${schema}"."CustomRolePermission"("_id") ON DELETE CASCADE)`,
        );
      }

      for (const role of ROLES) {
        await database.query(
          `INSERT INTO "${schema}"."CustomRole" ("_id", "projectId", "name", "permissionCount") VALUES ($1, $2, $3, $4)`,
          [role.id, role.projectId, `Role ${role.id}`, role.permissionCount],
        );
      }

      for (const row of ROLE_ROWS) {
        await database.query(
          `INSERT INTO "${schema}"."CustomRolePermission" ("_id", "projectId", "customRoleId", "permission", "deletedAt") VALUES ($1, $2, $3, $4, $5)`,
          [
            row.id,
            row.projectId,
            row.customRoleId,
            row.permission,
            row.deleted ? new Date().toISOString() : null,
          ],
        );
      }

      for (const row of TEAM_ROWS) {
        await database.query(
          `INSERT INTO "${schema}"."TeamPermission" ("_id", "projectId", "teamId", "permission", "isBlockPermission", "customRolePermissionId") VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            row.id,
            PROJECT,
            TEAM,
            row.permission,
            row.isBlockPermission,
            row.customRolePermissionId || null,
          ],
        );
      }

      for (const row of API_KEY_ROWS) {
        await database.query(
          `INSERT INTO "${schema}"."ApiKeyPermission" ("_id", "projectId", "apiKeyId", "permission", "isBlockPermission", "customRolePermissionId") VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            row.id,
            PROJECT,
            API_KEY,
            row.permission,
            row.isBlockPermission,
            row.customRolePermissionId || null,
          ],
        );
      }

      await up();
      afterUp = await snapshot();
      await up();
      afterSecondUp = await snapshot();
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("a team keeps every row but the four's, its copies of a role's rows included", () => {
      expect(afterUp.teamPermissionIds).toEqual(kept(TEAM_ROWS));
    });

    test("an API key keeps every row but the four's, its copies of a role's rows included", () => {
      expect(afterUp.apiKeyPermissionIds).toEqual(kept(API_KEY_ROWS));
    });

    test("a custom role keeps every row but the four's, a soft-deleted one included", () => {
      expect(afterUp.rolePermissionIds).toEqual(kept(ROLE_ROWS));
    });

    test.each(
      ROLES.map((role: RoleSeed): [string, RoleSeed] => {
        return [role.label, role];
      }),
    )(
      "%s: counted again only if it held one of the four",
      (_label: string, role: RoleSeed) => {
        expect(afterUp.roleCounts.get(role.id)).toBe(role.expectedCount);
      },
    );

    test("no role is deleted", () => {
      expect([...afterUp.roleCounts.keys()].sort()).toEqual(
        ROLES.map((role: RoleSeed): string => {
          return role.id;
        }).sort(),
      );
    });

    test("a second run changes nothing", () => {
      expect(afterSecondUp).toEqual(afterUp);
    });
  },
);
