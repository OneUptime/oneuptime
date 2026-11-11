import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_SENDING_HEALTH_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  ServerSendingChannel,
  ServerSendingHealth,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE SERVER REMEMBERS OF ITS OWN SENDS, AS GLOBALCONFIG KEEPS IT (#6825).
 *
 *   - serverSendingHealth is written by OneUptime alone: master admins
 *     bypass the (empty) column ACLs, and a PUT through the CRUD API could
 *     otherwise say email works on a server that never sent one, and take
 *     away the banner that says it does not;
 *   - saving a channel's settings starts it again at untested: what it
 *     remembers was learned with other settings. Only that channel - email
 *     settings leave SMS alone - and a failure to forget never fails the save.
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

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

const makeUpdateBy: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<GlobalConfig>;
};

const REMEMBERED: ServerSendingHealth = {
  email: {
    lastSucceededAt: "2026-11-10T10:00:00.000Z",
    lastFailedAt: "2026-11-11T10:00:00.000Z",
    failingSince: "2026-11-11T09:00:00.000Z",
    lastFailure: "535 Authentication failed",
  },
  sms: {
    lastSucceededAt: "2026-11-10T10:00:00.000Z",
    lastFailedAt: null,
    failingSince: null,
    lastFailure: null,
  },
};

let findOneById: ReturnType<typeof jest.spyOn>;
let updateColumns: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  findOneById = jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockImplementation(async (): Promise<GlobalConfig> => {
      const config: GlobalConfig = new GlobalConfig();
      config.serverSendingHealth = JSON.parse(JSON.stringify(REMEMBERED));
      return config;
    });

  updateColumns = jest
    .spyOn(GlobalConfigService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may write what the server remembers", () => {
  test("only serverSendingHealth, a real column", () => {
    expect([...ROOT_ONLY_SENDING_HEALTH_COLUMNS]).toEqual([
      "serverSendingHealth",
    ]);
    expect(new GlobalConfig().isTableColumn("serverSendingHealth")).toBe(true);
  });

  test.each([[{}], [null], [REMEMBERED]])(
    "a master admin writing %j through the CRUD API is refused",
    async (value: unknown) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ serverSendingHealth: value }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("hidden among ordinary settings, it is refused too", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, serverSendingHealth: {} },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("on create too", async () => {
    const model: GlobalConfig = new GlobalConfig();
    model.id = ObjectID.getZeroObjectID();
    model.serverSendingHealth = {};

    await expect(
      hooks.onBeforeCreate({
        data: model,
        props: MASTER_ADMIN_PROPS,
      } as unknown as CreateBy<GlobalConfig>),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("OneUptime itself may write it", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ serverSendingHealth: REMEMBERED }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("saving a channel's settings", () => {
  test("email settings forget email, and only email", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy(
          { smtpHost: "smtp.example.com", smtpPort: 587 },
          MASTER_ADMIN_PROPS,
        ),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    expect(updateColumns).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = updateColumns.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["id"].toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(args["skipUpdateDateColumn"]).toBe(true);
    expect(args["data"]["serverSendingHealth"]).toEqual({
      sms: REMEMBERED.sms,
    });
  });

  test("Twilio settings forget SMS and calls", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy(
          { twilioAuthToken: "new-token" },
          MASTER_ADMIN_PROPS,
        ),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    const args: Record<string, any> = updateColumns.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["data"]["serverSendingHealth"]).toEqual({
      email: REMEMBERED.email,
    });
  });

  test("a save that touches no channel's settings writes nothing", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
        carryForward: undefined,
      } as unknown as OnUpdate<GlobalConfig>,
      [ObjectID.getZeroObjectID()],
    );

    expect(findOneById).not.toHaveBeenCalled();
    expect(updateColumns).not.toHaveBeenCalled();
  });

  test("a channel nothing is remembered for writes nothing", async () => {
    await GlobalConfigService.forgetServerSendingHealthOf([
      ServerSendingChannel.Push,
    ]);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(updateColumns).not.toHaveBeenCalled();
  });

  test("a failure to forget never fails the save", async () => {
    updateColumns.mockRejectedValue(new Error("database went away") as never);

    await expect(
      hooks.onUpdateSuccess(
        {
          updateBy: makeUpdateBy(
            { resendApiKey: "re_new" },
            MASTER_ADMIN_PROPS,
          ),
          carryForward: undefined,
        } as unknown as OnUpdate<GlobalConfig>,
        [ObjectID.getZeroObjectID()],
      ),
    ).resolves.toBeDefined();
  });
});
