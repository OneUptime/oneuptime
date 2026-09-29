import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallShiftReminderService from "../../../Server/Services/UserOnCallShiftReminderService";
import UserService from "../../../Server/Services/UserService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Probe from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallShiftReminder from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A customer left the dashboard open past the 15-minute access-token lifetime
 * and clicked a button. The browser had already dropped the expired cookie, so
 * the request arrived with no credentials at all - and the browser client only
 * refreshes the session and replays the request when the answer is a 401.
 *
 * DatabaseService used to run its hooks BEFORE the permission layer's login
 * check, and many hooks key off props.userId. An anonymous caller therefore
 * got whatever the first hook to notice a missing userId happened to say:
 * "User id is required" (400), "User should be logged in to create the
 * project." (422), or - for Project reads - nothing at all, because
 * ProjectService.onBeforeFind turned the request into a root read of the zero
 * id and answered 200 []. None of those make the client refresh the session,
 * so the user saw an error (or an empty list) until they reloaded the page.
 *
 * The fix runs the same login check the permission layer runs, with the same
 * exemptions (root, master admin, API keys, models whose table permission for
 * the request type includes Permission.Public), before any hook, in create,
 * _findBy, _updateBy, _deleteBy and hardDeleteBy. These tests pin:
 *
 *   - every public entry point refuses an anonymous caller with a 401 before a
 *     hook runs and before the repository is touched;
 *   - every kind of credential still reaches the hook exactly as before, so
 *     the gate changes which refusal an anonymous caller gets and nothing else;
 *   - a model that is public for one request type stays public for that type
 *     only;
 *   - the concrete hook refusals anonymous callers used to receive are now
 *     401s, while API keys - which reach the hooks - keep the old answers.
 *
 * No database is touched. getRepository is stubbed to fail loudly, and every
 * positive case stops at the hook: the hook spy throws a sentinel, so "the
 * sentinel came back" is exactly "the gate let the caller through to the hook".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ROW_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const HOOK_REACHED: string = "The hook was reached - the login gate let it in.";
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

interface CallerFixture {
  name: string;
  props: DatabaseCommonInteractionProps;
}

/*
 * Every one of these is a request with no usable identity. Flags and user
 * types that are present but do not name a user (or an API key) are not
 * credentials: `isRoot: false` is not root, and `userType: User` without a
 * userId is a token that identifies nobody.
 */
const ANONYMOUS_CALLERS: Array<CallerFixture> = [
  { name: "no props at all", props: {} },
  { name: "only a tenant id", props: { tenantId: PROJECT_ID } },
  { name: "userType Public", props: { userType: UserType.Public } },
  {
    name: "userType Public with a tenant id",
    props: { userType: UserType.Public, tenantId: PROJECT_ID },
  },
  {
    name: "isRoot and isMasterAdmin present but false",
    props: { isRoot: false, isMasterAdmin: false, tenantId: PROJECT_ID },
  },
  {
    name: "userType User but no userId",
    props: { userType: UserType.User, tenantId: PROJECT_ID },
  },
];

/*
 * Every one of these was admitted before the fix and must still be admitted:
 * the gate is the permission layer's own login check, so anything it lets
 * through the permission layer would have let through too.
 */
const CREDENTIALED_CALLERS: Array<CallerFixture> = [
  { name: "root", props: { isRoot: true } },
  {
    name: "a master admin (flag alone, no userId)",
    props: { isMasterAdmin: true },
  },
  {
    name: "an API key (userType API, no userId)",
    props: { userType: UserType.API, tenantId: PROJECT_ID },
  },
  {
    name: "a logged-in user",
    props: { userId: USER_ID, userType: UserType.User, tenantId: PROJECT_ID },
  },
];

/*
 * Each public entry point that reaches one of the gated private methods, with
 * the hook it would run and the request type the login check is asked about.
 */
interface OperationFixture {
  name: string;
  hook: HookName;
  requestType: DatabaseRequestType;
  run: (
    service: DatabaseService<BaseModel>,
    props: DatabaseCommonInteractionProps,
  ) => Promise<unknown>;
}

type MakeModelFunction = (service: DatabaseService<BaseModel>) => BaseModel;

const makeModel: MakeModelFunction = (
  service: DatabaseService<BaseModel>,
): BaseModel => {
  return new service.modelType();
};

const OPERATIONS: Array<OperationFixture> = [
  {
    name: "create",
    hook: "onBeforeCreate",
    requestType: DatabaseRequestType.Create,
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.create({ data: makeModel(service), props });
    },
  },
  {
    name: "findBy",
    hook: "onBeforeFind",
    requestType: DatabaseRequestType.Read,
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
    requestType: DatabaseRequestType.Read,
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
    requestType: DatabaseRequestType.Read,
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
  {
    name: "updateBy",
    hook: "onBeforeUpdate",
    requestType: DatabaseRequestType.Update,
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.updateBy({
        query: {},
        data: { _id: ROW_ID.toString() } as never,
        limit: 10,
        skip: 0,
        props,
      });
    },
  },
  {
    name: "updateOneBy",
    hook: "onBeforeUpdate",
    requestType: DatabaseRequestType.Update,
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.updateOneBy({
        query: { _id: ROW_ID.toString() },
        data: { _id: ROW_ID.toString() } as never,
        props,
      });
    },
  },
  {
    name: "updateOneById",
    hook: "onBeforeUpdate",
    requestType: DatabaseRequestType.Update,
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.updateOneById({
        id: ROW_ID,
        data: { _id: ROW_ID.toString() } as never,
        props,
      });
    },
  },
  {
    name: "deleteBy",
    hook: "onBeforeDelete",
    requestType: DatabaseRequestType.Delete,
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
    requestType: DatabaseRequestType.Delete,
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
    requestType: DatabaseRequestType.Delete,
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
    requestType: DatabaseRequestType.Delete,
    run: (
      service: DatabaseService<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return service.hardDeleteBy({ query: {}, limit: 10, skip: 0, props });
    },
  },
];

type OperationNamedFunction = (name: string) => OperationFixture;

const operationNamed: OperationNamedFunction = (
  name: string,
): OperationFixture => {
  const operation: OperationFixture | undefined = OPERATIONS.find(
    (candidate: OperationFixture) => {
      return candidate.name === name;
    },
  );

  if (!operation) {
    throw new Error(`No operation fixture named ${name}.`);
  }

  return operation;
};

/*
 * Copied per call: the hooks and the gated methods are allowed to mutate
 * props (ProjectService.onBeforeFind sets isRoot on them), and a fixture that
 * leaked one test's mutation into the next would make the table lie.
 */
type CopyPropsFunction = (
  props: DatabaseCommonInteractionProps,
) => DatabaseCommonInteractionProps;

const copyProps: CopyPropsFunction = (
  props: DatabaseCommonInteractionProps,
): DatabaseCommonInteractionProps => {
  return { ...props };
};

/*
 * The refusal must be the 401 itself, not merely something that stringifies
 * like it: code 401 is what the browser client reads to decide whether to
 * refresh the session and replay the request.
 */
type ExpectNotAuthenticatedFunction = (
  promise: Promise<unknown>,
  requestType: DatabaseRequestType,
  singularName: string,
) => Promise<void>;

const expectNotAuthenticated: ExpectNotAuthenticatedFunction = async (
  promise: Promise<unknown>,
  requestType: DatabaseRequestType,
  singularName: string,
): Promise<void> => {
  let caught: unknown = undefined;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(NotAuthenticatedException);
  expect((caught as NotAuthenticatedException).code).toBe(401);
  expect((caught as NotAuthenticatedException).message).toBe(
    `Authenticated user or a valid API key is needed to ${requestType} record of ${singularName}.`,
  );
};

type StubHooksFunction = (service: DatabaseService<BaseModel>) => HookSpies;

const stubHooksWithSentinel: StubHooksFunction = (
  service: DatabaseService<BaseModel>,
): HookSpies => {
  const spies: Partial<HookSpies> = {};

  for (const hookName of HOOK_NAMES) {
    spies[hookName] = getJestSpyOn(service, hookName).mockRejectedValue(
      new Error(HOOK_REACHED),
    );
  }

  return spies as HookSpies;
};

type StubRepositoryFunction = (service: unknown) => jest.SpyInstance;

const stubRepositoryToFailLoudly: StubRepositoryFunction = (
  service: unknown,
): jest.SpyInstance => {
  return getJestSpyOn(service, "getRepository").mockImplementation(() => {
    throw new Error(REPOSITORY_REACHED);
  });
};

/*
 * updateOneById and deleteOneById run the label-based access-control check
 * (checkUpdatePermissionByModel / checkDeletePermissionByModel) before they
 * reach _updateBy / _deleteBy. That check is not what this suite is about, and
 * for a caller without table permissions it would answer first. Stubbed so the
 * by-id paths reach the gate in _updateBy / _deleteBy for every caller - which
 * is also what proves the gate is in the shared private method and does not
 * depend on the by-model check having run.
 */
const stubPermissionByModelChecks: () => void = (): void => {
  getJestSpyOn(
    ModelPermission,
    "checkUpdatePermissionByModel",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    ModelPermission,
    "checkDeletePermissionByModel",
  ).mockResolvedValue(undefined);
};

/*
 * The permission layer's per-query checks, spied but left calling through.
 * The permission layer runs the very same login check after the hooks, so an
 * anonymous caller that got past the gate would usually still end in a 401
 * there; "none of these was consulted" is what shows the refusal came from
 * the gate at the top of the method rather than from further down.
 */
type SpyOnPermissionLayerFunction = () => Array<jest.SpyInstance>;

const spyOnPermissionLayer: SpyOnPermissionLayerFunction =
  (): Array<jest.SpyInstance> => {
    return [
      getJestSpyOn(ModelPermission, "checkCreatePermissions"),
      getJestSpyOn(ModelPermission, "checkReadQueryPermission"),
      getJestSpyOn(ModelPermission, "checkUpdateQueryPermissions"),
      getJestSpyOn(ModelPermission, "checkDeleteQueryPermission"),
    ];
  };

type ExpectPermissionLayerNotConsultedFunction = (
  spies: Array<jest.SpyInstance>,
) => void;

const expectPermissionLayerNotConsulted: ExpectPermissionLayerNotConsultedFunction =
  (spies: Array<jest.SpyInstance>): void => {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  };

describe("DatabaseService runs the login check before its hooks", () => {
  let service: DatabaseService<BaseModel>;
  let hooks: HookSpies;
  let getRepository: jest.SpyInstance;
  let permissionChecks: Array<jest.SpyInstance>;

  beforeEach(() => {
    jest.restoreAllMocks();

    /*
     * Monitor is not public for any request type, so every operation is
     * gated (asserted in the first test below, so a Monitor that ever gained
     * a Public permission fails loudly instead of quietly emptying the
     * anonymous rows of meaning).
     */
    service = new DatabaseService<Monitor>(
      Monitor,
    ) as unknown as DatabaseService<BaseModel>;
    hooks = stubHooksWithSentinel(service);
    getRepository = stubRepositoryToFailLoudly(service);
    stubPermissionByModelChecks();
    permissionChecks = spyOnPermissionLayer();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses a model that is public for no request type, so every operation below is gated", () => {
    const monitor: Monitor = new Monitor();

    expect(monitor.createRecordPermissions).not.toContain(Permission.Public);
    expect(monitor.readRecordPermissions).not.toContain(Permission.Public);
    expect(monitor.updateRecordPermissions).not.toContain(Permission.Public);
    expect(monitor.deleteRecordPermissions).not.toContain(Permission.Public);
  });

  describe("an anonymous caller is refused with a 401 before any hook runs", () => {
    OPERATIONS.forEach((operation: OperationFixture): void => {
      describe(operation.name, () => {
        it.each(ANONYMOUS_CALLERS)(
          "refuses $name with NotAuthenticatedException (401) before the hooks, the permission layer or the repository",
          async (caller: CallerFixture) => {
            await expectNotAuthenticated(
              operation.run(service, copyProps(caller.props)),
              operation.requestType,
              "Monitor",
            );

            for (const hookName of HOOK_NAMES) {
              expect(hooks[hookName]).not.toHaveBeenCalled();
            }

            expectPermissionLayerNotConsulted(permissionChecks);
            expect(getRepository).not.toHaveBeenCalled();
          },
        );
      });
    });
  });

  describe("every kind of credential still passes the login check and reaches the hook", () => {
    OPERATIONS.forEach((operation: OperationFixture): void => {
      describe(operation.name, () => {
        it.each(CREDENTIALED_CALLERS)(
          "lets $name through to " + operation.hook,
          async (caller: CallerFixture) => {
            await expect(
              operation.run(service, copyProps(caller.props)),
            ).rejects.toThrow(HOOK_REACHED);

            expect(hooks[operation.hook]).toHaveBeenCalledTimes(1);

            for (const hookName of HOOK_NAMES) {
              if (hookName !== operation.hook) {
                expect(hooks[hookName]).not.toHaveBeenCalled();
              }
            }
          },
        );
      });
    });

    it("hands the hook the caller's own props, unchanged by the gate", async () => {
      const props: DatabaseCommonInteractionProps = {
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
      };

      await expect(
        operationNamed("findBy").run(service, props),
      ).rejects.toThrow(HOOK_REACHED);

      const findBy: { props: DatabaseCommonInteractionProps } = hooks
        .onBeforeFind.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      };

      expect(findBy.props).toBe(props);
      expect(findBy.props).toEqual({
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
      });
    });
  });

  describe("the gate does not depend on the hooks being run", () => {
    /*
     * ignoreHooks is how internal callers skip the hooks; it must not also
     * skip the login check. The gate sits above the ignoreHooks branch in
     * every method, so an anonymous caller that somehow carries the flag is
     * refused at the same point - before the permission layer, whose own
     * login check would otherwise be the first thing to answer.
     */
    OPERATIONS.forEach((operation: OperationFixture): void => {
      it(`${operation.name} still refuses an anonymous caller that sets ignoreHooks, at the gate`, async () => {
        await expectNotAuthenticated(
          operation.run(service, { tenantId: PROJECT_ID, ignoreHooks: true }),
          operation.requestType,
          "Monitor",
        );

        expectPermissionLayerNotConsulted(permissionChecks);
        expect(getRepository).not.toHaveBeenCalled();
      });
    });
  });

  describe("deletes on a service that does not allow them", () => {
    beforeEach(() => {
      service.setDoNotAllowDelete(true);
    });

    it.each(["deleteBy", "deleteOneBy", "deleteOneById"])(
      "%s answers an anonymous caller 401, not the 400 'Delete not allowed' that used to come first",
      async (operationName: string) => {
        await expectNotAuthenticated(
          operationNamed(operationName).run(service, { tenantId: PROJECT_ID }),
          DatabaseRequestType.Delete,
          "Monitor",
        );

        expect(hooks.onBeforeDelete).not.toHaveBeenCalled();
      },
    );

    it.each(["deleteBy", "deleteOneBy", "deleteOneById"])(
      "%s still answers a logged-in user 400 'Delete not allowed', before the hook",
      async (operationName: string) => {
        await expect(
          operationNamed(operationName).run(service, {
            userId: USER_ID,
            userType: UserType.User,
            tenantId: PROJECT_ID,
          }),
        ).rejects.toThrow(new BadDataException("Delete not allowed"));

        expect(hooks.onBeforeDelete).not.toHaveBeenCalled();
      },
    );

    it("still lets root through to the hook", async () => {
      await expect(
        operationNamed("deleteBy").run(service, { isRoot: true }),
      ).rejects.toThrow(HOOK_REACHED);

      expect(hooks.onBeforeDelete).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * The exemption for public models is keyed on the request type, exactly as it
 * is in the permission layer: a model that anybody may read is not thereby a
 * model anybody may write, and vice versa.
 */
describe("DatabaseService's login check honours Permission.Public per request type", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Probe - publicly readable, not publicly writable", () => {
    let service: DatabaseService<BaseModel>;
    let hooks: HookSpies;
    let getRepository: jest.SpyInstance;

    beforeEach(() => {
      jest.restoreAllMocks();
      service = new DatabaseService<Probe>(
        Probe,
      ) as unknown as DatabaseService<BaseModel>;
      hooks = stubHooksWithSentinel(service);
      getRepository = stubRepositoryToFailLoudly(service);
      stubPermissionByModelChecks();
    });

    it("is public for read and for nothing else", () => {
      const probe: Probe = new Probe();

      expect(probe.readRecordPermissions).toContain(Permission.Public);
      expect(probe.createRecordPermissions).not.toContain(Permission.Public);
      expect(probe.updateRecordPermissions).not.toContain(Permission.Public);
      expect(probe.deleteRecordPermissions).not.toContain(Permission.Public);
    });

    ["findBy", "findOneBy", "findOneById"].forEach(
      (operationName: string): void => {
        it.each(ANONYMOUS_CALLERS)(
          `${operationName} lets $name through to onBeforeFind`,
          async (caller: CallerFixture) => {
            await expect(
              operationNamed(operationName).run(
                service,
                copyProps(caller.props),
              ),
            ).rejects.toThrow(HOOK_REACHED);

            expect(hooks.onBeforeFind).toHaveBeenCalledTimes(1);
          },
        );
      },
    );

    [
      "create",
      "updateBy",
      "updateOneById",
      "deleteBy",
      "deleteOneById",
      "hardDeleteBy",
    ].forEach((operationName: string): void => {
      it(`${operationName} still refuses an anonymous caller with a 401 before the hook`, async () => {
        const operation: OperationFixture = operationNamed(operationName);

        await expectNotAuthenticated(
          operation.run(service, { tenantId: PROJECT_ID }),
          operation.requestType,
          "Probe",
        );

        expect(hooks[operation.hook]).not.toHaveBeenCalled();
        expect(getRepository).not.toHaveBeenCalled();
      });
    });
  });

  describe("StatusPageSubscriber - publicly creatable, not publicly readable", () => {
    let service: DatabaseService<BaseModel>;
    let hooks: HookSpies;
    let getRepository: jest.SpyInstance;

    beforeEach(() => {
      jest.restoreAllMocks();
      service = new DatabaseService<StatusPageSubscriber>(
        StatusPageSubscriber,
      ) as unknown as DatabaseService<BaseModel>;
      hooks = stubHooksWithSentinel(service);
      getRepository = stubRepositoryToFailLoudly(service);
      stubPermissionByModelChecks();
    });

    it("is public for create and for nothing else", () => {
      const subscriber: StatusPageSubscriber = new StatusPageSubscriber();

      expect(subscriber.createRecordPermissions).toContain(Permission.Public);
      expect(subscriber.readRecordPermissions).not.toContain(Permission.Public);
      expect(subscriber.updateRecordPermissions).not.toContain(
        Permission.Public,
      );
      expect(subscriber.deleteRecordPermissions).not.toContain(
        Permission.Public,
      );
    });

    it.each(ANONYMOUS_CALLERS)(
      "create lets $name through to onBeforeCreate - a status page visitor subscribing has no session",
      async (caller: CallerFixture) => {
        await expect(
          operationNamed("create").run(service, copyProps(caller.props)),
        ).rejects.toThrow(HOOK_REACHED);

        expect(hooks.onBeforeCreate).toHaveBeenCalledTimes(1);
      },
    );

    ["findBy", "findOneById", "updateBy", "deleteBy", "hardDeleteBy"].forEach(
      (operationName: string): void => {
        it(`${operationName} still refuses an anonymous caller with a 401 before the hook`, async () => {
          const operation: OperationFixture = operationNamed(operationName);

          await expectNotAuthenticated(
            operation.run(service, { tenantId: PROJECT_ID }),
            operation.requestType,
            "Status Page Subscriber",
          );

          expect(hooks[operation.hook]).not.toHaveBeenCalled();
          expect(getRepository).not.toHaveBeenCalled();
        });
      },
    );
  });
});

/*
 * The hook refusals that anonymous callers actually used to receive, reached
 * through the real services' public methods with the real hooks in place
 * (spied, but calling through). Each anonymous case now gets the 401 without
 * the hook running; each API-key case - an API key has no userId either, but
 * it IS a credential and passes the gate - still gets the hook's own answer,
 * which is what shows the gate changed who is refused, not what the hooks do.
 */
describe("hook refusals an anonymous caller used to get are now 401s", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("ProjectService.findBy - the regression that motivated the gate", () => {
    let onBeforeFind: jest.SpyInstance;

    beforeEach(() => {
      jest.restoreAllMocks();
      onBeforeFind = getJestSpyOn(ProjectService, "onBeforeFind");
    });

    it("rejects an anonymous read with NotAuthenticatedException instead of resolving to []", async () => {
      const getRepository: jest.SpyInstance =
        stubRepositoryToFailLoudly(ProjectService);
      const props: DatabaseCommonInteractionProps = {};

      await expectNotAuthenticated(
        ProjectService.findBy({
          query: {},
          select: { _id: true, name: true },
          limit: 10,
          skip: 0,
          props,
        }),
        DatabaseRequestType.Read,
        "Project",
      );

      /*
       * onBeforeFind is what turned this into a root read of the zero id:
       * it never ran, so the caller was never promoted to root.
       */
      expect(onBeforeFind).not.toHaveBeenCalled();
      expect(props.isRoot).toBeUndefined();
      expect(getRepository).not.toHaveBeenCalled();
    });

    it.each(ANONYMOUS_CALLERS)(
      "rejects $name the same way",
      async (caller: CallerFixture) => {
        stubRepositoryToFailLoudly(ProjectService);

        await expectNotAuthenticated(
          ProjectService.findBy({
            query: {},
            select: { _id: true },
            limit: 10,
            skip: 0,
            props: copyProps(caller.props),
          }),
          DatabaseRequestType.Read,
          "Project",
        );

        expect(onBeforeFind).not.toHaveBeenCalled();
      },
    );

    it("still answers a logged-in user who belongs to no project with [] through the zero-id root read - the answer the anonymous caller used to get", async () => {
      /*
       * The hook's own behaviour is unchanged, and this is it: no project ids
       * means "read as root, but only the zero id". Before the gate, an
       * anonymous caller satisfied the same condition and got this same
       * empty 200 - which gives the browser client no reason to suspect an
       * expired session, so it never refreshed one.
       */
      const find: jest.Mock = jest.fn(async (): Promise<Array<Project>> => {
        return [];
      });
      getJestSpyOn(ProjectService, "getRepository").mockReturnValue({ find });

      const props: DatabaseCommonInteractionProps = {
        userId: USER_ID,
        userType: UserType.User,
        userGlobalAccessPermission: {
          projectIds: [],
          globalPermissions: [Permission.CurrentUser, Permission.User],
          _type: "UserGlobalAccessPermission",
        },
      };

      const projects: Array<Project> = await ProjectService.findBy({
        query: {},
        select: { _id: true, name: true },
        limit: 10,
        skip: 0,
        props,
      });

      expect(projects).toEqual([]);
      expect(onBeforeFind).toHaveBeenCalledTimes(1);
      expect(props.isRoot).toBe(true);
      expect(find).toHaveBeenCalledTimes(1);
      expect(
        (find.mock.calls[0]![0] as { where: { _id: unknown } }).where._id,
      ).toBe(ObjectID.getZeroObjectID().toString());
    });
  });

  describe("ProjectService.create", () => {
    let onBeforeCreate: jest.SpyInstance;
    let getRepository: jest.SpyInstance;

    const makeProject: () => Project = (): Project => {
      const project: Project = new Project();
      project.name = "Acme Monitoring";
      return project;
    };

    beforeEach(() => {
      jest.restoreAllMocks();
      onBeforeCreate = getJestSpyOn(ProjectService, "onBeforeCreate");
      getRepository = stubRepositoryToFailLoudly(ProjectService);
    });

    it("answers an anonymous caller 401, where the hook used to answer 422 'User should be logged in to create the project.'", async () => {
      await expectNotAuthenticated(
        ProjectService.create({ data: makeProject(), props: {} }),
        DatabaseRequestType.Create,
        "Project",
      );

      expect(onBeforeCreate).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    });

    it("still answers an API key with the hook's 422 - a key cannot own a project", async () => {
      await expect(
        ProjectService.create({
          data: makeProject(),
          props: { userType: UserType.API, tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(
          "User should be logged in to create the project.",
        ),
      );

      expect(onBeforeCreate).toHaveBeenCalledTimes(1);
      expect(getRepository).not.toHaveBeenCalled();
    });
  });

  describe("UserTotpAuthService.create", () => {
    let onBeforeCreate: jest.SpyInstance;
    let getRepository: jest.SpyInstance;

    beforeEach(() => {
      jest.restoreAllMocks();
      onBeforeCreate = getJestSpyOn(UserTotpAuthService, "onBeforeCreate");
      getRepository = stubRepositoryToFailLoudly(UserTotpAuthService);
    });

    it("answers an anonymous caller 401, where the hook used to answer 400 'User id is required'", async () => {
      await expectNotAuthenticated(
        UserTotpAuthService.create({ data: new UserTotpAuth(), props: {} }),
        DatabaseRequestType.Create,
        "TOTP Auth",
      );

      expect(onBeforeCreate).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    });

    it("still answers an API key with the hook's 400", async () => {
      await expect(
        UserTotpAuthService.create({
          data: new UserTotpAuth(),
          props: { userType: UserType.API, tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(new BadDataException("User id is required"));

      expect(onBeforeCreate).toHaveBeenCalledTimes(1);
      expect(getRepository).not.toHaveBeenCalled();
    });
  });

  describe("UserOnCallShiftReminderService.create", () => {
    let onBeforeCreate: jest.SpyInstance;
    let getRepository: jest.SpyInstance;

    beforeEach(() => {
      jest.restoreAllMocks();
      onBeforeCreate = getJestSpyOn(
        UserOnCallShiftReminderService,
        "onBeforeCreate",
      );
      getRepository = stubRepositoryToFailLoudly(
        UserOnCallShiftReminderService,
      );
    });

    it("answers an anonymous caller 401, where the hook used to answer 400 'userId is required'", async () => {
      await expectNotAuthenticated(
        UserOnCallShiftReminderService.create({
          data: new UserOnCallShiftReminder(),
          props: { tenantId: PROJECT_ID },
        }),
        DatabaseRequestType.Create,
        "On-Call Shift Reminder",
      );

      expect(onBeforeCreate).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    });

    it("still answers an API key with the hook's 400", async () => {
      await expect(
        UserOnCallShiftReminderService.create({
          data: new UserOnCallShiftReminder(),
          props: { userType: UserType.API, tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(new BadDataException("userId is required"));

      expect(onBeforeCreate).toHaveBeenCalledTimes(1);
      expect(getRepository).not.toHaveBeenCalled();
    });
  });

  describe("UserService.updateBy turning off two factor authentication", () => {
    let onBeforeUpdate: jest.SpyInstance;
    let getRepository: jest.SpyInstance;

    type TurnOffTwoFactorFunction = (
      props: DatabaseCommonInteractionProps,
    ) => Promise<number>;

    const turnOffTwoFactor: TurnOffTwoFactorFunction = (
      props: DatabaseCommonInteractionProps,
    ): Promise<number> => {
      return UserService.updateBy({
        query: { _id: USER_ID.toString() },
        data: { enableTwoFactorAuth: false },
        limit: 1,
        skip: 0,
        props,
      });
    };

    beforeEach(() => {
      jest.restoreAllMocks();
      onBeforeUpdate = getJestSpyOn(UserService, "onBeforeUpdate");
      getRepository = stubRepositoryToFailLoudly(UserService);
    });

    it("answers an anonymous caller 401, where the hook's owner guard used to answer 400", async () => {
      await expectNotAuthenticated(
        turnOffTwoFactor({}),
        DatabaseRequestType.Update,
        "User",
      );

      expect(onBeforeUpdate).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    });

    it("still answers an API key with the hook's 400 - a key has no account of its own", async () => {
      await expect(
        turnOffTwoFactor({ userType: UserType.API, tenantId: PROJECT_ID }),
      ).rejects.toThrow(
        new BadDataException(
          "You can only turn off two factor authentication for your own account.",
        ),
      );

      expect(onBeforeUpdate).toHaveBeenCalledTimes(1);
      expect(getRepository).not.toHaveBeenCalled();
    });
  });

  describe("UserNotificationRuleService.create", () => {
    let onBeforeCreate: jest.SpyInstance;
    let getRepository: jest.SpyInstance;

    beforeEach(() => {
      jest.restoreAllMocks();
      onBeforeCreate = getJestSpyOn(
        UserNotificationRuleService,
        "onBeforeCreate",
      );
      getRepository = stubRepositoryToFailLoudly(UserNotificationRuleService);
    });

    it("answers an anonymous caller 401, where the hook used to answer 400 'A notification rule must belong to a user.'", async () => {
      await expectNotAuthenticated(
        UserNotificationRuleService.create({
          data: new UserNotificationRule(),
          props: { tenantId: PROJECT_ID },
        }),
        DatabaseRequestType.Create,
        "Notification Rule",
      );

      expect(onBeforeCreate).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    });

    it("still answers an API key that names no owner with the hook's 400", async () => {
      await expect(
        UserNotificationRuleService.create({
          data: new UserNotificationRule(),
          props: { userType: UserType.API, tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow("A notification rule must belong to a user.");

      expect(onBeforeCreate).toHaveBeenCalledTimes(1);
      expect(getRepository).not.toHaveBeenCalled();
    });
  });
});
