import DataStoreFindingService, {
  ONLY_A_PERSON_MARKS_NOT_SENSITIVE_MESSAGE,
} from "../../../Server/Services/DataStoreFindingService";
import Queue from "../../../Server/Infrastructure/Queue";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_TUNE_SCANS_JOB,
} from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A person's verdict on a finding (DataStoreFindingService): Not Sensitive
 * and Confirm both queue the project's evaluation, and a confirmed finding
 * counts as High confidence - set as OneUptime's own write once the
 * update is written, since a person cannot set a confidence. When it was
 * decided is kept, for OneUptime AI's precedent (#10372), and a decision
 * is the person's, never OneUptime AI's own confirmation again. A mark of
 * not sensitive has the scans' tuning looked at; and OneUptime's own
 * write never marks a finding not sensitive, under any rule.
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

function writes(): Array<{ id: string; data: JSONObject }> {
  return writeSpy.mock.calls.map((call: Array<unknown>) => {
    const write: { id: ObjectID; data: JSONObject } = call[0] as {
      id: ObjectID;
      data: JSONObject;
    };
    return { id: write.id.toString(), data: write.data };
  });
}

function confidenceWrites(): Array<[string, unknown]> {
  return writes()
    .filter((write: { data: JSONObject }): boolean => {
      return write.data["confidence"] !== undefined;
    })
    .map((write: { id: string; data: JSONObject }): [string, unknown] => {
      return [write.id, write.data["confidence"]];
    });
}

function jobsQueued(jobName: string): Array<unknown> {
  return queueSpy.mock.calls
    .filter((call: Array<unknown>) => {
      return call[2] === jobName;
    })
    .map((call: Array<unknown>) => {
      return (call[3] as JSONObject)["projectId"];
    });
}

function evaluationsQueued(): Array<unknown> {
  return jobsQueued(DATA_SECURITY_EVALUATE_PROJECT_JOB);
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

  test("has OneUptime AI look at what it says of the scans, once per project", async () => {
    rows = [row(PROJECT_ID), row(PROJECT_ID), row(OTHER_PROJECT_ID)];

    await update({ isSuppressed: true, suppressedReason: "Test data." });

    expect(jobsQueued(DATA_SECURITY_TUNE_SCANS_JOB)).toEqual([
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ]);
  });

  test("a confirmation looks at no tuning", async () => {
    await update({ isConfirmed: true });

    expect(jobsQueued(DATA_SECURITY_TUNE_SCANS_JOB)).toEqual([]);
  });

  test("sensitive again clears the reason", async () => {
    const { data } = await update({
      isSuppressed: false,
      suppressedReason: "Old reason.",
    });

    expect(data).toEqual({ isSuppressed: false, suppressedReason: null });
  });
});

describe("when a decision was made, and whose it is", () => {
  test("a confirmation and a mark of not sensitive are decided now, and are the person's", async () => {
    const before: number = Date.now();

    await update({ isConfirmed: true });
    await update({ isSuppressed: true, suppressedReason: "Test data." });

    const decided: Array<{ id: string; data: JSONObject }> = writes();

    expect(decided).toHaveLength(2);

    for (const write of decided) {
      expect(write.data["isConfirmedByAi"]).toBe(false);
      expect(write.data["decidedAt"]).toBeInstanceOf(Date);
      expect(
        (write.data["decidedAt"] as unknown as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);
    }
  });

  test("a decision taken back is decided no more", async () => {
    await update({ isSuppressed: false, suppressedReason: "Old reason." });
    await update({ isConfirmed: false });

    expect(writes()).toHaveLength(2);

    for (const write of writes()) {
      expect(write.data["decidedAt"]).toBeNull();
      expect(write.data["isConfirmedByAi"]).toBe(false);
    }
  });
});

describe("OneUptime never marks a finding not sensitive on its own", () => {
  test("its own write that would is refused, before anything is held", async () => {
    await expect(update({ isSuppressed: true }, true)).rejects.toThrow(
      ONLY_A_PERSON_MARKS_NOT_SENSITIVE_MESSAGE,
    );
    await expect(
      update({ isSuppressed: true, suppressedReason: "AI says so." }, true),
    ).rejects.toThrow(ONLY_A_PERSON_MARKS_NOT_SENSITIVE_MESSAGE);

    expect(holdSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("a person's own mark goes through, as before", async () => {
    await expect(
      update({ isSuppressed: true, suppressedReason: "Seed data." }),
    ).resolves.toBeTruthy();
  });

  test("OneUptime may still take a mark back, or confirm", async () => {
    await expect(update({ isSuppressed: false }, true)).resolves.toBeTruthy();
    await expect(update({ isConfirmed: true }, true)).resolves.toBeTruthy();
  });
});

describe("what a person's verdict is not", () => {
  test("OneUptime's own writes, and any other change, hold nothing and queue nothing", async () => {
    await update({ isConfirmed: true }, true);
    await update({ isSuppressed: false }, true);
    await update({ dataTypeName: "Email address" });

    expect(holdSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });
});
