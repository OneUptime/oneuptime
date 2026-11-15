import IncomingRequestSecret from "../../../Models/DatabaseModels/IncomingRequestSecret";
import Project from "../../../Models/DatabaseModels/Project";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may see and change a project's incoming request secrets, and the
 * switch that requires them (issue #7526).
 *
 * The requirement exists so the people who run a project can secure every
 * monitor's URL, whoever configures the monitors. So:
 *   - owners and admins alone create, read, change and delete the secrets: a
 *     member who could read them could hand them out, and one who could
 *     delete them could undo the requirement;
 *   - a secret's value is encrypted at rest, never changed in place, and a
 *     secret to the API (Terraform and the clients keep it out of what they
 *     print);
 *   - lastUsedAt is written only by the ingest path;
 *   - everyone in the project reads the switch, so a monitor's page can tell
 *     whoever wires up a sender that it needs a secret; only owners and admins
 *     turn it.
 */

const OWNERS_AND_ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const secret: IncomingRequestSecret = new IncomingRequestSecret();

const access: (column: string) => ColumnAccessControl = (
  column: string,
): ColumnAccessControl => {
  const control: ColumnAccessControl | null =
    secret.getColumnAccessControlFor(column);

  expect(control).not.toBeNull();

  return control!;
};

describe("IncomingRequestSecret", () => {
  test("only owners and admins create, read, change or delete a secret", () => {
    expect(secret.createRecordPermissions).toEqual(OWNERS_AND_ADMINS);
    expect(secret.readRecordPermissions).toEqual(OWNERS_AND_ADMINS);
    expect(secret.updateRecordPermissions).toEqual(OWNERS_AND_ADMINS);
    expect(secret.deleteRecordPermissions).toEqual(OWNERS_AND_ADMINS);
  });

  test("belongs to a project, and is served at its own API route", () => {
    expect(secret.tenantColumn).toBe("projectId");
    expect(secret.crudApiPath?.toString()).toBe("/incoming-request-secret");
    expect(secret.enableDocumentation).toBe(true);
  });

  test("the value is encrypted, read by owners and admins, and never changed in place", () => {
    const metadata: TableColumnMetadata =
      secret.getTableColumnMetadata("secretValue");

    expect(metadata.encrypted).toBe(true);
    expect(metadata.required).toBe(false);
    expect(ModelSchema.isSecretColumn(metadata)).toBe(true);

    expect(access("secretValue").create).toEqual(OWNERS_AND_ADMINS);
    expect(access("secretValue").read).toEqual(OWNERS_AND_ADMINS);
    expect(access("secretValue").update).toEqual([]);
  });

  test("the name can be changed by owners and admins", () => {
    expect(secret.getTableColumnMetadata("name").required).toBe(true);
    expect(access("name").update).toEqual(OWNERS_AND_ADMINS);
  });

  test("lastUsedAt is written only by the ingest path", () => {
    expect(access("lastUsedAt").create).toEqual([]);
    expect(access("lastUsedAt").update).toEqual([]);
    expect(access("lastUsedAt").read).toEqual(OWNERS_AND_ADMINS);
  });

  test("no column is readable by anyone but owners and admins", () => {
    const readableByOthers: Array<string> = [];

    for (const [column, control] of Object.entries(
      secret.getColumnAccessControlForAllColumns(),
    )) {
      for (const permission of control.read) {
        if (!OWNERS_AND_ADMINS.includes(permission)) {
          readableByOthers.push(`${column}: ${permission}`);
        }
      }
    }

    expect(readableByOthers).toEqual([]);
  });
});

describe("Project.requireIncomingRequestSecret", () => {
  const project: Project = new Project();

  const control: ColumnAccessControl | null = project.getColumnAccessControlFor(
    "requireIncomingRequestSecret",
  );

  test("is off by default", () => {
    expect(
      project.getTableColumnMetadata("requireIncomingRequestSecret"),
    ).toMatchObject({ defaultValue: false, required: false });
  });

  test("everyone in the project reads it", () => {
    expect(control?.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadProject,
      ]),
    );
  });

  test("only owners and admins turn it, and nobody sets it on create", () => {
    expect(control?.update).toEqual(OWNERS_AND_ADMINS);
    expect(control?.create).toEqual([]);
  });
});
