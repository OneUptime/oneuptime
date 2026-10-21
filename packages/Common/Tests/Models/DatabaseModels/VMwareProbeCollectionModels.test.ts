import { describe, expect, test } from "@jest/globals";
import VMwareVCenter, {
  VMWARE_VCENTER_BOOKKEEPING_COLUMNS,
} from "../../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterConnectionTest from "../../../Models/DatabaseModels/VMwareVCenterConnectionTest";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import Permission from "../../../Types/Permission";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import { DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES } from "../../../Utils/VMware/VMwareCollectionSettings";

/*
 * Who may read and write a vCenter's probe collection settings, as the model
 * declares it. The password is write-only; what the probe and the server
 * find out is theirs alone to write; and the audit log records what people
 * change, never the password or the probe's bookkeeping.
 */

const vcenter: VMwareVCenter = new VMwareVCenter();
const access: Dictionary<ColumnAccessControl> =
  getColumnAccessControlForAllColumns(vcenter);
const columns: Dictionary<TableColumnMetadata> = getTableColumns(vcenter);

const SETTINGS: Array<string> = [
  "collectionMethod",
  "vcenterUrl",
  "vcenterUsername",
  "collectionProbe",
  "collectionProbeId",
  "trustedCertificateFingerprint",
  "collectionIntervalInMinutes",
];

const SERVER_ONLY: Array<string> = [
  "isVCenterPasswordSet",
  "vcenterCredentialsUpdatedAt",
  "collectionStatus",
  "collectionErrorCode",
  "collectionError",
  "presentedCertificate",
  "collectionSummary",
  "nextCollectionAt",
  "lastCollectionAt",
  "lastSuccessfulCollectionAt",
  "collectionSettingsVersion",
];

describe("VMwareVCenter's probe collection columns", () => {
  test("the password is write-only and encrypted at rest", () => {
    expect(access["vcenterPassword"]!.read).toEqual([]);
    expect(access["vcenterPassword"]!.create).toEqual(
      access["vcenterUrl"]!.create,
    );
    expect(access["vcenterPassword"]!.update).toEqual(
      access["vcenterUrl"]!.update,
    );
    expect(columns["vcenterPassword"]!.encrypted).toBe(true);
  });

  test.each(SETTINGS)(
    "%s is read, created and edited by whoever may do so with the vCenter",
    (column: string) => {
      expect(access[column]!.read).toEqual(access["name"]!.read);
      expect(access[column]!.create).toEqual(access["name"]!.create);
      expect(access[column]!.update).toEqual(access["name"]!.update);
    },
  );

  test("the settings are for the people who run the vCenter - not for viewers to change", () => {
    expect(access["vcenterUrl"]!.update).toContain(
      Permission.EditVMwareVCenter,
    );
    expect(access["vcenterUrl"]!.update).not.toContain(Permission.Viewer);
    expect(access["vcenterUrl"]!.update).not.toContain(
      Permission.ReadVMwareVCenter,
    );
    expect(access["vcenterUrl"]!.read).toContain(Permission.ReadVMwareVCenter);
  });

  test.each(SERVER_ONLY)(
    "%s is written by the server and the probe only, and read like the vCenter",
    (column: string) => {
      expect(access[column]!.create).toEqual([]);
      expect(access[column]!.update).toEqual([]);
      expect(access[column]!.read).toEqual(access["name"]!.read);
    },
  );

  test("a vCenter is an agent vCenter, collected every two minutes, unless set otherwise", () => {
    expect(columns["collectionMethod"]!.defaultValue).toBe(
      VMwareCollectionMethod.Agent,
    );
    expect(columns["collectionIntervalInMinutes"]!.defaultValue).toBe(
      DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
    );
    expect(columns["isVCenterPasswordSet"]!.defaultValue).toBe(false);
  });

  test("the audit log records the settings people change, and none of the bookkeeping", () => {
    expect(vcenter.enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
    });

    const ignored: Array<string> =
      vcenter.enableAuditLogOn?.ignoreColumns || [];

    expect(ignored).toEqual(VMWARE_VCENTER_BOOKKEEPING_COLUMNS);

    for (const column of [
      "collectionStatus",
      "collectionErrorCode",
      "collectionError",
      "presentedCertificate",
      "collectionSummary",
      "nextCollectionAt",
      "lastCollectionAt",
      "lastSuccessfulCollectionAt",
      "collectionSettingsVersion",
      "lastSeenAt",
    ]) {
      expect(ignored).toContain(column);
    }

    for (const column of [...SETTINGS, "vcenterCredentialsUpdatedAt"]) {
      expect(ignored).not.toContain(column);
    }
  });
});

describe("VMwareVCenterConnectionTest", () => {
  const test_: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
  const testAccess: Dictionary<ColumnAccessControl> =
    getColumnAccessControlForAllColumns(test_);
  const testColumns: Dictionary<TableColumnMetadata> = getTableColumns(test_);

  test("its password is write-only and encrypted, like the vCenter's", () => {
    expect(testAccess["vcenterPassword"]!.read).toEqual([]);
    expect(testAccess["vcenterPassword"]!.update).toEqual([]);
    expect(testColumns["vcenterPassword"]!.encrypted).toBe(true);
  });

  test("what the probe found is the probe's to write, never a person's", () => {
    for (const column of [
      "status",
      "errorCode",
      "errorMessage",
      "presentedCertificate",
      "summary",
      "claimedAt",
      "completedAt",
    ]) {
      expect(testAccess[column]!.create).toEqual([]);
      expect(testAccess[column]!.update).toEqual([]);
    }
  });

  test("is a table of its own API, for whoever may connect a vCenter", () => {
    expect(test_.getCrudApiPath()?.toString()).toBe(
      "/vmware-vcenter-connection-test",
    );

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateVMwareVCenter,
      Permission.EditVMwareVCenter,
    ]) {
      expect(test_.createRecordPermissions).toContain(permission);
      expect(test_.readRecordPermissions).toContain(permission);
    }

    // A test is never edited: a new one is started.
    expect(test_.updateRecordPermissions).toEqual([]);
    expect(test_.readRecordPermissions).not.toContain(Permission.Viewer);
  });
});
