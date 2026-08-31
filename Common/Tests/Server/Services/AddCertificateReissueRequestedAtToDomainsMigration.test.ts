import { AddCertificateReissueRequestedAtToDomains1790300000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1790300000000-AddCertificateReissueRequestedAtToDomains";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * The column behind the reissue cooldown, on both custom-domain tables.
 *
 * certificateReissueRequestedAt is the only durable state the throttle has.
 * Three things have to hold or a deployed installation breaks on upgrade:
 *
 *   1. up() adds it to BOTH tables, nullable with no default. NULL means
 *      "never reissued", which is true of every domain that exists the day
 *      this ships and is what lets the first press of the button through. A
 *      NOT NULL DEFAULT now() would put every existing customer into a
 *      cooldown they never triggered.
 *   2. down() removes exactly what up() added.
 *   3. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration never runs on boot, so the reissue route's
 *      SELECT and conditional UPDATE would 500 on a column that is not there.
 *
 * The model side is asserted alongside it, because a column that exists in
 * Postgres and not on the entity (or vice versa) is the same outage from the
 * customer's side.
 */

const MIGRATION_NAME: string =
  "AddCertificateReissueRequestedAtToDomains1790300000000";

const COLUMN_NAME: string = "certificateReissueRequestedAt";

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

describe(`${MIGRATION_NAME} — SQL contract`, () => {
  test("up() adds the column to both domain tables", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddCertificateReissueRequestedAtToDomains1790300000000().up(
      runner,
    );

    expect(statements).toEqual([
      `ALTER TABLE "StatusPageDomain" ADD "${COLUMN_NAME}" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "DashboardDomain" ADD "${COLUMN_NAME}" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  /*
   * NULL is a meaning on this column: the claim query is
   * `certificateReissueRequestedAt <= :cutoff OR IS NULL`, and NULL is the
   * half that says "never reissued, go ahead". A DEFAULT would silently put
   * every domain that already exists into a cooldown on the day of the
   * upgrade, and the first customer to press the button would be refused for
   * something they never did.
   */
  test("the column is nullable with no default and no backfill", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddCertificateReissueRequestedAtToDomains1790300000000().up(
      runner,
    );

    for (const statement of statements) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("UPDATE");
    }
  });

  test("it is a timestamp with a timezone, so a cooldown means the same everywhere", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddCertificateReissueRequestedAtToDomains1790300000000().up(
      runner,
    );

    for (const statement of statements) {
      expect(statement).toContain("TIMESTAMP WITH TIME ZONE");
    }
  });

  test("down() drops exactly what up() added, in reverse order", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddCertificateReissueRequestedAtToDomains1790300000000().down(
      runner,
    );

    expect(statements).toEqual([
      `ALTER TABLE "DashboardDomain" DROP COLUMN "${COLUMN_NAME}"`,
      `ALTER TABLE "StatusPageDomain" DROP COLUMN "${COLUMN_NAME}"`,
    ]);
  });

  test("up() and down() name the same tables", async () => {
    const { runner: upRunner, statements: upStatements } = makeQueryRunner();
    const { runner: downRunner, statements: downStatements } =
      makeQueryRunner();

    await new AddCertificateReissueRequestedAtToDomains1790300000000().up(
      upRunner,
    );
    await new AddCertificateReissueRequestedAtToDomains1790300000000().down(
      downRunner,
    );

    type TablesInFunction = (statements: Array<string>) => Array<string>;

    const tablesIn: TablesInFunction = (
      statements: Array<string>,
    ): Array<string> => {
      return statements
        .map((sql: string) => {
          return sql.split(`ALTER TABLE "`)[1]!.split('"')[0]!;
        })
        .sort();
    };

    expect(tablesIn(downStatements)).toEqual(tablesIn(upStatements));
  });
});

describe(`${MIGRATION_NAME} — registration`, () => {
  /*
   * The step AGENTS.md calls out and the one that fails silently: a migration
   * that is not in this array never runs, so the column is missing in a real
   * deployment while the route both SELECTs and UPDATEs it.
   */
  test("the migration is registered so it runs on boot", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface): string => {
        return migration.name;
      },
    );

    expect(names).toContain(MIGRATION_NAME);
  });

  test("it is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: new () => MigrationInterface): boolean => {
        return migration.name === MIGRATION_NAME;
      },
    ).length;

    expect(occurrences).toBe(1);
  });
});

type DomainModelSpec = [
  string,
  new () => BaseModel,
  string,
  Permission,
  Permission,
];

const domainModels: Array<DomainModelSpec> = [
  [
    "StatusPageDomain",
    StatusPageDomain,
    "StatusPageDomain",
    Permission.ReadStatusPageDomain,
    Permission.EditStatusPageDomain,
  ],
  [
    "DashboardDomain",
    DashboardDomain,
    "DashboardDomain",
    Permission.ReadDashboardDomain,
    Permission.EditDashboardDomain,
  ],
];

describe.each(domainModels)(
  "%s.certificateReissueRequestedAt",
  (
    _name: string,
    modelType: new () => BaseModel,
    tableName: string,
    readPermission: Permission,
    editPermission: Permission,
  ) => {
    test("the entity declares the column the migration adds", () => {
      const columns: Array<ColumnMetadataArgs> =
        getMetadataArgsStorage().columns.filter(
          (column: ColumnMetadataArgs) => {
            return (column.target as { name?: string })?.name === tableName;
          },
        );

      const column: ColumnMetadataArgs | undefined = columns.find(
        (candidate: ColumnMetadataArgs) => {
          return candidate.propertyName === COLUMN_NAME;
        },
      );

      expect(column).toBeDefined();
      expect(column!.options.type).toBe(ColumnType.Date);
      expect(column!.options.nullable).toBe(true);
    });

    test("it is a date column in the model metadata", () => {
      const metadata: TableColumnMetadata =
        new modelType().getTableColumnMetadata(
          COLUMN_NAME,
        ) as TableColumnMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.type).toBe(TableColumnType.Date);
    });

    /*
     * Computed, so it never appears on a create or update payload. The
     * throttle is only a throttle while the customer cannot write the column
     * that holds it — an editable stamp is a cooldown anyone can clear.
     */
    test("it is computed, so a customer cannot write it", () => {
      const metadata: TableColumnMetadata =
        new modelType().getTableColumnMetadata(
          COLUMN_NAME,
        ) as TableColumnMetadata;

      expect(metadata.computed).toBe(true);
    });

    test("nobody can create or update it through the CRUD API", () => {
      const accessControl: {
        create: Array<Permission>;
        read: Array<Permission>;
        update: Array<Permission>;
      } = new modelType().getColumnAccessControlFor(COLUMN_NAME)!;

      expect(accessControl.create).toEqual([]);
      expect(accessControl.update).toEqual([]);
      expect(accessControl.update).not.toContain(editPermission);
    });

    /*
     * Readable, though: the dashboard renders the countdown from this value,
     * so a viewer who can see the domain has to be able to see when its
     * cooldown ends.
     */
    test("anyone who can read the domain can read the stamp", () => {
      const accessControl: {
        read: Array<Permission>;
      } = new modelType().getColumnAccessControlFor(COLUMN_NAME)!;

      expect(accessControl.read).toContain(readPermission);
      expect(accessControl.read).toContain(Permission.ProjectOwner);
      expect(accessControl.read).toContain(Permission.ProjectAdmin);
    });
  },
);
