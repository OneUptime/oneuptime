import RunbookVariableResolver, {
  RunbookVariableAccess,
  RunbookVariableResolution,
} from "../../../../Server/Utils/Runbook/RunbookVariableResolver";
import RunbookVariableService from "../../../../Server/Services/RunbookVariableService";
import RunbookVariable from "../../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../../Models/DatabaseModels/Runner";
import ObjectID from "../../../../Types/ObjectID";
import {
  RunbookVariableReference,
  RunbookVariableScope,
} from "../../../../Types/Runbook/RunbookVariableReference";
import { RunbookVariableProblemReason } from "../../../../Types/Runbook/RunbookVariableProblems";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE VARIABLES A RUNBOOK STEP NAMES, READ FOR THE ONE WHO RUNS IT: the one
 * place a secret runbook variable is decrypted for a step, and the one rule
 * for who may have it.
 *
 *   - only what the step names, of the step's own project: its global
 *     variables, and its runbook's own;
 *   - a plain value reaches any Runner that takes the step;
 *   - a secret reaches a project Runner it lists, or a global Runner when
 *     global Runners may use it - never otherwise;
 *   - a variable it cannot have is a problem, never a value.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const global: (name: string) => RunbookVariableReference = (
  name: string,
): RunbookVariableReference => {
  return { scope: RunbookVariableScope.Global, name };
};

const local: (name: string) => RunbookVariableReference = (
  name: string,
): RunbookVariableReference => {
  return { scope: RunbookVariableScope.Local, name };
};

function row(fields: Record<string, unknown>): RunbookVariable {
  return Object.assign(new RunbookVariable(), {
    isAvailableToGlobalRunners: false,
    runners: [],
    ...fields,
  });
}

function runners(...ids: Array<ObjectID>): Array<Runner> {
  return ids.map((id: ObjectID): Runner => {
    return Object.assign(new Runner(), { _id: id.toString() });
  });
}

let globals: Array<RunbookVariable>;
let locals: Array<RunbookVariable>;
let findBy: jest.SpyInstance;

type FindByArgs = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: { isRoot?: boolean };
};

function calls(): Array<FindByArgs> {
  return findBy.mock.calls.map((call: Array<unknown>): FindByArgs => {
    return call[0] as FindByArgs;
  });
}

beforeEach(() => {
  globals = [
    row({ name: "DB_HOST", isSecret: false, value: "10.0.4.21" }),
    row({
      name: "DB_KEY",
      isSecret: true,
      secretValue: "db-key-material",
      runners: runners(RUNNER_ID),
    }),
    row({
      name: "STATUS_TOKEN",
      isSecret: true,
      secretValue: "status-token",
      isAvailableToGlobalRunners: true,
    }),
    row({ name: "EMPTY_SECRET", isSecret: true, secretValue: "" }),
  ];
  locals = [row({ name: "NS", isSecret: false, value: "checkout" })];

  findBy = jest
    .spyOn(RunbookVariableService, "findBy")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const query: Record<string, unknown> = (args as FindByArgs).query;
      return (
        query["runbookId"] instanceof ObjectID ? locals : globals
      ) as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function resolve(data: {
  references: Array<RunbookVariableReference>;
  access: RunbookVariableAccess;
  runbookId?: ObjectID | null;
  includeValues?: boolean;
}): Promise<RunbookVariableResolution> {
  return RunbookVariableResolver.resolve({
    projectId: PROJECT_ID,
    runbookId: data.runbookId === undefined ? RUNBOOK_ID : data.runbookId,
    references: data.references,
    access: data.access,
    includeValues: data.includeValues ?? true,
  });
}

const PROJECT_RUNNER: RunbookVariableAccess = {
  kind: "project-runner",
  runnerId: RUNNER_ID,
};

describe("what is read", () => {
  test("nothing, for a step that names nothing", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [],
      access: PROJECT_RUNNER,
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(resolution.variables.size).toBe(0);
    expect(resolution.problems).toEqual([]);
  });

  test("the step's project's global variables of the names it names, and its runbook's own", async () => {
    await resolve({
      references: [global("DB_HOST"), global("DB_KEY"), local("NS")],
      access: PROJECT_RUNNER,
    });

    const [globalRead, localRead] = calls();

    expect(String(globalRead!.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(globalRead!.query["runbookId"]).not.toBeInstanceOf(ObjectID);
    expect(globalRead!.props.isRoot).toBe(true);

    expect(String(localRead!.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(localRead!.query["runbookId"])).toBe(RUNBOOK_ID.toString());
  });

  test("values are read - and secrets decrypted - only when asked for", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("DB_KEY")],
      access: { kind: "server" },
      includeValues: false,
    });

    expect(calls()[0]!.select).not.toHaveProperty("secretValue");
    expect(calls()[0]!.select).not.toHaveProperty("value");
    expect(resolution.variables.get("global:DB_KEY")).toEqual({
      reference: global("DB_KEY"),
      isSecret: true,
      value: "",
    });
    expect(resolution.secretValues).toEqual([]);
  });
});

describe("a project's own Runner", () => {
  test("gets plain values, and the secrets that list it", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("DB_HOST"), global("DB_KEY"), local("NS")],
      access: PROJECT_RUNNER,
    });

    expect(resolution.problems).toEqual([]);
    expect(resolution.variables.get("global:DB_HOST")!.value).toBe("10.0.4.21");
    expect(resolution.variables.get("global:DB_KEY")!.value).toBe(
      "db-key-material",
    );
    expect(resolution.variables.get("local:NS")!.value).toBe("checkout");
    // The secrets handed over, to hide in what the step prints.
    expect(resolution.secretValues).toEqual(["db-key-material"]);
  });

  test("never a secret that does not list it - global switch or not", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("DB_KEY"), global("STATUS_TOKEN")],
      access: { kind: "project-runner", runnerId: OTHER_RUNNER_ID },
    });

    expect(resolution.variables.size).toBe(0);
    expect(resolution.secretValues).toEqual([]);
    expect(resolution.problems).toEqual([
      {
        reference: global("DB_KEY"),
        reason: RunbookVariableProblemReason.NotForThisRunner,
      },
      {
        reference: global("STATUS_TOKEN"),
        reason: RunbookVariableProblemReason.NotForThisRunner,
      },
    ]);
  });
});

describe("a global Runner", () => {
  test("gets the secrets global Runners may use, and plain values", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("STATUS_TOKEN"), global("DB_HOST")],
      access: { kind: "global-runner" },
    });

    expect(resolution.problems).toEqual([]);
    expect(resolution.secretValues).toEqual(["status-token"]);
  });

  test("never a secret global Runners may not use - even one listing a Runner", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("DB_KEY")],
      access: { kind: "global-runner" },
    });

    expect(resolution.problems).toEqual([
      {
        reference: global("DB_KEY"),
        reason: RunbookVariableProblemReason.NotForGlobalRunners,
      },
    ]);
    expect(resolution.secretValues).toEqual([]);
  });
});

describe("what a step cannot have is a problem, never a value", () => {
  test("a variable that is not there - names compared exactly", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("NOPE"), global("db_host"), local("NOPE")],
      access: { kind: "server" },
    });

    expect(resolution.problems).toEqual([
      {
        reference: global("NOPE"),
        reason: RunbookVariableProblemReason.Missing,
      },
      {
        reference: global("db_host"),
        reason: RunbookVariableProblemReason.Missing,
      },
      {
        reference: local("NOPE"),
        reason: RunbookVariableProblemReason.Missing,
      },
    ]);
  });

  test("a runbook's own variable, where there is no runbook - nothing is read for it", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [local("NS"), global("DB_HOST")],
      access: { kind: "server" },
      runbookId: null,
    });

    expect(resolution.problems).toEqual([
      {
        reference: local("NS"),
        reason: RunbookVariableProblemReason.NoRunbook,
      },
    ]);
    expect(calls()).toHaveLength(1);
    expect(resolution.variables.get("global:DB_HOST")!.value).toBe("10.0.4.21");
  });

  test("a secret with no value", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("EMPTY_SECRET")],
      access: { kind: "server" },
    });

    expect(resolution.problems).toEqual([
      {
        reference: global("EMPTY_SECRET"),
        reason: RunbookVariableProblemReason.NoValue,
      },
    ]);
  });
});

describe("fill", () => {
  test("fills in what the resolution holds; every other placeholder stays", async () => {
    const resolution: RunbookVariableResolution = await resolve({
      references: [global("DB_HOST"), global("DB_KEY")],
      access: PROJECT_RUNNER,
    });

    expect(
      RunbookVariableResolver.fill(
        "psql -h {{global.variables.DB_HOST}} {{runbookSecrets.DB_KEY}} {{global.variables.OTHER}} {{ .Values.x }}",
        resolution,
      ),
    ).toBe(
      "psql -h 10.0.4.21 db-key-material {{global.variables.OTHER}} {{ .Values.x }}",
    );
  });
});
