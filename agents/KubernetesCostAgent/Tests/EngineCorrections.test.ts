import * as assert from "assert";
import { beforeEach, test } from "node:test";
import {
  CORRECTION_GRACE_MS,
  CORRECTION_READ_AGES_MS,
  CORRECTION_READS_PER_TICK,
  CorrectionSchedule,
  CorrectionWindow,
  KUBECOST_HOURLY_RETENTION_MS,
  collapseByIdentity,
  correctionFingerprint,
} from "../EngineCorrections";
import { KubernetesCostAllocationIngestRow } from "../Types";

/*
 * #9969: a Kubecost that reads the cloud's bill reconciles each hour's
 * prices with it about two days on. The schedule says which hours are read
 * again, and when; the fingerprint says whether a reading changed anything.
 * EngineCorrections is Config-free, so these tests load it without the
 * agent's environment.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const ENGINE: string = "http://kubecost-cost-analyzer.kubecost.svc:9090";

// A clock the tests move, back at the same moment before each.
const BASE_MS: number = Date.parse("2026-11-19T12:00:00Z");
let nowMs: number = BASE_MS;

const clock: () => number = (): number => {
  return nowMs;
};

beforeEach((): void => {
  nowMs = BASE_MS;
});

const schedule: (
  options?: ConstructorParameters<typeof CorrectionSchedule>[0],
) => CorrectionSchedule = (
  options?: ConstructorParameters<typeof CorrectionSchedule>[0],
): CorrectionSchedule => {
  return new CorrectionSchedule({ now: clock, ...(options || {}) });
};

// The hour that closed `hoursAgo` hours before the clock.
const hourEndingAgo: (hoursAgo: number) => {
  windowStartMs: number;
  windowEndMs: number;
} = (hoursAgo: number): { windowStartMs: number; windowEndMs: number } => {
  const windowEndMs: number = nowMs - hoursAgo * HOUR_MS;
  return { windowStartMs: windowEndMs - HOUR_MS, windowEndMs };
};

const startsOf: (windows: Array<CorrectionWindow>) => Array<number> = (
  windows: Array<CorrectionWindow>,
): Array<number> => {
  return windows.map((window: CorrectionWindow): number => {
    return window.windowStartMs;
  });
};

function row(
  overrides: Partial<KubernetesCostAllocationIngestRow> = {},
): KubernetesCostAllocationIngestRow {
  return {
    windowStart: "2026-11-17T10:00:00Z",
    windowEnd: "2026-11-17T11:00:00Z",
    namespace: "prod",
    controllerKind: "deployment",
    controllerName: "api",
    podName: "api-abc",
    containerName: "api",
    cpuCoreHours: 1,
    cpuCost: 0.03,
    ramCost: 0.01,
    totalCost: 0.04,
    ...overrides,
  };
}

test("reads each hour again where Kubecost's own docs place reconciliation", (): void => {
  /*
   * 36 hours: where Kubecost's UI stops hatching an hour as unreconciled.
   * 47 hours: past the 48 hours its docs give reconciliation from the usage
   * (the hour started 48 hours before), and the last hour Kubecost holds it
   * hourly by default (49 hours). 96 hours: past the 3 days each of its
   * runs goes back.
   */
  assert.deepStrictEqual(CORRECTION_READ_AGES_MS, [
    36 * HOUR_MS,
    47 * HOUR_MS,
    96 * HOUR_MS,
  ]);
  assert.strictEqual(KUBECOST_HOURLY_RETENTION_MS, 49 * HOUR_MS);
  assert.ok(
    CORRECTION_READ_AGES_MS[1]! + HOUR_MS <= KUBECOST_HOURLY_RETENTION_MS,
  );
  assert.ok(CORRECTION_READ_AGES_MS[2]! > 3 * 24 * HOUR_MS);
});

test("a shipped hour waits for its first age, then for each after it, then is forgotten", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const hour: { windowStartMs: number; windowEndMs: number } = hourEndingAgo(0);

  corrections.track({ ...hour, engineUrl: ENGINE, fingerprint: "shipped" });

  assert.strictEqual(corrections.size(), 1);
  assert.deepStrictEqual(corrections.due(), []);

  // A day and a half on: the first reading is owed.
  nowMs = hour.windowEndMs + 36 * HOUR_MS;
  const first: Array<CorrectionWindow> = corrections.due();

  assert.deepStrictEqual(startsOf(first), [hour.windowStartMs]);
  assert.strictEqual(first[0]!.fingerprint, "shipped");
  assert.strictEqual(first[0]!.engineUrl, ENGINE);

  corrections.read(first[0]!, "reconciled");

  // Nothing more until 47 hours.
  nowMs = hour.windowEndMs + 46 * HOUR_MS;
  assert.deepStrictEqual(corrections.due(), []);

  nowMs = hour.windowEndMs + 47 * HOUR_MS;
  const second: Array<CorrectionWindow> = corrections.due();
  assert.deepStrictEqual(startsOf(second), [hour.windowStartMs]);
  // What the first reading shipped is what the second compares with.
  assert.strictEqual(second[0]!.fingerprint, "reconciled");

  corrections.read(second[0]!, null);
  // A reading that shipped nothing keeps the fingerprint it had.
  assert.strictEqual(
    corrections.get(hour.windowStartMs)?.fingerprint,
    "reconciled",
  );

  nowMs = hour.windowEndMs + 96 * HOUR_MS;
  const last: Array<CorrectionWindow> = corrections.due();
  assert.deepStrictEqual(startsOf(last), [hour.windowStartMs]);

  corrections.read(last[0]!, "reconciled");
  assert.strictEqual(corrections.size(), 0);
});

test("a reading made late covers the ages that went by meanwhile", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const hour: { windowStartMs: number; windowEndMs: number } = hourEndingAgo(0);

  corrections.track({ ...hour, engineUrl: ENGINE, fingerprint: "a" });

  // The agent was busy (or the engine away) until past 47 hours.
  nowMs = hour.windowEndMs + 50 * HOUR_MS;
  const due: Array<CorrectionWindow> = corrections.due();
  corrections.read(due[0]!, "b");

  // The next one owed is the last age, not 47 hours again.
  assert.strictEqual(corrections.get(hour.windowStartMs)?.nextAge, 2);
  assert.deepStrictEqual(corrections.due(), []);
});

test("an hour shipped late skips the ages it already passed, and one past them all is never kept", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const late: { windowStartMs: number; windowEndMs: number } =
    hourEndingAgo(40);

  corrections.track({ ...late, engineUrl: ENGINE, fingerprint: "a" });

  // Its first reading came after 36 hours: the next owed is at 47.
  assert.strictEqual(corrections.get(late.windowStartMs)?.nextAge, 1);
  assert.deepStrictEqual(corrections.due(), []);

  const ancient: { windowStartMs: number; windowEndMs: number } =
    hourEndingAgo(100);
  corrections.track({ ...ancient, engineUrl: ENGINE, fingerprint: "a" });
  assert.strictEqual(corrections.get(ancient.windowStartMs), undefined);
});

test("the hours Kubecost still holds hourly come first, the nearest to dropping out first", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const finalMs: number = BASE_MS + 200 * HOUR_MS;

  // Each hour shipped as it closed, and none read again yet.
  for (const age of [60, 36, 48, 90, 37, 48.5, 45, 40]) {
    const windowEndMs: number = finalMs - age * HOUR_MS;
    nowMs = windowEndMs;
    corrections.track({
      windowStartMs: windowEndMs - HOUR_MS,
      windowEndMs,
      engineUrl: ENGINE,
      fingerprint: "shipped",
    });
  }

  nowMs = finalMs;

  const ages: Array<number> = corrections
    .due()
    .map((window: CorrectionWindow): number => {
      return (finalMs - window.windowEndMs) / HOUR_MS;
    });

  /*
   * Within Kubecost's 49 hours, the nearest to dropping out first; past
   * them (only a Kubecost that keeps hourly figures longer answers), the
   * youngest first.
   */
  assert.deepStrictEqual(ages, [48.5, 48, 45, 40, 37, 36, 60, 90]);
});

test("a tick reads a tick's worth, and the rest wait for the next", (): void => {
  const corrections: CorrectionSchedule = schedule({ readsPerTick: 3 });

  corrections.seed({
    throughMs: hourEndingAgo(36).windowEndMs,
    windowMs: HOUR_MS,
    engineUrl: ENGINE,
  });

  const first: Array<CorrectionWindow> = corrections.due();
  assert.strictEqual(first.length, 3);

  for (const window of first) {
    corrections.read(window, null);
  }

  const next: Array<CorrectionWindow> = corrections.due();
  assert.strictEqual(next.length, 3);
  // None read twice.
  for (const window of next) {
    assert.ok(!startsOf(first).includes(window.windowStartMs));
  }

  assert.ok(CORRECTION_READS_PER_TICK >= 6);
});

test("after a restart, the hours of the last 4 days are owed a reading, each at the age it last passed", (): void => {
  const corrections: CorrectionSchedule = schedule();
  // This process's first window ended 3 hours ago; the hours before are seeded.
  const throughMs: number = hourEndingAgo(3).windowStartMs;

  corrections.seed({ throughMs, windowMs: HOUR_MS, engineUrl: ENGINE });

  // From 4 hours ago back to 96 hours ago, one an hour.
  assert.strictEqual(corrections.size(), 93);

  const young: CorrectionWindow | undefined = corrections.get(
    hourEndingAgo(10).windowStartMs,
  );
  assert.strictEqual(young?.nextAge, 0);
  assert.strictEqual(young?.fingerprint, null);

  // 40 hours: its 36-hour reading may have been missed, so it is owed now.
  const missed: CorrectionWindow | undefined = corrections.get(
    hourEndingAgo(40).windowStartMs,
  );
  assert.strictEqual(missed?.nextAge, 0);

  // 50 hours: past 47, so it is owed that age's reading now.
  assert.strictEqual(
    corrections.get(hourEndingAgo(50).windowStartMs)?.nextAge,
    1,
  );

  // Everything from 36 hours on is owed now; nothing younger.
  const all: CorrectionSchedule = schedule({ readsPerTick: 1000 });
  all.seed({ throughMs, windowMs: HOUR_MS, engineUrl: ENGINE });
  const due: Array<number> = startsOf(all.due()).map(
    (startMs: number): number => {
      return (nowMs - (startMs + HOUR_MS)) / HOUR_MS;
    },
  );
  assert.strictEqual(Math.min(...due), 36);
  assert.strictEqual(Math.max(...due), 96);
  assert.strictEqual(due.length, 61);
});

test("seeding leaves the hours this process tracks as they are", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const shipped: { windowStartMs: number; windowEndMs: number } =
    hourEndingAgo(5);

  corrections.track({ ...shipped, engineUrl: ENGINE, fingerprint: "mine" });
  corrections.seed({
    throughMs: shipped.windowEndMs,
    windowMs: HOUR_MS,
    engineUrl: "http://other",
  });

  assert.strictEqual(
    corrections.get(shipped.windowStartMs)?.fingerprint,
    "mine",
  );
  assert.strictEqual(corrections.get(shipped.windowStartMs)?.engineUrl, ENGINE);
});

test("an hour whose engine cannot be read is tried until its last age and the grace, then forgotten", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const hour: { windowStartMs: number; windowEndMs: number } = hourEndingAgo(0);

  corrections.track({ ...hour, engineUrl: ENGINE, fingerprint: "a" });

  // Owed at 36 hours, and never read: it stays owed.
  nowMs = hour.windowEndMs + 60 * HOUR_MS;
  assert.strictEqual(corrections.due().length, 1);

  nowMs = hour.windowEndMs + 96 * HOUR_MS + CORRECTION_GRACE_MS;
  assert.strictEqual(corrections.due().length, 1);

  nowMs = hour.windowEndMs + 96 * HOUR_MS + CORRECTION_GRACE_MS + 1;
  assert.deepStrictEqual(corrections.due(), []);
  assert.strictEqual(corrections.size(), 0);
});

test("a reading of a window the schedule forgot changes nothing", (): void => {
  const corrections: CorrectionSchedule = schedule();
  const hour: { windowStartMs: number; windowEndMs: number } = hourEndingAgo(0);

  corrections.read(
    { ...hour, engineUrl: ENGINE, fingerprint: null, nextAge: 0 },
    "x",
  );

  assert.strictEqual(corrections.size(), 0);
});

test("one row per workload, pod and container: two of one add up their costs and hours", (): void => {
  const rows: Array<KubernetesCostAllocationIngestRow> = [
    row(),
    row({ cpuCost: 0.01, ramCost: 0.02, totalCost: 0.03, cpuCoreHours: 2 }),
    row({ podName: "api-def" }),
  ];

  const collapsed: Array<KubernetesCostAllocationIngestRow> =
    collapseByIdentity(rows);

  assert.strictEqual(collapsed.length, 2);
  assert.ok(Math.abs(collapsed[0]!.cpuCost! - 0.04) < 1e-12);
  assert.ok(Math.abs(collapsed[0]!.ramCost! - 0.03) < 1e-12);
  assert.ok(Math.abs(collapsed[0]!.totalCost! - 0.07) < 1e-12);
  assert.strictEqual(collapsed[0]!.cpuCoreHours, 3);
  assert.strictEqual(collapsed[1]!.podName, "api-def");
  // What it was handed stays as it was.
  assert.strictEqual(rows[0]!.cpuCost, 0.03);
});

test("the fingerprint is the costs per container, in any order", (): void => {
  const a: KubernetesCostAllocationIngestRow = row();
  const b: KubernetesCostAllocationIngestRow = row({
    podName: "api-def",
    totalCost: 0.5,
  });

  assert.strictEqual(
    correctionFingerprint([a, b]),
    correctionFingerprint([b, a]),
  );
  assert.match(correctionFingerprint([a]), /^[0-9a-f]{32}$/);
});

test("the fingerprint changes with any cost a reconciliation changes", (): void => {
  const base: string = correctionFingerprint([row()]);

  for (const field of [
    "cpuCost",
    "gpuCost",
    "ramCost",
    "pvCost",
    "networkCost",
    "loadBalancerCost",
    "sharedCost",
    "externalCost",
    "totalCost",
  ] as Array<keyof KubernetesCostAllocationIngestRow>) {
    assert.notStrictEqual(
      correctionFingerprint([row({ [field]: 0.123 })]),
      base,
      `${field} is in the fingerprint`,
    );
  }

  // And with a container more or less.
  assert.notStrictEqual(
    correctionFingerprint([row(), row({ containerName: "sidecar" })]),
    base,
  );
});

test("the fingerprint leaves out what a correction does not carry, and float noise", (): void => {
  const base: string = correctionFingerprint([row()]);

  assert.strictEqual(
    correctionFingerprint([
      row({
        cpuCoreHours: 9,
        ramBytesUsageMax: 123456,
        cpuEfficiency: 0.9,
        nodeName: "node-2",
        labels: { team: "x" },
      }),
    ]),
    base,
  );
  assert.strictEqual(
    correctionFingerprint([row({ cpuCost: 0.03 + 1e-13 })]),
    base,
  );
  // A missing cost reads as 0, as the server stores it.
  assert.strictEqual(
    correctionFingerprint([row({ gpuCost: undefined })]),
    correctionFingerprint([row({ gpuCost: 0 })]),
  );
});
