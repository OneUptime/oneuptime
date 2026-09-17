/**
 * NetworkDevice.macAddress column contract (issue #3489).
 *
 * A ping-only device — a POS register, a handset, a kiosk — speaks neither
 * LLDP nor CDP, so nothing it says places it on a switch port. The switches
 * already know: every walked switch reports its forwarding table, and the
 * server keeps one NetworkEndpoint row per MAC it learned. This column is
 * what lets a device be recognised in that inventory, and everything below
 * pins a property that, quietly changed, either refuses a write the device
 * form is about to make or leaves the column unreadable by the one page that
 * needs it.
 *
 * Three properties matter more than the rest:
 *
 *   - NOT REQUIRED. The MAC is optional twice over — a device whose hostname
 *     is an IP address that a router's ARP table resolves is matched by
 *     address without it — and every existing create path (the form, the
 *     CRUD API, discovery import, seeding) omits it. A required column would
 *     break all of them at once.
 *   - NULLABLE WITH NO DEFAULT. NULL means "not declared, and not learned
 *     yet", which is what every row already on disk should say; a default
 *     would give the fleet a MAC it does not have, and the ARP learner only
 *     ever fills an EMPTY value, so a default would also stop it filling
 *     anything.
 *   - READABLE ON A RELATION QUERY, and governed exactly as `hostname` is.
 *     The topology API selects it off the device list, and an operator who
 *     may set a device's address may set its MAC — the two are the layer-3
 *     and layer-2 spellings of the same fact.
 */

import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import ColumnLength from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import Permission from "../../Types/Permission";
import { normalizeMac } from "../../Utils/Monitor/EndpointAttachmentUtil";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const COLUMN: string = "macAddress";

/*
 * The column this one is measured against. `hostname` is the device's
 * layer-3 address and this is its layer-2 one; whoever may state one may
 * state the other. Compared against rather than written out as a permission
 * list, so the two are revised together or not at all.
 */
const PEER_ADDRESS_COLUMN: string = "hostname";

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

describe("NetworkDevice.macAddress", () => {
  test("exists as a short text column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.ShortText);
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.ShortText);
  });

  /*
   * The title is the label on the device form and the heading in the
   * generated API docs; the form field module reads it from here.
   */
  test("is titled MAC Address", () => {
    expect(metadata().title).toBe("MAC Address");
  });

  /*
   * The API documentation is the only explanation an integrator gets. It
   * has to say what the column is FOR — the switch port, found from the
   * forwarding tables — and that it is optional because ARP can stand in.
   */
  test("its description says what the column is for and that it is optional", () => {
    const description: string = metadata().description ?? "";

    expect(description).toContain("switch port");
    expect(description).toContain("forwarding tables");
    expect(description).toContain("LLDP");
    expect(description).toContain("CDP");
    expect(description).toContain("ping");
    expect(description).toContain("ARP");
    expect(description).toContain("Optional");
  });

  /*
   * The example is what the generated docs show and what a form placeholder
   * is modelled on. It has to be in the STORED form — lowercase colon — so
   * that what an integrator copies from the docs is what they read back.
   */
  test("its example is already in the stored form", () => {
    const example: string = String(metadata().example);

    expect(normalizeMac(example)).toBe(example);
    expect(example).toBe(example.toLowerCase());
    expect(example.split(":")).toHaveLength(6);
  });

  /*
   * THE assertion of the column. A required column makes the API reject a
   * create that omits it — and every create path in the product omits it.
   */
  test("is not required, so a create that omits it is still accepted", () => {
    expect(metadata().required).toBeFalsy();

    const requiredColumns: Columns = new NetworkDevice().getRequiredColumns();

    expect(requiredColumns.columns).not.toContain(COLUMN);
    // ...and the check is not vacuous: the peer address genuinely is required.
    expect(requiredColumns.columns).toContain(PEER_ADDRESS_COLUMN);
  });

  /*
   * NULL is a meaning here: "not declared, not learned yet". A default
   * would restate every existing device as having a MAC it does not have,
   * and the ARP learner — which only ever fills an EMPTY value — would then
   * never fill anything.
   */
  test("is nullable with no default", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(true);
    expect(typeOrmColumn()?.options.default).toBeUndefined();
    expect(metadata().defaultValue).toBeUndefined();
    expect(new NetworkDevice().isDefaultValueColumn(COLUMN)).toBe(false);
  });

  /*
   * character varying(100): the shared ShortText length, so the migration's
   * SQL and the entity agree without either restating the number.
   */
  test("is a ShortText-length varchar", () => {
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
    expect(ColumnLength.ShortText).toBe(100);
  });

  /*
   * The topology API reads devices with a nested select, and the builder
   * needs the MAC on every one of them to match endpoints against. A column
   * that cannot be read through a relation would be silently dropped from
   * that select, and adoption would never fire.
   */
  test("is readable from a relation query, like the address beside it", () => {
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(
      new NetworkDevice().getTableColumnMetadata(PEER_ADDRESS_COLUMN)
        .canReadOnRelationQuery,
    ).toBe(true);
  });
});

describe("NetworkDevice.macAddress access control", () => {
  /*
   * The named grants the feature leans on. A project member fills the form
   * in; the fine-grained device permissions are what an API key carries;
   * and the topology page is readable by a Viewer, so the column it draws
   * from has to be too.
   */
  test("lets a project member and the device permissions set it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column?.create).toContain(Permission.ProjectMember);
    expect(column?.create).toContain(Permission.CreateNetworkDevice);
    expect(column?.update).toContain(Permission.ProjectMember);
    expect(column?.update).toContain(Permission.EditNetworkDevice);
  });

  test("lets a viewer read it, since the topology map is viewer-readable", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column?.read).toContain(Permission.Viewer);
    expect(column?.read).toContain(Permission.ReadNetworkDevice);
  });

  /*
   * The whole claim, in one assertion: this column is governed exactly as
   * the device's hostname is. Written as a comparison rather than a
   * permission list on purpose — the two are the layer-3 and layer-2
   * address of the same device and must be revised together, so a change
   * that widens both keeps this green while one drifting from the other
   * fails here, which is the case worth catching.
   */
  test("is governed exactly as the hostname is", () => {
    expect(accessControlFor(COLUMN)).toEqual(
      accessControlFor(PEER_ADDRESS_COLUMN),
    );
  });

  // Broken out per operation so a failure says WHICH of the three drifted.
  test("grants the same create, read and update permissions as the hostname", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);
    const peer: ColumnAccessControl | null =
      accessControlFor(PEER_ADDRESS_COLUMN);

    expect(column?.create).toEqual(peer?.create);
    expect(column?.read).toEqual(peer?.read);
    expect(column?.update).toEqual(peer?.update);
  });

  /*
   * ...and the comparison above is not two empty objects agreeing with each
   * other. A column with no create permission at all is silently dropped
   * from every write, which would leave the form field doing nothing.
   */
  test("actually grants somebody the right to set, read and change it", () => {
    const column: ColumnAccessControl | null = accessControlFor(COLUMN);

    expect(column).not.toBeNull();
    expect(column?.create?.length).toBeGreaterThan(0);
    expect(column?.read?.length).toBeGreaterThan(0);
    expect(column?.update?.length).toBeGreaterThan(0);
  });

  /*
   * Everyone who may create a device may declare its MAC, everyone who may
   * read a device may see it, and everyone who may edit a device may change
   * it. Anything narrower would produce a device whose MAC its creator
   * could not state, or a map that cannot place a device its viewer can see.
   */
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
 * derives it. Adding a column must not change what a caller has to supply,
 * and this column in particular is optional by design — so the set of
 * caller-supplied required columns is exactly what it was before it existed.
 */
describe("NetworkDevice.macAddress leaves the create contract alone", () => {
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

  test("and never for the MAC", () => {
    expect(callerSuppliedRequiredColumns()).not.toContain(COLUMN);
  });
});

describe("the isMacAddressLearned column", () => {
  const FLAG: string = "isMacAddressLearned";

  test("is an optional boolean that defaults to false", () => {
    const metadata: TableColumnMetadata =
      new NetworkDevice().getTableColumnMetadata(FLAG);

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBeFalsy();
    expect(metadata.defaultValue).toBe(false);
    expect(metadata.title).toBe("MAC Address Learned");
  });

  test("is writable by exactly the roles that may write the MAC beside it", () => {
    const device: NetworkDevice = new NetworkDevice();
    const flagAccess: ColumnAccessControl =
      device.getColumnAccessControlFor(FLAG)!;
    const macAccess: ColumnAccessControl =
      device.getColumnAccessControlFor("macAddress")!;

    expect(flagAccess).toEqual(macAccess);
  });
});
