// The claim's file reaches the job queue, which needs Redis; nothing here queues.
jest.mock("../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import { describe, expect, jest, test } from "@jest/globals";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import { getContentScannableSql } from "../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import { PROBE_SCANNABLE_KINDS } from "../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  DATA_STORE_KINDS,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
  TELEMETRY_DATA_STORE_KINDS,
  WORKER_CLAIMED_DATA_STORE_KINDS,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DATA_STORE_CONTENT_SCAN_OVERDUE_AFTER_IN_MS,
  DataStoreContentScanFacts,
  DataStoreContentScanStop,
  DataStoreContentScanner,
  DataStoreNextContentScan,
  getDataStoreContentScanStop,
  getDataStoreContentScanner,
  getDataStoreNextContentScan,
} from "../../../Utils/DataSecurity/DataStoreContentScanSchedule";
import { ClaimDueState } from "../../../Utils/Probe/ClaimDueTime";

/*
 * Whether, and when, a data store's content is scanned next, by the rules
 * the server scans it by (OneUptime issue #8042): its Overview read
 * nextContentScanAt as a promise, and for a store nothing may scan the
 * probe's claim moves that time a quarter of an hour on, again and again.
 *
 * The probe's claim is SQL (getContentScannableSql). The last part of this
 * suite reads that SQL, condition by condition, reads each one over a
 * store in plain code, and checks that the page's rule stops a store
 * exactly when one of the conditions it can see is false - every
 * condition broken alone, and every pair. A condition added to the claim
 * fails it until the page knows why that would stop a scan.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: Date = new Date("2026-11-15T12:00:00.000Z");

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

// A PostgreSQL database a probe of the project scans, with nothing stopping it.
function probeStore(
  overrides: Partial<DataStoreContentScanFacts["store"]> = {},
): DataStoreContentScanFacts["store"] {
  return {
    kind: DataStoreKind.PostgreSql,
    provider: DataStoreProvider.SelfManaged,
    projectId: PROJECT_ID,
    isContentScanEnabled: true,
    isArchived: false,
    scanProbeId: PROBE_ID,
    probeConnectionVariable: "ORDERS_DB_URL",
    nextContentScanAt: minutesFromNow(30),
    ...overrides,
  };
}

const OWN_PROBE: NonNullable<DataStoreContentScanFacts["scanProbe"]> = {
  isGlobalProbe: false,
  projectId: PROJECT_ID,
  connectionStatus: ProbeConnectionStatus.Connected,
};

function probeFacts(
  overrides: Partial<DataStoreContentScanFacts> = {},
  store: Partial<DataStoreContentScanFacts["store"]> = {},
): DataStoreContentScanFacts {
  return {
    store: probeStore(store),
    scanProbe: OWN_PROBE,
    projectSetting: { isContentScanEnabled: true },
    ...overrides,
  };
}

// An S3 bucket OneUptime's workers scan.
function workerFacts(
  store: Partial<DataStoreContentScanFacts["store"]> = {},
  projectSetting: DataStoreContentScanFacts["projectSetting"] = null,
): DataStoreContentScanFacts {
  return {
    store: {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      projectId: PROJECT_ID,
      isContentScanEnabled: true,
      isArchived: false,
      scanProbeId: null,
      nextContentScanAt: minutesFromNow(30),
      ...store,
    },
    projectSetting: projectSetting,
  };
}

function next(
  facts: DataStoreContentScanFacts,
  now: Date = NOW,
): DataStoreNextContentScan {
  return getDataStoreNextContentScan(facts, now);
}

describe("the kinds the page reads are the server's own", () => {
  test("a probe samples the kinds its claim hands out", () => {
    expect(PROBE_SCANNABLE_KINDS).toBe(PROBE_SCANNABLE_DATA_STORE_KINDS);
    expect([...PROBE_SCANNABLE_DATA_STORE_KINDS].sort()).toEqual(
      [
        DataStoreKind.PostgreSql,
        DataStoreKind.MySql,
        DataStoreKind.SqlServer,
      ].sort(),
    );
  });

  test("every kind a probe samples is a self-managed database", () => {
    for (const kind of PROBE_SCANNABLE_DATA_STORE_KINDS) {
      expect(getDataStoreKindInfo(kind)?.provider).toBe(
        DataStoreProvider.SelfManaged,
      );
    }
  });

  test("no telemetry kind is claimed by a probe or a worker", () => {
    for (const kind of TELEMETRY_DATA_STORE_KINDS) {
      expect(PROBE_SCANNABLE_DATA_STORE_KINDS).not.toContain(kind);
      expect(WORKER_CLAIMED_DATA_STORE_KINDS).not.toContain(kind);
    }
  });
});

describe("what scans a store's content", () => {
  test("a store that names a scan probe: the probe", () => {
    expect(getDataStoreContentScanner(probeStore())).toBe(
      DataStoreContentScanner.Probe,
    );
  });

  test("a store with no scan probe: OneUptime's workers", () => {
    expect(getDataStoreContentScanner(workerFacts().store)).toBe(
      DataStoreContentScanner.Workers,
    );
  });

  test.each(
    TELEMETRY_DATA_STORE_KINDS.map((kind: DataStoreKind) => {
      return [kind];
    }),
  )(
    "a service's %s: the project's hourly telemetry scan, probe or not",
    (kind: DataStoreKind) => {
      expect(getDataStoreContentScanner({ kind })).toBe(
        DataStoreContentScanner.TelemetryScan,
      );
      expect(getDataStoreContentScanner({ kind, scanProbeId: PROBE_ID })).toBe(
        DataStoreContentScanner.TelemetryScan,
      );
    },
  );
});

describe("a store scanned from a probe", () => {
  test("due later, with the project's own connected probe: Scheduled, at that time", () => {
    expect(next(probeFacts())).toEqual({
      scanner: DataStoreContentScanner.Probe,
      due: {
        state: ClaimDueState.Scheduled,
        dueAt: minutesFromNow(30),
        stop: null,
      },
    });
  });

  test("never scanned, with no due time yet: due now (the set-aside makes it due)", () => {
    expect(next(probeFacts({}, { nextContentScanAt: null }))).toMatchObject({
      due: { state: ClaimDueState.DueNow, dueAt: null, stop: null },
    });
  });

  test("due a few minutes ago, with a probe able to take it: due now", () => {
    expect(
      next(probeFacts({}, { nextContentScanAt: minutesFromNow(-4) })),
    ).toMatchObject({ due: { state: ClaimDueState.DueNow } });
  });

  test("due longer than an hour, with a probe able to take it: overdue", () => {
    const dueAt: Date = new Date(
      NOW.getTime() - DATA_STORE_CONTENT_SCAN_OVERDUE_AFTER_IN_MS - 1,
    );

    expect(next(probeFacts({}, { nextContentScanAt: dueAt }))).toEqual({
      scanner: DataStoreContentScanner.Probe,
      due: { state: ClaimDueState.Overdue, dueAt: dueAt, stop: null },
    });
  });

  test("a probe the reader may not read: nothing is said of it", () => {
    expect(next(probeFacts({ scanProbe: undefined }))).toMatchObject({
      due: { state: ClaimDueState.Scheduled },
    });
  });

  test("no project settings read: the defaults, content scanning on", () => {
    for (const projectSetting of [null, undefined, {}]) {
      expect(next(probeFacts({ projectSetting }))).toMatchObject({
        due: { state: ClaimDueState.Scheduled },
      });
    }
  });

  test.each([
    [
      "content scanning off for the store",
      probeFacts({}, { isContentScanEnabled: false }),
      DataStoreContentScanStop.StoreScanOff,
    ],
    [
      "archived",
      probeFacts({}, { isArchived: true }),
      DataStoreContentScanStop.Archived,
    ],
    [
      "content scanning off for the project",
      probeFacts({ projectSetting: { isContentScanEnabled: false } }),
      DataStoreContentScanStop.ProjectScanOff,
    ],
    [
      "a kind a probe does not sample",
      probeFacts({}, { kind: DataStoreKind.MongoDb }),
      DataStoreContentScanStop.KindNotScannableByProbe,
    ],
    [
      "a cloud store, which a probe never samples",
      probeFacts(
        {},
        { kind: DataStoreKind.AwsS3Bucket, provider: DataStoreProvider.Aws },
      ),
      DataStoreContentScanStop.KindNotScannableByProbe,
    ],
    [
      "no connection variable",
      probeFacts({}, { probeConnectionVariable: null }),
      DataStoreContentScanStop.NoProbeConnectionVariable,
    ],
    [
      "an empty connection variable",
      probeFacts({}, { probeConnectionVariable: "" }),
      DataStoreContentScanStop.NoProbeConnectionVariable,
    ],
    [
      "a global probe, even one of this instance's",
      probeFacts({ scanProbe: { ...OWN_PROBE, isGlobalProbe: true } }),
      DataStoreContentScanStop.ProbeNotAllowed,
    ],
    [
      "another project's probe",
      probeFacts({
        scanProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID },
      }),
      DataStoreContentScanStop.ProbeNotAllowed,
    ],
    [
      "a probe the project does not have (deleted, global or another's)",
      probeFacts({ scanProbe: null }),
      DataStoreContentScanStop.ProbeNotAllowed,
    ],
    [
      "a disconnected probe",
      probeFacts({
        scanProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      }),
      DataStoreContentScanStop.ProbeDisconnected,
    ],
  ])(
    "%s: no time at all, and why",
    (
      _name: string,
      facts: DataStoreContentScanFacts,
      stop: DataStoreContentScanStop,
    ) => {
      // Whatever the set-aside last wrote: later, now, long past or never.
      for (const nextContentScanAt of [
        minutesFromNow(17),
        NOW,
        minutesFromNow(-600),
        null,
      ]) {
        expect(
          next({
            ...facts,
            store: { ...facts.store, nextContentScanAt },
          }),
        ).toEqual({
          scanner: DataStoreContentScanner.Probe,
          due: { state: ClaimDueState.Stopped, dueAt: null, stop: stop },
        });
      }
    },
  );

  test("the store's own switch is said first, before what else stops it", () => {
    expect(
      getDataStoreContentScanStop(
        probeFacts(
          { projectSetting: { isContentScanEnabled: false }, scanProbe: null },
          { isContentScanEnabled: false, isArchived: true },
        ),
      ),
    ).toBe(DataStoreContentScanStop.StoreScanOff);
  });

  test("a probe's project is compared only when the store's is known", () => {
    expect(
      getDataStoreContentScanStop(
        probeFacts(
          { scanProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID } },
          { projectId: undefined },
        ),
      ),
    ).toBeNull();
  });

  test("SQL Server, which a worker never samples, is scanned from a probe", () => {
    expect(
      getDataStoreContentScanStop(
        probeFacts({}, { kind: DataStoreKind.SqlServer }),
      ),
    ).toBeNull();
  });
});

describe("a store scanned by OneUptime's workers", () => {
  test("due later: Scheduled, at that time", () => {
    expect(next(workerFacts())).toEqual({
      scanner: DataStoreContentScanner.Workers,
      due: {
        state: ClaimDueState.Scheduled,
        dueAt: minutesFromNow(30),
        stop: null,
      },
    });
  });

  test("never scanned: due now", () => {
    expect(next(workerFacts({ nextContentScanAt: undefined }))).toMatchObject({
      due: { state: ClaimDueState.DueNow, dueAt: null },
    });
  });

  test("due longer than an hour: overdue", () => {
    expect(
      next(workerFacts({ nextContentScanAt: minutesFromNow(-61) })),
    ).toMatchObject({ due: { state: ClaimDueState.Overdue } });
  });

  test.each([
    [
      "content scanning off for the store",
      workerFacts({ isContentScanEnabled: false }),
      DataStoreContentScanStop.StoreScanOff,
    ],
    [
      "archived",
      workerFacts({ isArchived: true }),
      DataStoreContentScanStop.Archived,
    ],
    [
      "content scanning off for the project (the worker claims it, and scans nothing)",
      workerFacts({}, { isContentScanEnabled: false }),
      DataStoreContentScanStop.ProjectScanOff,
    ],
    [
      "a kind no worker claims",
      workerFacts({ kind: DataStoreKind.AwsDynamoDbTable }),
      DataStoreContentScanStop.KindNotScannable,
    ],
    [
      "SQL Server: claimed by a worker, never sampled by one",
      workerFacts({
        kind: DataStoreKind.SqlServer,
        provider: DataStoreProvider.SelfManaged,
      }),
      DataStoreContentScanStop.KindNotScannable,
    ],
    [
      "no kind at all",
      workerFacts({ kind: undefined }),
      DataStoreContentScanStop.KindNotScannable,
    ],
  ])(
    "%s: no time at all, and why",
    (
      _name: string,
      facts: DataStoreContentScanFacts,
      stop: DataStoreContentScanStop,
    ) => {
      expect(next(facts)).toEqual({
        scanner: DataStoreContentScanner.Workers,
        due: { state: ClaimDueState.Stopped, dueAt: null, stop: stop },
      });
    },
  );

  test("a worker's store has no probe to judge", () => {
    expect(
      getDataStoreContentScanStop({ ...workerFacts(), scanProbe: null }),
    ).toBeNull();
  });

  test("every kind a worker both claims and samples is scanned", () => {
    for (const kind of WORKER_CLAIMED_DATA_STORE_KINDS) {
      const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(kind);

      expect(
        getDataStoreContentScanStop(
          workerFacts({ kind, provider: info?.provider }),
        ),
      ).toBe(
        info?.contentScannable
          ? null
          : DataStoreContentScanStop.KindNotScannable,
      );
    }
  });

  test("a kind no worker claims is never scanned by one, whatever its info says", () => {
    for (const info of DATA_STORE_KINDS) {
      if (
        WORKER_CLAIMED_DATA_STORE_KINDS.includes(info.kind) ||
        TELEMETRY_DATA_STORE_KINDS.includes(info.kind)
      ) {
        continue;
      }

      expect(
        getDataStoreContentScanStop(
          workerFacts({ kind: info.kind, provider: info.provider }),
        ),
      ).toBe(DataStoreContentScanStop.KindNotScannable);
    }
  });
});

describe("a service's telemetry", () => {
  const telemetry: (
    projectSetting?: DataStoreContentScanFacts["projectSetting"],
    store?: Partial<DataStoreContentScanFacts["store"]>,
  ) => DataStoreContentScanFacts = (
    projectSetting: DataStoreContentScanFacts["projectSetting"] = null,
    store: Partial<DataStoreContentScanFacts["store"]> = {},
  ): DataStoreContentScanFacts => {
    return {
      store: {
        kind: DataStoreKind.TelemetryLogs,
        provider: DataStoreProvider.OneUptime,
        projectId: PROJECT_ID,
        isContentScanEnabled: true,
        isArchived: false,
        nextContentScanAt: minutesFromNow(-600),
        ...store,
      },
      projectSetting: projectSetting,
    };
  };

  test("scanned every hour with the project's telemetry scan: no due time of its own", () => {
    expect(next(telemetry())).toEqual({
      scanner: DataStoreContentScanner.TelemetryScan,
      stop: null,
    });
  });

  test("off when the project's telemetry scanning is off", () => {
    expect(next(telemetry({ isTelemetryScanEnabled: false }))).toEqual({
      scanner: DataStoreContentScanner.TelemetryScan,
      stop: DataStoreContentScanStop.ProjectTelemetryScanOff,
    });
  });

  test("the project's content scanning switch is not the telemetry scan's", () => {
    expect(next(telemetry({ isContentScanEnabled: false }))).toMatchObject({
      stop: null,
    });
  });

  test("the store's own switches do not stop the telemetry scan, so they are not said to", () => {
    expect(
      next(telemetry(null, { isContentScanEnabled: false, isArchived: true })),
    ).toMatchObject({ stop: null });
  });
});

/*
 * THE PROBE CLAIM'S CONDITIONS, READ ONE BY ONE.
 *
 * Each condition getContentScannableSql joins with AND, and how a store's
 * page reads it: "row" conditions over what the page knows of the store,
 * its probe and its project's settings, and "not shown" for the ones about
 * a store or project nobody's page shows (deleted, or a project nobody may
 * use).
 */
interface ClaimRow {
  store: DataStoreContentScanFacts["store"];
  probe: { isGlobalProbe: boolean; projectId: string; isDeleted: boolean };
  setting: { isContentScanEnabled: boolean } | null;
}

type ClauseReading =
  | {
      kind: "row";
      holds: (row: ClaimRow) => boolean;
      breaks: (row: ClaimRow) => ClaimRow;
    }
  | { kind: "not shown" };

const CLAUSES: Record<string, ClauseReading> = {
  'ds."deletedAt" IS NULL': { kind: "not shown" },
  'ds."isContentScanEnabled" = true': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.store.isContentScanEnabled === true;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, store: { ...row.store, isContentScanEnabled: false } };
    },
  },
  'ds."isArchived" = false': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.store.isArchived === false;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, store: { ...row.store, isArchived: true } };
    },
  },
  'ds."provider" = $2': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      // $2 is the self-managed provider (claimDueDataStoresForProbe).
      return row.store.provider === DataStoreProvider.SelfManaged;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return {
        ...row,
        store: { ...row.store, provider: DataStoreProvider.Aws },
      };
    },
  },
  'ds."kind" = ANY($3::text[])': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      // $3 is PROBE_SCANNABLE_KINDS.
      return PROBE_SCANNABLE_KINDS.includes(row.store.kind as DataStoreKind);
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, store: { ...row.store, kind: DataStoreKind.Redis } };
    },
  },
  'ds."probeConnectionVariable" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return (
        row.store.probeConnectionVariable !== null &&
        row.store.probeConnectionVariable !== undefined
      );
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return {
        ...row,
        store: { ...row.store, probeConnectionVariable: null },
      };
    },
  },
  "ds.\"probeConnectionVariable\" <> ''": {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      // NULL <> '' is NULL, which the condition above already refuses.
      return row.store.probeConnectionVariable !== "";
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, store: { ...row.store, probeConnectionVariable: "" } };
    },
  },
  'COALESCE(s."isContentScanEnabled", true) = true': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.setting?.isContentScanEnabled !== false;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, setting: { isContentScanEnabled: false } };
    },
  },
  'pr."isGlobalProbe" = false': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.probe.isGlobalProbe === false;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, probe: { ...row.probe, isGlobalProbe: true } };
    },
  },
  'pr."projectId" = ds."projectId"': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.probe.projectId === String(row.store.projectId);
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, probe: { ...row.probe, projectId: OTHER_PROJECT_ID } };
    },
  },
  'pr."deletedAt" IS NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return !row.probe.isDeleted;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, probe: { ...row.probe, isDeleted: true } };
    },
  },
  'p."deletedAt" IS NULL': { kind: "not shown" },
  'p."isBlocked" = false': { kind: "not shown" },
  'p."isSampleProject" = false': { kind: "not shown" },
  '(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY($5::text[]))':
    { kind: "not shown" },
  '(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY($5::text[]))':
    { kind: "not shown" },
};

const CLAIM_CLAUSES: Array<string> = getContentScannableSql({
  providerParameter: "$2",
  kindsParameter: "$3",
  statusesParameter: "$5",
})
  .split(/\n\s*AND /)
  .map((clause: string): string => {
    return clause.trim();
  });

const ROW_CLAUSES: Array<string> = Object.keys(CLAUSES).filter(
  (clause: string): boolean => {
    return CLAUSES[clause]!.kind === "row";
  },
);

const CLAIMABLE_ROW: ClaimRow = {
  store: probeStore(),
  probe: { isGlobalProbe: false, projectId: PROJECT_ID, isDeleted: false },
  setting: { isContentScanEnabled: true },
};

// What the page knows of a row: the probe as a reader of the project's probes reads it.
function pageFacts(row: ClaimRow): DataStoreContentScanFacts {
  return {
    store: row.store,
    // A deleted probe, a global one or another project's is not one of the project's.
    scanProbe:
      row.probe.isDeleted ||
      row.probe.isGlobalProbe ||
      row.probe.projectId !== String(row.store.projectId)
        ? null
        : {
            isGlobalProbe: row.probe.isGlobalProbe,
            projectId: row.probe.projectId,
            connectionStatus: ProbeConnectionStatus.Connected,
          },
    projectSetting: row.setting,
  };
}

// The probe's read of the probe row as it is, when its read finds it (a relation read).
function relationFacts(row: ClaimRow): DataStoreContentScanFacts {
  return {
    store: row.store,
    scanProbe: row.probe.isDeleted
      ? null
      : {
          isGlobalProbe: row.probe.isGlobalProbe,
          projectId: row.probe.projectId,
          connectionStatus: ProbeConnectionStatus.Connected,
        },
    projectSetting: row.setting,
  };
}

function isClaimable(row: ClaimRow): boolean {
  return ROW_CLAUSES.every((clause: string): boolean => {
    const reading: ClauseReading = CLAUSES[clause]!;
    return reading.kind === "row" && reading.holds(row);
  });
}

describe("the page's rule is the probe claim's (getContentScannableSql)", () => {
  test("every condition of the claim is one the page reads, or about a store nobody's page shows", () => {
    expect(CLAIM_CLAUSES.length).toBeGreaterThan(10);
    expect([...CLAIM_CLAUSES].sort()).toEqual(Object.keys(CLAUSES).sort());
  });

  test("the store the suite starts from is one the claim hands out, and the page agrees", () => {
    expect(isClaimable(CLAIMABLE_ROW)).toBe(true);
    expect(getDataStoreContentScanStop(pageFacts(CLAIMABLE_ROW))).toBeNull();
    expect(
      getDataStoreContentScanStop(relationFacts(CLAIMABLE_ROW)),
    ).toBeNull();
  });

  test.each(
    ROW_CLAUSES.map((clause: string) => {
      return [clause];
    }),
  )(
    "with %s false, the claim refuses the store, and the page says why",
    (clause: string) => {
      const reading: ClauseReading = CLAUSES[clause]!;

      if (reading.kind !== "row") {
        throw new Error(`${clause} is not read over a row.`);
      }

      const row: ClaimRow = reading.breaks(CLAIMABLE_ROW);

      expect(reading.holds(row)).toBe(false);
      expect(isClaimable(row)).toBe(false);
      expect(getDataStoreContentScanStop(pageFacts(row))).not.toBeNull();
      expect(getDataStoreContentScanStop(relationFacts(row))).not.toBeNull();
      expect(next(pageFacts(row), NOW)).toMatchObject({
        due: { state: ClaimDueState.Stopped, dueAt: null },
      });
    },
  );

  test("with any two conditions false, the claim and the page agree", () => {
    for (const first of ROW_CLAUSES) {
      for (const second of ROW_CLAUSES) {
        const readingOfFirst: ClauseReading = CLAUSES[first]!;
        const readingOfSecond: ClauseReading = CLAUSES[second]!;

        if (readingOfFirst.kind !== "row" || readingOfSecond.kind !== "row") {
          continue;
        }

        const row: ClaimRow = readingOfSecond.breaks(
          readingOfFirst.breaks(CLAIMABLE_ROW),
        );

        expect(getDataStoreContentScanStop(pageFacts(row)) === null).toBe(
          isClaimable(row),
        );
        expect(getDataStoreContentScanStop(relationFacts(row)) === null).toBe(
          isClaimable(row),
        );
      }
    }
  });

  test("each probe-scannable kind, and every other kind, as the claim reads it", () => {
    for (const info of DATA_STORE_KINDS) {
      if (TELEMETRY_DATA_STORE_KINDS.includes(info.kind)) {
        continue;
      }

      const row: ClaimRow = {
        ...CLAIMABLE_ROW,
        store: {
          ...CLAIMABLE_ROW.store,
          kind: info.kind,
          provider: info.provider,
        },
      };

      expect(getDataStoreContentScanStop(pageFacts(row)) === null).toBe(
        isClaimable(row),
      );
    }
  });
});
