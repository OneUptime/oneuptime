/**
 * NetworkDeviceDiscoveryScan.name column contract (issue #3391).
 *
 * A discovery scan used to be identified in the product by its target alone,
 * so a list of them read as a column of octet ranges. This column is the
 * operator's own sentence about what the scan is FOR, and everything below
 * pins a property that, quietly changed, either loses that sentence or turns
 * an optional label into something that can refuse a write.
 *
 * Three properties matter more than the rest:
 *
 *   - OPTIONAL and un-backfilled. Every scan that already existed has no name,
 *     and a NOT NULL column (or a backfilled one) would either fail the
 *     migration or invent a name nobody wrote.
 *   - UPDATABLE. Almost nothing on this model is: the target and the
 *     credentials describe a sweep already handed to a probe. A name describes
 *     nothing but itself, and a mislabelled scan is worse than an unlabelled
 *     one, so it joins the recurrence pair as the third editable column.
 *   - NOT unique and NOT slugged. It is a label for humans, never a key: two
 *     scans of the same range may legitimately be called the same thing.
 */

import NetworkDeviceDiscoveryScan from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnLength from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "name";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_CLASS: string =
  "AddNameToNetworkDeviceDiscoveryScan1789400000000";

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIR,
  "1789400000000-AddNameToNetworkDeviceDiscoveryScan.ts",
);

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

describe("NetworkDeviceDiscoveryScan.name", () => {
  test("exists as a ShortText column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.ShortText);
    expect(metadata().title).toBe("Name");
  });

  /*
   * The whole point of the field. A required name would put a wall in front of
   * the operator sweeping one subnet once, which is the case the Discovery
   * page was built for in the first place.
   */
  test("is optional, so a scan can still be created without one", () => {
    expect(metadata().required).toBeFalsy();
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.nullable).toBe(true);
  });

  test("is stored at the width the shared validator caps names at", () => {
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
  });

  /*
   * A default would name every unnamed scan the same thing, which is exactly
   * the state the issue describes as unreadable.
   */
  test("has no default value", () => {
    expect(typeOrmColumn()?.options.default).toBeUndefined();
    expect(new NetworkDeviceDiscoveryScan().isDefaultValueColumn(COLUMN)).toBe(
      false,
    );
  });

  test("is not unique, because a name is a label and not a key", () => {
    expect(typeOrmColumn()?.options.unique).toBeFalsy();

    const uniqueColumns: Columns =
      new NetworkDeviceDiscoveryScan().getUniqueColumns();

    expect(uniqueColumns.columns).not.toContain(COLUMN);
  });

  /*
   * Slugs are opt-in through @SlugifyColumn. A scan is never addressed by
   * name, and slugging one would add a second column to keep in step with a
   * value the operator is expected to rewrite.
   */
  test("is not slugified", () => {
    expect(new NetworkDeviceDiscoveryScan().getSlugifyColumn()).toBeFalsy();
  });
});

describe("NetworkDeviceDiscoveryScan.name migration", () => {
  test("adds a nullable varchar without backfilling existing scans", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain('ALTER TABLE "NetworkDeviceDiscoveryScan"');
    expect(migration).toContain(`ADD "${COLUMN}" character varying(100)`);
    /*
     * No NOT NULL, no DEFAULT and no UPDATE: scans created before this column
     * existed stay unnamed, and every surface falls back to their target.
     */
    expect(migration).not.toContain("NOT NULL");
    expect(migration).not.toContain("DEFAULT");
    expect(migration).not.toContain("UPDATE");
  });

  test("its down() removes the column", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "${COLUMN}"`,
    );
  });

  /*
   * TypeORM records a migration under its `public name` property, not its
   * class name, and nothing else in the suite compares the two. A rename that
   * updates the class and forgets the literal leaves the deployed identity on
   * the old value.
   */
  test("its class name, file name and recorded name all agree", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(`export class ${MIGRATION_CLASS}`);
    expect(migration).toContain(`public name: string = "${MIGRATION_CLASS}"`);
  });

  test("is registered, so the column actually exists at runtime", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    // Imported AND listed in the exported array - the import alone does nothing.
    expect(index.match(new RegExp(MIGRATION_CLASS, "g"))?.length).toBe(2);
  });
});

describe("NetworkDeviceDiscoveryScan.name access control", () => {
  const CREATORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateNetworkDeviceDiscoveryScan,
  ];

  const READERS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadNetworkDeviceDiscoveryScan,
  ];

  const EDITORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditNetworkDeviceDiscoveryScan,
  ];

  test("is set by whoever may create a scan", () => {
    expect(
      new NetworkDeviceDiscoveryScan().getColumnAccessControlFor(COLUMN)
        ?.create,
    ).toEqual(CREATORS);
  });

  test("is read by everyone who may read a scan, viewers included", () => {
    expect(
      new NetworkDeviceDiscoveryScan().getColumnAccessControlFor(COLUMN)?.read,
    ).toEqual(READERS);
  });

  /*
   * The Edit dialog on the Discovery page depends on this list being
   * non-empty — ModelForm drops a field whose column grants no update
   * permission, so an empty list here would turn the dialog into a permission
   * error rather than a text box.
   */
  test("can be edited by whoever may edit the scan", () => {
    expect(
      new NetworkDeviceDiscoveryScan().getColumnAccessControlFor(COLUMN)
        ?.update,
    ).toEqual(EDITORS);
  });

  /*
   * THE LINE THIS MODEL IS DIVIDED ALONG, and the reason both halves are
   * pinned here rather than left to whoever edits the model next.
   *
   * Everything that DESCRIBES the scan is editable. That is a reversal: every
   * one of these columns was create-only until OneUptime issue #3444, on the
   * reasoning that a row must never stop describing the sweep that ran. The
   * reasoning was right and the conclusion was wrong — it made a typo'd subnet
   * or a rejected community string unfixable except by deleting the scan and
   * losing its results. The invariant now lives in
   * NetworkDeviceDiscoveryScanService instead: changing any of them re-queues
   * the scan and clears the previous run.
   *
   * Everything the scan REPORTED stays read-only, and that half is
   * load-bearing. The service writes those columns as root through the
   * hook-free path, which has no column access control at all, so this list is
   * the only thing standing between the public CRUD API and a hand-edited
   * result: a scan that claims to have found hosts it never saw.
   */
  test("makes every setting of the sweep editable", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    const settingColumns: Array<string> = [
      "cidr",
      // Both spellings: the dashboard posts `probe`, API clients post `probeId`.
      "probe",
      "probeId",
      /*
       * The scan's METHOD belongs with the settings it governs (issue #3445):
       * it decides whether the probe sends SNMP at all, so an operator who can
       * edit the credentials must be able to edit whether they are used — and
       * the service clears those credentials to null when the method goes off,
       * so the two can never disagree on a stored row.
       */
      "isSnmpEnabled",
      /*
       * The ordered credential list (issue #3458) is a SETTING of the sweep,
       * not something the scan reported, so it belongs on this side of the
       * line — and it has to be here specifically because the Edit dialog
       * renders it: ModelForm drops a field whose column grants no update
       * permission, so a create-only `snmpConfigs` would leave the operator
       * an editor that silently cannot save the one thing it edits.
       *
       * It is also the column the method above CLEARS. A method that is
       * editable while the credentials it governs are not would give the
       * service an update it cannot honour: turning SNMP off has to null this
       * list, and a create-only column cannot be nulled by an update.
       */
      "snmpConfigs",
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
      // The pair that describes the NEXT run rather than the one that happened.
      "isRecurring",
      "rescanIntervalInMinutes",
    ];

    for (const column of settingColumns) {
      expect({
        column: column,
        update: scan.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column: column, update: EDITORS });
    }
  });

  test("keeps everything the scan reported read-only", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    const resultColumns: Array<string> = [
      "status",
      "statusMessage",
      "discoveredDevices",
      "scannedHostCount",
      "respondedHostCount",
      "startedAt",
      "completedAt",
      // Derived by the server from the schedule; never set by hand.
      "nextScanAt",
      "autoImportProcessedAt",
    ];

    for (const column of resultColumns) {
      expect({
        column: column,
        update: scan.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column: column, update: [] });
    }

    /*
     * And the column that looks like it belongs on this side but must not be
     * moved here. `snmpConfigs` holds community strings and v3 passphrases,
     * so the instinct on reading it is to lock it down beside the results —
     * but it is the operator's own input, not something the scan reported,
     * and an empty update list is precisely what makes a column unsavable
     * from the Edit dialog. Its secrets are guarded by a narrow READ list
     * instead, which the test below pins.
     *
     * Asserted in both directions so the two halves of this divide cannot be
     * quietly edited into agreeing with each other: the name is absent from
     * the list AND the model really does grant updates on it.
     */
    expect(resultColumns).not.toContain("snmpConfigs");
    expect(scan.getColumnAccessControlFor("snmpConfigs")?.update).not.toEqual(
      [],
    );
  });

  /*
   * Widening `update` must not have widened `read`. The credential columns are
   * read by a narrower list than the rest of the model on purpose — a
   * passphrase is not something every reader of the scans list should be
   * handed — and every editor is already inside it, so the Edit dialog can
   * still prefill them.
   *
   * `snmpConfigs` is the fourth, and the one most easily got wrong. It is a
   * jsonb column, so it has ONE permission for the whole value, and the value
   * contains the community strings and v3 passphrases of every credential set
   * the scan tries. A jsonb column therefore has to take the STRICTEST of the
   * permissions of what it contains: granting it the model's usual read list
   * would hand a Viewer, in one array, every secret the three flattened
   * columns beside it are narrowed to keep from them.
   */
  test("does not widen read access to the credentials", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    const credentialColumns: Array<string> = [
      "snmpConfigs",
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ];

    for (const column of credentialColumns) {
      const readers: Array<Permission> =
        scan.getColumnAccessControlFor(column)?.read || [];

      expect(readers).not.toContain(Permission.Viewer);
      expect(readers).not.toContain(Permission.SettingsViewer);

      for (const editor of EDITORS) {
        if (editor === Permission.EditNetworkDeviceDiscoveryScan) {
          continue;
        }

        expect(readers).toContain(editor);
      }
    }
  });

  /*
   * The other half of that divide, and the place the two changes that landed
   * together are easiest to confuse for one another.
   *
   * `isSnmpEnabled` (issue #3445) and `snmpConfigs` (issue #3458) arrived on
   * this model at the same time and sit beside each other on the sweep, so the
   * temptation on reading them is to give them one permission set. They must
   * not have one: the METHOD is a boolean saying which question the sweep
   * asked, and every reader of the scans list needs it to tell an ICMP-only
   * scan from an SNMP one — the results dialog says "Ping only" and explains
   * why a host has no sysName, and a Viewer who cannot read the flag is shown a
   * scan that looks broken rather than one that was deliberately narrow. The
   * CREDENTIALS are passphrases, and no widening of the flag beside them may
   * drag them along.
   *
   * Asserted as exact equality with the model's usual read list rather than
   * "contains Viewer", so narrowing the flag to the credential list — the
   * mistake this test exists to catch — fails here instead of silently
   * emptying a column of the scans table for viewers.
   */
  test("lets every reader see the scan's method, without seeing its credentials", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    expect(scan.getColumnAccessControlFor("isSnmpEnabled")?.read).toEqual(
      READERS,
    );

    // And the list it governs is emphatically NOT read by that same set.
    expect(scan.getColumnAccessControlFor("snmpConfigs")?.read).not.toEqual(
      READERS,
    );
  });

  /*
   * Everything the operator can edit has to be something the table itself
   * accepts an update for, or the row-level check refuses the write before the
   * column-level one is ever consulted.
   */
  test("its editors are editors of the table too", () => {
    const tableUpdatePermissions: Array<Permission> =
      new NetworkDeviceDiscoveryScan().getUpdatePermissions();

    for (const permission of EDITORS) {
      expect(tableUpdatePermissions).toContain(permission);
    }
  });

  test("is readable from a relation query, like the target beside it", () => {
    expect(metadata().canReadOnRelationQuery).toBe(true);
  });
});
