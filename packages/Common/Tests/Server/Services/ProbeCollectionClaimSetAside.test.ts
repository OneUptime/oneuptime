// Queueing a project's Data Security evaluation needs Redis; what queues it is not under test.
jest.mock("../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    ...(jest.requireActual(
      "../../../Server/Utils/DataSecurity/DataSecurityJobs",
    ) as Record<string, unknown>),
    queueDataSecurityEvaluation: jest.fn(async (): Promise<void> => {
      return undefined;
    }),
  };
});

import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataSecuritySettingService from "../../../Server/Services/DataSecuritySettingService";
import DataStoreLabelRuleEngineService from "../../../Server/Services/DataStoreLabelRuleEngineService";
import DataStoreOwnerRuleEngineService from "../../../Server/Services/DataStoreOwnerRuleEngineService";
import { queueDataSecurityEvaluation } from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataStoreService, {
  PROBE_STORE_DUE_COLUMNS,
  Service as DataStoreServiceType,
} from "../../../Server/Services/DataStoreService";
import OpenStackCloudService, {
  Service as OpenStackCloudServiceType,
} from "../../../Server/Services/OpenStackCloudService";
import {
  claimDueTableHealthStoresForProbe,
  setAsideUncollectableTableHealthStores,
} from "../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import {
  claimDueDataStoresForProbe,
  setAsideUnscannableStores,
} from "../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import logger from "../../../Server/Utils/Logger";
import OpenStackCheckStore, {
  OpenStackCheckKind,
  OpenStackCheckService,
} from "../../../Server/Utils/OpenStack/OpenStackCheckStore";
import OpenStackProbeCollectionStore, {
  OpenStackCollectionCloudService,
} from "../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import {
  SET_ASIDE_FIRST_RULE_PARAMETER,
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_PER_CLAIM,
  SET_ASIDE_ROUNDS_PER_CLAIM,
  SET_ASIDE_SPREAD_IN_MINUTES,
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  getMakeDueNowParameters,
  getMakeDueNowStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../../../Server/Utils/Probe/ClaimSetAside";
import VMwareProbeCollectionStore from "../../../Server/Utils/VMware/VMwareProbeCollectionStore";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import { DATA_OBSERVABILITY_KINDS } from "../../../Server/Utils/DataObservability/DataObservabilityEngines";
import { PROBE_SCANNABLE_KINDS } from "../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  CapturedStatement,
  captureClaimQueries,
  expectPlaceholdersMatchParameters,
  getBoundStatusList,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING (OneUptime issue #7919)
 *
 * A probe's claims of its vCenters, OpenStack clouds and checks, and the
 * data stores whose tables it collects or whose content it scans, each
 * walked the probe's rows due-first and moved only the rows it handed out.
 * A row due but not claimable - a cloud switched to its agent, a check
 * turned off, a store whose scan is off, anything of a suspended project -
 * kept its old due time, at the head of the probe's range, and every claim
 * read it again: the flaw #7918 fixed in the monitor and network device
 * claims. All five also read `(due IS NULL OR due <= now)` ordered
 * `NULLS FIRST`, which no btree serves, and the OpenStack check claim
 * matched its probe with a COALESCE across two tables, which no index
 * serves: every claim of every probe read every check of every project.
 *
 * So each claim's read is a range of a (probe, due) index that stops at its
 * limit, and after each claim the rows it stepped over are set aside
 * (Utils/Probe/ClaimSetAside) - judged again by the very rule the claim
 * keeps rows by, so a row the claim would hand out is never moved - and the
 * probe's rows with no due time made due. A write that makes a row
 * claimable again makes it due at once.
 *
 * These pin the statements, their parameters, that each claim and its
 * set-aside share ONE definition of "may be handed out", the rounds, the
 * failure isolation and the hooks that undo a set-aside. The Postgres
 * suites (ProbeCollectionClaimSetAsidePostgres) run them.
 */

const PROBE_ID: ObjectID = new ObjectID("b7000000-0000-4000-8000-000000000001");
const FIRST_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUNNING_ID: string = "66666666-6666-4666-8666-666666666666";
const CLOUD_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const STORE_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const PROJECT_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const LIMIT: number = 7;

const SET_ASIDE_MARKER: string = '"unclaimable" AS (';

// The text between two markers of a normalized statement.
function between(sql: string, start: string, end: string): string {
  const from: number = sql.indexOf(start);

  expect(from).toBeGreaterThan(-1);

  const to: number = sql.indexOf(end, from + start.length);

  expect(to).toBeGreaterThan(from);

  return sql.slice(from + start.length, to);
}

// Every text between two markers, in order.
function allBetween(sql: string, start: string, end: string): Array<string> {
  const found: Array<string> = [];
  let from: number = sql.indexOf(start);

  while (from > -1) {
    const to: number = sql.indexOf(end, from + start.length);

    expect(to).toBeGreaterThan(from);

    found.push(sql.slice(from + start.length, to));
    from = sql.indexOf(start, to + end.length);
  }

  return found;
}

// A rule with its parameter numbers taken out, to compare two copies.
function unnumbered(rule: string): string {
  return rule.replace(/\$\d+/g, "$n").trim();
}

function silenceLogs(): void {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }
}

function loggedError(fragment: string): boolean {
  return (logger.error as unknown as jest.SpyInstance).mock.calls.some(
    (call: Array<unknown>): boolean => {
      return String(call[0]).includes(fragment);
    },
  );
}

type LaterRows = (
  statement: CapturedStatement,
) => Array<Record<string, unknown>> | undefined;

/*
 * A table's own service, as the stores are handed one: its connection is
 * captured (captureClaimQueries, which fails a claim that opens a
 * transaction), and its reads answer `found`.
 */
function claimingService(found: Array<Record<string, unknown>> = []): {
  service: Record<string, unknown>;
  findByCalls: Array<Record<string, unknown>>;
} {
  const findByCalls: Array<Record<string, unknown>> = [];

  return {
    findByCalls: findByCalls,
    service: {
      getRepository: (): unknown => {
        return undefined;
      },
      executeTransaction: async (): Promise<unknown> => {
        return [];
      },
      findBy: async (options: Record<string, unknown>): Promise<unknown> => {
        findByCalls.push(options);
        return found;
      },
      findOneById: async (): Promise<unknown> => {
        return null;
      },
      updateColumnsByIdWithoutHooks: async (): Promise<void> => {
        return undefined;
      },
    },
  };
}

interface ClaimRun {
  statements: Array<CapturedStatement>;
  // What the claim handed out, as ids.
  handedOut: Array<string>;
}

interface ClaimUnderTest {
  name: string;
  table: string;
  alias: string;
  dueColumn: string;
  // Where the claim statement binds now, and its limit.
  nowParameter: number;
  limitParameter: string;
  // The claim's `due <= now`, which the rule follows in each branch.
  dueCondition: string;
  // The probe's range each branch of the claim reads, before its rule.
  probeRanges: Array<string>;
  // The probe's rows, as the set-aside reads them through its LEFT JOINs.
  isProbesRow: string;
  // The joins the rule reads in the set-aside.
  joins: Array<string>;
  // What the rule must hold, and the parameters it binds in the set-aside.
  rule: Array<string>;
  ruleParameters: Array<unknown>;
  hasRunningIds: boolean;
  /*
   * Runs the claim for PROBE_ID with room for LIMIT: the claim statement
   * hands out FIRST_ID, or nothing, and later statements answer laterRows.
   */
  run: (laterRows?: LaterRows, nothingClaimed?: boolean) => Promise<ClaimRun>;
  // Runs its set-aside alone, the statement answering `rows`.
  setAside: (rows: Array<Record<string, unknown>>) => Promise<SetAsideCounts>;
}

const SERVED_PROJECT_RULE: Array<string> = [
  'p."deletedAt" IS NULL',
  'p."isBlocked" = false',
  'p."isSampleProject" = false',
];

function openStackCheckClaim(kind: OpenStackCheckKind): ClaimUnderTest {
  const dueColumn: string = OpenStackCheckStore.getDueColumn(kind);

  return {
    name: `OpenStack ${kind} check`,
    table: "OpenStackCloudCheck",
    alias: "ck",
    dueColumn: dueColumn,
    nowParameter: 1,
    limitParameter: "$3",
    dueCondition: `ck."${dueColumn}" <= $2`,
    probeRanges: [
      `WHERE ck."probeId" = $1 AND NOT (ck."_id" = ANY($5::uuid[])) AND ck."${dueColumn}" <= $2`,
      `WHERE c."collectionProbeId" = $1 AND ck."probeId" IS NULL AND NOT (ck."_id" = ANY($5::uuid[])) AND ck."${dueColumn}" <= $2`,
    ],
    isProbesRow: 'COALESCE(ck."probeId", c."collectionProbeId") = $1',
    joins: [
      'LEFT JOIN "OpenStackCloud" c ON ck."openStackCloudId" = c."_id"',
      'LEFT JOIN "Project" p ON ck."projectId" = p."_id"',
      'LEFT JOIN "Probe" pr ON pr."_id" = COALESCE(ck."probeId", c."collectionProbeId")',
    ],
    rule: [
      kind === "api"
        ? 'ck."isApiCheckEnabled" = true'
        : '(ck."isLifecycleCheckEnabled" = true OR ck."isSweepPending" = true)',
      'ck."deletedAt" IS NULL',
      'c."deletedAt" IS NULL',
      'c."isArchived" = false',
      '((pr."isGlobalProbe" = false AND pr."projectId" = ck."projectId") OR (pr."isGlobalProbe" = true AND $n::boolean = false))',
      'pr."deletedAt" IS NULL',
      ...SERVED_PROJECT_RULE,
    ],
    ruleParameters: [
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      IsBillingEnabled,
    ],
    hasRunningIds: true,
    run: async (
      laterRows?: LaterRows,
      nothingClaimed?: boolean,
    ): Promise<ClaimRun> => {
      const fake: ReturnType<typeof claimingService> = claimingService();
      const statements: Array<CapturedStatement> = captureClaimQueries(
        fake.service as never,
        nothingClaimed ? [] : [{ _id: FIRST_ID }],
        laterRows,
      );

      const options: {
        probeId: ObjectID;
        runningIds: Array<string>;
        limit: number;
      } = {
        probeId: PROBE_ID,
        runningIds: [RUNNING_ID, "not-an-id"],
        limit: LIMIT,
      };

      if (kind === "api") {
        await OpenStackCheckStore.claimApiChecks(
          fake.service as unknown as OpenStackCheckService,
          options,
        );
      } else {
        await OpenStackCheckStore.claimLifecycleChecks(
          fake.service as unknown as OpenStackCheckService,
          options,
        );
      }

      // What was claimed is read back by id: that is what is handed out.
      return {
        statements: statements,
        handedOut: fake.findByCalls.length > 0 ? [FIRST_ID] : [],
      };
    },
    setAside: async (
      rows: Array<Record<string, unknown>>,
    ): Promise<SetAsideCounts> => {
      const fake: ReturnType<typeof claimingService> = claimingService();
      captureClaimQueries(fake.service as never, rows);

      return await OpenStackCheckStore.setAsideUnclaimable(
        fake.service as unknown as OpenStackCheckService,
        { kind: kind, probeId: PROBE_ID, currentDate: new Date() },
      );
    },
  };
}

const CLAIMS: Array<ClaimUnderTest> = [
  {
    name: "VMware collection",
    table: "VMwareVCenter",
    alias: "vc",
    dueColumn: "nextCollectionAt",
    nowParameter: 1,
    limitParameter: "$3",
    dueCondition: 'vc."nextCollectionAt" <= $2',
    probeRanges: [
      'WHERE vc."collectionProbeId" = $1 AND NOT (vc."_id" = ANY($6::uuid[])) AND vc."nextCollectionAt" <= $2',
    ],
    isProbesRow: 'vc."collectionProbeId" = $1',
    joins: [
      'LEFT JOIN "Project" p ON vc."projectId" = p."_id"',
      'LEFT JOIN "Probe" pr ON vc."collectionProbeId" = pr."_id"',
    ],
    rule: [
      'vc."collectionMethod" = $n',
      'vc."deletedAt" IS NULL',
      'vc."isVCenterPasswordSet" = true',
      'vc."vcenterUrl" IS NOT NULL',
      'vc."vcenterUsername" IS NOT NULL',
      '((pr."isGlobalProbe" = false AND pr."projectId" = vc."projectId") OR (pr."isGlobalProbe" = true AND $n::boolean = false))',
      'pr."deletedAt" IS NULL',
      ...SERVED_PROJECT_RULE,
    ],
    ruleParameters: [
      VMwareCollectionMethod.Probe,
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      IsBillingEnabled,
    ],
    hasRunningIds: true,
    run: async (
      laterRows?: LaterRows,
      nothingClaimed?: boolean,
    ): Promise<ClaimRun> => {
      const fake: ReturnType<typeof claimingService> = claimingService([
        {
          _id: FIRST_ID,
          name: "vc-1",
          vcenterUrl: "https://vc-1.example.com",
          vcenterUsername: "reader",
          vcenterPassword: "secret",
          collectionIntervalInMinutes: 5,
          collectionSettingsVersion: 1,
        },
      ]);
      const statements: Array<CapturedStatement> = captureClaimQueries(
        fake.service as never,
        nothingClaimed ? [] : [{ _id: FIRST_ID }],
        laterRows,
      );

      const jobs: Array<{ vmwareVCenterId: string }> =
        await VMwareProbeCollectionStore.claimDueVCenters(
          fake.service as unknown as DatabaseService<VMwareVCenter>,
          {
            probeId: PROBE_ID,
            runningVMwareVCenterIds: [RUNNING_ID, "not-an-id"],
            limit: LIMIT,
          },
        );

      return {
        statements: statements,
        handedOut: jobs.map((job: { vmwareVCenterId: string }): string => {
          return job.vmwareVCenterId;
        }),
      };
    },
    setAside: async (
      rows: Array<Record<string, unknown>>,
    ): Promise<SetAsideCounts> => {
      const fake: ReturnType<typeof claimingService> = claimingService();
      captureClaimQueries(fake.service as never, rows);

      return await VMwareProbeCollectionStore.setAsideUncollectable(
        fake.service as unknown as DatabaseService<VMwareVCenter>,
        { probeId: PROBE_ID, currentDate: new Date() },
      );
    },
  },
  {
    name: "OpenStack collection",
    table: "OpenStackCloud",
    alias: "c",
    dueColumn: "nextCollectionAt",
    nowParameter: 1,
    limitParameter: "$3",
    dueCondition: 'c."nextCollectionAt" <= $2',
    probeRanges: [
      'WHERE c."collectionProbeId" = $1 AND NOT (c."_id" = ANY($6::uuid[])) AND c."nextCollectionAt" <= $2',
    ],
    isProbesRow: 'c."collectionProbeId" = $1',
    joins: [
      'LEFT JOIN "Project" p ON c."projectId" = p."_id"',
      'LEFT JOIN "Probe" pr ON c."collectionProbeId" = pr."_id"',
    ],
    rule: [
      'c."collectionMethod" = $n',
      'c."deletedAt" IS NULL',
      'c."isArchived" = false',
      'c."isCredentialSet" = true',
      'c."authUrl" IS NOT NULL',
      '((pr."isGlobalProbe" = false AND pr."projectId" = c."projectId") OR (pr."isGlobalProbe" = true AND $n::boolean = false))',
      'pr."deletedAt" IS NULL',
      ...SERVED_PROJECT_RULE,
    ],
    ruleParameters: [
      OpenStackCollectionMethod.Probe,
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
      IsBillingEnabled,
    ],
    hasRunningIds: true,
    run: async (
      laterRows?: LaterRows,
      nothingClaimed?: boolean,
    ): Promise<ClaimRun> => {
      const fake: ReturnType<typeof claimingService> = claimingService([
        {
          _id: FIRST_ID,
          name: "lab",
          authUrl: "https://keystone.example.com:5000",
          credentialKind: "applicationCredential",
          applicationCredentialId: "app-credential",
          credentialSecret: "secret",
          collectionIntervalInMinutes: 5,
          collectionSettingsVersion: 1,
        },
      ]);
      const statements: Array<CapturedStatement> = captureClaimQueries(
        fake.service as never,
        nothingClaimed ? [] : [{ _id: FIRST_ID }],
        laterRows,
      );

      const jobs: Array<{ openStackCloudId: string }> =
        await OpenStackProbeCollectionStore.claimDueClouds(
          fake.service as unknown as OpenStackCollectionCloudService,
          {
            probeId: PROBE_ID,
            runningOpenStackCloudIds: [RUNNING_ID, "not-an-id"],
            limit: LIMIT,
          },
        );

      return {
        statements: statements,
        handedOut: jobs.map((job: { openStackCloudId: string }): string => {
          return job.openStackCloudId;
        }),
      };
    },
    setAside: async (
      rows: Array<Record<string, unknown>>,
    ): Promise<SetAsideCounts> => {
      const fake: ReturnType<typeof claimingService> = claimingService();
      captureClaimQueries(fake.service as never, rows);

      return await OpenStackProbeCollectionStore.setAsideUncollectable(
        fake.service as unknown as OpenStackCollectionCloudService,
        { probeId: PROBE_ID, currentDate: new Date() },
      );
    },
  },
  openStackCheckClaim("api"),
  openStackCheckClaim("lifecycle"),
  {
    name: "Data Security content scan",
    table: "DataStore",
    alias: "ds",
    dueColumn: "nextContentScanAt",
    nowParameter: 3,
    limitParameter: "$6",
    dueCondition: 'ds."nextContentScanAt" <= $4',
    probeRanges: [
      'WHERE ds."scanProbeId" = $1 AND ds."nextContentScanAt" <= $4',
    ],
    isProbesRow: 'ds."scanProbeId" = $1',
    joins: [
      'LEFT JOIN "Project" p ON ds."projectId" = p."_id"',
      'LEFT JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"',
      'LEFT JOIN "DataSecuritySetting" s ON s."projectId" = ds."projectId" AND s."deletedAt" IS NULL',
    ],
    rule: [
      'ds."deletedAt" IS NULL',
      'ds."isContentScanEnabled" = true',
      'ds."isArchived" = false',
      'ds."provider" = $n',
      'ds."kind" = ANY($n::text[])',
      'ds."probeConnectionVariable" IS NOT NULL',
      `ds."probeConnectionVariable" <> ''`,
      'COALESCE(s."isContentScanEnabled", true) = true',
      'pr."isGlobalProbe" = false',
      'pr."projectId" = ds."projectId"',
      'pr."deletedAt" IS NULL',
      ...SERVED_PROJECT_RULE,
    ],
    ruleParameters: [
      DataStoreProvider.SelfManaged,
      [...PROBE_SCANNABLE_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ],
    hasRunningIds: false,
    run: async (
      laterRows?: LaterRows,
      nothingClaimed?: boolean,
    ): Promise<ClaimRun> => {
      const statements: Array<CapturedStatement> = captureClaimQueries(
        DataStoreService,
        nothingClaimed
          ? []
          : [{ _id: FIRST_ID, projectId: PROJECT_ID.toString() }],
        laterRows,
      );

      const claimed: Array<{ _id: string }> = await claimDueDataStoresForProbe(
        { probeId: PROBE_ID, limit: LIMIT },
      );

      return {
        statements: statements,
        handedOut: claimed.map((row: { _id: string }): string => {
          return row._id;
        }),
      };
    },
    setAside: async (
      rows: Array<Record<string, unknown>>,
    ): Promise<SetAsideCounts> => {
      captureClaimQueries(DataStoreService, rows);

      return await setAsideUnscannableStores({
        probeId: PROBE_ID,
        currentDate: new Date(),
      });
    },
  },
  {
    name: "Data Observability table health",
    table: "DataStore",
    alias: "ds",
    dueColumn: "nextTableHealthCollectionAt",
    nowParameter: 3,
    limitParameter: "$6",
    dueCondition: 'ds."nextTableHealthCollectionAt" <= $4',
    probeRanges: [
      'WHERE ds."scanProbeId" = $1 AND ds."nextTableHealthCollectionAt" <= $4',
    ],
    isProbesRow: 'ds."scanProbeId" = $1',
    joins: [
      'LEFT JOIN "Project" p ON ds."projectId" = p."_id"',
      'LEFT JOIN "Probe" pr ON ds."scanProbeId" = pr."_id"',
    ],
    rule: [
      'ds."deletedAt" IS NULL',
      'ds."isTableHealthEnabled" = true',
      'ds."isArchived" = false',
      'ds."provider" = $n',
      'ds."kind" = ANY($n::text[])',
      'ds."probeConnectionVariable" IS NOT NULL',
      `ds."probeConnectionVariable" <> ''`,
      'pr."isGlobalProbe" = false',
      'pr."projectId" = ds."projectId"',
      'pr."deletedAt" IS NULL',
      ...SERVED_PROJECT_RULE,
    ],
    ruleParameters: [
      DataStoreProvider.SelfManaged,
      [...DATA_OBSERVABILITY_KINDS],
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    ],
    hasRunningIds: false,
    run: async (
      laterRows?: LaterRows,
      nothingClaimed?: boolean,
    ): Promise<ClaimRun> => {
      const statements: Array<CapturedStatement> = captureClaimQueries(
        DataStoreService,
        nothingClaimed
          ? []
          : [{ _id: FIRST_ID, projectId: PROJECT_ID.toString() }],
        laterRows,
      );

      const claimed: Array<{ _id: string }> =
        await claimDueTableHealthStoresForProbe({
          probeId: PROBE_ID,
          limit: LIMIT,
        });

      return {
        statements: statements,
        handedOut: claimed.map((row: { _id: string }): string => {
          return row._id;
        }),
      };
    },
    setAside: async (
      rows: Array<Record<string, unknown>>,
    ): Promise<SetAsideCounts> => {
      captureClaimQueries(DataStoreService, rows);

      return await setAsideUncollectableTableHealthStores({
        probeId: PROBE_ID,
        currentDate: new Date(),
      });
    },
  },
];

// The claim statement's rule in each of its branches, then the set-aside's.
function rulesOf(
  claim: ClaimUnderTest,
  statements: Array<CapturedStatement>,
): { claimRules: Array<string>; setAsideRule: string } {
  return {
    claimRules: allBetween(
      normalizeSql(statements[0]!.sql),
      `AND ${claim.dueCondition} AND `,
      " ORDER BY",
    ),
    setAsideRule: between(
      normalizeSql(statements[1]!.sql),
      `AND ${claim.alias}."${claim.dueColumn}" <= $2 AND ( `,
      " ) IS NOT TRUE",
    ),
  };
}

describe.each(CLAIMS)("the $name claim", (claim: ClaimUnderTest) => {
  const due: string = `${claim.alias}."${claim.dueColumn}"`;

  beforeEach(() => {
    silenceLogs();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("reads a range of its index that stops at its limit", () => {
    /*
     * `due <= now ORDER BY due ASC LIMIT n` is a range of a (probe, due)
     * btree in its own order: Postgres reads it until it has n rows that
     * pass and stops. `IS NULL OR` and `NULLS FIRST` made it read and sort
     * every due row of the probe.
     */
    test("oldest first, with no NULLS FIRST and no IS NULL OR", async () => {
      const { statements } = await claim.run();
      const read: string = normalizeSql(statements[0]!.sql);

      expect(read).not.toContain("NULLS FIRST");
      expect(read).not.toContain(`${due} IS NULL OR`);
      expect(read).toContain(`ORDER BY ${due} ASC LIMIT ${claim.limitParameter}`);
      expect(read).toContain(`FOR NO KEY UPDATE OF ${claim.alias} SKIP LOCKED`);
      expect(read).not.toMatch(/FOR UPDATE/);
      // Answered in claim order, oldest first: never NULL now.
      expect(read).toMatch(/ORDER BY "due"\."dueAt" ASC$/);
    });

    test("each branch reads the probe's own range, then the rule", async () => {
      const { statements } = await claim.run();
      const read: string = normalizeSql(statements[0]!.sql);

      for (const range of claim.probeRanges) {
        expect(read).toContain(`${range} AND `);
      }

      expect(allBetween(read, `AND ${claim.dueCondition} AND `, " ORDER BY")).toHaveLength(
        claim.probeRanges.length,
      );
    });

    test("binds every placeholder it names", async () => {
      const { statements } = await claim.run();

      expectPlaceholdersMatchParameters(statements[0]!);
      expect(statements[0]!.parameters[0]).toBe(PROBE_ID.toString());
      expect(statements[0]!.parameters[claim.nowParameter]).toBeInstanceOf(
        Date,
      );
    });
  });

  describe("sets aside what it stepped over", () => {
    test("after the claim, in a statement of its own", async () => {
      const { statements, handedOut } = await claim.run();

      expect(statements).toHaveLength(2);
      expect(normalizeSql(statements[0]!.sql)).not.toContain(SET_ASIDE_MARKER);
      expect(normalizeSql(statements[1]!.sql)).toContain(SET_ASIDE_MARKER);
      expect(handedOut).toEqual([FIRST_ID]);
    });

    test("even when nothing could be claimed: then every due row was stepped over", async () => {
      const { statements, handedOut } = await claim.run(undefined, true);

      expect(statements).toHaveLength(2);
      expect(normalizeSql(statements[1]!.sql)).toContain(SET_ASIDE_MARKER);
      expect(handedOut).toEqual([]);
    });

    test("as of the claim's own now", async () => {
      const { statements } = await claim.run();

      expect(statements[1]!.parameters[1]).toBe(
        statements[0]!.parameters[claim.nowParameter],
      );
    });

    /*
     * The invariant that makes set-aside safe: a row the claim would hand
     * out is never one it moves. Both statements are built from one
     * definition; this fails the moment they drift apart.
     */
    test("judges each row by the claim's own rule, word for word", async () => {
      const { statements } = await claim.run();
      const { claimRules, setAsideRule } = rulesOf(claim, statements);

      expect(claimRules.length).toBeGreaterThan(0);

      for (const claimRule of claimRules) {
        expect(unnumbered(setAsideRule)).toBe(unnumbered(claimRule));
      }

      // And it is the whole rule.
      for (const condition of claim.rule) {
        expect(unnumbered(setAsideRule)).toContain(condition);
      }
    });

    test("the rows the probe is still running may be claimed, so they are not part of the rule", async () => {
      const { statements } = await claim.run();
      const { setAsideRule } = rulesOf(claim, statements);

      expect(setAsideRule).not.toContain("::uuid[]");
      expect(normalizeSql(statements[1]!.sql)).not.toMatch(
        /NOT \(\w+\."_id" = ANY/,
      );
      expect(statements[1]!.parameters).not.toContainEqual([RUNNING_ID]);
    });

    test("binds the rule's own parameters after the five of its own", async () => {
      const { statements } = await claim.run();
      const setAside: CapturedStatement = statements[1]!;

      expect(setAside.parameters.slice(SET_ASIDE_FIRST_RULE_PARAMETER - 1)).toEqual(
        claim.ruleParameters,
      );
      expectPlaceholdersMatchParameters(setAside);
      expect(setAside.parameters[0]).toBe(PROBE_ID.toString());
    });

    test("binds the served subscription statuses, the shared list", async () => {
      const { statements } = await claim.run();

      for (const column of [
        "paymentProviderSubscriptionStatus",
        "paymentProviderMeteredSubscriptionStatus",
      ] as const) {
        expect(getBoundStatusList(statements[1]!, column)).toEqual(
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
        );
      }
    });

    /*
     * IS NOT TRUE rather than NOT: through the LEFT JOINs a row whose
     * project or probe is missing makes the rule NULL, and NOT NULL is NULL:
     * such a row would never be moved and would sit at the head for good.
     */
    test("reads the rule through LEFT JOINs, IS NOT TRUE, so a row whose project or probe is gone is moved too", async () => {
      const { statements } = await claim.run();
      const unclaimable: string = between(
        normalizeSql(statements[1]!.sql),
        SET_ASIDE_MARKER,
        '"setAside" AS (',
      );

      for (const join of claim.joins) {
        expect(unclaimable).toContain(join);
      }

      expect(unclaimable).not.toContain("INNER JOIN");
      expect(unclaimable).toContain(") IS NOT TRUE");
      // Judged again as the probe's, and still due, when it is locked.
      expect(unclaimable).toContain(
        `WHERE ${claim.alias}."_id" IN (SELECT "_id" FROM "oldestDue") AND ${claim.isProbesRow} AND ${due} <= $2 AND (`,
      );
    });

    test("looks at no more than SET_ASIDE_PER_CLAIM of the probe's oldest due rows from each of its ranges", async () => {
      const { statements } = await claim.run();
      const oldestDue: string = between(
        normalizeSql(statements[1]!.sql),
        '"oldestDue" AS (',
        SET_ASIDE_MARKER,
      );

      expect(oldestDue.split(`ORDER BY ${due} ASC LIMIT $3`).length - 1).toBe(
        claim.probeRanges.length,
      );
      expect(oldestDue).not.toContain("NULLS FIRST");
      expect(statements[1]!.parameters[2]).toBe(SET_ASIDE_PER_CLAIM);
    });

    test("locks only the rows it moves, skipping any another writer holds", async () => {
      const { statements } = await claim.run();
      const sql: string = normalizeSql(statements[1]!.sql);

      expect(sql.split(`FOR NO KEY UPDATE OF ${claim.alias} SKIP LOCKED`).length - 1).toBe(2);
      expect(sql).not.toMatch(/FOR UPDATE/);
    });

    test("moves a row a quarter of an hour on, plus a spread picked per row", async () => {
      const { statements } = await claim.run();
      const setAside: CapturedStatement = statements[1]!;

      expect(normalizeSql(setAside.sql)).toContain(
        `UPDATE "${claim.table}" AS ${claim.alias} SET "${claim.dueColumn}" = $2::timestamptz + ($4::double precision + random() * $5::double precision) * INTERVAL '1 minute' FROM "unclaimable"`,
      );
      expect(setAside.parameters[3]).toBe(SET_ASIDE_FOR_MINUTES);
      expect(setAside.parameters[4]).toBe(SET_ASIDE_SPREAD_IN_MINUTES);
    });

    test("makes the probe's rows with no due time due now, which the claim no longer reads", async () => {
      const { statements } = await claim.run();
      const sql: string = normalizeSql(statements[1]!.sql);
      const unscheduled: string = between(
        sql,
        '"unscheduled" AS (',
        '"madeDue" AS (',
      );

      expect(unscheduled.split(`AND ${due} IS NULL LIMIT $3`).length - 1).toBe(
        claim.probeRanges.length,
      );
      expect(unscheduled).toContain(
        `FOR NO KEY UPDATE OF ${claim.alias} SKIP LOCKED`,
      );
      expect(between(sql, '"madeDue" AS (', "SELECT (SELECT")).toContain(
        `SET "${claim.dueColumn}" = $2::timestamptz FROM "unscheduled"`,
      );
    });

    test("a set-aside that fails never costs the probe what it was handed", async () => {
      const { handedOut } = await claim.run((statement: CapturedStatement) => {
        if (normalizeSql(statement.sql).includes(SET_ASIDE_MARKER)) {
          throw new Error("canceling statement due to statement timeout");
        }

        return undefined;
      });

      expect(handedOut).toEqual([FIRST_ID]);
      expect(loggedError("could not set aside")).toBe(true);
    });

    test("runs another round while a round moves a full batch, up to the cap", async () => {
      const { statements } = await claim.run((statement: CapturedStatement) => {
        return normalizeSql(statement.sql).includes(SET_ASIDE_MARKER)
          ? [{ setAside: SET_ASIDE_PER_CLAIM, madeDue: 0 }]
          : undefined;
      });

      expect(statements).toHaveLength(1 + SET_ASIDE_ROUNDS_PER_CLAIM);
    });

    test("stops at the first round that moves less than a full batch", async () => {
      let round: number = 0;

      const { statements } = await claim.run((statement: CapturedStatement) => {
        if (!normalizeSql(statement.sql).includes(SET_ASIDE_MARKER)) {
          return undefined;
        }

        round++;

        return [{ setAside: round === 1 ? SET_ASIDE_PER_CLAIM : 3, madeDue: 0 }];
      });

      expect(statements).toHaveLength(3);
    });

    test("a full batch made due is a reason for another round too", async () => {
      let round: number = 0;

      const { statements } = await claim.run((statement: CapturedStatement) => {
        if (!normalizeSql(statement.sql).includes(SET_ASIDE_MARKER)) {
          return undefined;
        }

        round++;

        return [{ setAside: 0, madeDue: round === 1 ? SET_ASIDE_PER_CLAIM : 0 }];
      });

      expect(statements).toHaveLength(3);
    });

    test("answers how many rows it set aside and made due", async () => {
      await expect(claim.setAside([{ setAside: 3, madeDue: 1 }])).resolves.toEqual(
        { setAside: 3, madeDue: 1 },
      );
      await expect(claim.setAside([])).resolves.toEqual({
        setAside: 0,
        madeDue: 0,
      });
    });
  });
});

describe("the OpenStack check claim no longer reads every check of every project", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(["api", "lifecycle"] as const)(
    "the %s claim matches its probe in two index-friendly branches, never with a COALESCE",
    async (kind: OpenStackCheckKind) => {
      silenceLogs();
      const { statements } = await openStackCheckClaim(kind).run();
      const read: string = normalizeSql(statements[0]!.sql);
      const dueColumn: string = OpenStackCheckStore.getDueColumn(kind);

      // The two-table COALESCE is only ever a join condition now.
      expect(read).not.toMatch(/WHERE COALESCE/);
      expect(read).not.toMatch(/AND COALESCE\(ck\."probeId"/);

      // Its own probe: a range of the (probeId, due) index.
      expect(
        between(read, 'WITH "ownProbeDue" AS (', '"cloudProbeDue" AS ('),
      ).toContain('FROM "OpenStackCloudCheck" ck INNER JOIN "OpenStackCloud" c');

      // Its cloud's probe: through the clouds this probe collects.
      expect(between(read, '"cloudProbeDue" AS (', '"due" AS (')).toContain(
        'FROM "OpenStackCloud" c INNER JOIN "OpenStackCloudCheck" ck ON ck."openStackCloudId" = c."_id"',
      );

      // The oldest of the two, up to the limit, and only those are moved on.
      expect(read).toContain(
        '"due" AS ( SELECT "_id", "dueAt" FROM "ownProbeDue" UNION ALL SELECT "_id", "dueAt" FROM "cloudProbeDue" ORDER BY "dueAt" ASC LIMIT $3 )',
      );
      expect(read).toContain(
        `"claimed" AS ( UPDATE "OpenStackCloudCheck" AS ck SET "${dueColumn}" = `,
      );
      expect(statements[0]!.parameters[2]).toBe(LIMIT);
      // Only real ids of the rows the probe is still running, as a bound array.
      expect(statements[0]!.parameters[4]).toEqual([RUNNING_ID]);
    },
  );

  test("its set-aside finds the probe's checks as the claim does: its own, and its clouds'", async () => {
    silenceLogs();
    const { statements } = await openStackCheckClaim("api").run();
    const oldestDue: string = between(
      normalizeSql(statements[1]!.sql),
      '"oldestDue" AS (',
      SET_ASIDE_MARKER,
    );

    expect(oldestDue).toContain(
      '(SELECT ck."_id" FROM "OpenStackCloudCheck" ck WHERE ck."probeId" = $1 AND ck."nextApiCheckAt" <= $2 ORDER BY ck."nextApiCheckAt" ASC LIMIT $3)',
    );
    expect(oldestDue).toContain(
      'UNION ALL (SELECT ck."_id" FROM "OpenStackCloud" c INNER JOIN "OpenStackCloudCheck" ck ON ck."openStackCloudId" = c."_id" WHERE c."collectionProbeId" = $1 AND ck."probeId" IS NULL AND ck."nextApiCheckAt" <= $2 ORDER BY ck."nextApiCheckAt" ASC LIMIT $3)',
    );
  });

  test("the API claim and the lifecycle claim set aside their own kind only", async () => {
    silenceLogs();
    const api: ClaimRun = await openStackCheckClaim("api").run();
    jest.restoreAllMocks();
    silenceLogs();
    const lifecycle: ClaimRun = await openStackCheckClaim("lifecycle").run();

    const apiSql: string = normalizeSql(api.statements[1]!.sql);
    const lifecycleSql: string = normalizeSql(lifecycle.statements[1]!.sql);

    expect(apiSql).toContain('SET "nextApiCheckAt" = $2::timestamptz + (');
    expect(apiSql).not.toContain("nextLifecycleCheckAt");
    expect(lifecycleSql).toContain(
      'SET "nextLifecycleCheckAt" = $2::timestamptz + (',
    );
    expect(lifecycleSql).not.toContain("nextApiCheckAt");
  });
});

describe("the shared set-aside statement", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const SINGLE: Parameters<typeof getClaimSetAsideStatement>[0] = {
    table: "Thing",
    alias: "t",
    dueColumn: "nextAt",
    sources: [{ from: `"Thing" t`, where: `t."probeId" = $1` }],
    joins: `LEFT JOIN "Project" p ON t."projectId" = p."_id"`,
    isProbesRow: `t."probeId" = $1`,
    claimable: `t."isOn" = true AND p."isBlocked" = false`,
  };

  test("reads one range plainly, with no UNION", () => {
    const sql: string = normalizeSql(getClaimSetAsideStatement(SINGLE));

    expect(sql).toContain(
      'WITH "oldestDue" AS ( SELECT t."_id" FROM "Thing" t WHERE t."probeId" = $1 AND t."nextAt" <= $2 ORDER BY t."nextAt" ASC LIMIT $3 )',
    );
    expect(sql).not.toContain("UNION");
    expect(sql).toContain(
      '"unscheduled" AS ( SELECT t."_id" FROM "Thing" t WHERE t."_id" IN ( SELECT t."_id" FROM "Thing" t WHERE t."probeId" = $1 AND t."nextAt" IS NULL LIMIT $3 ) AND t."nextAt" IS NULL FOR NO KEY UPDATE OF t SKIP LOCKED )',
    );
    expect(sql).toMatch(
      /SELECT \(SELECT COUNT\(\*\) FROM "setAside"\)::int AS "setAside", \(SELECT COUNT\(\*\) FROM "madeDue"\)::int AS "madeDue"$/,
    );
  });

  test("reads several ranges each to its own cap, joined with UNION ALL", () => {
    const sql: string = normalizeSql(
      getClaimSetAsideStatement({
        ...SINGLE,
        sources: [
          { from: `"Thing" t`, where: `t."probeId" = $1` },
          {
            from: `"Parent" pa INNER JOIN "Thing" t ON t."parentId" = pa."_id"`,
            where: `pa."probeId" = $1 AND t."probeId" IS NULL`,
          },
        ],
      }),
    );

    expect(sql).toContain(
      'WITH "oldestDue" AS ( (SELECT t."_id" FROM "Thing" t WHERE t."probeId" = $1 AND t."nextAt" <= $2 ORDER BY t."nextAt" ASC LIMIT $3) UNION ALL (SELECT t."_id" FROM "Parent" pa INNER JOIN "Thing" t ON t."parentId" = pa."_id" WHERE pa."probeId" = $1 AND t."probeId" IS NULL AND t."nextAt" <= $2 ORDER BY t."nextAt" ASC LIMIT $3) ),',
    );
    expect(sql.split("UNION ALL").length - 1).toBe(2);
  });

  test("binds the probe, now, the caps and the spread, then the rule's own", () => {
    const now: Date = new Date();

    expect(
      getClaimSetAsideParameters({
        probeId: PROBE_ID,
        currentDate: now,
        ruleParameters: ["a", ["b"]],
      }),
    ).toEqual([
      PROBE_ID.toString(),
      now,
      SET_ASIDE_PER_CLAIM,
      SET_ASIDE_FOR_MINUTES,
      SET_ASIDE_SPREAD_IN_MINUTES,
      "a",
      ["b"],
    ]);
    expect(SET_ASIDE_FIRST_RULE_PARAMETER).toBe(6);
  });

  test.each([
    [[{ setAside: 4, madeDue: 2 }], { setAside: 4, madeDue: 2 }],
    [[{ setAside: "4", madeDue: "2" }], { setAside: 4, madeDue: 2 }],
    [[], { setAside: 0, madeDue: 0 }],
    [[{}], { setAside: 0, madeDue: 0 }],
    [undefined, { setAside: 0, madeDue: 0 }],
    ["rows", { setAside: 0, madeDue: 0 }],
  ])("reads %j as %j", (rows: unknown, counts: SetAsideCounts) => {
    expect(readSetAsideCounts(rows)).toEqual(counts);
  });

  test("a round that fails is logged, never thrown", async () => {
    silenceLogs();

    await expect(
      setAsideAfterClaim({
        claim: "claimSomething",
        probeId: PROBE_ID,
        rows: "things nothing may claim now",
        round: async (): Promise<SetAsideCounts> => {
          throw new Error("connection terminated");
        },
      }),
    ).resolves.toBeUndefined();

    expect(
      loggedError(
        `claimSomething: could not set aside the due things nothing may claim now of probe ${PROBE_ID.toString()}`,
      ),
    ).toBe(true);
  });

  test("no more than SET_ASIDE_ROUNDS_PER_CLAIM rounds, however much each moves", async () => {
    silenceLogs();
    let rounds: number = 0;

    await setAsideAfterClaim({
      claim: "claimSomething",
      probeId: PROBE_ID,
      rows: "things",
      round: async (): Promise<SetAsideCounts> => {
        rounds++;
        return { setAside: SET_ASIDE_PER_CLAIM * 2, madeDue: 0 };
      },
    });

    expect(rounds).toBe(SET_ASIDE_ROUNDS_PER_CLAIM);
    expect(SET_ASIDE_ROUNDS_PER_CLAIM).toBeGreaterThan(1);
  });
});

describe("making a row due again", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A filter on a due time in the future would be read before a claim that
   * is setting the row aside right now commits, and leave it set aside.
   */
  test("moves every row named with LEAST, never filtered on a future due time", () => {
    const sql: string = normalizeSql(
      getMakeDueNowStatement({
        table: "Thing",
        dueColumns: ["nextAt", "otherAt"],
        idColumn: "parentId",
        where: `"kind" = 'Probe'`,
      }),
    );

    expect(sql).toBe(
      `UPDATE "Thing" SET "nextAt" = LEAST(COALESCE("nextAt", $2::timestamptz), $2::timestamptz), "otherAt" = LEAST(COALESCE("otherAt", $2::timestamptz), $2::timestamptz) WHERE "parentId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND "kind" = 'Probe'`,
    );
    expect(sql).not.toMatch(/"nextAt" >/);
  });

  test("binds only the ids that are ids, and nothing at all for none", () => {
    const now: Date = new Date();

    expect(
      getMakeDueNowParameters({
        ids: [CLOUD_ID, new ObjectID("not-an-id")],
        currentDate: now,
      }),
    ).toEqual([[CLOUD_ID.toString()], now]);
    expect(
      getMakeDueNowParameters({
        ids: [new ObjectID("not-an-id")],
        currentDate: now,
      }),
    ).toBeNull();
    expect(getMakeDueNowParameters({ ids: [], currentDate: now })).toBeNull();
  });

  test("an OpenStack cloud collected by a probe, by its id; one the agent sends is left as it is", async () => {
    const fake: ReturnType<typeof claimingService> = claimingService();
    const statements: Array<CapturedStatement> = captureClaimQueries(
      fake.service as never,
    );

    await OpenStackProbeCollectionStore.makeDueNow(
      fake.service as unknown as OpenStackCollectionCloudService,
      [CLOUD_ID],
    );
    await OpenStackProbeCollectionStore.makeDueNow(
      fake.service as unknown as OpenStackCollectionCloudService,
      [],
    );

    expect(statements).toHaveLength(1);
    expect(normalizeSql(statements[0]!.sql)).toBe(
      `UPDATE "OpenStackCloud" SET "nextCollectionAt" = LEAST(COALESCE("nextCollectionAt", $2::timestamptz), $2::timestamptz) WHERE "_id" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND "collectionMethod" = '${OpenStackCollectionMethod.Probe}'`,
    );
    expect(statements[0]!.parameters[0]).toEqual([CLOUD_ID.toString()]);
    expect(statements[0]!.parameters[1]).toBeInstanceOf(Date);
  });

  test("an OpenStack cloud's checks, both kinds, by their cloud or by their own id", async () => {
    const fake: ReturnType<typeof claimingService> = claimingService();
    const statements: Array<CapturedStatement> = captureClaimQueries(
      fake.service as never,
    );

    await OpenStackCheckStore.makeDueNow(
      fake.service as unknown as OpenStackCheckService,
      { ids: [CLOUD_ID], byCloud: true },
    );
    await OpenStackCheckStore.makeDueNow(
      fake.service as unknown as OpenStackCheckService,
      { ids: [new ObjectID(FIRST_ID)] },
    );

    expect(statements).toHaveLength(2);

    const byCloud: string = normalizeSql(statements[0]!.sql);

    expect(byCloud).toContain(
      'SET "nextApiCheckAt" = LEAST(COALESCE("nextApiCheckAt", $2::timestamptz), $2::timestamptz), "nextLifecycleCheckAt" = LEAST(COALESCE("nextLifecycleCheckAt", $2::timestamptz), $2::timestamptz)',
    );
    expect(byCloud).toContain('WHERE "openStackCloudId" = ANY($1::uuid[])');
    expect(normalizeSql(statements[1]!.sql)).toContain(
      'WHERE "_id" = ANY($1::uuid[])',
    );
  });

  test("a probe store, only in the columns asked for, only while a probe scans it", async () => {
    const statements: Array<CapturedStatement> =
      captureClaimQueries(DataStoreService);

    await DataStoreService.makeDueNow({
      dataStoreIds: [STORE_ID],
      dueColumns: ["nextContentScanAt", "notADueColumn"],
    });
    await DataStoreService.makeDueNowForProjects({
      projectIds: [PROJECT_ID],
      dueColumns: [...PROBE_STORE_DUE_COLUMNS],
    });
    await DataStoreService.makeDueNow({
      dataStoreIds: [STORE_ID],
      dueColumns: [],
    });

    expect(statements).toHaveLength(2);
    expect(normalizeSql(statements[0]!.sql)).toBe(
      'UPDATE "DataStore" SET "nextContentScanAt" = LEAST(COALESCE("nextContentScanAt", $2::timestamptz), $2::timestamptz) WHERE "_id" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND "scanProbeId" IS NOT NULL',
    );
    expect(normalizeSql(statements[1]!.sql)).toBe(
      'UPDATE "DataStore" SET "nextTableHealthCollectionAt" = LEAST(COALESCE("nextTableHealthCollectionAt", $2::timestamptz), $2::timestamptz), "nextContentScanAt" = LEAST(COALESCE("nextContentScanAt", $2::timestamptz), $2::timestamptz) WHERE "projectId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND "scanProbeId" IS NOT NULL',
    );
    expect(statements[1]!.parameters[0]).toEqual([PROJECT_ID.toString()]);
  });
});

describe("unarchiving an OpenStack cloud collects and checks it again at once", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [{ isArchived: false }, true],
    [{ isArchived: true }, false],
    [{ name: "lab" }, false],
    [{}, false],
    [null, false],
    ["isArchived", false],
  ])("%j is an unarchive: %s", (data: unknown, expected: boolean) => {
    expect(OpenStackCloudServiceType.isUnarchive(data)).toBe(expected);
  });

  async function runHook(data: Record<string, unknown>): Promise<{
    cloudDue: jest.SpyInstance;
    checksDue: jest.SpyInstance;
  }> {
    silenceLogs();

    const cloudDue: jest.SpyInstance = jest
      .spyOn(OpenStackProbeCollectionStore, "makeDueNow")
      .mockResolvedValue(undefined as never);
    const checksDue: jest.SpyInstance = jest
      .spyOn(OpenStackCheckStore, "makeDueNow")
      .mockResolvedValue(undefined as never);

    // The feed and the AI access steps are not under test here.
    jest
      .spyOn(
        OpenStackCloudService as unknown as {
          writeOpenStackCloudUpdatedFeed: () => Promise<void>;
        },
        "writeOpenStackCloudUpdatedFeed",
      )
      .mockResolvedValue(undefined as never);

    await (
      OpenStackCloudService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    )
      .onUpdateSuccess(
        {
          updateBy: { query: {}, data: data, props: { isRoot: true } },
          carryForward: null,
        },
        [CLOUD_ID],
      )
      .catch(() => {
        // What follows the step under test may need a database.
      });

    return { cloudDue, checksDue };
  }

  test("its collection and its checks are made due", async () => {
    const { cloudDue, checksDue } = await runHook({ isArchived: false });

    expect(cloudDue).toHaveBeenCalledWith(OpenStackCloudService, [CLOUD_ID]);
    expect(checksDue).toHaveBeenCalledWith(OpenStackCloudService, {
      ids: [CLOUD_ID],
      byCloud: true,
    });
  });

  test("archiving it makes nothing due", async () => {
    const { cloudDue, checksDue } = await runHook({ isArchived: true });

    expect(cloudDue).not.toHaveBeenCalled();
    expect(checksDue).not.toHaveBeenCalled();
  });

  test("a failure making them due is logged, never thrown into the write", async () => {
    silenceLogs();
    jest
      .spyOn(OpenStackProbeCollectionStore, "makeDueNow")
      .mockRejectedValue(new Error("database is down") as never);
    jest
      .spyOn(
        OpenStackCloudService as unknown as {
          writeOpenStackCloudUpdatedFeed: () => Promise<void>;
        },
        "writeOpenStackCloudUpdatedFeed",
      )
      .mockResolvedValue(undefined as never);

    await (
      OpenStackCloudService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    )
      .onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { isArchived: false },
            props: { isRoot: true },
          },
          carryForward: null,
        },
        [CLOUD_ID],
      )
      .catch(() => {
        // What follows the step under test may need a database.
      });

    expect(loggedError("could not make an unarchived cloud")).toBe(true);
  });
});

describe("a write that can make a probe store claimable makes it due now", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [{ isTableHealthEnabled: true }, ["nextTableHealthCollectionAt"]],
    [{ isContentScanEnabled: true }, ["nextContentScanAt"]],
    [{ isArchived: false }, [...PROBE_STORE_DUE_COLUMNS]],
    [{ probeConnectionVariable: "ORDERS_DB" }, [...PROBE_STORE_DUE_COLUMNS]],
    [{ scanProbeId: PROBE_ID }, [...PROBE_STORE_DUE_COLUMNS]],
    [{ scanProbe: { _id: PROBE_ID.toString() } }, [...PROBE_STORE_DUE_COLUMNS]],
    [
      { isTableHealthEnabled: true, isContentScanEnabled: true },
      [...PROBE_STORE_DUE_COLUMNS],
    ],
  ])("%j makes due %j", (data: Record<string, unknown>, columns: Array<string>) => {
    expect(DataStoreServiceType.getDueColumnsMadeClaimable(data)).toEqual(
      columns,
    );
  });

  test.each([
    [{ isTableHealthEnabled: false }],
    [{ isContentScanEnabled: false }],
    [{ isArchived: true }],
    [{ probeConnectionVariable: "" }],
    [{ probeConnectionVariable: null }],
    [{ scanProbeId: null }],
    [{ name: "orders" }],
    [{}],
  ])("%j makes nothing due", (data: Record<string, unknown>) => {
    expect(DataStoreServiceType.getDueColumnsMadeClaimable(data)).toEqual([]);
  });

  test.each([[null], [undefined], ["data"]])(
    "%j makes nothing due",
    (data: unknown) => {
      expect(DataStoreServiceType.getDueColumnsMadeClaimable(data)).toEqual([]);
    },
  );

  async function runUpdateHook(
    data: Record<string, unknown>,
  ): Promise<jest.SpyInstance> {
    silenceLogs();

    const makeDue: jest.SpyInstance = jest
      .spyOn(DataStoreService, "makeDueNow")
      .mockResolvedValue(undefined as never);

    await (
      DataStoreService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: { query: {}, data: data, props: { isRoot: true } },
        carryForward: [],
      },
      [STORE_ID],
    );

    return makeDue;
  }

  test("content scanning turned back on makes the store's content scan due", async () => {
    expect(
      await runUpdateHook({ isContentScanEnabled: true }),
    ).toHaveBeenCalledWith({
      dataStoreIds: [STORE_ID],
      dueColumns: ["nextContentScanAt"],
    });
  });

  test("table health watched again makes its collection due", async () => {
    expect(
      await runUpdateHook({ isTableHealthEnabled: true }),
    ).toHaveBeenCalledWith({
      dataStoreIds: [STORE_ID],
      dueColumns: ["nextTableHealthCollectionAt"],
    });
  });

  test("but turning either off makes nothing due", async () => {
    expect(
      await runUpdateHook({
        isContentScanEnabled: false,
        isTableHealthEnabled: false,
      }),
    ).not.toHaveBeenCalled();
  });

  test("a failure making it due is logged, never thrown into the write", async () => {
    silenceLogs();
    jest
      .spyOn(DataStoreService, "makeDueNow")
      .mockRejectedValue(new Error("database is down") as never);

    await expect(
      (
        DataStoreService as unknown as {
          onUpdateSuccess: (
            onUpdate: unknown,
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { isArchived: false },
            props: { isRoot: true },
          },
          carryForward: [],
        },
        [STORE_ID],
      ),
    ).resolves.toBeDefined();

    expect(loggedError("could not make probe stores due")).toBe(true);
  });

  /*
   * The claims read only rows with a due time, so a new store a probe scans
   * would otherwise wait for a set-aside to give it one.
   */
  test("a new store a probe scans is due for both at once; one no probe scans is not touched", async () => {
    silenceLogs();

    const makeDue: jest.SpyInstance = jest
      .spyOn(DataStoreService, "makeDueNow")
      .mockResolvedValue(undefined as never);

    // What else a create does is not under test here.
    jest
      .spyOn(
        DataStoreService as unknown as {
          writeCreatedFeed: () => Promise<void>;
        },
        "writeCreatedFeed",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DataStoreLabelRuleEngineService, "applyRulesToDataStore")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DataStoreOwnerRuleEngineService, "applyRulesToDataStore")
      .mockResolvedValue(undefined as never);

    const onCreateSuccess: (
      onCreate: unknown,
      created: unknown,
    ) => Promise<unknown> = (
      DataStoreService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          created: unknown,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess.bind(DataStoreService);

    await onCreateSuccess(
      { createBy: { data: {}, props: { isRoot: true } }, carryForward: null },
      { id: STORE_ID, projectId: PROJECT_ID, scanProbeId: PROBE_ID },
    );
    await onCreateSuccess(
      { createBy: { data: {}, props: { isRoot: true } }, carryForward: null },
      { id: STORE_ID, projectId: PROJECT_ID },
    );

    expect(makeDue).toHaveBeenCalledTimes(1);
    expect(makeDue).toHaveBeenCalledWith({
      dataStoreIds: [STORE_ID],
      dueColumns: [...PROBE_STORE_DUE_COLUMNS],
    });
    expect(queueDataSecurityEvaluation).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("a project turning content scanning back on makes its probe stores due", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runHook(data: Record<string, unknown>): Promise<{
    makeDue: jest.SpyInstance;
    findBy: jest.SpyInstance;
  }> {
    silenceLogs();

    const makeDue: jest.SpyInstance = jest
      .spyOn(DataStoreService, "makeDueNowForProjects")
      .mockResolvedValue(undefined as never);
    const findBy: jest.SpyInstance = jest
      .spyOn(DataSecuritySettingService, "findBy")
      .mockResolvedValue([{ projectId: PROJECT_ID }] as never);

    await (
      DataSecuritySettingService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: { query: {}, data: data, props: { isRoot: true } },
        carryForward: undefined,
      },
      [new ObjectID(FIRST_ID)],
    );

    return { makeDue, findBy };
  }

  test("turned on: the content scans of the project's probe stores", async () => {
    const { makeDue } = await runHook({ isContentScanEnabled: true });

    expect(makeDue).toHaveBeenCalledWith({
      projectIds: [PROJECT_ID],
      dueColumns: ["nextContentScanAt"],
    });
  });

  test("turned off, or another setting changed: nothing", async () => {
    const off: { makeDue: jest.SpyInstance; findBy: jest.SpyInstance } =
      await runHook({ isContentScanEnabled: false });

    expect(off.makeDue).not.toHaveBeenCalled();
    expect(off.findBy).not.toHaveBeenCalled();

    jest.restoreAllMocks();

    const other: { makeDue: jest.SpyInstance; findBy: jest.SpyInstance } =
      await runHook({ maxRowsPerTable: 500 });

    expect(other.makeDue).not.toHaveBeenCalled();
  });

  test("a failure is logged, never thrown into the write", async () => {
    silenceLogs();
    jest
      .spyOn(DataSecuritySettingService, "findBy")
      .mockRejectedValue(new Error("database is down") as never);

    await expect(
      (
        DataSecuritySettingService as unknown as {
          onUpdateSuccess: (
            onUpdate: unknown,
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { isContentScanEnabled: true },
            props: { isRoot: true },
          },
          carryForward: undefined,
        },
        [new ObjectID(FIRST_ID)],
      ),
    ).resolves.toBeDefined();

    expect(loggedError("could not make a project's probe stores due")).toBe(
      true,
    );
  });
});
