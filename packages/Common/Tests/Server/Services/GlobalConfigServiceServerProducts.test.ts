import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_SERVER_PRODUCTS_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE PRODUCTS A SERVER SWITCHED OFF, AS GLOBALCONFIG KEEPS THEM (#6815).
 *
 * serverProducts is written only through Admin Dashboard > Settings >
 * Products' own route, as OneUptime, which keeps the list to products a
 * server may switch off and records who changed it. Master admins bypass
 * the (empty) column ACLs, so without the guard a PUT through the CRUD API
 * could switch off Project Settings, or change the list in someone else's
 * name.
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

const SETTINGS: Record<string, unknown> = {
  off: ["logs", "project-settings"],
  changedAt: "2026-11-12T10:00:00.000Z",
  changedByUserId: "someone-else",
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

describe("who may write the server's products", () => {
  test("only serverProducts, a real JSON column nobody may read or write through the API", () => {
    expect([...ROOT_ONLY_SERVER_PRODUCTS_COLUMNS]).toEqual(["serverProducts"]);
    expect(new GlobalConfig().isTableColumn("serverProducts")).toBe(true);
  });

  test.each([[{}], [null], [SETTINGS]])(
    "a master admin writing %j through the CRUD API is refused, with where to change it",
    async (value: unknown) => {
      const refusal: Promise<unknown> = hooks.onBeforeUpdate(
        makeUpdateBy({ serverProducts: value }, MASTER_ADMIN_PROPS),
      );

      await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(refusal).rejects.toThrow(
        "The products switched off on this server are changed on Admin Dashboard > Settings > Products, and cannot be written here.",
      );
    },
  );

  test("hidden among ordinary settings, it is refused too", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, serverProducts: SETTINGS },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("on create too", async () => {
    const model: GlobalConfig = new GlobalConfig();
    model.id = ObjectID.getZeroObjectID();
    model.serverProducts = SETTINGS as never;

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
        makeUpdateBy({ serverProducts: SETTINGS }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("writing the server's products", () => {
  test("one statement on the one row, without hooks", async () => {
    await GlobalConfigService.writeServerProducts(SETTINGS as never);

    expect(updateColumns).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = updateColumns.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["id"].toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(args["data"]).toEqual({ serverProducts: SETTINGS });
  });
});
