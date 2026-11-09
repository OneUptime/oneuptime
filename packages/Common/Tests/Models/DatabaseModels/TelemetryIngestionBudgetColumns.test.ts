import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnType from "../../../Types/Database/ColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
  TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
  TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import UserType from "../../../Types/UserType";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may set a telemetry ingestion budget (issue #5917), as the columns
 * declare it - the API's own column checks enforce these lists:
 *
 *   - the instance default (GlobalConfig): master admins only, like every
 *     GlobalConfig setting;
 *   - a project's own budget (Project): master admins only - the project's
 *     own owners and admins read the budget they are held to but cannot raise
 *     it;
 *   - an ingestion key's own budget: whoever may edit the key, like its
 *     requests per minute limit (TelemetryIngestionKeyService refuses one
 *     above the project's).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111b1",
);

const propsWith: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenantPermission },
  };
};

const refusalOf: (write: () => void) => unknown = (
  write: () => void,
): unknown => {
  try {
    write();
  } catch (error) {
    return error;
  }

  return null;
};

const access: (
  model: DatabaseBaseModel,
  column: string,
) => ColumnAccessControl = (
  model: DatabaseBaseModel,
  column: string,
): ColumnAccessControl => {
  return model.getColumnAccessControlFor(column)!;
};

type ModelClass = { new (): DatabaseBaseModel };

const columnArgs: (
  target: ModelClass,
  column: string,
) => ColumnMetadataArgs | undefined = (
  target: ModelClass,
  column: string,
): ColumnMetadataArgs | undefined => {
  return getMetadataArgsStorage().columns.find(
    (args: ColumnMetadataArgs): boolean => {
      return args.target === target && args.propertyName === column;
    },
  );
};

describe("the budget columns", () => {
  test.each([
    ["GlobalConfig", GlobalConfig as ModelClass],
    ["Project", Project as ModelClass],
    ["TelemetryIngestionKey", TelemetryIngestionKey as ModelClass],
  ])(
    "are nullable decimals on %s, read back as numbers",
    (_name: string, model: ModelClass) => {
      for (const column of TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES) {
        const args: ColumnMetadataArgs | undefined = columnArgs(model, column);

        expect(args).toBeDefined();
        expect(args!.options.type).toBe(ColumnType.Decimal);
        expect(args!.options.nullable).toBe(true);
        expect(args!.options.transformer).toBeDefined();
        expect(args!.options.default).toBeUndefined();
      }
    },
  );

  test("on GlobalConfig, with the warning and the reset, are master admins' only", () => {
    const config: GlobalConfig = new GlobalConfig();

    for (const column of [
      ...TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
      TELEMETRY_INGESTION_BUDGET_WARNING_PERCENT_COLUMN,
      TELEMETRY_INGESTION_BUDGET_RESET_TIME_COLUMN,
      TELEMETRY_INGESTION_BUDGET_RESET_TIMEZONE_COLUMN,
    ]) {
      expect(access(config, column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    }
  });

  test("on Project, are read by the project's members and telemetry roles, and written by no project role", () => {
    const project: Project = new Project();

    for (const column of TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES) {
      const control: ColumnAccessControl = access(project, column);

      expect(control.create).toEqual([]);
      expect(control.update).toEqual([]);

      for (const reader of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.TelemetryAdmin,
        Permission.TelemetryMember,
        Permission.TelemetryViewer,
      ]) {
        expect(control.read).toContain(reader);
      }
    }
  });

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectAdmin],
    [Permission.TelemetryAdmin],
    [Permission.EditProject],
  ])(
    "a project's %s cannot raise the budget the instance admin set",
    (permission: Permission) => {
      const refusal: unknown = refusalOf(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Project,
          { logsDailyIngestionBudgetInGB: 500 } as unknown as Project,
          propsWith([permission]),
          DatabaseRequestType.Update,
        );
      });

      expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    },
  );

  test("on an ingestion key, are written by whoever may edit the key, like its requests per minute limit", () => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    const requestsPerMinute: ColumnAccessControl = access(
      key,
      "requestsPerMinuteLimit",
    );

    for (const column of TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES) {
      expect(access(key, column)).toEqual(requestsPerMinute);
    }

    expect(
      refusalOf(() => {
        ColumnPermissions.checkDataColumnPermissions(
          TelemetryIngestionKey,
          {
            tracesDailyIngestionBudgetInGB: 5,
          } as unknown as TelemetryIngestionKey,
          propsWith([Permission.EditTelemetryIngestionKey]),
          DatabaseRequestType.Update,
        );
      }),
    ).toBe(null);

    expect(
      refusalOf(() => {
        ColumnPermissions.checkDataColumnPermissions(
          TelemetryIngestionKey,
          {
            tracesDailyIngestionBudgetInGB: 5,
          } as unknown as TelemetryIngestionKey,
          propsWith([Permission.ReadTelemetryIngestionKey]),
          DatabaseRequestType.Update,
        );
      }),
    ).toBeInstanceOf(ColumnWriteRefusedException);
  });
});
