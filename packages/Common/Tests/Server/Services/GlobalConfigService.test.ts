import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  Service as GlobalConfigServiceType,
} from "../../../Server/Services/GlobalConfigService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type GlobalConfigServiceWithUpdateHook = {
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

type GlobalConfigServiceWithUpdateHooks = GlobalConfigServiceWithUpdateHook & {
  onUpdateSuccess(
    onUpdate: OnUpdate<GlobalConfig>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise: Promise<T> = new Promise<T>(
    (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: unknown) => void,
    ): void => {
      resolvePromise = (value: T): void => {
        resolve(value);
      };
      rejectPromise = (error: Error): void => {
        reject(error);
      };
    },
  );

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let index: number = 0; index < 6; index++) {
    await Promise.resolve();
  }
}

function makeUpdateBy(data: Record<string, unknown>): UpdateBy<GlobalConfig> {
  return {
    query: {},
    data,
    limit: 1,
    skip: 0,
    props: {
      isRoot: true,
    },
  } as unknown as UpdateBy<GlobalConfig>;
}

describe("GlobalConfigService ClickHouse capacity settings", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("normalizes integer form strings before persisting", async () => {
    jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
      clickhouseCapacityNotificationThresholdPercent: 80,
      clickhouseDataPruningThresholdPercent: 90,
      clickhouseDataPruningTargetPercent: 80,
    } as GlobalConfig);

    const result: OnUpdate<GlobalConfig> = await (
      GlobalConfigService as unknown as GlobalConfigServiceWithUpdateHook
    ).onBeforeUpdate(
      makeUpdateBy({
        clickhouseCapacityNotificationThresholdPercent: "85",
        clickhouseDataPruningThresholdPercent: "95",
        clickhouseDataPruningTargetPercent: "75",
      }),
    );

    expect(
      result.updateBy.data.clickhouseCapacityNotificationThresholdPercent,
    ).toBe(85);
    expect(result.updateBy.data.clickhouseDataPruningThresholdPercent).toBe(95);
    expect(result.updateBy.data.clickhouseDataPruningTargetPercent).toBe(75);
  });

  test("rejects a normalized target that is not below the trigger", async () => {
    jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
      clickhouseCapacityNotificationThresholdPercent: 80,
      clickhouseDataPruningThresholdPercent: 90,
      clickhouseDataPruningTargetPercent: 80,
    } as GlobalConfig);

    await expect(
      (
        GlobalConfigService as unknown as GlobalConfigServiceWithUpdateHook
      ).onBeforeUpdate(
        makeUpdateBy({
          clickhouseDataPruningThresholdPercent: "85",
          clickhouseDataPruningTargetPercent: "85",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("GlobalConfigService Telegram webhook secret", () => {
  let sharedCache: Map<string, string>;

  beforeEach(() => {
    sharedCache = new Map<string, string>();

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          return sharedCache.get(`${namespace}:${key}`) || null;
        },
      );
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<void> => {
          sharedCache.set(`${namespace}:${key}`, value);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects weak and Telegram-incompatible secret values", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const hook: GlobalConfigServiceWithUpdateHook =
      service as unknown as GlobalConfigServiceWithUpdateHook;

    await expect(
      hook.onBeforeUpdate(
        makeUpdateBy({ telegramWebhookSecretToken: "short-secret" }),
      ),
    ).rejects.toThrow("must be 32-100 characters");

    await expect(
      hook.onBeforeUpdate(
        makeUpdateBy({
          telegramWebhookSecretToken:
            "this_secret_is_long_enough_but_has_a_period.",
        }),
      ),
    ).rejects.toThrow("contain only letters");
  });

  test("trims and accepts a 32-plus-character Telegram-safe secret", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const result: OnUpdate<GlobalConfig> = await (
      service as unknown as GlobalConfigServiceWithUpdateHook
    ).onBeforeUpdate(
      makeUpdateBy({
        telegramWebhookSecretToken: "  oneuptime_telegram_secret_01234567  ",
      }),
    );

    expect(result.updateBy.data.telegramWebhookSecretToken).toBe(
      "oneuptime_telegram_secret_01234567",
    );
  });

  test("allows an administrator to clear the optional secret", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();

    await expect(
      (service as unknown as GlobalConfigServiceWithUpdateHook).onBeforeUpdate(
        makeUpdateBy({ telegramWebhookSecretToken: null }),
      ),
    ).resolves.toBeDefined();
  });

  test("caches the singleton secret so invalid-request floods do not read Postgres each time", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue({
        telegramWebhookSecretToken: "  oneuptime_telegram_secret_01234567  ",
      } as GlobalConfig);

    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_01234567",
    );
    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_01234567",
    );
    expect(find).toHaveBeenCalledTimes(1);
  });

  test("shares cache generations across service instances so rotation invalidates every replica", async () => {
    const firstReplica: GlobalConfigServiceType = new GlobalConfigServiceType();
    const secondReplica: GlobalConfigServiceType =
      new GlobalConfigServiceType();
    const secondReplicaHooks: GlobalConfigServiceWithUpdateHooks =
      secondReplica as unknown as GlobalConfigServiceWithUpdateHooks;
    const firstReplicaFind: ReturnType<typeof jest.spyOn> = jest
      .spyOn(firstReplica, "findOneBy")
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_11111111",
      } as GlobalConfig)
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_22222222",
      } as GlobalConfig);
    const secondReplicaFind: ReturnType<typeof jest.spyOn> = jest.spyOn(
      secondReplica,
      "findOneBy",
    );

    await expect(firstReplica.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_11111111",
    );
    await expect(secondReplica.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_11111111",
    );
    expect(secondReplicaFind).not.toHaveBeenCalled();

    const onUpdate: OnUpdate<GlobalConfig> =
      await secondReplicaHooks.onBeforeUpdate(
        makeUpdateBy({
          telegramWebhookSecretToken: "oneuptime_telegram_secret_22222222",
        }),
      );
    await secondReplicaHooks.onUpdateSuccess(onUpdate, [
      ObjectID.getZeroObjectID(),
    ]);

    await expect(firstReplica.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_22222222",
    );
    expect(firstReplicaFind).toHaveBeenCalledTimes(2);
  });

  test("caches a missing configuration with a non-secret sentinel", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      service.getTelegramWebhookSecretToken(),
    ).resolves.toBeUndefined();
    await expect(
      service.getTelegramWebhookSecretToken(),
    ).resolves.toBeUndefined();

    expect(find).toHaveBeenCalledTimes(1);
    expect(Array.from(sharedCache.values())).toContain("__not_configured__");
  });

  test("fails closed before Postgres when the shared cache is unavailable", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const cacheError: Error = new Error("cache unavailable");
    jest.spyOn(GlobalCache, "getString").mockRejectedValue(cacheError);
    const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
      service,
      "findOneBy",
    );

    await expect(service.getTelegramWebhookSecretToken()).rejects.toBe(
      cacheError,
    );
    expect(find).not.toHaveBeenCalled();
  });

  test("coalesces a concurrent cache-miss burst into one database read", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const databaseRead: Deferred<GlobalConfig | null> =
      createDeferred<GlobalConfig | null>();
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockReturnValue(databaseRead.promise as never);

    const reads: Array<Promise<string | undefined>> = Array.from(
      { length: 50 },
      (): Promise<string | undefined> => {
        return service.getTelegramWebhookSecretToken();
      },
    );

    await flushAsyncWork();
    expect(find).toHaveBeenCalledTimes(1);

    databaseRead.resolve({
      telegramWebhookSecretToken: "oneuptime_telegram_secret_01234567",
    } as GlobalConfig);

    await expect(Promise.all(reads)).resolves.toEqual(
      Array<string>(50).fill("oneuptime_telegram_secret_01234567"),
    );
    expect(find).toHaveBeenCalledTimes(1);
  });

  test("clears a failed single-flight load so the next request can retry", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const failedRead: Deferred<GlobalConfig | null> =
      createDeferred<GlobalConfig | null>();
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockReturnValueOnce(failedRead.promise as never)
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_76543210",
      } as GlobalConfig);

    const first: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();
    const second: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();
    const databaseError: Error = new Error("database unavailable");

    await flushAsyncWork();
    expect(find).toHaveBeenCalledTimes(1);
    failedRead.reject(databaseError);

    await expect(first).rejects.toBe(databaseError);
    await expect(second).rejects.toBe(databaseError);
    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_76543210",
    );
    expect(find).toHaveBeenCalledTimes(2);
  });

  test("keeps a newer-generation flight shared when an older read finishes", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const hooks: GlobalConfigServiceWithUpdateHooks =
      service as unknown as GlobalConfigServiceWithUpdateHooks;
    const oldGenerationRead: Deferred<GlobalConfig | null> =
      createDeferred<GlobalConfig | null>();
    const newGenerationRead: Deferred<GlobalConfig | null> =
      createDeferred<GlobalConfig | null>();
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockReturnValueOnce(oldGenerationRead.promise as never)
      .mockReturnValueOnce(newGenerationRead.promise as never);

    const oldRequest: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();
    const onUpdate: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_66666666",
      }),
    );
    const firstNewRequest: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();
    const secondNewRequest: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();

    await flushAsyncWork();
    expect(find).toHaveBeenCalledTimes(2);

    oldGenerationRead.resolve({
      telegramWebhookSecretToken: "oneuptime_telegram_secret_55555555",
    } as GlobalConfig);
    await Promise.resolve();
    await Promise.resolve();

    /*
     * The old request's finally block has now run. A third caller must still
     * join the newer pending flight rather than starting a third DB query.
     */
    const thirdNewRequest: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();
    expect(find).toHaveBeenCalledTimes(2);

    newGenerationRead.resolve({
      telegramWebhookSecretToken: "oneuptime_telegram_secret_66666666",
    } as GlobalConfig);

    await expect(
      Promise.all([
        oldRequest,
        firstNewRequest,
        secondNewRequest,
        thirdNewRequest,
      ]),
    ).resolves.toEqual(
      Array<string>(4).fill("oneuptime_telegram_secret_66666666"),
    );

    await hooks.onUpdateSuccess(onUpdate, [ObjectID.getZeroObjectID()]);
  });

  test("clears cached data both before and after a secret rotation", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const hooks: GlobalConfigServiceWithUpdateHooks =
      service as unknown as GlobalConfigServiceWithUpdateHooks;
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_11111111",
      } as GlobalConfig)
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_11111111",
      } as GlobalConfig)
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_22222222",
      } as GlobalConfig);

    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_11111111",
    );

    const onUpdate: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_22222222",
      }),
    );

    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_11111111",
    );
    expect(find).toHaveBeenCalledTimes(2);

    await hooks.onUpdateSuccess(onUpdate, [ObjectID.getZeroObjectID()]);

    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_22222222",
    );
    expect(find).toHaveBeenCalledTimes(3);
  });

  test("does not let a pre-rotation in-flight read resurrect the retired secret", async () => {
    const service: GlobalConfigServiceType = new GlobalConfigServiceType();
    const hooks: GlobalConfigServiceWithUpdateHooks =
      service as unknown as GlobalConfigServiceWithUpdateHooks;
    const staleRead: Deferred<GlobalConfig | null> =
      createDeferred<GlobalConfig | null>();
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(service, "findOneBy")
      .mockReturnValueOnce(staleRead.promise as never)
      .mockResolvedValueOnce({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_44444444",
      } as GlobalConfig);

    const requestStartedBeforeRotation: Promise<string | undefined> =
      service.getTelegramWebhookSecretToken();
    await flushAsyncWork();
    expect(find).toHaveBeenCalledTimes(1);

    const onUpdate: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy({
        telegramWebhookSecretToken: "oneuptime_telegram_secret_44444444",
      }),
    );
    await hooks.onUpdateSuccess(onUpdate, [ObjectID.getZeroObjectID()]);

    staleRead.resolve({
      telegramWebhookSecretToken: "oneuptime_telegram_secret_33333333",
    } as GlobalConfig);

    await expect(requestStartedBeforeRotation).resolves.toBe(
      "oneuptime_telegram_secret_44444444",
    );
    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_44444444",
    );
    await expect(service.getTelegramWebhookSecretToken()).resolves.toBe(
      "oneuptime_telegram_secret_44444444",
    );
    expect(find).toHaveBeenCalledTimes(2);
  });
});
