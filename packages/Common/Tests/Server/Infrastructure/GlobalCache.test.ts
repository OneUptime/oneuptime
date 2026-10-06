import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
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

describe("GlobalCache.incrementWithExpiry", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(3),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * INCR and the first EXPIRE in one evaluation: a separate EXPIRE after
   * the INCR can be lost to a crash in between, leaving a counter that
   * never expires.
   */
  test("adds one and sets the expiry in one atomic EVAL, returning the count", async () => {
    const count: number = await GlobalCache.incrementWithExpiry("ns", "key", {
      expiresInSeconds: 1800,
    });

    expect(count).toBe(3);
    expect(client.eval).toHaveBeenCalledTimes(1);

    const [script, keyCount, key, ttl] = client.eval.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];

    expect(script).toContain("INCR");
    expect(script).toContain("EXPIRE");
    expect(keyCount).toBe(1);
    expect(key).toBe("ns-key");
    expect(ttl).toBe("1800");
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("throws on a reply that is not a number", async () => {
    client.eval.mockResolvedValue("not a number");

    await expect(
      GlobalCache.incrementWithExpiry("ns", "key", { expiresInSeconds: 60 }),
    ).rejects.toThrow();
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(
      GlobalCache.incrementWithExpiry("ns", "key", { expiresInSeconds: 60 }),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.eval).not.toHaveBeenCalled();
  });
});

describe("GlobalCache.incrementIfBelow", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(4),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The read, the comparison, the INCR and the first EXPIRE in one atomic
   * evaluation: a GET then an INCR from here would let two callers both see
   * room for one more, and a refusal must add nothing, so that callers with
   * a lower limit cannot use up what callers with a higher one may still
   * take from the same counter.
   */
  test("compares, adds one and sets the expiry in one atomic EVAL, returning the count", async () => {
    const count: number | null = await GlobalCache.incrementIfBelow(
      "ns",
      "key",
      { limit: 12, expiresInSeconds: 1800 },
    );

    expect(count).toBe(4);
    expect(client.eval).toHaveBeenCalledTimes(1);

    const [script, keyCount, key, limit, ttl] = client.eval.mock.calls[0] as [
      string,
      number,
      string,
      string,
      string,
    ];

    expect(script).toContain("GET");
    expect(script).toContain(">= tonumber(ARGV[1])");
    expect(script).toContain("INCR");
    expect(script).toContain("EXPIRE");
    expect(script.indexOf("return -1")).toBeLessThan(script.indexOf("INCR"));
    expect(keyCount).toBe(1);
    expect(key).toBe("ns-key");
    expect(limit).toBe("12");
    expect(ttl).toBe("1800");
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("answers null when the counter has reached its limit", async () => {
    client.eval.mockResolvedValue(-1);

    expect(
      await GlobalCache.incrementIfBelow("ns", "key", {
        limit: 12,
        expiresInSeconds: 60,
      }),
    ).toBeNull();
  });

  test("throws on a reply that is not a number", async () => {
    client.eval.mockResolvedValue("not a number");

    await expect(
      GlobalCache.incrementIfBelow("ns", "key", {
        limit: 1,
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow();
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(
      GlobalCache.incrementIfBelow("ns", "key", {
        limit: 1,
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.eval).not.toHaveBeenCalled();
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

/*
 * getStrings backs the Proxmox native-push silent-node check
 * (ProxmoxNativeNodeLiveness): every live node's status push reads the
 * liveness key of each of its siblings. That is on the metrics ingest hot
 * path, so it must stay ONE round-trip however large the cluster, and the
 * reply must stay positional — the caller zips it back onto the node names,
 * so a reply that dropped or reordered a missing key would pin one node's
 * liveness on another and report a live node as down (or a dead one as up).
 */
type MgetMockClient = MockClient & {
  mget: jest.Mock;
};

describe("GlobalCache.getStrings", () => {
  let client: MgetMockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
      mget: jest.fn().mockResolvedValue([]),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("reads every key in ONE MGET, namespaced exactly as getString does", async () => {
    client.mget.mockResolvedValue(["1", "2", "3"]);

    await GlobalCache.getStrings("ns", ["a", "b", "c"]);

    expect(client.mget).toHaveBeenCalledTimes(1);
    expect(client.mget).toHaveBeenCalledWith(["ns-a", "ns-b", "ns-c"]);
    // One GET per key would be N round-trips on the ingest hot path.
    expect(client.get).not.toHaveBeenCalled();
  });

  test("uses the same key getString and setString use", async () => {
    client.get.mockResolvedValue("x");

    await GlobalCache.setString("proxmox", "p:c:pve1", "x", {
      expiresInSeconds: 120,
    });
    await GlobalCache.getString("proxmox", "p:c:pve1");
    await GlobalCache.getStrings("proxmox", ["p:c:pve1"]);

    const setKey: unknown = (client.set.mock.calls[0] as Array<unknown>)[0];
    const getKey: unknown = (client.get.mock.calls[0] as Array<unknown>)[0];
    const mgetKeys: unknown = (client.mget.mock.calls[0] as Array<unknown>)[0];

    expect(setKey).toBe("proxmox-p:c:pve1");
    expect(getKey).toBe(setKey);
    expect(mgetKeys).toEqual([setKey]);
  });

  test("returns the values positionally, null where a key is missing", async () => {
    client.mget.mockResolvedValue(["1,2", null, "5,6", null]);

    await expect(
      GlobalCache.getStrings("ns", ["a", "b", "c", "d"]),
    ).resolves.toEqual(["1,2", null, "5,6", null]);
  });

  test("returns all nulls when no key exists", async () => {
    client.mget.mockResolvedValue([null, null, null]);

    await expect(
      GlobalCache.getStrings("ns", ["a", "b", "c"]),
    ).resolves.toEqual([null, null, null]);
  });

  // getString reads an empty value as missing; getStrings must agree.
  test("reads an empty-string value as null, like getString", async () => {
    client.mget.mockResolvedValue(["", "x", ""]);

    await expect(
      GlobalCache.getStrings("ns", ["a", "b", "c"]),
    ).resolves.toEqual([null, "x", null]);
  });

  test("keeps duplicate keys at their own positions", async () => {
    client.mget.mockResolvedValue(["v", "w", "v"]);

    await expect(
      GlobalCache.getStrings("ns", ["a", "b", "a"]),
    ).resolves.toEqual(["v", "w", "v"]);
    expect(client.mget).toHaveBeenCalledWith(["ns-a", "ns-b", "ns-a"]);
  });

  /*
   * One entry per REQUESTED key, whatever the reply: a short reply (a
   * proxy, a driver change) pads with null rather than shifting or
   * shortening the result, and a long one is cut to the keys asked for.
   */
  test("always returns exactly one entry per requested key", async () => {
    client.mget.mockResolvedValue(["1"]);
    await expect(
      GlobalCache.getStrings("ns", ["a", "b", "c"]),
    ).resolves.toEqual(["1", null, null]);

    client.mget.mockResolvedValue(["1", "2", "3", "4"]);
    await expect(GlobalCache.getStrings("ns", ["a", "b"])).resolves.toEqual([
      "1",
      "2",
    ]);

    client.mget.mockResolvedValue([undefined, "2"]);
    await expect(GlobalCache.getStrings("ns", ["a", "b"])).resolves.toEqual([
      null,
      "2",
    ]);
  });

  test("stays one round-trip for a large cluster", async () => {
    const keys: Array<string> = [];
    for (let i: number = 0; i < 500; i++) {
      keys.push(`node-${i}`);
    }
    client.mget.mockResolvedValue(
      keys.map((key: string) => {
        return `value-${key}`;
      }),
    );

    const values: Array<string | null> = await GlobalCache.getStrings(
      "ns",
      keys,
    );

    expect(client.mget).toHaveBeenCalledTimes(1);
    expect(values).toHaveLength(500);
    expect(values[0]).toBe("value-node-0");
    expect(values[499]).toBe("value-node-499");
  });

  test("does not mutate the caller's key array", async () => {
    const keys: Array<string> = ["a", "b"];
    client.mget.mockResolvedValue(["1", "2"]);

    await GlobalCache.getStrings("ns", keys);

    expect(keys).toEqual(["a", "b"]);
  });

  test("no keys: returns [] without a Redis call", async () => {
    await expect(GlobalCache.getStrings("ns", [])).resolves.toEqual([]);
    expect(client.mget).not.toHaveBeenCalled();
  });

  // Nothing to read, so nothing to fail: an empty sibling list is not an error.
  test("no keys: returns [] even when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(GlobalCache.getStrings("ns", [])).resolves.toEqual([]);
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(GlobalCache.getStrings("ns", ["a"])).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    expect(client.mget).not.toHaveBeenCalled();
  });

  test("throws when there is no client at all", async () => {
    (Redis.getClient as jest.Mock).mockReturnValue(null);

    await expect(GlobalCache.getStrings("ns", ["a"])).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    expect(client.mget).not.toHaveBeenCalled();
  });

  /*
   * The caller decides what an MGET failure means (the silent-node check
   * reports nothing); getStrings must not swallow it into "every key is
   * missing", which would read as "every sibling is silent".
   */
  test("propagates an MGET failure instead of returning nulls", async () => {
    client.mget.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(GlobalCache.getStrings("ns", ["a", "b"])).rejects.toThrow(
      "ETIMEDOUT",
    );
  });
});

describe("GlobalCache.getAndDeleteString", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue("value"),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * Single-use tokens (OAuth state nonces) depend on this: a GET followed by
   * a DEL lets two concurrent replays of the same token both read it before
   * either deletes it.
   */
  test("reads and deletes in ONE eval — never GET then DEL", async () => {
    await GlobalCache.getAndDeleteString("ns", "key");

    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
  });

  test("passes the key as KEYS[1] so it stays correct on Redis Cluster", async () => {
    await GlobalCache.getAndDeleteString("ns", "key");

    const call: Array<unknown> = client.eval.mock.calls[0] as Array<unknown>;

    expect(call[1]).toBe(1);
    expect(call[2]).toBe("ns-key");

    const script: string = call[0] as string;
    expect(script).toContain("GET");
    expect(script).toContain("DEL");
    expect(script).toContain("KEYS[1]");
    expect(script).not.toContain("ns-key");
  });

  test("returns the value that was stored", async () => {
    client.eval.mockResolvedValue("stored-value");

    await expect(GlobalCache.getAndDeleteString("ns", "key")).resolves.toBe(
      "stored-value",
    );
  });

  test("returns null when the key does not exist", async () => {
    // A nil Lua return arrives from ioredis as null.
    client.eval.mockResolvedValue(null);

    await expect(
      GlobalCache.getAndDeleteString("ns", "key"),
    ).resolves.toBeNull();
  });

  test("returns null for an empty or non-string reply", async () => {
    client.eval.mockResolvedValue("");
    await expect(
      GlobalCache.getAndDeleteString("ns", "key"),
    ).resolves.toBeNull();

    client.eval.mockResolvedValue(0);
    await expect(
      GlobalCache.getAndDeleteString("ns", "key"),
    ).resolves.toBeNull();
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(GlobalCache.getAndDeleteString("ns", "key")).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    expect(client.eval).not.toHaveBeenCalled();
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

/*
 * setNumberIfGreater keeps a monotonic timestamp: when an Incoming Request
 * monitor last received a request (IncomingRequestReceivedAtStore). The
 * ingest endpoint, the ingest workers and the heartbeat cron all write it
 * concurrently, so the compare and the write must be one step - a client-side
 * GET then SET lets a smaller value land last and move the clock backwards.
 * The endpoint is unauthenticated and may only advance a key a trusted
 * caller created, which is what onlyIfExists pins.
 *
 * The script's Redis semantics were checked against a real Valkey; these
 * tests pin the call shape and the reply handling.
 */
describe("GlobalCache.setNumberIfGreater", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue("1791234567890"),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("compares and writes in ONE eval - never a client-side GET then SET", async () => {
    await GlobalCache.setNumberIfGreater("ns", "key", 1791234567890, {
      expiresInSeconds: 86400,
    });

    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("passes the key as KEYS[1] and the value, TTL and create flag as ARGV", async () => {
    await GlobalCache.setNumberIfGreater("ns", "key", 1791234567890, {
      expiresInSeconds: 86400,
    });

    const args: Array<unknown> = client.eval.mock.calls[0] as Array<unknown>;
    const script: string = args[0] as string;

    expect(args.slice(1)).toEqual([1, "ns-key", "1791234567890", "86400", "0"]);
    expect(script).toContain("KEYS[1]");
    expect(script).not.toContain("ns-key");
  });

  test("onlyIfExists sends the update-only flag", async () => {
    await GlobalCache.setNumberIfGreater("ns", "key", 5, {
      expiresInSeconds: 60,
      onlyIfExists: true,
    });

    const args: Array<unknown> = client.eval.mock.calls[0] as Array<unknown>;

    expect(args[5]).toBe("1");
  });

  test("the script only creates a missing key when the update-only flag is off", async () => {
    await GlobalCache.setNumberIfGreater("ns", "key", 5, {
      expiresInSeconds: 60,
    });

    const script: string = client.eval.mock.calls[0]![0] as string;

    // Missing key + update-only: answer nil before any write.
    expect(script).toMatch(
      /if not stored and ARGV\[3\] == '1' then return false end/,
    );
    // A write sets the value and its expiry together.
    expect(script).toContain(
      "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])",
    );
    // Only a strictly greater number (or a missing/garbled one) is written.
    expect(script).toContain("tonumber(ARGV[1]) > current");
    // A kept value still has its expiry re-armed.
    expect(script).toContain("redis.call('EXPIRE', KEYS[1], ARGV[2])");
  });

  test("returns the number the key holds afterwards", async () => {
    client.eval.mockResolvedValue("1791234599999");

    await expect(
      GlobalCache.setNumberIfGreater("ns", "key", 1791234567890, {
        expiresInSeconds: 60,
      }),
    ).resolves.toBe(1791234599999);
  });

  test("returns null when an update-only call found no key", async () => {
    client.eval.mockResolvedValue(null);

    await expect(
      GlobalCache.setNumberIfGreater("ns", "key", 1791234567890, {
        expiresInSeconds: 60,
        onlyIfExists: true,
      }),
    ).resolves.toBeNull();
  });

  test("throws on a reply that is not a number", async () => {
    client.eval.mockResolvedValue("not-a-number");

    await expect(
      GlobalCache.setNumberIfGreater("ns", "key", 1, {
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("refuses a value that is not a finite number, without calling Redis", async () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        GlobalCache.setNumberIfGreater("ns", "key", value, {
          expiresInSeconds: 60,
        }),
      ).rejects.toThrow(BadDataException);
    }

    expect(client.eval).not.toHaveBeenCalled();
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(
      GlobalCache.setNumberIfGreater("ns", "key", 1, {
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow(DatabaseNotConnectedException);
    expect(client.eval).not.toHaveBeenCalled();
  });
});
