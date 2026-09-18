/**
 * NetworkDevice.dnsName column contract (issue #3678).
 *
 * Until this column existed a discovered device's fully qualified DNS name
 * lived nowhere but `name`, so the moment an operator wanted the clean short
 * name — "wb-0660-kds01" rather than "wb-0660-kds01.wbhq.com" — the DNS name
 * had to be thrown away to get it. This is where it goes instead: discovery
 * import writes the PTR name here whatever the device is called, and the bulk
 * "shorten names" action moves a full name here before cutting the name down.
 * Everything below pins a property that, quietly changed, either refuses a
 * write one of those two paths is about to make or loses the one copy of the
 * name the issue asked to keep.
 *
 * Three properties matter more than the rest:
 *
 *   - NOT REQUIRED. Most devices — every hand-made one, every one imported
 *     from a host with no PTR record — have no DNS name, and every existing
 *     create path omits it. A required column would break all of them.
 *   - NULLABLE WITH NO DEFAULT. NULL means "no DNS name recorded", which is
 *     the truth for every device already on disk. The bulk action only fills
 *     an EMPTY value, so a default would also stop it ever keeping a name.
 *   - WIDE ENOUGH FOR A WHOLE DNS NAME, and governed like the identity columns
 *     beside it: anyone who may set a device's address may record its DNS
 *     name at create, and anyone who may rename a device may move its old
 *     name here.
 */

import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { MAX_DEVICE_DNS_NAME_LENGTH } from "../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeReverseDnsName } from "../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import { getShortHostname } from "../../Utils/NetworkDiscovery/ShortHostnameUtil";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import ColumnLength from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import Permission from "../../Types/Permission";
import { AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1792900000000-AddNetworkDeviceDnsNameAndShortDeviceNames";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const COLUMN: string = "dnsName";

/*
 * The columns this one is measured against. `hostname` is the address the
 * device is dialled on and this is the name DNS gives that address, so
 * whoever may state one at create may state the other. `name` is what the
 * bulk action rewrites in the same update that fills this column, so whoever
 * may change a device's name must be able to change this too, or the action
 * would rename a device and silently drop the name it meant to keep.
 */
const PEER_ADDRESS_COLUMN: string = "hostname";
const PEER_NAME_COLUMN: string = "name";

function metadata(): TableColumnMetadata {
  return new NetworkDevice().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === NetworkDevice && column.propertyName === COLUMN;
  });
}

function accessControlFor(column: string): ColumnAccessControl | null {
  return new NetworkDevice().getColumnAccessControlFor(column);
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

describe("NetworkDevice.dnsName", () => {
  test("exists as a long text column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.LongText);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.LongText);
  });

  /*
   * "DNS Name", not "DNS name (at import)": the bulk action writes it too, so
   * a label naming only one source would be wrong for the other.
   */
  test("is titled DNS Name", () => {
    expect(metadata().title).toBe("DNS Name");
  });

  /*
   * The description is the only place an integrator — or an operator reading
   * the Overview row's tooltip — learns where the value came from. It has to
   * name both sources, since the second one is an inference from a name
   * rather than a PTR record.
   */
  test("its description names both places the value can come from, and what it is for", () => {
    const description: string = metadata().description ?? "";

    expect(description).toContain("reverse-DNS");
    expect(description).toContain("PTR");
    expect(description).toContain("discovered");
    expect(description).toContain("shortened");
    expect(description).toContain("site-assignment");
  });

  /*
   * The example is what the generated docs show. It must be a value this
   * column can actually hold — a normalised DNS name — and the kind of name
   * the short-name feature exists for.
   */
  test("its example is a normalised, fully qualified DNS name", () => {
    const example: string = String(metadata().example);

    expect(normalizeReverseDnsName(example)).toBe(example);
    expect(getShortHostname(example)).toBeDefined();
  });

  test("is not required, so a create that omits it is still accepted", () => {
    expect(metadata().required).toBeFalsy();

    const requiredColumns: Columns = new NetworkDevice().getRequiredColumns();

    expect(requiredColumns.columns).not.toContain(COLUMN);
    // ...and the check is not vacuous: the address genuinely is required.
    expect(requiredColumns.columns).toContain(PEER_ADDRESS_COLUMN);
  });

  /*
   * NULL is a meaning here: "no DNS name recorded". A default would give the
   * fleet a DNS name it does not have, and the bulk action — which only fills
   * an EMPTY value — would then never keep anything.
   */
  test("is nullable with no default", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(true);
    expect(typeOrmColumn()?.options.default).toBeUndefined();
    expect(metadata().defaultValue).toBeUndefined();
    expect(new NetworkDevice().isDefaultValueColumn(COLUMN)).toBe(false);
  });

  /*
   * character varying(500): the shared LongText length. A DNS name is at
   * most 253 characters, which is the ceiling the builder stores to — so the
   * column must hold that whole, or the longest legal name fails the create.
   * The short `name` column's 100 would not.
   */
  test("is a LongText-length varchar wide enough for the longest DNS name", () => {
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.LongText);
    expect(ColumnLength.LongText).toBe(500);
    expect(MAX_DEVICE_DNS_NAME_LENGTH).toBe(253);
    expect(MAX_DEVICE_DNS_NAME_LENGTH).toBeLessThanOrEqual(
      ColumnLength.LongText,
    );
  });

  /*
   * The device list reads devices through relation selects, and site-rule
   * matching reads this column off the device to try a hostname pattern
   * against it. A column unreadable through a relation would be dropped from
   * those selects without an error.
   */
  test("is readable from a relation query, like the name and address beside it", () => {
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new NetworkDevice().getTableColumnMetadata(PEER_ADDRESS_COLUMN)
        .canReadOnRelationQuery,
    ).toBe(true);
  });

  test("a new device has no DNS name until something writes one", () => {
    expect(new NetworkDevice().dnsName).toBeUndefined();
  });
});

describe("NetworkDevice.dnsName access control", () => {
  /*
   * Discovery import creates the device with this column set, so everyone
   * who may create a device — a project member through the Review dialog, an
   * API key with CreateNetworkDevice — may set it.
   */
  test("is creatable exactly by those who may set the device's address", () => {
    expect(accessControlFor(COLUMN)?.create).toEqual(
      accessControlFor(PEER_ADDRESS_COLUMN)?.create,
    );
  });

  /*
   * The bulk action writes `{ name, dnsName }` in one update. Anyone allowed
   * to rename a device must be allowed to write this in the same request.
   */
  test("is updatable exactly by those who may rename the device", () => {
    expect(accessControlFor(COLUMN)?.update).toEqual(
      accessControlFor(PEER_NAME_COLUMN)?.update,
    );
  });

  test("is updatable exactly by those who may change the device's address", () => {
    expect(accessControlFor(COLUMN)?.update).toEqual(
      accessControlFor(PEER_ADDRESS_COLUMN)?.update,
    );
  });

  test("is readable exactly by those who may read the device's address", () => {
    expect(accessControlFor(COLUMN)?.read).toEqual(
      accessControlFor(PEER_ADDRESS_COLUMN)?.read,
    );
  });

  /*
   * The named grants the feature leans on: the Overview row is read by a
   * Viewer, the fine-grained device permissions are what an API key carries.
   */
  test("lets a viewer read it and the device permissions set it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column?.read).toContain(Permission.Viewer);
    expect(column?.read).toContain(Permission.ReadNetworkDevice);
    expect(column?.create).toContain(Permission.ProjectMember);
    expect(column?.create).toContain(Permission.CreateNetworkDevice);
    expect(column?.update).toContain(Permission.ProjectMember);
    expect(column?.update).toContain(Permission.EditNetworkDevice);
  });

  /*
   * ...and the comparisons above are not empty lists agreeing with each
   * other. A column with no create permission is silently dropped from every
   * write, which would leave import storing nothing.
   */
  test("actually grants somebody the right to set, read and change it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column).not.toBeNull();
    expect(column?.create?.length).toBeGreaterThan(0);
    expect(column?.read?.length).toBeGreaterThan(0);
    expect(column?.update?.length).toBeGreaterThan(0);
  });

  test("its setters, readers and editors are those of the table", () => {
    const device: NetworkDevice = new NetworkDevice();
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column?.create).toEqual(device.getCreatePermissions());
    expect(column?.read).toEqual(device.getReadPermissions());
    expect(column?.update).toEqual(device.getUpdatePermissions());
  });
});

/*
 * The create contract, re-derived the way NetworkDeviceCreateContract.test.ts
 * derives it. Adding this column must not change what a caller has to supply.
 */
describe("NetworkDevice.dnsName leaves the create contract alone", () => {
  const device: NetworkDevice = new NetworkDevice();

  function callerSuppliedRequiredColumns(): Array<string> {
    return device.getRequiredColumns().columns.filter((column: string) => {
      return !device.isDefaultValueColumn(column);
    });
  }

  test("the caller is still asked for exactly the four identity columns", () => {
    expect(callerSuppliedRequiredColumns().sort()).toEqual([
      "hostname",
      "name",
      "projectId",
      "slug",
    ]);
  });

  test("and never for the DNS name", () => {
    expect(callerSuppliedRequiredColumns()).not.toContain(COLUMN);
  });
});

/*
 * The model and the migration describe the same column. Executed against a
 * fake QueryRunner, so the statement compared is the one that reaches
 * Postgres; the migration's own suite pins the rest.
 */
describe("NetworkDevice.dnsName and its migration agree", () => {
  test("the migration adds a nullable varchar of the model's length, with no default", async () => {
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
      `ALTER TABLE "NetworkDevice" ADD "${COLUMN}" character varying(${ColumnLength.LongText})`,
    ]);
    expect(addColumn[0]).not.toContain("NOT NULL");
    expect(addColumn[0]).not.toContain("DEFAULT");
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.LongText);
    expect(typeOrmColumn()?.options.nullable).toBe(true);
  });
});
