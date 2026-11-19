import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import AuditLogService from "../../../Server/Services/AuditLogService";
import MonitorSecretService, {
  TYPE_CHANGE_NEEDS_VALUE_MESSAGE,
} from "../../../Server/Services/MonitorSecretService";
import Encryption from "../../../Server/Utils/Encryption";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorSecretAccess from "../../../Types/Monitor/MonitorSecretAccess";
import MonitorSecretType from "../../../Types/Monitor/MonitorSecretType";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SECRET'S TYPE CHANGED WITH A NEW VALUE, THROUGH THE REAL UPDATE
 * PIPELINE (issue #9760), on a table in memory.
 *
 * Update Secret Value sends the type with the value. The type and the
 * value are written in one statement - no check ever reads the new type
 * with the old value - the value encrypted as on create, and the audit log
 * is handed the change of type and the value named as changed, which the
 * Enterprise recorder writes without either value
 * (ee AuditLogRecorderMonitorSecretType). A value replaced with the type
 * kept is named too: before, an update that changed only the value, which
 * nobody may read, left no entry at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SECRET_ID: string = "20000000-0000-4000-8000-000000000002";

const SEED: string = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const STORED_SEED: string = `otpauth://totp/OneUptime?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;

// What an update hands the audit log, as far as these read it.
interface RecordedUpdate {
  before: MonitorSecret;
  updatedFields: JSONObject;
  includeColumns?: Array<string> | undefined;
}

let recordUpdate: jest.Mock;
let table: InMemoryTable;

function recorded(): Array<RecordedUpdate> {
  return (recordUpdate.mock.calls as Array<Array<unknown>>).map(
    (call: Array<unknown>): RecordedUpdate => {
      return call[0] as RecordedUpdate;
    },
  );
}

async function storedValue(): Promise<string> {
  const stored: string = String(table.get(SECRET_ID)?.["secretValue"]);

  expect(Encryption.looksEncrypted(stored)).toBe(true);

  return await Encryption.decrypt(stored);
}

async function useSecret(
  secretType: MonitorSecretType,
  value: string,
): Promise<void> {
  table = useInMemoryTable(MonitorSecretService, [
    {
      _id: SECRET_ID,
      projectId: PROJECT_ID,
      name: "LoginCode",
      secretType: secretType,
      secretValue: await Encryption.encrypt(value),
      monitorAccess: MonitorSecretAccess.AllMonitors,
    },
  ]);
}

beforeEach(() => {
  recordUpdate = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never) as unknown as jest.Mock;
  jest
    .spyOn(MonitorSecretService, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Text secret becoming a one-time code secret", () => {
  beforeEach(async () => {
    await useSecret(MonitorSecretType.Text, "the old password");
  });

  test("writes the type and the canonical setup key in one statement, the key encrypted", async () => {
    await MonitorSecretService.updateOneById({
      id: new ObjectID(SECRET_ID),
      data: {
        secretType: MonitorSecretType.TOTP,
        secretValue: "gezd gnbv gy3t qojq gezd gnbv gy3t qojq",
      },
      props: { isRoot: true },
    });

    // One write sets both: never the new type with the old value.
    const writes: Array<StoredRow> = table.updates.map(
      (entry: { id: string; set: StoredRow }): StoredRow => {
        return entry.set;
      },
    );
    const typeWrites: Array<StoredRow> = writes.filter(
      (set: StoredRow): boolean => {
        return "secretType" in set;
      },
    );

    expect(typeWrites).toHaveLength(1);
    expect(typeWrites[0]!["secretValue"]).toBeDefined();
    expect(table.get(SECRET_ID)?.["secretType"]).toBe(MonitorSecretType.TOTP);
    expect(await storedValue()).toBe(STORED_SEED);
  });

  test("hands the audit log the change of type, and the value named as changed", async () => {
    await MonitorSecretService.updateOneById({
      id: new ObjectID(SECRET_ID),
      data: {
        secretType: MonitorSecretType.TOTP,
        secretValue: SEED,
      },
      props: { isRoot: true },
    });

    expect(recordUpdate).toHaveBeenCalledTimes(1);

    const update: RecordedUpdate = recorded()[0]!;

    expect(update.includeColumns).toEqual(["secretValue"]);
    expect(update.updatedFields["secretType"]).toBe(MonitorSecretType.TOTP);
    expect(update.before.secretType).toBe(MonitorSecretType.Text);
  });

  test("a type change with no value writes nothing and hands the audit log nothing", async () => {
    let refusal: unknown = null;

    try {
      await MonitorSecretService.updateOneById({
        id: new ObjectID(SECRET_ID),
        data: { secretType: MonitorSecretType.TOTP },
        props: { isRoot: true },
      });
    } catch (error: unknown) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(TYPE_CHANGE_NEEDS_VALUE_MESSAGE);
    expect(table.updates).toHaveLength(0);
    expect(table.get(SECRET_ID)?.["secretType"]).toBe(MonitorSecretType.Text);
    expect(await storedValue()).toBe("the old password");
    expect(recordUpdate).not.toHaveBeenCalled();
  });
});

describe("a one-time code secret becoming a Text secret", () => {
  beforeEach(async () => {
    await useSecret(MonitorSecretType.TOTP, STORED_SEED);
  });

  test("writes the type and the text as written, encrypted, and names the value for the audit log", async () => {
    await MonitorSecretService.updateOneById({
      id: new ObjectID(SECRET_ID),
      data: {
        secretType: MonitorSecretType.Text,
        secretValue: "a new password",
      },
      props: { isRoot: true },
    });

    expect(table.get(SECRET_ID)?.["secretType"]).toBe(MonitorSecretType.Text);
    expect(await storedValue()).toBe("a new password");
    expect(recorded()[0]!.includeColumns).toEqual(["secretValue"]);
    expect(recorded()[0]!.before.secretType).toBe(MonitorSecretType.TOTP);
  });

  test("never keeps the setup key it holds as the text: nothing is written", async () => {
    await expect(
      MonitorSecretService.updateOneById({
        id: new ObjectID(SECRET_ID),
        data: {
          secretType: MonitorSecretType.Text,
          secretValue: SEED,
        },
        props: { isRoot: true },
      }),
    ).rejects.toThrow("This is the setup key the secret holds now.");

    expect(table.updates).toHaveLength(0);
    expect(table.get(SECRET_ID)?.["secretType"]).toBe(MonitorSecretType.TOTP);
  });
});

describe("a value replaced with the type kept", () => {
  test("is named for the audit log: before, it left no entry at all", async () => {
    await useSecret(MonitorSecretType.Text, "the old password");

    await MonitorSecretService.updateOneById({
      id: new ObjectID(SECRET_ID),
      data: { secretValue: "rotated" },
      props: { isRoot: true },
    });

    expect(recordUpdate).toHaveBeenCalledTimes(1);
    expect(recorded()[0]!.includeColumns).toEqual(["secretValue"]);
    expect(await storedValue()).toBe("rotated");
  });
});
