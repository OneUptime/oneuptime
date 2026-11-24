import SecurityUserVaultService from "../../../../../Server/Services/SecurityUserVaultService";
import SecurityUserVaultWriter, {
  MAX_USER_VAULT_ENTRIES_PER_BATCH,
  MAX_USER_VAULT_WRITES_IN_FLIGHT,
  SecurityUserVaultBatch,
  SecurityUserVaultScrubRule,
  SecurityUserVaultWriteOutcome,
  USER_VAULT_REWRITE_INTERVAL_MS,
  hashesUsers,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter";
import SecurityEventsReadTelemetry from "../../../../../Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import AppMetrics from "../../../../../Server/Utils/Telemetry/AppMetrics";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
} from "../../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger", () => {
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

/*
 * INGEST'S HALF OF SECURITY EVENTS' USER VAULT (#10632), as the address
 * vault's writer is pinned (SecurityUserVaultWriter.test.ts).
 *
 * A batch of logs or traces keeps the users its Hash rules hid where
 * Security Events reads a user, by token, only when a rule hashes - any
 * pattern can hide a user - and Security Events reads the project's logs
 * (or traces); it writes them once, after its records, and never fails or
 * waits for it. Pinned here with the fan-in writer and the "does Security
 * Events read" question replaced:
 *
 *   - when a batch keeps users, and when it keeps none - without asking
 *     Postgres when no rule hashes;
 *   - what it keeps: today's tokens of users, each once, bounded;
 *   - the write: one fan-in submission of the vault's rows, counted; a
 *     failure logged and counted, never thrown, never remembered; a user
 *     written lately not written again; too many writes in flight skipped
 *     and counted.
 *
 * What the engines hand a batch, and what it keeps of it, is
 * SecurityUserVaultAtScrub.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000b1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000b2",
);

const USER_A: string = "mallory@acme.com";
const USER_B: string = "auth0|5f7c8ec7c33c";

function tokenOf(user: string, projectId: ObjectID = PROJECT_ID): string {
  return ScrubHashToken.ofValue({ projectId, value: user });
}

function rule(
  patternType: string,
  scrubAction: string,
): SecurityUserVaultScrubRule & { rule: { patternType: string } } {
  return { rule: { patternType, scrubAction } };
}

const EMAIL_HASH: SecurityUserVaultScrubRule = rule(
  LogScrubPatternType.Email,
  LogScrubAction.Hash,
);

interface Submitted {
  target: FanInInsertTarget;
  rows: Array<JSONObject>;
}

let submitted: Array<Submitted> = [];
let counted: Array<{ count: number; attributes: JSONObject }> = [];

function acceptSubmissions(): ReturnType<typeof jest.spyOn> {
  return jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (
        target: FanInInsertTarget,
        rows: Array<JSONObject>,
      ): Promise<FanInSubmitResult> => {
        submitted.push({ target, rows });
        return { flushed: Promise.resolve() };
      },
    );
}

function batchOf(
  entries: Array<[string, string]>,
  projectId: ObjectID = PROJECT_ID,
): SecurityUserVaultBatch {
  const batch: SecurityUserVaultBatch = new SecurityUserVaultBatch({
    projectId,
    signal: "trace",
  });

  for (const [token, user] of entries) {
    batch.recordHashedUser({ token, user });
  }

  return batch;
}

function outcomes(): Array<string> {
  return counted.map(
    (entry: { count: number; attributes: JSONObject }): string => {
      return `${String(
        entry.attributes[AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE],
      )}:${String(
        entry.attributes[AppMetrics.USER_VAULT_OUTCOME_ATTRIBUTE],
      )}:${entry.count}`;
    },
  );
}

beforeEach(() => {
  submitted = [];
  counted = [];
  SecurityUserVaultWriter.forgetWrites();
  jest.spyOn(AppMetrics, "getUserVaultWriteCounter").mockReturnValue({
    add: (count: number, attributes?: JSONObject): void => {
      counted.push({ count, attributes: attributes || {} });
    },
  } as never);
});

afterEach(async () => {
  await SecurityUserVaultWriter.whenIdle();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("which rules can hide a user", () => {
  test.each([
    ["an Email rule that hashes", LogScrubPatternType.Email],
    ["a Named Attributes rule that hashes", LogScrubPatternType.NamedKeys],
    ["a custom pattern that hashes", LogScrubPatternType.Custom],
    [
      "a Sensitive Attribute Keys rule that hashes",
      LogScrubPatternType.SensitiveKeys,
    ],
  ])(
    "%s: any pattern but IP Address can",
    (_label: string, patternType: string) => {
      expect(hashesUsers([rule(patternType, LogScrubAction.Hash)])).toBe(true);
    },
  );

  test.each([
    ["no rules", []],
    [
      "an Email rule that redacts",
      [rule(LogScrubPatternType.Email, LogScrubAction.Redact)],
    ],
    [
      "an Email rule that masks",
      [rule(LogScrubPatternType.Email, LogScrubAction.Mask)],
    ],
    [
      "a rule saved with no action (it redacts)",
      [rule(LogScrubPatternType.Email, "")],
    ],
    [
      "an IP Address rule that hashes: its tokens are an address's",
      [rule(LogScrubPatternType.IPAddress, LogScrubAction.Hash)],
    ],
  ])("not %s", (_label: string, rules: Array<SecurityUserVaultScrubRule>) => {
    expect(hashesUsers(rules)).toBe(false);
  });
});

describe("starting a batch", () => {
  test("keeps users when a rule hashes and Security Events reads the project's telemetry", async () => {
    const reads: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
      .mockResolvedValue(true as never);

    const batch: SecurityUserVaultBatch | null =
      await SecurityUserVaultWriter.startBatch({
        projectId: PROJECT_ID,
        signal: "log",
        scrubRules: [EMAIL_HASH],
      });

    expect(batch).not.toBeNull();
    expect(batch!.projectId).toBe(PROJECT_ID);
    expect(batch!.signal).toBe("log");
    expect(reads).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      signal: "log",
    });
  });

  test("keeps none when Security Events does not read the project's traces", async () => {
    jest
      .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
      .mockResolvedValue(false as never);

    expect(
      await SecurityUserVaultWriter.startBatch({
        projectId: PROJECT_ID,
        signal: "trace",
        scrubRules: [EMAIL_HASH],
      }),
    ).toBeNull();
  });

  test("keeps none, and asks nobody, when no rule hashes", async () => {
    const reads: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventsReadTelemetry,
      "readsProjectTelemetry",
    );

    for (const scrubRules of [
      [],
      [rule(LogScrubPatternType.Email, LogScrubAction.Redact)],
      [rule(LogScrubPatternType.Custom, LogScrubAction.Mask)],
    ]) {
      expect(
        await SecurityUserVaultWriter.startBatch({
          projectId: PROJECT_ID,
          signal: "log",
          scrubRules,
        }),
      ).toBeNull();
    }

    expect(reads).not.toHaveBeenCalled();
  });

  test("a question that fails keeps nothing, and never throws", async () => {
    jest
      .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
      .mockRejectedValue(new Error("Postgres is down") as never);

    await expect(
      SecurityUserVaultWriter.startBatch({
        projectId: PROJECT_ID,
        signal: "log",
        scrubRules: [EMAIL_HASH],
      }),
    ).resolves.toBeNull();
  });
});

describe("what a batch keeps", () => {
  test("each token once, with the user behind it", () => {
    const batch: SecurityUserVaultBatch = batchOf([
      [tokenOf(USER_A), USER_A],
      [tokenOf(USER_B), USER_B],
      [tokenOf(USER_A), USER_A],
    ]);

    expect(batch.size).toBe(2);
    expect(batch.getEntries()).toEqual([
      { token: tokenOf(USER_A), user: USER_A },
      { token: tokenOf(USER_B), user: USER_B },
    ]);
  });

  test.each([
    ["what Redact leaves", "[REDACTED]", USER_A],
    ["an older 8-hex token", "[HASHED:8c87b489]", USER_A],
    ["a token in capitals", "[HASHED:01580765CB52614A]", USER_A],
    ["a user Redact hid", "[HASHED:01580765cb52614a]", "[REDACTED]"],
    [
      "a user that is a token",
      "[HASHED:01580765cb52614a]",
      "[HASHED:3f9a1c0e7b2d4a68]",
    ],
    ["no user", "[HASHED:01580765cb52614a]", ""],
  ])("not %s", (_label: string, token: string, user: string) => {
    expect(batchOf([[token, user]]).size).toBe(0);
  });

  test("at most MAX_USER_VAULT_ENTRIES_PER_BATCH users", () => {
    const batch: SecurityUserVaultBatch = new SecurityUserVaultBatch({
      projectId: PROJECT_ID,
      signal: "log",
    });

    for (
      let index: number = 0;
      index < MAX_USER_VAULT_ENTRIES_PER_BATCH + 10;
      index++
    ) {
      const user: string = `user-${index}@acme.com`;
      batch.recordHashedUser({ token: tokenOf(user), user });
    }

    expect(batch.size).toBe(MAX_USER_VAULT_ENTRIES_PER_BATCH);
  });
});

describe("the write", () => {
  test("is one fan-in submission of the vault's rows, counted as written", async () => {
    acceptSubmissions();

    batchOf([
      [tokenOf(USER_A), USER_A],
      [tokenOf(USER_B), USER_B],
    ]).write();
    await SecurityUserVaultWriter.whenIdle();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.target).toBe(SecurityUserVaultService);
    expect(
      submitted[0]!.rows.map((row: JSONObject): Array<unknown> => {
        return [row["projectId"], row["token"], row["userValue"]];
      }),
    ).toEqual([
      [PROJECT_ID.toString(), tokenOf(USER_A), USER_A],
      [PROJECT_ID.toString(), tokenOf(USER_B), USER_B],
    ]);
    expect(submitted[0]!.rows[0]!["firstSeenAt"]).toBe(
      submitted[0]!.rows[0]!["lastSeenAt"],
    );
    expect(outcomes()).toEqual(["trace:written:2"]);
  });

  test("never waits: write() returns before the vault has the rows", async () => {
    let accept: () => void = (): void => {};
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(async (): Promise<FanInSubmitResult> => {
        return {
          flushed: new Promise<void>((resolve: () => void) => {
            accept = resolve;
          }),
        };
      });

    // Returns nothing to wait for: the write runs on its own.
    const returned: unknown = batchOf([[tokenOf(USER_A), USER_A]]).write();

    expect(returned).toBeUndefined();
    expect(outcomes()).toEqual([]);

    await Promise.resolve();
    await Promise.resolve();
    accept();
    await SecurityUserVaultWriter.whenIdle();

    expect(outcomes()).toEqual(["trace:written:1"]);
  });

  test("a batch that kept nothing submits nothing", async () => {
    acceptSubmissions();

    batchOf([]).write();
    await SecurityUserVaultWriter.whenIdle();

    expect(submitted).toEqual([]);
    expect(outcomes()).toEqual([]);
  });

  test("a batch is written once, however often write() is called", async () => {
    acceptSubmissions();

    const batch: SecurityUserVaultBatch = batchOf([[tokenOf(USER_A), USER_A]]);

    batch.write();
    batch.write();
    await SecurityUserVaultWriter.whenIdle();

    expect(submitted).toHaveLength(1);
  });

  test("a user this process wrote lately is not written again", async () => {
    acceptSubmissions();

    batchOf([[tokenOf(USER_A), USER_A]]).write();
    await SecurityUserVaultWriter.whenIdle();

    batchOf([
      [tokenOf(USER_A), USER_A],
      [tokenOf(USER_B), USER_B],
    ]).write();
    await SecurityUserVaultWriter.whenIdle();

    expect(
      submitted.map((submission: Submitted): Array<unknown> => {
        return submission.rows.map((row: JSONObject): unknown => {
          return row["userValue"];
        });
      }),
    ).toEqual([[USER_A], [USER_B]]);
  });

  test("the same user of another project is that project's own row", async () => {
    acceptSubmissions();

    batchOf([[tokenOf(USER_A), USER_A]]).write();
    batchOf(
      [[tokenOf(USER_A, OTHER_PROJECT_ID), USER_A]],
      OTHER_PROJECT_ID,
    ).write();
    await SecurityUserVaultWriter.whenIdle();

    expect(
      submitted.map((submission: Submitted): unknown => {
        return submission.rows[0]!["projectId"];
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
    expect(tokenOf(USER_A)).not.toBe(tokenOf(USER_A, OTHER_PROJECT_ID));
  });

  test("is written again once the rewrite interval has passed", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    acceptSubmissions();

    batchOf([[tokenOf(USER_A), USER_A]]).write();
    await SecurityUserVaultWriter.whenIdle();

    jest.setSystemTime(Date.now() + USER_VAULT_REWRITE_INTERVAL_MS + 1000);

    batchOf([[tokenOf(USER_A), USER_A]]).write();
    await SecurityUserVaultWriter.whenIdle();

    expect(submitted).toHaveLength(2);
  });

  test("a write the vault refuses is logged and counted, never thrown - and tried again by the next batch", async () => {
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockResolvedValueOnce({
        flushed: Promise.reject(new Error("TOO_MANY_PARTS")),
      } as never)
      .mockRejectedValueOnce(new Error("socket hang up") as never);

    expect(() => {
      batchOf([[tokenOf(USER_A), USER_A]]).write();
    }).not.toThrow();
    await SecurityUserVaultWriter.whenIdle();

    expect(() => {
      batchOf([[tokenOf(USER_A), USER_A]]).write();
    }).not.toThrow();
    await SecurityUserVaultWriter.whenIdle();

    expect(outcomes()).toEqual(["trace:failed:1", "trace:failed:1"]);

    acceptSubmissions();
    batchOf([[tokenOf(USER_A), USER_A]]).write();
    await SecurityUserVaultWriter.whenIdle();

    expect(submitted).toHaveLength(1);
    expect(outcomes()).toEqual([
      "trace:failed:1",
      "trace:failed:1",
      "trace:written:1",
    ]);
  });

  test("too many writes in flight: the batch's users are skipped and counted", async () => {
    const accepts: Array<() => void> = [];
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(async (): Promise<FanInSubmitResult> => {
        return {
          flushed: new Promise<void>((resolve: () => void) => {
            accepts.push(resolve);
          }),
        };
      });

    for (
      let index: number = 0;
      index < MAX_USER_VAULT_WRITES_IN_FLIGHT;
      index++
    ) {
      const user: string = `writer-${index}@acme.com`;
      batchOf([[tokenOf(user), user]]).write();
    }

    batchOf([
      [tokenOf(USER_A), USER_A],
      [tokenOf(USER_B), USER_B],
    ]).write();

    expect(outcomes()).toEqual(["trace:skipped:2"]);

    // Let the submits reach their acks, then accept them all.
    for (let tick: number = 0; tick < 5; tick++) {
      await Promise.resolve();
    }

    for (const accept of accepts) {
      accept();
    }

    await SecurityUserVaultWriter.whenIdle();

    expect(
      outcomes().filter((outcome: string): boolean => {
        return outcome.includes(SecurityUserVaultWriteOutcome.Written);
      }),
    ).toHaveLength(MAX_USER_VAULT_WRITES_IN_FLIGHT);
  });
});
