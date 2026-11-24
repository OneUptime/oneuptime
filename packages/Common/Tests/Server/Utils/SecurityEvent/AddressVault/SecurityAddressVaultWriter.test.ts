import SecurityAddressVaultService from "../../../../../Server/Services/SecurityAddressVaultService";
import SecurityAddressVaultWriter, {
  MAX_VAULT_ENTRIES_PER_BATCH,
  MAX_VAULT_WRITES_IN_FLIGHT,
  SecurityAddressVaultBatch,
  SecurityAddressVaultScrubRule,
  SecurityAddressVaultWriteOutcome,
  VAULT_REWRITE_INTERVAL_MS,
  hashesIpAddresses,
} from "../../../../../Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter";
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
 * INGEST'S HALF OF SECURITY EVENTS' ADDRESS VAULT (#10395).
 *
 * A batch of logs or traces keeps the addresses its IP Address Hash rules
 * hid, by token, only when a rule hashes IP addresses and Security Events
 * reads the project's logs (or traces); it writes them once, after its
 * records, and never fails or waits for it. Pinned here with the fan-in
 * writer and the "does Security Events read" question replaced:
 *
 *   - when a batch keeps addresses, and when it keeps none - without
 *     asking Postgres when no rule hashes IP addresses;
 *   - what it keeps: today's tokens of IP addresses, each once, bounded;
 *   - the write: one fan-in submission of the vault's rows, counted; a
 *     failure logged and counted, never thrown, never remembered; an
 *     address written lately not written again; too many writes in
 *     flight skipped and counted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-0000000000b1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-0000000000b2",
);

const ADDRESS_A: string = "203.0.113.7";
const ADDRESS_B: string = "2001:db8::7";

function tokenOf(address: string, projectId: ObjectID = PROJECT_ID): string {
  return ScrubHashToken.ofIpAddress({ projectId, address });
}

function rule(
  patternType: string,
  scrubAction: string,
): SecurityAddressVaultScrubRule {
  return { rule: { patternType, scrubAction } };
}

const IP_HASH: SecurityAddressVaultScrubRule = rule(
  LogScrubPatternType.IPAddress,
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
): SecurityAddressVaultBatch {
  const batch: SecurityAddressVaultBatch = new SecurityAddressVaultBatch({
    projectId,
    signal: "trace",
  });

  for (const [token, address] of entries) {
    batch.recordHashedAddress({ token, address });
  }

  return batch;
}

function outcomes(): Array<string> {
  return counted.map(
    (entry: { count: number; attributes: JSONObject }): string => {
      return `${String(
        entry.attributes[AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE],
      )}:${String(
        entry.attributes[AppMetrics.ADDRESS_VAULT_OUTCOME_ATTRIBUTE],
      )}:${entry.count}`;
    },
  );
}

beforeEach(() => {
  submitted = [];
  counted = [];
  SecurityAddressVaultWriter.forgetWrites();
  jest.spyOn(AppMetrics, "getAddressVaultWriteCounter").mockReturnValue({
    add: (count: number, attributes?: JSONObject): void => {
      counted.push({ count, attributes: attributes || {} });
    },
  } as never);
});

afterEach(async () => {
  await SecurityAddressVaultWriter.whenIdle();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("which rules hash IP addresses", () => {
  test("an IP Address rule whose action is Hash", () => {
    expect(hashesIpAddresses([IP_HASH])).toBe(true);
    expect(
      hashesIpAddresses([
        rule(LogScrubPatternType.Email, LogScrubAction.Redact),
        IP_HASH,
      ]),
    ).toBe(true);
  });

  test.each([
    ["no rules", []],
    [
      "an IP Address rule that redacts",
      [rule(LogScrubPatternType.IPAddress, LogScrubAction.Redact)],
    ],
    [
      "an IP Address rule that masks",
      [rule(LogScrubPatternType.IPAddress, LogScrubAction.Mask)],
    ],
    [
      "an IP Address rule saved with no action (it redacts)",
      [rule(LogScrubPatternType.IPAddress, "")],
    ],
    [
      "a custom pattern that hashes",
      [rule(LogScrubPatternType.Custom, LogScrubAction.Hash)],
    ],
    [
      "an Email rule that hashes",
      [rule(LogScrubPatternType.Email, LogScrubAction.Hash)],
    ],
    [
      "a Sensitive Attribute Keys rule that hashes",
      [rule(LogScrubPatternType.SensitiveKeys, LogScrubAction.Hash)],
    ],
  ])(
    "not %s",
    (_label: string, rules: Array<SecurityAddressVaultScrubRule>) => {
      expect(hashesIpAddresses(rules)).toBe(false);
    },
  );
});

describe("starting a batch", () => {
  test("keeps addresses when a rule hashes IP addresses and Security Events reads the project's telemetry", async () => {
    const reads: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
      .mockResolvedValue(true as never);

    const batch: SecurityAddressVaultBatch | null =
      await SecurityAddressVaultWriter.startBatch({
        projectId: PROJECT_ID,
        signal: "log",
        scrubRules: [IP_HASH],
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
      await SecurityAddressVaultWriter.startBatch({
        projectId: PROJECT_ID,
        signal: "trace",
        scrubRules: [IP_HASH],
      }),
    ).toBeNull();
  });

  test("keeps none, and asks nobody, when no rule hashes IP addresses", async () => {
    const reads: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventsReadTelemetry,
      "readsProjectTelemetry",
    );

    for (const scrubRules of [
      [],
      [rule(LogScrubPatternType.IPAddress, LogScrubAction.Redact)],
      [rule(LogScrubPatternType.Custom, LogScrubAction.Hash)],
    ]) {
      expect(
        await SecurityAddressVaultWriter.startBatch({
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
      SecurityAddressVaultWriter.startBatch({
        projectId: PROJECT_ID,
        signal: "log",
        scrubRules: [IP_HASH],
      }),
    ).resolves.toBeNull();
  });
});

describe("what a batch keeps", () => {
  test("each token once, with the address behind it", () => {
    const batch: SecurityAddressVaultBatch = batchOf([
      [tokenOf(ADDRESS_A), ADDRESS_A],
      [tokenOf(ADDRESS_B), ADDRESS_B],
      [tokenOf(ADDRESS_A), ADDRESS_A],
    ]);

    expect(batch.size).toBe(2);
    expect(batch.getEntries()).toEqual([
      { token: tokenOf(ADDRESS_A), address: ADDRESS_A },
      { token: tokenOf(ADDRESS_B), address: ADDRESS_B },
    ]);
  });

  test.each([
    ["what Redact leaves", "[REDACTED]", ADDRESS_A],
    ["an older 8-hex token", "[HASHED:8c87b489]", ADDRESS_A],
    ["a token in capitals", "[HASHED:01580765CB52614A]", ADDRESS_A],
    ["no IP address", "[HASHED:01580765cb52614a]", "attacker.example"],
    [
      "an address with its port",
      "[HASHED:01580765cb52614a]",
      "203.0.113.7:443",
    ],
  ])("not %s", (_label: string, token: string, address: string) => {
    expect(batchOf([[token, address]]).size).toBe(0);
  });

  test("at most MAX_VAULT_ENTRIES_PER_BATCH addresses", () => {
    const batch: SecurityAddressVaultBatch = new SecurityAddressVaultBatch({
      projectId: PROJECT_ID,
      signal: "log",
    });

    for (
      let index: number = 0;
      index < MAX_VAULT_ENTRIES_PER_BATCH + 10;
      index++
    ) {
      const address: string = `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
      batch.recordHashedAddress({ token: tokenOf(address), address });
    }

    expect(batch.size).toBe(MAX_VAULT_ENTRIES_PER_BATCH);
  });
});

describe("the write", () => {
  test("is one fan-in submission of the vault's rows, counted as written", async () => {
    acceptSubmissions();

    batchOf([
      [tokenOf(ADDRESS_A), ADDRESS_A],
      [tokenOf(ADDRESS_B), ADDRESS_B],
    ]).write();
    await SecurityAddressVaultWriter.whenIdle();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.target).toBe(SecurityAddressVaultService);
    expect(
      submitted[0]!.rows.map((row: JSONObject): Array<unknown> => {
        return [row["projectId"], row["token"], row["address"]];
      }),
    ).toEqual([
      [PROJECT_ID.toString(), tokenOf(ADDRESS_A), ADDRESS_A],
      [PROJECT_ID.toString(), tokenOf(ADDRESS_B), ADDRESS_B],
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
    const returned: unknown = batchOf([
      [tokenOf(ADDRESS_A), ADDRESS_A],
    ]).write();

    expect(returned).toBeUndefined();
    expect(outcomes()).toEqual([]);

    await Promise.resolve();
    await Promise.resolve();
    accept();
    await SecurityAddressVaultWriter.whenIdle();

    expect(outcomes()).toEqual(["trace:written:1"]);
  });

  test("a batch that kept nothing submits nothing", async () => {
    acceptSubmissions();

    batchOf([]).write();
    await SecurityAddressVaultWriter.whenIdle();

    expect(submitted).toEqual([]);
    expect(outcomes()).toEqual([]);
  });

  test("a batch is written once, however often write() is called", async () => {
    acceptSubmissions();

    const batch: SecurityAddressVaultBatch = batchOf([
      [tokenOf(ADDRESS_A), ADDRESS_A],
    ]);

    batch.write();
    batch.write();
    await SecurityAddressVaultWriter.whenIdle();

    expect(submitted).toHaveLength(1);
  });

  test("an address this process wrote lately is not written again", async () => {
    acceptSubmissions();

    batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    await SecurityAddressVaultWriter.whenIdle();

    batchOf([
      [tokenOf(ADDRESS_A), ADDRESS_A],
      [tokenOf(ADDRESS_B), ADDRESS_B],
    ]).write();
    await SecurityAddressVaultWriter.whenIdle();

    expect(
      submitted.map((submission: Submitted): Array<unknown> => {
        return submission.rows.map((row: JSONObject): unknown => {
          return row["address"];
        });
      }),
    ).toEqual([[ADDRESS_A], [ADDRESS_B]]);
  });

  test("the same address of another project is that project's own row", async () => {
    acceptSubmissions();

    batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    batchOf(
      [[tokenOf(ADDRESS_A, OTHER_PROJECT_ID), ADDRESS_A]],
      OTHER_PROJECT_ID,
    ).write();
    await SecurityAddressVaultWriter.whenIdle();

    expect(
      submitted.map((submission: Submitted): unknown => {
        return submission.rows[0]!["projectId"];
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
    expect(tokenOf(ADDRESS_A)).not.toBe(tokenOf(ADDRESS_A, OTHER_PROJECT_ID));
  });

  test("is written again once the rewrite interval has passed", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    acceptSubmissions();

    batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    await SecurityAddressVaultWriter.whenIdle();

    jest.setSystemTime(Date.now() + VAULT_REWRITE_INTERVAL_MS + 1000);

    batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    await SecurityAddressVaultWriter.whenIdle();

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
      batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    }).not.toThrow();
    await SecurityAddressVaultWriter.whenIdle();

    expect(() => {
      batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    }).not.toThrow();
    await SecurityAddressVaultWriter.whenIdle();

    expect(outcomes()).toEqual(["trace:failed:1", "trace:failed:1"]);

    acceptSubmissions();
    batchOf([[tokenOf(ADDRESS_A), ADDRESS_A]]).write();
    await SecurityAddressVaultWriter.whenIdle();

    expect(submitted).toHaveLength(1);
    expect(outcomes()).toEqual([
      "trace:failed:1",
      "trace:failed:1",
      "trace:written:1",
    ]);
  });

  test("too many writes in flight: the batch's addresses are skipped and counted", async () => {
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

    for (let index: number = 0; index < MAX_VAULT_WRITES_IN_FLIGHT; index++) {
      const address: string = `198.51.100.${index}`;
      batchOf([[tokenOf(address), address]]).write();
    }

    batchOf([
      [tokenOf(ADDRESS_A), ADDRESS_A],
      [tokenOf(ADDRESS_B), ADDRESS_B],
    ]).write();

    expect(outcomes()).toEqual(["trace:skipped:2"]);

    // Let the submits reach their acks, then accept them all.
    for (let tick: number = 0; tick < 5; tick++) {
      await Promise.resolve();
    }

    for (const accept of accepts) {
      accept();
    }

    await SecurityAddressVaultWriter.whenIdle();

    expect(
      outcomes().filter((outcome: string): boolean => {
        return outcome.includes(SecurityAddressVaultWriteOutcome.Written);
      }),
    ).toHaveLength(MAX_VAULT_WRITES_IN_FLIGHT);
  });
});
