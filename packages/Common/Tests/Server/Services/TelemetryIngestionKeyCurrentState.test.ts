import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestionKeyService, {
  CURRENT_STATE_FRESH_MS,
  CURRENT_STATE_STALE_GRACE_MS,
  Service as TelemetryIngestionKeyServiceClass,
  TELEMETRY_INGESTION_KEY_GENERATION_NAMESPACE,
} from "../../../Server/Services/TelemetryIngestionKeyService";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import TelemetryIngestionKeySecretDigest from "../../../Server/Utils/Telemetry/TelemetryIngestionKeySecretDigest";
import logger from "../../../Server/Utils/Logger";

/*
 * THE KEY AS IT IS NOW, FOR A SESSION THAT CONNECTED BEFORE (issue #8147).
 *
 * An MQTT session proves it holds an ingestion key's secret at CONNECT and
 * then publishes for days or weeks. The broker now asks, on every publish,
 * for the key as it is now: getCurrentPolicyById, by the key's id and a
 * digest of the secret the session presented. This suite holds that lookup
 * to what the broker, and the docs, rely on:
 *
 *   - it answers the key's policy only for the digest of its current
 *     secret: null once the key is deleted or its secret is reset, and the
 *     policy of a disabled or expired key, which the broker refuses itself;
 *   - it keeps no secret, only digests, so a heap snapshot of a broker holds
 *     no live credential;
 *   - its STALENESS IS BOUNDED: an update or delete through the service is
 *     seen at once in the process that made it and within
 *     CacheGenerations.SHARED_READ_TTL_MS in every other (through Redis); a
 *     change the service never hears of (a key deleted with its project),
 *     or one made while Redis is down, within CURRENT_STATE_FRESH_MS - a
 *     few seconds;
 *   - it reads Postgres at most once per key per window, whatever the
 *     publish rate, and publishes that ask together share one read;
 *   - when the read fails, it goes by what it last read for at most
 *     CURRENT_STATE_STALE_GRACE_MS, asking again once a window, and then
 *     fails.
 *
 * No Postgres and no Redis: the base DatabaseService is a fake whose
 * findOneBy reads a table of rows held here, GlobalCache is a map that can
 * be taken down, and the clock is Date.now, moved by hand. Two instances of
 * the real service class sharing that table and that map are two servers.
 */

jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return {
    __esModule: true,
    default: { requirePayAsYouGo: jest.fn().mockResolvedValue(undefined) },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      isProjectBlocked: jest.fn().mockResolvedValue(false),
      isSampleProject: jest.fn().mockResolvedValue(false),
    },
  };
});

jest.mock("../../../Server/Services/DatabaseService", () => {
  class FakeDatabaseService {
    public modelType: unknown;

    public constructor(modelType: unknown) {
      this.modelType = modelType;
    }

    // Base-class configuration helpers other services' constructors call.
    public hardDeleteItemsOlderThanInDays(): void {
      // no-op
    }

    public setDoNotAllowDelete(): void {
      // no-op
    }

    public keepRowsOnDeleteByQuery(): void {
      // no-op
    }

    public async findOneBy(): Promise<unknown> {
      throw new Error(
        "findOneBy stub was not replaced - the test must install its own implementation.",
      );
    }

    public async updateColumnsByIdWithoutHooks(): Promise<unknown> {
      return undefined;
    }

    // What a subclass's hooks call up to.
    protected async onUpdateSuccess(onUpdate: unknown): Promise<unknown> {
      return onUpdate;
    }

    protected async onDeleteSuccess(onDelete: unknown): Promise<unknown> {
      return onDelete;
    }
  }

  return {
    __esModule: true,
    default: FakeDatabaseService,
  };
});

// Redis, as a map that can be taken down.
jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  const store: Map<string, string> = new Map();
  const state: { isDown: boolean } = { isDown: false };

  return {
    __esModule: true,
    default: {
      getString: jest.fn(
        async (namespace: string, key: string): Promise<string | null> => {
          if (state.isDown) {
            throw new Error("Cache is not connected");
          }
          return store.get(`${namespace}:${key}`) ?? null;
        },
      ),
      setString: jest.fn(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<void> => {
          if (state.isDown) {
            throw new Error("Cache is not connected");
          }
          store.set(`${namespace}:${key}`, value);
        },
      ),
    },
    __redis: { store, state },
  };
});

jest.mock("../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

type MockFn = jest.Mock;

const redis: { store: Map<string, string>; state: { isDown: boolean } } = (
  jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
    __redis: { store: Map<string, string>; state: { isDown: boolean } };
  }
).__redis;

// A TelemetryIngestionKey row, as Postgres hands it back.
type FakeRow = Record<string, unknown>;

/*
 * The protected and private parts of a service instance this suite drives:
 * the base-class accessor it replaces, the hooks DatabaseService calls
 * around a write, and the caches whose contents it inspects.
 */
interface ServiceInternals {
  findOneBy: MockFn;
  updateColumnsByIdWithoutHooks: MockFn;
  onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
  onUpdateSuccess: (
    onUpdate: unknown,
    ids: Array<ObjectID>,
  ) => Promise<unknown>;
  onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
  onDeleteSuccess: (
    onDelete: unknown,
    ids: Array<ObjectID>,
  ) => Promise<unknown>;
  currentStateCache: { store: Map<string, { value: unknown }> };
  policyCache: { clear: () => void };
}

const internalsOf: (
  service: TelemetryIngestionKeyServiceClass,
) => ServiceInternals = (
  service: TelemetryIngestionKeyServiceClass,
): ServiceInternals => {
  return service as unknown as ServiceInternals;
};

// The database every server reads: one table of keys, by id.
let table: Map<string, FakeRow> = new Map();
let clock: number = 0;

// A server: the real service class over the shared table.
const newServer: () => TelemetryIngestionKeyServiceClass =
  (): TelemetryIngestionKeyServiceClass => {
    const server: TelemetryIngestionKeyServiceClass =
      new TelemetryIngestionKeyServiceClass();

    internalsOf(server).findOneBy = jest
      .fn()
      .mockImplementation(async (findOneBy: unknown): Promise<unknown> => {
        const query: Record<string, unknown> = (
          findOneBy as { query: Record<string, unknown> }
        ).query;

        if (query["_id"]) {
          return table.get((query["_id"] as ObjectID).toString()) ?? null;
        }

        if (query["secretKey"]) {
          const secret: string = (query["secretKey"] as ObjectID)
            .toString()
            .toLowerCase();

          for (const row of table.values()) {
            if (String(row["secretKey"]).toLowerCase() === secret) {
              return row;
            }
          }
        }

        return null;
      });

    return server;
  };

interface KeyFixture {
  id: ObjectID;
  projectId: ObjectID;
  secret: string;
  digest: string;
}

const insertKey: (columns?: FakeRow) => KeyFixture = (
  columns: FakeRow = {},
): KeyFixture => {
  const id: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();
  const secret: string = ObjectID.generate().toString();

  table.set(id.toString(), {
    _id: id.toString(),
    projectId: projectId,
    secretKey: new ObjectID(secret),
    keyType: TelemetryIngestionKeyType.Server,
    isEnabled: true,
    expiresAt: null,
    ...columns,
  });

  return {
    id,
    projectId,
    secret,
    digest: TelemetryIngestionKeySecretDigest.of(secret),
  };
};

const rowOf: (key: KeyFixture) => FakeRow = (key: KeyFixture): FakeRow => {
  const row: FakeRow | undefined = table.get(key.id.toString());
  expect(row).toBeDefined();
  return row!;
};

const currentOf: (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
  digest?: string,
) => Promise<TelemetryIngestionKeyPolicy | null> = (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
  digest?: string,
): Promise<TelemetryIngestionKeyPolicy | null> => {
  return server.getCurrentPolicyById({
    ingestionKeyId: key.id,
    secretKeyDigest: digest ?? key.digest,
  });
};

const readsOf: (server: TelemetryIngestionKeyServiceClass) => number = (
  server: TelemetryIngestionKeyServiceClass,
): number => {
  return internalsOf(server).findOneBy.mock.calls.length;
};

// An update through the service, as DatabaseService runs it.
const updateThrough: (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
  data: FakeRow,
) => Promise<void> = async (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
  data: FakeRow,
): Promise<void> => {
  const updateBy: Record<string, unknown> = {
    query: { _id: key.id },
    data: { ...data },
    props: { isRoot: true },
  };

  await internalsOf(server).onBeforeUpdate(updateBy);
  Object.assign(rowOf(key), data);
  await internalsOf(server).onUpdateSuccess({ updateBy, carryForward: null }, [
    key.id,
  ]);
};

const deleteThrough: (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
) => Promise<void> = async (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
): Promise<void> => {
  const deleteBy: Record<string, unknown> = {
    query: { _id: key.id },
    props: { isRoot: true },
  };

  await internalsOf(server).onBeforeDelete(deleteBy);
  table.delete(key.id.toString());
  await internalsOf(server).onDeleteSuccess({ deleteBy, carryForward: null }, [
    key.id,
  ]);
};

beforeEach(() => {
  jest.clearAllMocks();
  table = new Map();
  redis.store.clear();
  redis.state.isDown = false;
  clock = 1_800_000_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clock;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the key as it is now", () => {
  test("is the key's policy, for the digest of its secret, read by id as root with the policy columns and the secret", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey({ pinnedServiceName: "gateway" });

    const policy: TelemetryIngestionKeyPolicy | null = await currentOf(
      server,
      key,
    );

    expect(policy).not.toBeNull();
    expect(policy!.ingestionKeyId.toString()).toBe(key.id.toString());
    expect(policy!.projectId.toString()).toBe(key.projectId.toString());
    expect(policy!.keyType).toBe(TelemetryIngestionKeyType.Server);
    expect(policy!.isEnabled).toBe(true);
    expect(policy!.expiresAt).toBeNull();
    expect(policy!.pinnedServiceName).toBe("gateway");

    expect(internalsOf(server).findOneBy).toHaveBeenCalledTimes(1);
    const findOneBy: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    } = internalsOf(server).findOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    };

    expect(findOneBy.query).toEqual({ _id: key.id });
    expect(findOneBy.props).toEqual({ isRoot: true });
    for (const column of [
      "_id",
      "projectId",
      "secretKey",
      "keyType",
      "allowedOrigins",
      "pinnedServiceName",
      "isEnabled",
      "expiresAt",
      "requestsPerMinuteLimit",
    ]) {
      expect({ column, selected: findOneBy.select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test("matches a secret presented in capitals or with spaces around it: Postgres compares uuids without case", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    for (const presented of [
      key.secret.toUpperCase(),
      ` ${key.secret} `,
      key.secret,
    ]) {
      expect(
        await currentOf(
          server,
          key,
          TelemetryIngestionKeySecretDigest.of(presented),
        ),
      ).not.toBeNull();
    }
  });

  test("is null for the digest of any other secret: the key's secret was reset", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    const other: KeyFixture = insertKey();

    expect(
      await currentOf(
        server,
        key,
        TelemetryIngestionKeySecretDigest.of(ObjectID.generate().toString()),
      ),
    ).toBeNull();
    // Another key's secret does not open this one.
    expect(await currentOf(server, key, other.digest)).toBeNull();
    expect(await currentOf(server, key, "")).toBeNull();
    expect(await currentOf(server, key, "not a digest")).toBeNull();
  });

  test("is null for an id no key has: the key was deleted", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    table.delete(key.id.toString());

    expect(await currentOf(server, key)).toBeNull();
  });

  test("is null for a row with no secret or no project, as if there were no key", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const noSecret: KeyFixture = insertKey({ secretKey: null });
    const noProject: KeyFixture = insertKey({ projectId: null });

    expect(await currentOf(server, noSecret)).toBeNull();
    expect(await currentOf(server, noProject)).toBeNull();
  });

  test("still resolves a key that is switched off or expired, so the caller says why it refuses it", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const expiredAt: Date = new Date(clock - 1000);
    const disabled: KeyFixture = insertKey({ isEnabled: false });
    const expired: KeyFixture = insertKey({ expiresAt: expiredAt });

    expect((await currentOf(server, disabled))?.isEnabled).toBe(false);
    expect((await currentOf(server, expired))?.expiresAt?.getTime()).toBe(
      expiredAt.getTime(),
    );
  });

  test("is a fresh object on every call: a caller that changes it changes nothing kept", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey({
      allowedOrigins: ["https://a.example.com"],
    });

    const first: TelemetryIngestionKeyPolicy = (await currentOf(server, key))!;
    first.isEnabled = false;
    first.allowedOrigins.push("https://evil.example.com");

    const second: TelemetryIngestionKeyPolicy = (await currentOf(server, key))!;

    expect(second).not.toBe(first);
    expect(second.isEnabled).toBe(true);
    expect(second.allowedOrigins).toEqual(["https://a.example.com"]);
    expect(readsOf(server)).toBe(1);
  });

  test("keeps a digest of the key's secret, never the secret", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    await currentOf(server, key);

    const kept: Map<string, { value: unknown }> =
      internalsOf(server).currentStateCache.store;
    expect(kept.size).toBe(1);

    const everythingKept: string = JSON.stringify(
      Array.from(kept.entries()),
    ).toLowerCase();

    expect(everythingKept).not.toContain(key.secret.toLowerCase());
    expect(everythingKept).toContain(key.digest);
    expect(everythingKept).toContain(key.id.toString().toLowerCase());
  });
});

describe("the digest", () => {
  test("is a SHA-256 of the lower-cased, trimmed secret, and compares only equal digests", () => {
    const secret: string = ObjectID.generate().toString();
    const digest: string = TelemetryIngestionKeySecretDigest.of(secret);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(secret);
    expect(TelemetryIngestionKeySecretDigest.of(secret.toUpperCase())).toBe(
      digest,
    );
    expect(TelemetryIngestionKeySecretDigest.of(`\t${secret}\n`)).toBe(digest);
    expect(
      TelemetryIngestionKeySecretDigest.of(ObjectID.generate().toString()),
    ).not.toBe(digest);

    expect(TelemetryIngestionKeySecretDigest.matches(digest, digest)).toBe(
      true,
    );
    expect(
      TelemetryIngestionKeySecretDigest.matches(digest, digest.slice(1)),
    ).toBe(false);
    expect(
      TelemetryIngestionKeySecretDigest.matches(
        digest,
        TelemetryIngestionKeySecretDigest.of(ObjectID.generate().toString()),
      ),
    ).toBe(false);
  });
});

describe("how stale the key as it is now can be", () => {
  test("is a few seconds: CURRENT_STATE_FRESH_MS is five, and a change through Redis reaches every server within one", () => {
    expect(CURRENT_STATE_FRESH_MS).toBe(5 * 1000);
    expect(CacheGenerations.SHARED_READ_TTL_MS).toBe(1000);
    expect(CacheGenerations.SHARED_READ_TTL_MS).toBeLessThan(
      CURRENT_STATE_FRESH_MS,
    );
    // The grace for a failing read is the minute every other path's cache holds a key for.
    expect(CURRENT_STATE_STALE_GRACE_MS).toBe(60 * 1000);
  });

  test("publishes within one window share one read, whatever the publish rate; the next window reads again", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    for (let index: number = 0; index < 100; index++) {
      expect(await currentOf(server, key)).not.toBeNull();
    }
    expect(readsOf(server)).toBe(1);

    clock += CURRENT_STATE_FRESH_MS - 1;
    await currentOf(server, key);
    expect(readsOf(server)).toBe(1);

    clock += 1;
    await currentOf(server, key);
    expect(readsOf(server)).toBe(2);
  });

  test("publishes that ask together share one read", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    let answer: (() => void) | null = null;
    const findOneBy: MockFn = internalsOf(server).findOneBy;
    const read: (findOneBy: unknown) => Promise<unknown> =
      findOneBy.getMockImplementation() as (
        findOneBy: unknown,
      ) => Promise<unknown>;
    findOneBy.mockImplementationOnce(
      async (query: unknown): Promise<unknown> => {
        await new Promise<void>((resolve: () => void): void => {
          answer = resolve;
        });
        return read(query);
      },
    );

    const asked: Array<Promise<TelemetryIngestionKeyPolicy | null>> =
      Array.from({ length: 20 }, () => {
        return currentOf(server, key);
      });

    // Every ask is waiting on the one read before it answers.
    for (let tick: number = 0; tick < 100 && !answer; tick++) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
    expect(answer).not.toBeNull();
    expect(readsOf(server)).toBe(1);
    (answer as unknown as () => void)();

    const answers: Array<TelemetryIngestionKeyPolicy | null> =
      await Promise.all(asked);

    expect(readsOf(server)).toBe(1);
    for (const policy of answers) {
      expect(policy?.ingestionKeyId.toString()).toBe(key.id.toString());
    }
  });

  test("keeps each key apart: one key's read is not another's", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const first: KeyFixture = insertKey();
    const second: KeyFixture = insertKey({ isEnabled: false });

    expect((await currentOf(server, first))?.isEnabled).toBe(true);
    expect((await currentOf(server, second))?.isEnabled).toBe(false);
    expect(await currentOf(server, first, second.digest)).toBeNull();
    expect(readsOf(server)).toBe(2);
  });

  test.each([
    {
      label: "switched off",
      change: (row: FakeRow): void => {
        row["isEnabled"] = false;
      },
      seen: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy !== null && policy.isEnabled === false;
      },
    },
    {
      label: "given a new secret",
      change: (row: FakeRow): void => {
        row["secretKey"] = ObjectID.generate();
      },
      seen: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy === null;
      },
    },
    {
      label: "deleted with its project (the database does that without hooks)",
      change: (row: FakeRow): void => {
        table.delete(String(row["_id"]));
      },
      seen: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy === null;
      },
    },
  ])(
    "a key $label, a change the service does not hear of, is seen within CURRENT_STATE_FRESH_MS",
    async (scenario: {
      label: string;
      change: (row: FakeRow) => void;
      seen: (policy: TelemetryIngestionKeyPolicy | null) => boolean;
    }) => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();
      const readAt: number = clock;

      expect(await currentOf(server, key)).not.toBeNull();

      clock += 1000;
      scenario.change(rowOf(key));

      // Inside the window, the read from before may still be served...
      clock = readAt + CURRENT_STATE_FRESH_MS - 1;
      expect(scenario.seen(await currentOf(server, key))).toBe(false);

      // ...and never after it.
      clock = readAt + CURRENT_STATE_FRESH_MS;
      expect(scenario.seen(await currentOf(server, key))).toBe(true);
    },
  );
});

describe("an update or a delete through the service", () => {
  test.each([
    {
      label: "switched off",
      data: (): FakeRow => {
        return { isEnabled: false };
      },
      seen: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy !== null && policy.isEnabled === false;
      },
    },
    {
      label: "given a new secret",
      data: (): FakeRow => {
        return { secretKey: ObjectID.generate() };
      },
      seen: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy === null;
      },
    },
    {
      label: "given an expiry",
      data: (): FakeRow => {
        return { expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
      },
      seen: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy !== null && policy.expiresAt !== null;
      },
    },
  ])(
    "a key $label is seen at once in the server that made the change",
    async (scenario: {
      label: string;
      data: () => FakeRow;
      seen: (policy: TelemetryIngestionKeyPolicy | null) => boolean;
    }) => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();

      expect(scenario.seen(await currentOf(server, key))).toBe(false);

      await updateThrough(server, key, scenario.data());

      // No time has passed.
      expect(scenario.seen(await currentOf(server, key))).toBe(true);
      expect(readsOf(server)).toBe(2);
    },
  );

  test("a key given a new secret answers for the new secret at once", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    expect(await currentOf(server, key)).not.toBeNull();

    const newSecret: ObjectID = ObjectID.generate();
    await updateThrough(server, key, { secretKey: newSecret });

    expect(await currentOf(server, key)).toBeNull();
    expect(
      await currentOf(
        server,
        key,
        TelemetryIngestionKeySecretDigest.of(newSecret.toString()),
      ),
    ).not.toBeNull();
  });

  test("a deleted key is gone at once in the server that deleted it", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    expect(await currentOf(server, key)).not.toBeNull();

    await deleteThrough(server, key);

    expect(await currentOf(server, key)).toBeNull();
  });

  test("starts a new generation of only the keys it wrote", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const changed: KeyFixture = insertKey();
    const untouched: KeyFixture = insertKey();

    await currentOf(server, changed);
    await currentOf(server, untouched);
    expect(readsOf(server)).toBe(2);

    await updateThrough(server, changed, { isEnabled: false });

    await currentOf(server, untouched);
    expect(readsOf(server)).toBe(2);
    await currentOf(server, changed);
    expect(readsOf(server)).toBe(3);

    expect(Array.from(redis.store.keys())).toEqual([
      `${TELEMETRY_INGESTION_KEY_GENERATION_NAMESPACE}:${changed.id
        .toString()
        .toLowerCase()}`,
    ]);
  });

  test.each([
    { label: "switched off", isDelete: false },
    { label: "deleted", isDelete: true },
  ])(
    "a key $label is seen by every other server within CacheGenerations.SHARED_READ_TTL_MS, well inside its window",
    async (scenario: { label: string; isDelete: boolean }) => {
      const here: TelemetryIngestionKeyServiceClass = newServer();
      const there: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();

      // The other server has the key, read just now.
      expect((await currentOf(there, key))?.isEnabled).toBe(true);
      const readThereAt: number = clock;

      clock += 100;
      if (scenario.isDelete) {
        await deleteThrough(here, key);
      } else {
        await updateThrough(here, key, { isEnabled: false });
      }
      const changedAt: number = clock;

      const stopped: (policy: TelemetryIngestionKeyPolicy | null) => boolean = (
        policy: TelemetryIngestionKeyPolicy | null,
      ): boolean => {
        return policy === null || policy.isEnabled === false;
      };

      clock = changedAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
      expect(stopped(await currentOf(there, key))).toBe(true);

      // The generation did it, not the window running out.
      expect(clock).toBeLessThan(readThereAt + CURRENT_STATE_FRESH_MS);
    },
  );

  test("while Redis is down, the change counts at once where it was made, and within CURRENT_STATE_FRESH_MS everywhere else", async () => {
    const here: TelemetryIngestionKeyServiceClass = newServer();
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    redis.state.isDown = true;

    expect((await currentOf(here, key))?.isEnabled).toBe(true);
    expect((await currentOf(there, key))?.isEnabled).toBe(true);
    const readThereAt: number = clock;

    clock += 100;
    await updateThrough(here, key, { isEnabled: false });

    expect((await currentOf(here, key))?.isEnabled).toBe(false);

    clock = readThereAt + CURRENT_STATE_FRESH_MS;
    expect((await currentOf(there, key))?.isEnabled).toBe(false);
  });

  test("an update the service refused before writing reads nothing again", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    await currentOf(server, key);

    // keyType is immutable: onBeforeUpdate refuses, so onUpdateSuccess never runs.
    await expect(
      internalsOf(server).onBeforeUpdate({
        query: { _id: key.id },
        data: { keyType: TelemetryIngestionKeyType.Browser },
        props: { isRoot: true },
      }),
    ).rejects.toThrow("cannot be changed");

    await currentOf(server, key);
    expect(readsOf(server)).toBe(1);
  });

  test("stamping Last Used At is not a change: the key is not read again", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    await currentOf(server, key);

    await server.markUsed(key.id);

    await currentOf(server, key);
    expect(readsOf(server)).toBe(1);
    expect(redis.store.size).toBe(0);
  });

  test("clears the lookup by secret again once the write is done: a lookup that raced the write does not outlive it", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    expect((await server.getPolicyFromSecretKey(key.secret))?.isEnabled).toBe(
      true,
    );

    const updateBy: Record<string, unknown> = {
      query: { _id: key.id },
      data: { isEnabled: false },
      props: { isRoot: true },
    };
    await internalsOf(server).onBeforeUpdate(updateBy);

    // A lookup between onBeforeUpdate and the write puts the old row back.
    expect((await server.getPolicyFromSecretKey(key.secret))?.isEnabled).toBe(
      true,
    );

    rowOf(key)["isEnabled"] = false;
    await internalsOf(server).onUpdateSuccess(
      { updateBy, carryForward: null },
      [key.id],
    );

    expect((await server.getPolicyFromSecretKey(key.secret))?.isEnabled).toBe(
      false,
    );
  });

  test("clears the lookup by secret again once a delete is done", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    expect(await server.getPolicyFromSecretKey(key.secret)).not.toBeNull();

    const deleteBy: Record<string, unknown> = {
      query: { _id: key.id },
      props: { isRoot: true },
    };
    await internalsOf(server).onBeforeDelete(deleteBy);
    expect(await server.getPolicyFromSecretKey(key.secret)).not.toBeNull();

    table.delete(key.id.toString());
    await internalsOf(server).onDeleteSuccess(
      { deleteBy, carryForward: null },
      [key.id],
    );

    expect(await server.getPolicyFromSecretKey(key.secret)).toBeNull();
  });

  test("an update or delete that wrote no row starts no generation", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();

    await internalsOf(server).onUpdateSuccess(
      { updateBy: { query: {}, data: {}, props: {} }, carryForward: null },
      [],
    );
    await internalsOf(server).onDeleteSuccess(
      { deleteBy: { query: {}, props: {} }, carryForward: null },
      [],
    );

    expect(redis.store.size).toBe(0);
  });
});

describe("when reading the key fails", () => {
  test("with nothing read before, the failure is the caller's", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    internalsOf(server).findOneBy.mockRejectedValue(
      new Error("Postgres is down"),
    );

    await expect(currentOf(server, key)).rejects.toThrow("Postgres is down");
  });

  test("the key as last read is served for up to CURRENT_STATE_STALE_GRACE_MS, asked for again once a window, and then the failure is the caller's", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    const readAt: number = clock;

    expect(await currentOf(server, key)).not.toBeNull();

    const findOneBy: MockFn = internalsOf(server).findOneBy;
    const read: (findOneBy: unknown) => Promise<unknown> =
      findOneBy.getMockImplementation() as (
        findOneBy: unknown,
      ) => Promise<unknown>;
    findOneBy.mockRejectedValue(new Error("Postgres is down"));

    // The window ran out: asked again, which fails, and the last read stands.
    clock = readAt + CURRENT_STATE_FRESH_MS;
    expect(await currentOf(server, key)).not.toBeNull();
    expect(readsOf(server)).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not read ingestion key ${key.id.toString().toLowerCase()} again`,
      ),
    );
    expect(JSON.stringify((logger.warn as MockFn).mock.calls)).not.toContain(
      key.secret,
    );

    // Not asked again for every publish while it is down: once a window.
    for (let index: number = 0; index < 50; index++) {
      expect(await currentOf(server, key)).not.toBeNull();
    }
    expect(readsOf(server)).toBe(2);

    clock = readAt + 2 * CURRENT_STATE_FRESH_MS;
    expect(await currentOf(server, key)).not.toBeNull();
    expect(readsOf(server)).toBe(3);

    // A minute after the last good read, it fails.
    clock = readAt + CURRENT_STATE_STALE_GRACE_MS + 1;
    await expect(currentOf(server, key)).rejects.toThrow("Postgres is down");

    // And once Postgres answers again, the key as it is then.
    findOneBy.mockImplementation(read);
    rowOf(key)["isEnabled"] = false;
    expect((await currentOf(server, key))?.isEnabled).toBe(false);
  });

  test("a change through the service is not covered up by the last read: with the read failing, it fails", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    expect(await currentOf(server, key)).not.toBeNull();

    await updateThrough(server, key, { isEnabled: false });
    internalsOf(server).findOneBy.mockRejectedValue(
      new Error("Postgres is down"),
    );

    await expect(currentOf(server, key)).rejects.toThrow("Postgres is down");
  });
});

describe("the service everyone imports", () => {
  test("is an instance of the class this suite drives", () => {
    expect(TelemetryIngestionKeyService).toBeInstanceOf(
      TelemetryIngestionKeyServiceClass,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE LOOKUP BY SECRET, ON EVERY SERVER (issue #8370).
 *
 * HTTP and OTLP/gRPC ingest - and MQTT at CONNECT - resolve a key by its
 * secret (getPolicyFromSecretKey), kept per process for POSITIVE_TTL_MS, a
 * minute. An update or delete cleared it only in the process that made it,
 * so every other server kept accepting a key switched off, reset or deleted
 * for up to a minute. Now each entry is kept under the key's generation,
 * which the change renews through Redis: every server stops the key within
 * CacheGenerations.SHARED_READ_TTL_MS, a second, while Redis is up; while it
 * is down, the minute stays the bound. Still no Postgres read per request.
 * ---------------------------------------------------------------------------
 */

const POSITIVE_TTL_MS: number = 60 * 1000;
const NEGATIVE_TTL_MS: number = 10 * 1000;

const lookUp: (
  server: TelemetryIngestionKeyServiceClass,
  secret: string,
) => Promise<TelemetryIngestionKeyPolicy | null> = (
  server: TelemetryIngestionKeyServiceClass,
  secret: string,
): Promise<TelemetryIngestionKeyPolicy | null> => {
  return server.getPolicyFromSecretKey(secret);
};

// How often Redis was asked for a generation, by every server together.
const redisReads: () => number = (): number => {
  return (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { getString: MockFn };
    }
  ).default.getString.mock.calls.length;
};

/*
 * A server that has the key from before: read once, and again once its
 * first read ran out (FIRST_READ_TTL_MS), so what it keeps now is the read
 * that is kept for a minute.
 */
const warmUp: (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
) => Promise<number> = async (
  server: TelemetryIngestionKeyServiceClass,
  key: KeyFixture,
): Promise<number> => {
  expect((await lookUp(server, key.secret))?.isEnabled).toBe(true);
  clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
  expect((await lookUp(server, key.secret))?.isEnabled).toBe(true);
  const keptAt: number = clock;

  // Kept now: no more reads, for as long as nothing changes.
  const reads: number = readsOf(server);
  clock += 10 * 1000;
  expect((await lookUp(server, key.secret))?.isEnabled).toBe(true);
  expect(readsOf(server)).toBe(reads);

  return keptAt;
};

describe("the lookup by secret, on every server (issue #8370)", () => {
  test.each([
    {
      label: "switched off",
      change: async (
        server: TelemetryIngestionKeyServiceClass,
        key: KeyFixture,
      ): Promise<void> => {
        await updateThrough(server, key, { isEnabled: false });
      },
      stopped: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy !== null && policy.isEnabled === false;
      },
    },
    {
      label: "given a new secret",
      change: async (
        server: TelemetryIngestionKeyServiceClass,
        key: KeyFixture,
      ): Promise<void> => {
        await updateThrough(server, key, { secretKey: ObjectID.generate() });
      },
      stopped: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy === null;
      },
    },
    {
      label: "given an expiry in the past (as a hand-written row would be)",
      change: async (
        server: TelemetryIngestionKeyServiceClass,
        key: KeyFixture,
      ): Promise<void> => {
        const updateBy: Record<string, unknown> = {
          query: { _id: key.id },
          data: {},
          props: { isRoot: true },
        };
        rowOf(key)["expiresAt"] = new Date(clock - 1000);
        await internalsOf(server).onUpdateSuccess(
          { updateBy, carryForward: null },
          [key.id],
        );
      },
      stopped: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return (
          policy !== null &&
          policy.expiresAt !== null &&
          policy.expiresAt.getTime() < Date.now()
        );
      },
    },
    {
      label: "deleted",
      change: async (
        server: TelemetryIngestionKeyServiceClass,
        key: KeyFixture,
      ): Promise<void> => {
        await deleteThrough(server, key);
      },
      stopped: (policy: TelemetryIngestionKeyPolicy | null): boolean => {
        return policy === null;
      },
    },
  ])(
    "a key $label through one server is stopped on another within CacheGenerations.SHARED_READ_TTL_MS, not POSITIVE_TTL_MS",
    async (scenario: {
      label: string;
      change: (
        server: TelemetryIngestionKeyServiceClass,
        key: KeyFixture,
      ) => Promise<void>;
      stopped: (policy: TelemetryIngestionKeyPolicy | null) => boolean;
    }) => {
      const here: TelemetryIngestionKeyServiceClass = newServer();
      const there: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();

      const keptThereAt: number = await warmUp(there, key);

      clock += 100;
      await scenario.change(here, key);
      const changedAt: number = clock;

      // Where the change was made: at once.
      expect(scenario.stopped(await lookUp(here, key.secret))).toBe(true);

      // Everywhere else: within a second.
      clock = changedAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
      expect(scenario.stopped(await lookUp(there, key.secret))).toBe(true);

      // The generation did it, not the minute running out.
      expect(clock).toBeLessThan(keptThereAt + POSITIVE_TTL_MS);
    },
  );

  test("a key turned back on is accepted again on every other server within a second", async () => {
    const here: TelemetryIngestionKeyServiceClass = newServer();
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey({ isEnabled: false });

    expect((await lookUp(there, key.secret))?.isEnabled).toBe(false);
    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect((await lookUp(there, key.secret))?.isEnabled).toBe(false);

    clock += 100;
    await updateThrough(here, key, { isEnabled: true });

    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect((await lookUp(there, key.secret))?.isEnabled).toBe(true);
  });

  test("a key given a new secret is opened by the new secret on every server, and never by the old one again", async () => {
    const here: TelemetryIngestionKeyServiceClass = newServer();
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    await warmUp(there, key);

    const newSecret: string = ObjectID.generate().toString();
    await updateThrough(here, key, { secretKey: new ObjectID(newSecret) });

    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect(await lookUp(there, key.secret)).toBeNull();
    expect((await lookUp(there, newSecret))?.ingestionKeyId.toString()).toBe(
      key.id.toString(),
    );

    // The old secret stays refused: it is no key's now.
    for (let index: number = 0; index < 5; index++) {
      clock += NEGATIVE_TTL_MS;
      expect(await lookUp(there, key.secret)).toBeNull();
    }
  });

  test("an update to another key leaves this key's entry alone on every server", async () => {
    const here: TelemetryIngestionKeyServiceClass = newServer();
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    const other: KeyFixture = insertKey();
    await warmUp(there, key);
    const reads: number = readsOf(there);

    await updateThrough(here, other, { isEnabled: false });

    clock += 5 * CacheGenerations.SHARED_READ_TTL_MS;
    expect((await lookUp(there, key.secret))?.isEnabled).toBe(true);
    expect(readsOf(there)).toBe(reads);
  });

  test("while Redis is down, a change counts at once where it was made and within POSITIVE_TTL_MS everywhere else", async () => {
    const here: TelemetryIngestionKeyServiceClass = newServer();
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();

    redis.state.isDown = true;
    const keptThereAt: number = await warmUp(there, key);
    await warmUp(here, key);

    clock += 100;
    await updateThrough(here, key, { isEnabled: false });

    expect((await lookUp(here, key.secret))?.isEnabled).toBe(false);

    // Elsewhere, what was read before may still be served inside the minute...
    clock = keptThereAt + POSITIVE_TTL_MS;
    expect((await lookUp(there, key.secret))?.isEnabled).toBe(true);

    // ...and never after it.
    clock = keptThereAt + POSITIVE_TTL_MS + 1;
    expect((await lookUp(there, key.secret))?.isEnabled).toBe(false);
  });

  test("a change made while Redis was down reaches the other servers once Redis is back", async () => {
    const here: TelemetryIngestionKeyServiceClass = newServer();
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    const keptThereAt: number = await warmUp(there, key);

    redis.state.isDown = true;
    clock += 100;
    await updateThrough(here, key, { isEnabled: false });
    expect((await lookUp(here, key.secret))?.isEnabled).toBe(false);

    redis.state.isDown = false;

    // Here writes the change to Redis the first time Redis answers it about the key.
    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect((await lookUp(here, key.secret))?.isEnabled).toBe(false);

    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect((await lookUp(there, key.secret))?.isEnabled).toBe(false);
    expect(clock).toBeLessThan(keptThereAt + POSITIVE_TTL_MS);
  });

  test("a key deleted with its project, which the service never hears of, is refused within POSITIVE_TTL_MS", async () => {
    const there: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    const keptAt: number = await warmUp(there, key);

    table.delete(key.id.toString());

    clock = keptAt + POSITIVE_TTL_MS;
    expect(await lookUp(there, key.secret)).not.toBeNull();

    clock = keptAt + POSITIVE_TTL_MS + 1;
    expect(await lookUp(there, key.secret)).toBeNull();
  });

  describe("reads Postgres for a key, not for a request", () => {
    test("a thousand requests over a minute read the key twice - its first read, and once that ran out - and ask Redis about once a second", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();
      const startedAt: number = clock;
      const redisReadsBefore: number = redisReads();

      for (let index: number = 0; index < 1000; index++) {
        expect((await lookUp(server, key.secret))?.isEnabled).toBe(true);
        clock += 50;
      }

      // 50 seconds of traffic, inside the minute the second read is kept for.
      expect(clock - startedAt).toBeLessThan(
        POSITIVE_TTL_MS + CacheGenerations.SHARED_READ_TTL_MS,
      );
      expect(readsOf(server)).toBe(2);

      // At most one generation read a second, whatever the request rate.
      const seconds: number = Math.ceil(
        (clock - startedAt) / CacheGenerations.SHARED_READ_TTL_MS,
      );
      expect(redisReads() - redisReadsBefore).toBeLessThanOrEqual(seconds + 2);
    });

    test("requests in the same moment are served from one read", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();

      expect(await lookUp(server, key.secret)).not.toBeNull();
      const answers: Array<TelemetryIngestionKeyPolicy | null> =
        await Promise.all(
          Array.from({ length: 50 }, () => {
            return lookUp(server, key.secret);
          }),
        );

      for (const policy of answers) {
        expect(policy?.ingestionKeyId.toString()).toBe(key.id.toString());
      }
      expect(readsOf(server)).toBe(1);
    });

    test("while Redis is down, requests still do not read Postgres each", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();
      redis.state.isDown = true;

      for (let index: number = 0; index < 200; index++) {
        expect(await lookUp(server, key.secret)).not.toBeNull();
        clock += 100;
      }

      // 20 seconds: the first read, and the one after it ran out.
      expect(readsOf(server)).toBe(2);
    });

    test("Redis going down costs one more read of each key, not one per request", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();
      await warmUp(server, key);
      const reads: number = readsOf(server);

      redis.state.isDown = true;
      for (let index: number = 0; index < 100; index++) {
        expect(await lookUp(server, key.secret)).not.toBeNull();
        clock += 100;
      }

      expect(readsOf(server) - reads).toBeLessThanOrEqual(2);
    });

    test("a token no key has is not read again for NEGATIVE_TTL_MS, and asks Redis nothing", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const unknown: string = ObjectID.generate().toString();
      const redisReadsBefore: number = redisReads();

      for (let index: number = 0; index < 20; index++) {
        expect(await lookUp(server, unknown)).toBeNull();
        clock += (NEGATIVE_TTL_MS - 1) / 20;
      }

      expect(readsOf(server)).toBe(1);
      expect(redisReads()).toBe(redisReadsBefore);

      clock += 1000;
      expect(await lookUp(server, unknown)).toBeNull();
      expect(readsOf(server)).toBe(2);
    });

    test("a token that is not a uuid reads nothing and asks Redis nothing", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const redisReadsBefore: number = redisReads();

      expect(await lookUp(server, "not-a-key")).toBeNull();
      expect(await lookUp(server, "not-a-key")).toBeNull();

      expect(readsOf(server)).toBe(0);
      expect(redisReads()).toBe(redisReadsBefore);
    });
  });

  describe("a change that lands while the key is being read", () => {
    /*
     * Lets the test change the key in the middle of the next read: after
     * the row was read as it was, before the read returns.
     */
    const changeDuringNextRead: (
      server: TelemetryIngestionKeyServiceClass,
      change: () => Promise<void>,
    ) => void = (
      server: TelemetryIngestionKeyServiceClass,
      change: () => Promise<void>,
    ): void => {
      const findOneBy: MockFn = internalsOf(server).findOneBy;
      const read: (findOneBy: unknown) => Promise<unknown> =
        findOneBy.getMockImplementation() as (
          findOneBy: unknown,
        ) => Promise<unknown>;

      findOneBy.mockImplementationOnce(
        async (query: unknown): Promise<unknown> => {
          // The row as it was, copied before the change writes over it.
          const row: unknown = await read(query);
          const asItWas: unknown = row ? { ...(row as FakeRow) } : row;

          await change();

          return asItWas;
        },
      );
    };

    test("on the first read of a secret, is served for at most FIRST_READ_TTL_MS", async () => {
      const here: TelemetryIngestionKeyServiceClass = newServer();
      const there: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();

      changeDuringNextRead(there, async (): Promise<void> => {
        await updateThrough(here, key, { isEnabled: false });
      });

      // The read saw the key before the change.
      expect((await lookUp(there, key.secret))?.isEnabled).toBe(true);
      const readAt: number = clock;

      clock = readAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
      expect((await lookUp(there, key.secret))?.isEnabled).toBe(false);
    });

    test("on a later read, is not kept at all: the generation from before the read no longer holds", async () => {
      const here: TelemetryIngestionKeyServiceClass = newServer();
      const there: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();
      const keptAt: number = await warmUp(there, key);

      // The minute runs out, and the read that follows races a change.
      clock = keptAt + POSITIVE_TTL_MS + 1;
      changeDuringNextRead(there, async (): Promise<void> => {
        await updateThrough(here, key, { isEnabled: false });
      });
      expect((await lookUp(there, key.secret))?.isEnabled).toBe(true);
      const readAt: number = clock;

      clock = readAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
      expect((await lookUp(there, key.secret))?.isEnabled).toBe(false);
    });

    test("in the server that made it, is not served after the write", async () => {
      const server: TelemetryIngestionKeyServiceClass = newServer();
      const key: KeyFixture = insertKey();
      const keptAt: number = await warmUp(server, key);

      clock = keptAt + POSITIVE_TTL_MS + 1;
      changeDuringNextRead(server, async (): Promise<void> => {
        await updateThrough(server, key, { isEnabled: false });
      });
      expect((await lookUp(server, key.secret))?.isEnabled).toBe(true);

      // No time passes: the change counts here at once.
      expect((await lookUp(server, key.secret))?.isEnabled).toBe(false);
    });
  });

  test("keeps digests and key ids, never a secret", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    const unknown: string = ObjectID.generate().toString();

    await warmUp(server, key);
    await lookUp(server, unknown);

    const kept: string = JSON.stringify([
      Array.from(
        (
          internalsOf(server).policyCache as unknown as {
            store: Map<string, unknown>;
          }
        ).store.entries(),
      ),
      Array.from(
        (
          server as unknown as {
            keyIdBySecret: { store: Map<string, unknown> };
          }
        ).keyIdBySecret.store.entries(),
      ),
    ]).toLowerCase();

    expect(kept).not.toContain(key.secret.toLowerCase());
    expect(kept).not.toContain(unknown.toLowerCase());
    expect(kept).toContain(key.id.toString().toLowerCase());
  });

  test("the cached policy still carries billing and a blocked project on every hit", async () => {
    const server: TelemetryIngestionKeyServiceClass = newServer();
    const key: KeyFixture = insertKey();
    await warmUp(server, key);

    const projectService: { isProjectBlocked: MockFn } = (
      jest.requireMock("../../../Server/Services/ProjectService") as {
        default: { isProjectBlocked: MockFn };
      }
    ).default;
    projectService.isProjectBlocked.mockResolvedValueOnce(true);

    await expect(lookUp(server, key.secret)).rejects.toThrow();
    expect(await lookUp(server, key.secret)).not.toBeNull();
  });
});
