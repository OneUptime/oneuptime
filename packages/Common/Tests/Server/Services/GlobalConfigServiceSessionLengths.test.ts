import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  Service,
} from "../../../Server/Services/GlobalConfigService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  SEPARATE_SSO_SESSION_LENGTHS_PROBLEM,
  SESSION_IDLE_TIMEOUT_PROBLEM,
  SESSION_LENGTH_PROBLEM,
  SessionLengths,
} from "../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * HOW LONG SIGN-INS LAST, AS GLOBALCONFIG TAKES IT (GlobalConfigService,
 * Types/UserSession/SessionLength.ts).
 *
 *   - a write may set each session length to a whole number of minutes in
 *     its range, or empty for the default, and the SSO switch to true or
 *     false; anything else is refused with what it may be, on create and on
 *     update alike, before anything is written;
 *   - a write that changes them applies them to the people signed in now:
 *     every server reads them again (forget, and SessionLengthsChanged to
 *     the others), and every session already past them is ended
 *     (UserSessionService.endSessionsPastLengths) - and a failure to end
 *     them never fails the change, as each one is refused at its next
 *     request and renewal anyway;
 *   - a write that leaves them alone does none of that.
 *
 * The same change against real tables is in
 * UserSessionLengthsPostgres.test.ts.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
  onUpdateSuccess(
    onUpdate: OnUpdate<GlobalConfig>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const makeUpdateBy: (
  data: Record<string, unknown>,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data,
    limit: 1,
    skip: 0,
    props: MASTER_ADMIN_PROPS,
  } as unknown as UpdateBy<GlobalConfig>;
};

const makeCreateBy: (
  data: Record<string, unknown>,
) => CreateBy<GlobalConfig> = (
  data: Record<string, unknown>,
): CreateBy<GlobalConfig> => {
  const model: GlobalConfig = new GlobalConfig();
  model.id = ObjectID.getZeroObjectID();
  Object.assign(model, data);

  return {
    data: model,
    props: MASTER_ADMIN_PROPS,
  } as unknown as CreateBy<GlobalConfig>;
};

const SET: SessionLengths = {
  standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
  sso: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
};

let fake: FakeEnterpriseModule;
let announced: Array<RealtimeAccessChange>;
let endSessionsPastLengths: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  fake = installFakeEnterpriseModule({ userSessionLengths: SET });
  announced = [];
  jest
    .spyOn(RealtimeAccessChanges, "announce")
    .mockImplementation((change: RealtimeAccessChange): void => {
      announced.push(change);
    });
  endSessionsPastLengths = jest
    .spyOn(UserSessionService, "endSessionsPastLengths")
    .mockResolvedValue(3 as never);
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("what a write may set", () => {
  test.each([
    ["a session length", { sessionLengthInMinutes: 480 }],
    ["an idle timeout", { sessionIdleTimeoutInMinutes: 15 }],
    [
      "SSO sign-ins' own",
      {
        useSeparateSsoSessionLengths: true,
        ssoSessionLengthInMinutes: 60,
        ssoSessionIdleTimeoutInMinutes: 43200,
      },
    ],
    [
      "every length back to its default",
      {
        sessionLengthInMinutes: null,
        sessionIdleTimeoutInMinutes: null,
        useSeparateSsoSessionLengths: false,
        ssoSessionLengthInMinutes: null,
        ssoSessionIdleTimeoutInMinutes: null,
      },
    ],
  ])(
    "%s is taken, on update and on create",
    async (_label: string, data: Record<string, unknown>) => {
      await expect(
        hooks.onBeforeUpdate(makeUpdateBy(data)),
      ).resolves.toBeDefined();
      await expect(
        hooks.onBeforeCreate(makeCreateBy(data)),
      ).resolves.toBeDefined();
    },
  );

  test.each([
    [
      "a session length shorter than 15 minutes",
      { sessionLengthInMinutes: 10 },
      SESSION_LENGTH_PROBLEM,
    ],
    [
      "a session length longer than a year",
      { ssoSessionLengthInMinutes: 525601 },
      SESSION_LENGTH_PROBLEM,
    ],
    [
      "a fraction of a minute",
      { sessionLengthInMinutes: 90.5 },
      SESSION_LENGTH_PROBLEM,
    ],
    [
      "a number written as text",
      { sessionLengthInMinutes: "480" },
      SESSION_LENGTH_PROBLEM,
    ],
    [
      "an idle timeout longer than 30 days",
      { sessionIdleTimeoutInMinutes: 43201 },
      SESSION_IDLE_TIMEOUT_PROBLEM,
    ],
    [
      "a negative idle timeout",
      { ssoSessionIdleTimeoutInMinutes: -1 },
      SESSION_IDLE_TIMEOUT_PROBLEM,
    ],
    [
      "a switch that is no boolean",
      { useSeparateSsoSessionLengths: "yes" },
      SEPARATE_SSO_SESSION_LENGTHS_PROBLEM,
    ],
  ])(
    "%s is refused with what it may be, on update and on create",
    async (_label: string, data: Record<string, unknown>, problem: string) => {
      await expect(hooks.onBeforeUpdate(makeUpdateBy(data))).rejects.toThrow(
        new BadDataException(problem),
      );
      await expect(hooks.onBeforeCreate(makeCreateBy(data))).rejects.toThrow(
        new BadDataException(problem),
      );
    },
  );

  test("one bad value refuses the whole write, whatever else it holds", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({
          disableSignup: true,
          sessionLengthInMinutes: 480,
          sessionIdleTimeoutInMinutes: 5,
        }),
      ),
    ).rejects.toThrow(SESSION_IDLE_TIMEOUT_PROBLEM);
  });

  test("writesSessionLengths knows a write that touches them, null included, from one that does not", () => {
    expect(Service.writesSessionLengths({ sessionLengthInMinutes: null })).toBe(
      true,
    );
    expect(
      Service.writesSessionLengths({ useSeparateSsoSessionLengths: false }),
    ).toBe(true);
    expect(Service.writesSessionLengths({ disableSignup: true })).toBe(false);
    expect(
      Service.writesSessionLengths({ sessionLengthInMinutes: undefined }),
    ).toBe(false);
    expect(Service.writesSessionLengths(null)).toBe(false);
  });
});

describe("a change applies to the people signed in now", () => {
  test("every server reads them again, and every session already past them is ended", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy({ sessionLengthInMinutes: 480 }),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    expect(fake.forgetUserSessionLengthsCount).toBe(1);
    expect(announced).toEqual([
      { kind: RealtimeAccessChangeKind.SessionLengthsChanged },
    ]);
    // Ended under the lengths read after the change.
    expect(endSessionsPastLengths).toHaveBeenCalledWith(SET);
  });

  test("removing them is a change too: every server reads them again, and nobody is ended", async () => {
    fake.userSessionLengths = null;

    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy({ sessionLengthInMinutes: null }),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    expect(fake.forgetUserSessionLengthsCount).toBe(1);
    expect(announced).toEqual([
      { kind: RealtimeAccessChangeKind.SessionLengthsChanged },
    ]);
    expect(endSessionsPastLengths).toHaveBeenCalledWith(null);
  });

  test("a failure to end the sessions never fails the change: they are refused at their next request instead", async () => {
    endSessionsPastLengths.mockRejectedValue(
      new Error("the database went away") as never,
    );

    await expect(
      hooks.onUpdateSuccess(
        {
          updateBy: makeUpdateBy({ sessionIdleTimeoutInMinutes: 30 }),
          carryForward: undefined,
        } as unknown as OnUpdate<GlobalConfig>,
        [ObjectID.getZeroObjectID()],
      ),
    ).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("lengths that cannot be read after the change never fail it either", async () => {
    fake.userSessionLengthsError = new Error("not read yet");

    await expect(
      hooks.onUpdateSuccess(
        {
          updateBy: makeUpdateBy({ sessionLengthInMinutes: 60 }),
          carryForward: undefined,
        } as unknown as OnUpdate<GlobalConfig>,
        [ObjectID.getZeroObjectID()],
      ),
    ).resolves.toBeDefined();
    expect(endSessionsPastLengths).not.toHaveBeenCalled();
  });

  test("a write that leaves them alone changes nothing about anyone's sign-in", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy({ disableSignup: true }),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    expect(fake.forgetUserSessionLengthsCount).toBe(0);
    expect(
      announced.filter((change: RealtimeAccessChange): boolean => {
        return change.kind === RealtimeAccessChangeKind.SessionLengthsChanged;
      }),
    ).toEqual([]);
    expect(endSessionsPastLengths).not.toHaveBeenCalled();
  });

  test("on the Community Edition a change ends nothing: there are no lengths to hold anyone to", async () => {
    uninstallEnterpriseModule();

    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy({ sessionLengthInMinutes: null }),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    expect(endSessionsPastLengths).toHaveBeenCalledWith(null);
  });
});
