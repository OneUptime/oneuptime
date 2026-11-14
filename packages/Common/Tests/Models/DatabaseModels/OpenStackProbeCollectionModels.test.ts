import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackCloud, {
  OPENSTACK_CLOUD_BOOKKEEPING_COLUMNS,
} from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck, {
  OPENSTACK_CLOUD_CHECK_BOOKKEEPING_COLUMNS,
} from "../../../Models/DatabaseModels/OpenStackCloudCheck";
import OpenStackCloudConnectionTest from "../../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import {
  OPENSTACK_CONNECTION_SAVED_SELECT,
  OPENSTACK_CONNECTION_SETTING_COLUMNS,
} from "../../../Server/Utils/OpenStack/OpenStackCloudConnection";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import OpenStackCollectionErrorCode from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import OpenStackConnectionTestStatus from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import { DEFAULT_OPENSTACK_ENDPOINT_INTERFACE } from "../../../Types/OpenStack/OpenStackProbeCollection";
import Permission from "../../../Types/Permission";
import { DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES } from "../../../Utils/OpenStack/OpenStackCollectionSettings";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";

/*
 * Who may read and write a cloud's probe collection settings, as the model declares it. The
 * secret is write-only, what the probe and the server find out is theirs alone to write, and
 * the audit log records what people change, never the secret or the probe's bookkeeping.
 *
 * The stores write SQL by hand, and no compiler reads it. The last section holds what they
 * name to the columns the tables have, so a renamed column fails here and not on a probe's
 * first work request.
 */

const cloud: OpenStackCloud = new OpenStackCloud();
const access: Dictionary<ColumnAccessControl> =
  getColumnAccessControlForAllColumns(cloud);
const columns: Dictionary<TableColumnMetadata> = getTableColumns(cloud);

const SETTINGS: Array<string> = [
  "collectionMethod",
  "authUrl",
  "endpointInterface",
  "collectionRegions",
  "credentialKind",
  "applicationCredentialId",
  "keystoneUsername",
  "userDomainName",
  "projectName",
  "projectDomainName",
  "collectionProbe",
  "collectionProbeId",
  "trustedCertificateFingerprints",
  "collectionIntervalInMinutes",
  "collectionOptions",
];

const SERVER_ONLY: Array<string> = [
  "isCredentialSet",
  "credentialsUpdatedAt",
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

describe("OpenStackCloud's probe collection columns", () => {
  test("the secret is write-only and encrypted at rest", () => {
    expect(access["credentialSecret"]!.read).toEqual([]);
    expect(access["credentialSecret"]!.create).toEqual(
      access["authUrl"]!.create,
    );
    expect(access["credentialSecret"]!.update).toEqual(
      access["authUrl"]!.update,
    );
    expect(columns["credentialSecret"]!.encrypted).toBe(true);
  });

  test.each(SETTINGS)(
    "%s is read, created and edited by whoever may do so with the cloud",
    (column: string) => {
      expect(access[column]!.read).toEqual(access["name"]!.read);
      expect(access[column]!.create).toEqual(access["name"]!.create);
      expect(access[column]!.update).toEqual(access["name"]!.update);
    },
  );

  test("the settings are for the people who run the cloud, not for viewers to change", () => {
    expect(access["authUrl"]!.update).toContain(Permission.EditOpenStackCloud);
    expect(access["authUrl"]!.update).not.toContain(Permission.Viewer);
    expect(access["authUrl"]!.update).not.toContain(
      Permission.ReadOpenStackCloud,
    );
    expect(access["authUrl"]!.read).toContain(Permission.ReadOpenStackCloud);
  });

  test.each(SERVER_ONLY)(
    "%s is written by the server and the probe only, and read like the cloud",
    (column: string) => {
      expect(access[column]!.create).toEqual([]);
      expect(access[column]!.update).toEqual([]);
      expect(access[column]!.read).toEqual(access["name"]!.read);
    },
  );

  test("a cloud is an agent cloud, collected every two minutes from the public addresses, unless set otherwise", () => {
    expect(columns["collectionMethod"]!.defaultValue).toBe(
      OpenStackCollectionMethod.Agent,
    );
    expect(columns["collectionIntervalInMinutes"]!.defaultValue).toBe(
      DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
    );
    expect(columns["endpointInterface"]!.defaultValue).toBe(
      DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
    );
    expect(columns["isCredentialSet"]!.defaultValue).toBe(false);
    expect(columns["collectionSettingsVersion"]!.defaultValue).toBe(0);
  });

  test("a stored string is only ever one the code knows", () => {
    expect(columns["collectionMethod"]!.allowedValues).toEqual(
      Object.values(OpenStackCollectionMethod),
    );
    expect(columns["collectionStatus"]!.allowedValues).toEqual(
      Object.values(OpenStackCollectionStatus),
    );
    expect(columns["collectionErrorCode"]!.allowedValues).toEqual(
      Object.values(OpenStackCollectionErrorCode),
    );
    expect(columns["endpointInterface"]!.allowedValues).toEqual([
      "public",
      "internal",
      "admin",
    ]);
    expect(columns["credentialKind"]!.allowedValues).toEqual([
      "applicationCredential",
      "password",
    ]);
  });

  test("the audit log records the settings people change, and none of the bookkeeping", () => {
    expect(cloud.enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
    });

    const ignored: Array<string> = cloud.enableAuditLogOn?.ignoreColumns || [];

    expect(ignored).toEqual(OPENSTACK_CLOUD_BOOKKEEPING_COLUMNS);

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
      "instanceCount",
    ]) {
      expect(ignored).toContain(column);
    }

    for (const column of [...SETTINGS, "credentialsUpdatedAt"]) {
      expect(ignored).not.toContain(column);
    }

    for (const column of ignored) {
      expect({ column, isColumn: Boolean(columns[column]) }).toEqual({
        column,
        isColumn: true,
      });
    }
  });

  test("what a person writes to set up probe collection is what the save hooks treat as a settings write", () => {
    expect([...OPENSTACK_CONNECTION_SETTING_COLUMNS].sort()).toEqual(
      [...SETTINGS, "credentialSecret"].sort(),
    );
  });

  test("what the save hooks read of the saved row are columns, and never the secret", () => {
    for (const column of Object.keys(OPENSTACK_CONNECTION_SAVED_SELECT)) {
      expect({ column, isColumn: Boolean(columns[column]) }).toEqual({
        column,
        isColumn: true,
      });
    }

    expect(Object.keys(OPENSTACK_CONNECTION_SAVED_SELECT)).not.toContain(
      "credentialSecret",
    );
  });

  test("the claim a probe makes every ten seconds has an index to read", () => {
    expect(indexesOf(OpenStackCloud)).toContainEqual([
      "collectionProbeId",
      "nextCollectionAt",
    ]);
  });
});

describe("OpenStackCloudCheck", () => {
  const check: OpenStackCloudCheck = new OpenStackCloudCheck();
  const checkAccess: Dictionary<ColumnAccessControl> =
    getColumnAccessControlForAllColumns(check);
  const checkColumns: Dictionary<TableColumnMetadata> = getTableColumns(check);

  test.each(["credentialSecret", "osProfilerKey"])(
    "%s is write-only and encrypted at rest",
    (column: string) => {
      expect(checkAccess[column]!.read).toEqual([]);
      expect(checkAccess[column]!.update).toEqual(
        checkAccess["lifecycleProjectName"]!.update,
      );
      expect(checkColumns[column]!.encrypted).toBe(true);
    },
  );

  test.each([
    "isCredentialSet",
    "isOsProfilerKeySet",
    "credentialBinding",
    "apiCheckResult",
    "lifecycleRecords",
    "pinnedLifecycleProjectId",
    "nextApiCheckAt",
    "nextLifecycleCheckAt",
    "lastApiCheckAt",
    "lastLifecycleCheckAt",
    "isSweepPending",
    "settingsVersion",
    "checkError",
  ])("%s is the server's to write, never a person's", (column: string) => {
    expect(checkAccess[column]!.create).toEqual([]);
    expect(checkAccess[column]!.update).toEqual([]);
  });

  test("the audit log records what people change, and none of a report's bookkeeping", () => {
    expect(check.enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
    });
    expect(check.enableAuditLogOn?.ignoreColumns).toEqual(
      OPENSTACK_CLOUD_CHECK_BOOKKEEPING_COLUMNS,
    );
    expect(OPENSTACK_CLOUD_CHECK_BOOKKEEPING_COLUMNS).toEqual(
      expect.arrayContaining(["apiCheckResult", "lifecycleRecords"]),
    );
    expect(OPENSTACK_CLOUD_CHECK_BOOKKEEPING_COLUMNS).not.toContain(
      "isLifecycleCheckEnabled",
    );
  });

  test("is registered, so the database and the API know the table", () => {
    expect(AllModelTypes).toContain(OpenStackCloudCheck);
  });
});

describe("OpenStackCloudConnectionTest", () => {
  const test_: OpenStackCloudConnectionTest =
    new OpenStackCloudConnectionTest();
  const testAccess: Dictionary<ColumnAccessControl> =
    getColumnAccessControlForAllColumns(test_);
  const testColumns: Dictionary<TableColumnMetadata> = getTableColumns(test_);

  test("is registered, so the database and the API know the table", () => {
    expect(AllModelTypes).toContain(OpenStackCloudConnectionTest);
    expect(test_.tableName).toBe("OpenStackCloudConnectionTest");
    expect(test_.getTenantColumn()).toBe("projectId");
  });

  test("its secret is write-only and encrypted, like the cloud's", () => {
    expect(testAccess["credentialSecret"]!.read).toEqual([]);
    expect(testAccess["credentialSecret"]!.update).toEqual([]);
    expect(testAccess["credentialSecret"]!.create).toEqual(
      test_.createRecordPermissions,
    );
    expect(testColumns["credentialSecret"]!.encrypted).toBe(true);
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
      expect(testAccess[column]!.read).toEqual(test_.readRecordPermissions);
    }
  });

  test("everything a person may say about a test is said when it is started, and never changed", () => {
    for (const column of [
      "probe",
      "probeId",
      "openStackCloud",
      "openStackCloudId",
      "authUrl",
      "endpointInterface",
      "collectionRegions",
      "credentialKind",
      "applicationCredentialId",
      "keystoneUsername",
      "userDomainName",
      "projectName",
      "projectDomainName",
      "trustedCertificateFingerprints",
    ]) {
      expect(testAccess[column]!.create).toEqual(test_.createRecordPermissions);
      expect(testAccess[column]!.read).toEqual(test_.readRecordPermissions);
      expect(testAccess[column]!.update).toEqual([]);
    }
  });

  test("a new test is always pending, whatever the request says", () => {
    expect(testColumns["status"]!.forceGetDefaultValueOnCreate!()).toBe(
      OpenStackConnectionTestStatus.Pending,
    );
    expect(testColumns["status"]!.allowedValues).toEqual(
      Object.values(OpenStackConnectionTestStatus),
    );
  });

  test("is a table of its own API, for whoever may connect a cloud", () => {
    expect(test_.getCrudApiPath()?.toString()).toBe(
      "/openstack-cloud-connection-test",
    );

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateOpenStackCloud,
      Permission.EditOpenStackCloud,
    ]) {
      expect(test_.createRecordPermissions).toContain(permission);
      expect(test_.readRecordPermissions).toContain(permission);
      expect(test_.deleteRecordPermissions).toContain(permission);
    }

    // A test is never edited: a new one is started.
    expect(test_.updateRecordPermissions).toEqual([]);

    // Its result says what a probe could reach on the project's network.
    expect(test_.readRecordPermissions).not.toContain(Permission.Viewer);
    expect(test_.readRecordPermissions).not.toContain(
      Permission.ReadOpenStackCloud,
    );
  });

  test("is not published with the API reference: a test is the dashboard's form, not a resource", () => {
    expect(test_.enableDocumentation).toBeFalsy();
  });

  test("a probe asking for its tests has an index to read", () => {
    expect(indexesOf(OpenStackCloudConnectionTest)).toContainEqual([
      "probeId",
      "status",
    ]);
  });
});

/*
 * The columns the database has: what a statement can name, whatever the access rules say
 * about them.
 */
function databaseColumnsOf(modelType: new () => BaseModel): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const column of getMetadataArgsStorage().filterColumns([
    modelType,
    BaseModel,
  ])) {
    names.add(column.options.name || column.propertyName);
  }

  return names;
}

function indexesOf(modelType: new () => BaseModel): Array<Array<string>> {
  return getMetadataArgsStorage()
    .indices.filter((index: { target: unknown }): boolean => {
      return index.target === modelType;
    })
    .map((index: { columns?: unknown }): Array<string> => {
      return index.columns as Array<string>;
    });
}

const STORES: string = path.join(__dirname, "../../../Server/Utils/OpenStack");

function sourceOf(file: string): string {
  return fs.readFileSync(path.join(STORES, file), "utf8");
}

const READS_OR_WRITES_A_TABLE: RegExp = /\b(SELECT|UPDATE)\s+/;

// Every SQL statement written in a file: its template literals that read or write a table.
function statementsIn(file: string): Array<string> {
  return (sourceOf(file).match(/`[^`]*`/g) || []).filter(
    (literal: string): boolean => {
      return READS_OR_WRITES_A_TABLE.test(literal);
    },
  );
}

function namesIn(text: string, pattern: RegExp): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

describe("what the hand-written SQL names", () => {
  const cloudColumns: Set<string> = databaseColumnsOf(OpenStackCloud);
  const testColumnNames: Set<string> = databaseColumnsOf(
    OpenStackCloudConnectionTest,
  );

  test("the claim of a probe's clouds names columns the table has", () => {
    const statements: Array<string> = statementsIn(
      "OpenStackProbeCollectionStore.ts",
    );

    /*
     * The claim is one statement (OneUptime issue #7390): it locks the due
     * clouds and moves them on, so the SELECT and the UPDATE are one literal.
     */
    expect(
      statements.filter((statement: string): boolean => {
        return (
          statement.includes('FROM "OpenStackCloud" c') &&
          statement.includes('UPDATE "OpenStackCloud" AS c')
        );
      }),
    ).toHaveLength(1);

    /*
     * And the rule it keeps clouds by, a list of its own (getCollectableSql),
     * which the claim and the set-aside of the clouds it stepped over both
     * read (Utils/Probe/ClaimSetAside, OneUptime issue #7919).
     */
    const source: string = sourceOf("OpenStackProbeCollectionStore.ts");
    const ruleStart: number = source.indexOf(
      "public static getCollectableSql(",
    );

    expect(ruleStart).toBeGreaterThan(-1);

    const rule: string = source.slice(
      ruleStart,
      source.indexOf("].join(", ruleStart),
    );

    const named: Array<string> = [
      ...statements.flatMap((statement: string): Array<string> => {
        return statement.includes('"OpenStackCloud"')
          ? namesIn(statement, /\bc\."(\w+)"/g)
          : [];
      }),
      ...namesIn(rule, /\bc\."(\w+)"/g),
    ];

    // Not vacuous: these are what the claim turns on.
    for (const column of [
      "collectionProbeId",
      "collectionMethod",
      "isCredentialSet",
      "authUrl",
      "nextCollectionAt",
      "collectionIntervalInMinutes",
    ]) {
      expect(named).toContain(column);
    }

    for (const column of named) {
      expect({ column, isColumn: cloudColumns.has(column) }).toEqual({
        column,
        isColumn: true,
      });
    }
  });

  test("the claim's update, and the columns the connection tests' statements write, are the tables'", () => {
    const update: string | undefined = statementsIn(
      "OpenStackProbeCollectionStore.ts",
    ).find((statement: string): boolean => {
      return statement.includes('UPDATE "OpenStackCloud"');
    });

    expect(update).toContain('"nextCollectionAt"');
    expect(cloudColumns.has("nextCollectionAt")).toBe(true);

    const statements: Array<string> = statementsIn(
      "OpenStackConnectionTestStore.ts",
    );

    expect(statements.length).toBeGreaterThanOrEqual(4);

    const named: Array<string> = statements.flatMap(
      (statement: string): Array<string> => {
        // A SELECT here says FOR UPDATE too, so this looks for the table's name.
        return statement.includes('UPDATE "')
          ? namesIn(statement, /"(\w+)"\s*(?:=|<|IS\b)/g)
          : namesIn(statement, /\bt\."(\w+)"/g);
      },
    );

    for (const column of [
      "probeId",
      "status",
      "errorCode",
      "errorMessage",
      "completedAt",
      "claimedAt",
      "credentialSecret",
      "createdAt",
      "deletedAt",
    ]) {
      expect(named).toContain(column);
    }

    for (const column of named) {
      expect({ column, isColumn: testColumnNames.has(column) }).toEqual({
        column,
        isColumn: true,
      });
    }
  });

  test.each([
    ["OpenStackProbeCollectionStore.ts"],
    ["OpenStackCloudConnection.ts"],
  ])(
    "what %s writes as the server is what only the server may write",
    (file: string) => {
      const written: Array<string> = namesIn(
        sourceOf(file),
        /\bvalues\["(\w+)"\]/g,
      );

      expect(written.length).toBeGreaterThanOrEqual(5);

      for (const column of written) {
        expect(SERVER_ONLY).toContain(column);
      }
    },
  );
});
