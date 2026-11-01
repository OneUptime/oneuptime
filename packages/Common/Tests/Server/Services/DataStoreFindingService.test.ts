import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import Queue from "../../../Server/Infrastructure/Queue";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { DATA_SECURITY_EVALUATE_PROJECT_JOB } from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A person's verdict on a finding (DataStoreFindingService): Not Sensitive
 * and Confirm both queue the project's evaluation, and a confirmed finding
 * counts as High confidence - set as OneUptime's own write once the
 * update is written, since a person cannot set a confidence.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

interface Hooks {
  onBeforeUpdate: (
    updateBy: UpdateBy<DataStoreFinding>,
  ) => Promise<OnUpdate<DataStoreFinding>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<DataStoreFinding>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<DataStoreFinding>>;
}

const hooks: Hooks = DataStoreFindingService as unknown as Hooks;

let rows: Array<DataStoreFinding>;
let holdSpy: jest.SpyInstance;
let writeSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;

function row(projectId: ObjectID): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
  finding.projectId = projectId;
  return finding;
}

function updateBy(
  data: JSONObject,
  isRoot: boolean = false,
): UpdateBy<DataStoreFinding> {
  return {
    query: { _id: rows[0]?.id?.toString() || "" },
    data: data as never,
    props: isRoot
      ? { isRoot: true }
      : { userId: ObjectID.generate(), tenantId: PROJECT_ID },
  } as unknown as UpdateBy<DataStoreFinding>;
}

async function update(
  data: JSONObject,
  isRoot: boolean = false,
): Promise<{ data: JSONObject }> {
  const by: UpdateBy<DataStoreFinding> = updateBy(data, isRoot);
  const before: OnUpdate<DataStoreFinding> = await hooks.onBeforeUpdate(by);
  await hooks.onUpdateSuccess(
    before,
    rows.map((finding: DataStoreFinding): ObjectID => {
      return finding.id!;
    }),
  );
  return { data: by.data as unknown as JSONObject };
}

function confidenceWrites(): Array<[string, unknown]> {
  return writeSpy.mock.calls.map((call: Array<unknown>): [string, unknown] => {
    const write: { id: ObjectID; data: JSONObject } = call[0] as {
      id: ObjectID;
      data: JSONObject;
    };
    return [write.id.toString(), write.data["confidence"]];
  });
}

function evaluationsQueued(): Array<unknown> {
  return queueSpy.mock.calls
    .filter((call: Array<unknown>) => {
      return call[2] === DATA_SECURITY_EVALUATE_PROJECT_JOB;
    })
    .map((call: Array<unknown>) => {
      return (call[3] as JSONObject)["projectId"];
    });
}

beforeEach(() => {
  rows = [row(PROJECT_ID)];
  holdSpy = jest
    .spyOn(DataStoreFindingService, "findRowsAndHoldUpdateToThem")
    .mockImplementation((async () => {
      return rows;
    }) as never);
  writeSpy = jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person confirms a finding", () => {
  test("it becomes High once written, and the project is evaluated again", async () => {
    await update({ isConfirmed: true });

    expect(holdSpy).toHaveBeenCalledTimes(1);
    expect(confidenceWrites()).toEqual([
      [rows[0]!.id!.toString(), DataConfidence.High],
    ]);
    expect(evaluationsQueued()).toEqual([PROJECT_ID.toString()]);
    // OneUptime's own write, after the person's: their update never names a confidence.
    expect(writeSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      queueSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("taking the confirmation back makes it Low again", async () => {
    const { data } = await update({ isConfirmed: false });

    expect(data).toEqual({ isConfirmed: false });
    expect(confidenceWrites()).toEqual([
      [rows[0]!.id!.toString(), DataConfidence.Low],
    ]);
  });

  test("every row the update reaches, and each of their projects once", async () => {
    rows = [row(PROJECT_ID), row(PROJECT_ID), row(OTHER_PROJECT_ID)];

    await update({ isConfirmed: true });

    expect(confidenceWrites()).toHaveLength(3);
    expect(evaluationsQueued()).toEqual([
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ]);
  });
});

describe("a person marks a finding not sensitive", () => {
  test("queues the evaluation and leaves the confidence alone", async () => {
    await update({ isSuppressed: true, suppressedReason: "Test data." });

    expect(confidenceWrites()).toEqual([]);
    expect(evaluationsQueued()).toEqual([PROJECT_ID.toString()]);
  });

  test("sensitive again clears the reason", async () => {
    const { data } = await update({
      isSuppressed: false,
      suppressedReason: "Old reason.",
    });

    expect(data).toEqual({ isSuppressed: false, suppressedReason: null });
  });
});

describe("what a person's verdict is not", () => {
  test("OneUptime's own writes, and any other change, hold nothing and queue nothing", async () => {
    await update({ isConfirmed: true }, true);
    await update({ isSuppressed: true }, true);
    await update({ dataTypeName: "Email address" });

    expect(holdSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });
});
