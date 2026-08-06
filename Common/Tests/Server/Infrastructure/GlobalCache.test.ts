import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import OneUptimeDate from "../../../Types/Date";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

type MockClient = {
  set: jest.Mock;
  expire: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  eval: jest.Mock;
};

describe("GlobalCache.setString", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The TTL must be applied atomically with the SET. A separate
   * SET + EXPIRE pair can crash in between and leave a key that
   * never expires — for fence/throttle keys (e.g. the OTel ingest
   * maintenance fence) that permanently suppresses the work the
   * key gates.
   */
  test("sets the value and TTL in one atomic SET ... EX call", async () => {
    await GlobalCache.setString("ns", "key", "value", {
      expiresInSeconds: 60,
    });

    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith("ns-key", "value", "EX", 60);
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("defaults the TTL to 30 days when no option is passed", async () => {
    await GlobalCache.setString("ns", "key", "value");

    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith(
      "ns-key",
      "value",
      "EX",
      OneUptimeDate.getSecondsInDays(30),
    );
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(GlobalCache.setString("ns", "key", "value")).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    expect(client.set).not.toHaveBeenCalled();
  });

  test("setStringArray and setJSON funnel through the atomic setString", async () => {
    await GlobalCache.setStringArray("ns", "arr", ["a", "b"], {
      expiresInSeconds: 120,
    });
    await GlobalCache.setJSON("ns", "obj", { a: 1 }, { expiresInSeconds: 180 });

    expect(client.set).toHaveBeenNthCalledWith(
      1,
      "ns-arr",
      JSON.stringify(["a", "b"]),
      "EX",
      120,
    );
    expect(client.set).toHaveBeenNthCalledWith(
      2,
      "ns-obj",
      expect.any(String),
      "EX",
      180,
    );
    expect(client.expire).not.toHaveBeenCalled();
  });
});

describe("GlobalCache.deleteKey", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * deleteKey backs clearMaintenanceFence (OtelIngestBaseService): when
   * the fenced maintenance work (updateLastSeen) fails, the fence is
   * released so the next ingest batch retries instead of leaving the
   * resource stranded as "disconnected" for the whole TTL window.
   */
  test("deletes the namespaced key", async () => {
    await GlobalCache.deleteKey("ns", "key");

    expect(client.del).toHaveBeenCalledTimes(1);
    expect(client.del).toHaveBeenCalledWith("ns-key");
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(GlobalCache.deleteKey("ns", "key")).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    expect(client.del).not.toHaveBeenCalled();
  });
});

/*
 * The atomic fence primitives.
 *
 * These exist because `getString()` followed by `setString()` is
 * check-then-act, and the OneUptime ingest path is precisely the workload
 * that turns that race from theoretical into load-bearing: when thousands of
 * concurrent jobs across ~100 worker pods resolve the same row in the same
 * instant, every one of them reads the same miss and every one of them
 * proceeds. A fence written to admit ONE writer per window admitted all of
 * them, and the row-lock convoy that followed took production down (1,017
 * active connections, 892 parked on row locks, the tail waiting 3.7 hours).
 *
 * The assertions below are about atomicity — that exactly one Redis command
 * is issued, and that it carries the NX / compare-and-claim semantics. A
 * refactor that "simplifies" either of these back into a read plus a write
 * would keep every other test in the repo passing and reintroduce the outage.
 */
describe("GlobalCache.setStringIfNotExists", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("claims the fence with a single atomic SET ... EX ... NX", async () => {
    const acquired: boolean = await GlobalCache.setStringIfNotExists(
      "ns",
      "key",
      "1",
      { expiresInSeconds: 60 },
    );

    expect(acquired).toBe(true);
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith("ns-key", "1", "EX", 60, "NX");
    // No read: a GET here would be the check-then-act race coming back.
    expect(client.get).not.toHaveBeenCalled();
  });

  test("returns false when another caller already holds the fence", async () => {
    client.set.mockResolvedValue(null);

    await expect(
      GlobalCache.setStringIfNotExists("ns", "key", "1", {
        expiresInSeconds: 60,
      }),
    ).resolves.toBe(false);
  });

  /*
   * Only a literal "OK" means the key was created. Anything else — a driver
   * change, a proxy rewriting the reply — must read as "did not acquire":
   * losing a fence costs one redundant write, wrongly winning one costs the
   * mutual exclusion the fence exists to provide.
   */
  test("treats any non-OK reply as not acquired", async () => {
    client.set.mockResolvedValue("QUEUED");

    await expect(
      GlobalCache.setStringIfNotExists("ns", "key", "1"),
    ).resolves.toBe(false);
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(
      GlobalCache.setStringIfNotExists("ns", "key", "1"),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.set).not.toHaveBeenCalled();
  });

  test("defaults the TTL to 30 days when no option is passed", async () => {
    await GlobalCache.setStringIfNotExists("ns", "key", "1");

    expect(client.set).toHaveBeenCalledWith(
      "ns-key",
      "1",
      "EX",
      OneUptimeDate.getSecondsInDays(30),
      "NX",
    );
  });
});

describe("GlobalCache.setStringIfChanged", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * Plain NX is the wrong primitive for a fingerprint throttle: it fails
   * whenever the key exists, including when it holds a STALE fingerprint, so
   * a genuinely changed payload (a new service.version after a deploy) would
   * be suppressed for the whole window and never persisted at all.
   */
  test("claims the window in one atomic EVAL, with no separate read", async () => {
    const claimed: boolean = await GlobalCache.setStringIfChanged(
      "ns",
      "key",
      "fingerprint",
      { expiresInSeconds: 300 },
    );

    expect(claimed).toBe(true);
    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  test("returns false when the stored value already matches", async () => {
    client.eval.mockResolvedValue(0);

    await expect(
      GlobalCache.setStringIfChanged("ns", "key", "fingerprint"),
    ).resolves.toBe(false);
  });

  /*
   * The key must travel as KEYS[1], not be interpolated into the script body
   * — Redis Cluster routes a script by its declared keys, and an inlined key
   * makes the script run on an arbitrary node.
   */
  test("declares exactly one key, passed as KEYS[1]", async () => {
    await GlobalCache.setStringIfChanged("ns", "key", "fingerprint", {
      expiresInSeconds: 300,
    });

    const args: Array<unknown> = client.eval.mock.calls[0] as Array<unknown>;
    const script: string = args[0] as string;

    expect(args[1]).toBe(1);
    expect(args[2]).toBe("ns-key");
    expect(args[3]).toBe("fingerprint");
    expect(args[4]).toBe("300");
    expect(script).toContain("KEYS[1]");
    expect(script).not.toContain("ns-key");
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(
      GlobalCache.setStringIfChanged("ns", "key", "fingerprint"),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.eval).not.toHaveBeenCalled();
  });
});

/*
 * A fixed TTL lets a fleet-wide event — a deploy, a scale-up, a Redis restart
 * — align every row's throttle window. They then all expire in the same
 * second and the herd re-forms on a fixed period, which is the convoy back
 * again on a timer. Jitter breaks the alignment permanently: windows drift
 * apart after the first expiry and stay apart.
 */
/*
 * deleteKeyIfValue is the release half of a lease taken with
 * setStringIfNotExists (see InstanceHealthLock). The comparison is the whole
 * point: a plain DEL lets a holder that overran its TTL delete the lease a
 * DIFFERENT worker has since legitimately acquired, which hands the same lease
 * to a third worker and defeats the mutual exclusion entirely. These tests pin
 * the atomicity and the compare, because neither is visible at the call site.
 */
describe("GlobalCache.deleteKeyIfValue", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("compares and deletes in ONE eval — never GET then DEL", async () => {
    await GlobalCache.deleteKeyIfValue("ns", "key", "token-a");

    expect(client.eval).toHaveBeenCalledTimes(1);
    // A separate GET/DEL pair would reintroduce the race the script removes.
    expect(client.get).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
  });

  test("passes the key as KEYS[1] so it stays correct on Redis Cluster", async () => {
    await GlobalCache.deleteKeyIfValue("ns", "key", "token-a");

    const call: Array<unknown> = client.eval.mock.calls[0] as Array<unknown>;

    // numkeys = 1, then the key itself, then the holder token as ARGV[1].
    expect(call[1]).toBe(1);
    expect(call[2]).toBe("ns-key");
    expect(call[3]).toBe("token-a");

    const script: string = call[0] as string;
    expect(script).toContain("KEYS[1]");
    expect(script).toContain("ARGV[1]");
    // The key must never be interpolated into the script body.
    expect(script).not.toContain("ns-key");
  });

  test("returns true when this holder's own value was deleted", async () => {
    client.eval.mockResolvedValue(1);

    await expect(
      GlobalCache.deleteKeyIfValue("ns", "key", "token-a"),
    ).resolves.toBe(true);
  });

  test("returns false when the key holds a DIFFERENT holder's token", async () => {
    // Redis DEL never ran because the GET comparison failed.
    client.eval.mockResolvedValue(0);

    await expect(
      GlobalCache.deleteKeyIfValue("ns", "key", "token-a"),
    ).resolves.toBe(false);
  });

  test("returns false when the key has already expired", async () => {
    client.eval.mockResolvedValue(0);

    await expect(
      GlobalCache.deleteKeyIfValue("ns", "key", "token-a"),
    ).resolves.toBe(false);
  });

  test("treats any non-1 reply as 'did not delete'", async () => {
    /*
     * Losing a release is safe (the lease still expires on its own); wrongly
     * reporting a release is not. Anything unexpected must fail closed.
     */
    for (const reply of [null, undefined, "1", 2, "OK", {}]) {
      client.eval.mockResolvedValue(reply);

      await expect(
        GlobalCache.deleteKeyIfValue("ns", "key", "token-a"),
      ).resolves.toBe(false);
    }
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(
      GlobalCache.deleteKeyIfValue("ns", "key", "token-a"),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.eval).not.toHaveBeenCalled();
  });

  test("throws when there is no client at all", async () => {
    (Redis.getClient as jest.Mock).mockReturnValue(null);

    await expect(
      GlobalCache.deleteKeyIfValue("ns", "key", "token-a"),
    ).rejects.toThrow(DatabaseNotConnectedException);
  });

  test("namespaces the key exactly as the setters do", async () => {
    /*
     * Release must target the same key acquire created. If the two ever
     * disagreed the lease would be unreleasable and every tick would block
     * for a full TTL.
     */
    await GlobalCache.setStringIfNotExists("instance-health", "pg", "tok", {
      expiresInSeconds: 60,
    });
    await GlobalCache.deleteKeyIfValue("instance-health", "pg", "tok");

    const setKey: unknown = (client.set.mock.calls[0] as Array<unknown>)[0];
    const evalKey: unknown = (client.eval.mock.calls[0] as Array<unknown>)[2];

    expect(setKey).toBe("instance-health-pg");
    expect(evalKey).toBe(setKey);
  });
});

describe("GlobalCache.withJitter", () => {
  test("never returns less than the requested TTL", () => {
    for (let i: number = 0; i < 500; i++) {
      expect(GlobalCache.withJitter(60)).toBeGreaterThanOrEqual(60);
    }
  });

  /*
   * The ceiling is load-bearing. Every markDisconnected* sweep runs at 15
   * minutes against a 5-minute fence; +25% takes that to 6.25 minutes, still
   * 2.4x clear. Widening this without re-checking those thresholds would flap
   * healthy resources between connected and disconnected.
   */
  test("never exceeds the requested TTL by more than 25%", () => {
    for (let i: number = 0; i < 500; i++) {
      expect(GlobalCache.withJitter(300)).toBeLessThanOrEqual(375);
    }
  });

  test("actually spreads values rather than returning a constant", () => {
    const seen: Set<number> = new Set<number>();

    for (let i: number = 0; i < 200; i++) {
      seen.add(GlobalCache.withJitter(600));
    }

    expect(seen.size).toBeGreaterThan(1);
  });

  test("returns integers — Redis EX rejects fractional seconds", () => {
    for (let i: number = 0; i < 100; i++) {
      expect(Number.isInteger(GlobalCache.withJitter(37))).toBe(true);
    }
  });

  test("passes through non-positive TTLs unchanged", () => {
    expect(GlobalCache.withJitter(0)).toBe(0);
    expect(GlobalCache.withJitter(-1)).toBe(-1);
  });
});
