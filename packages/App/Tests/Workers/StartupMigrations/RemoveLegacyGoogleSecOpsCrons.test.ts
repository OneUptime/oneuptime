import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import Queue from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import RemoveLegacyGoogleSecOpsCrons from "../../../FeatureSet/Workers/StartupMigrations/RemoveLegacyGoogleSecOpsCrons";
import fs from "fs";
import path from "path";

/*
 * Google SecOps used to be polled by its own cron,
 * "SecurityEvents:PollGoogleSecOpsConnections". The cron was deleted when the
 * connector moved into Security Event Connections, and a deleted cron's
 * repeatable stays in Redis firing every minute until something removes it by
 * name. This startup migration is that something.
 *
 * What is pinned: it is registered, it removes exactly the retired name from
 * the Worker queue and nothing else, it is quiet when there is nothing to do,
 * and no job in the worker still registers the retired names - a live cron
 * under the same name would be deleted on every boot.
 *
 * The queue is replaced with just the method the migration may call, so a
 * call to any other queue method fails the test.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: { Worker: "Worker" },
    default: { removeRepeatableByName: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "RemoveLegacyGoogleSecOpsCrons";
const LEGACY_POLL_JOB_NAME: string =
  "SecurityEvents:PollGoogleSecOpsConnections";
const LEGACY_RUN_JOB_NAME: string = "SecurityEvents:RunGoogleSecOpsConnection";
const CURRENT_POLL_JOB_NAME: string =
  "SecurityEvents:PollSecurityEventConnections";
const CURRENT_RUN_JOB_NAME: string =
  "SecurityEvents:RunSecurityEventConnection";

const WORKERS_DIR: string = path.join(__dirname, "../../../FeatureSet/Workers");

const queue: { removeRepeatableByName: jest.Mock } = Queue as unknown as {
  removeRepeatableByName: jest.Mock;
};

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WORKERS_DIR, relativePath), "utf8");
}

function sourceFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(entryPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("RemoveLegacyGoogleSecOpsCrons", () => {
  const migration: RemoveLegacyGoogleSecOpsCrons =
    new RemoveLegacyGoogleSecOpsCrons();

  beforeEach(() => {
    jest.clearAllMocks();
    queue.removeRepeatableByName.mockResolvedValue(0);
  });

  describe("registration", () => {
    const indexSource: string = readSource("StartupMigrations/Index.ts");

    test("is imported and instantiated in StartupMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("is registered exactly once", () => {
      const instantiations: Array<string> = Array.from(
        indexSource.matchAll(/new\s+(\w+)\(\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    test("carries its own name, which the startup runner logs", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("the sweep", () => {
    test("removes the retired poll cron by name from the Worker queue", async () => {
      await migration.migrate();

      expect(queue.removeRepeatableByName).toHaveBeenCalledTimes(1);
      expect(queue.removeRepeatableByName).toHaveBeenCalledWith(
        "Worker",
        LEGACY_POLL_JOB_NAME,
      );
    });

    test("never touches the crons and jobs that poll Google SecOps now", async () => {
      await migration.migrate();

      const namesRemoved: Array<unknown> =
        queue.removeRepeatableByName.mock.calls.map(
          (call: Array<unknown>): unknown => {
            return call[1];
          },
        );

      expect(namesRemoved).not.toContain(CURRENT_POLL_JOB_NAME);
      expect(namesRemoved).not.toContain(CURRENT_RUN_JOB_NAME);
    });

    test("logs how many definitions it removed, naming the retired and the current cron", async () => {
      queue.removeRepeatableByName.mockResolvedValue(2);

      await migration.migrate();

      expect(mockedLogger.info).toHaveBeenCalledTimes(1);

      const message: string = String(mockedLogger.info.mock.calls[0]![0]);

      expect(message).toContain("Removed 2 orphaned repeatable");
      expect(message).toContain(`"${LEGACY_POLL_JOB_NAME}"`);
      expect(message).toContain(`"${CURRENT_POLL_JOB_NAME}"`);
      expect(message).toContain("Worker queue");
    });

    test("stays quiet when there is nothing to remove", async () => {
      await migration.migrate();

      expect(mockedLogger.info).not.toHaveBeenCalled();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    test("is safe on every boot: a second sweep after the first is a quiet no-op", async () => {
      queue.removeRepeatableByName
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await expect(migration.migrate()).resolves.toBeUndefined();
      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(queue.removeRepeatableByName).toHaveBeenCalledTimes(2);
      expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    });

    test("a Redis failure reaches the startup runner, which logs it and carries on", async () => {
      /*
       * RunStartupMigrations wraps each migration in its own catch, so a
       * rejection here cannot block boot; swallowing it here would only hide
       * that the orphan is still firing.
       */
      queue.removeRepeatableByName.mockRejectedValue(
        new Error("Connection is closed."),
      );

      await expect(migration.migrate()).rejects.toThrow(
        "Connection is closed.",
      );
    });
  });

  describe("the names it retires are really retired", () => {
    test("the Google SecOps job modules are gone and Workers/Index.ts no longer imports them", () => {
      for (const jobModule of [
        "Jobs/SecurityEvents/PollGoogleSecOpsConnections",
        "Jobs/SecurityEvents/RunGoogleSecOpsConnection",
      ]) {
        expect(fs.existsSync(path.join(WORKERS_DIR, `${jobModule}.ts`))).toBe(
          false,
        );
        expect(readSource("Index.ts")).not.toContain(`"./${jobModule}"`);
      }
    });

    test("no job in the worker registers either retired name, so the sweep cannot delete a live cron", () => {
      const registering: Array<string> = sourceFilesUnder(
        path.join(WORKERS_DIR, "Jobs"),
      ).filter((filePath: string): boolean => {
        const source: string = fs.readFileSync(filePath, "utf8");
        return (
          source.includes(LEGACY_POLL_JOB_NAME) ||
          source.includes(LEGACY_RUN_JOB_NAME)
        );
      });

      expect(registering).toEqual([]);
    });

    test("the current Security Event Connections jobs are still registered", () => {
      expect(readSource("Index.ts")).toContain(
        '"./Jobs/SecurityEvents/PollSecurityEventConnections"',
      );
      expect(readSource("Index.ts")).toContain(
        '"./Jobs/SecurityEvents/RunSecurityEventConnection"',
      );
    });
  });
});
