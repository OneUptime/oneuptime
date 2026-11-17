import DatabaseService from "../../../Server/Services/DatabaseService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import PresentedKey from "../../../Server/Utils/PresentedKey/PresentedKey";
import PresentedKeysAtRest from "../../../Server/Utils/PresentedKey/PresentedKeysAtRest";
import Probe from "../../../Models/DatabaseModels/Probe";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import type { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A KEY PRESENTED TO ONEUPTIME, THROUGH DATABASESERVICE (#9012).
 *
 * The keys and tokens presented to OneUptime are kept encrypted
 * (TableColumnMetadata.presentedKey) - or, a SCIM bearer token, as its hash -
 * so a backup or a database dump holds none, and a request's key is found
 * by its lookup hash where it names its record by the key alone. Through
 * the real create, update, hook-free and read paths, with the table in
 * memory:
 *
 *   - a create stores the key encrypted, its lookup hash beside it, and
 *     answers the key as written - never its ciphertext - without changing
 *     the ObjectID handed in;
 *   - a key is held to its type's length as written, not as stored;
 *   - an update writes the key encrypted and its hash, after the caller was
 *     asked; clearing the key clears its hash;
 *   - a SCIM bearer token is stored as its hash, however it is written, and
 *     the create's answer holds it once;
 *   - a hook-free write stores a key as every write does, and can expect a
 *     key only to be unset; a hook-free write's clamp never clips one;
 *   - a read decrypts a key kept in an id-typed column back into its
 *     ObjectID;
 *   - findOneByPresentedKey finds a record by its key's hash and holds it
 *     to the key, finds a key stored as written only while one may be
 *     stored so, and checks a key without a hash on the one record named.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "90120000-0000-4000-8000-000000000001",
);
const KEY_ROW_ID: string = "90120000-0000-4000-8000-000000000002";
const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const NEW_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

function keyHashOf(key: string): string {
  return PresentedKey.hash(key, TableColumnType.ObjectID)!;
}

// A service with no hooks of its own: what DatabaseService itself does.
function plainService<T extends Probe | TelemetryIngestionKey>(modelType: {
  new (): T;
}): DatabaseService<T> {
  return new DatabaseService<T>(modelType);
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
  PresentedKeysAtRest.forget();
});

afterEach(() => {
  jest.restoreAllMocks();
  PresentedKeysAtRest.forget();
});

describe("a presented key, created", () => {
  test("is stored encrypted, with its lookup hash beside it", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = useInMemoryTable(service, []);

    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.projectId = PROJECT_ID;
    key.name = "Collector";
    key.secretKey = new ObjectID(KEY);

    await service.create({ data: key, props: { isRoot: true } });

    const stored: StoredRow = table.inserts[0]!;

    expect(typeof stored["secretKey"]).toBe("string");
    expect(Encryption.looksEncrypted(stored["secretKey"] as string)).toBe(true);
    expect(await Encryption.decrypt(stored["secretKey"] as string)).toBe(KEY);
    expect(String(stored["secretKeyHash"])).toBe(keyHashOf(KEY));
    expect(JSON.stringify(stored)).not.toContain(KEY);
  });

  test("is answered as written, never as stored, and the ObjectID handed in is not changed", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    useInMemoryTable(service, []);

    const handedIn: ObjectID = new ObjectID(KEY);
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.projectId = PROJECT_ID;
    key.name = "Collector";
    key.secretKey = handedIn;

    const created: TelemetryIngestionKey = await service.create({
      data: key,
      props: { isRoot: true },
    });

    expect(created.secretKey?.toString()).toBe(KEY);
    expect(handedIn.toString()).toBe(KEY);
  });

  test("a key with no lookup hash - a probe's - is stored encrypted alone", async () => {
    const service: DatabaseService<Probe> = plainService(Probe);
    const table: InMemoryTable = useInMemoryTable(service, []);

    const probe: Probe = new Probe();
    probe.projectId = PROJECT_ID;
    probe.name = "Edge";
    probe.key = "a-probe-key";

    const created: Probe = await service.create({
      data: probe,
      props: { isRoot: true },
    });

    expect(await Encryption.decrypt(table.inserts[0]!["key"] as string)).toBe(
      "a-probe-key",
    );
    expect(created.key).toBe("a-probe-key");
  });

  test("is held to its type's length as written: a probe's key of 100 characters, not one more", async () => {
    const service: DatabaseService<Probe> = plainService(Probe);
    const table: InMemoryTable = useInMemoryTable(service, []);

    const fits: Probe = new Probe();
    fits.projectId = PROJECT_ID;
    fits.name = "Edge";
    fits.key = "k".repeat(100);

    await service.create({ data: fits, props: { isRoot: true } });

    expect((table.inserts[0]!["key"] as string).length).toBeGreaterThan(100);

    const tooLong: Probe = new Probe();
    tooLong.projectId = PROJECT_ID;
    tooLong.name = "Edge 2";
    tooLong.key = "k".repeat(101);

    await expect(
      service.create({ data: tooLong, props: { isRoot: true } }),
    ).rejects.toThrow("key length cannot be more than 100 characters");
  });
});

describe("a presented key, updated", () => {
  function tableWithKey(
    service: DatabaseService<TelemetryIngestionKey>,
  ): InMemoryTable {
    return useInMemoryTable(service, [
      {
        _id: KEY_ROW_ID,
        projectId: PROJECT_ID.toString(),
        name: "Collector",
        secretKey: KEY,
        secretKeyHash: keyHashOf(KEY),
        version: 1,
      },
    ]);
  }

  test("is written encrypted, with its new lookup hash", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = tableWithKey(service);

    await service.updateOneById({
      id: new ObjectID(KEY_ROW_ID),
      data: { secretKey: new ObjectID(NEW_KEY) },
      props: { isRoot: true },
    });

    const set: StoredRow = table.updates[0]!.set;

    expect(await Encryption.decrypt(set["secretKey"] as string)).toBe(NEW_KEY);
    expect(String(set["secretKeyHash"])).toBe(keyHashOf(NEW_KEY));
    expect(JSON.stringify(set)).not.toContain(NEW_KEY);
  });

  test("cleared, clears its lookup hash too", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = tableWithKey(service);

    await service.updateOneById({
      id: new ObjectID(KEY_ROW_ID),
      data: { secretKey: null } as never,
      props: { isRoot: true },
    });

    const set: StoredRow = table.updates[0]!.set;

    expect(set["secretKey"]).toBeNull();
    expect(set["secretKeyHash"]).toBeNull();
  });

  test("an update that leaves the key alone writes no hash", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = tableWithKey(service);

    await service.updateOneById({
      id: new ObjectID(KEY_ROW_ID),
      data: { name: "Collector 2" },
      props: { isRoot: true },
    });

    expect(Object.keys(table.updates[0]!.set)).not.toContain("secretKeyHash");
  });
});

describe("a SCIM bearer token, kept only as its hash", () => {
  test("a create stores the token's hash, and answers the token once", async () => {
    const service: DatabaseService<ProjectSCIM> =
      new DatabaseService<ProjectSCIM>(ProjectSCIM);
    const table: InMemoryTable = useInMemoryTable(service, []);

    const connection: ProjectSCIM = new ProjectSCIM();
    connection.projectId = PROJECT_ID;
    connection.name = "Okta";
    connection.bearerToken = new HashedString("t".repeat(64));

    const created: ProjectSCIM = await service.create({
      data: connection,
      props: { isRoot: true },
    });

    expect(table.inserts[0]!["bearerToken"]).toBe(
      PresentedKey.toStoredHash("t".repeat(64)),
    );
    expect(created.bearerToken?.toString()).toBe("t".repeat(64));
  });

  test("an update stores the hash of a token written as text", async () => {
    const service: DatabaseService<ProjectSCIM> =
      new DatabaseService<ProjectSCIM>(ProjectSCIM);
    const table: InMemoryTable = useInMemoryTable(service, [
      {
        _id: KEY_ROW_ID,
        projectId: PROJECT_ID.toString(),
        name: "Okta",
        bearerToken: PresentedKey.toStoredHash("t".repeat(64)),
        version: 1,
      },
    ]);

    await service.updateOneById({
      id: new ObjectID(KEY_ROW_ID),
      data: { bearerToken: "u".repeat(64) } as never,
      props: { isRoot: true },
    });

    expect(table.updates[0]!.set["bearerToken"]).toBe(
      PresentedKey.toStoredHash("u".repeat(64)),
    );
  });
});

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

// The repository a hook-free write talks to, capturing what it sends.
function rawRepository(
  service: DatabaseService<Workflow>,
  captured: Array<CapturedQuery>,
): void {
  const columns: Array<string> = [
    "_id",
    "updatedAt",
    "name",
    "webhookSecretKey",
    "webhookSecretKeyHash",
    "incomingEmailSecretKey",
    "incomingEmailSecretKeyHash",
  ];

  getJestSpyOn(service, "getRepository").mockReturnValue({
    metadata: {
      tableName: "Workflow",
      findColumnWithPropertyName: (
        propertyName: string,
      ): { databaseName: string } | undefined => {
        return columns.includes(propertyName)
          ? { databaseName: propertyName }
          : undefined;
      },
      updateDateColumn: { databaseName: "updatedAt" },
      primaryColumns: [{ databaseName: "_id" }],
    },
    manager: {
      connection: {
        driver: {
          preparePersistentValue: (value: unknown): unknown => {
            return value instanceof HashedString || value instanceof ObjectID
              ? value.toString()
              : value;
          },
        },
      },
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        captured.push({ sql: sql, params: params });
        return [{ _id: KEY_ROW_ID }];
      },
    },
  } as never);
}

describe("a presented key, written without hooks", () => {
  test("is stored encrypted, with its lookup hash, never as written", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    const captured: Array<CapturedQuery> = [];
    rawRepository(service, captured);

    await service.updateColumnsByIdWithoutHooks({
      id: new ObjectID(KEY_ROW_ID),
      data: { webhookSecretKey: "a-webhook-key" },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sql).toContain(`"webhookSecretKey" = $`);
    expect(captured[0]!.sql).toContain(`"webhookSecretKeyHash" = $`);
    expect(JSON.stringify(captured[0]!.params)).not.toContain("a-webhook-key");

    const ciphertext: unknown = captured[0]!.params.find((param: unknown) => {
      return typeof param === "string" && Encryption.looksEncrypted(param);
    });

    expect(await Encryption.decrypt(ciphertext as string)).toBe(
      "a-webhook-key",
    );
    expect(captured[0]!.params).toContain(
      PresentedKey.hash("a-webhook-key", TableColumnType.LongText),
    );
  });

  test("may expect the key to be unset, and gives it one encrypted", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    const captured: Array<CapturedQuery> = [];
    rawRepository(service, captured);

    const isWritten: boolean =
      await service.compareAndSetColumnsByIdWithoutHooks({
        id: new ObjectID(KEY_ROW_ID),
        data: { incomingEmailSecretKey: new ObjectID(NEW_KEY) } as never,
        expectedData: { incomingEmailSecretKey: null } as never,
      });

    expect(isWritten).toBe(true);
    expect(captured[0]!.sql).toContain(
      `"incomingEmailSecretKey" IS NOT DISTINCT FROM $`,
    );
    expect(JSON.stringify(captured[0]!.params)).not.toContain(NEW_KEY);
    expect(captured[0]!.params).toContain(keyHashOf(NEW_KEY));
  });

  test("may not expect a key to be one value: a stored key is a ciphertext", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    const captured: Array<CapturedQuery> = [];
    rawRepository(service, captured);

    await expect(
      service.compareAndSetColumnsByIdWithoutHooks({
        id: new ObjectID(KEY_ROW_ID),
        data: { name: "Renamed" },
        expectedData: { webhookSecretKey: "a-webhook-key" },
      }),
    ).rejects.toThrow(BadDataException);
    expect(captured).toHaveLength(0);
  });

  test("the hook-free clamp never clips a ciphertext", () => {
    const service: DatabaseService<Probe> = plainService(Probe);
    const ciphertext: string = `${Encryption.CIPHERTEXT_PREFIX}${"x".repeat(200)}`;

    expect(
      service.truncateStringColumnsToMaxLength({ key: ciphertext })["key"],
    ).toBe(ciphertext);
    expect(
      service.truncateStringColumnsToMaxLength({ name: "n".repeat(200) })[
        "name"
      ],
    ).toHaveLength(100);
  });
});

// A service that hands its decrypt to the test.
class DecryptingService extends DatabaseService<TelemetryIngestionKey> {
  public constructor() {
    super(TelemetryIngestionKey);
  }

  public async decryptForTest(
    item: TelemetryIngestionKey,
  ): Promise<TelemetryIngestionKey> {
    return await this.decrypt(item);
  }
}

describe("a presented key, read", () => {
  test("kept in an id-typed column, decrypts back into its ObjectID", async () => {
    const item: TelemetryIngestionKey = new TelemetryIngestionKey();
    item.secretKey = new ObjectID(await Encryption.encrypt(KEY));

    const read: TelemetryIngestionKey =
      await new DecryptingService().decryptForTest(item);

    expect(read.secretKey).toBeInstanceOf(ObjectID);
    expect(read.secretKey!.toString()).toBe(KEY);
  });

  test("stored as written, before its column was encrypted, reads as itself", async () => {
    const item: TelemetryIngestionKey = new TelemetryIngestionKey();
    item.secretKey = new ObjectID(KEY);

    const read: TelemetryIngestionKey =
      await new DecryptingService().decryptForTest(item);

    expect(read.secretKey!.toString()).toBe(KEY);
  });
});

describe("findOneByPresentedKey", () => {
  function stubKeysAsWritten(
    service: DatabaseService<TelemetryIngestionKey> | DatabaseService<Probe>,
    mayHold: boolean,
  ): void {
    getJestSpyOn(service, "mayHoldPresentedKeysAsWritten").mockResolvedValue(
      mayHold as never,
    );
  }

  test("finds the record by its key's hash, and holds it to the key itself", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    useInMemoryTable(service, [
      {
        _id: KEY_ROW_ID,
        projectId: PROJECT_ID.toString(),
        secretKey: await Encryption.encrypt(KEY),
        secretKeyHash: keyHashOf(KEY),
      },
    ]);
    stubKeysAsWritten(service, false);

    const found: TelemetryIngestionKey | null =
      await service.findOneByPresentedKey({
        column: "secretKey",
        presentedKey: KEY.toUpperCase(),
        select: { _id: true, projectId: true },
        props: { isRoot: true },
      });

    expect(found?._id?.toString()).toBe(KEY_ROW_ID);
    // The key is answered only when it is asked for.
    expect(found?.secretKey).toBeUndefined();
  });

  test("refuses a hash left behind a key that changed since: the key itself is the check", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    useInMemoryTable(service, [
      {
        _id: KEY_ROW_ID,
        projectId: PROJECT_ID.toString(),
        // A server of the release before reset the key, as written.
        secretKey: NEW_KEY,
        secretKeyHash: keyHashOf(KEY),
      },
    ]);
    stubKeysAsWritten(service, true);

    expect(
      await service.findOneByPresentedKey({
        column: "secretKey",
        presentedKey: KEY,
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).toBeNull();

    // The new key, stored as written with no hash of its own yet, is found as written.
    expect(
      (
        await service.findOneByPresentedKey({
          column: "secretKey",
          presentedKey: NEW_KEY,
          select: { _id: true },
          props: { isRoot: true },
        })
      )?._id?.toString(),
    ).toBe(KEY_ROW_ID);
  });

  test("finds a key stored as written only while one may be stored so", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = useInMemoryTable(service, [
      {
        _id: KEY_ROW_ID,
        projectId: PROJECT_ID.toString(),
        secretKey: KEY,
        secretKeyHash: null,
      },
    ]);

    stubKeysAsWritten(service, true);

    expect(
      (
        await service.findOneByPresentedKey({
          column: "secretKey",
          presentedKey: KEY,
          select: { _id: true },
          props: { isRoot: true },
        })
      )?._id?.toString(),
    ).toBe(KEY_ROW_ID);

    stubKeysAsWritten(service, false);
    table.repository.find.mockClear();

    expect(
      await service.findOneByPresentedKey({
        column: "secretKey",
        presentedKey: KEY,
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).toBeNull();

    // Once every key is protected, the key is in no query: one read, by its hash.
    expect(table.repository.find).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(table.repository.find.mock.calls)).not.toContain(KEY);
  });

  test("a value that is no uuid is never looked up as written in a uuid key's column", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = useInMemoryTable(service, []);
    stubKeysAsWritten(service, true);

    expect(
      await service.findOneByPresentedKey({
        column: "secretKey",
        presentedKey: "not-a-uuid",
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).toBeNull();
    expect(table.repository.find).toHaveBeenCalledTimes(1);
  });

  test("a key with no lookup hash is checked on the one record named, in constant time", async () => {
    const service: DatabaseService<Probe> = plainService(Probe);
    useInMemoryTable(service, [
      {
        _id: KEY_ROW_ID,
        projectId: PROJECT_ID.toString(),
        key: await Encryption.encrypt("a-probe-key"),
      },
    ]);
    const compared: SpyInstance<typeof PresentedKey.matches> = jest.spyOn(
      PresentedKey,
      "matches",
    );

    expect(
      (
        await service.findOneByPresentedKey({
          column: "key",
          presentedKey: "a-probe-key",
          query: { _id: KEY_ROW_ID },
          select: { _id: true },
          props: { isRoot: true },
        })
      )?._id?.toString(),
    ).toBe(KEY_ROW_ID);

    expect(
      await service.findOneByPresentedKey({
        column: "key",
        presentedKey: "A-PROBE-KEY",
        query: { _id: KEY_ROW_ID },
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).toBeNull();

    expect(compared).toHaveBeenCalledTimes(2);
  });

  test("a key with no lookup hash needs the record named: no query is no record", async () => {
    const service: DatabaseService<Probe> = plainService(Probe);
    useInMemoryTable(service, []);

    await expect(
      service.findOneByPresentedKey({
        column: "key",
        presentedKey: "a-probe-key",
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("only a presented key can be found this way", async () => {
    const service: DatabaseService<Probe> = plainService(Probe);
    useInMemoryTable(service, []);

    await expect(
      service.findOneByPresentedKey({
        column: "name",
        presentedKey: "Edge",
        query: { _id: KEY_ROW_ID },
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("no key finds nothing, and reads nothing", async () => {
    const service: DatabaseService<TelemetryIngestionKey> = plainService(
      TelemetryIngestionKey,
    );
    const table: InMemoryTable = useInMemoryTable(service, []);

    expect(
      await service.findOneByPresentedKey({
        column: "secretKey",
        presentedKey: "  ",
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).toBeNull();
    expect(table.repository.find).not.toHaveBeenCalled();
  });
});
