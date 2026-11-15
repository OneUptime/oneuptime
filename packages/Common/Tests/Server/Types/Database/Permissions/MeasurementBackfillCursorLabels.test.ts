import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ReadPermission, {
  LabelledReferences,
  PLAIN_COLUMNS_NAMING_RECORDS_THE_ROW_IS_NOT_ABOUT,
  PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS,
} from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import AlertMeasurement from "../../../../../Models/DatabaseModels/AlertMeasurement";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import IncidentMeasurement from "../../../../../Models/DatabaseModels/IncidentMeasurement";
import ScheduledMaintenanceMeasurement from "../../../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import PermissionScopeNarrowing from "../../../../../Types/Database/AccessControl/PermissionScopeNarrowing";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A MEASUREMENT IS NOT WEIGHED BY THE RECORD ITS BACKFILL STANDS AT (#8463).
 *
 * An incident, alert or maintenance event measurement keeps the id of the
 * last record its backfill worked out (backfillCursorId, #8171), beside that
 * record's createdAt. The id is a plain id column whose name says no kind,
 * and the label rule weighs a label-less model's row by every such column
 * against the labels of every model that carries them
 * (ReadPermission.getLabelledReferences, anyKindColumns). So the day the
 * column came in, the server began narrowing the twelve measurement
 * permissions by labels: a reader limited to labels saw a measurement only
 * while its backfill stood at no record, or at one carrying those labels,
 * and lost it when the backfill moved on. PermissionScopeNarrowingGuard and
 * ParentRelationGuard both went red on main.
 *
 * A measurement is the project's, whichever record its backfill stands at,
 * so the cursor columns are listed in
 * PLAIN_COLUMNS_NAMING_RECORDS_THE_ROW_IS_NOT_ABOUT and the rule skips them.
 * This pins that on the label references, on the conditions a read, an
 * update and a delete get under a grant limited to labels and under a block
 * with labels, and on what the dashboard says a scope narrows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8463aaaa-0000-4000-8000-000000000001",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "8463aaaa-0000-4000-8000-000000000002",
);
const LABEL_ID: ObjectID = new ObjectID("8463aaaa-0000-4000-8000-000000000003");

const CURSOR_COLUMN: string = "backfillCursorId";

interface MeasurementCase {
  modelType: { new (): BaseModel };
  // The records the measurement measures, which carry labels.
  measures: string;
  read: Permission;
  edit: Permission;
  remove: Permission;
  create: Permission;
}

const MEASUREMENTS: Array<MeasurementCase> = [
  {
    modelType: IncidentMeasurement,
    measures: "Incident",
    read: Permission.ReadIncidentMeasurement,
    edit: Permission.EditIncidentMeasurement,
    remove: Permission.DeleteIncidentMeasurement,
    create: Permission.CreateIncidentMeasurement,
  },
  {
    modelType: AlertMeasurement,
    measures: "Alert",
    read: Permission.ReadAlertMeasurement,
    edit: Permission.EditAlertMeasurement,
    remove: Permission.DeleteAlertMeasurement,
    create: Permission.CreateAlertMeasurement,
  },
  {
    modelType: ScheduledMaintenanceMeasurement,
    measures: "ScheduledMaintenance",
    read: Permission.ReadScheduledMaintenanceMeasurement,
    edit: Permission.EditScheduledMaintenanceMeasurement,
    remove: Permission.DeleteScheduledMaintenanceMeasurement,
    create: Permission.CreateScheduledMaintenanceMeasurement,
  },
];

const tableOf: (modelType: { new (): BaseModel }) => string = (modelType: {
  new (): BaseModel;
}): string => {
  return new modelType().tableName as string;
};

function grantLimitedToLabel(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [LABEL_ID],
    isBlockPermission: false,
    scope: PermissionScope.Labels,
  };
}

// The permission over the whole project, and a block of it for the label.
function blockedForLabel(permission: Permission): Array<UserPermission> {
  return [
    {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      scope: PermissionScope.All,
    },
    {
      _type: "UserPermission",
      permission: permission,
      labelIds: [LABEL_ID],
      isBlockPermission: true,
      scope: PermissionScope.All,
    },
  ];
}

function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

async function scopeOf(
  modelType: { new (): BaseModel },
  type: DatabaseRequestType,
  rows: Array<UserPermission>,
): Promise<Dictionary<unknown>> {
  return (await BasePermission.addRecordScopeToQuery(
    modelType,
    {},
    null,
    memberWith(rows),
    type,
  )) as Dictionary<unknown>;
}

/*
 * The permissions each operation is made with: a change or a delete needs
 * the read too, held the same way.
 */
function operations(
  measurement: MeasurementCase,
): Array<{ type: DatabaseRequestType; permissions: Array<Permission> }> {
  return [
    { type: DatabaseRequestType.Read, permissions: [measurement.read] },
    {
      type: DatabaseRequestType.Update,
      permissions: [measurement.edit, measurement.read],
    },
    {
      type: DatabaseRequestType.Delete,
      permissions: [measurement.remove, measurement.read],
    },
  ];
}

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a measurement's backfill cursor", () => {
  for (const measurement of MEASUREMENTS) {
    const table: string = tableOf(measurement.modelType);

    test(`${table}: is a plain id column OneUptime alone writes, naming one of the ${measurement.measures}s it measures`, () => {
      const column: TableColumnMetadata | undefined =
        new measurement.modelType().getTableColumnMetadata(CURSOR_COLUMN);

      expect(column?.type).toBe(TableColumnType.ObjectID);
      // No model to say which kind it names: the label rule cannot tell it.
      expect(column?.modelType).toBeUndefined();
      expect(column?.manyToOneRelationColumn).toBeUndefined();
      expect(column?.computed).toBe(true);

      // Nobody may write it: a write is never about the record it names.
      expect(
        new measurement.modelType().getColumnAccessControlFor(CURSOR_COLUMN)
          ?.create,
      ).toEqual([]);
      expect(
        new measurement.modelType().getColumnAccessControlFor(CURSOR_COLUMN)
          ?.update,
      ).toEqual([]);
    });

    test(`${table}: is listed as naming a record the row is not about, and not as naming an unlabelled one`, () => {
      expect(
        PLAIN_COLUMNS_NAMING_RECORDS_THE_ROW_IS_NOT_ABOUT.has(
          `${table}.${CURSOR_COLUMN}`,
        ),
      ).toBe(true);

      // The record it names carries labels: the other list would say it does not.
      expect(
        PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS.has(
          `${table}.${CURSOR_COLUMN}`,
        ),
      ).toBe(false);
    });

    test(`${table}: names no labelled record the label rule weighs the measurement by`, () => {
      const references: LabelledReferences =
        ReadPermission.getLabelledReferences(measurement.modelType);

      expect(references.anyKindColumns).not.toContain(CURSOR_COLUMN);
      expect(
        references.keys.map((key: { column: string }): string => {
          return key.column;
        }),
      ).not.toContain(CURSOR_COLUMN);

      // The cursor was the only one: a measurement names no labelled record.
      expect(references).toEqual({ keys: [], anyKindColumns: [] });
      expect(
        ReadPermission.getLabelledKeyColumns(measurement.modelType),
      ).toEqual([]);
    });

    test(`${table}: a grant limited to labels reaches every measurement`, () => {
      expect(
        ReadPermission.getGrantedLabelsCondition(measurement.modelType, [
          LABEL_ID,
        ]),
      ).toBeNull();
    });

    for (const operation of operations(measurement)) {
      test(`${table}, ${operation.type}: limited to a label, no condition names the cursor or the record ids`, async () => {
        const query: Dictionary<unknown> = await scopeOf(
          measurement.modelType,
          operation.type,
          operation.permissions.map(grantLimitedToLabel),
        );

        expect(query[CURSOR_COLUMN]).toBeUndefined();
        expect(query["_id"]).toBeUndefined();
      });

      test(`${table}, ${operation.type}: under a block with a label, no condition names the cursor`, async () => {
        const query: Dictionary<unknown> = await scopeOf(
          measurement.modelType,
          operation.type,
          operation.permissions.flatMap(blockedForLabel),
        );

        expect(query[CURSOR_COLUMN]).toBeUndefined();
        expect(query["_id"]).toBeUndefined();
      });
    }

    test(`${table}: the dashboard offers no scope for its permissions, as none narrows them`, () => {
      for (const permission of [
        measurement.create,
        measurement.read,
        measurement.edit,
        measurement.remove,
      ]) {
        expect([
          permission,
          PermissionScopeNarrowing.getNarrowedBy(permission),
        ]).toEqual([permission, null]);
      }
    });
  }
});

describe("the plain columns naming a record the row is not about", () => {
  test("are real plain id columns of a model that carries no labels of its own", () => {
    expect(PLAIN_COLUMNS_NAMING_RECORDS_THE_ROW_IS_NOT_ABOUT.size).toBe(3);

    for (const entry of PLAIN_COLUMNS_NAMING_RECORDS_THE_ROW_IS_NOT_ABOUT) {
      const [tableName, column] = entry.split(".") as [string, string];
      const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
        (candidate: { new (): BaseModel }): boolean => {
          return tableOf(candidate) === tableName;
        },
      );

      expect([entry, Boolean(modelType)]).toEqual([entry, true]);
      expect([
        entry,
        new modelType!().getTableColumnMetadata(column)?.type,
      ]).toEqual([entry, TableColumnType.ObjectID]);
      expect([
        entry,
        Boolean(new modelType!().getAccessControlColumn()),
      ]).toEqual([entry, false]);
    }
  });

  test("are in one list only", () => {
    for (const entry of PLAIN_COLUMNS_NAMING_RECORDS_THE_ROW_IS_NOT_ABOUT) {
      expect([
        entry,
        PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS.has(entry),
      ]).toEqual([entry, false]);
    }
  });

  test("a plain id column that names no kind is still weighed when it is not listed", () => {
    // InventoryItem.resourceId names a resource of any kind, and is weighed.
    const inventoryItem: { new (): BaseModel } | undefined = AllModelTypes.find(
      (candidate: { new (): BaseModel }): boolean => {
        return tableOf(candidate) === "InventoryItem";
      },
    );

    expect(inventoryItem).toBeDefined();
    expect(
      ReadPermission.getLabelledReferences(inventoryItem!).anyKindColumns,
    ).toContain("resourceId");
  });
});
