import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Encryption from "../../../Server/Utils/Encryption";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WRITING BACK THE SECRET A RECORD HOLDS IS NOT A CHANGE OF IT.
 *
 * An encrypted column - a monitor secret's value, say - is encrypted on
 * every write with a salt of its own, so its ciphertext never matches what
 * the row holds, and the read before the write decrypts the row anyway. The
 * comparison that decides whether an update changed a row
 * (DatabaseService.getChangedColumns) set the fresh ciphertext against the
 * decrypted value, so an encrypted column always counted as changed: every
 * save of a form that sends the secret back started the record's on-update
 * workflows, sent a live update and wrote an audit entry. Now the column is
 * compared as the update gave it, before it was encrypted - and it is still
 * stored encrypted, and still reported to a workflow as stored.
 *
 * No Postgres: the repository and the before-row read are stubbed, and the
 * real update path runs in between, as DatabaseServiceSameValueWrites
 * drives it.
 */

jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordUpdate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordDelete: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

type StubbedRepository = {
  save: jest.Mock;
  update: jest.Mock;
  find: jest.Mock;
};

interface UpdateHarness {
  repository: StubbedRepository;
  workflow: jest.SpyInstance;
  realtime: jest.SpyInstance;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "5a3e0000-0000-4000-8000-0000000000e1",
);
const SECRET_ID: ObjectID = new ObjectID(
  "5a3e0000-0000-4000-8000-0000000000e2",
);

const HELD_SECRET: string = "sk_live_held_51HxYz";

// The secret as the read before the write returns it: decrypted.
function secretBefore(columns: Record<string, unknown>): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret._id = SECRET_ID.toString();
  secret.projectId = PROJECT_ID;

  for (const [column, value] of Object.entries(columns)) {
    (secret as unknown as Record<string, unknown>)[column] = value;
  }

  return secret;
}

async function updateSecret(
  before: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<UpdateHarness> {
  const service: DatabaseService<MonitorSecret> =
    new DatabaseService<MonitorSecret>(MonitorSecret);

  const repository: StubbedRepository = {
    save: jest.fn((item: unknown) => {
      return Promise.resolve(item);
    }),
    update: jest.fn(() => {
      return Promise.resolve({ affected: 1 });
    }),
    find: jest.fn(() => {
      return Promise.resolve([]);
    }),
  };

  jest.spyOn(service, "getRepository").mockReturnValue(repository as never);

  const workflow: jest.SpyInstance = jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  const realtime: jest.SpyInstance = jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);

  jest
    .spyOn(
      service as unknown as { _findBy: () => Promise<Array<BaseModel>> },
      "_findBy",
    )
    .mockResolvedValue([secretBefore(before)] as never);

  await service.updateOneById({
    id: SECRET_ID,
    data: data as never,
    props: { isRoot: true },
  });

  return { repository, workflow, realtime };
}

// The secret value the repository was asked to store.
function storedSecretValue(harness: UpdateHarness): unknown {
  expect(harness.repository.update).toHaveBeenCalledTimes(1);

  return (
    harness.repository.update.mock.calls[0]![1] as Record<string, unknown>
  )["secretValue"];
}

// The fields an On Update workflow was told the update changed.
function updatedFieldsOf(harness: UpdateHarness): JSONObject {
  expect(harness.workflow).toHaveBeenCalledTimes(1);

  return (
    harness.workflow.mock.calls[0]![3] as { updatedFields: JSONObject }
  ).updatedFields;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an encrypted column written back as the row holds it", () => {
  test("fires no workflow and sends no live update", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: HELD_SECRET },
      { secretValue: HELD_SECRET },
    );

    expect(harness.workflow).not.toHaveBeenCalled();
    expect(harness.realtime).not.toHaveBeenCalled();
  });

  test("is still written, and written encrypted", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: HELD_SECRET },
      { secretValue: HELD_SECRET },
    );

    const stored: unknown = storedSecretValue(harness);

    expect(typeof stored).toBe("string");
    expect(stored).not.toBe(HELD_SECRET);
    expect(await Encryption.decrypt(stored as string)).toBe(HELD_SECRET);
  });

  test("beside another column that changes, only that column is reported changed", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: HELD_SECRET, name: "Stripe key" },
      { secretValue: HELD_SECRET, name: "Stripe live key" },
    );

    const updatedFields: JSONObject = updatedFieldsOf(harness);

    expect(Object.keys(updatedFields)).toEqual(["name"]);
    expect(updatedFields["name"]).toBe("Stripe live key");
    expect(harness.realtime).toHaveBeenCalledTimes(1);
  });
});

describe("an encrypted column the update really changes", () => {
  test("is a change: the workflow fires and a live update is sent", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: HELD_SECRET },
      { secretValue: "sk_live_rotated_77Qa" },
    );

    expect(Object.keys(updatedFieldsOf(harness))).toEqual(["secretValue"]);
    expect(harness.realtime).toHaveBeenCalledTimes(1);
  });

  test("is told to the workflow as stored, never as the plain secret", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: HELD_SECRET },
      { secretValue: "sk_live_rotated_77Qa" },
    );

    const reported: unknown = updatedFieldsOf(harness)["secretValue"];

    expect(reported).not.toBe("sk_live_rotated_77Qa");
    expect(await Encryption.decrypt(reported as string)).toBe(
      "sk_live_rotated_77Qa",
    );
    expect(await Encryption.decrypt(storedSecretValue(harness) as string)).toBe(
      "sk_live_rotated_77Qa",
    );
  });

  test("set where the row held none is a change", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: null },
      { secretValue: "sk_live_first_88Zb" },
    );

    expect(Object.keys(updatedFieldsOf(harness))).toEqual(["secretValue"]);
  });

  test("cleared where the row held one is a change", async () => {
    const harness: UpdateHarness = await updateSecret(
      { secretValue: HELD_SECRET },
      { secretValue: null },
    );

    expect(Object.keys(updatedFieldsOf(harness))).toEqual(["secretValue"]);
    expect(storedSecretValue(harness)).toBeNull();
  });
});
