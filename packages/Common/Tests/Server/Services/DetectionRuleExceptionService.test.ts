import DetectionRuleExceptionService, {
  getWrittenDetectionRuleId,
} from "../../../Server/Services/DetectionRuleExceptionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX,
  DetectionRuleExceptionKind,
} from "../../../Types/SecurityEvent/DetectionRuleException";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DETECTION RULE'S EXCEPTIONS, AS THEY ARE SAVED: each checked with the
 * rules the form shows (getDetectionRuleExceptionProblems), stored with
 * only the columns of its kind, for a rule named either way a write names
 * it (its id, or the relation a form's dropdown sends), and at most
 * DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX per rule. An edit is checked as
 * the exception it leaves behind; an expiry only when it changes.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DetectionRuleException>,
  ) => Promise<OnCreate<DetectionRuleException>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DetectionRuleException>,
  ) => Promise<OnUpdate<DetectionRuleException>>;
};

const service: HookCaller =
  DetectionRuleExceptionService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ROW_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const DAY: number = 24 * 60 * 60 * 1000;

function inDays(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

function newException(
  values: Partial<Record<string, unknown>> = {},
): DetectionRuleException {
  const model: DetectionRuleException = new DetectionRuleException();
  model.projectId = PROJECT_ID;
  model.detectionRuleId = RULE_ID;
  model.kind = DetectionRuleExceptionKind.Entity;
  model.entityType = SecurityEntityType.User;
  model.value = "svc-backup";
  model.reason = "The nightly backup job.";
  Object.assign(model, values);
  return model;
}

function storedRow(
  values: Partial<Record<string, unknown>> = {},
): DetectionRuleException {
  const model: DetectionRuleException = newException(values);
  model._id = ROW_ID.toString();
  return model;
}

let count: Spy;

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  count = getJestSpyOn(DetectionRuleExceptionService, "countBy").mockResolvedValue(
    new PositiveNumber(3) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function create(
  data: DetectionRuleException,
): Promise<OnCreate<DetectionRuleException>> {
  return service.onBeforeCreate({ data, props: { isRoot: true } });
}

function update(
  data: JSONObject,
  rows: Array<DetectionRuleException> = [storedRow()],
): Promise<OnUpdate<DetectionRuleException>> {
  getJestSpyOn(
    DetectionRuleExceptionService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue(rows as never);

  return service.onBeforeUpdate({
    query: { _id: ROW_ID },
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<DetectionRuleException>);
}

describe("the rule a write names", () => {
  test("its id column, or the relation a form's dropdown sends", () => {
    expect(
      getWrittenDetectionRuleId({ detectionRuleId: RULE_ID.toString() }),
    ).toBe(RULE_ID.toString());

    const relation: DetectionRule = new DetectionRule();
    relation._id = OTHER_RULE_ID.toString();

    expect(
      getWrittenDetectionRuleId({
        detectionRule: relation as unknown as JSONObject,
      }),
    ).toBe(OTHER_RULE_ID.toString());
    expect(
      getWrittenDetectionRuleId({
        detectionRule: { _id: RULE_ID.toString() },
      }),
    ).toBe(RULE_ID.toString());
  });

  test("none named is undefined; one cleared is null", () => {
    expect(getWrittenDetectionRuleId({ reason: "x" })).toBeUndefined();
    expect(getWrittenDetectionRuleId({ detectionRuleId: null })).toBeNull();
    expect(getWrittenDetectionRuleId({ detectionRule: null })).toBeNull();
  });
});

describe("a new exception", () => {
  test("is stored with only the columns of its kind, normalized", async () => {
    const data: DetectionRuleException = newException({
      value: "  svc-** ",
      reason: "  The backup job.  ",
      fieldName: "processName",
      startsAt: inDays(1),
      endsAt: inDays(2),
      expiresAt: inDays(30),
    });

    await create(data);

    expect(data.value).toBe("svc-*");
    expect(data.reason).toBe("The backup job.");
    expect(data.entityType).toBe(SecurityEntityType.User);
    expect((data as unknown as JSONObject)["fieldName"]).toBeNull();
    expect((data as unknown as JSONObject)["startsAt"]).toBeNull();
    expect((data as unknown as JSONObject)["endsAt"]).toBeNull();
    expect(data.expiresAt).toBeInstanceOf(Date);
  });

  test("a window keeps its times, and no value or expiry", async () => {
    const startsAt: Date = inDays(1);
    const endsAt: Date = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const data: DetectionRuleException = newException({
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt,
      endsAt,
      expiresAt: inDays(5),
    });

    await create(data);

    expect(data.startsAt).toEqual(startsAt);
    expect(data.endsAt).toEqual(endsAt);
    expect((data as unknown as JSONObject)["value"]).toBeNull();
    expect((data as unknown as JSONObject)["entityType"]).toBeNull();
    expect((data as unknown as JSONObject)["expiresAt"]).toBeNull();
  });

  test("names its rule by the relation a form sends, stored as the id", async () => {
    const relation: DetectionRule = new DetectionRule();
    relation._id = OTHER_RULE_ID.toString();

    const data: DetectionRuleException = newException();
    (data as unknown as JSONObject)["detectionRuleId"] = undefined;
    data.detectionRule = relation;

    await create(data);

    expect(data.detectionRuleId?.toString()).toBe(OTHER_RULE_ID.toString());
    expect(
      (count.mock.calls[0]![0] as { query: JSONObject }).query[
        "detectionRuleId"
      ]!.toString(),
    ).toBe(OTHER_RULE_ID.toString());
  });

  test("names a rule, or is refused", async () => {
    const data: DetectionRuleException = newException();
    (data as unknown as JSONObject)["detectionRuleId"] = undefined;

    await expect(create(data)).rejects.toThrow(
      "Choose the detection rule that skips it.",
    );
  });

  test("is refused with the form's own words for what is wrong", async () => {
    await expect(create(newException({ value: "*" }))).rejects.toThrow(
      "A value of only * would skip everything. To stop the rule, turn it off.",
    );
    await expect(create(newException({ reason: " " }))).rejects.toThrow(
      "Say why it is safe for the rule to skip this.",
    );
    await expect(
      create(newException({ expiresAt: inDays(-1) })),
    ).rejects.toThrow(
      "An exception expires in the future. To stop one now, delete it.",
    );
    await expect(
      create(
        newException({
          entityType: SecurityEntityType.IpAddress,
          value: "10.0.0.0/99",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("a rule keeps at most 100 exceptions", async () => {
    count.mockResolvedValue(
      new PositiveNumber(DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX) as never,
    );

    await expect(create(newException())).rejects.toThrow(
      `A rule keeps at most ${DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX} exceptions.`,
    );

    count.mockResolvedValue(
      new PositiveNumber(DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX - 1) as never,
    );

    await expect(create(newException())).resolves.toBeDefined();
  });

  test("the rule must be the project's own: the project check runs first", async () => {
    getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockRejectedValue(
      new BadDataException("Detection Rule not found.") as never,
    );

    await expect(create(newException())).rejects.toThrow(
      "Detection Rule not found.",
    );
    expect(count).not.toHaveBeenCalled();
  });
});

describe("an edit", () => {
  test("that changes nothing an exception is made of reads nothing", async () => {
    const hold: Spy = getJestSpyOn(
      DetectionRuleExceptionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([] as never);

    await service.onBeforeUpdate({
      query: { _id: ROW_ID },
      data: {},
      props: { isRoot: true },
    } as unknown as UpdateBy<DetectionRuleException>);

    expect(hold).not.toHaveBeenCalled();
  });

  test("is checked as the exception it leaves behind", async () => {
    await expect(update({ value: "" })).rejects.toThrow(
      "Enter the user, host or address the rule skips.",
    );
    await expect(update({ reason: "Still the backup job." })).resolves.toBeDefined();
  });

  test("an expired exception's reason can still be edited: an expiry is checked only when it changes", async () => {
    const expired: DetectionRuleException = storedRow({
      expiresAt: inDays(-3),
    });

    await expect(
      update({ reason: "Renamed the job." }, [expired]),
    ).resolves.toBeDefined();

    // Sent back as it was: not a change.
    await expect(
      update({ expiresAt: expired.expiresAt!.toISOString() }, [expired]),
    ).resolves.toBeDefined();

    // A new past expiry: refused.
    await expect(
      update({ expiresAt: inDays(-1).toISOString() }, [expired]),
    ).rejects.toThrow("An exception expires in the future.");

    // A new future one: fine.
    await expect(
      update({ expiresAt: inDays(7).toISOString() }, [expired]),
    ).resolves.toBeDefined();
  });

  test("a new kind clears the columns of the old one", async () => {
    const data: JSONObject = {
      kind: DetectionRuleExceptionKind.Value,
      fieldName: " processName ",
      value: "backup.exe",
    };

    await update(data);

    expect(data["entityType"]).toBeNull();
    expect(data["startsAt"]).toBeNull();
    expect(data["endsAt"]).toBeNull();
    expect(data["fieldName"]).toBe("processName");

    const toWindow: JSONObject = {
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: inDays(1).toISOString(),
      endsAt: inDays(2).toISOString(),
    };

    await update(toWindow);

    expect(toWindow["value"]).toBeNull();
    expect(toWindow["expiresAt"]).toBeNull();
    expect(toWindow["entityType"]).toBeNull();
  });

  test("moving an exception to another rule needs room there", async () => {
    count.mockResolvedValue(
      new PositiveNumber(DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX) as never,
    );

    await expect(
      update({ detectionRuleId: OTHER_RULE_ID.toString() }),
    ).rejects.toThrow("A rule keeps at most");

    // Its own rule again: no move, no count.
    count.mockClear();

    await expect(
      update({ detectionRule: { _id: RULE_ID.toString() } }),
    ).resolves.toBeDefined();
    expect(count).not.toHaveBeenCalled();
  });

  test("an exception always belongs to a rule: clearing it is refused", async () => {
    await expect(update({ detectionRuleId: null })).rejects.toThrow(
      "Choose the detection rule that skips it.",
    );
  });
});
