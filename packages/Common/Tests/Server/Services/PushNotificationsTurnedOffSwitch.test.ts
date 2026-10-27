jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS,
  Service as GlobalConfigServiceType,
} from "../../../Server/Services/GlobalConfigService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHETHER PUSH IS TURNED OFF, AS A SERVER KEEPS IT.
 *
 * The push sender asks GlobalConfigService whether push notifications are
 * turned off for the whole server (GlobalConfig.disablePushNotifications)
 * before every push, so each server keeps the answer for
 * PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS - ten seconds - and reads the
 * settings row again when they run out. A write of the switch drops this
 * server's copy at once (onUpdateSuccess); another server's copy runs out
 * within the ten seconds, which is what the docs promise.
 *
 * A read that fails throws and keeps nothing: the sender refuses rather than
 * take a failed read for "on", since the switch is there for installations
 * whose rules let nothing out through the push services.
 *
 * Each test is a server of its own (a fresh Service, with its own copy) whose
 * settings row is a stand-in read, except the last block, which writes the
 * switch through the real update path with the row held in memory
 * (InMemoryRepository).
 */

const CONFIG_ID: ObjectID = ObjectID.getZeroObjectID();

const TEN_SECONDS: number = PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS;

// When the test starts; the cache's clock is Date.now.
const START: number = Date.UTC(2026, 9, 27, 9, 0, 0);

interface UpdateHooks {
  onUpdateSuccess: (
    onUpdate: OnUpdate<GlobalConfig>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<GlobalConfig>>;
  onUpdateError: (
    error: Exception,
    onUpdate?: OnUpdate<GlobalConfig> | undefined,
  ) => Promise<Exception>;
}

function hooksOf(server: GlobalConfigServiceType): UpdateHooks {
  return server as unknown as UpdateHooks;
}

// The settings row as a read of the switch returns it.
function settingsRow(disablePushNotifications: unknown): GlobalConfig {
  return { disablePushNotifications } as unknown as GlobalConfig;
}

// A write of the server's settings, as the update path hands it to its hooks.
function writeOf(data: Record<string, unknown>): OnUpdate<GlobalConfig> {
  return {
    updateBy: {
      query: {},
      data: data,
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    } as unknown as UpdateBy<GlobalConfig>,
    carryForward: null,
  };
}

let now: number = START;

// What the settings row says now; null for a server with no row.
let stored: GlobalConfig | null = null;

// What the next read of the row fails with, when it fails.
let nextReadFails: Error | null = null;

let server: GlobalConfigServiceType;
let reads: jest.SpyInstance;

// A server whose settings row is the stand-in above.
function aServer(): {
  server: GlobalConfigServiceType;
  reads: jest.SpyInstance;
} {
  const fresh: GlobalConfigServiceType = new GlobalConfigServiceType();

  const freshReads: jest.SpyInstance = jest
    .spyOn(fresh, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      if (nextReadFails) {
        const failure: Error = nextReadFails;
        nextReadFails = null;
        throw failure;
      }

      return stored;
    });

  return { server: fresh, reads: freshReads };
}

async function isTurnedOff(
  on: GlobalConfigServiceType = server,
): Promise<boolean> {
  return await on.getPushNotificationsTurnedOff();
}

beforeEach(() => {
  now = START;
  stored = settingsRow(false);
  nextReadFails = null;

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  ({ server, reads } = aServer());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how long a server keeps the switch", () => {
  test("ten seconds", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS).toBe(10_000);
  });

  test("one read answers every push for the ten seconds, to the last millisecond", async () => {
    stored = settingsRow(true);

    for (const elapsed of [0, 1, 2_500, 9_999, TEN_SECONDS]) {
      now = START + elapsed;

      await expect(isTurnedOff()).resolves.toBe(true);
    }

    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("once they run out, the row is read again and says what it says now", async () => {
    await expect(isTurnedOff()).resolves.toBe(false);

    // Another server turns push off; this one still has its copy.
    stored = settingsRow(true);

    now = START + TEN_SECONDS;
    await expect(isTurnedOff()).resolves.toBe(false);

    now = START + TEN_SECONDS + 1;
    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("the new copy is kept for ten seconds from its own read", async () => {
    await isTurnedOff();

    now = START + TEN_SECONDS + 1;
    stored = settingsRow(true);
    await isTurnedOff();

    now = START + TEN_SECONDS + 1 + TEN_SECONDS;
    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);

    now += 1;
    stored = settingsRow(false);
    await expect(isTurnedOff()).resolves.toBe(false);
    expect(reads).toHaveBeenCalledTimes(3);
  });

  test("turned off and on again within the ten seconds, a server goes on answering the copy it read", async () => {
    await expect(isTurnedOff()).resolves.toBe(false);

    stored = settingsRow(true);
    now = START + 3_000;
    await expect(isTurnedOff()).resolves.toBe(false);

    stored = settingsRow(false);
    now = START + 6_000;
    await expect(isTurnedOff()).resolves.toBe(false);

    expect(reads).toHaveBeenCalledTimes(1);
  });
});

describe("what it reads", () => {
  test("the settings row's one column, as root, with nothing in the query", async () => {
    await isTurnedOff();

    expect(reads).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledWith({
      query: {},
      select: { disablePushNotifications: true },
      props: { isRoot: true },
    });
  });

  test.each([
    [true, true],
    [false, false],
    [null, false],
    [undefined, false],
  ])(
    "a column of %p answers %p",
    async (column: boolean | null | undefined, expected: boolean) => {
      stored = settingsRow(column);

      await expect(isTurnedOff()).resolves.toBe(expected);
    },
  );

  test("the answer is a boolean, never the column's own value", async () => {
    stored = settingsRow(null);

    await expect(isTurnedOff()).resolves.toStrictEqual(false);
  });

  test("a server with no settings row has push on, and keeps that too", async () => {
    stored = null;

    await expect(isTurnedOff()).resolves.toBe(false);
    await expect(isTurnedOff()).resolves.toBe(false);

    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("push turned off is kept as surely as push on", async () => {
    stored = settingsRow(true);

    await expect(isTurnedOff()).resolves.toBe(true);

    stored = settingsRow(false);

    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});

describe("a read that fails", () => {
  test("throws the failure: it is never taken for push being on", async () => {
    nextReadFails = new Error("database unavailable");

    await expect(isTurnedOff()).rejects.toThrow("database unavailable");
  });

  test("keeps nothing: the next push reads again, and that answer is kept", async () => {
    stored = settingsRow(true);
    nextReadFails = new Error("database unavailable");

    await expect(isTurnedOff()).rejects.toThrow("database unavailable");

    await expect(isTurnedOff()).resolves.toBe(true);
    await expect(isTurnedOff()).resolves.toBe(true);

    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("each failure is its own read and its own refusal: nothing stands in for the row", async () => {
    for (let attempt: number = 1; attempt <= 3; attempt++) {
      nextReadFails = new Error(`database unavailable (${attempt})`);

      await expect(isTurnedOff()).rejects.toThrow(
        `database unavailable (${attempt})`,
      );
    }

    expect(reads).toHaveBeenCalledTimes(3);
  });

  test("a copy that ran out is not brought back by a read that fails", async () => {
    stored = settingsRow(true);
    await expect(isTurnedOff()).resolves.toBe(true);

    now = START + TEN_SECONDS + 1;
    nextReadFails = new Error("database unavailable");

    await expect(isTurnedOff()).rejects.toThrow("database unavailable");
    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(3);
  });
});

describe("forgetting the switch", () => {
  test("drops this server's copy: the next push reads the row", async () => {
    await expect(isTurnedOff()).resolves.toBe(false);

    stored = settingsRow(true);
    server.forgetPushNotificationsTurnedOff();

    await expect(isTurnedOff()).resolves.toBe(true);
    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("is harmless before anything was read", async () => {
    expect(() => {
      server.forgetPushNotificationsTurnedOff();
    }).not.toThrow();

    await expect(isTurnedOff()).resolves.toBe(false);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("each server keeps its own copy, and forgetting one leaves the other's", async () => {
    const other: { server: GlobalConfigServiceType; reads: jest.SpyInstance } =
      aServer();

    await expect(isTurnedOff(server)).resolves.toBe(false);
    await expect(isTurnedOff(other.server)).resolves.toBe(false);

    stored = settingsRow(true);
    server.forgetPushNotificationsTurnedOff();

    await expect(isTurnedOff(server)).resolves.toBe(true);
    await expect(isTurnedOff(other.server)).resolves.toBe(false);

    expect(reads).toHaveBeenCalledTimes(2);
    expect(other.reads).toHaveBeenCalledTimes(1);
  });
});

describe("a write of the server's settings (onUpdateSuccess)", () => {
  test.each([[true], [false], [null]])(
    "writing disablePushNotifications: %p drops this server's copy",
    async (written: boolean | null) => {
      await isTurnedOff();

      stored = settingsRow(written);

      await hooksOf(server).onUpdateSuccess(
        writeOf({ disablePushNotifications: written }),
        [CONFIG_ID],
      );

      await expect(isTurnedOff()).resolves.toBe(written === true);
      expect(reads).toHaveBeenCalledTimes(2);
    },
  );

  test.each([
    [{ disableUserProjectCreation: true }],
    [{ disableSignup: true }],
    [{ disableUserProjectCreation: false, disableSignup: false }],
  ])(
    "a write that leaves the switch alone keeps the copy: %j",
    async (data: Record<string, unknown>) => {
      await isTurnedOff();

      await hooksOf(server).onUpdateSuccess(writeOf(data), [CONFIG_ID]);

      await isTurnedOff();
      expect(reads).toHaveBeenCalledTimes(1);
    },
  );

  test("a write of the switch with other settings drops it too", async () => {
    await isTurnedOff();

    stored = settingsRow(true);

    await hooksOf(server).onUpdateSuccess(
      writeOf({
        disableUserProjectCreation: true,
        disablePushNotifications: true,
      }),
      [CONFIG_ID],
    );

    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("a write that failed keeps the copy: the switch is as it was", async () => {
    await expect(isTurnedOff()).resolves.toBe(false);

    await hooksOf(server).onUpdateError(
      new BadDataException("This setting cannot be changed right now."),
      writeOf({ disablePushNotifications: true }),
    );

    await expect(isTurnedOff()).resolves.toBe(false);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("the write drops only the copy of the server that wrote it", async () => {
    const other: { server: GlobalConfigServiceType; reads: jest.SpyInstance } =
      aServer();

    await isTurnedOff(server);
    await isTurnedOff(other.server);

    stored = settingsRow(true);

    await hooksOf(server).onUpdateSuccess(
      writeOf({ disablePushNotifications: true }),
      [CONFIG_ID],
    );

    await expect(isTurnedOff(server)).resolves.toBe(true);
    // The other server's copy runs out within the ten seconds.
    await expect(isTurnedOff(other.server)).resolves.toBe(false);

    now = START + TEN_SECONDS + 1;
    await expect(isTurnedOff(other.server)).resolves.toBe(true);
  });
});

describe("the switch written through the real update path", () => {
  let config: InMemoryTable;

  // Reads of the switch itself, not the rows the update path reads to write.
  const switchReads: () => number = (): number => {
    return config.repository.find.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        const select: Record<string, unknown> | undefined = (
          call[0] as { select?: Record<string, unknown> } | undefined
        )?.select;

        return (
          select !== undefined &&
          Object.keys(select).includes("disablePushNotifications")
        );
      },
    ).length;
  };

  // A master admin moves the switch, or another setting, on this server.
  const save: (data: Record<string, unknown>) => Promise<void> = async (
    data: Record<string, unknown>,
  ): Promise<void> => {
    await GlobalConfigService.updateOneById({
      id: CONFIG_ID,
      data: data as never,
      props: { isRoot: true },
    });
  };

  beforeEach(() => {
    setTestBillingEnabled(false);

    for (const silenced of ["debug", "info", "warn", "error"]) {
      jest
        .spyOn(logger, silenced as "debug" | "info" | "warn" | "error")
        .mockImplementation((): void => {
          return undefined;
        });
    }

    new InMemoryLocks().install();

    config = useInMemoryTable(GlobalConfigService, [
      {
        _id: CONFIG_ID.toString(),
        disablePushNotifications: false,
        disableUserProjectCreation: false,
      },
    ]);

    // Each test starts as a server whose ten seconds have run out.
    GlobalConfigService.forgetPushNotificationsTurnedOff();
  });

  afterEach(() => {
    GlobalConfigService.forgetPushNotificationsTurnedOff();
  });

  test("turning push off is seen by this server's next push at once, not ten seconds later", async () => {
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(false);

    await save({ disablePushNotifications: true });

    expect(config.get(CONFIG_ID)!["disablePushNotifications"]).toBe(true);
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(true);
  });

  test("turning it back on is seen at once too", async () => {
    config.get(CONFIG_ID)!["disablePushNotifications"] = true;

    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(true);

    await save({ disablePushNotifications: false });

    expect(config.get(CONFIG_ID)!["disablePushNotifications"]).toBe(false);
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(false);
  });

  test("saving another setting keeps the copy: the next push asks the database nothing", async () => {
    await GlobalConfigService.getPushNotificationsTurnedOff();
    expect(switchReads()).toBe(1);

    await save({ disableUserProjectCreation: true });

    expect(config.get(CONFIG_ID)!["disableUserProjectCreation"]).toBe(true);
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(false);
    expect(switchReads()).toBe(1);
  });

  test("another server's write is seen here when the ten seconds run out", async () => {
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(false);

    // Written by another server: this one's hooks never ran.
    config.get(CONFIG_ID)!["disablePushNotifications"] = true;

    now = START + TEN_SECONDS;
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(false);

    now = START + TEN_SECONDS + 1;
    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(true);
  });

  test("the row as a migration left it - the column's default - is push on", async () => {
    delete config.get(CONFIG_ID)!["disablePushNotifications"];

    await expect(
      GlobalConfigService.getPushNotificationsTurnedOff(),
    ).resolves.toBe(false);
  });
});
