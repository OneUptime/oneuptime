import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A WRITE'S HOOKS RUN ONLY FOR SOMEONE WHO MAY MAKE THE WRITE, AND ONLY ON
 * THE ROWS THEY MAY WRITE.
 *
 * A service's onBeforeCreate / onBeforeUpdate / onBeforeDelete runs before
 * DatabaseService's permission check, and hooks act on the caller's behalf,
 * usually as root: they unset the project's other defaults, make room in an
 * order, delete child rows, carry rows forward to the success hook. So before
 * any hook runs:
 *
 *  - the caller must be allowed to write the table in the project the request
 *    is made in (the first question the full check asks), and
 *  - an update or delete is narrowed to the rows the caller may write, the
 *    same way the full check narrows it. None: nothing runs and the write
 *    returns 0. Some: the query the hooks are handed names exactly them.
 *
 * No database is touched: the repository is an in-memory list of labels in
 * two projects, and every hook throws a sentinel, so "the sentinel came back"
 * means "the caller reached the hook" and the hook's argument shows what it
 * was handed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// Two labels in the caller's project, two in another project.
const OWN_LABEL_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OWN_SECOND_LABEL_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const OTHER_LABEL_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_SECOND_LABEL_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";

const HOOK_REACHED: string = "The hook was reached.";
const REPOSITORY_REACHED: string =
  "getRepository() was called - the test would have needed a database.";

type HookName = "onBeforeCreate" | "onBeforeUpdate" | "onBeforeDelete";

const HOOK_NAMES: Array<HookName> = [
  "onBeforeCreate",
  "onBeforeUpdate",
  "onBeforeDelete",
];

type HookSpies = Record<HookName, jest.SpyInstance>;

interface StoredRow {
  _id: string;
  projectId: string;
  name: string;
}

const ROWS: Array<StoredRow> = [
  { _id: OWN_LABEL_ID, projectId: PROJECT_ID.toString(), name: "production" },
  {
    _id: OWN_SECOND_LABEL_ID,
    projectId: PROJECT_ID.toString(),
    name: "staging",
  },
  {
    _id: OTHER_LABEL_ID,
    projectId: OTHER_PROJECT_ID.toString(),
    name: "production",
  },
  {
    _id: OTHER_SECOND_LABEL_ID,
    projectId: OTHER_PROJECT_ID.toString(),
    name: "staging",
  },
];

/*
 * Whether a stored value satisfies one condition of a where clause: a plain
 * value, or the TypeORM operators the permission layer and QueryHelper build
 * for these columns.
 */
function matchesCondition(stored: string, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

    if (operator.type === "in") {
      return (operator.value as Array<unknown>)
        .map((value: unknown): string => {
          return String(value).toLowerCase();
        })
        .includes(stored.toLowerCase());
    }

    if (operator.type === "equal") {
      return String(operator.value).toLowerCase() === stored.toLowerCase();
    }

    if (operator.type === "and") {
      return (operator.value as Array<unknown>).every((child: unknown) => {
        return matchesCondition(stored, child);
      });
    }

    if (operator.type === "raw") {
      return valuesOf(operator)
        .map((value: string): string => {
          return value.toLowerCase();
        })
        .includes(stored.toLowerCase());
    }

    throw new Error(`The fake repository does not know "${operator.type}".`);
  }

  return String(condition).toLowerCase() === stored.toLowerCase();
}

/*
 * The values a condition the permission layer serialized into SQL accepts:
 * QueryHelper.equalTo is `(column = :parameter)`, QueryHelper.any / in is
 * `(column IN (:...parameter))`.
 */
function valuesOf(operator: FindOperator<unknown>): Array<string> {
  const sql: string = operator.getSql ? operator.getSql("column") : "";
  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters as Record<string, unknown>) || {};

  const equality: RegExpMatchArray | null = sql.match(/^\(column = :(\w+)\)$/);

  if (equality && parameters[equality[1]!] !== undefined) {
    return [String(parameters[equality[1]!])];
  }

  const membership: RegExpMatchArray | null = sql.match(
    /^\(column IN \(:\.\.\.(\w+)\)\)$/,
  );

  if (membership && Array.isArray(parameters[membership[1]!])) {
    return (parameters[membership[1]!] as Array<unknown>).map(
      (value: unknown): string => {
        return String(value);
      },
    );
  }

  throw new Error(`The fake repository does not know the SQL "${sql}".`);
}

// The one value an equality condition accepts, however it is spelled.
function equalityValueOf(condition: unknown): string | undefined {
  if (!(condition instanceof FindOperator)) {
    return condition === undefined ? undefined : String(condition);
  }

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "equal") {
    return String(operator.value);
  }

  const values: Array<string> = valuesOf(operator);

  return values.length === 1 ? values[0] : undefined;
}

function matchesWhere(row: StoredRow, where: unknown): boolean {
  if (Array.isArray(where)) {
    return where.some((part: unknown) => {
      return matchesWhere(row, part);
    });
  }

  for (const [column, condition] of Object.entries(
    (where || {}) as Record<string, unknown>,
  )) {
    if (condition === undefined) {
      continue;
    }

    const stored: string | undefined = (
      row as unknown as Record<string, string>
    )[column];

    if (stored === undefined || !matchesCondition(stored, condition)) {
      return false;
    }
  }

  return true;
}

interface FakeRepository {
  find: MockFunction;
  update: MockFunction;
  delete: MockFunction;
  save: MockFunction;
}

function makeFakeRepository(): FakeRepository {
  return {
    find: getJestMockFunction().mockImplementation(
      async (options: {
        where: unknown;
        skip?: number;
        take?: number;
      }): Promise<Array<Label>> => {
        const matched: Array<StoredRow> = ROWS.filter((row: StoredRow) => {
          return matchesWhere(row, options.where);
        });

        const window: Array<StoredRow> = matched.slice(
          options.skip || 0,
          options.take ? (options.skip || 0) + options.take : undefined,
        );

        return window.map((row: StoredRow): Label => {
          const label: Label = new Label();
          label._id = row._id;
          return label;
        });
      },
    ),
    update: getJestMockFunction().mockImplementation(async (): Promise<{ affected: number }> => {
      throw new Error("update() should not have been reached.");
    }),
    delete: getJestMockFunction().mockImplementation(async (): Promise<{ affected: number }> => {
      throw new Error("delete() should not have been reached.");
    }),
    save: getJestMockFunction().mockImplementation(async (): Promise<never> => {
      throw new Error("save() should not have been reached.");
    }),
  };
}

// A member of `memberOf` with these permissions, asking in PROJECT_ID.
function memberProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
  extra: DatabaseCommonInteractionProps = {},
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: memberOf,
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
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [memberOf.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Scale,
    isSubscriptionUnpaid: false,
    ...extra,
  };
}

const ownerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner]);
  };

// May see the labels, and change nothing.
const readerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ReadProjectLabel]);
  };

// An owner of another project, asking in this one.
const strangerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID);
  };

function newLabel(): Label {
  const label: Label = new Label();
  label.name = "production";
  return label;
}

interface Harness {
  service: DatabaseService<BaseModel>;
  hooks: HookSpies;
  onUpdateSuccess: jest.SpyInstance;
  onDeleteSuccess: jest.SpyInstance;
  repository: FakeRepository;
  getRepository: jest.SpyInstance;
}

function makeHarness(options: { repositoryFails?: boolean } = {}): Harness {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    Label,
  );

  const hooks: Partial<HookSpies> = {};

  for (const hookName of HOOK_NAMES) {
    hooks[hookName] = getJestSpyOn(service, hookName).mockRejectedValue(
      new Error(HOOK_REACHED),
    );
  }

  const repository: FakeRepository = makeFakeRepository();

  const getRepository: jest.SpyInstance = getJestSpyOn(
    service,
    "getRepository",
  ).mockImplementation((): unknown => {
    if (options.repositoryFails) {
      throw new Error(REPOSITORY_REACHED);
    }

    return repository;
  });

  return {
    service,
    hooks: hooks as HookSpies,
    onUpdateSuccess: getJestSpyOn(service, "onUpdateSuccess"),
    onDeleteSuccess: getJestSpyOn(service, "onDeleteSuccess"),
    repository,
    getRepository,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

// What a hook spy was first called with: an UpdateBy or a DeleteBy.
function firstArgumentOf(spy: jest.SpyInstance): {
  query: Record<string, unknown>;
  skip: unknown;
  limit: unknown;
} {
  return spy.mock.calls[0]![0] as {
    query: Record<string, unknown>;
    skip: unknown;
    limit: unknown;
  };
}

function expectNoHookCalled(hooks: HookSpies): void {
  for (const hookName of HOOK_NAMES) {
    expect({
      hook: hookName,
      calls: hooks[hookName].mock.calls.length,
    }).toEqual({ hook: hookName, calls: 0 });
  }
}

interface WriteOperation {
  name: string;
  hook: HookName;
  run: (
    service: DatabaseService<BaseModel>,
    props: DatabaseCommonInteractionProps,
    rowId: string,
  ) => Promise<unknown>;
}

// Every public way to update or delete one row by its id.
const SINGLE_ROW_WRITES: Array<WriteOperation> = [
  {
    name: "updateOneById",
    hook: "onBeforeUpdate",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.updateOneById({
        id: new ObjectID(rowId),
        data: { name: "renamed" } as never,
        props,
      });
    },
  },
  {
    name: "updateOneBy",
    hook: "onBeforeUpdate",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.updateOneBy({
        query: { _id: rowId },
        data: { name: "renamed" } as never,
        props,
      });
    },
  },
  {
    name: "updateBy",
    hook: "onBeforeUpdate",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.updateBy({
        query: { _id: rowId },
        data: { name: "renamed" } as never,
        limit: 10,
        skip: 0,
        props,
      });
    },
  },
  {
    name: "deleteOneById",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.deleteOneById({ id: new ObjectID(rowId), props });
    },
  },
  {
    name: "deleteOneBy",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.deleteOneBy({ query: { _id: rowId }, props });
    },
  },
  {
    name: "deleteBy",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.deleteBy({
        query: { _id: rowId },
        limit: 10,
        skip: 0,
        props,
      });
    },
  },
  {
    name: "hardDeleteBy",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
      rowId: string,
    ): Promise<unknown> => {
      return service.hardDeleteBy({
        query: { _id: rowId },
        limit: 10,
        skip: 0,
        props,
      });
    },
  },
];

function named<T extends { name: string }>(
  operations: Array<T>,
): Array<[string, T]> {
  return operations.map((operation: T): [string, T] => {
    return [operation.name, operation];
  });
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("DatabaseService: whether the caller may write the table is asked before any hook", () => {
  test.each([
    ["a member who may only read labels", readerProps],
    ["an owner of another project", strangerProps],
  ] as Array<[string, () => DatabaseCommonInteractionProps]>)(
    "create refuses %s before onBeforeCreate runs or anything is read",
    async (
      _label: string,
      buildProps: () => DatabaseCommonInteractionProps,
    ) => {
      const harness: Harness = makeHarness({ repositoryFails: true });

      const error: unknown = await rejectionOf(
        harness.service.create({ data: newLabel(), props: buildProps() }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toContain(
        "You do not have permissions to create Label",
      );
      expectNoHookCalled(harness.hooks);
      expect(harness.getRepository).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["a member who may only read labels", readerProps],
    ["an owner of another project", strangerProps],
  ] as Array<[string, () => DatabaseCommonInteractionProps]>)(
    "every update and delete refuses %s before its hook runs or anything is read",
    async (
      _label: string,
      buildProps: () => DatabaseCommonInteractionProps,
    ) => {
      for (const operation of SINGLE_ROW_WRITES) {
        const harness: Harness = makeHarness({ repositoryFails: true });

        // updateOneById / deleteOneById have their own by-model check first.
        getJestSpyOn(
          ModelPermission,
          "checkUpdatePermissionByModel",
        ).mockResolvedValue(undefined);
        getJestSpyOn(
          ModelPermission,
          "checkDeletePermissionByModel",
        ).mockResolvedValue(undefined);

        const error: unknown = await rejectionOf(
          operation.run(harness.service, buildProps(), OWN_LABEL_ID),
        );

        expect({ operation: operation.name, error }).toEqual({
          operation: operation.name,
          error: expect.any(NotAuthorizedException),
        });
        expectNoHookCalled(harness.hooks);
        expect(harness.getRepository).not.toHaveBeenCalled();

        jest.restoreAllMocks();
      }
    },
  );

  test("create lets an owner through to onBeforeCreate (the control)", async () => {
    const harness: Harness = makeHarness({ repositoryFails: true });

    const error: unknown = await rejectionOf(
      harness.service.create({ data: newLabel(), props: ownerProps() }),
    );

    expect((error as Error).message).toBe(HOOK_REACHED);
    expect(harness.hooks.onBeforeCreate).toHaveBeenCalledTimes(1);
    expect(harness.getRepository).not.toHaveBeenCalled();
  });

  test("a block permission on creating labels refuses the create before onBeforeCreate", async () => {
    const harness: Harness = makeHarness({ repositoryFails: true });
    const props: DatabaseCommonInteractionProps = ownerProps();

    props.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions.push({
      _type: "UserPermission",
      permission: Permission.CreateProjectLabel,
      labelIds: [],
      isBlockPermission: true,
    });

    const error: unknown = await rejectionOf(
      harness.service.create({ data: newLabel(), props }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(harness.hooks.onBeforeCreate).not.toHaveBeenCalled();
  });

  test.each([
    ["root", { isRoot: true, tenantId: PROJECT_ID }],
    ["a master admin", { isMasterAdmin: true, userId: USER_ID }],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "%s reaches every hook without a permission lookup",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      const createHarness: Harness = makeHarness({ repositoryFails: true });

      await expect(
        createHarness.service.create({
          data: newLabel(),
          props: { ...props },
        }),
      ).rejects.toThrow(HOOK_REACHED);

      for (const operation of SINGLE_ROW_WRITES) {
        jest.restoreAllMocks();
        const harness: Harness = makeHarness({ repositoryFails: true });

        await expect(
          operation.run(harness.service, { ...props }, OTHER_LABEL_ID),
        ).rejects.toThrow(HOOK_REACHED);

        expect({
          operation: operation.name,
          calls: harness.hooks[operation.hook].mock.calls.length,
        }).toEqual({ operation: operation.name, calls: 1 });

        // The query the hook is handed is the one root sent.
        expect(firstArgumentOf(harness.hooks[operation.hook]).query).toEqual({
          _id: OTHER_LABEL_ID,
        });
      }
    },
  );
});

describe("DatabaseService: an update or delete reaches its hook only with the rows the caller may write", () => {
  test.each(named(SINGLE_ROW_WRITES))(
    "%s of another project's row by an owner of this project runs no hook and changes nothing",
    async (_name: string, operation: WriteOperation) => {
      const harness: Harness = makeHarness();

      const result: unknown = await operation.run(
        harness.service,
        ownerProps(),
        OTHER_LABEL_ID,
      );

      expect(result).toBe(0);
      expectNoHookCalled(harness.hooks);
      expect(harness.onUpdateSuccess).not.toHaveBeenCalled();
      expect(harness.onDeleteSuccess).not.toHaveBeenCalled();
      expect(harness.repository.update).not.toHaveBeenCalled();
      expect(harness.repository.delete).not.toHaveBeenCalled();
      expect(harness.repository.save).not.toHaveBeenCalled();

      // The one read made was scoped to the caller's project.
      expect(harness.repository.find).toHaveBeenCalledTimes(1);
      const where: Record<string, unknown> = (
        harness.repository.find.mock.calls[0]![0] as {
          where: Record<string, unknown>;
        }
      ).where;
      expect(equalityValueOf(where["projectId"])).toBe(PROJECT_ID.toString());
    },
  );

  test.each(named(SINGLE_ROW_WRITES))(
    "%s of a row that does not exist runs no hook",
    async (_name: string, operation: WriteOperation) => {
      const harness: Harness = makeHarness();

      const result: unknown = await operation.run(
        harness.service,
        ownerProps(),
        "cccccccc-0000-4000-8000-000000000001",
      );

      expect(result).toBe(0);
      expectNoHookCalled(harness.hooks);
    },
  );

  test.each(named(SINGLE_ROW_WRITES))(
    "%s of the caller's own row reaches the hook with the query as it was sent",
    async (_name: string, operation: WriteOperation) => {
      const harness: Harness = makeHarness();

      await expect(
        operation.run(harness.service, ownerProps(), OWN_LABEL_ID),
      ).rejects.toThrow(HOOK_REACHED);

      expect(harness.hooks[operation.hook]).toHaveBeenCalledTimes(1);

      const handed: {
        query: Record<string, unknown>;
        skip: unknown;
        limit: unknown;
      } = firstArgumentOf(harness.hooks[operation.hook]);

      /*
       * Still the plain id a hook can read back (several do:
       * `new ObjectID(updateBy.query._id)`), and still only it.
       */
      expect(handed.query).toEqual({ _id: OWN_LABEL_ID });
      expect(handed.skip).toBe(0);
      expect(handed.limit).toBe(1);
    },
  );

  test("an update that names rows by a condition reaches the hook pinned to the caller's own rows", async () => {
    const harness: Harness = makeHarness();

    await expect(
      harness.service.updateBy({
        query: { name: "production" } as never,
        data: { description: "used in production" } as never,
        limit: 10,
        skip: 0,
        props: ownerProps(),
      }),
    ).rejects.toThrow(HOOK_REACHED);

    const handed: {
      query: Record<string, unknown>;
      skip: unknown;
      limit: unknown;
    } = firstArgumentOf(harness.hooks.onBeforeUpdate);

    // The condition is kept, and the row is the caller's production label.
    expect(handed.query["name"]).toBe("production");
    expect(handed.query["_id"]).toBe(OWN_LABEL_ID);
    expect(handed.skip).toBe(0);
    expect(handed.limit).toBe(1);
  });

  test("a delete that names several rows reaches the hook with only the caller's rows", async () => {
    const harness: Harness = makeHarness();

    await expect(
      harness.service.deleteBy({
        query: {
          _id: QueryHelper.any([
            OWN_LABEL_ID,
            OWN_SECOND_LABEL_ID,
            OTHER_LABEL_ID,
            OTHER_SECOND_LABEL_ID,
          ]),
        } as never,
        limit: 10,
        skip: 0,
        props: ownerProps(),
      }),
    ).rejects.toThrow(HOOK_REACHED);

    const handed: {
      query: Record<string, unknown>;
      skip: unknown;
      limit: unknown;
    } = firstArgumentOf(harness.hooks.onBeforeDelete);

    const pinned: unknown = handed.query["_id"];

    expect(pinned).toBeInstanceOf(FindOperator);
    expect(valuesOf(pinned as FindOperator<unknown>).sort()).toEqual(
      [OWN_LABEL_ID, OWN_SECOND_LABEL_ID].sort(),
    );
    expect(handed.limit).toBe(2);
  });

  test("the window the caller asked for is kept: a delete of one row by a condition pins one row", async () => {
    const harness: Harness = makeHarness();

    await expect(
      harness.service.deleteOneBy({
        query: { name: "staging" } as never,
        props: ownerProps(),
      }),
    ).rejects.toThrow(HOOK_REACHED);

    const handed: {
      query: Record<string, unknown>;
      skip: unknown;
      limit: unknown;
    } = firstArgumentOf(harness.hooks.onBeforeDelete);

    expect(handed.query["_id"]).toBe(OWN_SECOND_LABEL_ID);
    expect(handed.limit).toBe(1);
  });

  test("ignoreHooks skips the lookup: no hook runs, so there is nothing to keep from one", async () => {
    const harness: Harness = makeHarness();

    // The full permission check still narrows the write itself afterwards.
    const result: number = await harness.service.deleteBy({
      query: { _id: OTHER_LABEL_ID },
      limit: 10,
      skip: 0,
      props: { ...ownerProps(), ignoreHooks: true },
    });

    expect(result).toBe(0);
    expectNoHookCalled(harness.hooks);
    expect(harness.repository.delete).not.toHaveBeenCalled();
  });
});

describe("DatabaseService: the rows of a project write are looked up by the project's id", () => {
  /*
   * Project's tenant column is its own primary key, so the permission layer
   * scopes "update project X" to the project the request is made in. The
   * hook is handed that project - the row the update will actually change -
   * and never the one the caller named.
   */
  test("an owner updating another project's row hands the hook their own project", async () => {
    const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
      Project,
    );

    const onBeforeUpdate: jest.SpyInstance = getJestSpyOn(
      service,
      "onBeforeUpdate",
    ).mockRejectedValue(new Error(HOOK_REACHED));

    const find: MockFunction = getJestMockFunction().mockImplementation(
      async (options: {
        where: Record<string, unknown>;
      }): Promise<Array<Project>> => {
        const project: Project = new Project();
        project._id = equalityValueOf(options.where["_id"])!;
        return [project];
      },
    );

    getJestSpyOn(service, "getRepository").mockReturnValue({ find });
    getJestSpyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    ).mockResolvedValue(undefined);

    await expect(
      service.updateOneById({
        id: OTHER_PROJECT_ID,
        data: { name: "Renamed" } as never,
        props: ownerProps(),
      }),
    ).rejects.toThrow(HOOK_REACHED);

    expect(
      String(firstArgumentOf(onBeforeUpdate).query["_id"]).toLowerCase(),
    ).toBe(PROJECT_ID.toString().toLowerCase());
  });
});
