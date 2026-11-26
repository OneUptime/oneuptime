import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  HELP_AND_SUPPORT_WRITTEN_HERE_MESSAGE,
  ROOT_ONLY_HELP_AND_SUPPORT_COLUMNS,
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
 * WHERE THE SERVER SENDS ITS PEOPLE FOR HELP, AS GLOBALCONFIG KEEPS IT
 * (#10864-#10866).
 *
 * helpAndSupport is written only through Admin Dashboard > Settings > Help
 * and Support's own route, as OneUptime, which accepts only https, http and
 * mailto links, valid addresses and plain text. Master admins bypass the
 * (empty) column ACLs, so without the guard a PUT through the CRUD API could
 * store a javascript: link in every person's Help menu.
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

const UNSAFE_SETTINGS: Record<string, unknown> = {
  chat: { choice: "link", value: "javascript:alert(document.cookie)" },
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

describe("who may write where the server sends people for help", () => {
  test("only helpAndSupport, a real JSON column nobody may read or write through the API", () => {
    expect([...ROOT_ONLY_HELP_AND_SUPPORT_COLUMNS]).toEqual(["helpAndSupport"]);
    expect(new GlobalConfig().isTableColumn("helpAndSupport")).toBe(true);
  });

  test.each([[{}], [null], [UNSAFE_SETTINGS]])(
    "a master admin writing %j through the CRUD API is refused, with where to change it",
    async (value: unknown) => {
      const refusal: Promise<unknown> = hooks.onBeforeUpdate(
        makeUpdateBy({ helpAndSupport: value }, MASTER_ADMIN_PROPS),
      );

      await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(refusal).rejects.toThrow(
        HELP_AND_SUPPORT_WRITTEN_HERE_MESSAGE,
      );
    },
  );

  test("says where to change it", () => {
    expect(HELP_AND_SUPPORT_WRITTEN_HERE_MESSAGE).toBe(
      "Where this server sends people for help is changed on Admin Dashboard > Settings > Help and Support, which checks every link and address, and cannot be written here.",
    );
  });

  test("hidden among ordinary settings, it is refused too", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, helpAndSupport: UNSAFE_SETTINGS },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("on create too", async () => {
    const model: GlobalConfig = new GlobalConfig();
    model.id = ObjectID.getZeroObjectID();
    model.helpAndSupport = UNSAFE_SETTINGS as never;

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
        makeUpdateBy(
          { helpAndSupport: { gitHub: { choice: "hidden" } } },
          ROOT_PROPS,
        ),
      ),
    ).resolves.toBeDefined();
  });
});

/*
 * Seeding it from the server's configuration (#10938): one statement that
 * holds to nothing being saved, so an admin's save, or another server's
 * seed, is never overwritten, and says whether it wrote.
 */
describe("seeding it from the server's configuration", () => {
  test("writes only while nothing is saved, in one statement", async () => {
    const compareAndSet: ReturnType<typeof jest.spyOn> = jest
      .spyOn(GlobalConfigService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true as never);

    expect(
      await GlobalConfigService.seedHelpAndSupport({
        gitHub: { choice: "hidden" },
        seededFromConfiguration: ["gitHub"],
      }),
    ).toBe(true);

    expect(compareAndSet).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = compareAndSet.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["id"].toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(args["data"]).toEqual({
      helpAndSupport: {
        gitHub: { choice: "hidden" },
        seededFromConfiguration: ["gitHub"],
      },
    });
    expect(args["expectedData"]).toEqual({ helpAndSupport: null });
    // Never the plain write, which would overwrite what an admin saved.
    expect(updateColumns).not.toHaveBeenCalled();
  });

  test("says when the settings were saved before, and nothing was written", async () => {
    jest
      .spyOn(GlobalConfigService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(false as never);

    expect(
      await GlobalConfigService.seedHelpAndSupport({
        chat: { choice: "hidden" },
      }),
    ).toBe(false);
  });
});

describe("writing it", () => {
  test("one statement on the one row, without hooks", async () => {
    await GlobalConfigService.writeHelpAndSupport({
      gitHub: { choice: "hidden" },
    });

    expect(updateColumns).toHaveBeenCalledTimes(1);

    const args: Record<string, any> = updateColumns.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["id"].toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(args["data"]).toEqual({
      helpAndSupport: { gitHub: { choice: "hidden" } },
    });
  });
});
