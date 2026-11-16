import IncomingRequestSecret from "../../../Models/DatabaseModels/IncomingRequestSecret";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { IncomingRequestSecretProblem } from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import Permission from "../../../Types/Permission";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may see and change a project's incoming request secrets, and the
 * switch that requires them (issue #7526).
 *
 * The requirement exists so the people who run a project can secure every
 * monitor's URL, whoever configures the monitors. So:
 *   - owners and admins create, read, change and delete the secrets, and so
 *     does a custom role given the Incoming Request Secret permission for
 *     each (issue #8502) - and no other role: a member who could read them
 *     could hand them out, and one who could delete them could undo the
 *     requirement;
 *   - a secret's value is encrypted at rest, never changed in place, and a
 *     secret to the API (Terraform and the clients keep it out of what they
 *     print);
 *   - which monitors a secret covers (issue #8501) is set on create and
 *     changed by the same people;
 *   - lastUsedAt is written only by the ingest path;
 *   - everyone in the project reads the switch, so a monitor's page can tell
 *     whoever wires up a sender that it needs a secret; only those who edit
 *     the secrets turn it;
 *   - a monitor's record of requests with and without a secret (issue #8498)
 *     is read by whoever reads the monitor's latest request, and written by
 *     the ingest path alone: nobody can make a monitor look fixed.
 */

const OWNERS_AND_ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const CREATORS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.CreateIncomingRequestSecret,
];
const READERS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.ReadIncomingRequestSecret,
];
const EDITORS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.EditIncomingRequestSecret,
];
const DELETERS: Array<Permission> = [
  ...OWNERS_AND_ADMINS,
  Permission.DeleteIncomingRequestSecret,
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
  test("owners, admins and a role given each dedicated permission create, read, change or delete a secret", () => {
    expect(secret.createRecordPermissions).toEqual(CREATORS);
    expect(secret.readRecordPermissions).toEqual(READERS);
    expect(secret.updateRecordPermissions).toEqual(EDITORS);
    expect(secret.deleteRecordPermissions).toEqual(DELETERS);
  });

  test("which monitors a secret covers is set on create and changed by its editors, read with it", () => {
    for (const column of ["monitorAccess", "monitors", "labels"]) {
      expect({ column, access: access(column) }).toEqual({
        column,
        access: { create: CREATORS, read: READERS, update: EDITORS },
      });
    }

    expect(secret.getTableColumnMetadata("monitorAccess")).toMatchObject({
      required: true,
      isDefaultValueColumn: true,
      defaultValue: MonitorSecretAccess.AllMonitors,
      allowedValues: Object.values(MonitorSecretAccess),
    });
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

    expect(access("secretValue").create).toEqual(CREATORS);
    expect(access("secretValue").read).toEqual(READERS);
    expect(access("secretValue").update).toEqual([]);
  });

  test("the name can be changed by its editors", () => {
    expect(secret.getTableColumnMetadata("name").required).toBe(true);
    expect(access("name").update).toEqual(EDITORS);
  });

  test("lastUsedAt is written only by the ingest path", () => {
    expect(access("lastUsedAt").create).toEqual([]);
    expect(access("lastUsedAt").update).toEqual([]);
    expect(access("lastUsedAt").read).toEqual(READERS);
  });

  test("no column is readable by anyone but owners, admins and Read Incoming Request Secret", () => {
    const readableByOthers: Array<string> = [];

    for (const [column, control] of Object.entries(
      secret.getColumnAccessControlForAllColumns(),
    )) {
      for (const permission of control.read) {
        if (!READERS.includes(permission)) {
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

  test("those who edit the secrets turn it, and nobody sets it on create", () => {
    expect(control?.update).toEqual(EDITORS);
    expect(control?.create).toEqual([]);
  });

  test("the project's own update list lets Edit Incoming Request Secret through, for this column alone", () => {
    expect(project.getUpdatePermissions()).toContain(
      Permission.EditIncomingRequestSecret,
    );

    const otherColumns: Array<string> = [];

    // Every model's own columns take the table's lists, for every role alike.
    const BASE_COLUMNS: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ];

    for (const [column, columnControl] of Object.entries(
      project.getColumnAccessControlForAllColumns(),
    )) {
      if (
        column !== "requireIncomingRequestSecret" &&
        !BASE_COLUMNS.includes(column) &&
        (columnControl.update || []).includes(
          Permission.EditIncomingRequestSecret,
        )
      ) {
        otherColumns.push(column);
      }
    }

    expect(otherColumns).toEqual([]);
  });
});

describe("Monitor's record of requests with and without a secret", () => {
  const monitor: Monitor = new Monitor();

  const COLUMNS: Array<string> = [
    "incomingRequestWithSecretAt",
    "incomingRequestWithoutSecretAt",
    "incomingRequestWithoutSecretReason",
  ];

  // Whoever reads the monitor's latest request.
  const latestRequestReaders: Array<Permission> =
    monitor.getColumnAccessControlFor("incomingMonitorRequest")?.read || [];

  test.each(COLUMNS)(
    "%s is read by whoever reads the monitor's latest request",
    (column: string) => {
      expect(latestRequestReaders.length).toBeGreaterThan(0);
      expect(
        [...(monitor.getColumnAccessControlFor(column)?.read || [])].sort(),
      ).toEqual([...latestRequestReaders].sort());
    },
  );

  test.each(COLUMNS)(
    "%s is written by the ingest path alone, never through the API",
    (column: string) => {
      const control: ColumnAccessControl | null =
        monitor.getColumnAccessControlFor(column);

      expect(control?.create).toEqual([]);
      expect(control?.update).toEqual([]);
    },
  );

  test.each(COLUMNS)("%s is empty until a request comes", (column: string) => {
    expect(monitor.getTableColumnMetadata(column)).toMatchObject({
      required: false,
    });
  });

  test("the reason is one the code stores", () => {
    expect(
      monitor.getTableColumnMetadata("incomingRequestWithoutSecretReason")
        .allowedValues,
    ).toEqual(Object.values(IncomingRequestSecretProblem));
    expect(Object.values(IncomingRequestSecretProblem)).toEqual([
      "No Secret",
      "Wrong Secret",
      "Secret Not For Monitor",
      "Expired Signature",
    ]);
  });
});
