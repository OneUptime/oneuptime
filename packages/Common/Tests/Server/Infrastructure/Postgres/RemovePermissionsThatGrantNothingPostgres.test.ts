import { RemovePermissionsThatGrantNothing1809178600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178600000-RemovePermissionsThatGrantNothing";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The RemovePermissionsThatGrantNothing migration against a real Postgres,
 * on real rows: the 28 permissions nothing checks (#8275, #8276, #8277) -
 * the 21 Edit ... Feed ones, the four On-Call Schedule Layer User ones,
 * Create Invoices, Delete Invoices and Add Label to Resources - leave every
 * team, API key and custom role: a team's own rows, allow and block, with
 * the labels they were limited to, and the copies of a role's rows its
 * teams and keys hold. Every other permission stays: the ones that do what
 * the 28 were offered for (the layer permissions, Read and Edit Invoices,
 * a resource's Edit), their feeds' own Create and Read, names nearly
 * theirs, and a permission an earlier migration removes. A role that held
 * one has its permission count counted again without it, as
 * CustomRolePermissionService counts it (a soft-deleted row is not
 * counted); a role that held none keeps its count as it was, right or not.
 * Run twice, the second run changes nothing.
 *
 * Opt in with RUN_POSTGRES_PERMISSIONS_THAT_GRANT_NOTHING_TESTS=true and the
 * normal database credentials; PERMISSIONS_THAT_GRANT_NOTHING_TEST_DATABASE_HOST
 * / _PORT / _NAME point it at a database other than the local development
 * one. The database needs no migrations: the tables the migration writes
 * are made, with the columns and foreign keys it relies on, in a uniquely
 * named schema that is dropped afterwards, so no other row is read or
 * modified. (The Postgres Schema Drift workflow runs the migration itself
 * on the real tables, empty, with every other one.)
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PERMISSIONS_THAT_GRANT_NOTHING_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT: string = ObjectID.generate().toString();
const OTHER_PROJECT: string = ObjectID.generate().toString();

// Written out, not read from the migration, so a name it drops is a row left.
const THE_28: Array<string> = [
  "EditAlertEpisodeFeed",
  "EditAlertFeed",
  "EditCephClusterFeed",
  "EditCloudResourceFeed",
  "EditDatabaseServerFeed",
  "EditDockerHostFeed",
  "EditDockerSwarmClusterFeed",
  "EditHostFeed",
  "EditIncidentEpisodeFeed",
  "EditIncidentFeed",
  "EditKubernetesClusterFeed",
  "EditMonitorFeed",
  "EditOnCallDutyPolicyFeed",
  "EditOpenStackCloudFeed",
  "EditPodmanHostFeed",
  "EditProxmoxClusterFeed",
  "EditScheduledMaintenanceFeed",
  "EditServiceFeed",
  "EditServiceLevelObjectiveFeed",
  "EditStorageArrayFeed",
  "EditVMwareVCenterFeed",
  "CreateOnCallDutyPolicyScheduleLayerUser",
  "DeleteOnCallDutyPolicyScheduleLayerUser",
  "EditOnCallDutyPolicyScheduleLayerUser",
  "ReadOnCallDutyPolicyScheduleLayerUser",
  "CreateInvoices",
  "DeleteInvoices",
  "AddLabelsToProjectResources",
];

function id(): string {
  return ObjectID.generate().toString();
}

// The roles, by what they hold.
const ROLE_WITH_THREE_OF_THEM: string = id();
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
    label:
      "a role with Edit Incident Feed, Create On-Call Schedule Layer User, Add Label to Resources and two others",
    id: ROLE_WITH_THREE_OF_THEM,
    projectId: PROJECT,
    permissionCount: 5,
    expectedCount: 2,
  },
  {
    label: "a role with only Delete Invoices",
    id: ROLE_WITH_ONLY_ONE_OF_THEM,
    projectId: PROJECT,
    permissionCount: 1,
    expectedCount: 0,
  },
  // Wrong on purpose: a role that held none of them is not written.
  {
    label: "a role with none of them, whose count is wrong",
    id: ROLE_WITH_NONE,
    projectId: OTHER_PROJECT,
    permissionCount: 9,
    expectedCount: 9,
  },
  {
    label: "a role with one of them, one other and a soft-deleted row",
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
    customRoleId: ROLE_WITH_THREE_OF_THEM,
    projectId: PROJECT,
    permission: "EditIncidentFeed",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_THREE_OF_THEM,
    projectId: PROJECT,
    permission: "CreateOnCallDutyPolicyScheduleLayerUser",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_THREE_OF_THEM,
    projectId: PROJECT,
    permission: "AddLabelsToProjectResources",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_THREE_OF_THEM,
    projectId: PROJECT,
    permission: "CreateOnCallDutyPolicyScheduleLayer",
    removed: false,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_THREE_OF_THEM,
    projectId: PROJECT,
    permission: "ReadIncidentFeed",
    removed: false,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_ONLY_ONE_OF_THEM,
    projectId: PROJECT,
    permission: "DeleteInvoices",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_NONE,
    projectId: OTHER_PROJECT,
    permission: "ReadInvoices",
    removed: false,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permission: "EditServiceLevelObjectiveFeed",
    removed: true,
  },
  {
    id: id(),
    customRoleId: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permission: "EditProjectMonitor",
    removed: false,
  },
  // Soft-deleted: still a row, but not counted, as countBy does not count it.
  {
    id: id(),
    customRoleId: ROLE_WITH_A_SOFT_DELETED_ROW,
    projectId: PROJECT,
    permission: "ReadProjectMonitor",
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
  // How many labels the row is limited to (TeamPermissionLabel).
  labels?: number | undefined;
}

const TEAM_ROWS: Array<GrantSeed> = [
  // Every one of the 28, as a team's own row.
  ...THE_28.map((permission: string): GrantSeed => {
    return { id: id(), permission, isBlockPermission: false, removed: true };
  }),
  // A block of one goes too: it blocked nothing.
  {
    id: id(),
    permission: "EditMonitorFeed",
    isBlockPermission: true,
    removed: true,
  },
  // Limited to labels: the row goes, and its labels with it.
  {
    id: id(),
    permission: "EditAlertFeed",
    isBlockPermission: false,
    labels: 2,
    removed: true,
  },
  // What the 28 were offered for, done with these: kept.
  {
    id: id(),
    permission: "CreateOnCallDutyPolicyScheduleLayer",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "EditOnCallDutyPolicyScheduleLayer",
    isBlockPermission: false,
    labels: 1,
    removed: false,
  },
  {
    id: id(),
    permission: "DeleteOnCallDutyPolicyScheduleLayer",
    isBlockPermission: true,
    removed: false,
  },
  {
    id: id(),
    permission: "ReadOnCallDutyPolicyScheduleLayer",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "ReadInvoices",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "EditInvoices",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "EditProjectMonitor",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "CreateProjectLabel",
    isBlockPermission: false,
    removed: false,
  },
  // A feed's own Create and Read: kept.
  {
    id: id(),
    permission: "CreateIncidentFeed",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "ReadMonitorFeed",
    isBlockPermission: true,
    removed: false,
  },
  // Nearly their names: kept.
  {
    id: id(),
    permission: "editincidentfeed",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "EditIncidentFeeds",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "AddLabelsToProjectResource",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "CreateInvoice",
    isBlockPermission: false,
    removed: false,
  },
  // An earlier migration's to remove, not this one's: kept.
  {
    id: id(),
    permission: "CustomerSupport",
    isBlockPermission: false,
    removed: false,
  },
  // The team's copies of a role's rows.
  {
    id: id(),
    permission: "CreateOnCallDutyPolicyScheduleLayerUser",
    isBlockPermission: false,
    customRolePermissionId: roleRow(
      "CreateOnCallDutyPolicyScheduleLayerUser",
      ROLE_WITH_THREE_OF_THEM,
    ).id,
    removed: true,
  },
  {
    id: id(),
    permission: "CreateOnCallDutyPolicyScheduleLayer",
    isBlockPermission: false,
    customRolePermissionId: roleRow(
      "CreateOnCallDutyPolicyScheduleLayer",
      ROLE_WITH_THREE_OF_THEM,
    ).id,
    removed: false,
  },
];

const API_KEY_ROWS: Array<GrantSeed> = [
  // Every one of the 28, as a key's own row.
  ...THE_28.map((permission: string): GrantSeed => {
    return { id: id(), permission, isBlockPermission: false, removed: true };
  }),
  {
    id: id(),
    permission: "CreateInvoices",
    isBlockPermission: true,
    removed: true,
  },
  {
    id: id(),
    permission: "ProjectOwner",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "ReadOnCallDutyPolicyScheduleLayer",
    isBlockPermission: false,
    removed: false,
  },
  {
    id: id(),
    permission: "EditIncidentFeed",
    isBlockPermission: false,
    customRolePermissionId: roleRow("EditIncidentFeed", ROLE_WITH_THREE_OF_THEM)
      .id,
    removed: true,
  },
  {
    id: id(),
    permission: "ReadIncidentFeed",
    isBlockPermission: false,
    customRolePermissionId: roleRow("ReadIncidentFeed", ROLE_WITH_THREE_OF_THEM)
      .id,
    removed: false,
  },
];

describePostgres("RemovePermissionsThatGrantNothing against Postgres", () => {
  const schema: string = `permissions_that_grant_nothing_test_${ObjectID.generate()
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
    // The team rows that are limited to labels, as many times as they have labels.
    labelledTeamPermissionIds: Array<string>;
  }

  let afterUp: Snapshot;
  let afterSecondUp: Snapshot;

  async function up(): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await queryRunner.startTransaction();
      await new RemovePermissionsThatGrantNothing1809178600000().up(
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
    const labelled: Array<{ teamPermissionId: string }> = await database.query(
      `SELECT "teamPermissionId" FROM "${schema}"."TeamPermissionLabel" ORDER BY "teamPermissionId", "labelId"`,
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
      labelledTeamPermissionIds: labelled.map(
        (row: { teamPermissionId: string }): string => {
          return row.teamPermissionId;
        },
      ),
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
        process.env["PERMISSIONS_THAT_GRANT_NOTHING_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["PERMISSIONS_THAT_GRANT_NOTHING_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PERMISSIONS_THAT_GRANT_NOTHING_TEST_DATABASE_NAME"] ||
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
      const owner: string = table === "TeamPermission" ? "teamId" : "apiKeyId";

      await database.query(
        `CREATE TABLE "${schema}"."${table}" ("_id" uuid NOT NULL, "projectId" uuid NOT NULL, "${owner}" uuid, "permission" character varying(100) NOT NULL, "isBlockPermission" boolean NOT NULL DEFAULT false, "customRolePermissionId" uuid, "deletedAt" TIMESTAMP, CONSTRAINT "PK_${table}" PRIMARY KEY ("_id"), CONSTRAINT "FK_${table}_copy" FOREIGN KEY ("customRolePermissionId") REFERENCES "${schema}"."CustomRolePermission"("_id") ON DELETE CASCADE)`,
      );
    }
    // A team row's labels, as the model's join table keeps them.
    await database.query(
      `CREATE TABLE "${schema}"."TeamPermissionLabel" ("teamPermissionId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_TeamPermissionLabel" PRIMARY KEY ("teamPermissionId", "labelId"), CONSTRAINT "FK_TeamPermissionLabel_row" FOREIGN KEY ("teamPermissionId") REFERENCES "${schema}"."TeamPermission"("_id") ON DELETE CASCADE ON UPDATE CASCADE)`,
    );

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

      for (let label: number = 0; label < (row.labels || 0); label++) {
        await database.query(
          `INSERT INTO "${schema}"."TeamPermissionLabel" ("teamPermissionId", "labelId") VALUES ($1, $2)`,
          [row.id, id()],
        );
      }
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

  test("the seed holds a team row and a key row of every one of the 28", () => {
    for (const rows of [TEAM_ROWS, API_KEY_ROWS]) {
      const removed: Set<string> = new Set<string>(
        rows
          .filter((row: GrantSeed): boolean => {
            return row.removed;
          })
          .map((row: GrantSeed): string => {
            return row.permission;
          }),
      );

      expect([...removed].sort()).toEqual([...THE_28].sort());
    }
  });

  test("a team keeps every row but theirs, its copies of a role's rows included", () => {
    expect(afterUp.teamPermissionIds).toEqual(kept(TEAM_ROWS));
  });

  test("a removed team row's labels go with it, and a kept row keeps its own", () => {
    const keptLabelled: GrantSeed = TEAM_ROWS.find((row: GrantSeed) => {
      return !row.removed && (row.labels || 0) > 0;
    })!;

    expect(afterUp.labelledTeamPermissionIds).toEqual([keptLabelled.id]);
  });

  test("an API key keeps every row but theirs, its copies of a role's rows included", () => {
    expect(afterUp.apiKeyPermissionIds).toEqual(kept(API_KEY_ROWS));
  });

  test("a custom role keeps every row but theirs, a soft-deleted one included", () => {
    expect(afterUp.rolePermissionIds).toEqual(kept(ROLE_ROWS));
  });

  test.each(
    ROLES.map((role: RoleSeed): [string, RoleSeed] => {
      return [role.label, role];
    }),
  )(
    "%s: counted again only if it held one of them",
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
});
