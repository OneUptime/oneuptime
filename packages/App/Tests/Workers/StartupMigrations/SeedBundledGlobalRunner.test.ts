import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerService, {
  Service as RunnerServiceClass,
} from "Common/Server/Services/RunnerService";
import ComponentKeyWrite from "Common/Server/Utils/ComponentKeyWrite";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import {
  BUNDLED_GLOBAL_RUNNER_DESCRIPTION,
  BUNDLED_GLOBAL_RUNNER_ID,
  BUNDLED_GLOBAL_RUNNER_NAME,
} from "Common/Types/Runner/BundledGlobalRunner";
import SeedBundledGlobalRunner from "../../../FeatureSet/Workers/StartupMigrations/SeedBundledGlobalRunner";
import fs from "fs";
import path from "path";

/*
 * The bundled global Runner's row, kept from GLOBAL_RUNNER_KEY on every boot.
 * What is pinned:
 *
 *   - it is registered as a startup migration, which runs on every boot and
 *     in the migrate Job;
 *   - the key set: the row is created under the fixed id the deployment
 *     starts with - global, no project, runbook steps only - or its key is
 *     updated when the key changed, and nothing is written when nothing
 *     changed;
 *   - the key unset, shipped (a placeholder), or no replica running: the row
 *     is removed, so no project lists a global Runner nobody runs, and a
 *     shipped key is said out loud;
 *   - only the row under the fixed id is ever touched, and never a Runner of
 *     a project's that somehow holds it;
 *   - a database failure reaches the startup runner, which logs it and
 *     carries on.
 */

const KEY: string = "a-long-random-global-runner-key-7f3c9e1b";

const WORKERS_DIR: string = path.join(__dirname, "../../../FeatureSet/Workers");

const MIGRATION_NAME: string = "SeedBundledGlobalRunner";

const INSTANTIATION: RegExp = /new\s+(\w+)\(\)/g;

let findSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let infoSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

const savedKey: string | undefined = process.env["GLOBAL_RUNNER_KEY"];
const savedReplicas: string | undefined = process.env["GLOBAL_RUNNER_REPLICAS"];

function setEnvironment(data: { key?: string; replicas?: string }): void {
  if (data.key === undefined) {
    delete process.env["GLOBAL_RUNNER_KEY"];
  } else {
    process.env["GLOBAL_RUNNER_KEY"] = data.key;
  }

  if (data.replicas === undefined) {
    delete process.env["GLOBAL_RUNNER_REPLICAS"];
  } else {
    process.env["GLOBAL_RUNNER_REPLICAS"] = data.replicas;
  }
}

function existingRow(overrides: Partial<Runner> = {}): Runner {
  const runner: Runner = new Runner();
  runner._id = BUNDLED_GLOBAL_RUNNER_ID;
  runner.isGlobalRunner = true;
  runner.key = KEY;
  Object.assign(runner, overrides);
  return runner;
}

function created(): Runner {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return (createSpy.mock.calls[0]![0] as { data: Runner }).data;
}

async function migrate(): Promise<void> {
  await new SeedBundledGlobalRunner().migrate();
}

beforeEach(() => {
  setEnvironment({ key: KEY });

  findSpy = jest.spyOn(RunnerService, "findOneById").mockResolvedValue(null);
  createSpy = jest
    .spyOn(RunnerService, "create")
    .mockImplementation(async (args: { data: Runner }): Promise<Runner> => {
      return args.data;
    });
  updateSpy = jest
    .spyOn(RunnerService, "updateOneById")
    .mockResolvedValue(undefined as never);
  deleteSpy = jest
    .spyOn(RunnerService, "deleteOneById")
    .mockResolvedValue(undefined as never);

  infoSpy = jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  setEnvironment({
    ...(savedKey !== undefined ? { key: savedKey } : {}),
    ...(savedReplicas !== undefined ? { replicas: savedReplicas } : {}),
  });
});

describe("registration", () => {
  const indexSource: string = fs.readFileSync(
    path.join(WORKERS_DIR, "StartupMigrations/Index.ts"),
    "utf8",
  );

  test("is imported and instantiated once in StartupMigrations/Index.ts", () => {
    expect(indexSource).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const instantiated: Array<string> = Array.from(
      indexSource.matchAll(INSTANTIATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      instantiated.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("carries its own name, which the startup runner logs", () => {
    expect(new SeedBundledGlobalRunner().name).toBe(MIGRATION_NAME);
  });

  test("keeps the row under the fixed id the deployments start with", () => {
    expect(SeedBundledGlobalRunner.bundledGlobalRunnerId.toString()).toBe(
      BUNDLED_GLOBAL_RUNNER_ID,
    );
    expect(ObjectID.isValidUUID(BUNDLED_GLOBAL_RUNNER_ID)).toBe(true);
  });
});

describe("the key set", () => {
  test("creates the global Runner under the fixed id, as OneUptime", async () => {
    await migrate();

    const runner: Runner = created();

    expect(runner.id?.toString()).toBe(BUNDLED_GLOBAL_RUNNER_ID);
    expect(runner.isGlobalRunner).toBe(true);
    expect(runner.projectId).toBeUndefined();
    expect(runner.key).toBe(KEY);
    expect(runner.name).toBe(BUNDLED_GLOBAL_RUNNER_NAME);
    expect(runner.description).toBe(BUNDLED_GLOBAL_RUNNER_DESCRIPTION);
    expect(
      (createSpy.mock.calls[0]![0] as { props: { isRoot: boolean } }).props,
    ).toEqual({ isRoot: true });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * AI code fixes are not a switch on a Runner: a code repository picks a
   * Runner of its project (in Code), which a global Runner never is, so
   * the seed sets nothing for them.
   */
  test("runs runbook steps only: never AI code fixes or AI commands", async () => {
    await migrate();

    expect(created().canRunRunbooks).toBe(true);
    expect(created().canRunAiCommands).toBe(false);
    expect(
      (created() as unknown as Record<string, unknown>)["canRunCodeFixTasks"],
    ).toBeUndefined();
  });

  test("the row it creates has the shape a global Runner must have, and a key that may be stored", async () => {
    await migrate();

    const runner: Runner = created();

    // The create hook's own checks, run on what the seed hands it.
    expect(() => {
      RunnerServiceClass.holdToGlobalRunnerShape(runner, undefined);
    }).not.toThrow();
    expect(() => {
      ComponentKeyWrite.assertCreatedKey(runner.key, "a Runner");
    }).not.toThrow();
  });

  test("reads the key without the whitespace around it", async () => {
    setEnvironment({ key: `  ${KEY}\n` });

    await migrate();

    expect(created().key).toBe(KEY);
  });

  test("writes nothing when the row already has the key", async () => {
    findSpy.mockResolvedValue(existingRow());

    await migrate();

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("updates the key alone when it changed, so the global Runner connects with the new one", async () => {
    findSpy.mockResolvedValue(existingRow({ key: "the-key-it-had-before" }));

    await migrate();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual({
      id: SeedBundledGlobalRunner.bundledGlobalRunnerId,
      data: { key: KEY },
      props: { isRoot: true },
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("leaves a name and description a master admin gave it", async () => {
    findSpy.mockResolvedValue(
      existingRow({
        key: "the-key-it-had-before",
        name: "eu-west global",
        description: "Ours.",
      }),
    );

    await migrate();

    const data: Record<string, unknown> = (
      updateSpy.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(Object.keys(data)).toEqual(["key"]);
  });

  test("runs while some replica runs, or the count is not said", async () => {
    for (const replicas of ["1", "3", " 2 ", "", "not-a-number"]) {
      createSpy.mockClear();
      setEnvironment({ key: KEY, replicas });

      await migrate();

      expect(createSpy).toHaveBeenCalledTimes(1);
    }
  });

  test("never makes a project's Runner global, nor takes its key", async () => {
    findSpy.mockResolvedValue(
      existingRow({
        isGlobalRunner: false,
        projectId: new ObjectID("5f1d8a2c-1111-4222-8333-944455556666"),
        key: "a-project-runner-key",
      }),
    );

    await migrate();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      SeedBundledGlobalRunner.NOT_GLOBAL_MESSAGE,
    );
  });
});

describe("the bundled global Runner turned off", () => {
  test.each([
    ["the key unset", {}],
    ["the key blank", { key: "   " }],
    ["no replica running", { key: KEY, replicas: "0" }],
    ["no replica running, said as 0.0", { key: KEY, replicas: "0.0" }],
  ])(
    "%s: the row is removed",
    async (
      _label: string,
      environment: { key?: string; replicas?: string },
    ) => {
      setEnvironment(environment);
      findSpy.mockResolvedValue(existingRow());

      await migrate();

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy.mock.calls[0]![0]).toEqual({
        id: SeedBundledGlobalRunner.bundledGlobalRunnerId,
        props: { isRoot: true },
      });
      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("quiet when there is no row to remove", async () => {
    setEnvironment({});

    await migrate();

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("never removes a project's Runner that holds the id", async () => {
    setEnvironment({});
    findSpy.mockResolvedValue(
      existingRow({
        isGlobalRunner: false,
        projectId: new ObjectID("5f1d8a2c-1111-4222-8333-944455556666"),
      }),
    );

    await migrate();

    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe("a key the repository ships", () => {
  test.each([
    "please-change-this-to-random-value",
    "secret",
    "global-runner-please-change-this",
  ])(
    "%p keeps the global Runner off, says so, and removes a row that had it",
    async (shipped: string) => {
      setEnvironment({ key: shipped });
      findSpy.mockResolvedValue(existingRow({ key: shipped }));

      await migrate();

      expect(warnSpy).toHaveBeenCalledWith(
        SeedBundledGlobalRunner.SHIPPED_KEY_MESSAGE,
      );
      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("the warning says what to set, and where npm start and the chart set it", () => {
    expect(SeedBundledGlobalRunner.SHIPPED_KEY_MESSAGE).toContain(
      "GLOBAL_RUNNER_KEY",
    );
    expect(SeedBundledGlobalRunner.SHIPPED_KEY_MESSAGE).toContain(
      "npm start and npm run update",
    );
    expect(SeedBundledGlobalRunner.SHIPPED_KEY_MESSAGE).toContain(
      "globalRunner.key",
    );
  });
});

describe("on every boot", () => {
  test("a second boot after the first writes nothing", async () => {
    await migrate();
    expect(createSpy).toHaveBeenCalledTimes(1);

    findSpy.mockResolvedValue(created());
    createSpy.mockClear();
    infoSpy.mockClear();

    await migrate();

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("a database failure reaches the startup runner, which logs it and carries on", async () => {
    findSpy.mockRejectedValue(new Error("Connection terminated."));

    await expect(migrate()).rejects.toThrow("Connection terminated.");
    expect(createSpy).not.toHaveBeenCalled();
  });
});
