import Model from "../../../Models/DatabaseModels/IoTDeviceCredential";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import IoTDeviceCredentialService, {
  IOT_DEVICE_CREDENTIAL_GENERATION_NAMESPACE,
  IoTDeviceCredentialContext,
  Service as IoTDeviceCredentialServiceClass,
} from "../../../Server/Services/IoTDeviceCredentialService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import SecretDigest from "../../../Server/Utils/Telemetry/SecretDigest";
import TelemetryIngestionKeySecretDigest from "../../../Server/Utils/Telemetry/TelemetryIngestionKeySecretDigest";
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
 * A REVOKED DEVICE CREDENTIAL IS CUT OFF WITHIN SECONDS ON EVERY SERVER, AND
 * NO DEVICE SECRET IS KEPT IN MEMORY (issue #8371).
 *
 * The MQTT broker checks a device's credential again on every publish
 * (IoTDeviceCredentialService.getCredentialContext), through a per-process
 * cache kept for a minute so a publish never reads Postgres. An update or a
 * delete cleared that cache in the process that made it only: on every other
 * server a credential switched off or deleted kept publishing for up to a
 * minute. And the cache held each device's raw secret, so every credential
 * that connected in the last minute left its live password in the broker's
 * heap, for a heap snapshot or a core file to read.
 *
 * Now each entry is kept under the credential's generation (CacheGenerations),
 * which an update or a delete renews through Redis, and holds a digest of the
 * secret (SecretDigest), never the secret. This suite holds it to:
 *
 *   - a credential switched off or deleted through one server is refused on
 *     every other within CacheGenerations.SHARED_READ_TTL_MS, and at once
 *     where the change was made; one turned back on is accepted again as
 *     fast;
 *   - while Redis is down, or for a credential deleted with its fleet or
 *     project (no hooks), within POSITIVE_TTL_MS - a minute;
 *   - a change that lands while the credential is being read is never kept
 *     past the generation it started;
 *   - Postgres is read once per credential per minute, whatever the publish
 *     rate, and a malformed id is read nowhere;
 *   - nothing kept, nor anything returned, holds a device's secret.
 *
 * No Postgres and no Redis: each server's findOneBy reads a table of rows
 * held here, GlobalCache is a map that can be taken down, and the clock is
 * Date.now, moved by hand. Two instances of the real service class sharing
 * that table and that map are two servers.
 */

jest.mock("../../../Server/Services/IoTFleetService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
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

const POSITIVE_TTL_MS: number = 60 * 1000;
const NEGATIVE_TTL_MS: number = 10 * 1000;

const redis: { store: Map<string, string>; state: { isDown: boolean } } = (
  jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
    __redis: { store: Map<string, string>; state: { isDown: boolean } };
  }
).__redis;

const redisReads: () => number = (): number => {
  return (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { getString: MockFn };
    }
  ).default.getString.mock.calls.length;
};

interface ServiceInternals {
  findOneBy: MockFn;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<Model>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<Model>>;
  onBeforeDelete: (deleteBy: DeleteBy<Model>) => Promise<OnDelete<Model>>;
  onDeleteSuccess: (
    onDelete: OnDelete<Model>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<Model>>;
  contextCache: { store: Map<string, { value: unknown }> };
}

const internalsOf: (
  server: IoTDeviceCredentialServiceClass,
) => ServiceInternals = (
  server: IoTDeviceCredentialServiceClass,
): ServiceInternals => {
  return server as unknown as ServiceInternals;
};

// A credential row's columns, as Postgres holds them.
interface Row {
  id: string;
  projectId: ObjectID;
  iotFleetId: ObjectID;
  fleetName: string;
  externalId: string;
  secretKey: ObjectID;
  isEnabled: boolean;
}

// The database every server reads: one table of credentials, by id.
let table: Map<string, Row> = new Map();
let clock: number = 0;

// What findOneBy hands back for a row: a model, as the real accessor does.
const modelOf: (row: Row) => Model = (row: Row): Model => {
  const fleet: IoTFleet = new IoTFleet(row.iotFleetId);
  fleet.name = row.fleetName;

  return Object.assign(new Model(new ObjectID(row.id)), {
    projectId: row.projectId,
    iotFleetId: row.iotFleetId,
    externalId: row.externalId,
    secretKey: row.secretKey,
    isEnabled: row.isEnabled,
    iotFleet: fleet,
  }) as Model;
};

const readRow: (findOneBy: unknown) => Promise<Model | null> = async (
  findOneBy: unknown,
): Promise<Model | null> => {
  const id: string = String(
    (findOneBy as { query: { _id: ObjectID } }).query._id,
  ).toLowerCase();
  const row: Row | undefined = table.get(id);

  // A copy: a change made after the read does not reach what it returned.
  return row ? modelOf({ ...row }) : null;
};

// A server: the real service class over the shared table.
const newServer: () => IoTDeviceCredentialServiceClass =
  (): IoTDeviceCredentialServiceClass => {
    const server: IoTDeviceCredentialServiceClass =
      new IoTDeviceCredentialServiceClass();

    jest
      .spyOn(server, "findOneBy")
      .mockImplementation(readRow as unknown as typeof server.findOneBy);

    return server;
  };

interface CredentialFixture {
  id: string;
  secret: string;
  projectId: ObjectID;
}

const insertCredential: (columns?: Partial<Row>) => CredentialFixture = (
  columns: Partial<Row> = {},
): CredentialFixture => {
  const id: string = ObjectID.generate().toString().toLowerCase();
  const secret: string = ObjectID.generate().toString();
  const projectId: ObjectID = ObjectID.generate();

  table.set(id, {
    id,
    projectId,
    iotFleetId: ObjectID.generate(),
    fleetName: "roof-sensors",
    externalId: "sensor-01",
    secretKey: new ObjectID(secret),
    isEnabled: true,
    ...columns,
  });

  return { id, secret, projectId };
};

const rowOf: (credential: CredentialFixture) => Row = (
  credential: CredentialFixture,
): Row => {
  const row: Row | undefined = table.get(credential.id);
  expect(row).toBeDefined();
  return row!;
};

const contextOf: (
  server: IoTDeviceCredentialServiceClass,
  credential: CredentialFixture | string,
) => Promise<IoTDeviceCredentialContext | null> = (
  server: IoTDeviceCredentialServiceClass,
  credential: CredentialFixture | string,
): Promise<IoTDeviceCredentialContext | null> => {
  return server.getCredentialContext(
    typeof credential === "string" ? credential : credential.id,
  );
};

const readsOf: (server: IoTDeviceCredentialServiceClass) => number = (
  server: IoTDeviceCredentialServiceClass,
): number => {
  return internalsOf(server).findOneBy.mock.calls.length;
};

// An update through the service, as DatabaseService runs it.
const updateThrough: (
  server: IoTDeviceCredentialServiceClass,
  credential: CredentialFixture,
  data: Partial<Row>,
) => Promise<void> = async (
  server: IoTDeviceCredentialServiceClass,
  credential: CredentialFixture,
  data: Partial<Row>,
): Promise<void> => {
  const updateBy: UpdateBy<Model> = {
    query: { _id: credential.id },
    data: {},
    props: { isRoot: true },
  } as unknown as UpdateBy<Model>;

  await internalsOf(server).onBeforeUpdate(updateBy);
  Object.assign(rowOf(credential), data);
  await internalsOf(server).onUpdateSuccess(
    { updateBy, carryForward: null } as unknown as OnUpdate<Model>,
    [new ObjectID(credential.id)],
  );
};

const deleteThrough: (
  server: IoTDeviceCredentialServiceClass,
  credential: CredentialFixture,
) => Promise<void> = async (
  server: IoTDeviceCredentialServiceClass,
  credential: CredentialFixture,
): Promise<void> => {
  const deleteBy: DeleteBy<Model> = {
    query: { _id: credential.id },
    props: { isRoot: true },
  } as unknown as DeleteBy<Model>;

  await internalsOf(server).onBeforeDelete(deleteBy);
  table.delete(credential.id);
  await internalsOf(server).onDeleteSuccess(
    { deleteBy, carryForward: null } as unknown as OnDelete<Model>,
    [new ObjectID(credential.id)],
  );
};

/*
 * Lets the test change the credential in the middle of the next read: after
 * the row was read as it was, before the read returns.
 */
const changeDuringNextRead: (
  server: IoTDeviceCredentialServiceClass,
  change: () => Promise<void>,
) => void = (
  server: IoTDeviceCredentialServiceClass,
  change: () => Promise<void>,
): void => {
  internalsOf(server).findOneBy.mockImplementationOnce(
    async (findOneBy: unknown): Promise<unknown> => {
      const asItWas: Model | null = await readRow(findOneBy);
      await change();
      return asItWas;
    },
  );
};

beforeEach(() => {
  table = new Map();
  redis.store.clear();
  redis.state.isDown = false;
  clock = 1_800_000_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clock;
  });
  (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { getString: MockFn; setString: MockFn };
    }
  ).default.getString.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a credential's context", () => {
  test("is the credential's, for the broker to compare the presented secret's digest with", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    const context: IoTDeviceCredentialContext | null = await contextOf(
      server,
      credential,
    );

    expect(context).toEqual({
      credentialId: credential.id,
      projectId: credential.projectId.toString(),
      iotFleetId: rowOf(credential).iotFleetId.toString(),
      fleetName: "roof-sensors",
      externalId: "sensor-01",
      secretKeyDigest: SecretDigest.of(credential.secret),
    });
    expect(
      SecretDigest.matches(
        context!.secretKeyDigest,
        SecretDigest.of(credential.secret.toUpperCase()),
      ),
    ).toBe(true);
    expect(
      SecretDigest.matches(
        context!.secretKeyDigest,
        SecretDigest.of(ObjectID.generate().toString()),
      ),
    ).toBe(false);
  });

  test("holds no secret, in what it returns or in what it keeps", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credentials: Array<CredentialFixture> = [
      insertCredential(),
      insertCredential(),
      insertCredential({ isEnabled: false }),
    ];

    const returned: Array<IoTDeviceCredentialContext | null> = [];
    for (const credential of credentials) {
      returned.push(await contextOf(server, credential));
      returned.push(await contextOf(server, credential));
    }

    const everything: string = JSON.stringify([
      returned,
      Array.from(internalsOf(server).contextCache.store.entries()),
    ]).toLowerCase();

    for (const credential of credentials) {
      expect(everything).not.toContain(credential.secret.toLowerCase());
    }
    expect(everything).toContain(SecretDigest.of(credentials[0]!.secret));
    expect(everything).not.toContain('"secretkey"');
  });

  test("is a fresh object on every call: a caller that changes it changes nothing kept", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    const first: IoTDeviceCredentialContext = (await contextOf(
      server,
      credential,
    ))!;
    first.externalId = "someone-else";
    first.secretKeyDigest = SecretDigest.of(ObjectID.generate().toString());

    const second: IoTDeviceCredentialContext = (await contextOf(
      server,
      credential,
    ))!;

    expect(second.externalId).toBe("sensor-01");
    expect(second.secretKeyDigest).toBe(SecretDigest.of(credential.secret));
    expect(readsOf(server)).toBe(1);
  });

  test("is the same for an id in capitals, and is kept once for both", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    const lower: IoTDeviceCredentialContext | null = await contextOf(
      server,
      credential,
    );
    const upper: IoTDeviceCredentialContext | null = await contextOf(
      server,
      credential.id.toUpperCase(),
    );

    expect(upper).toEqual(lower);
    expect(readsOf(server)).toBe(1);
  });

  test("uses the same digest as an ingestion key's secret", () => {
    const secret: string = ObjectID.generate().toString();

    expect(SecretDigest.of(secret)).toBe(
      TelemetryIngestionKeySecretDigest.of(secret),
    );
    expect(SecretDigest.of(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(SecretDigest.of(` ${secret.toUpperCase()}\n`)).toBe(
      SecretDigest.of(secret),
    );
  });

  test.each([["switched off", { isEnabled: false }]])(
    "is null for a credential %s",
    async (_label: string, columns: Partial<Row>) => {
      const server: IoTDeviceCredentialServiceClass = newServer();
      const credential: CredentialFixture = insertCredential(columns);

      expect(await contextOf(server, credential)).toBeNull();
    },
  );

  test("is null for an id no credential has", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();

    expect(await contextOf(server, ObjectID.generate().toString())).toBeNull();
  });
});

describe("a change through one server, on every other", () => {
  test.each([
    {
      label: "switched off",
      change: async (
        server: IoTDeviceCredentialServiceClass,
        credential: CredentialFixture,
      ): Promise<void> => {
        await updateThrough(server, credential, { isEnabled: false });
      },
    },
    {
      label: "deleted",
      change: async (
        server: IoTDeviceCredentialServiceClass,
        credential: CredentialFixture,
      ): Promise<void> => {
        await deleteThrough(server, credential);
      },
    },
  ])(
    "a credential $label is refused at once where it was changed, and within CacheGenerations.SHARED_READ_TTL_MS on every other server - not POSITIVE_TTL_MS",
    async (scenario: {
      label: string;
      change: (
        server: IoTDeviceCredentialServiceClass,
        credential: CredentialFixture,
      ) => Promise<void>;
    }) => {
      const here: IoTDeviceCredentialServiceClass = newServer();
      const there: IoTDeviceCredentialServiceClass = newServer();
      const credential: CredentialFixture = insertCredential();

      // The broker on the other server has the credential, read just now.
      expect(await contextOf(there, credential)).not.toBeNull();
      const readThereAt: number = clock;

      clock += 100;
      await scenario.change(here, credential);
      const changedAt: number = clock;

      expect(await contextOf(here, credential)).toBeNull();

      clock = changedAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
      expect(await contextOf(there, credential)).toBeNull();

      // The generation did it, not the minute running out.
      expect(clock).toBeLessThan(readThereAt + POSITIVE_TTL_MS);
    },
  );

  test("a credential turned back on is accepted again on every other server within a second, though its refusal was kept", async () => {
    const here: IoTDeviceCredentialServiceClass = newServer();
    const there: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential({
      isEnabled: false,
    });

    expect(await contextOf(there, credential)).toBeNull();

    clock += 100;
    await updateThrough(here, credential, { isEnabled: true });

    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect(clock).toBeLessThan(1_800_000_000_000 + NEGATIVE_TTL_MS);
    expect(await contextOf(there, credential)).not.toBeNull();
  });

  test("a credential given another secret answers with the new secret's digest on every other server within a second", async () => {
    const here: IoTDeviceCredentialServiceClass = newServer();
    const there: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();
    expect((await contextOf(there, credential))?.secretKeyDigest).toBe(
      SecretDigest.of(credential.secret),
    );

    const newSecret: ObjectID = ObjectID.generate();
    clock += 100;
    await updateThrough(here, credential, { secretKey: newSecret });

    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect((await contextOf(there, credential))?.secretKeyDigest).toBe(
      SecretDigest.of(newSecret.toString()),
    );
  });

  test("a change to one credential leaves every other credential's entry alone", async () => {
    const here: IoTDeviceCredentialServiceClass = newServer();
    const there: IoTDeviceCredentialServiceClass = newServer();
    const changed: CredentialFixture = insertCredential();
    const untouched: CredentialFixture = insertCredential();

    await contextOf(there, changed);
    await contextOf(there, untouched);
    expect(readsOf(there)).toBe(2);

    await updateThrough(here, changed, { isEnabled: false });

    clock += 5 * CacheGenerations.SHARED_READ_TTL_MS;
    expect(await contextOf(there, untouched)).not.toBeNull();
    expect(readsOf(there)).toBe(2);
    expect(await contextOf(there, changed)).toBeNull();
    expect(readsOf(there)).toBe(3);

    expect(Array.from(redis.store.keys())).toEqual([
      `${IOT_DEVICE_CREDENTIAL_GENERATION_NAMESPACE}:${changed.id}`,
    ]);
  });

  test("an update or delete that wrote no row starts no generation", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();

    await internalsOf(server).onUpdateSuccess(
      {
        updateBy: { query: {}, data: {}, props: {} },
        carryForward: null,
      } as unknown as OnUpdate<Model>,
      [],
    );
    await internalsOf(server).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: {} },
        carryForward: null,
      } as unknown as OnDelete<Model>,
      [],
    );

    expect(redis.store.size).toBe(0);
  });
});

describe("what a generation cannot reach", () => {
  test("while Redis is down, a change counts at once where it was made, and within POSITIVE_TTL_MS everywhere else", async () => {
    const here: IoTDeviceCredentialServiceClass = newServer();
    const there: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    redis.state.isDown = true;

    expect(await contextOf(here, credential)).not.toBeNull();
    expect(await contextOf(there, credential)).not.toBeNull();
    const readThereAt: number = clock;

    clock += 100;
    await updateThrough(here, credential, { isEnabled: false });

    expect(await contextOf(here, credential)).toBeNull();

    // Elsewhere, the read from before may still be served inside the minute...
    clock = readThereAt + POSITIVE_TTL_MS;
    expect(await contextOf(there, credential)).not.toBeNull();

    // ...and never after it.
    clock = readThereAt + POSITIVE_TTL_MS + 1;
    expect(await contextOf(there, credential)).toBeNull();
  });

  test("a change made while Redis was down reaches the other servers once Redis is back", async () => {
    const here: IoTDeviceCredentialServiceClass = newServer();
    const there: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();
    expect(await contextOf(there, credential)).not.toBeNull();
    const readThereAt: number = clock;

    redis.state.isDown = true;
    clock += 100;
    await updateThrough(here, credential, { isEnabled: false });

    redis.state.isDown = false;

    // Where it was made, the change goes to Redis the next time Redis answers about it.
    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect(await contextOf(here, credential)).toBeNull();

    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect(await contextOf(there, credential)).toBeNull();
    expect(clock).toBeLessThan(readThereAt + POSITIVE_TTL_MS);
  });

  test("a credential deleted with its fleet or project, which the service never hears of, is refused within POSITIVE_TTL_MS", async () => {
    const there: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();
    expect(await contextOf(there, credential)).not.toBeNull();
    const readAt: number = clock;

    table.delete(credential.id);

    clock = readAt + POSITIVE_TTL_MS;
    expect(await contextOf(there, credential)).not.toBeNull();

    clock = readAt + POSITIVE_TTL_MS + 1;
    expect(await contextOf(there, credential)).toBeNull();
  });
});

describe("a change that lands while the credential is being read", () => {
  test("on another server, is not kept past the read: the generation from before it no longer holds within a second", async () => {
    const here: IoTDeviceCredentialServiceClass = newServer();
    const there: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    changeDuringNextRead(there, async (): Promise<void> => {
      await updateThrough(here, credential, { isEnabled: false });
    });

    // The read saw the credential before the change.
    expect(await contextOf(there, credential)).not.toBeNull();
    const readAt: number = clock;

    clock = readAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect(await contextOf(there, credential)).toBeNull();
  });

  test("in the server that made it, is not served after the write", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    changeDuringNextRead(server, async (): Promise<void> => {
      await updateThrough(server, credential, { isEnabled: false });
    });
    expect(await contextOf(server, credential)).not.toBeNull();

    // No time passes: the change counts here at once.
    expect(await contextOf(server, credential)).toBeNull();
  });
});

describe("reads Postgres for a credential, not for a publish", () => {
  test("a thousand publishes over a minute read the credential once, and ask Redis about once a second", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();
    const startedAt: number = clock;

    for (let index: number = 0; index < 1000; index++) {
      expect(await contextOf(server, credential)).not.toBeNull();
      clock += 50;
    }

    expect(clock - startedAt).toBeLessThanOrEqual(POSITIVE_TTL_MS);
    expect(readsOf(server)).toBe(1);

    const seconds: number = Math.ceil(
      (clock - startedAt) / CacheGenerations.SHARED_READ_TTL_MS,
    );
    expect(redisReads()).toBeLessThanOrEqual(seconds + 1);
  });

  test("past the minute, the credential is read again - once", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();

    await contextOf(server, credential);
    clock += POSITIVE_TTL_MS + 1;
    await contextOf(server, credential);
    await contextOf(server, credential);

    expect(readsOf(server)).toBe(2);
  });

  test("while Redis is down, publishes still do not read Postgres each", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();
    redis.state.isDown = true;

    for (let index: number = 0; index < 200; index++) {
      expect(await contextOf(server, credential)).not.toBeNull();
      clock += 100;
    }

    expect(readsOf(server)).toBe(1);
  });

  test("Redis going down costs one more read of each credential, not one per publish", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const credential: CredentialFixture = insertCredential();
    await contextOf(server, credential);

    redis.state.isDown = true;
    for (let index: number = 0; index < 100; index++) {
      expect(await contextOf(server, credential)).not.toBeNull();
      clock += 100;
    }

    expect(readsOf(server)).toBe(2);
  });

  test("a refused credential is not read again for NEGATIVE_TTL_MS", async () => {
    const server: IoTDeviceCredentialServiceClass = newServer();
    const unknown: string = ObjectID.generate().toString();

    for (let index: number = 0; index < 20; index++) {
      expect(await contextOf(server, unknown)).toBeNull();
      clock += Math.floor(NEGATIVE_TTL_MS / 20) - 1;
    }
    expect(readsOf(server)).toBe(1);

    clock += NEGATIVE_TTL_MS;
    expect(await contextOf(server, unknown)).toBeNull();
    expect(readsOf(server)).toBe(2);
  });

  test.each([
    "not-a-uuid",
    "",
    `${ObjectID.generate().toString()}|0.0`,
    "11111111-1111-4111-8111-11111111111",
  ])(
    "a malformed id (%p) reads nothing from Postgres or Redis, and keeps nothing",
    async (credentialId: string) => {
      const server: IoTDeviceCredentialServiceClass = newServer();

      expect(await contextOf(server, credentialId)).toBeNull();
      expect(await contextOf(server, credentialId)).toBeNull();

      expect(readsOf(server)).toBe(0);
      expect(redisReads()).toBe(0);
      expect(internalsOf(server).contextCache.store.size).toBe(0);
    },
  );
});

describe("the service everyone imports", () => {
  test("is an instance of the class this suite drives", () => {
    expect(IoTDeviceCredentialService).toBeInstanceOf(
      IoTDeviceCredentialServiceClass,
    );
  });
});
