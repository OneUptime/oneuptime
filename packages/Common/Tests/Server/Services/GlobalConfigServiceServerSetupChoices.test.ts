import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_SERVER_SETUP_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { ServerSetupCheckId } from "../../../Types/ServerSetup/ServerSetupChecklist";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT ADMINS CHOSE ON THE SETUP CHECKLIST, AS GLOBALCONFIG KEEPS IT (#6824).
 *
 * serverSetupChoices holds a check the server does without, one done some
 * way the server cannot see, who chose each and when, and each admin's
 * "Hide" of the card. It is written only through the checklist's own
 * routes, as OneUptime: master admins bypass the (empty) column ACLs, and a
 * PUT through the CRUD API could otherwise skip email in someone else's
 * name, or hide the card for another admin. Its writes are bookkeeping: one
 * statement, no hooks, the row's updatedAt left as it was.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
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

const CHOICES: Record<string, unknown> = {
  choices: {
    [ServerSetupCheckId.SmsAndCalls]: {
      kind: "skipped",
      at: "2026-11-10T09:30:00.000Z",
      byUserId: "someone-else",
    },
  },
  hiddenBy: {},
};

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

let updateColumns: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  updateColumns = jest
    .spyOn(GlobalConfigService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(new GlobalConfig());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may write the checklist's choices", () => {
  test("only serverSetupChoices, a real column nobody may read or write through the API", () => {
    expect([...ROOT_ONLY_SERVER_SETUP_COLUMNS]).toEqual([
      "serverSetupChoices",
    ]);
    expect(new GlobalConfig().isTableColumn("serverSetupChoices")).toBe(true);
  });

  test.each([[{}], [null], [CHOICES]])(
    "a master admin writing %j through the CRUD API is refused",
    async (value: unknown) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ serverSetupChoices: value }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("hidden among ordinary settings, it is refused too", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, serverSetupChoices: {} },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("on create too", async () => {
    const model: GlobalConfig = new GlobalConfig();
    model.id = ObjectID.getZeroObjectID();
    model.serverSetupChoices = {};

    await expect(
      hooks.onBeforeCreate({
        data: model,
        props: MASTER_ADMIN_PROPS,
      } as unknown as CreateBy<GlobalConfig>),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a master admin's ordinary save, without it, goes on", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
  });

  test("OneUptime itself may write it", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ serverSetupChoices: CHOICES }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("writing the choices", () => {
  test("one statement on the one row, no hooks, updatedAt kept", async () => {
    await GlobalConfigService.writeServerSetupChoices(CHOICES as never);

    expect(updateColumns).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = updateColumns.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["id"].toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(args["skipUpdateDateColumn"]).toBe(true);
    expect(args["data"]).toEqual({ serverSetupChoices: CHOICES });
  });
});
