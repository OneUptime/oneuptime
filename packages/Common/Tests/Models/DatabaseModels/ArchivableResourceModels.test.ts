import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Service from "../../../Models/DatabaseModels/Service";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ModelImportExport from "../../../Utils/ModelImportExport";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { JoinColumnMetadataArgs } from "typeorm/metadata-args/JoinColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Workflows, monitors, status pages, dashboards and on-call policies can be
 * archived. Each got the three columns every archivable resource already had
 * (Service, MessageQueue, SLO, ...), and this pins that they really are the
 * same: the same column shapes, the same index, and - checked against the
 * real permission code rather than the declarations alone - the same API
 * contract:
 *
 *   - archiving is an update, so exactly the roles that may edit the resource
 *     may archive or unarchive it, and every reader may see whether it is
 *     archived;
 *   - who archived it and when are stamped by the server and can be written
 *     by nobody, project owners included;
 *   - an export never carries the archive state.
 *
 * Pure metadata and in-process permission checks: no Postgres.
 */

type ModelType = { new (): BaseModel };

interface ArchivableModel {
  name: string;
  modelType: ModelType;
  tableName: string;
  // A role that may edit this resource without being a project-wide role.
  editPermission: Permission;
  // A role that may only read it.
  readPermission: Permission;
}

const ARCHIVABLE_MODELS: Array<ArchivableModel> = [
  {
    name: "Workflow",
    modelType: Workflow,
    tableName: "Workflow",
    editPermission: Permission.EditWorkflow,
    readPermission: Permission.ReadWorkflow,
  },
  {
    name: "Monitor",
    modelType: Monitor,
    tableName: "Monitor",
    editPermission: Permission.EditProjectMonitor,
    readPermission: Permission.ReadProjectMonitor,
  },
  {
    name: "StatusPage",
    modelType: StatusPage,
    tableName: "StatusPage",
    editPermission: Permission.EditProjectStatusPage,
    readPermission: Permission.ReadProjectStatusPage,
  },
  {
    name: "Dashboard",
    modelType: Dashboard,
    tableName: "Dashboard",
    editPermission: Permission.EditDashboard,
    readPermission: Permission.ReadDashboard,
  },
  {
    name: "OnCallDutyPolicy",
    modelType: OnCallDutyPolicy,
    tableName: "OnCallDutyPolicy",
    editPermission: Permission.EditProjectOnCallDutyPolicy,
    readPermission: Permission.ReadProjectOnCallDutyPolicy,
  },
];

const STAMP_COLUMNS: Array<string> = [
  "archivedAt",
  "archivedByUser",
  "archivedByUserId",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1e2c3d-0000-4000-8000-00000000a1c1",
);
const USER_ID: ObjectID = new ObjectID("5b1e2c3d-0000-4000-8000-00000000a1c2");

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function userPermissions(
  permissions: Array<Permission>,
): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });
}

function columnAccess(model: BaseModel, column: string): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  if (!accessControl) {
    throw new Error(`${column} has no @ColumnAccessControl`);
  }

  return accessControl;
}

function sorted(values: Array<Permission | string>): Array<string> {
  return values
    .map((value: Permission | string): string => {
      return value.toString();
    })
    .sort();
}

function columnArgs(
  modelType: ModelType,
  property: string,
): ColumnMetadataArgs | undefined {
  return (getMetadataArgsStorage().columns as Array<ColumnMetadataArgs>).find(
    (candidate: ColumnMetadataArgs): boolean => {
      return (
        candidate.target === modelType && candidate.propertyName === property
      );
    },
  );
}

function updateWith(
  archivable: ArchivableModel,
  values: Record<string, unknown>,
  permissions: Array<Permission>,
): () => void {
  return (): void => {
    const data: BaseModel = new archivable.modelType();

    for (const key of Object.keys(values)) {
      (data as unknown as Record<string, unknown>)[key] = values[key];
    }

    ColumnPermissions.checkDataColumnPermissions(
      archivable.modelType,
      data,
      makeProps(permissions),
      DatabaseRequestType.Update,
    );
  };
}

describe.each(ARCHIVABLE_MODELS)(
  "$name can be archived",
  (archivable: ArchivableModel) => {
    const model: BaseModel = new archivable.modelType();

    describe("the columns", () => {
      test("isArchived is a required boolean that defaults to false, in the API and in Postgres", () => {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata("isArchived");

        expect(metadata.type).toBe(TableColumnType.Boolean);
        expect(metadata.required).toBe(true);
        expect(metadata.defaultValue).toBe(false);
        expect(model.isDefaultValueColumn("isArchived")).toBe(true);

        const column: ColumnMetadataArgs | undefined = columnArgs(
          archivable.modelType,
          "isArchived",
        );

        expect(column?.options.nullable).toBe(false);
        expect(column?.options.default).toBe(false);
        // A fresh model leaves it unset, so a write that omits it never archives.
        expect(Object.prototype.hasOwnProperty.call(model, "isArchived")).toBe(
          true,
        );
        expect(
          (model as unknown as Record<string, unknown>)["isArchived"],
        ).toBe(undefined);
      });

      test("isArchived says, in the API docs, what archiving does", () => {
        const description: string =
          model.getTableColumnMetadata("isArchived").description || "";

        expect(description.length).toBeGreaterThan(20);
        expect(description).toMatch(/^Archived /);
        expect(description).toMatch(/hidden from/);
        // Never the telemetry wording: these resources stop working.
        expect(description).not.toMatch(/telemetry/i);
      });

      test("archivedAt is a nullable date and archivedByUserId a nullable id", () => {
        expect(model.getTableColumnMetadata("archivedAt").type).toBe(
          TableColumnType.Date,
        );
        expect(
          columnArgs(archivable.modelType, "archivedAt")?.options.nullable,
        ).toBe(true);
        expect(model.getTableColumnMetadata("archivedByUserId").type).toBe(
          TableColumnType.ObjectID,
        );
        expect(
          columnArgs(archivable.modelType, "archivedByUserId")?.options
            .nullable,
        ).toBe(true);
      });

      test("archivedByUser points at the user, and is cleared rather than blocking when that user is deleted", () => {
        const relation: RelationMetadataArgs | undefined = (
          getMetadataArgsStorage().relations as Array<RelationMetadataArgs>
        ).find((candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === archivable.modelType &&
            candidate.propertyName === "archivedByUser"
          );
        });
        const joinColumn: JoinColumnMetadataArgs | undefined = (
          getMetadataArgsStorage().joinColumns as Array<JoinColumnMetadataArgs>
        ).find((candidate: JoinColumnMetadataArgs): boolean => {
          return (
            candidate.target === archivable.modelType &&
            candidate.propertyName === "archivedByUser"
          );
        });

        expect(relation?.relationType).toBe("many-to-one");
        expect(relation?.options.onDelete).toBe("SET NULL");
        expect(joinColumn?.name).toBe("archivedByUserId");
        expect(model.getTableColumnMetadata("archivedByUser").modelType).toBe(
          User,
        );
        expect(
          model.getTableColumnMetadata("archivedByUser")
            .manyToOneRelationColumn,
        ).toBe("archivedByUserId");
      });

      test("(projectId, isArchived) is indexed: every list filters on the pair", () => {
        const index: IndexMetadataArgs | undefined =
          getMetadataArgsStorage().indices.find(
            (candidate: IndexMetadataArgs): boolean => {
              return (
                candidate.target === archivable.modelType &&
                Array.isArray(candidate.columns) &&
                candidate.columns.length === 2 &&
                (candidate.columns as Array<string>).includes("projectId") &&
                (candidate.columns as Array<string>).includes("isArchived")
              );
            },
          );

        expect(index).toBeDefined();
        expect(index?.unique).not.toBe(true);
      });
    });

    describe("column access control", () => {
      test("isArchived follows the table: created by its creators, read by its readers, changed by its editors", () => {
        const access: ColumnAccessControl = columnAccess(model, "isArchived");

        expect(sorted(access.create || [])).toEqual(
          sorted(model.getCreatePermissions()),
        );
        expect(sorted(access.read || [])).toEqual(
          sorted(model.getReadPermissions()),
        );
        expect(sorted(access.update || [])).toEqual(
          sorted(model.getUpdatePermissions()),
        );
      });

      test.each(STAMP_COLUMNS)(
        "%s is read-only: readable by the table's readers, written by nobody",
        (column: string) => {
          const access: ColumnAccessControl = columnAccess(model, column);

          expect(access.create || []).toEqual([]);
          expect(access.update || []).toEqual([]);
          expect(sorted(access.read || [])).toEqual(
            sorted(model.getReadPermissions()),
          );
        },
      );

      test("the same contract as a resource that was archivable before (Service)", () => {
        const service: Service = new Service();

        for (const column of ["isArchived", ...STAMP_COLUMNS]) {
          const before: ColumnAccessControl = columnAccess(service, column);
          const now: ColumnAccessControl = columnAccess(model, column);

          expect({
            column,
            createIsOpen: (now.create || []).length > 0,
            updateIsOpen: (now.update || []).length > 0,
          }).toEqual({
            column,
            createIsOpen: (before.create || []).length > 0,
            updateIsOpen: (before.update || []).length > 0,
          });
        }
      });
    });

    describe("against the real permission checks", () => {
      test("the resource's editor may archive and unarchive it", () => {
        expect(
          updateWith(archivable, { isArchived: true }, [
            archivable.editPermission,
          ]),
        ).not.toThrow();
        expect(
          updateWith(archivable, { isArchived: false }, [
            archivable.editPermission,
          ]),
        ).not.toThrow();
      });

      test("a project admin may archive it", () => {
        expect(
          updateWith(archivable, { isArchived: true }, [
            Permission.ProjectAdmin,
          ]),
        ).not.toThrow();
      });

      test.each([["Viewer"], ["the resource's read role"]])(
        "%s may not archive it",
        (label: string) => {
          const permission: Permission =
            label === "Viewer" ? Permission.Viewer : archivable.readPermission;

          expect(
            updateWith(archivable, { isArchived: true }, [permission]),
          ).toThrow(/isArchived/);
        },
      );

      test("nobody can forge who archived it or when, not even a project owner", () => {
        expect(
          updateWith(archivable, { archivedAt: new Date() }, [
            Permission.ProjectOwner,
          ]),
        ).toThrow(/archivedAt/);
        expect(
          updateWith(archivable, { archivedByUserId: USER_ID }, [
            Permission.ProjectOwner,
          ]),
        ).toThrow(/archivedByUserId/);
      });

      test("every reader can see whether it is archived, and who archived it", () => {
        for (const permission of [
          Permission.Viewer,
          archivable.readPermission,
        ]) {
          const readable: Array<string> =
            ColumnPermissions.getModelColumnsByPermissions(
              archivable.modelType,
              userPermissions([permission]),
              DatabaseRequestType.Read,
            ).columns;

          expect(readable).toEqual(
            expect.arrayContaining(["isArchived", ...STAMP_COLUMNS]),
          );
        }
      });

      test("the resource's editor may update it at all (the table check) - archiving needs no new permission", () => {
        expect(
          model.getUpdatePermissions().includes(archivable.editPermission),
        ).toBe(true);
      });

      test("creating it archived is a create of a creatable column, as for every archivable resource", () => {
        const data: BaseModel = new archivable.modelType();
        (data as unknown as Record<string, unknown>)["isArchived"] = true;

        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            archivable.modelType,
            data,
            makeProps([Permission.ProjectOwner]),
            DatabaseRequestType.Create,
          );
        }).not.toThrow();
      });
    });

    test("an export never carries the archive state: an imported copy is never hidden", () => {
      const columns: Array<string> =
        ModelImportExport.getImportExportableColumnNames(archivable.modelType);

      expect(columns).not.toContain("isArchived");
      expect(columns).not.toContain("archivedAt");
      expect(columns).not.toContain("archivedByUserId");
    });

    test(`is the ${archivable.tableName} table`, () => {
      expect(model.tableName).toBe(archivable.tableName);
    });
  },
);

describe("the archive stamps", () => {
  test("are server-stamped from the isArchived write for every archivable model (DatabaseService)", () => {
    /*
     * DatabaseService.sanitizeCreateOrUpdate stamps archivedAt and
     * archivedByUserId only when the model has those columns, so a model
     * missing one would archive without saying when or by whom.
     */
    for (const archivable of ARCHIVABLE_MODELS) {
      const model: BaseModel = new archivable.modelType();

      expect({
        model: archivable.name,
        archivedAt: model.hasColumn("archivedAt"),
        archivedByUserId: model.hasColumn("archivedByUserId"),
      }).toEqual({
        model: archivable.name,
        archivedAt: true,
        archivedByUserId: true,
      });
    }
  });
});
