/**
 * NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled column contract (issue #3677).
 *
 * A discovered host with no SNMP sysName and no reverse-DNS record has nothing
 * to be called but its address, and on a Windows-heavy estate that is most of
 * the Review dialog. This column is the scan's opt-in to asking those hosts for
 * their NetBIOS name, and everything below pins a property that, quietly
 * changed, either starts sending traffic nobody agreed to or leaves the
 * wizard's toggle doing nothing.
 *
 * Three properties matter more than the rest:
 *
 *   - DEFAULT FALSE, in all three places that word means something — and here
 *     "false" is not a naming preference, it is "do not send UDP 137 to every
 *     unnamed host in the range". NBSTAT sweeps are what IDS rules on PCI and
 *     other regulated networks alert on, so a deploy must never turn it on for
 *     a scan that already exists. The three mechanisms are separate and easy
 *     to confuse:
 *       - NEW rows get false from the Postgres column default (@Column default)
 *       - EXISTING rows got false from the migration's NOT NULL DEFAULT false
 *       - @TableColumn defaultValue is documentation for the generated API
 *         schema and the form metadata; it defaults nothing at runtime
 *     All three are pinned, because asserting only one is a guard that catches
 *     nothing: flipping @Column to default: true leaves the other two green
 *     while every scan created by an older API client silently starts sending
 *     NetBIOS queries.
 *   - NOT REQUIRED, and a default-value column. Every existing integration
 *     creates scans without it.
 *   - ACCESS CONTROL IDENTICAL TO `isSnmpEnabled`. It is the same kind of
 *     "what the scan asks of each host" choice, made by the same people; the
 *     two drifting apart would give the wizard a toggle some of its users can
 *     see but not save.
 */

import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { buildDeviceName } from "../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import Columns from "../../Types/Database/Columns";
import { AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1793000000000-AddNetbiosLookupToNetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const COLUMN: string = "isNetbiosLookupEnabled";

/*
 * The column this one is measured against: the other "what the scan asks of
 * each host" toggle. Compared against rather than written out as a permission
 * list, so the two are revised together or not at all.
 */
const PEER_TOGGLE_COLUMN: string = "isSnmpEnabled";

/*
 * A stored result row as the probe writes it for a host that answered NBSTAT
 * and nothing else: no sysName, no PTR record.
 */
const NETBIOS_NAMED_HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.18.167.31",
  netbiosName: "reg01",
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

describe("NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.Boolean);
  });

  test("is titled the way the wizard labels the toggle", () => {
    expect(metadata().title).toBe("Look Up NetBIOS Names");
  });

  /*
   * The API documentation is the only explanation an integrator gets, and
   * this setting sends traffic. It has to say what is sent and where, that it
   * is best-effort, and the two limits the probe enforces whatever the flag
   * says — so nobody enables it expecting public hosts or a global probe to be
   * named.
   */
  test("its description says what is sent, that it is best-effort, and where it is never done", () => {
    const description: string = metadata().description ?? "";

    expect(description).toContain("UDP 137");
    expect(description).toContain(
      "Best-effort: Windows/Samba hosts that allow UDP 137 from the probe.",
    );
    expect(description).toContain("Private addresses only");
    expect(description).toContain("never done by global probes");
  });

  /*
   * And it says WHICH hosts are asked: only the ones still unnamed. An operator
   * reading "NetBIOS lookup" could otherwise expect it to override a sysName
   * or a PTR name, which it never does.
   */
  test("its description says only hosts with no SNMP name and no reverse DNS record are asked", () => {
    const description: string = metadata().description ?? "";

    expect(description).toContain("no SNMP name");
    expect(description).toContain("no reverse DNS record");
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
   * client — one that has never heard of NetBIOS — must sweep exactly as it
   * did yesterday, sending nothing to UDP 137.
   */
  test("a scan created without saying sends no NetBIOS queries, by the column default", () => {
    expect(typeOrmColumn()?.options.default).toBe(false);
  });

  /*
   * NOT NULL keeps the flag two-state in the database. The probe reads
   * "exactly true" as on, so a NULL would behave as off anyway — but a third
   * stored state is a question every other reader would have to answer.
   */
  test("is not nullable, so a stored scan always states whether it sends NetBIOS queries", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(false);
  });

  test("is readable from a relation query, like the toggle it is measured against", () => {
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new NetworkDeviceDiscoveryScan().getTableColumnMetadata(
        PEER_TOGGLE_COLUMN,
      ).canReadOnRelationQuery,
    ).toBe(true);
  });

  /*
   * It is not an SNMP setting: NetBIOS names hosts that SNMP did NOT answer,
   * and it runs with Check SNMP off as well as on. Carrying the note the SNMP
   * config block's fields carry would tell the operator the opposite.
   */
  test("is not documented as part of the SNMP configuration", () => {
    expect(metadata().description ?? "").not.toContain(
      "Ignored when Check SNMP is off.",
    );
  });

  /*
   * The flag is what the model says the probe reads, and a freshly constructed
   * model has no opinion — so the probe's `=== true` reads it as off.
   */
  test("a freshly constructed scan does not have the lookup on", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    expect(scan.isNetbiosLookupEnabled).toBeUndefined();
    expect(scan.isNetbiosLookupEnabled === true).toBe(false);
  });
});

/*
 * The flag decides whether the probe ASKS. It is not a naming option: a name
 * the probe already stored on a result row is a fact about that host, and the
 * builder names by it whatever the scan's flag says now. That keeps the Review
 * dialog, the manual import and auto-import agreeing on a run's names even if
 * someone toggles the setting between the run and the import — the same
 * reasoning that keeps this out of the sweep columns.
 */
describe("NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled as DiscoveredDeviceBuilder reads it", () => {
  test("a stored NetBIOS name names the device with the flag on", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.isNetbiosLookupEnabled = true;

    expect(buildDeviceName(NETBIOS_NAMED_HOST, scan)).toBe("reg01");
  });

  test("a stored NetBIOS name still names the device after the flag is turned off", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.isNetbiosLookupEnabled = false;

    expect(buildDeviceName(NETBIOS_NAMED_HOST, scan)).toBe("reg01");
  });
});

describe("NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled access control", () => {
  /*
   * The whole claim, in one assertion: this toggle is governed exactly as the
   * SNMP toggle is.
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
   * other. A column with no create or update permission is silently dropped
   * from every write, which would leave the wizard's toggle doing nothing.
   */
  test("actually grants somebody the right to set, change and read it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column).not.toBeNull();
    expect(column?.create?.length).toBeGreaterThan(0);
    expect(column?.update?.length).toBeGreaterThan(0);
    expect(column?.read?.length).toBeGreaterThan(0);
  });

  /*
   * Everyone who may create a scan may choose whether it sends NetBIOS
   * queries, and everyone who may read a scan may see that it does — an
   * operator investigating an IDS alert has to be able to find the scan that
   * caused it.
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
describe("NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled and its migration agree", () => {
  test("mechanism 2 of 3: existing rows are backfilled false by NOT NULL DEFAULT false", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000().up(
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
