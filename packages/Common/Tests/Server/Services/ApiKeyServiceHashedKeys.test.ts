import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import {
  API_KEY_WRITTEN_HERE_MESSAGE,
  KEY_STORED_AS_WRITTEN_SQL_PATTERN,
  KEYS_STORED_AS_WRITTEN_CHECK_TTL_MS,
  MadeApiKey,
  ResolvedApiKey,
  Service as ApiKeyServiceClass,
} from "../../../Server/Services/ApiKeyService";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnCreate,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import UpdateByID from "../../../Server/Types/Database/UpdateByID";
import HashedApiKey from "../../../Server/Utils/APIKey/HashedApiKey";
import logger from "../../../Server/Utils/Logger";
import { getKeyShownOnCreate } from "../../../Types/ApiKey/ApiKeyShownOnce";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";

/*
 * A PROJECT'S API KEYS, STORED HASHED (#8902), in ApiKeyService.
 *
 * A key was stored as it was written, read back by its page and the API,
 * and made in the browser on a reset. Now:
 *
 *   - a create makes the key on the server and stores its hash with its
 *     hint, whatever the caller sent; the record handed back holds the key
 *     itself, for the create's one answer;
 *   - no write but OneUptime's own sets a key or its hint: a key of a
 *     caller's choosing, one to be hashed by the write path, a clear;
 *   - no read but OneUptime's own selects the hash, and a filter on it is
 *     left for the read check to refuse rather than dropped;
 *   - a reset makes a new key with the caller's props and answers it once;
 *   - a request's key is looked up by its hash, so the query holds no key;
 *     a key stored before keys were hashed is looked up as written only
 *     while one may still be stored so - asked at most once a minute, and
 *     a question the database does not answer counts as yes, so no upgrade
 *     locks anyone out.
 *
 * A fresh Service per test, so no test inherits another's cache.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

interface ServiceHooks {
  onBeforeCreate(createBy: CreateBy<ApiKey>): Promise<OnCreate<ApiKey>>;
  onCreateSuccess(
    onCreate: OnCreate<ApiKey>,
    createdItem: ApiKey,
  ): Promise<ApiKey>;
  onBeforeUpdate(updateBy: UpdateBy<ApiKey>): Promise<OnUpdate<ApiKey>>;
  onBeforeFind(findBy: FindBy<ApiKey>): Promise<OnFind<ApiKey>>;
}

interface FindOneByCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";
const KEY_ROW_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  tenantId: new ObjectID(PROJECT_ID),
} as DatabaseCommonInteractionProps;

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

let service: ApiKeyServiceClass;
let hooks: ServiceHooks;

function createBy(data: Record<string, unknown>): CreateBy<ApiKey> {
  return {
    data: Object.assign(new ApiKey(), data),
    props: MEMBER_PROPS,
  } as CreateBy<ApiKey>;
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): UpdateBy<ApiKey> {
  return {
    query: { _id: KEY_ROW_ID },
    data: data,
    limit: 1,
    skip: 0,
    props: props,
  } as unknown as UpdateBy<ApiKey>;
}

function findBy(
  select: Record<string, unknown>,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): FindBy<ApiKey> {
  return {
    select: select,
    query: query,
    limit: 10,
    skip: 0,
    props: props,
  } as unknown as FindBy<ApiKey>;
}

function keyRow(): ApiKey {
  const row: ApiKey = new ApiKey();
  row._id = KEY_ROW_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.name = "Terraform";
  return row;
}

// What OneUptime writes for a key: its hash, already hashed, and its hint.
function ownWrite(key: string): Record<string, unknown> {
  return {
    apiKey: new HashedString(HashedApiKey.hash(key), true),
    apiKeyHint: HashedApiKey.getHint(key),
  };
}

beforeEach(() => {
  service = new ApiKeyServiceClass();
  hooks = service as unknown as ServiceHooks;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create", () => {
  test("makes the key on the server, stored as its hash with its hint", async () => {
    const onCreate: OnCreate<ApiKey> = await hooks.onBeforeCreate(
      createBy({ name: "Terraform" }),
    );
    const made: string = (onCreate.carryForward as { apiKey: string }).apiKey;
    const stored: HashedString = onCreate.createBy.data.apiKey as HashedString;

    expect(HashedApiKey.normalize(made)).toBe(made);
    expect(stored).toBeInstanceOf(HashedString);
    // Already the hash: the write path stores it as it is.
    expect(stored.isValueHashed()).toBe(true);
    expect(stored.toString()).toBe(HashedApiKey.hash(made));
    expect(onCreate.createBy.data.apiKeyHint).toBe(made.slice(-4));
  });

  test("replaces whatever the caller sent: a key is the server's to make", async () => {
    const onCreate: OnCreate<ApiKey> = await hooks.onBeforeCreate(
      createBy({
        name: "Terraform",
        apiKey: new HashedString(KEY),
        apiKeyHint: "2b34",
      }),
    );
    const made: string = (onCreate.carryForward as { apiKey: string }).apiKey;

    expect(made).not.toBe(KEY);
    expect(onCreate.createBy.data.apiKey?.toString()).not.toBe(KEY);
    expect(onCreate.createBy.data.apiKey?.toString()).toBe(
      HashedApiKey.hash(made),
    );
    expect(onCreate.createBy.data.apiKeyHint).toBe(made.slice(-4));
  });

  test("writes nothing that holds the key", async () => {
    const onCreate: OnCreate<ApiKey> = await hooks.onBeforeCreate(
      createBy({ name: "Terraform" }),
    );
    const made: string = (onCreate.carryForward as { apiKey: string }).apiKey;

    expect(
      JSON.stringify(ApiKey.toJSON(onCreate.createBy.data, ApiKey)),
    ).not.toContain(made);
  });

  test("what it writes passes the service's own rule for a key", async () => {
    const onCreate: OnCreate<ApiKey> = await hooks.onBeforeCreate(
      createBy({ name: "Terraform" }),
    );

    expect(() => {
      service.assertKeyWrittenByOneUptime(onCreate.createBy.data);
    }).not.toThrow();
  });

  test("makes a new key each time", async () => {
    const first: OnCreate<ApiKey> = await hooks.onBeforeCreate(createBy({}));
    const second: OnCreate<ApiKey> = await hooks.onBeforeCreate(createBy({}));

    expect((first.carryForward as { apiKey: string }).apiKey).not.toBe(
      (second.carryForward as { apiKey: string }).apiKey,
    );
  });
});

describe("the create's one answer", () => {
  test("the record handed back holds the key itself: the value whose hash is stored", async () => {
    const onCreate: OnCreate<ApiKey> = await hooks.onBeforeCreate(
      createBy({ name: "Terraform" }),
    );
    const made: string = (onCreate.carryForward as { apiKey: string }).apiKey;
    const storedHash: string = onCreate.createBy.data.apiKey!.toString();

    const answered: ApiKey = await hooks.onCreateSuccess(
      onCreate,
      onCreate.createBy.data,
    );

    expect(answered.apiKey).toBeInstanceOf(HashedString);
    expect(answered.apiKey!.toString()).toBe(made);
    // Not yet hashed: the key, not its hash.
    expect(answered.apiKey!.isValueHashed()).toBe(false);
    expect(
      HashedApiKey.matches({
        presentedKey: answered.apiKey!.toString(),
        storedValue: storedHash,
      }),
    ).toBe(true);
    expect(answered.apiKeyHint).toBe(made.slice(-4));
  });

  test("as BaseAPI answers it: the key, which a client reads off the new record", async () => {
    const onCreate: OnCreate<ApiKey> = await hooks.onBeforeCreate(
      createBy({ name: "Terraform" }),
    );
    const made: string = (onCreate.carryForward as { apiKey: string }).apiKey;

    const answered: ApiKey = await hooks.onCreateSuccess(
      onCreate,
      onCreate.createBy.data,
    );
    const json: JSONObject = ApiKey.toJSON(answered, ApiKey);

    expect(json["apiKey"]).toEqual({ _type: "HashedString", value: made });
    expect(getKeyShownOnCreate(json["apiKey"])).toBe(made);
    expect(
      getKeyShownOnCreate(
        (ApiKey.fromJSON(json, ApiKey) as ApiKey).getValue("apiKey"),
      ),
    ).toBe(made);
    expect(JSON.stringify(json)).not.toContain(HashedApiKey.hash(made));
  });

  test("a create that made no key - its hooks skipped - answers none", async () => {
    const row: ApiKey = keyRow();

    const answered: ApiKey = await hooks.onCreateSuccess(
      { createBy: createBy({}), carryForward: null },
      row,
    );

    expect(answered.apiKey).toBeUndefined();
  });
});

describe("a write of a key", () => {
  test.each([
    ["a key of the caller's choosing", { apiKey: KEY, apiKeyHint: "2b34" }],
    [
      "a key as a HashedString, for the write path to hash",
      { apiKey: new HashedString(KEY), apiKeyHint: "2b34" },
    ],
    [
      "a key marked hashed, but still a key",
      { apiKey: new HashedString(KEY, true), apiKeyHint: "2b34" },
    ],
    [
      "a hash as a plain string",
      { apiKey: HashedApiKey.hash(KEY), apiKeyHint: "2b34" },
    ],
    [
      "an upper-case digest, which HashedString never writes",
      {
        apiKey: new HashedString(HashedApiKey.hash(KEY).toUpperCase(), true),
        apiKeyHint: "2b34",
      },
    ],
    ["nothing: clearing the key", { apiKey: null }],
    ["its hint alone", { apiKeyHint: "2b34" }],
  ])(
    "with %s is refused, and says where a key is made",
    async (_label: string, data: Record<string, unknown>) => {
      for (const props of [MEMBER_PROPS, MASTER_ADMIN_PROPS, ROOT_PROPS]) {
        await expect(
          hooks.onBeforeUpdate(updateBy(data, props)),
        ).rejects.toThrow(
          new NotAuthorizedException(API_KEY_WRITTEN_HERE_MESSAGE),
        );
      }
    },
  );

  test("the refusal says what to do instead, in a sentence", () => {
    expect(API_KEY_WRITTEN_HERE_MESSAGE).toBe(
      "An API key cannot be set through the API. Reset it on its page under Project Settings > Advanced > API Keys, or with POST /api-key/:id/reset-key, which answers the new key once.",
    );
  });

  test.each([
    ["no hint", {}],
    ["a hint that is the whole key", { apiKeyHint: KEY }],
    ["a hint that is no four hex digits", { apiKeyHint: "zz!!" }],
    ["an empty hint", { apiKeyHint: "" }],
  ])(
    "OneUptime's own hash with %s is refused: a key is written with its hint",
    async (_label: string, hint: Record<string, unknown>) => {
      await expect(
        hooks.onBeforeUpdate(
          updateBy({
            apiKey: new HashedString(HashedApiKey.hash(KEY), true),
            ...hint,
          }),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
    },
  );

  test("OneUptime's own write - a hash with its hint - passes, with the caller's props (a reset)", async () => {
    await expect(
      hooks.onBeforeUpdate(updateBy(ownWrite(KEY), MEMBER_PROPS)),
    ).resolves.toBeDefined();
    await expect(
      hooks.onBeforeUpdate(updateBy(ownWrite(KEY), ROOT_PROPS)),
    ).resolves.toBeDefined();
  });

  test("a change of anything else is not affected: its name, description and expiry are the caller's", async () => {
    await expect(
      hooks.onBeforeUpdate(
        updateBy({
          name: "Terraform (prod)",
          description: "Manages our monitors.",
          expiresAt: new Date(),
        }),
      ),
    ).resolves.toBeDefined();
  });

  test("a create naming a key is no write of one: the key is made on the server", async () => {
    await expect(
      hooks.onBeforeCreate(createBy({ apiKey: KEY, apiKeyHint: "2b34" })),
    ).resolves.toBeDefined();
  });
});

describe("a read", () => {
  test.each([
    ["a member's", MEMBER_PROPS],
    ["a master admin's", MASTER_ADMIN_PROPS],
  ])(
    "%s never selects the key's hash: older clients that ask for it get everything else",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      const result: OnFind<ApiKey> = await hooks.onBeforeFind(
        findBy(
          { _id: true, name: true, apiKey: true, apiKeyHint: true },
          { projectId: PROJECT_ID },
          props,
        ),
      );

      expect(Object.keys(result.findBy.select || {}).sort()).toEqual([
        "_id",
        "apiKeyHint",
        "name",
      ]);
      expect(result.findBy.query).toEqual({ projectId: PROJECT_ID });
    },
  );

  test("a filter on the key is not dropped - it would answer every key - and is left for the read check to refuse", async () => {
    const asked: FindBy<ApiKey> = findBy(
      { _id: true },
      { apiKey: KEY },
      MEMBER_PROPS,
    );

    const result: OnFind<ApiKey> = await hooks.onBeforeFind(asked);

    expect(result.findBy.query).toEqual({ apiKey: KEY });
  });

  test("OneUptime itself (root) reads as it asks: the lookup", async () => {
    const asked: FindBy<ApiKey> = findBy(
      { _id: true, apiKey: true },
      { apiKey: new HashedString(HashedApiKey.hash(KEY), true) },
      ROOT_PROPS,
    );

    expect((await hooks.onBeforeFind(asked)).findBy).toBe(asked);
  });

  test("a read that does not name the key is handed on as it is", async () => {
    const asked: FindBy<ApiKey> = findBy(
      { _id: true, name: true },
      {},
      MEMBER_PROPS,
    );

    expect((await hooks.onBeforeFind(asked)).findBy).toBe(asked);
  });
});

describe("resetApiKey", () => {
  type UpdateOneById = (updateById: UpdateByID<ApiKey>) => Promise<number>;

  function spyUpdate(rows: number): SpyInstance {
    return getJestSpyOn(service, "updateOneById").mockResolvedValue(
      rows as never,
    );
  }

  function written(update: SpyInstance): UpdateByID<ApiKey> {
    expect(update).toHaveBeenCalledTimes(1);
    return (update.mock.calls[0] as Parameters<UpdateOneById>)[0];
  }

  test("makes a new key, writes its hash and hint with the caller's props, and answers the key", async () => {
    const update: SpyInstance = spyUpdate(1);

    const made: MadeApiKey = await service.resetApiKey({
      id: new ObjectID(KEY_ROW_ID),
      props: MEMBER_PROPS,
    });
    const call: UpdateByID<ApiKey> = written(update);

    expect(HashedApiKey.normalize(made.apiKey)).toBe(made.apiKey);
    expect(made.apiKeyHint).toBe(made.apiKey.slice(-4));
    expect(call.id.toString()).toBe(KEY_ROW_ID);
    // The caller's own props: a reset asks what a change of the key asks.
    expect(call.props).toBe(MEMBER_PROPS);
    expect(Object.keys(call.data).sort()).toEqual(["apiKey", "apiKeyHint"]);
    expect((call.data.apiKey as HashedString).isValueHashed()).toBe(true);
    expect((call.data.apiKey as HashedString).toString()).toBe(
      HashedApiKey.hash(made.apiKey),
    );
    expect(call.data.apiKeyHint).toBe(made.apiKeyHint);
  });

  test("writes nothing that holds the key, and what it writes passes the key's rule", async () => {
    const update: SpyInstance = spyUpdate(1);

    const made: MadeApiKey = await service.resetApiKey({
      id: new ObjectID(KEY_ROW_ID),
      props: MEMBER_PROPS,
    });
    const call: UpdateByID<ApiKey> = written(update);

    expect(JSON.stringify(call.data)).not.toContain(made.apiKey);
    expect(() => {
      service.assertKeyWrittenByOneUptime(call.data);
    }).not.toThrow();
  });

  test("makes a new key each time: the one before stops working", async () => {
    spyUpdate(1);

    const first: MadeApiKey = await service.resetApiKey({
      id: new ObjectID(KEY_ROW_ID),
      props: MEMBER_PROPS,
    });
    const second: MadeApiKey = await service.resetApiKey({
      id: new ObjectID(KEY_ROW_ID),
      props: MEMBER_PROPS,
    });

    expect(second.apiKey).not.toBe(first.apiKey);
    expect(
      HashedApiKey.matches({
        presentedKey: first.apiKey,
        storedValue: HashedApiKey.hash(second.apiKey),
      }),
    ).toBe(false);
  });

  test.each([
    [
      "one the caller may read but not change is refused",
      new NotAuthorizedException(
        "You do not have permission to update API Key.",
      ),
    ],
    [
      "one that is not there is answered as missing",
      new NotFoundException("API Key not found."),
    ],
  ])(
    "a key that was not written answers no key: %s",
    async (_label: string, why: Error) => {
      spyUpdate(0);
      const unwritten: SpyInstance = getJestSpyOn(
        service,
        "getUnwrittenByIdError",
      ).mockResolvedValue(why as never);

      await expect(
        service.resetApiKey({
          id: new ObjectID(KEY_ROW_ID),
          props: MEMBER_PROPS,
        }),
      ).rejects.toBe(why);

      expect(unwritten).toHaveBeenCalledWith(
        expect.objectContaining({ props: MEMBER_PROPS }),
      );
    },
  );
});

describe("findApiKey, through the upgrade", () => {
  let findOneBySpy: SpyInstance;
  let querySpy: Mock<(...args: Array<unknown>) => Promise<unknown>>;
  let storedAsWritten: Array<unknown>;
  let now: number;

  beforeEach(() => {
    now = 1_800_000_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    findOneBySpy = getJestSpyOn(service, "findOneBy").mockResolvedValue(null);

    // Some key is still stored as it was written, until a test says not.
    storedAsWritten = [{ "?column?": 1 }];
    querySpy = jest.fn(async (): Promise<unknown> => {
      return storedAsWritten;
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      metadata: { tableName: "ApiKey" },
      query: querySpy,
    } as never);
  });

  function lookedUpBy(): Array<string> {
    return findOneBySpy.mock.calls.map((call: Array<unknown>): string => {
      return String((call[0] as FindOneByCall).query["apiKey"]);
    });
  }

  test("looks a key up by its hash first: found, nothing else is asked", async () => {
    findOneBySpy.mockResolvedValue(keyRow());

    const resolved: ResolvedApiKey | null = await service.findApiKey(
      new ObjectID(KEY),
    );

    expect(resolved?.id.toString()).toBe(KEY_ROW_ID);
    expect(lookedUpBy()).toEqual([HashedApiKey.hash(KEY)]);
    expect(querySpy).not.toHaveBeenCalled();
  });

  test("a key stored as written - before the data migration hashed it - still works, looked up as written", async () => {
    findOneBySpy.mockImplementation(async (lookup: FindOneByCall) => {
      return String(lookup.query["apiKey"]) === KEY ? keyRow() : null;
    });

    const resolved: ResolvedApiKey | null = await service.findApiKey(
      new ObjectID(KEY.toUpperCase()),
    );

    expect(resolved?.id.toString()).toBe(KEY_ROW_ID);
    expect(resolved?.projectId.toString()).toBe(PROJECT_ID);
    // By its hash, then as the uuid column kept it: lower-case.
    expect(lookedUpBy()).toEqual([HashedApiKey.hash(KEY), KEY]);
  });

  test("once no key is stored as written, a key is looked up by its hash alone: no key goes into a query", async () => {
    storedAsWritten = [];

    await expect(service.findApiKey(new ObjectID(KEY))).resolves.toBeNull();

    expect(lookedUpBy()).toEqual([HashedApiKey.hash(KEY)]);
    expect(JSON.stringify(findOneBySpy.mock.calls)).not.toContain(KEY);
  });

  test("whether any key is stored as written is asked at most once a minute", async () => {
    storedAsWritten = [];

    await service.findApiKey(new ObjectID(KEY));
    await service.findApiKey(new ObjectID(OTHER_KEY));

    expect(querySpy).toHaveBeenCalledTimes(1);

    now += KEYS_STORED_AS_WRITTEN_CHECK_TTL_MS;
    await service.findApiKey(
      new ObjectID("7d0c4b3e-1a2f-4e5d-9c8b-6a5f4e3d2c1b"),
    );

    expect(querySpy).toHaveBeenCalledTimes(2);
  });

  test("a key stored as written by a server of the release before - during a rolling upgrade - is found once it is asked again", async () => {
    storedAsWritten = [];
    await service.findApiKey(new ObjectID(OTHER_KEY));

    // An older server makes a key the old way.
    storedAsWritten = [{ "?column?": 1 }];
    findOneBySpy.mockImplementation(async (lookup: FindOneByCall) => {
      return String(lookup.query["apiKey"]) === KEY ? keyRow() : null;
    });

    now += KEYS_STORED_AS_WRITTEN_CHECK_TTL_MS;

    expect((await service.findApiKey(new ObjectID(KEY)))?.id.toString()).toBe(
      KEY_ROW_ID,
    );
  });

  test("a question the database does not answer counts as yes: no upgrade locks anyone out", async () => {
    querySpy.mockRejectedValue(new Error("connection terminated"));
    findOneBySpy.mockImplementation(async (lookup: FindOneByCall) => {
      return String(lookup.query["apiKey"]) === KEY ? keyRow() : null;
    });

    expect((await service.findApiKey(new ObjectID(KEY)))?.id.toString()).toBe(
      KEY_ROW_ID,
    );
    expect(logger.error).toHaveBeenCalled();
  });

  test("the question names no key: it reads whether any live key is still a uuid", async () => {
    await service.findApiKey(new ObjectID(KEY));

    expect(querySpy).toHaveBeenCalledTimes(1);

    const sql: string = String(querySpy.mock.calls[0]![0]);

    expect(sql).toBe(
      `SELECT 1 FROM "ApiKey" WHERE "deletedAt" IS NULL AND "apiKey" ~* '${KEY_STORED_AS_WRITTEN_SQL_PATTERN}' LIMIT 1`,
    );
    expect(sql).not.toContain(KEY);
    // No parameters at all: nothing of the request goes with it.
    expect(querySpy.mock.calls[0]![1]).toBeUndefined();
    expect(new RegExp(KEY_STORED_AS_WRITTEN_SQL_PATTERN, "i").test(KEY)).toBe(
      true,
    );
    expect(
      new RegExp(KEY_STORED_AS_WRITTEN_SQL_PATTERN, "i").test(
        HashedApiKey.hash(KEY),
      ),
    ).toBe(false);
  });

  test("a server on the schema before the upgrade - the key column still a uuid, which refuses a hash - finds the key as written", async () => {
    const refusedHash: Error = Object.assign(
      new BadDataException("An ID in this request is not valid."),
      { postgresErrorCode: "22P02" },
    );

    findOneBySpy.mockImplementation(async (lookup: FindOneByCall) => {
      if (String(lookup.query["apiKey"]) === HashedApiKey.hash(KEY)) {
        throw refusedHash;
      }

      return String(lookup.query["apiKey"]) === KEY ? keyRow() : null;
    });
    // The regex of the question is refused by a uuid column too: a yes.
    querySpy.mockRejectedValue(
      Object.assign(new Error("operator does not exist: uuid ~* unknown"), {
        code: "42883",
      }),
    );

    expect((await service.findApiKey(new ObjectID(KEY)))?.id.toString()).toBe(
      KEY_ROW_ID,
    );
    expect(lookedUpBy()).toEqual([HashedApiKey.hash(KEY), KEY]);
  });

  test("the driver's own refusal of a hash is read the same way", async () => {
    findOneBySpy.mockImplementation(async (lookup: FindOneByCall) => {
      if (String(lookup.query["apiKey"]) === HashedApiKey.hash(KEY)) {
        throw Object.assign(new Error("invalid input syntax for type uuid"), {
          driverError: { code: "22P02" },
        });
      }

      return keyRow();
    });

    expect((await service.findApiKey(new ObjectID(KEY)))?.id.toString()).toBe(
      KEY_ROW_ID,
    );
  });

  test("any other failure of the lookup is an error, never a key not found", async () => {
    const failure: Error = new Error("connection terminated");

    findOneBySpy.mockRejectedValue(failure);

    await expect(service.findApiKey(new ObjectID(KEY))).rejects.toBe(failure);
  });

  test("a value that is no uuid is no key: nothing is read for it", async () => {
    await expect(
      service.findApiKey("garbage" as unknown as ObjectID),
    ).resolves.toBeNull();

    expect(findOneBySpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
  });

  test("a key written upper-case is the same key, cached once", async () => {
    findOneBySpy.mockResolvedValue(keyRow());

    await service.findApiKey(new ObjectID(KEY));
    const again: ResolvedApiKey | null = await service.findApiKey(
      new ObjectID(KEY.toUpperCase()),
    );

    expect(again?.id.toString()).toBe(KEY_ROW_ID);
    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("the cache holds no key: it is keyed by the key's hash", async () => {
    findOneBySpy.mockResolvedValue(keyRow());

    await service.findApiKey(new ObjectID(KEY));

    const cache: { get: (key: string) => unknown } = (
      service as unknown as { apiKeyCache: { get: (key: string) => unknown } }
    ).apiKeyCache;

    expect(cache.get(HashedApiKey.hash(KEY))).toBeTruthy();
    expect(cache.get(KEY)).toBeUndefined();
  });
});
