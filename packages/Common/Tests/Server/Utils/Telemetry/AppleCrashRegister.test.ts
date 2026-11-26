/*
 * The cache and the lock stand in memory: what is pinned here is what the
 * register keeps, pairs and refuses, not Valkey.
 */
const stored: Map<string, string> = new Map<string, string>();
const setStringMock: jest.Mock = jest.fn();
const lockMock: jest.Mock = jest.fn();
const releaseMock: jest.Mock = jest.fn();

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: async (namespace: string, key: string) => {
        return stored.get(`${namespace}-${key}`) ?? null;
      },
      setString: async (
        namespace: string,
        key: string,
        value: string,
        options: { expiresInSeconds: number },
      ) => {
        setStringMock(namespace, key, value, options);
        stored.set(`${namespace}-${key}`, value);
      },
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: (...args: Array<unknown>) => {
        return lockMock(...args);
      },
      release: (...args: Array<unknown>) => {
        return releaseMock(...args);
      },
    },
  };
});

import AppleCrashRegister, {
  APPLE_CRASH_REGISTER_TTL_SECONDS,
  MAX_REGISTERED_CRASHES_PER_INSTALL,
  RegisteredAppleCrash,
} from "../../../../Server/Utils/Telemetry/AppleCrashRegister";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  AppleCrashSignature,
  MATCH_WINDOW_MS,
} from "../../../../Utils/Telemetry/AppleCrashMatch";
import { toReadableMetricKitStackTrace } from "../../../../Utils/Telemetry/MetricKitCallStack";
import {
  CRASHED_AT,
  CRASH_KSCRASH_REPORT,
  CRASH_MAIN_THREAD,
  CRASH_TREE,
  FixtureFrame,
  IDLE_THREAD,
  METRICKIT_PERIOD_END,
  metricKitTree,
} from "../../../Utils/Telemetry/AppleCrashFixtures";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * #9923: KSCrash's and MetricKit's reports of one crash reach ingest apart -
 * minutes to a day - and often on different workers. The register keeps an
 * install's recent reports, pairs a new one with the other reporter's report
 * of the same crash under a lock on the install, and each report pairs once.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const APP_ID: ObjectID = ObjectID.generate();
const IDFV: string = "E621E1F8-C36C-495A-93FC-0C247A3E6E5F";

function kscrashAttributes(install: string = IDFV): JSONObject {
  return {
    "event.name": "device.crash",
    "resource.device.id": install,
    "resource.service.name": "storefront-ios",
  };
}

function metricKitAttributes(install: string = IDFV): JSONObject {
  return {
    "event.name": "metrickit.diagnostic.crash",
    "resource.device.id": install,
    "resource.service.name": "storefront-ios",
    "metrickit.diagnostic.crash.exception.signal.name": "SIGSEGV",
    "metrickit.diagnostic.crash.exception.mach_exception.name":
      "EXC_BAD_ACCESS",
  };
}

function kscrash(
  overrides: Partial<{ install: string; time: Date; text: string }> = {},
): AppleCrashSignature {
  return AppleCrashRegister.buildSignature({
    attributes: kscrashAttributes(overrides.install),
    stackTrace: overrides.text ?? CRASH_KSCRASH_REPORT,
    exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
    time: overrides.time ?? CRASHED_AT,
  })!;
}

function metricKit(
  overrides: Partial<{ install: string; time: Date; tree: string }> = {},
): AppleCrashSignature {
  return AppleCrashRegister.buildSignature({
    attributes: metricKitAttributes(overrides.install),
    stackTrace: toReadableMetricKitStackTrace(
      overrides.tree ?? CRASH_TREE,
      "crash",
    )!,
    exceptionType: "EXC_BAD_ACCESS",
    time: overrides.time ?? METRICKIT_PERIOD_END,
  })!;
}

let occurrenceNumber: number = 0;

async function report(
  signature: AppleCrashSignature,
  now: number = METRICKIT_PERIOD_END.getTime(),
): Promise<{ id: string; repeats: RegisteredAppleCrash | null }> {
  occurrenceNumber++;
  const id: string = `occurrence-${occurrenceNumber}`;

  const repeats: RegisteredAppleCrash | null =
    await AppleCrashRegister.pairOrRecord({
      projectId: PROJECT_ID,
      primaryEntityId: APP_ID,
      signature,
      occurrence: {
        id,
        fingerprint: `v1-${id}`,
        fingerprintV2: `v2-${id}`,
      },
      now,
    });

  return { id, repeats };
}

function kept(install: string = IDFV): Array<RegisteredAppleCrash> {
  const key: string = AppleCrashRegister.getKey({
    projectId: PROJECT_ID,
    primaryEntityId: APP_ID,
    install,
  });

  return JSON.parse(stored.get(`apple-crash-register-${key}`) || "[]");
}

function withAppFrameMoved(by: number): Array<FixtureFrame> {
  return CRASH_MAIN_THREAD.map((frame: FixtureFrame, index: number) => {
    return index === 1 ? { ...frame, offset: frame.offset + by } : frame;
  });
}

beforeEach(() => {
  stored.clear();
  setStringMock.mockReset();
  lockMock.mockReset();
  releaseMock.mockReset();
  lockMock.mockResolvedValue({ name: "mutex" });
  releaseMock.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which reports can be paired", () => {
  test("KSCrash's device.crash whose stack is an Apple report, and MetricKit's crash", () => {
    expect(kscrash().reporter).toBe("kscrash");
    expect(metricKit().reporter).toBe("metrickit");
    expect(kscrash().install).toBe(IDFV);
  });

  test("the install is app.installation.id where the SDK sets one, before device.id", () => {
    const signature: AppleCrashSignature = AppleCrashRegister.buildSignature({
      attributes: {
        ...kscrashAttributes(),
        "resource.app.installation.id": "install-3",
      },
      stackTrace: CRASH_KSCRASH_REPORT,
      exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
      time: CRASHED_AT,
    })!;

    expect(signature.install).toBe("install-3");
  });

  test("an Android crash, a report with no install, and a hang are not paired", () => {
    // OpenTelemetry Android's device.crash: a Java stack trace.
    expect(
      AppleCrashRegister.buildSignature({
        attributes: kscrashAttributes(),
        stackTrace:
          "java.lang.IllegalStateException: boom\n\tat com.example.Cart.checkout(Cart.java:42)",
        exceptionType: "java.lang.IllegalStateException",
        time: CRASHED_AT,
      }),
    ).toBe(null);

    expect(
      AppleCrashRegister.buildSignature({
        attributes: { "event.name": "device.crash" },
        stackTrace: CRASH_KSCRASH_REPORT,
        exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
        time: CRASHED_AT,
      }),
    ).toBe(null);

    expect(
      AppleCrashRegister.buildSignature({
        attributes: {
          "event.name": "metrickit.diagnostic.hang",
          "resource.device.id": IDFV,
        },
        stackTrace: toReadableMetricKitStackTrace(CRASH_TREE, "hang")!,
        exceptionType: "Hang",
        time: CRASHED_AT,
      }),
    ).toBe(null);
  });
});

describe("one crash, reported twice", () => {
  test("KSCrash's report first, then MetricKit's: MetricKit's repeats it", async () => {
    const first: { id: string; repeats: RegisteredAppleCrash | null } =
      await report(kscrash(), CRASHED_AT.getTime() + 2000);
    const second: { id: string; repeats: RegisteredAppleCrash | null } =
      await report(metricKit());

    expect(first.repeats).toBe(null);
    expect(second.repeats).toMatchObject({
      occurrenceId: first.id,
      fingerprint: `v1-${first.id}`,
      fingerprintV2: `v2-${first.id}`,
    });

    // The first is marked paired; the repeat is not kept: nothing pairs with it.
    expect(kept()).toHaveLength(1);
    expect(kept()[0]!.pairedWith).toBe(second.id);
  });

  test("MetricKit's first - delivered at once on iOS 15 and later - then KSCrash's", async () => {
    const first: { id: string; repeats: RegisteredAppleCrash | null } =
      await report(metricKit());
    const second: { id: string; repeats: RegisteredAppleCrash | null } =
      await report(kscrash());

    expect(first.repeats).toBe(null);
    expect(second.repeats?.occurrenceId).toBe(first.id);
  });

  test("the register is held under a lock on the install while it is compared, and kept for twice the window", async () => {
    await report(kscrash());

    expect(lockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "apple-crash-register",
        key: AppleCrashRegister.getKey({
          projectId: PROJECT_ID,
          primaryEntityId: APP_ID,
          install: IDFV,
        }),
      }),
    );
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(setStringMock.mock.calls[0]![3]).toEqual({
      expiresInSeconds: APPLE_CRASH_REGISTER_TTL_SECONDS,
    });
    expect(APPLE_CRASH_REGISTER_TTL_SECONDS * 1000).toBe(2 * MATCH_WINDOW_MS);
  });
});

describe("two crashes stay two", () => {
  test("a crash loop: two crashes of one bug, each reported by both, pair two by two", async () => {
    const firstKscrash: { id: string } = await report(kscrash());
    const secondKscrash: { id: string } = await report(
      kscrash({ time: new Date(CRASHED_AT.getTime() + 60_000) }),
    );
    const firstMetricKit: { repeats: RegisteredAppleCrash | null } =
      await report(metricKit());
    const secondMetricKit: { repeats: RegisteredAppleCrash | null } =
      await report(metricKit());
    // A third MetricKit report of the same bug has no KSCrash report left.
    const thirdMetricKit: { repeats: RegisteredAppleCrash | null } =
      await report(metricKit());

    expect(
      [
        firstMetricKit.repeats?.occurrenceId,
        secondMetricKit.repeats?.occurrenceId,
      ].sort(),
    ).toEqual([firstKscrash.id, secondKscrash.id].sort());
    expect(thirdMetricKit.repeats).toBe(null);
  });

  test("the same reporter twice is two crashes", async () => {
    await report(kscrash());

    expect((await report(kscrash())).repeats).toBe(null);
    expect(kept()).toHaveLength(2);
  });

  test("another install's report of the same stack is another crash", async () => {
    await report(kscrash());

    expect(
      (await report(metricKit({ install: "another-device" }))).repeats,
    ).toBe(null);
    expect(kept()).toHaveLength(1);
    expect(kept("another-device")).toHaveLength(1);
  });

  test("a report further from the first than the window is another crash", async () => {
    await report(kscrash());

    const late: Date = new Date(CRASHED_AT.getTime() + MATCH_WINDOW_MS + 1000);

    expect(
      (await report(metricKit({ time: late }), late.getTime())).repeats,
    ).toBe(null);
  });

  test("one app frame elsewhere is another crash", async () => {
    await report(kscrash());

    const elsewhere: string = metricKitTree([
      { frames: IDLE_THREAD, attributed: false },
      { frames: withAppFrameMoved(64), attributed: true },
    ]);

    expect((await report(metricKit({ tree: elsewhere }))).repeats).toBe(null);
  });

  test("a report kept longer than the register keeps reports is forgotten", async () => {
    await report(kscrash(), CRASHED_AT.getTime());

    expect(
      AppleCrashRegister.readEntries(
        stored.values().next().value as string,
        CRASHED_AT.getTime() + APPLE_CRASH_REGISTER_TTL_SECONDS * 1000 + 1,
      ),
    ).toEqual([]);
  });

  test("an install keeps its most recent reports only", async () => {
    for (
      let index: number = 0;
      index < MAX_REGISTERED_CRASHES_PER_INSTALL + 5;
      index++
    ) {
      await report(kscrash());
    }

    expect(kept()).toHaveLength(MAX_REGISTERED_CRASHES_PER_INSTALL);
    expect(kept()[0]!.occurrenceId).not.toBe("occurrence-1");
  });
});

describe("when the register cannot be read, each report counts on its own", () => {
  test("no lock: nothing is paired or kept", async () => {
    lockMock.mockRejectedValue(new Error("Valkey is down"));

    await report(kscrash());

    expect((await report(metricKit())).repeats).toBe(null);
    expect(stored.size).toBe(0);
  });

  test("what the register holds is read with care: anything not a report is left out", () => {
    expect(AppleCrashRegister.readEntries(null, 0)).toEqual([]);
    expect(AppleCrashRegister.readEntries("not json", 0)).toEqual([]);
    expect(AppleCrashRegister.readEntries('{"a":1}', 0)).toEqual([]);
    expect(
      AppleCrashRegister.readEntries(
        JSON.stringify([{ occurrenceId: "x" }, 42, null]),
        0,
      ),
    ).toEqual([]);
  });
});

/*
 * #10434: an occurrence also carries the exceptions it may already belong
 * to, tried in order - its v1 and v2 fingerprints, the keyed one, and for a
 * log record a scrub rule changed, the ones of what the rule left. A crash's
 * second report is filed under the first's exception, so it carries the
 * first's candidates too.
 */
describe("a repeat tries the exceptions its first report tries", () => {
  async function reportWithCandidates(
    signature: AppleCrashSignature,
    candidates: Array<string> | undefined,
    now: number = METRICKIT_PERIOD_END.getTime(),
  ): Promise<{ id: string; repeats: RegisteredAppleCrash | null }> {
    occurrenceNumber++;
    const id: string = `occurrence-${occurrenceNumber}`;

    const repeats: RegisteredAppleCrash | null =
      await AppleCrashRegister.pairOrRecord({
        projectId: PROJECT_ID,
        primaryEntityId: APP_ID,
        signature,
        occurrence: {
          id,
          fingerprint: `v1-${id}`,
          fingerprintV2: `v2-${id}`,
          ...(candidates ? { fingerprintCandidates: candidates } : {}),
        },
        now,
      });

    return { id, repeats };
  }

  test("the first report's candidates are kept, and the repeat gets them in their order", async () => {
    const first: { id: string; repeats: RegisteredAppleCrash | null } =
      await reportWithCandidates(
        kscrash(),
        ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
        CRASHED_AT.getTime() + 2000,
      );

    expect(kept()[0]!.fingerprintCandidates).toEqual([
      "stored-v1",
      "stored-v2",
      "v1",
      "v2",
      "keyed",
    ]);

    // The repeat's own candidates are not the ones it is filed under.
    const second: { id: string; repeats: RegisteredAppleCrash | null } =
      await reportWithCandidates(metricKit(), ["other"]);

    expect(second.repeats).toMatchObject({
      occurrenceId: first.id,
      fingerprint: `v1-${first.id}`,
      fingerprintV2: `v2-${first.id}`,
      fingerprintCandidates: ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
    });
  });

  test("a report given no candidates keeps none, and its repeat has none to try", async () => {
    await reportWithCandidates(
      kscrash(),
      undefined,
      CRASHED_AT.getTime() + 2000,
    );

    expect(kept()[0]).not.toHaveProperty("fingerprintCandidates");

    const second: { id: string; repeats: RegisteredAppleCrash | null } =
      await reportWithCandidates(metricKit(), ["other"]);

    expect(second.repeats).not.toBeNull();
    expect(second.repeats!.fingerprintCandidates).toBeUndefined();
  });

  test("a report kept before candidates were, as the register holds it, still pairs", () => {
    const recordedAt: number = METRICKIT_PERIOD_END.getTime();
    const before: JSONObject = {
      occurrenceId: "kept-before",
      fingerprint: "v1-kept-before",
      fingerprintV2: "v2-kept-before",
      signature: kscrash() as unknown as JSONObject,
      pairedWith: null,
      recordedAt,
    };

    const entries: Array<RegisteredAppleCrash> = AppleCrashRegister.readEntries(
      JSON.stringify([before]),
      recordedAt,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.fingerprintCandidates).toBeUndefined();
  });

  test("candidates that are not a list make the entry no report", () => {
    const recordedAt: number = METRICKIT_PERIOD_END.getTime();

    expect(
      AppleCrashRegister.readEntries(
        JSON.stringify([
          {
            occurrenceId: "x",
            fingerprint: "v1-x",
            fingerprintV2: "v2-x",
            fingerprintCandidates: "v1-x",
            signature: kscrash(),
            pairedWith: null,
            recordedAt,
          },
        ]),
        recordedAt,
      ),
    ).toEqual([]);
  });
});
