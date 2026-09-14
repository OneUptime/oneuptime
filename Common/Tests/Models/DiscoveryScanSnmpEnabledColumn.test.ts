/**
 * NetworkDeviceDiscoveryScan.isSnmpEnabled column contract (issue #3445).
 *
 * Before this column, a discovery scan WAS an SNMP scan: the ping sweep was
 * only the cheap gate in front of an SNMP GET, and the wizard made SNMP Version
 * a required field on its own step — so "I just want to know what is alive in
 * 10.20.30.0/24" could not be expressed at all. This column is that missing
 * sentence, and everything below pins a property that, quietly changed, either
 * refuses a write the wizard is about to make or silently changes what an
 * existing scan claims to have done.
 *
 * Three properties matter more than the rest:
 *
 *   - NOT REQUIRED, and a default-value column. The API must accept a create
 *     that omits it — every existing integration does, and the whole point of
 *     the issue is that a scan should not be blocked by a field the operator
 *     has no opinion about.
 *   - DEFAULT TRUE, in all three places that word means something. Every scan
 *     that existed before this column did was an SNMP scan, so true is the only
 *     value that leaves those rows describing the sweep they actually ran.
 *   - ACCESS CONTROL IDENTICAL TO `cidr`. This column defines the sweep exactly
 *     as the target does — the target says WHERE, this says WITH WHAT — so
 *     whoever may set one must be whoever may set the other. What is pinned
 *     below is that EQUALITY and nothing stronger. Today both carry
 *     `update: []`, so a finished scan's method is as un-rewritable as its
 *     target; a change that made the sweep-defining columns updatable as a
 *     group is meant to leave this suite green, and the failure worth catching
 *     is one of the two drifting away from the other.
 *
 * The three "default" mechanisms are separate and easy to confuse:
 *   - NEW rows get true from the Postgres column default (@Column default)
 *   - EXISTING rows got true from the migration's NOT NULL DEFAULT true
 *   - @TableColumn defaultValue is documentation for the generated API schema
 *     and the form metadata; it defaults nothing at runtime
 * All three are pinned, because asserting only one is a guard that catches
 * nothing: flipping @Column to default: false leaves the other two green while
 * every new scan silently stops doing SNMP.
 */

import NetworkDeviceDiscoveryScan from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ScanModeUtil from "../../Utils/NetworkDiscovery/ScanModeUtil";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import Columns from "../../Types/Database/Columns";
import { AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1790003445000-AddSnmpEnabledToNetworkDeviceDiscoveryScan";
import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "isSnmpEnabled";

/*
 * The column this one is measured against. `cidr` is the other half of "what
 * this sweep is": the target says WHERE, this column says WITH WHAT. Comparing
 * against it rather than against a hard-coded permission list is deliberate —
 * the two must be revised together or not at all, and a list written out here
 * would have to be re-edited by whoever revises them (there is already a change
 * in flight that grants `update` to the sweep columns as a group).
 */
const SWEEP_DEFINING_COLUMN: string = "cidr";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

/*
 * Read off the class rather than written out again: the whole point of the
 * name assertions below is that the class name, the `public name` literal
 * TypeORM records the migration under, and the file it lives in have not
 * drifted apart. A constant re-derived from a hard-coded timestamp would make
 * those assertions statements about string concatenation.
 */
const MIGRATION_CLASS: string =
  AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000.name;

const MIGRATION_TIMESTAMP: number = Number(
  MIGRATION_CLASS.match(/(\d{13})$/)?.[1],
);

/*
 * The nine columns the toggle governs, and the same list the server's create
 * hook nulls out for an ICMP-only scan
 * (NetworkDeviceDiscoveryScanService.SNMP_CONFIG_COLUMNS).
 */
const SNMP_CONFIG_COLUMNS: Array<string> = [
  "snmpVersion",
  "snmpCommunityString",
  "snmpPort",
  "snmpV3SecurityLevel",
  "snmpV3Username",
  "snmpV3AuthProtocol",
  "snmpV3AuthKey",
  "snmpV3PrivProtocol",
  "snmpV3PrivKey",
];

const ADD_COLUMN_SQL: string = `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "${COLUMN}" boolean NOT NULL DEFAULT true`;

const DROP_COLUMN_SQL: string = `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "${COLUMN}"`;

function metadata(): TableColumnMetadata {
  return new NetworkDeviceDiscoveryScan().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return (
      column.target === NetworkDeviceDiscoveryScan &&
      column.propertyName === COLUMN
    );
  });
}

/*
 * The migration is EXECUTED against this, not read as text. A file read as one
 * blob cannot tell up() from down(): a migration whose up() DROPPED the column
 * and whose down() ADDED it contains both statements, and satisfies every
 * `toContain` anyone would write against the blob. Same shape as
 * Tests/Server/Services/AddNetworkDeviceReachabilityColumnsMigration.test.ts.
 */
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

describe("NetworkDeviceDiscoveryScan.isSnmpEnabled", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.Boolean);
  });

  /*
   * The title is the label on the wizard's toggle and the heading in the
   * generated API docs. It says "Check SNMP" rather than naming the column,
   * because the operator's question is "do I want SNMP checked?" and not "is
   * SNMP enabled on this record?".
   */
  test("is titled the way the wizard labels the toggle", () => {
    expect(metadata().title).toBe("Check SNMP");
  });

  /*
   * The API documentation is the only explanation an integrator gets. It has
   * to say that the ping sweep happens either way — turning this off narrows
   * what is discovered ABOUT each host, not which hosts are found.
   */
  test("its description explains that the ping sweep happens either way", () => {
    const description: string = metadata().description ?? "";

    expect(description).toContain("ping");
    expect(description).toContain("SNMP");
    expect(description).toContain("ICMP-only");
  });

  /*
   * THE assertion of the issue. A required column makes the API reject a
   * create that omits it, which is the server-side twin of the wizard refusing
   * to advance past "SNMP Version is required" — and every integration that
   * creates scans today omits it.
   */
  test("is not required, so a create that omits it is still accepted", () => {
    expect(metadata().required).toBeFalsy();

    const requiredColumns: Columns =
      new NetworkDeviceDiscoveryScan().getRequiredColumns();

    expect(requiredColumns.columns).not.toContain(COLUMN);
    // ...and the check is not vacuous: the target genuinely is required.
    expect(requiredColumns.columns).toContain(SWEEP_DEFINING_COLUMN);
  });

  /*
   * isDefaultValueColumn is what tells DatabaseService the value comes from
   * the column default when the payload has none. Without it, a NOT NULL
   * column that nobody sent is an INSERT that fails.
   */
  test("is a default-value column, so the database fills it in", () => {
    expect(new NetworkDeviceDiscoveryScan().isDefaultValueColumn(COLUMN)).toBe(
      true,
    );
    /*
     * Contrast, so the accessor is proven to discriminate: the target has no
     * default and never could have one.
     */
    expect(
      new NetworkDeviceDiscoveryScan().isDefaultValueColumn(
        SWEEP_DEFINING_COLUMN,
      ),
    ).toBe(false);
  });

  /*
   * Mechanism 3 of 3: documentation only. This is the value the generated API
   * schema advertises and the value the form metadata seeds the toggle with,
   * and it has to say the same thing the other two mechanisms do or the docs
   * describe a product that does not exist.
   */
  test("advertises true as its default in the API schema and form metadata", () => {
    expect(metadata().defaultValue).toBe(true);
  });

  /*
   * Mechanism 1 of 3: what a NEW row gets. `default: true` is the single word
   * that decides whether a scan created by an older API client — one that
   * knows nothing about this column — does SNMP or does not.
   */
  test("a scan created without saying gets an SNMP scan from the column default", () => {
    expect(typeOrmColumn()?.options.default).toBe(true);
  });

  /*
   * NOT NULL is what makes the flag a genuine tri-state-free answer. If the
   * column could be null, "null" would become a third state that every reader
   * would have to decide about separately — which is exactly the ambiguity
   * ScanModeUtil's `!== false` exists to collapse, and no reason to introduce
   * a second source of it inside the database.
   */
  test("is not nullable, so a stored scan always states its method", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(false);
  });

  test("is readable from a relation query, like the target beside it", () => {
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new NetworkDeviceDiscoveryScan().getTableColumnMetadata(
        SWEEP_DEFINING_COLUMN,
      ).canReadOnRelationQuery,
    ).toBe(true);
  });

  /*
   * What this change did to the SNMP fields, and what it did not.
   *
   * DID: every one of the nine now says, in the description an integrator
   * reads, that it is ignored when the toggle is off. That sentence is the
   * only thing in the generated schema that explains why an snmpVersion sent
   * alongside `isSnmpEnabled: false` comes back null — the server's create
   * hook clears the SNMP config for an ICMP-only scan, and nothing else
   * documents it.
   *
   * DID NOT: make snmpVersion optional. It was already `required: false`
   * before this column existed — the wall in issue #3445 was the wizard's own
   * field config, not the model. It is asserted here anyway because the
   * feature now leans on it: an ICMP-only scan stores no version at all, so a
   * later change that made the column required would make ICMP-only scans
   * unwritable through the API while the wizard went on offering them.
   */
  test("the SNMP fields say they are ignored when the toggle is off, and stay optional", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    const undocumented: Array<string> = SNMP_CONFIG_COLUMNS.filter(
      (column: string): boolean => {
        return !(
          scan.getTableColumnMetadata(column).description ?? ""
        ).includes("Ignored when Check SNMP is off.");
      },
    );

    expect(undocumented).toEqual([]);

    expect(scan.getTableColumnMetadata("snmpVersion").required).toBeFalsy();
    expect(scan.getRequiredColumns().columns).not.toContain("snmpVersion");
  });
});

/*
 * The column is written by the model and read by ScanModeUtil, and the two are
 * only correct together: the reader's "absent means SNMP" rule is only safe
 * BECAUSE the column defaults to true, and the column's default is only
 * meaningful BECAUSE the reader agrees with it.
 */
describe("NetworkDeviceDiscoveryScan.isSnmpEnabled as ScanModeUtil reads it", () => {
  /*
   * The server's create hook is handed the model instance, whose property is
   * `undefined` until something sets it. That instance must read as an SNMP
   * scan, or the hook would null out the SNMP credentials of every scan
   * created through a path that does not set the toggle.
   */
  test("a freshly constructed scan reads as an SNMP scan", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    expect(scan.isSnmpEnabled).toBeUndefined();
    expect(ScanModeUtil.isSnmpEnabled(scan)).toBe(true);
    expect(ScanModeUtil.isIcmpOnly(scan)).toBe(false);
  });

  test("a scan with the toggle off reads as ICMP only", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.isSnmpEnabled = false;

    expect(ScanModeUtil.isSnmpEnabled(scan)).toBe(false);
    expect(ScanModeUtil.isIcmpOnly(scan)).toBe(true);
  });

  test("a scan with the toggle on reads as an SNMP scan", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.isSnmpEnabled = true;

    expect(ScanModeUtil.isSnmpEnabled(scan)).toBe(true);
    expect(ScanModeUtil.isIcmpOnly(scan)).toBe(false);
  });

  /*
   * The column's declared default and the reader's treatment of absence have
   * to be the same answer. If someone ever flips the column default to false,
   * this fails and says so, rather than leaving a database that defaults one
   * way and a reader that assumes the other.
   */
  test("the column default and the reader's reading of absence agree", () => {
    expect(typeOrmColumn()?.options.default).toBe(
      ScanModeUtil.isSnmpEnabled({}),
    );
    expect(metadata().defaultValue).toBe(ScanModeUtil.isSnmpEnabled({}));
  });
});

describe("NetworkDeviceDiscoveryScan.isSnmpEnabled access control", () => {
  function accessControlFor(column: string): ColumnAccessControl | null {
    return new NetworkDeviceDiscoveryScan().getColumnAccessControlFor(column);
  }

  /*
   * The whole claim, in one assertion: this column is governed exactly as the
   * scan target is. Written as a comparison rather than a permission list on
   * purpose — the two columns describe the same thing (what sweep is this?) and
   * must be revised together, so a change that grants `update` to the sweep
   * columns as a group keeps this green without anyone editing this file,
   * while a change that grants it to only one of the two fails here, which is
   * the case worth catching.
   */
  test("is governed exactly as the scan target is", () => {
    expect(accessControlFor(COLUMN)).toEqual(
      accessControlFor(SWEEP_DEFINING_COLUMN),
    );
  });

  /*
   * Broken out per operation so a failure says WHICH of the three drifted -
   * `toEqual` on the whole object reports a diff that is harder to read when
   * one long permission list is involved.
   */
  test("grants the same create, read and update permissions as the target", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);
    const target: ColumnAccessControl | null = accessControlFor(
      SWEEP_DEFINING_COLUMN,
    );

    expect(column?.create).toEqual(target?.create);
    expect(column?.read).toEqual(target?.read);
    expect(column?.update).toEqual(target?.update);
  });

  /*
   * ...and the comparison above is not two empty objects agreeing with each
   * other. A column with no create permission at all is silently dropped from
   * every write, which would leave the toggle in the wizard doing nothing.
   */
  test("actually grants somebody the right to set it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column).not.toBeNull();
    expect(column?.create?.length).toBeGreaterThan(0);
    expect(column?.read?.length).toBeGreaterThan(0);
  });

  /*
   * Everyone who may create a scan may state its method, and everyone who may
   * read a scan may see it. Anything narrower would produce a scan whose
   * method the creator could not choose, or a results dialog that cannot tell
   * which kind of scan it is rendering.
   */
  test("its setters are creators of the table and its readers are readers of it", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column?.create).toEqual(scan.getCreatePermissions());
    expect(column?.read).toEqual(scan.getReadPermissions());
  });
});

describe("NetworkDeviceDiscoveryScan.isSnmpEnabled migration", () => {
  /*
   * NOT NULL DEFAULT true is the only correct backfill, and the reason is
   * historical rather than stylistic:
   *
   *   - Every scan already on disk ran a ping sweep followed by an SNMP GET,
   *     because that is the only sweep the product could do. Backfilling false
   *     would rewrite history: those rows would claim to be ICMP-only sweeps,
   *     the results dialog would stop offering SNMP import for the devices they
   *     found, and a recurring scan would silently switch method on its next
   *     run.
   *   - NULL is not available either. The column is read by four layers, and a
   *     third state would have to be decided about in each of them.
   *   - Postgres fills the DEFAULT in for existing rows as part of the ADD
   *     COLUMN, so no separate UPDATE pass is needed - which also means no
   *     table rewrite to plan around on a large deployment.
   *
   * `toEqual` on the whole statement list rather than `toContain` on any one
   * of them, because "nothing else" is half the claim: no UPDATE pass, no
   * second table quietly altered, no index built on the way past.
   */
  test("up() adds the column as NOT NULL DEFAULT true, and does nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000().up(
      runner,
    );

    expect(statements).toEqual([ADD_COLUMN_SQL]);
  });

  /*
   * The direction matters as much as the SQL. Asserted through an actual call
   * to down(), so a migration that added the column in down() and dropped it
   * in up() - which would drop the column out of every deployed database on
   * the next boot - fails here rather than passing a text search that finds
   * both statements somewhere in the file.
   */
  test("down() drops exactly the column up() added, and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000().down(
      runner,
    );

    expect(statements).toEqual([DROP_COLUMN_SQL]);
  });

  /*
   * TypeORM calls `up` and `down` by name. A rename to anything else - a
   * refactor that made `up` an `upgrade`, a helper method left on the class -
   * leaves a migration the runner will not run, which is the same outcome as
   * not writing it. The prototype listing is what catches the rename at
   * runtime; the `MigrationInterface` annotation is what catches it at compile
   * time.
   */
  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });

  /*
   * TypeORM records a migration under its `public name` property, not its
   * class name, and nothing else in the suite compares the two. A rename that
   * updates the class and forgets the literal leaves the deployed identity on
   * the old value, and the migration re-runs (or refuses to) on the next boot.
   *
   * The file half is read off the directory rather than from a path built out
   * of the same string, so it also catches the collision this repo has had
   * before: two branches picking one timestamp, and one of the two migrations
   * silently never running.
   */
  test("records itself under its class name, in the one file that carries its timestamp", () => {
    const migration: MigrationInterface =
      new AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000();

    expect(migration.name).toBe(MIGRATION_CLASS);
    expect(MIGRATION_TIMESTAMP).not.toBeNaN();

    const filesForOurTimestamp: Array<string> = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((fileName: string): boolean => {
        return fileName.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(filesForOurTimestamp).toEqual([
      `${MIGRATION_TIMESTAMP}-AddSnmpEnabledToNetworkDeviceDiscoveryScan.ts`,
    ]);
  });

  /*
   * An unregistered migration never runs, so the column would be missing while
   * every query written against the model assumes it is there. Checked against
   * the imported array - the thing that actually runs on boot - rather than
   * against the text of Index.ts.
   */
  test("is registered, so the column actually exists at runtime", () => {
    expect(SchemaMigrations).toContain(
      AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000,
    );
  });

  /*
   * Migrations run in array order, and one landing BELOW a migration that has
   * already run applies out of order - which is how a schema that passes drift
   * locally still diverges between deployments.
   *
   * Only the durable half is asserted: nothing registered BEFORE this one
   * carries a later timestamp. "It is the newest" belongs to whichever
   * migration is currently newest and cannot live here, because it fails by
   * design the moment any unrelated PR appends a migration - which is exactly
   * why the hand-carried ordering guards were retired in favour of the generic
   * one in Tests/Server/Infrastructure/Postgres/SchemaMigrationsOrdering.test.ts
   * ("gives the last-registered migration the highest timestamp").
   */
  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlierTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(/(\d{13})$/);

      if (match) {
        earlierTimestamps.push(Number(match[1]));
      }
    }

    /*
     * Math.max() of an empty list is -Infinity, which every timestamp beats.
     * Prove the list was actually enumerated before leaning on its maximum,
     * or the assertion below says nothing. (InitialMigration carries no
     * timestamp, hence "greater than", not "equal to", the slice length.)
     */
    expect(earlierTimestamps.length).toBeGreaterThan(100);

    expect(MIGRATION_TIMESTAMP).toBeGreaterThan(Math.max(...earlierTimestamps));
  });

  /*
   * The migration and the model have to describe the same column. Two files,
   * one schema: the migration is what the deployed database gets, the model is
   * what every query assumes it got. Read off the SQL up() actually ran, so
   * the comparison is against the statement that reaches Postgres.
   */
  test("the SQL it runs says the same thing about the column that the model does", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000().up(
      runner,
    );

    const addColumn: string = statements[0] ?? "";

    expect(addColumn).toContain(`ADD "${COLUMN}" boolean`);
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.Boolean);

    expect(addColumn).toContain("NOT NULL");
    expect(typeOrmColumn()?.options.nullable).toBe(false);

    expect(addColumn).toContain("DEFAULT true");
    expect(typeOrmColumn()?.options.default).toBe(true);
  });
});
