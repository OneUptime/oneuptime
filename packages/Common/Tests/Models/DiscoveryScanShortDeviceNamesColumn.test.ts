/**
 * NetworkDeviceDiscoveryScan.useShortDeviceNames column contract (issue #3678).
 *
 * A discovered host with no sysName is named by its reverse-DNS record, and on
 * an estate with one corporate domain every such device reads
 * "wb-0660-kds01.wbhq.com", "wb-0660-kds02.wbhq.com", ... This column is the
 * scan's answer to "name them wb-0660-kds01 instead", and everything below
 * pins a property that, quietly changed, either renames devices nobody asked
 * to have renamed or leaves the wizard's toggle doing nothing.
 *
 * Three properties matter more than the rest:
 *
 *   - DEFAULT FALSE, in all three places that word means something. Every
 *     scan that existed before this column imported devices under their full
 *     names, and a deploy must not start importing them differently. The
 *     three mechanisms are separate and easy to confuse:
 *       - NEW rows get false from the Postgres column default (@Column default)
 *       - EXISTING rows got false from the migration's NOT NULL DEFAULT false
 *       - @TableColumn defaultValue is documentation for the generated API
 *         schema and the form metadata; it defaults nothing at runtime
 *     All three are pinned, because asserting only one is a guard that catches
 *     nothing: flipping @Column to default: true leaves the other two green
 *     while every new scan silently starts renaming.
 *   - NOT REQUIRED, and a default-value column. Every existing integration
 *     creates scans without it.
 *   - ACCESS CONTROL IDENTICAL TO `isSnmpEnabled`. It sits beside that toggle
 *     on the same wizard step and is set by exactly the same people; the two
 *     drifting apart would give the wizard a toggle some of its users can see
 *     but not save.
 */

import NetworkDeviceDiscoveryScan from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostNaming,
  buildDeviceName,
} from "../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import Columns from "../../Types/Database/Columns";
import { AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1792900000000-AddNetworkDeviceDnsNameAndShortDeviceNames";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const COLUMN: string = "useShortDeviceNames";

/*
 * The column this one is measured against: the other scan toggle on the same
 * wizard step. Compared against rather than written out as a permission list,
 * so the two are revised together or not at all.
 */
const PEER_TOGGLE_COLUMN: string = "isSnmpEnabled";

const SHORTENABLE_HOST: { ipAddress: string; dnsHostname: string } = {
  ipAddress: "10.18.167.31",
  dnsHostname: "wb-0660-kds01.wbhq.com",
};

function metadata(): TableColumnMetadata {
  return new NetworkDeviceDiscoveryScan().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(
  column: string = COLUMN,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
    return (
      args.target === NetworkDeviceDiscoveryScan && args.propertyName === column
    );
  });
}

function accessControlFor(column: string): ColumnAccessControl | null {
  return new NetworkDeviceDiscoveryScan().getColumnAccessControlFor(column);
}

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

describe("NetworkDeviceDiscoveryScan.useShortDeviceNames", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.Boolean);
  });

  test("is titled the way the wizard labels the toggle", () => {
    expect(metadata().title).toBe("Use Short Device Names");
  });

  /*
   * The API documentation is the only explanation an integrator gets. It has
   * to say what "short" means, with an example, and that nothing is lost —
   * the full DNS name is still stored on the device.
   */
  test("its description says what a short name is and that the full DNS name is kept", () => {
    const description: string = metadata().description ?? "";

    expect(description).toContain("short hostname");
    expect(description).toContain("first label");
    expect(description).toContain("DNS Name");
    expect(description).toContain("'core-sw-01'");
    expect(description).toContain("'core-sw-01.corp.example.com'");
  });

  test("is not required, so a create that omits it is still accepted", () => {
    expect(metadata().required).toBeFalsy();

    const requiredColumns: Columns =
      new NetworkDeviceDiscoveryScan().getRequiredColumns();

    expect(requiredColumns.columns).not.toContain(COLUMN);
    // ...and the check is not vacuous: the scan target genuinely is required.
    expect(requiredColumns.columns).toContain("cidr");
  });

  test("is a default-value column, so the database fills it in", () => {
    expect(new NetworkDeviceDiscoveryScan().isDefaultValueColumn(COLUMN)).toBe(
      true,
    );
    // Contrast, so the accessor is proven to discriminate.
    expect(new NetworkDeviceDiscoveryScan().isDefaultValueColumn("cidr")).toBe(
      false,
    );
  });

  // Mechanism 3 of 3: what the API schema and the form metadata advertise.
  test("advertises false as its default in the API schema and form metadata", () => {
    expect(metadata().defaultValue).toBe(false);
  });

  /*
   * Mechanism 1 of 3: what a NEW row gets. A scan created by an older API
   * client — one that has never heard of short names — must import full
   * names, exactly as it did yesterday.
   */
  test("a scan created without saying gets full names from the column default", () => {
    expect(typeOrmColumn()?.options.default).toBe(false);
  });

  /*
   * NOT NULL keeps the flag two-state in the database. The builder reads
   * "exactly true" as on, so a NULL would behave as off anyway — but a third
   * stored state is a question every other reader would have to answer.
   */
  test("is not nullable, so a stored scan always states its naming choice", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(false);
  });

  test("is readable from a relation query, like the toggle beside it", () => {
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new NetworkDeviceDiscoveryScan().getTableColumnMetadata(
        PEER_TOGGLE_COLUMN,
      ).canReadOnRelationQuery,
    ).toBe(true);
  });

  /*
   * A naming choice, not a sweep one. It has no counterpart in the SNMP
   * config block and says nothing about what the probe sends, so it must not
   * carry the "Ignored when Check SNMP is off." note those fields do.
   */
  test("is not documented as part of the SNMP configuration", () => {
    expect(metadata().description ?? "").not.toContain(
      "Ignored when Check SNMP is off.",
    );
  });
});

/*
 * The column is written by the model and read by DiscoveredDeviceBuilder, and
 * the two are only correct together: the builder's "only exactly true is on"
 * rule is only safe BECAUSE the column defaults to false, and the scan model
 * is only a valid naming choice BECAUSE its property has the shape the
 * builder expects.
 */
describe("NetworkDeviceDiscoveryScan.useShortDeviceNames as DiscoveredDeviceBuilder reads it", () => {
  /*
   * The scan model satisfies DiscoveredHostNaming structurally, which is what
   * lets every caller holding a scan pass the scan. This line is a compile-
   * time assertion as much as a runtime one.
   */
  test("a scan model is a naming choice", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    const naming: DiscoveredHostNaming = scan;

    expect(naming).toBe(scan);
  });

  test("a freshly constructed scan imports full names", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    expect(scan.useShortDeviceNames).toBeUndefined();
    expect(buildDeviceName(SHORTENABLE_HOST, scan)).toBe(
      "wb-0660-kds01.wbhq.com",
    );
  });

  test("a scan with the toggle off imports full names", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.useShortDeviceNames = false;

    expect(buildDeviceName(SHORTENABLE_HOST, scan)).toBe(
      "wb-0660-kds01.wbhq.com",
    );
  });

  test("a scan with the toggle on imports short names", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.useShortDeviceNames = true;

    expect(buildDeviceName(SHORTENABLE_HOST, scan)).toBe("wb-0660-kds01");
  });

  /*
   * The column's declared default and the builder's reading of absence have
   * to be the same answer. If someone flips the default to true, this fails
   * and says so, rather than leaving a database that defaults one way and a
   * builder that assumes the other.
   */
  test("the column default and the builder's reading of absence agree", () => {
    const absent: string = buildDeviceName(SHORTENABLE_HOST, {});
    const atDefault: string = buildDeviceName(SHORTENABLE_HOST, {
      useShortDeviceNames: typeOrmColumn()?.options.default as boolean,
    });
    const atAdvertisedDefault: string = buildDeviceName(SHORTENABLE_HOST, {
      useShortDeviceNames: metadata().defaultValue as boolean,
    });

    expect(atDefault).toBe(absent);
    expect(atAdvertisedDefault).toBe(absent);
  });
});

describe("NetworkDeviceDiscoveryScan.useShortDeviceNames access control", () => {
  /*
   * The whole claim, in one assertion: this toggle is governed exactly as the
   * SNMP toggle beside it is.
   */
  test("is governed exactly as the SNMP toggle is", () => {
    expect(accessControlFor(COLUMN)).toEqual(
      accessControlFor(PEER_TOGGLE_COLUMN),
    );
  });

  // Broken out per operation so a failure says WHICH of the three drifted.
  test("grants the same create, read and update permissions as the SNMP toggle", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);
    const peer: ColumnAccessControl | null =
      accessControlFor(PEER_TOGGLE_COLUMN);

    expect(column?.create).toEqual(peer?.create);
    expect(column?.read).toEqual(peer?.read);
    expect(column?.update).toEqual(peer?.update);
  });

  /*
   * ...and the comparison above is not two empty objects agreeing with each
   * other. A column with no create permission is silently dropped from every
   * write, which would leave the wizard's toggle doing nothing.
   */
  test("actually grants somebody the right to set and read it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column).not.toBeNull();
    expect(column?.create?.length).toBeGreaterThan(0);
    expect(column?.read?.length).toBeGreaterThan(0);
  });

  /*
   * Everyone who may create a scan may choose how it names devices, and
   * everyone who may read a scan may see the choice — the Review dialog
   * needs it to preview names.
   */
  test("its setters are creators of the table and its readers are readers of it", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column?.create).toEqual(scan.getCreatePermissions());
    expect(column?.read).toEqual(scan.getReadPermissions());
  });
});

/*
 * The model and the migration describe the same column. Executed against a
 * fake QueryRunner rather than read as text, so the statement compared is the
 * one that reaches Postgres. The migration's own suite pins the rest.
 */
describe("NetworkDeviceDiscoveryScan.useShortDeviceNames and its migration agree", () => {
  test("mechanism 2 of 3: existing rows are backfilled false by NOT NULL DEFAULT false", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000().up(
      runner,
    );

    const addColumn: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.includes(`ADD "${COLUMN}"`);
      },
    );

    expect(addColumn).toEqual([
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "${COLUMN}" boolean NOT NULL DEFAULT false`,
    ]);

    expect(typeOrmColumn()?.options.type).toBe(ColumnType.Boolean);
    expect(typeOrmColumn()?.options.nullable).toBe(false);
    expect(typeOrmColumn()?.options.default).toBe(false);
  });
});
