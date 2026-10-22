import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * IncidentPostmortemStatus: how far an incident's postmortem has come, and
 * Incident.postmortemStatus, the status each incident's postmortem is in.
 *
 *   - a project's own list, managed like the incident states are: the same
 *     roles, the same plans, drag-ordered within the project, archivable,
 *     in the audit log, the API, Terraform, workflows and MCP;
 *   - three built-in flags OneUptime moves postmortems into, read wherever
 *     a status is read through a record;
 *   - on the incident, a reference anyone who reads the incident reads, and
 *     whoever may write its postmortem may set - optional, so a create may
 *     leave it out for the server to fill in.
 */

const sorted: (permissions: Array<Permission> | undefined) => Array<string> = (
  permissions: Array<Permission> | undefined,
): Array<string> => {
  return [...(permissions || [])].map(String).sort();
};

describe("IncidentPostmortemStatus", () => {
  const model: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  const state: IncidentState = new IncidentState();

  it("is registered, so its table is created and served", () => {
    expect(
      Models.some((registered: { new (): BaseModel }) => {
        return registered === IncidentPostmortemStatus;
      }),
    ).toBe(true);
    expect(model.tableName).toBe("IncidentPostmortemStatus");
    expect(model.singularName).toBe("Postmortem Status");
    expect(model.pluralName).toBe("Postmortem Statuses");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/incident-postmortem-status",
    );
    expect(model.getTenantColumn()).toBe("projectId");
  });

  it("is managed by whoever manages incident states, through permissions of its own", () => {
    const swap: (permissions: Array<Permission>) => Array<string> = (
      permissions: Array<Permission>,
    ): Array<string> => {
      return sorted(
        permissions.map((permission: Permission): Permission => {
          const name: string = String(permission);

          if (name.endsWith("IncidentState")) {
            return name.replace(
              "IncidentState",
              "IncidentPostmortemStatus",
            ) as Permission;
          }

          return permission;
        }),
      );
    };

    expect(sorted(model.getCreatePermissions())).toEqual(
      swap(state.getCreatePermissions()),
    );
    expect(sorted(model.getReadPermissions())).toEqual(
      swap(state.getReadPermissions()),
    );
    expect(sorted(model.getUpdatePermissions())).toEqual(
      swap(state.getUpdatePermissions()),
    );
    expect(sorted(model.getDeletePermissions())).toEqual(
      swap(state.getDeletePermissions()),
    );
  });

  it("names its four permissions in the catalogue, under Incident, assignable to a team", () => {
    for (const permission of [
      Permission.CreateIncidentPostmortemStatus,
      Permission.ReadIncidentPostmortemStatus,
      Permission.EditIncidentPostmortemStatus,
      Permission.DeleteIncidentPostmortemStatus,
    ]) {
      const props: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (candidate: PermissionProps): boolean => {
            return candidate.permission === permission;
          },
        );

      expect(props).toBeDefined();
      expect(props!.title).toMatch(/Postmortem Status$/);
      expect(props!.isAssignableToTenant).toBe(true);
      expect(props!.group).toBe(PermissionGroup.Incident);
      expect(PermissionHelper.getDescription(permission)).toMatch(
        /postmortem statuses of this project\.$/,
      );
    }
  });

  it("is read on every plan, and made or changed from Growth, as incident states are", () => {
    expect(model.getReadBillingPlan()).toBe(state.getReadBillingPlan());
    expect(model.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(model.getUpdateBillingPlan()).toBe(PlanType.Growth);
    expect(model.getDeleteBillingPlan()).toBe(state.getDeleteBillingPlan());
  });

  it("is a drag-ordered list within its project", () => {
    const listOrder: ListOrderSettings | null = model.getListOrder();

    expect(listOrder).toEqual({
      column: "order",
      scopeColumns: ["projectId"],
      sortOrder: SortOrder.Ascending,
    });
  });

  it("is in the audit log, the API reference, workflows and MCP", () => {
    expect(model.enableAuditLogOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
    });
    expect(model.enableDocumentation).toBe(true);
    expect(model.enableMCP).toBe(true);
    expect(model.enableWorkflowOn).toMatchObject({
      create: true,
      update: true,
      delete: true,
      read: true,
    });
  });

  it.each(["isNotStartedStatus", "isDraftStatus", "isCompletedStatus"])(
    "%s is a switch read through a record, edited like the name",
    (column: string) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect(metadata.canReadOnRelationQuery).toBe(true);
      expect(metadata.description).toMatch(/can't be deleted or archived\.$/);

      const flag: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);
      const name: ColumnAccessControl | null =
        model.getColumnAccessControlFor("name");

      expect(sorted(flag?.update)).toEqual(sorted(name?.update));
      expect(sorted(flag?.read)).toEqual(sorted(name?.read));
    },
  );

  it("names are unique within a project, and read with the colour through a record", () => {
    expect(model.getTableColumnMetadata("name").canReadOnRelationQuery).toBe(
      true,
    );
    expect(model.getTableColumnMetadata("color").canReadOnRelationQuery).toBe(
      true,
    );
    expect(model.getTableColumnMetadata("color").required).toBe(true);
    expect(model.getTableColumnMetadata("name").required).toBe(true);
  });
});

describe("Incident.postmortemStatus", () => {
  const incident: Incident = new Incident();

  it("is a relation to the project's postmortem statuses, by its id column", () => {
    const relation: TableColumnMetadata =
      incident.getTableColumnMetadata("postmortemStatus");

    expect(relation.type).toBe(TableColumnType.Entity);
    expect(relation.modelType).toBe(IncidentPostmortemStatus);
    expect(relation.manyToOneRelationColumn).toBe("postmortemStatusId");

    const idColumn: TableColumnMetadata =
      incident.getTableColumnMetadata("postmortemStatusId");

    expect(idColumn.type).toBe(TableColumnType.ObjectID);
    expect(idColumn.canReadOnRelationQuery).toBe(true);
  });

  it("is optional on create, with no default: the server fills it in", () => {
    const idColumn: TableColumnMetadata =
      incident.getTableColumnMetadata("postmortemStatusId");

    expect(idColumn.required).toBeFalsy();
    expect(idColumn.defaultValue).toBeUndefined();
    expect(idColumn.isDefaultValueColumn).toBeFalsy();
  });

  it.each(["postmortemStatus", "postmortemStatusId"])(
    "%s is read and written by whoever reads and writes the postmortem's note",
    (column: string) => {
      const access: ColumnAccessControl | null =
        incident.getColumnAccessControlFor(column);
      const note: ColumnAccessControl | null =
        incident.getColumnAccessControlFor("postmortemNote");

      expect(sorted(access?.read)).toEqual(sorted(note?.read));
      expect(sorted(access?.create)).toEqual(sorted(note?.create));
      expect(sorted(access?.update)).toEqual(sorted(note?.update));
    },
  );

  it("refuses the delete of a status incidents are in: archive it instead", () => {
    const relation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === Incident &&
            candidate.propertyName === "postmortemStatus"
          );
        },
      );

    expect(relation).toBeDefined();
    // No ON DELETE: the database refuses it while an incident points at it.
    expect(relation!.options.onDelete).toBeUndefined();
    expect(relation!.options.nullable).toBe(true);
  });
});
