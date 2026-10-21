import fs from "fs";
import path from "path";
import AnalyticsModels from "../../../../../Models/AnalyticsModels/Index";
import Log from "../../../../../Models/AnalyticsModels/Log";
import DatabaseModels from "../../../../../Models/DatabaseModels/Index";
import PacketCapture from "../../../../../Models/DatabaseModels/PacketCapture";
import AnalyticsModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnRefusalMessage, {
  ColumnOperation,
  NO_PERMISSION_ALLOWS,
  UNNAMED_GRANTS,
} from "../../../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import ColumnWriteRefusedException from "../../../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AnalyticsTableColumn from "../../../../../Types/AnalyticsDatabase/TableColumn";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Every gate is called with its throws asserted on; @CaptureSpan hands each
 * one to the logger, which is kept quiet. Nothing under test is mocked.
 */
jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT A REFUSED COLUMN SAYS, wherever it is refused.
 *
 * A request that writes, reads or filters by a column its caller may not is
 * refused in two sentences (ColumnRefusalMessage): what was refused, in the
 * words clients read, and who may - the column's own list - or, when the
 * list is empty, that no permission allows it. The refusals used to end
 * "You need any one of these permissions:" with nothing after it, and a
 * customer whose packet capture was refused on fileId could not tell a
 * permission an admin can grant from a column nobody may write. This holds
 * every gate to the one wording - create, update, select and query; the
 * Postgres gates and the analytics database's - and every model's lists to
 * permissions a refusal can name.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission" as const,
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      },
    },
  };
}

function refusal(run: () => void): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }

  throw new Error(
    "Expected the gate to refuse, but it let the request through.",
  );
}

const START_TITLES: string =
  "Project Owner, Project Admin, Start Packet Capture";

describe("ColumnRefusalMessage: the words", () => {
  test.each([
    [
      "create",
      "No permission allows it: the column is set by the server, not by a request.",
    ],
    [
      "update",
      "No permission allows it: the column is changed by the server, not by a request.",
    ],
    [
      "select",
      "No permission allows it: the column is not readable through the API.",
    ],
    [
      "query",
      "No permission allows it: the column cannot be filtered on through the API.",
    ],
  ])(
    "a column nobody may %s says so, plainly",
    (operation: string, sentence: string) => {
      expect(
        ColumnRefusalMessage.getWhoMay(operation as ColumnOperation, []),
      ).toBe(sentence);
      expect(NO_PERMISSION_ALLOWS[operation as ColumnOperation]).toBe(sentence);
    },
  );

  test.each(["create", "update", "select", "query"])(
    "a column some may %s names them, in the list's order, as their titles",
    (operation: string) => {
      expect(
        ColumnRefusalMessage.getWhoMay(operation as ColumnOperation, [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.CreatePacketCapture,
        ]),
      ).toBe(`You need one of these permissions: ${START_TITLES}.`);
    },
  );

  test("the grants OneUptime gives by itself are not named: nobody can be given them", () => {
    expect(
      ColumnRefusalMessage.getWhoMay("select", [
        Permission.ProjectOwner,
        Permission.UnAuthorizedSsoUser,
        Permission.AuthenticatedRequest,
      ]),
    ).toBe("You need one of these permissions: Project Owner.");
  });

  test("a permission the catalogue has no title for is still named, never dropped", () => {
    expect(
      ColumnRefusalMessage.getWhoMay("select", [
        "NoSuchPermission" as Permission,
      ]),
    ).toBe("You need one of these permissions: NoSuchPermission.");
  });

  test("the first sentence is the one clients read, word for word", () => {
    expect(
      ColumnRefusalMessage.getSelectRefusal({
        column: "fileId",
        permissions: [],
      }),
    ).toBe(
      "You do not have permissions to select on - fileId. No permission allows it: the column is not readable through the API.",
    );
    expect(
      ColumnRefusalMessage.getQueryRefusal({
        column: "bpfFilter",
        permissions: [Permission.ProjectOwner],
      }),
    ).toBe(
      "You do not have permissions to query on - bpfFilter. You need one of these permissions: Project Owner.",
    );
    expect(
      ColumnRefusalMessage.getWriteRefusal({
        requestType: DatabaseRequestType.Create,
        column: "fileId",
        modelName: "Packet Capture",
        permissions: [],
      }),
    ).toBe(
      "User is not allowed to create on fileId column of Packet Capture. No permission allows it: the column is set by the server, not by a request.",
    );
    expect(
      ColumnRefusalMessage.getWriteRefusal({
        requestType: DatabaseRequestType.Update,
        column: "name",
        modelName: "Packet Capture",
        permissions: [Permission.ProjectAdmin],
      }),
    ).toBe(
      "User is not allowed to update on name column of Packet Capture. You need one of these permissions: Project Admin.",
    );
  });

  test("a write refusal that is not about permissions keeps to its first sentence", () => {
    expect(
      ColumnRefusalMessage.getWriteRefusal({
        requestType: DatabaseRequestType.Create,
        column: "createdIncidentTemplateId",
        modelName: "Incident",
      }),
    ).toBe(
      "User is not allowed to create on createdIncidentTemplateId column of Incident",
    );
  });
});

describe("every gate refuses a column in those words", () => {
  test("create, Postgres: a column nobody may create", () => {
    const error: Error = refusal(() => {
      const record: PacketCapture = new PacketCapture();
      record.fileId = ObjectID.generate();

      ColumnPermissions.checkDataColumnPermissions(
        PacketCapture,
        record,
        caller([Permission.ProjectOwner]),
        DatabaseRequestType.Create,
      );
    });

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect(error.message).toBe(
      `User is not allowed to create on fileId column of Packet Capture. ${NO_PERMISSION_ALLOWS.create}`,
    );
  });

  test("create, Postgres: a column the caller lacks the permission for names who may", () => {
    const error: Error = refusal(() => {
      const record: PacketCapture = new PacketCapture();
      record.bpfFilter = "tcp";

      ColumnPermissions.checkDataColumnPermissions(
        PacketCapture,
        record,
        caller([Permission.ProjectMember]),
        DatabaseRequestType.Create,
      );
    });

    expect(error.message).toBe(
      `User is not allowed to create on bpfFilter column of Packet Capture. You need one of these permissions: ${START_TITLES}.`,
    );
  });

  test("update, Postgres: a column nobody may change", () => {
    const error: Error = refusal(() => {
      ColumnPermissions.checkDataColumnPermissions(
        PacketCapture,
        { bpfFilter: "tcp" } as unknown as PacketCapture,
        caller([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    });

    expect(error).toBeInstanceOf(ColumnWriteRefusedException);
    expect(error.message).toBe(
      `User is not allowed to update on bpfFilter column of Packet Capture. ${NO_PERMISSION_ALLOWS.update}`,
    );
  });

  test("select, Postgres", () => {
    const error: Error = refusal(() => {
      SelectPermission.checkSelectPermission(
        PacketCapture,
        { fileId: true } as never,
        caller([Permission.ProjectOwner]),
      );
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      `You do not have permissions to select on - fileId. ${NO_PERMISSION_ALLOWS.select}`,
    );
  });

  test("query, Postgres", () => {
    const error: Error = refusal(() => {
      QueryPermission.checkQueryPermission(
        PacketCapture,
        { fileId: ObjectID.generate().toString() } as never,
        caller([Permission.ProjectOwner]),
      );
    });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      `You do not have permissions to query on - fileId. ${NO_PERMISSION_ALLOWS.query}`,
    );
  });

  describe("the analytics database's gates", () => {
    type Gate = (...args: Array<unknown>) => void;

    function gate(name: string): Gate {
      const method: Gate = (
        AnalyticsModelPermission as unknown as Record<string, Gate>
      )[name]!;

      return (...args: Array<unknown>): void => {
        method.call(AnalyticsModelPermission, ...args);
      };
    }

    function bodyColumn(): AnalyticsTableColumn {
      return new Log()
        .getTableColumns()
        .find((column: AnalyticsTableColumn): boolean => {
          return column.key === "body";
        })!;
    }

    function titlesOf(permissions: Array<Permission>): string {
      return PermissionHelper.getPermissionTitles(permissions).join(", ");
    }

    test("select names who may read the column", () => {
      const error: Error = refusal(() => {
        gate("checkSelectPermission")(Log, { body: true }, caller([]));
      });

      expect(error.message).toBe(
        `You do not have permissions to select on - body. You need one of these permissions: ${titlesOf(bodyColumn().accessControl!.read)}.`,
      );
    });

    test("query names who may read the column", () => {
      const error: Error = refusal(() => {
        gate("checkQueryPermission")(Log, { body: "x" }, caller([]));
      });

      expect(error.message).toBe(
        `You do not have permissions to query on - body. You need one of these permissions: ${titlesOf(bodyColumn().accessControl!.read)}.`,
      );
    });

    test("a write names who may write the column", () => {
      const log: Log = new Log();
      (log as unknown as Record<string, unknown>)["body"] = "x";

      const error: Error = refusal(() => {
        gate("checkDataColumnPermissions")(
          Log,
          log,
          caller([]),
          DatabaseRequestType.Create,
        );
      });

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect(error.message).toBe(
        `User is not allowed to create on body column of Log. You need one of these permissions: ${titlesOf(bodyColumn().accessControl!.create)}.`,
      );
    });
  });
});

describe("across every model", () => {
  /*
   * A permission without a title in the catalogue is named by its key in a
   * refusal ("You need one of these permissions: SomeKey"): every permission
   * a column list names has one.
   */
  test("every permission a column's create, update or read list names has a title to refuse with, or is a grant nobody is given", () => {
    const untitled: Array<string> = [];
    const onlyUnnamed: Array<string> = [];
    const titled: Set<string> = new Set(
      PermissionHelper.getAllPermissionProps().map(
        (props: { permission: Permission }): string => {
          return props.permission;
        },
      ),
    );

    const check: (
      where: string,
      access: ColumnAccessControl | undefined | null,
    ) => void = (
      where: string,
      access: ColumnAccessControl | undefined | null,
    ): void => {
      for (const list of ["create", "update", "read"] as const) {
        const permissions: Array<Permission> = access?.[list] || [];

        for (const permission of permissions) {
          if (!titled.has(permission) && !UNNAMED_GRANTS.includes(permission)) {
            untitled.push(`${where} ${list}: ${permission}`);
          }
        }

        // A refusal names someone: never a list of grants nobody is given alone.
        if (
          permissions.length > 0 &&
          permissions.every((permission: Permission): boolean => {
            return UNNAMED_GRANTS.includes(permission);
          })
        ) {
          onlyUnnamed.push(`${where} ${list}`);
        }
      }
    };

    let columns: number = 0;

    for (const modelType of DatabaseModels) {
      const model: InstanceType<typeof modelType> = new modelType();
      const access: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();

      for (const [column, columnAccess] of Object.entries(access)) {
        columns++;
        check(`${model.tableName}.${column}`, columnAccess);
      }
    }

    for (const modelType of AnalyticsModels) {
      const model: InstanceType<typeof modelType> = new modelType();

      for (const column of model.getTableColumns()) {
        columns++;
        check(`${model.tableName}.${column.key}`, column.accessControl);
      }
    }

    expect(columns).toBeGreaterThan(5000);
    expect(untitled).toEqual([]);
    expect(onlyUnnamed).toEqual([]);
  });

  test("the grants nobody is given are the ones without a title", () => {
    const titled: Set<string> = new Set(
      PermissionHelper.getAllPermissionProps().map(
        (props: { permission: Permission }): string => {
          return props.permission;
        },
      ),
    );

    for (const grant of UNNAMED_GRANTS) {
      expect([grant, titled.has(grant)]).toEqual([grant, false]);
    }
  });
});

describe("one place words a column refusal", () => {
  const PERMISSIONS_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../../Server/Types/Database/Permissions",
  );
  const ANALYTICS_PERMISSION: string = path.resolve(
    __dirname,
    "../../../../../Server/Types/AnalyticsDatabase/ModelPermission.ts",
  );

  // Phrases only ColumnRefusalMessage writes.
  const PHRASES: Array<string> = [
    "You need any one of these permissions",
    "permissions to select on - ${",
    "permissions to query on - ${",
    "User is not allowed to ${",
  ];

  /*
   * Gates whose refusal names something other than a column, with why.
   * Keyed "<file>: <phrase>".
   */
  const NOT_COLUMN_REFUSALS: Record<string, string> = {
    "UserPermission.ts: permissions to query on - ${":
      "Refuses a query of the User table itself by a request with no signed-in user: it names the table, not a column.",
  };

  test("no gate words its own: they all ask ColumnRefusalMessage", () => {
    const files: Array<string> = [
      ...fs
        .readdirSync(PERMISSIONS_DIRECTORY)
        .filter((file: string): boolean => {
          return file.endsWith(".ts") && file !== "ColumnRefusalMessage.ts";
        })
        .map((file: string): string => {
          return path.join(PERMISSIONS_DIRECTORY, file);
        }),
      ANALYTICS_PERMISSION,
    ];

    expect(files.length).toBeGreaterThan(10);

    const worded: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const phrase of PHRASES) {
        if (source.indexOf(phrase) !== -1) {
          worded.push(`${path.basename(file)}: ${phrase}`);
        }
      }
    }

    expect(
      worded.filter((found: string): boolean => {
        return !NOT_COLUMN_REFUSALS[found];
      }),
    ).toEqual([]);

    // Each exception is still there to explain.
    for (const exception of Object.keys(NOT_COLUMN_REFUSALS)) {
      expect([exception, worded.includes(exception)]).toEqual([
        exception,
        true,
      ]);
    }
  });

  test("and ColumnRefusalMessage is where they are", () => {
    const source: string = fs.readFileSync(
      path.join(PERMISSIONS_DIRECTORY, "ColumnRefusalMessage.ts"),
      "utf8",
    );

    for (const phrase of PHRASES.slice(1)) {
      expect([phrase, source.indexOf(phrase) !== -1]).toEqual([phrase, true]);
    }
  });
});
