import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityCheckSetting from "../../../Models/DatabaseModels/DataSecurityCheckSetting";
import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityFlow from "../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueFeed from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityResidencyRule from "../../../Models/DatabaseModels/DataSecurityResidencyRule";
import DataSecurityScan from "../../../Models/DatabaseModels/DataSecurityScan";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFeed from "../../../Models/DatabaseModels/DataStoreFeed";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreLabelRule from "../../../Models/DatabaseModels/DataStoreLabelRule";
import DataStoreOwnerRule from "../../../Models/DatabaseModels/DataStoreOwnerRule";
import DataStoreOwnerTeam from "../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../Models/DatabaseModels/DataStoreOwnerUser";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may do what with Data Security's records, the whole matrix.
 *
 * Which buckets hold card numbers, and who can reach them, is exactly what an
 * attacker wants to know. So only the Security tiers read any of it (and a
 * custom role given a record's own permission), never the project's other
 * members; a Security Viewer reads and changes nothing; what the scans find
 * is OneUptime's alone to write; a timeline is never edited; and the
 * project-wide settings are the security admins'. The grants are read from
 * the models' decorators, as the API enforces them (DatabaseService and
 * ModelPermission read the same metadata).
 */

type ModelClass = new () => BaseModel;

const OWNER: Permission = Permission.ProjectOwner;
const ADMIN: Permission = Permission.ProjectAdmin;
const SECURITY_ADMIN: Permission = Permission.SecurityAdmin;
const SECURITY_MEMBER: Permission = Permission.SecurityMember;
const SECURITY_VIEWER: Permission = Permission.SecurityViewer;

// Everyone of the Security tiers reads; editors write; admins delete and own the settings.
const READERS: Array<Permission> = [
  OWNER,
  ADMIN,
  SECURITY_ADMIN,
  SECURITY_MEMBER,
  SECURITY_VIEWER,
];
const EDITORS: Array<Permission> = [
  OWNER,
  ADMIN,
  SECURITY_ADMIN,
  SECURITY_MEMBER,
];
const ADMINS: Array<Permission> = [OWNER, ADMIN, SECURITY_ADMIN];

// Nobody, through the API: OneUptime's own jobs write these records.
const NOBODY: Array<Permission> = [];

type Grants = {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
  delete: Array<Permission>;
};

const MATRIX: ReadonlyArray<[string, ModelClass, Grants]> = [
  [
    "DataStore",
    DataStore,
    {
      create: [...EDITORS, Permission.CreateDataStore],
      read: [...READERS, Permission.ReadDataStore],
      update: [...EDITORS, Permission.EditDataStore],
      delete: [...ADMINS, Permission.DeleteDataStore],
    },
  ],
  [
    "DataStoreFinding",
    DataStoreFinding,
    {
      create: NOBODY,
      read: [...READERS, Permission.ReadDataStoreFinding],
      update: [...EDITORS, Permission.EditDataStoreFinding],
      delete: [...ADMINS, Permission.DeleteDataStoreFinding],
    },
  ],
  [
    "DataStoreAccess",
    DataStoreAccess,
    {
      create: NOBODY,
      read: [...READERS, Permission.ReadDataStoreAccess],
      update: NOBODY,
      delete: [...ADMINS, Permission.DeleteDataStoreAccess],
    },
  ],
  [
    "DataStoreFeed",
    DataStoreFeed,
    {
      create: [...EDITORS, Permission.CreateDataStoreFeed],
      read: [...READERS, Permission.ReadDataStoreFeed],
      update: NOBODY,
      delete: NOBODY,
    },
  ],
  [
    "DataStoreOwnerUser",
    DataStoreOwnerUser,
    {
      create: [...EDITORS, Permission.CreateDataStoreOwnerUser],
      read: [...READERS, Permission.ReadDataStoreOwnerUser],
      update: [...EDITORS, Permission.EditDataStoreOwnerUser],
      delete: [...EDITORS, Permission.DeleteDataStoreOwnerUser],
    },
  ],
  [
    "DataStoreOwnerTeam",
    DataStoreOwnerTeam,
    {
      create: [...EDITORS, Permission.CreateDataStoreOwnerTeam],
      read: [...READERS, Permission.ReadDataStoreOwnerTeam],
      update: [...EDITORS, Permission.EditDataStoreOwnerTeam],
      delete: [...EDITORS, Permission.DeleteDataStoreOwnerTeam],
    },
  ],
  [
    "DataStoreOwnerRule",
    DataStoreOwnerRule,
    {
      create: [...EDITORS, Permission.CreateDataStoreOwnerRule],
      read: [...READERS, Permission.ReadDataStoreOwnerRule],
      update: [...EDITORS, Permission.EditDataStoreOwnerRule],
      delete: [...EDITORS, Permission.DeleteDataStoreOwnerRule],
    },
  ],
  [
    "DataStoreLabelRule",
    DataStoreLabelRule,
    {
      create: [...EDITORS, Permission.CreateDataStoreLabelRule],
      read: [...READERS, Permission.ReadDataStoreLabelRule],
      update: [...EDITORS, Permission.EditDataStoreLabelRule],
      delete: [...EDITORS, Permission.DeleteDataStoreLabelRule],
    },
  ],
  [
    "DataSecurityFlow",
    DataSecurityFlow,
    {
      create: NOBODY,
      read: [...READERS, Permission.ReadDataSecurityFlow],
      update: NOBODY,
      delete: [...ADMINS, Permission.DeleteDataSecurityFlow],
    },
  ],
  [
    "DataSecurityIssue",
    DataSecurityIssue,
    {
      create: NOBODY,
      read: [...READERS, Permission.ReadDataSecurityIssue],
      update: [...EDITORS, Permission.EditDataSecurityIssue],
      delete: [...ADMINS, Permission.DeleteDataSecurityIssue],
    },
  ],
  [
    "DataSecurityIssueFeed",
    DataSecurityIssueFeed,
    {
      create: NOBODY,
      read: [...READERS, Permission.ReadDataSecurityIssueFeed],
      update: NOBODY,
      delete: NOBODY,
    },
  ],
  [
    "DataSecurityScan",
    DataSecurityScan,
    {
      create: NOBODY,
      read: [...READERS, Permission.ReadDataSecurityScan],
      update: NOBODY,
      delete: [...ADMINS, Permission.DeleteDataSecurityScan],
    },
  ],
  [
    "DataSecurityCustomDataType",
    DataSecurityCustomDataType,
    {
      create: [...EDITORS, Permission.CreateDataSecurityCustomDataType],
      read: [...READERS, Permission.ReadDataSecurityCustomDataType],
      update: [...EDITORS, Permission.EditDataSecurityCustomDataType],
      delete: [...ADMINS, Permission.DeleteDataSecurityCustomDataType],
    },
  ],
  [
    "DataSecurityCheckSetting",
    DataSecurityCheckSetting,
    {
      create: [...EDITORS, Permission.CreateDataSecurityCheckSetting],
      read: [...READERS, Permission.ReadDataSecurityCheckSetting],
      update: [...EDITORS, Permission.EditDataSecurityCheckSetting],
      delete: [...ADMINS, Permission.DeleteDataSecurityCheckSetting],
    },
  ],
  [
    "DataSecurityResidencyRule",
    DataSecurityResidencyRule,
    {
      create: [...EDITORS, Permission.CreateDataSecurityResidencyRule],
      read: [...READERS, Permission.ReadDataSecurityResidencyRule],
      update: [...EDITORS, Permission.EditDataSecurityResidencyRule],
      delete: [...ADMINS, Permission.DeleteDataSecurityResidencyRule],
    },
  ],
  [
    "DataSecuritySetting",
    DataSecuritySetting,
    {
      create: [...ADMINS, Permission.CreateDataSecuritySetting],
      read: [...READERS, Permission.ReadDataSecuritySetting],
      update: [...ADMINS, Permission.EditDataSecuritySetting],
      delete: [...ADMINS, Permission.DeleteDataSecuritySetting],
    },
  ],
];

// The records OneUptime's scans and jobs write, and nobody else.
const WRITTEN_BY_ONEUPTIME: ReadonlyArray<ModelClass> = [
  DataStoreFinding,
  DataStoreAccess,
  DataSecurityFlow,
  DataSecurityIssue,
  DataSecurityIssueFeed,
  DataSecurityScan,
];

// The columns every record has, which the base model grants as its table does.
const BASE_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
];

function sorted(permissions: Array<Permission> | undefined): Array<string> {
  return [...(permissions || [])].map(String).sort();
}

function grantsOf(model: BaseModel): Grants {
  return {
    create: model.createRecordPermissions,
    read: model.readRecordPermissions,
    update: model.updateRecordPermissions,
    delete: model.deleteRecordPermissions,
  };
}

function columnsOf(model: BaseModel): Dictionary<ColumnAccessControl> {
  return model.getColumnAccessControlForAllColumns();
}

// A model's own columns a person may change, the base model's left out.
function editableColumns(model: BaseModel): Array<string> {
  return Object.entries(columnsOf(model))
    .filter(([column, access]: [string, ColumnAccessControl]): boolean => {
      return !BASE_COLUMNS.includes(column) && (access.update || []).length > 0;
    })
    .map(([column]: [string, ColumnAccessControl]): string => {
      return column;
    })
    .sort();
}

const MODELS: ReadonlyArray<ModelClass> = MATRIX.map(
  (row: [string, ModelClass, Grants]): ModelClass => {
    return row[1];
  },
);

describe("Data Security's permission matrix", () => {
  test.each(MATRIX)(
    "%s: who may create, read, edit and delete it",
    (_name: string, Model: ModelClass, expected: Grants) => {
      const actual: Grants = grantsOf(new Model());

      expect(sorted(actual.create)).toEqual(sorted(expected.create));
      expect(sorted(actual.read)).toEqual(sorted(expected.read));
      expect(sorted(actual.update)).toEqual(sorted(expected.update));
      expect(sorted(actual.delete)).toEqual(sorted(expected.delete));
    },
  );

  test("the matrix covers every Data Security model, each once", () => {
    expect(new Set(MODELS).size).toBe(16);
    expect(
      MATRIX.map((row: [string, ModelClass, Grants]): string => {
        return new row[1]().tableName!;
      }),
    ).toEqual(
      MATRIX.map((row: [string, ModelClass, Grants]): string => {
        return row[0];
      }),
    );
  });

  test("only the Security tiers read Data Security, and no record or column is the whole project's", () => {
    const everyMember: Array<Permission> = [
      Permission.ProjectMember,
      Permission.ProjectUser,
      Permission.AuthenticatedRequest,
      Permission.User,
      Permission.CurrentUser,
      Permission.Public,
    ];

    for (const Model of MODELS) {
      const model: BaseModel = new Model();
      const granted: Array<Permission> = [
        ...grantsOf(model).create,
        ...grantsOf(model).read,
        ...grantsOf(model).update,
        ...grantsOf(model).delete,
        ...Object.values(columnsOf(model)).flatMap(
          (access: ColumnAccessControl): Array<Permission> => {
            return [
              ...(access.create || []),
              ...(access.read || []),
              ...(access.update || []),
            ];
          },
        ),
      ];

      for (const member of everyMember) {
        expect(granted).not.toContain(member);
      }
    }
  });

  test("a Security Viewer reads every record and changes none of them, nor any of their columns", () => {
    for (const Model of MODELS) {
      const model: BaseModel = new Model();

      expect(grantsOf(model).read).toContain(SECURITY_VIEWER);
      expect(grantsOf(model).create).not.toContain(SECURITY_VIEWER);
      expect(grantsOf(model).update).not.toContain(SECURITY_VIEWER);
      expect(grantsOf(model).delete).not.toContain(SECURITY_VIEWER);

      for (const access of Object.values(columnsOf(model))) {
        expect(access.create || []).not.toContain(SECURITY_VIEWER);
        expect(access.update || []).not.toContain(SECURITY_VIEWER);
      }
    }
  });

  test("what the scans find is OneUptime's to write: nobody creates a finding, an access entry, a flow, an issue, its timeline or a scan", () => {
    for (const Model of WRITTEN_BY_ONEUPTIME) {
      const model: BaseModel = new Model();

      expect(grantsOf(model).create).toEqual([]);

      for (const [column, access] of Object.entries(columnsOf(model))) {
        if (!BASE_COLUMNS.includes(column)) {
          expect([column, access.create || []]).toEqual([column, []]);
        }
      }
    }
  });

  test("a timeline is never rewritten: nobody edits or deletes a store's or an issue's", () => {
    for (const Model of [DataStoreFeed, DataSecurityIssueFeed]) {
      const model: BaseModel = new Model();

      expect(grantsOf(model).update).toEqual([]);
      expect(grantsOf(model).delete).toEqual([]);
      expect(editableColumns(model)).toEqual([]);
    }
  });

  test("on an issue, a person decides only its status, the accepted risk and who it is assigned to", () => {
    expect(editableColumns(new DataSecurityIssue())).toEqual(
      [
        "status",
        "acceptedReason",
        "acceptedUntil",
        "assignedToUser",
        "assignedToUserId",
        "assignedToTeam",
        "assignedToTeamId",
      ].sort(),
    );
  });

  test("on a finding, a person decides only whether it is suppressed, and why", () => {
    expect(editableColumns(new DataStoreFinding())).toEqual(
      ["isSuppressed", "suppressedReason"].sort(),
    );
  });

  test("an access entry, a flow and a scan are read only, column by column", () => {
    for (const Model of [DataStoreAccess, DataSecurityFlow, DataSecurityScan]) {
      expect(editableColumns(new Model())).toEqual([]);
    }
  });

  test("a store's connection string is written, never read back, and kept encrypted; the scans' working state is read by nobody", () => {
    const store: DataStore = new DataStore();
    const columns: Dictionary<ColumnAccessControl> = columnsOf(store);

    expect(columns["connectionString"]!.read).toEqual([]);
    expect(sorted(columns["connectionString"]!.create)).toEqual(
      sorted([...EDITORS, Permission.CreateDataStore]),
    );
    expect(sorted(columns["connectionString"]!.update)).toEqual(
      sorted([...EDITORS, Permission.EditDataStore]),
    );
    expect(getTableColumns(store)["connectionString"]!.encrypted).toBe(true);

    for (const column of ["fingerprints", "contentScanState"]) {
      expect([column, columns[column]!.read]).toEqual([column, []]);
      expect([column, columns[column]!.create]).toEqual([column, []]);
      expect([column, columns[column]!.update]).toEqual([column, []]);
    }

    // And nothing else of a store is hidden from the people who may read it.
    expect(
      Object.entries(columns)
        .filter(([, access]: [string, ColumnAccessControl]): boolean => {
          return (access.read || []).length === 0;
        })
        .map(([column]: [string, ColumnAccessControl]): string => {
          return column;
        })
        .sort(),
    ).toEqual(["connectionString", "contentScanState", "fingerprints"]);
  });

  test("what a scan works out about a store is OneUptime's: its key, kind of exposure, sensitivity, posture, counts and risk", () => {
    const columns: Dictionary<ColumnAccessControl> = columnsOf(new DataStore());

    for (const column of [
      "storeKey",
      "sensitivity",
      "exposure",
      "posture",
      "dataTypeIds",
      "findingCount",
      "openIssueCount",
      "highestIssueSeverity",
      "riskScore",
      "lastSeenAt",
    ]) {
      expect([
        column,
        columns[column]!.create,
        columns[column]!.update,
      ]).toEqual([column, [], []]);
    }

    // A person's word on a store: what it is for, and whether it is public on purpose.
    for (const column of [
      "name",
      "sensitivityOverride",
      "isPublicByDesign",
      "isContentScanEnabled",
      "scanExclusions",
      "purpose",
      "retention",
    ]) {
      expect(sorted(columns[column]!.update)).toEqual(
        sorted([...EDITORS, Permission.EditDataStore]),
      );
    }
  });

  test("every record's own permission is in the Security group, and a custom role can be given it", () => {
    const catalogue: Dictionary<PermissionProps> =
      PermissionHelper.getAllPermissionPropsAsDictionary();
    let count: number = 0;

    for (const [, Model, grants] of MATRIX) {
      const model: BaseModel = new Model();
      // A record with labels is scoped by them: its permissions can be limited to some labels.
      const scopedByLabels: boolean = Boolean(model.getAccessControlColumn());
      const own: Array<Permission> = [
        ...grants.create,
        ...grants.read,
        ...grants.update,
        ...grants.delete,
      ].filter((permission: Permission): boolean => {
        return !READERS.includes(permission);
      });

      for (const permission of own) {
        const props: PermissionProps | undefined = catalogue[permission];

        count++;
        expect([permission, props?.group]).toEqual([
          permission,
          PermissionGroup.Security,
        ]);
        expect([permission, props?.isAssignableToTenant]).toEqual([
          permission,
          true,
        ]);
        expect([permission, props?.isAccessControlPermission]).toEqual([
          permission,
          scopedByLabels,
        ]);
      }
    }

    expect(count).toBeGreaterThanOrEqual(50);
  });

  test("a data store can be limited by its labels, as monitors and services are", () => {
    expect(new DataStore().getAccessControlColumn()).toBe("labels");
  });
});
