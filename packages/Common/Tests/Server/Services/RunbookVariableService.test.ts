import RunbookVariableService, {
  RUNBOOK_VARIABLE_NAME_RULE,
} from "../../../Server/Services/RunbookVariableService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../Models/DatabaseModels/Runner";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  stubGenericReferenceCheck,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";

/*
 * WHAT A RUNBOOK VARIABLE MAY HOLD (RunbookVariableService).
 *
 *   - a name steps can write - letters, digits, hyphens, underscores - and
 *     one no other variable of its scope has, renames included;
 *   - a secret keeps its value in secretValue (encrypted, never read back)
 *     and has one; a plain variable keeps its value in value and has one;
 *   - whether it is a secret is fixed when it is made;
 *   - only a secret says which Runners may use it, and never a
 *     kubernetes-agent Runner;
 *   - an edit that leaves a secret's value empty keeps the one it has.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface CreateHookAccess<T extends DatabaseBaseModel> {
  onBeforeCreate(createBy: CreateBy<T>): Promise<OnCreate<T>>;
}

interface UpdateHookAccess<T extends DatabaseBaseModel> {
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
}

const createHook: CreateHookAccess<RunbookVariable> =
  RunbookVariableService as unknown as CreateHookAccess<RunbookVariable>;
const updateHook: UpdateHookAccess<RunbookVariable> =
  RunbookVariableService as unknown as UpdateHookAccess<RunbookVariable>;

let assertNoAgents: jest.SpyInstance;

beforeEach(() => {
  stubProjectDirectory({});
  stubGenericReferenceCheck();
  assertNoAgents = jest
    .spyOn(RunnerService, "assertNoKubernetesAgentRunners")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function create(fields: Record<string, unknown>): CreateBy<RunbookVariable> {
  const data: RunbookVariable = Object.assign(new RunbookVariable(), {
    projectId: PROJECT_ID,
    ...fields,
  });

  return { data, props: { tenantId: PROJECT_ID } } as CreateBy<RunbookVariable>;
}

function update(data: Record<string, unknown>): UpdateBy<RunbookVariable> {
  return {
    query: { _id: VARIABLE_ID },
    data,
    props: { tenantId: PROJECT_ID },
  } as unknown as UpdateBy<RunbookVariable>;
}

// The row an update touches, as findRowsAndHoldUpdateToThem reads it.
function stored(fields: Record<string, unknown>): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    _id: VARIABLE_ID.toString(),
    projectId: PROJECT_ID,
    name: "PROD_KEY",
    ...fields,
  });
}

function storedRows(rows: Array<RunbookVariable>): jest.SpyInstance {
  return jest
    .spyOn(RunbookVariableService, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue(rows as never);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("It was not refused.");
}

describe("making a variable", () => {
  test("a secret keeps its value in Secret Value only", async () => {
    const createBy: CreateBy<RunbookVariable> = create({
      name: " PROD_DB_SSH_KEY ",
      isSecret: true,
      secretValue: "-----BEGIN OPENSSH PRIVATE KEY-----",
    });

    await createHook.onBeforeCreate(createBy);

    expect(createBy.data.name).toBe("PROD_DB_SSH_KEY");
    expect(createBy.data.secretValue).toBe(
      "-----BEGIN OPENSSH PRIVATE KEY-----",
    );
    expect(createBy.data.value).toBeUndefined();
    expect(assertNoAgents).toHaveBeenCalledWith({
      runners: undefined,
      assignedWhat: "secret",
    });
  });

  test("a secret's Runners are checked: never a kubernetes-agent Runner", async () => {
    const runners: Array<Runner> = [
      Object.assign(new Runner(), { _id: ObjectID.generate().toString() }),
    ];
    assertNoAgents.mockRejectedValue(
      new BadDataException("A secret cannot be assigned to an agent Runner."),
    );

    expect(
      await refusal(
        createHook.onBeforeCreate(
          create({
            name: "K",
            isSecret: true,
            secretValue: "v-v-v-v",
            runners,
          }),
        ),
      ),
    ).toBe("A secret cannot be assigned to an agent Runner.");
    expect(assertNoAgents.mock.calls[0]![0]).toEqual({
      runners,
      assignedWhat: "secret",
    });
  });

  test("a secret with no value, or with a plain Value, is refused", async () => {
    expect(
      await refusal(
        createHook.onBeforeCreate(
          create({ name: "K", isSecret: true, secretValue: "  " }),
        ),
      ),
    ).toBe("A secret variable needs a value.");

    expect(
      await refusal(
        createHook.onBeforeCreate(
          create({
            name: "K",
            isSecret: true,
            secretValue: "s3cret",
            value: "s3cret",
          }),
        ),
      ),
    ).toBe(
      "A secret variable keeps its value in Secret Value, which is encrypted and never read back, not in Value.",
    );
  });

  test("a plain variable keeps its value in Value, and who may use it is left out", async () => {
    const createBy: CreateBy<RunbookVariable> = create({
      name: "DB_HOST",
      isSecret: false,
      value: "10.0.4.21",
      runners: [new Runner()],
      isAvailableToGlobalRunners: true,
    });

    await createHook.onBeforeCreate(createBy);

    expect(createBy.data.value).toBe("10.0.4.21");
    expect(createBy.data.secretValue).toBeUndefined();
    expect(createBy.data.runners).toBeUndefined();
    expect(createBy.data.isAvailableToGlobalRunners).toBeUndefined();
    expect(assertNoAgents).not.toHaveBeenCalled();
  });

  test("a plain variable with no value, or with a Secret Value, is refused", async () => {
    expect(
      await refusal(
        createHook.onBeforeCreate(create({ name: "DB_HOST", value: "" })),
      ),
    ).toBe("A variable needs a value.");

    expect(
      await refusal(
        createHook.onBeforeCreate(
          create({ name: "DB_HOST", value: "h", secretValue: "s" }),
        ),
      ),
    ).toBe(
      "Only a secret variable has a Secret Value. Turn Secret on, or put the value in Value.",
    );
  });

  test.each([["prod key"], ["db.host"], [""], ["x".repeat(101)], ["{{x}}"]])(
    "a name steps could not write (%j) is refused",
    async (name: string) => {
      expect(
        await refusal(createHook.onBeforeCreate(create({ name, value: "v" }))),
      ).toBe(RUNBOOK_VARIABLE_NAME_RULE);
    },
  );
});

describe("changing a variable", () => {
  test("whether it is a secret cannot change, either way", async () => {
    storedRows([stored({ isSecret: true })]);

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ isSecret: false }))),
    ).toBe(
      '"PROD_KEY" is a secret, and whether a variable is a secret cannot be changed. Make a new variable with the same name instead: steps name variables by name, so they keep working.',
    );

    jest.restoreAllMocks();
    stubProjectDirectory({});
    stubGenericReferenceCheck();
    jest
      .spyOn(RunnerService, "assertNoKubernetesAgentRunners")
      .mockResolvedValue(undefined as never);
    storedRows([stored({ name: "DB_HOST", isSecret: false })]);

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ isSecret: true }))),
    ).toContain('"DB_HOST" is not a secret');
  });

  test("an edit that sends the same kind is fine, and the kind is not rewritten", async () => {
    storedRows([stored({ isSecret: true })]);

    const updateBy: UpdateBy<RunbookVariable> = update({
      isSecret: true,
      description: "the deploy key",
    });
    await updateHook.onBeforeUpdate(updateBy);

    expect(updateBy.data).toEqual({ description: "the deploy key" });
  });

  test("a secret's value is replaced through Secret Value; an empty one keeps the value it has", async () => {
    storedRows([stored({ isSecret: true })]);

    const replace: UpdateBy<RunbookVariable> = update({
      secretValue: "new-key",
    });
    await updateHook.onBeforeUpdate(replace);
    expect(
      (replace.data as unknown as Record<string, unknown>)["secretValue"],
    ).toBe("new-key");

    const keep: UpdateBy<RunbookVariable> = update({
      secretValue: "",
      description: "d",
    });
    await updateHook.onBeforeUpdate(keep);
    expect(keep.data).toEqual({ description: "d" });
  });

  test("a secret never gets a plain Value", async () => {
    storedRows([stored({ isSecret: true })]);

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ value: "oops" }))),
    ).toBe(
      '"PROD_KEY" is a secret: its value goes in Secret Value, which is encrypted and never read back.',
    );
  });

  test("a plain variable's Value changes, never to nothing, and it never gets a Secret Value", async () => {
    storedRows([stored({ name: "DB_HOST", isSecret: false })]);

    const change: UpdateBy<RunbookVariable> = update({ value: "10.0.4.22" });
    await updateHook.onBeforeUpdate(change);
    expect((change.data as unknown as Record<string, unknown>)["value"]).toBe(
      "10.0.4.22",
    );

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ value: "  " }))),
    ).toBe("A variable needs a value.");

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ secretValue: "s" }))),
    ).toBe(
      '"DB_HOST" is not a secret, so it has no Secret Value. Change its Value instead.',
    );
  });

  test("a plain variable says nothing of who may use it: what is sent is left out", async () => {
    storedRows([stored({ name: "DB_HOST", isSecret: false })]);

    const updateBy: UpdateBy<RunbookVariable> = update({
      runners: [new Runner()],
      isAvailableToGlobalRunners: true,
    });
    await updateHook.onBeforeUpdate(updateBy);

    expect(updateBy.data).toEqual({});
  });

  test("a secret's Runners are checked on every write of them", async () => {
    storedRows([stored({ isSecret: true })]);
    const runners: Array<Runner> = [new Runner()];

    const updateBy: UpdateBy<RunbookVariable> = update({
      runners,
      isAvailableToGlobalRunners: true,
    });
    await updateHook.onBeforeUpdate(updateBy);

    expect(assertNoAgents).toHaveBeenCalledWith({
      runners,
      assignedWhat: "secret",
    });
    expect(
      (updateBy.data as unknown as Record<string, unknown>)[
        "isAvailableToGlobalRunners"
      ],
    ).toBe(true);
  });

  test("an edit of only its description reads nothing", async () => {
    const rows: jest.SpyInstance = storedRows([stored({ isSecret: true })]);

    await updateHook.onBeforeUpdate(update({ description: "d" }));

    expect(rows).not.toHaveBeenCalled();
  });
});

describe("renaming a variable", () => {
  test("a name steps could not write is refused", async () => {
    storedRows([stored({ isSecret: true })]);

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ name: "PROD KEY" }))),
    ).toBe(RUNBOOK_VARIABLE_NAME_RULE);
  });

  test("a global variable's new name must be free among the project's globals", async () => {
    storedRows([stored({ isSecret: true })]);
    const count: jest.SpyInstance = jest
      .spyOn(RunbookVariableService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ name: "DB_HOST" }))),
    ).toBe(
      'A global variable named "DB_HOST" already exists in this project. Global variable names must be unique.',
    );

    const query: Record<string, unknown> = (
      count.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    // Among the globals: those of no runbook.
    expect(query["runbookId"]).not.toBeInstanceOf(ObjectID);
  });

  test("a runbook's own variable's new name must be free among that runbook's", async () => {
    storedRows([stored({ isSecret: false, runbookId: RUNBOOK_ID })]);
    const count: jest.SpyInstance = jest
      .spyOn(RunbookVariableService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ name: "NS" }))),
    ).toBe(
      'This runbook already has a variable named "NS". Variable names must be unique within a runbook.',
    );
    expect(
      String(
        (count.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
          "runbookId"
        ],
      ),
    ).toBe(RUNBOOK_ID.toString());
  });

  test("a free name, or a change of case, is fine", async () => {
    storedRows([stored({ isSecret: true })]);
    const count: jest.SpyInstance = jest
      .spyOn(RunbookVariableService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    const renamed: UpdateBy<RunbookVariable> = update({ name: " NEW_KEY " });
    await updateHook.onBeforeUpdate(renamed);
    expect(renamed.data.name).toBe("NEW_KEY");

    count.mockClear();
    await updateHook.onBeforeUpdate(update({ name: "prod_key" }));
    expect(count).not.toHaveBeenCalled();
  });

  test("several variables cannot take one name at once", async () => {
    storedRows([stored({}), stored({ _id: ObjectID.generate().toString() })]);

    expect(
      await refusal(updateHook.onBeforeUpdate(update({ name: "SAME" }))),
    ).toBe(
      'Cannot rename 2 runbook variables to "SAME" at once. Variable names must be unique.',
    );
  });
});
