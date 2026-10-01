import DatabaseService from "../../../Server/Services/DatabaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Color from "../../../Types/Color";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A READ-ONLY CREDENTIAL IS REFUSED BEFORE A WRITE'S HOOKS RUN
 *
 * The read-only rule lives in the permission layer's write entry points
 * (see Tests/Types/BaseDatabase/ReadOnlyCredential.test.ts). DatabaseService
 * reaches those entry points only AFTER it has run the service's
 * onBeforeCreate / onBeforeUpdate / onBeforeDelete hook - and hooks do real
 * work, usually as root: they allocate the next incident number, re-order
 * escalation rules, cascade to child rows. For a caller who would otherwise
 * be allowed to write, such as a project owner, nothing else stops the hook.
 *
 * So a refused write must be refused before the hook, exactly as the login
 * check is (DatabaseServiceLoginBeforeHooks.test.ts, which this file is
 * modelled on): a read-only credential that could not create the row must
 * not have caused its side effects either.
 *
 * No database is touched. getRepository is stubbed to fail loudly, and every
 * hook throws a sentinel, so "the sentinel came back" is exactly "the caller
 * was let through to the hook".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ROW_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const HOOK_REACHED: string = "The hook was reached.";
const REPOSITORY_REACHED: string =
  "getRepository() was called - the test would have needed a database.";

type HookName =
  | "onBeforeCreate"
  | "onBeforeFind"
  | "onBeforeUpdate"
  | "onBeforeDelete";

const HOOK_NAMES: Array<HookName> = [
  "onBeforeCreate",
  "onBeforeFind",
  "onBeforeUpdate",
  "onBeforeDelete",
];

type HookSpies = Record<HookName, jest.SpyInstance>;

// A project owner: allowed to create, update and delete a Label.
function ownerProps(
  extra: DatabaseCommonInteractionProps = {},
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.ProjectOwner,
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
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Scale,
    isSubscriptionUnpaid: false,
    ...extra,
  };
}

function newLabel(): Label {
  const label: Label = new Label();

  label.name = "production";
  label.color = new Color("#000000");

  return label;
}

interface OperationFixture {
  name: string;
  hook: HookName;
  run: (
    service: DatabaseService<BaseModel>,
    props: DatabaseCommonInteractionProps,
  ) => Promise<unknown>;
}

const WRITE_OPERATIONS: Array<OperationFixture> = [
  {
    name: "create",
    hook: "onBeforeCreate",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.create({ data: newLabel(), props });
    },
  },
  {
    name: "updateBy",
    hook: "onBeforeUpdate",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.updateBy({
        query: {},
        data: { name: "renamed" } as never,
        limit: 10,
        skip: 0,
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
    ): Promise<unknown> => {
      return service.updateOneBy({
        query: { _id: ROW_ID.toString() },
        data: { name: "renamed" } as never,
        props,
      });
    },
  },
  {
    name: "updateOneById",
    hook: "onBeforeUpdate",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.updateOneById({
        id: ROW_ID,
        data: { name: "renamed" } as never,
        props,
      });
    },
  },
  {
    name: "deleteBy",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.deleteBy({ query: {}, limit: 10, skip: 0, props });
    },
  },
  {
    name: "deleteOneBy",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.deleteOneBy({
        query: { _id: ROW_ID.toString() },
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
    ): Promise<unknown> => {
      return service.deleteOneById({ id: ROW_ID, props });
    },
  },
  {
    name: "hardDeleteBy",
    hook: "onBeforeDelete",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.hardDeleteBy({ query: {}, limit: 10, skip: 0, props });
    },
  },
];

const READ_OPERATIONS: Array<OperationFixture> = [
  {
    name: "findBy",
    hook: "onBeforeFind",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.findBy({
        query: {},
        select: { _id: true },
        limit: 10,
        skip: 0,
        props,
      });
    },
  },
  {
    name: "findOneBy",
    hook: "onBeforeFind",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.findOneBy({
        query: { _id: ROW_ID.toString() },
        select: { _id: true },
        props,
      });
    },
  },
  {
    name: "findOneById",
    hook: "onBeforeFind",
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.findOneById({
        id: ROW_ID,
        select: { _id: true },
        props,
      });
    },
  },
];

function named(
  operations: Array<OperationFixture>,
): Array<[string, OperationFixture]> {
  return operations.map(
    (operation: OperationFixture): [string, OperationFixture] => {
      return [operation.name, operation];
    },
  );
}

interface Harness {
  service: DatabaseService<BaseModel>;
  hooks: HookSpies;
  repository: jest.SpyInstance;
}

function makeHarness(): Harness {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    Label,
  );

  const hooks: Partial<HookSpies> = {};

  for (const hookName of HOOK_NAMES) {
    hooks[hookName] = getJestSpyOn(service, hookName).mockRejectedValue(
      new Error(HOOK_REACHED),
    );
  }

  const repository: jest.SpyInstance = getJestSpyOn(
    service,
    "getRepository",
  ).mockImplementation((): never => {
    throw new Error(REPOSITORY_REACHED);
  });

  return { service, hooks: hooks as HookSpies, repository };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("DatabaseService: a read-only credential and the write hooks", () => {
  test.each(named(WRITE_OPERATIONS))(
    "%s refuses a read-only project owner BEFORE its hook runs",
    async (_name: string, operation: OperationFixture) => {
      const harness: Harness = makeHarness();

      const error: unknown = await rejectionOf(
        operation.run(
          harness.service,
          ownerProps({ isReadOnlyCredential: true }),
        ),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as NotAuthorizedException).message).toBe(
        DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
      );

      for (const hookName of HOOK_NAMES) {
        expect({
          hook: hookName,
          calls: harness.hooks[hookName].mock.calls.length,
        }).toEqual({ hook: hookName, calls: 0 });
      }

      expect(harness.repository).not.toHaveBeenCalled();
    },
  );

  test.each(named(WRITE_OPERATIONS))(
    "%s still lets the same owner through to its hook when the credential may write (the control)",
    async (_name: string, operation: OperationFixture) => {
      const harness: Harness = makeHarness();

      const error: unknown = await rejectionOf(
        operation.run(harness.service, ownerProps()),
      );

      expect((error as Error).message).toBe(HOOK_REACHED);
      expect(harness.hooks[operation.hook]).toHaveBeenCalledTimes(1);
    },
  );

  test.each(named(WRITE_OPERATIONS))(
    "%s lets root through to its hook even with the read-only mark",
    async (_name: string, operation: OperationFixture) => {
      const harness: Harness = makeHarness();

      const error: unknown = await rejectionOf(
        operation.run(harness.service, {
          isRoot: true,
          isReadOnlyCredential: true,
          tenantId: PROJECT_ID,
        }),
      );

      expect((error as Error).message).toBe(HOOK_REACHED);
      expect(harness.hooks[operation.hook]).toHaveBeenCalledTimes(1);
    },
  );

  test.each(named(READ_OPERATIONS))(
    "%s is not affected: a read-only credential reads, and reaches the find hook",
    async (_name: string, operation: OperationFixture) => {
      const harness: Harness = makeHarness();

      const error: unknown = await rejectionOf(
        operation.run(
          harness.service,
          ownerProps({ isReadOnlyCredential: true }),
        ),
      );

      expect((error as Error).message).toBe(HOOK_REACHED);
      expect(harness.hooks.onBeforeFind).toHaveBeenCalledTimes(1);
    },
  );
});
