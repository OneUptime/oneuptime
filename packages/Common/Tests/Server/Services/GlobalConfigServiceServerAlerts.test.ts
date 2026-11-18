import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_SERVER_ALERT_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
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
 * WHERE MASTER ADMINS ARE TOLD WHEN EMAIL OR THE PROBES STOP, AND WHAT WAS
 * LAST TOLD, AS GLOBALCONFIG KEEPS THEM (#6879).
 *
 * The number to text and the push switch are a master admin's to choose,
 * through the Admin Dashboard's own settings form. What the job last told
 * (serverAlertState) is the job's alone: master admins bypass the (empty)
 * column ACLs, so through the CRUD API a session could otherwise mark the
 * server's email as told failing when nobody was, and keep the message
 * from going out.
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

const STATE: Record<string, unknown> = {
  email: {
    told: "failing",
    toldAt: "2026-11-18T10:00:00.000Z",
    triedAt: "2026-11-18T10:00:00.000Z",
  },
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

const makeCreateBy: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => CreateBy<GlobalConfig> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): CreateBy<GlobalConfig> => {
  return { data, props } as unknown as CreateBy<GlobalConfig>;
};

beforeEach(() => {
  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(new GlobalConfig());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the three columns", () => {
  test("a phone number, a switch and the job's JSON, nobody's to read or write through the API by its column", () => {
    const model: GlobalConfig = new GlobalConfig();

    expect(model.getTableColumnMetadata("serverAlertPhoneNumber").type).toBe(
      TableColumnType.Phone,
    );
    expect(model.getTableColumnMetadata("isServerAlertPushOn").type).toBe(
      TableColumnType.Boolean,
    );
    expect(model.getTableColumnMetadata("serverAlertState").type).toBe(
      TableColumnType.JSON,
    );

    for (const column of [
      "serverAlertPhoneNumber",
      "isServerAlertPushOn",
      "serverAlertState",
    ]) {
      expect(model.getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
    }
  });
});

describe("what the job last told", () => {
  test("is the job's alone", () => {
    expect([...ROOT_ONLY_SERVER_ALERT_COLUMNS]).toEqual(["serverAlertState"]);
  });

  test.each([[{}], [null], [STATE]])(
    "a master admin writing %j through the CRUD API is refused",
    async (value: unknown) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ serverAlertState: value }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("hidden among ordinary settings, it is refused too, on create as on update", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { isServerAlertPushOn: false, serverAlertState: STATE },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(
      hooks.onBeforeCreate(
        makeCreateBy({ serverAlertState: STATE }, MASTER_ADMIN_PROPS),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("the job, as OneUptime, writes it", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ serverAlertState: STATE }, ROOT_PROPS),
      ),
    ).resolves.toBeTruthy();
  });
});

describe("where it goes", () => {
  test("a master admin chooses the number and the switch", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { serverAlertPhoneNumber: "+15550100", isServerAlertPushOn: false },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).resolves.toBeTruthy();
  });
});
