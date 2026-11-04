import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CloudStreamAuthenticator from "../../../Server/Utils/CloudConnection/CloudStreamAuthentication";
import CloudStreamKeys from "../../../Server/Utils/CloudConnection/CloudStreamKeys";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_KEY_WRITE_ATTEMPTS,
  CLOUD_STREAM_MAX_PREVIOUS_KEYS,
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CloudStreamKeyHashes,
  getLiveCloudStreamKeyHashes,
  readCloudStreamKeyHashes,
} from "../../../Types/CloudConnection/CloudStream";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * TWO ADMINS MAKING A STREAM KEY AT THE SAME MOMENT BOTH KEEP THEIRS
 * (CloudConnectionService.createStreamKey).
 *
 * A key is the hashes read, rotated and written back. Written blindly, two
 * creations that read the same hashes each write a rotation of them, and
 * the one written last wipes the other's key out: its admin runs the
 * command with a key that is refused as wrong. So the write is a
 * compare-and-set over the hashes as read - one statement, the way
 * DatabaseService.compareAndSetColumnsByIdWithoutHooks writes it - and a
 * write that finds them changed reads them again and rotates the newer
 * ones. The row here is held in memory and answers that statement as
 * Postgres does: written only when the stored hashes equal the expected
 * ones (jsonb compares by value, its keys in any order).
 *
 * Every creation is held at its read until all of them have read, so they
 * truly race. Pinned: both keys work afterwards, the key made first is the
 * replaced one that keeps working a day more, the limit of three replaced
 * keys holds however many race, a write that never lands is refused after
 * CLOUD_STREAM_KEY_WRITE_ATTEMPTS tries and leaves nothing half written,
 * Stop streaming between a read and its write leaves the new key alone,
 * and no write is ever blind. `jest` is the global one.
 */

const CONNECTION: ObjectID = new ObjectID(
  "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f",
);
const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

// A value as jsonb compares it: objects by their keys in any order.
function canonical(value: JSONValue | undefined): string {
  if (value === undefined || value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${canonical((value as JSONObject)[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

interface StoredRow {
  provider: string;
  streamKeyHashes: JSONObject | null;
  streamKeyCreatedAt: Date | null;
}

let row: StoredRow;
let reads: number;
let writeAttempts: Array<{ expected: string; landed: boolean }>;
// Holds every read until `readers` creations have read: they race.
let gate: { readers: number; waiting: Array<() => void> } | null;

function holdReads(readers: number): void {
  gate = { readers, waiting: [] };
}

beforeEach(() => {
  row = {
    provider: CloudProvider.AWS,
    streamKeyHashes: null,
    streamKeyCreatedAt: null,
  };
  reads = 0;
  writeAttempts = [];
  gate = null;

  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async () => {
      reads++;
      // What Postgres hands back: a copy of the row as it is now.
      const connection: CloudConnection = new CloudConnection();
      connection.id = CONNECTION;
      connection.provider = row.provider;
      connection.streamKeyHashes = row.streamKeyHashes
        ? (JSON.parse(JSON.stringify(row.streamKeyHashes)) as JSONObject)
        : (null as unknown as JSONObject);

      if (gate) {
        const held: { readers: number; waiting: Array<() => void> } = gate;

        await new Promise<void>((resolve: () => void) => {
          held.waiting.push(resolve);

          if (held.waiting.length >= held.readers) {
            gate = null;
            held.waiting.forEach((release: () => void) => {
              release();
            });
          }
        });
      }

      return connection;
    }) as never);

  jest
    .spyOn(CloudConnectionService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      const expected: string = canonical(
        data.expectedData["streamKeyHashes"] as JSONValue,
      );
      const landed: boolean =
        data.id.toString() === CONNECTION.toString() &&
        canonical(row.streamKeyHashes) === expected;

      writeAttempts.push({ expected, landed });

      if (landed) {
        row.streamKeyHashes = JSON.parse(
          JSON.stringify(data.data["streamKeyHashes"]),
        ) as JSONObject;
        row.streamKeyCreatedAt = data.data["streamKeyCreatedAt"] as Date;
      }

      return landed;
    }) as never);

  jest
    .spyOn(CloudConnectionService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      // Stop streaming's write: every key of the connection, gone.
      row.streamKeyHashes = (data.data["streamKeyHashes"] ??
        null) as JSONObject | null;
      row.streamKeyCreatedAt = (data.data["streamKeyCreatedAt"] ??
        null) as Date | null;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type MadeKey = {
  streamKey: string;
  createdAt: Date;
  previousKeyWorksUntil: Date | null;
};

async function makeKey(now: Date = NOW): Promise<MadeKey> {
  return await CloudConnectionService.createStreamKey({
    connectionId: CONNECTION,
    now,
  });
}

function storedHashes(): CloudStreamKeyHashes {
  return readCloudStreamKeyHashes(row.streamKeyHashes);
}

// Whether a key would be taken from a delivery now: its hash among the live ones.
function works(key: string, at: Date = NOW): boolean {
  return CloudStreamKeys.matchesAny(
    key,
    getLiveCloudStreamKeyHashes({ hashes: storedHashes(), now: at }),
  );
}

describe("two admins making a key at the same moment", () => {
  test("both keep theirs: the two read the same hashes, and both keys work afterwards", async () => {
    holdReads(2);

    const [first, second] = await Promise.all([makeKey(), makeKey()]);

    expect(first.streamKey).not.toBe(second.streamKey);
    expect(works(first.streamKey)).toBe(true);
    expect(works(second.streamKey)).toBe(true);

    // One of the two writes found the hashes changed, and wrote again over the newer ones.
    expect(
      writeAttempts.map((attempt: { landed: boolean }) => {
        return attempt.landed;
      }),
    ).toEqual([true, false, true]);
    expect(reads).toBe(3);
  });

  test("the key written first is the replaced one, working a day more; the other is current", async () => {
    holdReads(2);

    const made: Array<MadeKey> = await Promise.all([makeKey(), makeKey()]);
    const hashes: CloudStreamKeyHashes = storedHashes();
    const current: MadeKey = made.find((key: MadeKey): boolean => {
      return CloudStreamKeys.hash(key.streamKey) === hashes.current?.hash;
    })!;
    const replaced: MadeKey = made.find((key: MadeKey): boolean => {
      return key !== current;
    })!;

    expect(current).toBeDefined();
    expect(hashes.previous).toHaveLength(1);
    expect(hashes.previous![0]!.hash).toBe(
      CloudStreamKeys.hash(replaced.streamKey),
    );
    expect(Date.parse(hashes.previous![0]!.expiresAt) - NOW.getTime()).toBe(
      CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
    );
    // Each admin is told what is true of their own key's write.
    expect(replaced.previousKeyWorksUntil).toBeNull();
    expect(current.previousKeyWorksUntil?.toISOString()).toBe(
      hashes.previous![0]!.expiresAt,
    );
    // The replaced key works until its day is up, and not a moment after.
    const dayLater: number = NOW.getTime() + CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS;
    expect(works(replaced.streamKey, new Date(dayLater - 1))).toBe(true);
    expect(works(replaced.streamKey, new Date(dayLater))).toBe(false);
    expect(works(current.streamKey, new Date(dayLater + 1))).toBe(true);
  });

  test("the key the streams already deliver with keeps working beside both new ones", async () => {
    const streaming: MadeKey = await makeKey(new Date(NOW.getTime() - 60_000));

    holdReads(2);
    const [first, second] = await Promise.all([makeKey(), makeKey()]);

    for (const key of [streaming, first, second]) {
      expect(works(key.streamKey)).toBe(true);
    }

    expect(storedHashes().previous).toHaveLength(2);
  });

  test("three at once over a streaming key: all four work, as the limit of three replaced keys allows", async () => {
    const streaming: MadeKey = await makeKey(new Date(NOW.getTime() - 60_000));

    holdReads(3);
    const made: Array<MadeKey> = await Promise.all([
      makeKey(),
      makeKey(),
      makeKey(),
    ]);

    for (const key of [streaming, ...made]) {
      expect(works(key.streamKey)).toBe(true);
    }

    expect(storedHashes().previous).toHaveLength(
      CLOUD_STREAM_MAX_PREVIOUS_KEYS,
    );
  });

  test("five at once: the last written is current, the three before it work a day, and never more than three", async () => {
    holdReads(5);
    const made: Array<MadeKey> = await Promise.all(
      [0, 1, 2, 3, 4].map(() => {
        return makeKey();
      }),
    );
    const hashes: CloudStreamKeyHashes = storedHashes();
    const working: Array<MadeKey> = made.filter((key: MadeKey): boolean => {
      return works(key.streamKey);
    });

    expect(hashes.current).toBeDefined();
    expect(hashes.previous).toHaveLength(CLOUD_STREAM_MAX_PREVIOUS_KEYS);
    // As five made one after another: the newest four work, the oldest stopped.
    expect(working).toHaveLength(1 + CLOUD_STREAM_MAX_PREVIOUS_KEYS);
    // Every write landed in the end, each over the hashes it read last.
    expect(
      writeAttempts.filter((attempt: { landed: boolean }) => {
        return attempt.landed;
      }),
    ).toHaveLength(5);
  });
});

describe("the write", () => {
  test("is a compare-and-set over the hashes as read, never a blind write", async () => {
    const streaming: MadeKey = await makeKey(new Date(NOW.getTime() - 60_000));
    const before: string = canonical(row.streamKeyHashes);
    const compareAndSet: jest.SpyInstance = jest.spyOn(
      CloudConnectionService,
      "compareAndSetColumnsByIdWithoutHooks",
    );
    compareAndSet.mockClear();

    await makeKey();

    expect(compareAndSet).toHaveBeenCalledTimes(1);
    const call: { expectedData: JSONObject; data: JSONObject } = compareAndSet
      .mock.calls[0]![0] as { expectedData: JSONObject; data: JSONObject };
    expect(canonical(call.expectedData["streamKeyHashes"] as JSONValue)).toBe(
      before,
    );
    expect(call.data["streamKeyCreatedAt"]).toEqual(NOW);
    expect(works(streaming.streamKey)).toBe(true);
    // Stop streaming's write is the only one made without a check.
    expect(
      CloudConnectionService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("a connection that never streamed is written over its empty hashes", async () => {
    const made: MadeKey = await makeKey();

    expect(writeAttempts).toEqual([{ expected: "null", landed: true }]);
    expect(storedHashes().current?.hash).toBe(
      CloudStreamKeys.hash(made.streamKey),
    );
    expect(storedHashes().previous).toBeUndefined();
    expect(made.previousKeyWorksUntil).toBeNull();
    expect(row.streamKeyCreatedAt).toEqual(NOW);
  });

  test("this process takes the new key at once, once it is written", async () => {
    const forget: jest.SpyInstance = jest.spyOn(
      CloudStreamAuthenticator,
      "forget",
    );

    holdReads(2);
    await Promise.all([makeKey(), makeKey()]);

    expect(forget).toHaveBeenCalledTimes(2);
    expect(forget).toHaveBeenCalledWith(CONNECTION);
  });

  test(`a write that never lands is refused after ${CLOUD_STREAM_KEY_WRITE_ATTEMPTS} tries, and nothing is written`, async () => {
    const forget: jest.SpyInstance = jest.spyOn(
      CloudStreamAuthenticator,
      "forget",
    );
    // Another key is written between every read and its write.
    jest
      .spyOn(CloudConnectionService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation((async () => {
        writeAttempts.push({ expected: "", landed: false });
        return false;
      }) as never);

    await expect(makeKey()).rejects.toThrow(BadDataException);
    await expect(makeKey()).rejects.toThrow(
      "Other stream keys were being made for this connection at the same moment. Make the key again.",
    );

    expect(writeAttempts).toHaveLength(2 * CLOUD_STREAM_KEY_WRITE_ATTEMPTS);
    expect(row.streamKeyHashes).toBeNull();
    expect(forget).not.toHaveBeenCalled();
  });

  test("Stop streaming between a key's read and its write: the new key is written alone over the stopped connection", async () => {
    const streaming: MadeKey = await makeKey(new Date(NOW.getTime() - 60_000));
    let isStopped: boolean = false;

    // The first try reads, then an admin stops streaming before it writes.
    const realCompareAndSet: jest.SpyInstance = jest.spyOn(
      CloudConnectionService,
      "compareAndSetColumnsByIdWithoutHooks",
    );
    const answerAsPostgres: (data: unknown) => Promise<boolean> =
      realCompareAndSet.getMockImplementation() as (
        data: unknown,
      ) => Promise<boolean>;
    realCompareAndSet.mockImplementation((async (data: unknown) => {
      if (!isStopped) {
        isStopped = true;
        await CloudConnectionService.stopStreaming(CONNECTION);
      }

      return await answerAsPostgres(data);
    }) as never);

    const made: MadeKey = await makeKey();

    expect(works(made.streamKey)).toBe(true);
    // The key Stop streaming revoked stays revoked: nothing replaced it.
    expect(works(streaming.streamKey)).toBe(false);
    expect(storedHashes().previous).toBeUndefined();
    expect(made.previousKeyWorksUntil).toBeNull();
  });

  test("a connection removed, or not an AWS one, between two tries is refused", async () => {
    let tries: number = 0;
    jest
      .spyOn(CloudConnectionService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation((async () => {
        tries++;
        row.provider = CloudProvider.Azure;
        return false;
      }) as never);

    await expect(makeKey()).rejects.toThrow(
      "Only AWS connections stream metrics and logs through Amazon Data Firehose.",
    );
    expect(tries).toBe(1);

    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockResolvedValue(null as never);
    await expect(makeKey()).rejects.toThrow("The connection no longer exists.");
  });
});
