import Log from "../../../Models/AnalyticsModels/Log";
import LogService from "../../../Server/Services/LogService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A READ-ONLY CREDENTIAL IS REFUSED BEFORE AN ANALYTICS WRITE'S HOOKS RUN
 *
 * The ClickHouse half of DatabaseServiceReadOnlyCredentialBeforeHooks. An MCP
 * client its user authorized as read-only must not be able to change
 * anything, and "anything" includes what a service's onBefore* hook does on
 * the way to a write that is then refused. AnalyticsDatabaseService ran the
 * hook first and reached the permission entry point (where the refusal
 * lives) afterwards; the refusal now comes first.
 *
 * No database is touched: every hook throws a sentinel, so "the sentinel came
 * back" is exactly "the caller was let through to the hook".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const HOOK_REACHED: string = "The hook was reached.";

type HookName = "onBeforeCreate" | "onBeforeUpdate" | "onBeforeDelete";

const HOOK_NAMES: Array<HookName> = [
  "onBeforeCreate",
  "onBeforeUpdate",
  "onBeforeDelete",
];

// A project owner: nothing but the credential stands between them and a write.
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

function newLog(): Log {
  const log: Log = new Log();

  log.projectId = PROJECT_ID;
  log.body = "hello";

  return log;
}

interface OperationFixture {
  name: string;
  hook: HookName;
  run: (props: DatabaseCommonInteractionProps) => Promise<unknown>;
}

const WRITE_OPERATIONS: Array<OperationFixture> = [
  {
    name: "create",
    hook: "onBeforeCreate",
    run: (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return LogService.create({ data: newLog(), props });
    },
  },
  {
    name: "createMany",
    hook: "onBeforeCreate",
    run: (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return LogService.createMany({ items: [newLog(), newLog()], props });
    },
  },
  {
    name: "updateBy",
    hook: "onBeforeUpdate",
    run: (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return LogService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { body: "changed" } as never,
        props,
      });
    },
  },
  {
    name: "deleteBy",
    hook: "onBeforeDelete",
    run: (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return LogService.deleteBy({
        query: { projectId: PROJECT_ID },
        props,
      });
    },
  },
];

type HookSpies = Record<HookName, SpyInstance>;

function spyOnHooks(): HookSpies {
  const spies: Partial<HookSpies> = {};

  for (const hook of HOOK_NAMES) {
    spies[hook] = jest
      .spyOn(LogService as unknown as Record<HookName, () => unknown>, hook)
      .mockImplementation((): never => {
        throw new Error(HOOK_REACHED);
      });
  }

  return spies as HookSpies;
}

async function outcomeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }

  return undefined;
}

describe("a read-only credential and AnalyticsDatabaseService's write hooks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(WRITE_OPERATIONS)(
    "$name",
    (operation: OperationFixture): void => {
      test("a read-only credential is refused, and the hook never runs", async () => {
        const hooks: HookSpies = spyOnHooks();

        const outcome: unknown = await outcomeOf((): Promise<unknown> => {
          return operation.run(ownerProps({ isReadOnlyCredential: true }));
        });

        expect(outcome).toBeInstanceOf(NotAuthorizedException);
        expect((outcome as Error).message).toBe(
          DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
        );

        for (const hook of HOOK_NAMES) {
          expect(hooks[hook]).not.toHaveBeenCalled();
        }
      });

      test("the same caller without the flag reaches the hook: the refusal was the credential", async () => {
        const hooks: HookSpies = spyOnHooks();

        const outcome: unknown = await outcomeOf((): Promise<unknown> => {
          return operation.run(ownerProps());
        });

        expect((outcome as Error).message).toBe(HOOK_REACHED);
        expect(hooks[operation.hook]).toHaveBeenCalled();
      });

      test("an explicit false is not a refusal", async () => {
        const hooks: HookSpies = spyOnHooks();

        const outcome: unknown = await outcomeOf((): Promise<unknown> => {
          return operation.run(ownerProps({ isReadOnlyCredential: false }));
        });

        expect((outcome as Error).message).toBe(HOOK_REACHED);
        expect(hooks[operation.hook]).toHaveBeenCalled();
      });

      test("the server's own (root) write is not the caller's to be refused", async () => {
        const hooks: HookSpies = spyOnHooks();

        const outcome: unknown = await outcomeOf((): Promise<unknown> => {
          return operation.run({
            isRoot: true,
            tenantId: PROJECT_ID,
            isReadOnlyCredential: true,
          });
        });

        expect((outcome as Error).message).toBe(HOOK_REACHED);
        expect(hooks[operation.hook]).toHaveBeenCalled();
      });
    },
  );
});
