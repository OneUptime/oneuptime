import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  MASTER_API_KEY_WRITTEN_HERE_MESSAGE,
  ROOT_ONLY_MASTER_API_KEY_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnCreate,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import UpdateByID from "../../../Server/Types/Database/UpdateByID";
import MasterApiKey from "../../../Server/Utils/MasterApiKey";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import HashedString from "../../../Types/HashedString";
import { MasterApiKeyState } from "../../../Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE SERVER'S MASTER API KEY IS MADE BY ONEUPTIME AND STORED HASHED
 * (#7901), and the generic API can neither write it nor read it back.
 *
 * A master admin reaches GlobalConfig through the generic CRUD API, past
 * its (empty) column ACLs - and so does the master API key itself, which a
 * request makes a master admin. Through it they could have set a key of
 * their choosing, stored as it was sent, or read the key back. Now:
 *
 *   - a write of masterApiKey by anyone but OneUptime is refused, a clear
 *     included, with where the key is made instead;
 *   - OneUptime's own write stores the key's hash, or clears it, and
 *     nothing else: a key as it is never reaches the database;
 *   - a read drops it from what is selected and from what is filtered on;
 *   - createMasterApiKey makes a random key, stores its hash, turns it on
 *     and answers the key - which is in nothing it writes;
 *   - getMasterApiKeyState says whether there is one, never what it is.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
  onBeforeFind(findBy: FindBy<GlobalConfig>): Promise<OnFind<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

const makeUpdateBy: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ZERO_ID },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<GlobalConfig>;
};

const makeFindBy: (
  select: Record<string, unknown>,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => FindBy<GlobalConfig> = (
  select: Record<string, unknown>,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): FindBy<GlobalConfig> => {
  return {
    select,
    query,
    limit: 1,
    skip: 0,
    props,
  } as unknown as FindBy<GlobalConfig>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ROOT_ONLY_MASTER_API_KEY_COLUMNS", () => {
  test("is the master API key's column", () => {
    expect([...ROOT_ONLY_MASTER_API_KEY_COLUMNS]).toEqual(["masterApiKey"]);
  });

  test("which no permission reads or writes by its own column ACL either", () => {
    expect(
      new GlobalConfig().getColumnAccessControlFor("masterApiKey"),
    ).toEqual(expect.objectContaining({ create: [], read: [], update: [] }));
  });
});

describe("writes through the API", () => {
  test.each([
    ["a key of their choosing", KEY],
    ["a key as a HashedString, to be hashed", new HashedString(KEY)],
    ["a hash", new HashedString(MasterApiKey.hash(KEY), true)],
    ["nothing: clearing the key", null],
  ])(
    "a master admin's update with %s is refused, and says where the key is made",
    async (_label: string, value: unknown) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ masterApiKey: value }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toThrow(
        new NotAuthorizedException(MASTER_API_KEY_WRITTEN_HERE_MESSAGE),
      );
    },
  );

  test("the refusal says what to do instead, in a sentence", () => {
    expect(MASTER_API_KEY_WRITTEN_HERE_MESSAGE).toBe(
      "The master API key cannot be set through the API. Create or reset it on Admin Dashboard > Settings > API Key, which shows the new key once.",
    );
  });

  test("an update with the key and another setting is refused whole", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { masterApiKey: KEY, isMasterApiKeyEnabled: true },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a create naming the key is refused", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: { masterApiKey: KEY } as unknown as GlobalConfig,
        props: MASTER_ADMIN_PROPS,
      } as CreateBy<GlobalConfig>),
    ).rejects.toThrow(
      new NotAuthorizedException(MASTER_API_KEY_WRITTEN_HERE_MESSAGE),
    );
  });

  test("turning the key on or off is not affected: the switch is the admin's", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ isMasterApiKeyEnabled: false }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ isMasterApiKeyEnabled: true }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("OneUptime's own writes", () => {
  test("store the key's hash", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { masterApiKey: new HashedString(MasterApiKey.hash(KEY), true) },
          ROOT_PROPS,
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("or clear it", async () => {
    await expect(
      hooks.onBeforeUpdate(makeUpdateBy({ masterApiKey: null }, ROOT_PROPS)),
    ).resolves.toBeDefined();
  });

  test.each([
    ["a key as it is", KEY],
    ["a key as a HashedString still to be hashed", new HashedString(KEY)],
    ["a key marked hashed, but still a key", new HashedString(KEY, true)],
    [
      "a hash as a plain string",
      MasterApiKey.hash(KEY) as unknown as HashedString,
    ],
    [
      "something marked hashed that is no SHA-256",
      new HashedString("not-a-digest", true),
    ],
    [
      "an upper-case digest, which HashedString never writes",
      new HashedString(MasterApiKey.hash(KEY).toUpperCase(), true),
    ],
  ])("never put %s in the database", async (_label: string, value: unknown) => {
    await expect(
      hooks.onBeforeUpdate(makeUpdateBy({ masterApiKey: value }, ROOT_PROPS)),
    ).rejects.toBeInstanceOf(BadDataException);

    await expect(
      hooks.onBeforeCreate({
        data: { masterApiKey: value } as unknown as GlobalConfig,
        props: ROOT_PROPS,
      } as CreateBy<GlobalConfig>),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("reads through the API", () => {
  test("a master admin's read never selects or filters on the key", async () => {
    const result: OnFind<GlobalConfig> = await hooks.onBeforeFind(
      makeFindBy(
        {
          _id: true,
          masterApiKey: true,
          isMasterApiKeyEnabled: true,
          smtpHost: true,
        },
        { _id: ZERO_ID, masterApiKey: MasterApiKey.hash(KEY) },
        MASTER_ADMIN_PROPS,
      ),
    );

    expect(Object.keys(result.findBy.select || {}).sort()).toEqual([
      "_id",
      "isMasterApiKeyEnabled",
      "smtpHost",
    ]);
    expect(result.findBy.query).toEqual({ _id: ZERO_ID });
  });

  test("the branding columns are still dropped with it", async () => {
    const result: OnFind<GlobalConfig> = await hooks.onBeforeFind(
      makeFindBy(
        { masterApiKey: true, brandingProductName: true, disableSignup: true },
        {},
        MASTER_ADMIN_PROPS,
      ),
    );

    expect(Object.keys(result.findBy.select || {})).toEqual(["disableSignup"]);
  });

  test("OneUptime itself (root) reads it: the lookup compares with it", async () => {
    const findBy: FindBy<GlobalConfig> = makeFindBy(
      { masterApiKey: true, isMasterApiKeyEnabled: true },
      { _id: ZERO_ID },
      ROOT_PROPS,
    );

    const result: OnFind<GlobalConfig> = await hooks.onBeforeFind(findBy);

    expect(result.findBy).toBe(findBy);
  });
});

describe("createMasterApiKey", () => {
  type UpdateOneById = (
    updateById: UpdateByID<GlobalConfig>,
  ) => Promise<number>;

  const spyUpdate: (rows: number) => jest.SpiedFunction<UpdateOneById> = (
    rows: number,
  ): jest.SpiedFunction<UpdateOneById> => {
    return getJestSpyOn(GlobalConfigService, "updateOneById").mockResolvedValue(
      rows as never,
    ) as unknown as jest.SpiedFunction<UpdateOneById>;
  };

  const written: (
    update: jest.SpiedFunction<UpdateOneById>,
  ) => UpdateByID<GlobalConfig> = (
    update: jest.SpiedFunction<UpdateOneById>,
  ): UpdateByID<GlobalConfig> => {
    expect(update).toHaveBeenCalledTimes(1);
    return update.mock.calls[0]![0];
  };

  test("makes a random key, and answers it", async () => {
    spyUpdate(1);

    const key: string = await GlobalConfigService.createMasterApiKey();

    expect(MasterApiKey.normalize(key)).toBe(key);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("stores the key's hash on the server's settings row, as OneUptime itself, and turns it on", async () => {
    const update: jest.SpiedFunction<UpdateOneById> = spyUpdate(1);

    const key: string = await GlobalConfigService.createMasterApiKey();
    const call: UpdateByID<GlobalConfig> = written(update);

    expect(call.id.toString()).toBe(ZERO_ID);
    expect(call.props).toEqual({ isRoot: true });
    expect(Object.keys(call.data).sort()).toEqual([
      "isMasterApiKeyEnabled",
      "masterApiKey",
    ]);
    expect(call.data.isMasterApiKeyEnabled).toBe(true);

    const stored: HashedString = call.data.masterApiKey as HashedString;

    expect(stored).toBeInstanceOf(HashedString);
    // Already the hash: the write path stores it as it is.
    expect(stored.isValueHashed()).toBe(true);
    expect(stored.toString()).toBe(MasterApiKey.hash(key));
    expect(
      MasterApiKey.matches({
        presentedKey: key,
        storedValue: stored.toString(),
      }),
    ).toBe(true);
  });

  test("writes nothing that holds the key", async () => {
    const update: jest.SpiedFunction<UpdateOneById> = spyUpdate(1);

    const key: string = await GlobalConfigService.createMasterApiKey();

    expect(JSON.stringify(written(update))).not.toContain(key);
  });

  test("what it writes passes the service's own rule for the key", async () => {
    const update: jest.SpiedFunction<UpdateOneById> = spyUpdate(1);

    await GlobalConfigService.createMasterApiKey();

    const call: UpdateByID<GlobalConfig> = written(update);

    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(call.data as Record<string, unknown>, call.props),
      ),
    ).resolves.toBeDefined();
  });

  test("makes a new key each time: the one before stops working", async () => {
    spyUpdate(1);

    const first: string = await GlobalConfigService.createMasterApiKey();
    const second: string = await GlobalConfigService.createMasterApiKey();

    expect(second).not.toBe(first);
    expect(
      MasterApiKey.matches({
        presentedKey: first,
        storedValue: MasterApiKey.hash(second),
      }),
    ).toBe(false);
  });

  test("answers no key when the server's settings row is not there: a key never stored works nowhere", async () => {
    spyUpdate(0);

    await expect(GlobalConfigService.createMasterApiKey()).rejects.toThrow(
      new BadDataException(
        "No master API key was made: this server's settings were not found. Restart OneUptime so it creates them, then try again.",
      ),
    );
  });
});

describe("getMasterApiKeyState", () => {
  const answerRow: (
    row: Record<string, unknown> | null,
  ) => jest.SpiedFunction<(...args: Array<unknown>) => Promise<unknown>> = (
    row: Record<string, unknown> | null,
  ): jest.SpiedFunction<(...args: Array<unknown>) => Promise<unknown>> => {
    return getJestSpyOn(GlobalConfigService, "findOneById").mockResolvedValue(
      (row ? Object.assign(new GlobalConfig(), row) : null) as never,
    ) as unknown as jest.SpiedFunction<
      (...args: Array<unknown>) => Promise<unknown>
    >;
  };

  test("says a key is set, and on, never what it is", async () => {
    const find: jest.SpiedFunction<
      (...args: Array<unknown>) => Promise<unknown>
    > = answerRow({
      masterApiKey: new HashedString(MasterApiKey.hash(KEY), true),
      isMasterApiKeyEnabled: true,
    });

    const state: MasterApiKeyState =
      await GlobalConfigService.getMasterApiKeyState();

    expect(state).toEqual({ isSet: true, isEnabled: true });
    expect(JSON.stringify(state)).not.toContain(MasterApiKey.hash(KEY));

    expect(find).toHaveBeenCalledWith({
      id: ObjectID.getZeroObjectID(),
      select: { masterApiKey: true, isMasterApiKeyEnabled: true },
      props: { isRoot: true },
    });
  });

  test("a key stored before keys were hashed is a key set too", async () => {
    answerRow({
      masterApiKey: new HashedString(KEY, true),
      isMasterApiKeyEnabled: true,
    });

    expect(await GlobalConfigService.getMasterApiKeyState()).toEqual({
      isSet: true,
      isEnabled: true,
    });
  });

  test("says a key that is off is off", async () => {
    answerRow({
      masterApiKey: new HashedString(MasterApiKey.hash(KEY), true),
      isMasterApiKeyEnabled: false,
    });

    expect(await GlobalConfigService.getMasterApiKeyState()).toEqual({
      isSet: true,
      isEnabled: false,
    });
  });

  test("says there is none when there is none", async () => {
    answerRow({ isMasterApiKeyEnabled: true });

    expect(await GlobalConfigService.getMasterApiKeyState()).toEqual({
      isSet: false,
      isEnabled: true,
    });
  });

  test("and when the server's settings are not there at all", async () => {
    answerRow(null);

    expect(await GlobalConfigService.getMasterApiKeyState()).toEqual({
      isSet: false,
      isEnabled: false,
    });
  });
});
