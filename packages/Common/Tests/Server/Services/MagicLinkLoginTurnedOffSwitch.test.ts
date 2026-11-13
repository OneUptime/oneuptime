jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import {
  MAGIC_LINK_LOGIN_TURNED_OFF_CACHE_TTL_MS,
  Service as GlobalConfigServiceType,
} from "../../../Server/Services/GlobalConfigService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHETHER SIGN-IN LINKS ARE TURNED OFF, AS A SERVER KEEPS IT.
 *
 * The sign-in page asks on every visit whether this server takes sign-in
 * links (GET /identity/sign-in-methods), and asking for a link and signing in
 * with one ask too (Types/Accounts/MagicLink). So each server keeps
 * GlobalConfig.disableMagicLinkLogin for
 * MAGIC_LINK_LOGIN_TURNED_OFF_CACHE_TTL_MS - ten seconds - and reads the
 * settings row again when they run out. A write of the switch drops this
 * server's copy at once (onUpdateSuccess); another server's copy runs out
 * within the ten seconds, and a link is refused there once it does.
 *
 * A read that fails throws and keeps nothing: asking for a link and signing
 * in with one are refused rather than take a failed read for "on".
 *
 * Each test is a server of its own (a fresh Service, with its own copy)
 * whose settings row is a stand-in read.
 */

const CONFIG_ID: ObjectID = ObjectID.getZeroObjectID();

const TEN_SECONDS: number = MAGIC_LINK_LOGIN_TURNED_OFF_CACHE_TTL_MS;

// When the test starts; the cache's clock is Date.now.
const START: number = Date.UTC(2026, 10, 3, 9, 0, 0);

interface UpdateHooks {
  onUpdateSuccess: (
    onUpdate: OnUpdate<GlobalConfig>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<GlobalConfig>>;
}

function hooksOf(server: GlobalConfigServiceType): UpdateHooks {
  return server as unknown as UpdateHooks;
}

// The settings row as a read of the switch returns it.
function settingsRow(disableMagicLinkLogin: unknown): GlobalConfig {
  return { disableMagicLinkLogin } as unknown as GlobalConfig;
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
  return await on.getMagicLinkLoginTurnedOff();
}

/*
 * The reads of the switch itself. A write's other hooks read the row too:
 * a write of the push switch starts push's sending health again (#6877),
 * which reads the row's serverSendingHealth, not this switch.
 */
function readsOfTheSwitch(spy: jest.SpyInstance = reads): number {
  return spy.mock.calls.filter((call: Array<unknown>): boolean => {
    const select: Record<string, unknown> | undefined = (
      call[0] as { select?: Record<string, unknown> } | undefined
    )?.select;

    return (
      select !== undefined &&
      Object.keys(select).includes("disableMagicLinkLogin")
    );
  }).length;
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
    expect(MAGIC_LINK_LOGIN_TURNED_OFF_CACHE_TTL_MS).toBe(10_000);
  });

  test("one read answers every visit for the ten seconds, to the last millisecond", async () => {
    stored = settingsRow(true);

    for (const elapsed of [0, 1, 2_500, 9_999, TEN_SECONDS]) {
      now = START + elapsed;

      await expect(isTurnedOff()).resolves.toBe(true);
    }

    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("once they run out, the row is read again and says what it says now", async () => {
    await expect(isTurnedOff()).resolves.toBe(false);

    // Another server turns sign-in links off; this one still has its copy.
    stored = settingsRow(true);

    now = START + TEN_SECONDS;
    await expect(isTurnedOff()).resolves.toBe(false);

    now = START + TEN_SECONDS + 1;
    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });
});

describe("what it reads", () => {
  test("the settings row's one column, as root, with nothing in the query", async () => {
    await isTurnedOff();

    expect(reads).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledWith({
      query: {},
      select: { disableMagicLinkLogin: true },
      props: { isRoot: true },
    });
  });

  test.each([
    [true, true],
    [false, false],
    [null, false],
    [undefined, false],
  ])(
    "a column of %p answers %p: links are on unless a master admin turned them off",
    async (column: boolean | null | undefined, expected: boolean) => {
      stored = settingsRow(column);

      await expect(isTurnedOff()).resolves.toStrictEqual(expected);
    },
  );

  test("a server with no settings row takes sign-in links, and keeps that too", async () => {
    stored = null;

    await expect(isTurnedOff()).resolves.toBe(false);
    await expect(isTurnedOff()).resolves.toBe(false);

    expect(reads).toHaveBeenCalledTimes(1);
  });
});

describe("a read that fails", () => {
  test("throws the failure: it is never taken for sign-in links being on", async () => {
    nextReadFails = new Error("database unavailable");

    await expect(isTurnedOff()).rejects.toThrow("database unavailable");
  });

  test("keeps nothing: the next visit reads again, and that answer is kept", async () => {
    stored = settingsRow(true);
    nextReadFails = new Error("database unavailable");

    await expect(isTurnedOff()).rejects.toThrow("database unavailable");

    await expect(isTurnedOff()).resolves.toBe(true);
    await expect(isTurnedOff()).resolves.toBe(true);

    expect(reads).toHaveBeenCalledTimes(2);
  });
});

describe("forgetting the switch", () => {
  test("drops this server's copy: the next visit reads the row", async () => {
    await expect(isTurnedOff()).resolves.toBe(false);

    stored = settingsRow(true);
    server.forgetMagicLinkLoginTurnedOff();

    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("a read on the wire when the switch is written answers its caller, but is not kept", async () => {
    let releaseRead: () => void = (): void => {
      return undefined;
    };

    reads.mockImplementationOnce(async (): Promise<GlobalConfig | null> => {
      await new Promise<void>((resolve: () => void): void => {
        releaseRead = resolve;
      });

      return settingsRow(false);
    });

    const inFlight: Promise<boolean> = isTurnedOff();

    // The switch is turned off while that read is still on the wire.
    stored = settingsRow(true);
    server.forgetMagicLinkLoginTurnedOff();
    releaseRead();

    await expect(inFlight).resolves.toBe(false);
    await expect(isTurnedOff()).resolves.toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("each server keeps its own copy, and forgetting one leaves the other's", async () => {
    const other: { server: GlobalConfigServiceType; reads: jest.SpyInstance } =
      aServer();

    await expect(isTurnedOff(server)).resolves.toBe(false);
    await expect(isTurnedOff(other.server)).resolves.toBe(false);

    stored = settingsRow(true);
    server.forgetMagicLinkLoginTurnedOff();

    await expect(isTurnedOff(server)).resolves.toBe(true);
    await expect(isTurnedOff(other.server)).resolves.toBe(false);
  });
});

describe("a write of the server's settings (onUpdateSuccess)", () => {
  test.each([[true], [false], [null]])(
    "writing disableMagicLinkLogin: %p drops this server's copy",
    async (written: boolean | null) => {
      await isTurnedOff();

      stored = settingsRow(written);

      await hooksOf(server).onUpdateSuccess(
        writeOf({ disableMagicLinkLogin: written }),
        [CONFIG_ID],
      );

      await expect(isTurnedOff()).resolves.toBe(written === true);
      expect(reads).toHaveBeenCalledTimes(2);
    },
  );

  test.each([
    [{ disableSignup: true }],
    [{ disableUserProjectCreation: true }],
    [{ disablePushNotifications: true }],
  ])(
    "a write that leaves the switch alone keeps the copy: %j",
    async (data: Record<string, unknown>) => {
      await isTurnedOff();

      await hooksOf(server).onUpdateSuccess(writeOf(data), [CONFIG_ID]);

      await isTurnedOff();
      expect(readsOfTheSwitch()).toBe(1);
    },
  );
});
