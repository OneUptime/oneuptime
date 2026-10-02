import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import DeletePermission from "../../../Server/Types/Database/Permissions/DeletePermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ReadPermission from "../../../Server/Types/Database/Permissions/ReadPermission";
import UpdatePermission from "../../../Server/Types/Database/Permissions/UpdatePermission";
import Log from "../../../Models/AnalyticsModels/Log";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Color from "../../../Types/Color";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every refusal below is deliberate, but @CaptureSpan hands each one to
 * Telemetry, which logs the whole stack.
 */
jest.mock("../../../Server/Utils/Logger");

/*
 * A READ-ONLY CREDENTIAL CANNOT WRITE, WHOEVER HOLDS IT
 *
 * An MCP client its user authorized as read-only reaches the API with the
 * user's own permissions - which may well include ProjectOwner - plus one
 * flag, `isReadOnlyCredential`. The MCP server already refuses its write
 * tools; this is the API keeping the same promise, so that it does not rest
 * on every tool being classified correctly.
 *
 * Three things are pinned:
 *
 *   1. the rule itself (assertCredentialCanWrite);
 *   2. that EVERY write entry point of both permission layers - Postgres and
 *      ClickHouse - applies it, ahead of the caller's permissions, while
 *      reads are left alone;
 *   3. that a write entry point added later cannot forget it (the scan at
 *      the bottom fails until the new method is classified).
 */

const READ_ONLY_MESSAGE: string =
  "This MCP client was connected with read-only access, so it cannot make changes. Connect it again and allow read and write access.";

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const labelId: ObjectID = ObjectID.generate();

function propsFor(
  permissions: Array<Permission>,
  extra: DatabaseCommonInteractionProps = {},
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
    // So that a plan gate is never what refuses, with billing on or off.
    currentPlan: PlanType.Scale,
    isSubscriptionUnpaid: false,
    ...extra,
  };
}

// A project owner: allowed to create, update and delete a Label.
function ownerProps(
  extra: DatabaseCommonInteractionProps = {},
): DatabaseCommonInteractionProps {
  return propsFor([Permission.ProjectOwner], extra);
}

function readOnlyOwnerProps(): DatabaseCommonInteractionProps {
  return ownerProps({ isReadOnlyCredential: true });
}

function newLabel(): Label {
  const label: Label = new Label();

  label.projectId = projectId;
  label.name = "production";
  label.color = new Color("#000000");

  return label;
}

function existingLabel(): Label {
  const label: Label = newLabel();

  label._id = labelId.toString();

  return label;
}

async function rejectionOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  return undefined;
}

/*
 * Tenant scoping names its SQL parameter at random, so two otherwise
 * identical scoped queries differ in that one generated name.
 */
const GENERATED_PARAMETER_NAME_PATTERN: RegExp =
  /"_objectLiteralParameters":\{"[A-Za-z]+":/g;

function comparable(result: unknown): string {
  return JSON.stringify(result).replace(
    GENERATED_PARAMETER_NAME_PATTERN,
    '"_objectLiteralParameters":{"parameter":',
  );
}

function expectReadOnlyRefusal(error: unknown): void {
  expect(error).toBeInstanceOf(NotAuthorizedException);
  expect((error as Exception).message).toBe(READ_ONLY_MESSAGE);
  expect((error as Exception).code).toBe(ExceptionCode.NotAuthorizedException);
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite", () => {
  test("refuses a read-only credential", () => {
    expect(() => {
      return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite({
        isReadOnlyCredential: true,
      });
    }).toThrow(NotAuthorizedException);
  });

  test("says why, and what to do about it", () => {
    expect(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    ).toBe(READ_ONLY_MESSAGE);

    expect(() => {
      return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite({
        isReadOnlyCredential: true,
      });
    }).toThrow(READ_ONLY_MESSAGE);
  });

  test("is a 'not authorized' refusal, not a 'not authenticated' one", () => {
    /*
     * A 401 would make a browser client refresh its session and replay the
     * request; the caller here is identified, and replaying changes nothing.
     */
    let thrown: unknown = undefined;

    try {
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite({
        isReadOnlyCredential: true,
      });
    } catch (error) {
      thrown = error;
    }

    expectReadOnlyRefusal(thrown);
    expect((thrown as Exception).code).not.toBe(
      ExceptionCode.NotAuthenticatedException,
    );
  });

  test("refuses whatever the caller's permissions are", () => {
    const callers: Array<DatabaseCommonInteractionProps> = [
      readOnlyOwnerProps(),
      propsFor([Permission.ProjectAdmin], { isReadOnlyCredential: true }),
      propsFor([Permission.ProjectMember], { isReadOnlyCredential: true }),
      propsFor([Permission.Viewer], { isReadOnlyCredential: true }),
      { isReadOnlyCredential: true, userType: UserType.API },
      { isReadOnlyCredential: true, userType: UserType.MasterAdmin },
      { isReadOnlyCredential: true, isMasterAdmin: true },
    ];

    for (const props of callers) {
      expect(() => {
        return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(
          props,
        );
      }).toThrow(READ_ONLY_MESSAGE);
    }
  });

  test("allows a credential that is not marked read-only", () => {
    const callers: Array<DatabaseCommonInteractionProps> = [
      {},
      ownerProps(),
      ownerProps({ isReadOnlyCredential: false }),
      ownerProps({ isReadOnlyCredential: undefined }),
      { userType: UserType.API, tenantId: projectId },
    ];

    for (const props of callers) {
      expect(() => {
        return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(
          props,
        );
      }).not.toThrow();
    }
  });

  test("lets root through even when the credential is read-only: those are the server's own writes", () => {
    expect(() => {
      return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite({
        isRoot: true,
        isReadOnlyCredential: true,
      });
    }).not.toThrow();

    expect(() => {
      return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(
        ownerProps({ isRoot: true, isReadOnlyCredential: true }),
      );
    }).not.toThrow();
  });

  test("being a master admin is not being root: a read-only master admin is still refused", () => {
    expect(() => {
      return DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite({
        isMasterAdmin: true,
        isRoot: false,
        isReadOnlyCredential: true,
      });
    }).toThrow(READ_ONLY_MESSAGE);
  });

  test("returns nothing and leaves the props untouched", () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const before: string = JSON.stringify(props);

    expect(
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props),
    ).toBeUndefined();
    expect(JSON.stringify(props)).toBe(before);
  });
});

interface WriteEntryPoint {
  name: string;
  // Spies on the Create/Update/Delete check the entry point delegates to.
  spyOnUnderlying: () => jest.SpyInstance<any, any>;
  // Calls the entry point; a synchronous throw becomes a rejection.
  call: (
    props: DatabaseCommonInteractionProps,
    fetchModel?: () => Promise<Label | null>,
  ) => Promise<unknown>;
}

const fetchExistingLabel: () => Promise<Label | null> =
  async (): Promise<Label | null> => {
    return existingLabel();
  };

const POSTGRES_WRITE_ENTRY_POINTS: Array<WriteEntryPoint> = [
  {
    name: "checkCreatePermissions",
    spyOnUnderlying: (): jest.SpyInstance<any, any> => {
      return getJestSpyOn(CreatePermission, "checkCreatePermissions");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return ModelPermission.checkCreatePermissions(Label, newLabel(), props);
    },
  },
  {
    name: "checkUpdateQueryPermissions",
    spyOnUnderlying: (): jest.SpyInstance<any, any> => {
      return getJestSpyOn(UpdatePermission, "checkUpdatePermissions");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkUpdateQueryPermissions(
        Label,
        { _id: labelId.toString(), projectId },
        { name: "renamed" },
        props,
      );
    },
  },
  {
    name: "checkUpdatePermissionByModel",
    spyOnUnderlying: (): jest.SpyInstance<any, any> => {
      return getJestSpyOn(UpdatePermission, "checkUpdatePermissionByModel");
    },
    call: async (
      props: DatabaseCommonInteractionProps,
      fetchModel: () => Promise<Label | null> = fetchExistingLabel,
    ): Promise<unknown> => {
      return await ModelPermission.checkUpdatePermissionByModel({
        modelType: Label,
        fetchModelWithAccessControlIds: fetchModel,
        props,
      });
    },
  },
  {
    name: "checkDeleteQueryPermission",
    spyOnUnderlying: (): jest.SpyInstance<any, any> => {
      return getJestSpyOn(DeletePermission, "checkDeletePermission");
    },
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await ModelPermission.checkDeleteQueryPermission(
        Label,
        { _id: labelId.toString(), projectId },
        props,
      );
    },
  },
  {
    name: "checkDeletePermissionByModel",
    spyOnUnderlying: (): jest.SpyInstance<any, any> => {
      return getJestSpyOn(DeletePermission, "checkDeletePermissionByModel");
    },
    call: async (
      props: DatabaseCommonInteractionProps,
      fetchModel: () => Promise<Label | null> = fetchExistingLabel,
    ): Promise<unknown> => {
      return await ModelPermission.checkDeletePermissionByModel({
        modelType: Label,
        fetchModelWithAccessControlIds: fetchModel,
        props,
      });
    },
  },
];

function postgresEntryPoints(): Array<[string, WriteEntryPoint]> {
  return POSTGRES_WRITE_ENTRY_POINTS.map(
    (entryPoint: WriteEntryPoint): [string, WriteEntryPoint] => {
      return [entryPoint.name, entryPoint];
    },
  );
}

describe("the Postgres permission layer (ModelPermission)", () => {
  describe("run for real, against a project owner", () => {
    test.each(postgresEntryPoints())(
      "%s lets a project owner write (the control)",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        expect(
          await rejectionOf((): Promise<unknown> => {
            return entryPoint.call(ownerProps());
          }),
        ).toBeUndefined();
      },
    );

    test.each(postgresEntryPoints())(
      "%s refuses the same project owner when the credential is read-only",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        expectReadOnlyRefusal(
          await rejectionOf((): Promise<unknown> => {
            return entryPoint.call(readOnlyOwnerProps());
          }),
        );
      },
    );

    test.each(postgresEntryPoints())(
      "%s treats isReadOnlyCredential: false as not read-only",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        expect(
          await rejectionOf((): Promise<unknown> => {
            return entryPoint.call(ownerProps({ isReadOnlyCredential: false }));
          }),
        ).toBeUndefined();
      },
    );

    test.each(postgresEntryPoints())(
      "%s gives a read-only viewer the read-only refusal, not a permission error",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        /*
         * The caller could not have written anyway. That the answer is still
         * the read-only one shows the rule is asked first.
         */
        expectReadOnlyRefusal(
          await rejectionOf((): Promise<unknown> => {
            return entryPoint.call(
              propsFor([Permission.Viewer], { isReadOnlyCredential: true }),
            );
          }),
        );
      },
    );
  });

  describe("ahead of the caller's permissions", () => {
    test.each(postgresEntryPoints())(
      "%s refuses a read-only credential without consulting the permission check at all",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        const underlying: jest.SpyInstance<any, any> =
          entryPoint.spyOnUnderlying();
        const fetchModel: jest.Mock = jest.fn(fetchExistingLabel) as jest.Mock;

        expectReadOnlyRefusal(
          await rejectionOf((): Promise<unknown> => {
            return entryPoint.call(
              readOnlyOwnerProps(),
              fetchModel as unknown as () => Promise<Label | null>,
            );
          }),
        );

        expect(underlying).not.toHaveBeenCalled();
        // Not even the row is fetched for a ...ByModel check.
        expect(fetchModel).not.toHaveBeenCalled();
      },
    );

    test.each(postgresEntryPoints())(
      "%s does consult the permission check for a credential that may write",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        const underlying: jest.SpyInstance<any, any> =
          entryPoint.spyOnUnderlying();

        await entryPoint.call(ownerProps());

        expect(underlying).toHaveBeenCalledTimes(1);
      },
    );

    test.each(postgresEntryPoints())(
      "%s lets root through even with the read-only mark",
      async (_name: string, entryPoint: WriteEntryPoint) => {
        const underlying: jest.SpyInstance<any, any> =
          entryPoint.spyOnUnderlying();

        expect(
          await rejectionOf((): Promise<unknown> => {
            return entryPoint.call({
              isRoot: true,
              isReadOnlyCredential: true,
              tenantId: projectId,
            });
          }),
        ).toBeUndefined();

        expect(underlying).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("reads", () => {
    test("checkReadQueryPermission is not affected: a read-only owner reads exactly as an owner does", async () => {
      const guard: jest.SpyInstance<any, any> = getJestSpyOn(
        DatabaseCommonInteractionPropsUtil,
        "assertCredentialCanWrite",
      );
      const underlying: jest.SpyInstance<any, any> = getJestSpyOn(
        ReadPermission,
        "checkReadPermission",
      );

      const asReadOnly: unknown =
        await ModelPermission.checkReadQueryPermission(
          Label,
          { projectId },
          { name: true },
          readOnlyOwnerProps(),
        );

      const asOwner: unknown = await ModelPermission.checkReadQueryPermission(
        Label,
        { projectId },
        { name: true },
        ownerProps(),
      );

      expect(guard).not.toHaveBeenCalled();
      expect(underlying).toHaveBeenCalledTimes(2);
      expect(comparable(asReadOnly)).toBe(comparable(asOwner));
      // And the scope it is given is the project, for both.
      expect(comparable(asReadOnly)).toContain(projectId.toString());
    });
  });
});

interface AnalyticsWriteEntryPoint {
  name: string;
  call: (props: DatabaseCommonInteractionProps) => Promise<unknown>;
}

function newLog(): Log {
  const log: Log = new Log();

  log.projectId = projectId;
  log.body = "hello";

  return log;
}

const ANALYTICS_WRITE_ENTRY_POINTS: Array<AnalyticsWriteEntryPoint> = [
  {
    name: "checkCreatePermissions",
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return AnalyticsModelPermission.checkCreatePermissions(
        Log,
        newLog(),
        props,
      );
    },
  },
  {
    name: "checkUpdatePermissions",
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await AnalyticsModelPermission.checkUpdatePermissions(
        Log,
        { projectId },
        newLog(),
        props,
      );
    },
  },
  {
    name: "checkDeletePermission",
    call: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await AnalyticsModelPermission.checkDeletePermission(
        Log,
        { projectId },
        props,
      );
    },
  },
];

function analyticsEntryPoints(): Array<[string, AnalyticsWriteEntryPoint]> {
  return ANALYTICS_WRITE_ENTRY_POINTS.map(
    (
      entryPoint: AnalyticsWriteEntryPoint,
    ): [string, AnalyticsWriteEntryPoint] => {
      return [entryPoint.name, entryPoint];
    },
  );
}

const REACHED_THE_PERMISSION_CHECK: string = "reached the permission check";

/*
 * Replaces the analytics layer's own model-level check with a marker, so a
 * test can tell "refused before any permission was looked at" from "went on
 * to the permission check" without depending on what Log's lists allow.
 */
function markAnalyticsPermissionCheck(): jest.SpyInstance<any, any> {
  return getJestSpyOn(
    AnalyticsModelPermission,
    "checkModelLevelPermissions",
  ).mockImplementation((): never => {
    throw new Error(REACHED_THE_PERMISSION_CHECK);
  });
}

describe("the ClickHouse permission layer (AnalyticsDatabase/ModelPermission)", () => {
  test.each(analyticsEntryPoints())(
    "%s refuses a read-only credential held by a project owner",
    async (_name: string, entryPoint: AnalyticsWriteEntryPoint) => {
      expectReadOnlyRefusal(
        await rejectionOf((): Promise<unknown> => {
          return entryPoint.call(readOnlyOwnerProps());
        }),
      );
    },
  );

  test.each(analyticsEntryPoints())(
    "%s refuses it before any permission is looked at",
    async (_name: string, entryPoint: AnalyticsWriteEntryPoint) => {
      const permissionCheck: jest.SpyInstance<any, any> =
        markAnalyticsPermissionCheck();

      expectReadOnlyRefusal(
        await rejectionOf((): Promise<unknown> => {
          return entryPoint.call(readOnlyOwnerProps());
        }),
      );

      expect(permissionCheck).not.toHaveBeenCalled();
    },
  );

  test.each(analyticsEntryPoints())(
    "%s goes on to the permission check for a credential that may write (the control)",
    async (_name: string, entryPoint: AnalyticsWriteEntryPoint) => {
      const permissionCheck: jest.SpyInstance<any, any> =
        markAnalyticsPermissionCheck();

      const error: unknown = await rejectionOf((): Promise<unknown> => {
        return entryPoint.call(ownerProps());
      });

      expect((error as Error).message).toBe(REACHED_THE_PERMISSION_CHECK);
      expect(permissionCheck).toHaveBeenCalledTimes(1);
    },
  );

  test.each(analyticsEntryPoints())(
    "%s lets root through even with the read-only mark",
    async (_name: string, entryPoint: AnalyticsWriteEntryPoint) => {
      const permissionCheck: jest.SpyInstance<any, any> =
        markAnalyticsPermissionCheck();

      expect(
        await rejectionOf((): Promise<unknown> => {
          return entryPoint.call({
            isRoot: true,
            isReadOnlyCredential: true,
            tenantId: projectId,
          });
        }),
      ).toBeUndefined();

      // Root skips the permission lists altogether.
      expect(permissionCheck).not.toHaveBeenCalled();
    },
  );

  test("checkReadPermission is not affected by the read-only mark", async () => {
    const guard: jest.SpyInstance<any, any> = getJestSpyOn(
      DatabaseCommonInteractionPropsUtil,
      "assertCredentialCanWrite",
    );

    const asReadOnly: unknown = await rejectionOf((): Promise<unknown> => {
      return AnalyticsModelPermission.checkReadPermission(
        Log,
        { projectId },
        { body: true },
        readOnlyOwnerProps(),
      );
    });

    const asOwner: unknown = await rejectionOf((): Promise<unknown> => {
      return AnalyticsModelPermission.checkReadPermission(
        Log,
        { projectId },
        { body: true },
        ownerProps(),
      );
    });

    expect(guard).not.toHaveBeenCalled();
    // Whatever a read does for an owner, it does the same for a read-only one.
    expect(asReadOnly).toBeUndefined();
    expect(asOwner).toBeUndefined();
  });
});

/*
 * THE GUARD CANNOT BE FORGOTTEN
 *
 * Both permission classes are scanned for their public static methods. Each
 * one is either on the short list of methods that only read, or it must
 * refuse a read-only credential before it looks at anything else - checked
 * both in the source (the guard is the first thing the method does) and by
 * calling it. A new entry point therefore fails here until somebody decides
 * which of the two it is.
 */

interface PermissionLayer {
  label: string;
  sourcePath: string;
  target: Record<string, unknown>;
  // Public methods that never write, and so do not ask.
  readOnlyMethods: Array<string>;
  // The write entry points that exist today, so one cannot quietly vanish.
  expectedWriteMethods: Array<string>;
}

const PERMISSION_LAYERS: Array<PermissionLayer> = [
  {
    label: "Server/Types/Database/Permissions/Index.ts",
    sourcePath: path.resolve(
      __dirname,
      "../../../Server/Types/Database/Permissions/Index.ts",
    ),
    target: ModelPermission as unknown as Record<string, unknown>,
    readOnlyMethods: ["checkReadQueryPermission"],
    expectedWriteMethods: [
      "checkCreatePermissions",
      "checkDeletePermissionByModel",
      "checkDeleteQueryPermission",
      "checkUpdatePermissionByModel",
      "checkUpdateQueryPermissions",
    ],
  },
  {
    label: "Server/Types/AnalyticsDatabase/ModelPermission.ts",
    sourcePath: path.resolve(
      __dirname,
      "../../../Server/Types/AnalyticsDatabase/ModelPermission.ts",
    ),
    target: AnalyticsModelPermission as unknown as Record<string, unknown>,
    readOnlyMethods: [
      "checkReadPermission",
      "getAccessibleServiceIdsForAnalyticsModel",
      "checkIfUserIsLoggedIn",
    ],
    expectedWriteMethods: [
      "checkCreatePermissions",
      "checkDeletePermission",
      "checkUpdatePermissions",
    ],
  },
];

interface StaticMethod {
  name: string;
  isPublic: boolean;
  // From the declaration to the next method's declaration.
  source: string;
}

const STATIC_METHOD_PATTERN: RegExp =
  /^ {2}(public|private|protected) static (?:async )?([A-Za-z0-9_]+)/gm;

const GUARD_CALL: string =
  "DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(";

function staticMethodsOf(sourcePath: string): Array<StaticMethod> {
  const source: string = fs.readFileSync(sourcePath, "utf8");
  const matches: Array<RegExpMatchArray> = Array.from(
    source.matchAll(STATIC_METHOD_PATTERN),
  );

  return matches.map((match: RegExpMatchArray, index: number): StaticMethod => {
    const start: number = match.index as number;
    const next: RegExpMatchArray | undefined = matches[index + 1];
    const end: number = next ? (next.index as number) : source.length;

    return {
      name: match[2] as string,
      isPublic: match[1] === "public",
      source: source.slice(start, end),
    };
  });
}

function publicWriteMethodsOf(layer: PermissionLayer): Array<StaticMethod> {
  return staticMethodsOf(layer.sourcePath).filter(
    (method: StaticMethod): boolean => {
      return method.isPublic && !layer.readOnlyMethods.includes(method.name);
    },
  );
}

function layers(): Array<[string, PermissionLayer]> {
  return PERMISSION_LAYERS.map(
    (layer: PermissionLayer): [string, PermissionLayer] => {
      return [layer.label, layer];
    },
  );
}

describe("every write entry point asks, and a new one cannot forget to", () => {
  test.each(layers())(
    "%s: the scan finds the methods it is meant to",
    (_label: string, layer: PermissionLayer) => {
      const publicNames: Array<string> = staticMethodsOf(layer.sourcePath)
        .filter((method: StaticMethod): boolean => {
          return method.isPublic;
        })
        .map((method: StaticMethod): string => {
          return method.name;
        });

      // Every method the scan reports really is a function on the class.
      for (const name of publicNames) {
        expect({ name, type: typeof layer.target[name] }).toEqual({
          name,
          type: "function",
        });
      }

      // The read-only list names real methods, so it cannot go stale.
      for (const name of layer.readOnlyMethods) {
        expect(publicNames).toContain(name);
      }
    },
  );

  test.each(layers())(
    "%s: its write entry points are exactly the known ones",
    (_label: string, layer: PermissionLayer) => {
      /*
       * A public method that is not on the read-only list is a write entry
       * point. If this fails because one was ADDED, decide which it is: list
       * it under readOnlyMethods if it never writes, otherwise give it the
       * guard and add it here.
       */
      expect(
        publicWriteMethodsOf(layer)
          .map((method: StaticMethod): string => {
            return method.name;
          })
          .sort(),
      ).toEqual([...layer.expectedWriteMethods].sort());
    },
  );

  test.each(layers())(
    "%s: every write entry point calls the guard before it does anything else",
    (_label: string, layer: PermissionLayer) => {
      const writeMethods: Array<StaticMethod> = publicWriteMethodsOf(layer);

      expect(writeMethods.length).toBeGreaterThan(0);

      for (const method of writeMethods) {
        const guardAt: number = method.source.indexOf(GUARD_CALL);

        expect({ method: method.name, callsTheGuard: guardAt >= 0 }).toEqual({
          method: method.name,
          callsTheGuard: true,
        });

        /*
         * "Before anything else": ahead of the root / master-admin short
         * circuit, ahead of the try that wraps the real check, ahead of any
         * await.
         */
        for (const laterStep of ["props.isRoot", "try {", "await "]) {
          const laterAt: number = method.source.indexOf(laterStep);

          if (laterAt >= 0) {
            expect({
              method: method.name,
              laterStep,
              guardComesFirst: guardAt < laterAt,
            }).toEqual({
              method: method.name,
              laterStep,
              guardComesFirst: true,
            });
          }
        }
      }
    },
  );

  test.each(layers())(
    "%s: the methods on the read-only list do not call the guard",
    (_label: string, layer: PermissionLayer) => {
      const readMethods: Array<StaticMethod> = staticMethodsOf(
        layer.sourcePath,
      ).filter((method: StaticMethod): boolean => {
        return method.isPublic && layer.readOnlyMethods.includes(method.name);
      });

      expect(readMethods).toHaveLength(layer.readOnlyMethods.length);

      for (const method of readMethods) {
        expect({
          method: method.name,
          callsTheGuard: method.source.includes(GUARD_CALL),
        }).toEqual({ method: method.name, callsTheGuard: false });
      }
    },
  );

  test.each(layers())(
    "%s: every write entry point, called, refuses a read-only credential before it reads its arguments",
    async (_label: string, layer: PermissionLayer) => {
      /*
       * The methods take their props in different positions, and two take a
       * single object with a `props` field. This one value is read-only
       * whichever way a method looks at it - and is nothing else, so a
       * method that got as far as using its arguments would fail some other
       * way instead.
       */
      const readOnly: Record<string, unknown> = { isReadOnlyCredential: true };
      const anyArgument: Record<string, unknown> = {
        isReadOnlyCredential: true,
        props: readOnly,
      };

      for (const method of publicWriteMethodsOf(layer)) {
        const entryPoint: (...args: Array<unknown>) => unknown = (
          layer.target[method.name] as (...args: Array<unknown>) => unknown
        ).bind(layer.target);

        const error: unknown = await rejectionOf(async (): Promise<unknown> => {
          return await entryPoint(
            anyArgument,
            anyArgument,
            anyArgument,
            anyArgument,
          );
        });

        expect({
          method: method.name,
          refusedAsReadOnly:
            error instanceof NotAuthorizedException &&
            error.message === READ_ONLY_MESSAGE,
        }).toEqual({ method: method.name, refusedAsReadOnly: true });
      }
    },
  );
});
