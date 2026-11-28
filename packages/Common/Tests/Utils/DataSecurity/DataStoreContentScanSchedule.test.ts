// The claim's file reaches the job queue, which needs Redis; nothing here queues.
jest.mock("../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import { describe, expect, jest, test } from "@jest/globals";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import {
  DATA_STORE_SCANNABLE_BY_PROBE_STATEMENT,
  getContentScannableSql,
  getServedProjectSql,
} from "../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import { PROBE_SCANNABLE_KINDS } from "../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  DATA_STORE_SCANNABLE_BY_WORKERS_STATEMENT,
  getWorkerContentScannableSql,
} from "../../../Server/Utils/DataSecurity/DataSecurityWorkerClaim";
import {
  getTelemetryProjectScannableSql,
  getTelemetryStoreScannableSql,
} from "../../../Server/Utils/DataSecurity/DataSecurityTelemetryScanRule";
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
  TELEMETRY_SCAN_NOW_REFUSAL_SENTENCE,
  getDataStoreContentScanStop,
  getDataStoreContentScanStopSentence,
  getDataStoreContentScanner,
  getDataStoreNextContentScan,
  getDataStoreScanNowRefusal,
  getDataStoreScanNowRefusalSentence,
} from "../../../Utils/DataSecurity/DataStoreContentScanSchedule";
import { ClaimDueState } from "../../../Utils/Probe/ClaimDueTime";

/*
 * Whether, and when, a data store's content is scanned next, by the rules
 * the server scans it by (OneUptime issue #8042): its Overview read
 * nextContentScanAt as a promise, and for a store nothing may scan the
 * probe's claim moves that time a quarter of an hour on, again and again.
 *
 * Each way a store's content is read is SQL: the probe's claim
 * (getContentScannableSql), the workers' claim and their scan
 * (getWorkerContentScannableSql, #8325), and the hourly telemetry scan's
 * rule (getTelemetryProjectScannableSql and getTelemetryStoreScannableSql,
 * #8323). The last parts of this suite read each one, condition by
 * condition, read each condition over a store in plain code, and check
 * that the page's rule stops a store exactly when one of the conditions it
 * can see is false - every condition broken alone, and every pair. A
 * condition added to a rule fails it until the page knows why that would
 * stop a scan. And every one of them reads the store's switch, the
 * project's switch and whether the project is served, before any content.
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
        // Read over their HTTP API (#11140).
        DataStoreKind.Elasticsearch,
        DataStoreKind.OpenSearch,
      ].sort(),
    );
  });

  test("every kind a probe samples is a store you run yourself", () => {
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
    /*
     * A kind nothing samples, a probe no more than a worker: said as such,
     * never "scan it from OneUptime's workers", which do not either (#11140).
     */
    [
      "a kind nothing samples",
      probeFacts({}, { kind: DataStoreKind.MongoDb }),
      DataStoreContentScanStop.KindNotScannable,
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

  test("SQL Server is scanned from a probe", () => {
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
      "content scanning off for the project (the workers' claim refuses it)",
      workerFacts({}, { isContentScanEnabled: false }),
      DataStoreContentScanStop.ProjectScanOff,
    ],
    [
      "a kind no worker claims",
      workerFacts({ kind: DataStoreKind.AwsDynamoDbTable }),
      DataStoreContentScanStop.KindNotScannable,
    ],
    [
      "a database kind no worker samples",
      workerFacts({
        kind: DataStoreKind.MongoDb,
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

  test("SQL Server with a connection string: scanned by a worker, as PostgreSQL and MySQL are (#8322)", () => {
    expect(
      next(
        workerFacts({
          kind: DataStoreKind.SqlServer,
          provider: DataStoreProvider.SelfManaged,
        }),
      ),
    ).toEqual({
      scanner: DataStoreContentScanner.Workers,
      due: {
        state: ClaimDueState.Scheduled,
        dueAt: minutesFromNow(30),
        stop: null,
      },
    });
  });

  test("the kinds a worker claims are exactly the kinds it samples, outside telemetry", () => {
    const sampled: Array<DataStoreKind> = DATA_STORE_KINDS.filter(
      (info: DataStoreKindInfo): boolean => {
        return (
          info.contentScannable &&
          !TELEMETRY_DATA_STORE_KINDS.includes(info.kind)
        );
      },
    ).map((info: DataStoreKindInfo): DataStoreKind => {
      return info.kind;
    });

    // A kind claimed but not sampled was claimed every hour and skipped.
    expect([...WORKER_CLAIMED_DATA_STORE_KINDS].sort()).toEqual(
      [...sampled].sort(),
    );
    expect(WORKER_CLAIMED_DATA_STORE_KINDS).toContain(DataStoreKind.SqlServer);
    expect(
      getDataStoreKindInfo(DataStoreKind.SqlServer)?.contentScannable,
    ).toBe(true);
  });

  test("every kind a probe samples, a worker samples too, so one store reads the same either way", () => {
    for (const kind of PROBE_SCANNABLE_DATA_STORE_KINDS) {
      expect(WORKER_CLAIMED_DATA_STORE_KINDS).toContain(kind);
      expect(getDataStoreKindInfo(kind)?.contentScannable).toBe(true);
    }
  });

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

  test("off when the store's own Scan Content switch is off: the scan leaves its service out (#8323)", () => {
    expect(next(telemetry(null, { isContentScanEnabled: false }))).toEqual({
      scanner: DataStoreContentScanner.TelemetryScan,
      stop: DataStoreContentScanStop.StoreScanOff,
    });
  });

  test("the store's own switch is said first, before the project's", () => {
    expect(
      next(
        telemetry(
          { isTelemetryScanEnabled: false },
          { isContentScanEnabled: false },
        ),
      ),
    ).toMatchObject({ stop: DataStoreContentScanStop.StoreScanOff });
  });

  test.each(
    TELEMETRY_DATA_STORE_KINDS.map((kind: DataStoreKind) => {
      return [kind];
    }),
  )(
    "%s: its switch stops it, of every telemetry kind",
    (kind: DataStoreKind) => {
      expect(
        next(telemetry(null, { kind, isContentScanEnabled: false })),
      ).toMatchObject({ stop: DataStoreContentScanStop.StoreScanOff });
      expect(next(telemetry(null, { kind }))).toMatchObject({ stop: null });
    },
  );

  test("archiving a telemetry store does not stop the scan, which finds its service again", () => {
    expect(next(telemetry(null, { isArchived: true }))).toMatchObject({
      stop: null,
    });
  });

  test("a switch the reader did not read is not said to be off", () => {
    expect(
      next(telemetry(null, { isContentScanEnabled: undefined })),
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

/*
 * A rule's conditions as written: the SQL split on its ANDs. A condition
 * of the served project holds an OR inside its parentheses, never an AND.
 */
function clausesOf(sql: string): Array<string> {
  return sql.split(/\n\s*AND /).map((clause: string): string => {
    return clause.trim();
  });
}

type RowReading<Row> =
  | {
      kind: "row";
      holds: (row: Row) => boolean;
      breaks: (row: Row) => Row;
    }
  | { kind: "not shown" };

// The served project's conditions: about a project nobody's page shows.
function servedProjectNotShown<Row>(
  statusesParameter: string,
): Record<string, RowReading<Row>> {
  const readings: Record<string, RowReading<Row>> = {};

  for (const clause of getServedProjectSql(statusesParameter)) {
    readings[clause] = { kind: "not shown" };
  }

  return readings;
}

function rowClausesOf<Row>(
  readings: Record<string, RowReading<Row>>,
): Array<string> {
  return Object.keys(readings).filter((clause: string): boolean => {
    return readings[clause]!.kind === "row";
  });
}

function holdsEvery<Row>(
  readings: Record<string, RowReading<Row>>,
  row: Row,
): boolean {
  return rowClausesOf(readings).every((clause: string): boolean => {
    const reading: RowReading<Row> = readings[clause]!;
    return reading.kind === "row" && reading.holds(row);
  });
}

function breakClause<Row>(
  readings: Record<string, RowReading<Row>>,
  clause: string,
  row: Row,
): Row {
  const reading: RowReading<Row> = readings[clause]!;

  if (reading.kind !== "row") {
    throw new Error(`${clause} is not read over a row.`);
  }

  return reading.breaks(row);
}

/*
 * THE WORKERS' CLAIM'S CONDITIONS, READ ONE BY ONE (OneUptime issue #8325).
 *
 * getWorkerContentScannableSql is what the workers' claim hands a store out
 * by and what their scan reads again before it samples one. It read
 * neither the project's content switch nor the project: a suspended
 * project's stores were sampled, and a project that turned content
 * scanning off had every store claimed and dropped every hour.
 */
interface WorkerClaimRow {
  store: DataStoreContentScanFacts["store"];
  setting: { isContentScanEnabled: boolean } | null;
}

const WORKER_CLAUSES: Record<string, RowReading<WorkerClaimRow>> = {
  'ds."deletedAt" IS NULL': { kind: "not shown" },
  'ds."isContentScanEnabled" = true': {
    kind: "row",
    holds: (row: WorkerClaimRow): boolean => {
      return row.store.isContentScanEnabled === true;
    },
    breaks: (row: WorkerClaimRow): WorkerClaimRow => {
      return { ...row, store: { ...row.store, isContentScanEnabled: false } };
    },
  },
  'ds."isArchived" = false': {
    kind: "row",
    holds: (row: WorkerClaimRow): boolean => {
      return row.store.isArchived === false;
    },
    breaks: (row: WorkerClaimRow): WorkerClaimRow => {
      return { ...row, store: { ...row.store, isArchived: true } };
    },
  },
  'ds."kind" = ANY($2::text[])': {
    kind: "row",
    holds: (row: WorkerClaimRow): boolean => {
      // $2 is WORKER_CLAIMED_DATA_STORE_KINDS (claimDueDataStoresForWorkers).
      return WORKER_CLAIMED_DATA_STORE_KINDS.includes(
        row.store.kind as DataStoreKind,
      );
    },
    breaks: (row: WorkerClaimRow): WorkerClaimRow => {
      return {
        ...row,
        store: { ...row.store, kind: DataStoreKind.AwsDynamoDbTable },
      };
    },
  },
  'COALESCE(s."isContentScanEnabled", true) = true': {
    kind: "row",
    holds: (row: WorkerClaimRow): boolean => {
      return row.setting?.isContentScanEnabled !== false;
    },
    breaks: (row: WorkerClaimRow): WorkerClaimRow => {
      return { ...row, setting: { isContentScanEnabled: false } };
    },
  },
  ...servedProjectNotShown<WorkerClaimRow>("$3"),
};

const WORKER_CLAIM_CLAUSES: Array<string> = clausesOf(
  getWorkerContentScannableSql({
    kindsParameter: "$2",
    statusesParameter: "$3",
  }),
);

const WORKER_ROW_CLAUSES: Array<string> = rowClausesOf(WORKER_CLAUSES);

const WORKER_CLAIMABLE_ROW: WorkerClaimRow = {
  store: workerFacts().store,
  setting: { isContentScanEnabled: true },
};

function workerPageFacts(row: WorkerClaimRow): DataStoreContentScanFacts {
  return { store: row.store, projectSetting: row.setting };
}

describe("the page's rule is the workers' claim's (getWorkerContentScannableSql)", () => {
  test("every condition of the claim is one the page reads, or about a store or project nobody's page shows", () => {
    expect(WORKER_CLAIM_CLAUSES.length).toBeGreaterThan(8);
    expect([...WORKER_CLAIM_CLAUSES].sort()).toEqual(
      Object.keys(WORKER_CLAUSES).sort(),
    );
  });

  test("the store the suite starts from is one the claim hands out, and the page agrees", () => {
    expect(holdsEvery(WORKER_CLAUSES, WORKER_CLAIMABLE_ROW)).toBe(true);
    expect(
      getDataStoreContentScanStop(workerPageFacts(WORKER_CLAIMABLE_ROW)),
    ).toBeNull();
    expect(
      getDataStoreContentScanStop({
        ...workerPageFacts(WORKER_CLAIMABLE_ROW),
        projectSetting: null,
      }),
    ).toBeNull();
  });

  test.each(
    WORKER_ROW_CLAUSES.map((clause: string) => {
      return [clause];
    }),
  )(
    "with %s false, the claim refuses the store, and the page says why",
    (clause: string) => {
      const row: WorkerClaimRow = breakClause(
        WORKER_CLAUSES,
        clause,
        WORKER_CLAIMABLE_ROW,
      );

      expect(holdsEvery(WORKER_CLAUSES, row)).toBe(false);
      expect(getDataStoreContentScanStop(workerPageFacts(row))).not.toBeNull();
      expect(next(workerPageFacts(row), NOW)).toMatchObject({
        scanner: DataStoreContentScanner.Workers,
        due: { state: ClaimDueState.Stopped, dueAt: null },
      });
    },
  );

  test("with any two conditions false, the claim and the page agree", () => {
    for (const first of WORKER_ROW_CLAUSES) {
      for (const second of WORKER_ROW_CLAUSES) {
        const row: WorkerClaimRow = breakClause(
          WORKER_CLAUSES,
          second,
          breakClause(WORKER_CLAUSES, first, WORKER_CLAIMABLE_ROW),
        );

        expect(getDataStoreContentScanStop(workerPageFacts(row)) === null).toBe(
          holdsEvery(WORKER_CLAUSES, row),
        );
      }
    }
  });

  test("every kind, as the claim reads it", () => {
    for (const info of DATA_STORE_KINDS) {
      if (TELEMETRY_DATA_STORE_KINDS.includes(info.kind)) {
        continue;
      }

      const row: WorkerClaimRow = {
        ...WORKER_CLAIMABLE_ROW,
        store: {
          ...WORKER_CLAIMABLE_ROW.store,
          kind: info.kind,
          provider: info.provider,
        },
      };

      expect(getDataStoreContentScanStop(workerPageFacts(row)) === null).toBe(
        holdsEvery(WORKER_CLAUSES, row),
      );
    }
  });

  test("each switch off, and the normal case, as the claim and the page read them", () => {
    const cases: Array<[WorkerClaimRow, DataStoreContentScanStop | null]> = [
      [WORKER_CLAIMABLE_ROW, null],
      [
        {
          ...WORKER_CLAIMABLE_ROW,
          store: { ...WORKER_CLAIMABLE_ROW.store, isContentScanEnabled: false },
        },
        DataStoreContentScanStop.StoreScanOff,
      ],
      [
        { ...WORKER_CLAIMABLE_ROW, setting: { isContentScanEnabled: false } },
        DataStoreContentScanStop.ProjectScanOff,
      ],
    ];

    for (const [row, stop] of cases) {
      expect(holdsEvery(WORKER_CLAUSES, row)).toBe(stop === null);
      expect(getDataStoreContentScanStop(workerPageFacts(row))).toBe(stop);
    }
  });
});

/*
 * THE TELEMETRY SCAN'S CONDITIONS, READ ONE BY ONE (OneUptime issue #8323).
 *
 * The hourly telemetry scan has no claim: it reads a project when
 * getTelemetryProjectScannableSql holds for it, and of that project every
 * service but those whose store fails getTelemetryStoreScannableSql. A
 * store's own Scan Content switch did nothing, and a suspended project's
 * telemetry was read like any other.
 */
interface TelemetryScanRow {
  store: DataStoreContentScanFacts["store"];
  setting: {
    isContentScanEnabled?: boolean;
    isTelemetryScanEnabled?: boolean;
  } | null;
}

const TELEMETRY_PROJECT_CLAUSES: Record<
  string,
  RowReading<TelemetryScanRow>
> = {
  'COALESCE(s."isTelemetryScanEnabled", true) = true': {
    kind: "row",
    holds: (row: TelemetryScanRow): boolean => {
      return row.setting?.isTelemetryScanEnabled !== false;
    },
    breaks: (row: TelemetryScanRow): TelemetryScanRow => {
      return {
        ...row,
        setting: { ...row.setting, isTelemetryScanEnabled: false },
      };
    },
  },
  ...servedProjectNotShown<TelemetryScanRow>("$2"),
};

const TELEMETRY_STORE_CLAUSES: Record<string, RowReading<TelemetryScanRow>> = {
  'ds."isContentScanEnabled" = true': {
    kind: "row",
    holds: (row: TelemetryScanRow): boolean => {
      return row.store.isContentScanEnabled === true;
    },
    breaks: (row: TelemetryScanRow): TelemetryScanRow => {
      return { ...row, store: { ...row.store, isContentScanEnabled: false } };
    },
  },
};

// Both, as the scan reads them: the project first, then each store.
const TELEMETRY_CLAUSES: Record<string, RowReading<TelemetryScanRow>> = {
  ...TELEMETRY_PROJECT_CLAUSES,
  ...TELEMETRY_STORE_CLAUSES,
};

const TELEMETRY_ROW_CLAUSES: Array<string> = rowClausesOf(TELEMETRY_CLAUSES);

const TELEMETRY_READABLE_ROW: TelemetryScanRow = {
  store: {
    kind: DataStoreKind.TelemetryLogs,
    provider: DataStoreProvider.OneUptime,
    projectId: PROJECT_ID,
    isContentScanEnabled: true,
    isArchived: false,
    nextContentScanAt: minutesFromNow(-600),
  },
  setting: { isContentScanEnabled: true, isTelemetryScanEnabled: true },
};

function telemetryPageFacts(row: TelemetryScanRow): DataStoreContentScanFacts {
  return { store: row.store, projectSetting: row.setting };
}

describe("the page's rule is the telemetry scan's (getTelemetryProjectScannableSql, getTelemetryStoreScannableSql)", () => {
  test("every condition the scan reads is one the page reads, or about a project nobody's page shows", () => {
    expect(
      [
        ...clausesOf(
          getTelemetryProjectScannableSql({ statusesParameter: "$2" }),
        ),
      ].sort(),
    ).toEqual(Object.keys(TELEMETRY_PROJECT_CLAUSES).sort());
    expect([...clausesOf(getTelemetryStoreScannableSql())].sort()).toEqual(
      Object.keys(TELEMETRY_STORE_CLAUSES).sort(),
    );
  });

  test("the project's Scan Content switch is the stores' claims', never the telemetry scan's", () => {
    for (const clause of [
      ...clausesOf(
        getTelemetryProjectScannableSql({ statusesParameter: "$2" }),
      ),
      ...clausesOf(getTelemetryStoreScannableSql()),
    ]) {
      // The settings' column (s.), not the store's own (ds.).
      expect(clause).not.toMatch(/(^|[^d])s\."isContentScanEnabled"/);
    }

    const row: TelemetryScanRow = {
      ...TELEMETRY_READABLE_ROW,
      setting: { isContentScanEnabled: false, isTelemetryScanEnabled: true },
    };

    expect(holdsEvery(TELEMETRY_CLAUSES, row)).toBe(true);
    expect(getDataStoreContentScanStop(telemetryPageFacts(row))).toBeNull();
  });

  test("archived is no condition: the scan finds the service again", () => {
    for (const clause of Object.keys(TELEMETRY_CLAUSES)) {
      expect(clause).not.toContain("isArchived");
    }
  });

  test("the store the suite starts from is one the scan reads, and the page agrees", () => {
    expect(holdsEvery(TELEMETRY_CLAUSES, TELEMETRY_READABLE_ROW)).toBe(true);
    expect(
      getDataStoreContentScanStop(telemetryPageFacts(TELEMETRY_READABLE_ROW)),
    ).toBeNull();
  });

  test.each(
    TELEMETRY_ROW_CLAUSES.map((clause: string) => {
      return [clause];
    }),
  )(
    "with %s false, the scan leaves the store out, and the page says why",
    (clause: string) => {
      const row: TelemetryScanRow = breakClause(
        TELEMETRY_CLAUSES,
        clause,
        TELEMETRY_READABLE_ROW,
      );

      expect(holdsEvery(TELEMETRY_CLAUSES, row)).toBe(false);
      expect(next(telemetryPageFacts(row), NOW)).toEqual({
        scanner: DataStoreContentScanner.TelemetryScan,
        stop: expect.any(String),
      });
    },
  );

  test("with both conditions false, the scan and the page agree, the store's switch said first", () => {
    for (const first of TELEMETRY_ROW_CLAUSES) {
      for (const second of TELEMETRY_ROW_CLAUSES) {
        const row: TelemetryScanRow = breakClause(
          TELEMETRY_CLAUSES,
          second,
          breakClause(TELEMETRY_CLAUSES, first, TELEMETRY_READABLE_ROW),
        );

        expect(
          getDataStoreContentScanStop(telemetryPageFacts(row)) === null,
        ).toBe(holdsEvery(TELEMETRY_CLAUSES, row));
      }
    }

    expect(
      getDataStoreContentScanStop(
        telemetryPageFacts({
          store: {
            ...TELEMETRY_READABLE_ROW.store,
            isContentScanEnabled: false,
          },
          setting: { isTelemetryScanEnabled: false },
        }),
      ),
    ).toBe(DataStoreContentScanStop.StoreScanOff);
  });

  test("every telemetry kind, as the scan reads it", () => {
    for (const kind of TELEMETRY_DATA_STORE_KINDS) {
      for (const isContentScanEnabled of [true, false]) {
        const row: TelemetryScanRow = {
          ...TELEMETRY_READABLE_ROW,
          store: {
            ...TELEMETRY_READABLE_ROW.store,
            kind,
            isContentScanEnabled,
          },
        };

        expect(
          getDataStoreContentScanStop(telemetryPageFacts(row)) === null,
        ).toBe(holdsEvery(TELEMETRY_CLAUSES, row));
      }
    }
  });
});

/*
 * EVERY WAY A STORE'S CONTENT IS READ ASKS THREE THINGS FIRST: the store's
 * own switch, the project's switch, and whether the project is served
 * (getServedProjectSql). Content read after a person turned scanning off,
 * or of a project that is suspended, is a privacy bug (#8323, #8325).
 */
describe("every content-scan path reads the store's switch, the project's switch and whether the project is served", () => {
  const PATHS: Array<{
    name: string;
    clauses: Array<string>;
    storeSwitch: string;
    projectSwitch: string;
    statusesParameter: string;
  }> = [
    {
      name: "the probe's claim",
      clauses: CLAIM_CLAUSES,
      storeSwitch: 'ds."isContentScanEnabled" = true',
      projectSwitch: 'COALESCE(s."isContentScanEnabled", true) = true',
      statusesParameter: "$5",
    },
    {
      name: "the workers' claim and scan",
      clauses: WORKER_CLAIM_CLAUSES,
      storeSwitch: 'ds."isContentScanEnabled" = true',
      projectSwitch: 'COALESCE(s."isContentScanEnabled", true) = true',
      statusesParameter: "$3",
    },
    {
      name: "the hourly telemetry scan",
      clauses: [
        ...clausesOf(
          getTelemetryProjectScannableSql({ statusesParameter: "$2" }),
        ),
        ...clausesOf(getTelemetryStoreScannableSql()),
      ],
      storeSwitch: 'ds."isContentScanEnabled" = true',
      projectSwitch: 'COALESCE(s."isTelemetryScanEnabled", true) = true',
      statusesParameter: "$2",
    },
  ];

  test.each(PATHS)("$name", (path: (typeof PATHS)[number]) => {
    expect(path.clauses).toContain(path.storeSwitch);
    expect(path.clauses).toContain(path.projectSwitch);
    expect(path.clauses).toEqual(
      expect.arrayContaining(getServedProjectSql(path.statusesParameter)),
    );
  });

  /*
   * And the question asked again before anything is written - a probe's
   * result (#8391), a worker's scan - is the claim's own rule, so the page's
   * rule, held to the claims above, is the rule a scan is kept by too.
   */
  test("what a scan writes is kept by the same rule its claim hands the store out by", () => {
    expect(DATA_STORE_SCANNABLE_BY_PROBE_STATEMENT).toContain(
      getContentScannableSql({
        providerParameter: "$3",
        kindsParameter: "$4",
        statusesParameter: "$5",
      }),
    );
    expect(DATA_STORE_SCANNABLE_BY_WORKERS_STATEMENT).toContain(
      getWorkerContentScannableSql({
        kindsParameter: "$3",
        statusesParameter: "$4",
      }),
    );
  });

  test("a served project is not deleted, not blocked, not a sample, and paid", () => {
    expect(getServedProjectSql("$9")).toEqual([
      'p."deletedAt" IS NULL',
      'p."isBlocked" = false',
      '(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY($9::text[]))',
      '(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY($9::text[]))',
    ]);
  });
});

/*
 * SCAN NOW, BY THE SAME RULES (#8325): it made any store due and queued a
 * scan, and answered success, for a store whose project scans no content
 * or one no claim will hand out.
 */
describe("Scan Now's refusal", () => {
  test("a store something will scan: Scan Now scans", () => {
    expect(getDataStoreScanNowRefusal(probeFacts())).toBeNull();
    expect(getDataStoreScanNowRefusal(workerFacts())).toBeNull();
    expect(
      getDataStoreScanNowRefusal(
        workerFacts({
          kind: DataStoreKind.SqlServer,
          provider: DataStoreProvider.SelfManaged,
        }),
      ),
    ).toBeNull();
    expect(getDataStoreScanNowRefusalSentence(workerFacts())).toBeNull();
  });

  test.each([
    [
      "the store's switch off, from a worker",
      workerFacts({ isContentScanEnabled: false }),
      DataStoreContentScanStop.StoreScanOff,
    ],
    [
      "the project's switch off, from a worker",
      workerFacts({}, { isContentScanEnabled: false }),
      DataStoreContentScanStop.ProjectScanOff,
    ],
    [
      "archived, from a worker: no claim hands one out",
      workerFacts({ isArchived: true }),
      DataStoreContentScanStop.Archived,
    ],
    [
      "the store's switch off, from a probe",
      probeFacts({}, { isContentScanEnabled: false }),
      DataStoreContentScanStop.StoreScanOff,
    ],
    [
      "the project's switch off, from a probe",
      probeFacts({ projectSetting: { isContentScanEnabled: false } }),
      DataStoreContentScanStop.ProjectScanOff,
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
    "%s: refused, with why",
    (
      _name: string,
      facts: DataStoreContentScanFacts,
      stop: DataStoreContentScanStop,
    ) => {
      expect(getDataStoreScanNowRefusal(facts)).toEqual({ stop: stop });
      expect(
        getDataStoreScanNowRefusalSentence(facts, "Datacenter probe"),
      ).toBe(getDataStoreContentScanStopSentence(stop, "Datacenter probe"));
    },
  );

  test("a service's telemetry: refused, the hourly scan reads it, or why that does not either", () => {
    const telemetry: DataStoreContentScanFacts = {
      store: { ...TELEMETRY_READABLE_ROW.store },
      projectSetting: null,
    };

    expect(getDataStoreScanNowRefusal(telemetry)).toEqual({ stop: null });
    expect(getDataStoreScanNowRefusalSentence(telemetry)).toBe(
      TELEMETRY_SCAN_NOW_REFUSAL_SENTENCE,
    );
    expect(
      getDataStoreScanNowRefusal({
        ...telemetry,
        store: { ...telemetry.store, isContentScanEnabled: false },
      }),
    ).toEqual({ stop: DataStoreContentScanStop.StoreScanOff });
    expect(
      getDataStoreScanNowRefusal({
        ...telemetry,
        projectSetting: { isTelemetryScanEnabled: false },
      }),
    ).toEqual({ stop: DataStoreContentScanStop.ProjectTelemetryScanOff });
  });

  test("every reason is a sentence, and a disconnected probe is named", () => {
    for (const stop of Object.values(DataStoreContentScanStop)) {
      expect(
        getDataStoreContentScanStopSentence(stop, "Datacenter probe"),
      ).toMatch(/^[A-Z].+\.$/);
    }

    expect(
      getDataStoreContentScanStopSentence(
        DataStoreContentScanStop.ProbeDisconnected,
        "Datacenter probe",
      ),
    ).toBe("Nothing scans this store while Datacenter probe is disconnected.");
    expect(
      getDataStoreContentScanStopSentence(
        DataStoreContentScanStop.ProbeDisconnected,
      ),
    ).toBe("Nothing scans this store while its probe is disconnected.");
    expect(TELEMETRY_SCAN_NOW_REFUSAL_SENTENCE).toMatch(/^[A-Z].+\.$/);
  });
});
