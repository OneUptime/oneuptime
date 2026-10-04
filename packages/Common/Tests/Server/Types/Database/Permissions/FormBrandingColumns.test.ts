import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import File from "../../../../../Models/DatabaseModels/File";
import Form from "../../../../../Models/DatabaseModels/Form";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { FORM_BRANDING_COLUMNS } from "../../../../../Types/Form/FormBranding";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Who may set and see a form's branding - its logo, the logo's alt text and
 * its favicon - through the API, the dashboard and Terraform: exactly who
 * may set and see the rest of the form. Owners, admins and Edit Form change
 * it; everyone who can read forms (and so their links) sees it; the plan
 * that includes forms includes it. Nothing here is a second, looser door to
 * a form, and nothing a stranger can reach: the public page gets the images
 * only inside the form's own public read (FormBrandingPublicRoutes.test.ts).
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

/*
 * What the Build page's Branding section and its preview read, copied out
 * of App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/
 * FormBrandingValues.ts (FORM_BRANDING_SELECT). Kept as a literal, so a
 * change to the section that the models do not allow surfaces here.
 */
const BRANDING_SELECT: Select<Form> = {
  logoAltText: true,
  logoFile: {
    _id: true,
    file: true,
    fileType: true,
    name: true,
  },
  faviconFile: {
    _id: true,
    file: true,
    fileType: true,
    name: true,
  },
} as Select<Form>;

const FORM_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.ScheduledMaintenanceViewer,
  Permission.ReadForm,
];

const form: Form = new Form();

function accessOf(column: string): ColumnAccessControl {
  return form.getColumnAccessControlFor(column) as ColumnAccessControl;
}

function sorted(permissions: Array<Permission>): Array<Permission> {
  return [...permissions].sort();
}

describe("Form branding columns - who may set and see them", () => {
  it("are columns of the form, the images relations to Files", () => {
    for (const column of FORM_BRANDING_COLUMNS) {
      expect({ column, has: form.hasColumn(column) }).toEqual({
        column,
        has: true,
      });
    }

    for (const relation of ["logoFile", "faviconFile"]) {
      const metadata: { type?: TableColumnType; modelType?: unknown } =
        form.getTableColumnMetadata(relation);

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBe(File);
      expect(form.isFileColumn(relation)).toBe(true);
    }

    expect(
      form.getTableColumnMetadata("logoFile").manyToOneRelationColumn,
    ).toBe("logoFileId");
    expect(
      form.getTableColumnMetadata("faviconFile").manyToOneRelationColumn,
    ).toBe("faviconFileId");
    expect(form.getTableColumnMetadata("logoAltText").type).toBe(
      TableColumnType.ShortText,
    );
  });

  it("are set, changed and read by exactly who sets, changes and reads the form's name", () => {
    const name: ColumnAccessControl = accessOf("name");

    for (const column of FORM_BRANDING_COLUMNS) {
      const access: ColumnAccessControl = accessOf(column);

      expect({ column, create: sorted(access.create) }).toEqual({
        column,
        create: sorted(name.create),
      });
      expect({ column, read: sorted(access.read) }).toEqual({
        column,
        read: sorted(name.read),
      });
      expect({ column, update: sorted(access.update) }).toEqual({
        column,
        update: sorted(name.update),
      });
    }
  });

  it("owners, admins and Edit Form change them; Read Form and members only see them", () => {
    for (const column of FORM_BRANDING_COLUMNS) {
      for (const permission of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditForm,
      ]) {
        expect({
          column,
          permission,
          canUpdate: form.hasUpdatePermissions([permission], column),
        }).toEqual({ column, permission, canUpdate: true });
      }

      for (const permission of [
        Permission.ReadForm,
        Permission.ProjectMember,
        Permission.IncidentAdmin,
        Permission.Viewer,
      ]) {
        expect({
          column,
          permission,
          canUpdate: form.hasUpdatePermissions([permission], column),
          canRead: form.hasReadPermissions([permission], column),
        }).toEqual({ column, permission, canUpdate: false, canRead: true });
      }

      expect(
        form.hasReadPermissions([Permission.ReadFormSubmission], column),
      ).toBe(false);
    }
  });

  it("need no plan beyond the one that includes forms", () => {
    expect(form.getReadBillingPlan()).toBe(PlanType.Growth);
    expect(form.getUpdateBillingPlan()).toBe(PlanType.Growth);

    for (const column of FORM_BRANDING_COLUMNS) {
      expect({
        column,
        billing: form.getColumnBillingAccessControl(column) || null,
      }).toEqual({ column, billing: null });
    }
  });

  it("are documented for the API reference and Terraform", () => {
    for (const column of FORM_BRANDING_COLUMNS) {
      const metadata: { title?: string; description?: string } =
        form.getTableColumnMetadata(column);

      expect(metadata.title?.length || 0).toBeGreaterThan(0);
      expect(metadata.description?.length || 0).toBeGreaterThan(40);
    }

    expect(form.getTableColumnMetadata("logoFileId").description).toContain(
      "OneUptime logo",
    );
    expect(form.getTableColumnMetadata("faviconFileId").description).toContain(
      "OneUptime favicon",
    );
  });

  it("deleting an image's file only takes it off the form", () => {
    const relations: Array<RelationMetadataArgs> =
      getMetadataArgsStorage().relations.filter(
        (relation: RelationMetadataArgs) => {
          return (
            relation.target === Form &&
            ["logoFile", "faviconFile"].includes(relation.propertyName)
          );
        },
      );

    expect(
      relations
        .map((relation: RelationMetadataArgs) => {
          return [
            relation.propertyName,
            relation.relationType,
            relation.options.onDelete,
            relation.options.nullable,
          ];
        })
        .sort(),
    ).toEqual([
      ["faviconFile", "many-to-one", "SET NULL", true],
      ["logoFile", "many-to-one", "SET NULL", true],
    ]);
  });
});

describe("Form branding columns - the dashboard's read", () => {
  it("lets every form reader read the images through the form", () => {
    for (const permission of FORM_READERS) {
      expect(() => {
        return QueryPermission.checkRelationQueryPermission(
          Form,
          {} as Query<Form>,
          BRANDING_SELECT,
          makeProps([permission]),
        );
      }).not.toThrow();
    }
  });

  it("refuses a deep relation through an image", () => {
    expect(() => {
      return QueryPermission.checkRelationQueryPermission(
        Form,
        {} as Query<Form>,
        {
          logoFile: {
            file: { anything: true },
          },
        } as unknown as Select<Form>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow(BadDataException);
  });
});
