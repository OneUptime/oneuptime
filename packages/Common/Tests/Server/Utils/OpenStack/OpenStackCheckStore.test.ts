import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackCheckStore, {
  OpenStackCheckRecord,
  OpenStackCheckReportOutcome,
  OpenStackCheckService,
  getOpenStackCheckKey,
  mergeOpenStackLifecycleRuns,
  sanitizeOpenStackApiCheckResult,
  sanitizeOpenStackCheckFault,
  sanitizeOpenStackLifecycleRun,
} from "../../../../Server/Utils/OpenStack/OpenStackCheckStore";
import { OpenStackSqlManager } from "../../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import { SubscriptionStatusUtil } from "../../../../Types/Billing/SubscriptionStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  OPENSTACK_LIFECYCLE_RUNS_KEPT,
  OpenStackApiCheckJob,
  OpenStackApiCheckResult,
  OpenStackCertificateResult,
  OpenStackCheckReport,
  OpenStackLifecycleCheckJob,
  OpenStackLifecyclePhase,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRun,
  OpenStackLifecycleRunBrief,
  OpenStackLifecycleStep,
} from "../../../../Types/OpenStack/OpenStackCheck";
import OpenStackCollectionMethod from "../../../../Types/OpenStack/OpenStackCollectionMethod";
import { isOpenStackCheckKey } from "../../../../Utils/OpenStack/OpenStackCheckName";
import {
  getOpenStackCheckBinding,
  getOpenStackCheckConnection,
} from "../../../../Utils/OpenStack/OpenStackCheckSettings";

/*
 * Which checks a probe is handed and what becomes of what it reports. The SQL that claims them is in
 * OpenStackCheckSqlPostgres.test.ts: here the claim's answer is scripted, and what is tested is what
 * goes out with a job, above all which credential.
 */

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CHECK_ID: string = "44444444-4444-4444-8444-444444444444";
const CLOUD_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const NOW: Date = new Date("2026-11-05T10:00:00.000Z");

const CLOUD: NonNullable<OpenStackCheckRecord["openStackCloud"]> = {
  _id: CLOUD_ID.toString(),
  name: "Lab",
  collectionMethod: OpenStackCollectionMethod.Probe,
  collectionProbeId: PROBE_ID,
  collectionProbe: { isGlobalProbe: false, projectId: PROJECT_ID },
  authUrl: "https://keystone.example.com:5000",
  endpointInterface: "public",
  collectionRegions: ["RegionOne"],
  trustedCertificateFingerprints: [],
  credentialKind: "applicationCredential",
  applicationCredentialId: "the-clouds-credential",
  credentialSecret: "the-clouds-secret",
  isCredentialSet: true,
};

function bindingOf(cloud: typeof CLOUD): JSONObject {
  return getOpenStackCheckBinding(
    getOpenStackCheckConnection({ check: {}, cloud: cloud }),
  ) as unknown as JSONObject;
}

function checkOf(
  overrides: Partial<OpenStackCheckRecord> = {},
): OpenStackCheckRecord {
  return {
    _id: CHECK_ID,
    projectId: PROJECT_ID,
    openStackCloudId: CLOUD_ID,
    isApiCheckEnabled: true,
    apiCheckIntervalInMinutes: 1,
    isLifecycleCheckEnabled: true,
    lifecycleCheckIntervalInMinutes: 30,
    lifecycleProjectName: "oneuptime-checks",
    credentialKind: "applicationCredential",
    applicationCredentialId: "the-checks-credential",
    credentialSecret: "the-checks-secret",
    isCredentialSet: true,
    credentialBinding: bindingOf(CLOUD),
    settingsVersion: 4,
    openStackCloud: CLOUD,
    ...overrides,
  };
}

interface FakeService extends OpenStackCheckService {
  updates: Array<Record<string, unknown>>;
  // Every statement the claim sent, as it sent it.
  statements: Array<{ sql: string; parameters: Array<unknown> }>;
}

function serviceWith(check: OpenStackCheckRecord | null): FakeService {
  const updates: Array<Record<string, unknown>> = [];
  const statements: Array<{ sql: string; parameters: Array<unknown> }> = [];

  return {
    updates: updates,
    statements: statements,
    // No transaction to open: the claim is one self-committing statement.
    getRepository: (): { manager: OpenStackSqlManager } => {
      return {
        manager: {
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            statements.push({ sql: sql, parameters: parameters });
            return check ? [{ _id: check._id }] : [];
          },
        },
      };
    },
    findBy: async (): Promise<Array<OpenStackCheckRecord>> => {
      return check ? [check] : [];
    },
    findOneById: async (): Promise<OpenStackCheckRecord | null> => {
      return check;
    },
    updateColumnsByIdWithoutHooks: async (options: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<unknown> => {
      updates.push(options.data);
      return undefined;
    },
  };
}

function runOf(
  overrides: Partial<OpenStackLifecycleRun> = {},
): OpenStackLifecycleRun {
  return {
    runId: "20261105095000-abcdef",
    regionName: "RegionOne",
    startedAt: "2026-11-05T09:50:00.000Z",
    finishedAt: "2026-11-05T09:55:00.000Z",
    status: "Succeeded",
    steps: [
      {
        step: OpenStackLifecycleStep.ServerActive,
        status: "Passed",
        durationInMs: 42_000,
      },
    ],
    phases: {
      [OpenStackLifecyclePhase.Boot]: "Passed",
      [OpenStackLifecyclePhase.Volume]: "Passed",
    },
    leftoverCount: 0,
    verifiedProjectId: "the-project-id",
    verifiedProjectName: "oneuptime-checks",
    requestCount: 20,
    writeCount: 2,
    warnings: [],
    ...overrides,
  };
}

function reportOf(
  overrides: Partial<OpenStackCheckReport> = {},
): OpenStackCheckReport {
  return {
    openStackCloudCheckId: CHECK_ID,
    settingsVersion: 4,
    kind: "lifecycle",
    lifecycle: [runOf()],
    ...overrides,
  };
}

function metricNamesOf(outcome: OpenStackCheckReportOutcome): Array<string> {
  const names: Array<string> = [];

  for (const resource of (outcome.resourceMetrics || []) as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        names.push(metric["name"] as string);
      }
    }
  }

  return names.sort();
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("a check's key", () => {
  test("is twelve hex characters of a hash, the same whatever case its id is in", () => {
    const key: string = getOpenStackCheckKey(CHECK_ID);

    expect(isOpenStackCheckKey(key)).toBe(true);
    expect(getOpenStackCheckKey(CHECK_ID.toUpperCase())).toBe(key);
    expect(getOpenStackCheckKey(CLOUD_ID.toString())).not.toBe(key);
  });
});

describe("the API check a probe is handed", () => {
  test("uses the cloud's credential when it has none of its own, on the very connection it is collected on", async () => {
    const jobs: Array<OpenStackApiCheckJob> =
      await OpenStackCheckStore.claimApiChecks(
        serviceWith(
          checkOf({
            credentialSecret: undefined,
            isCredentialSet: false,
            credentialBinding: undefined,
            isLifecycleCheckEnabled: false,
          }),
        ),
        { probeId: PROBE_ID, runningIds: [], limit: 4 },
      );

    expect(jobs).toEqual([
      {
        openStackCloudCheckId: CHECK_ID,
        openStackCloudId: CLOUD_ID.toString(),
        cloudName: "Lab",
        authUrl: "https://keystone.example.com:5000",
        regions: ["RegionOne"],
        endpointInterface: "public",
        trustedCertificateFingerprints: [],
        settingsVersion: 4,
        credential: {
          kind: "applicationCredential",
          id: "the-clouds-credential",
          secret: "the-clouds-secret",
        },
        intervalInMinutes: 1,
      },
    ]);
  });

  test("uses its own when it has one", async () => {
    const jobs: Array<OpenStackApiCheckJob> =
      await OpenStackCheckStore.claimApiChecks(serviceWith(checkOf()), {
        probeId: PROBE_ID,
        runningIds: [],
        limit: 4,
      });

    expect(jobs[0]?.credential).toEqual({
      kind: "applicationCredential",
      id: "the-checks-credential",
      secret: "the-checks-secret",
    });
  });

  test("never sends the cloud's credential through a probe other than the one that collects it", async () => {
    const service: FakeService = serviceWith(
      checkOf({
        probeId: OTHER_PROBE_ID,
        credentialSecret: undefined,
        isCredentialSet: false,
        credentialBinding: undefined,
      }),
    );

    expect(
      await OpenStackCheckStore.claimApiChecks(service, {
        probeId: OTHER_PROBE_ID,
        runningIds: [],
        limit: 4,
      }),
    ).toEqual([]);
    expect(String(service.updates[0]?.["checkError"])).toContain(
      "another probe",
    );
  });

  test("never sends its own credential anywhere but where it was entered for", async () => {
    const service: FakeService = serviceWith(
      checkOf({
        credentialBinding: bindingOf({
          ...CLOUD,
          authUrl: "https://elsewhere.example.com",
        }),
      }),
    );

    expect(
      await OpenStackCheckStore.claimApiChecks(service, {
        probeId: PROBE_ID,
        runningIds: [],
        limit: 4,
      }),
    ).toEqual([]);
    expect(String(service.updates[0]?.["checkError"])).toContain(
      "Enter the credential again",
    );
  });

  test("a cloud switched to the agent has nothing to run with, and it says so", async () => {
    const service: FakeService = serviceWith(
      checkOf({
        credentialSecret: undefined,
        isCredentialSet: false,
        openStackCloud: {
          ...CLOUD,
          collectionMethod: OpenStackCollectionMethod.Agent,
          authUrl: undefined,
        },
      }),
    );

    expect(
      await OpenStackCheckStore.claimApiChecks(service, {
        probeId: PROBE_ID,
        runningIds: [],
        limit: 4,
      }),
    ).toEqual([]);
    expect(String(service.updates[0]?.["checkError"])).toContain(
      "Keystone's address",
    );
  });

  test("no room is no claim", async () => {
    const service: FakeService = serviceWith(checkOf());

    expect(
      await OpenStackCheckStore.claimApiChecks(service, {
        probeId: PROBE_ID,
        runningIds: [],
        limit: 0,
      }),
    ).toEqual([]);
    expect(service.statements).toEqual([]);
  });
});

/*
 * A claim is one self-committing statement (OneUptime issue #7194): the due
 * checks locked FOR NO KEY UPDATE SKIP LOCKED and moved an interval on by
 * the same statement, so no check stays locked past it, and the foreign-key
 * check of a row naming one never waits. A real Postgres runs it in
 * OpenStackProbeCollectionSqlPostgres.
 */
describe("the claim's one statement", () => {
  const OTHER_CHECK_ID: string = "66666666-6666-4666-8666-666666666666";

  test("an API check claim takes the API checks that are due, and moves each by its own API interval", async () => {
    const service: FakeService = serviceWith(checkOf());

    await OpenStackCheckStore.claimApiChecks(service, {
      probeId: PROBE_ID,
      runningIds: [OTHER_CHECK_ID, "not-an-id"],
      limit: 3,
    });

    // The claim, then the set-aside of what it stepped over (ClaimSetAside).
    expect(service.statements).toHaveLength(2);
    expect(service.statements[1]!.sql).toContain('"unclaimable" AS (');
    const statement: { sql: string; parameters: Array<unknown> } =
      service.statements[0]!;
    const sql: string = statement.sql.replace(/\s+/g, " ");

    expect(sql).toContain("FOR NO KEY UPDATE OF ck SKIP LOCKED");
    expect(sql).not.toMatch(/FOR UPDATE/);
    expect(sql).toContain('ck."isApiCheckEnabled" = true');
    // Each branch a range of an index, oldest first: no IS NULL OR, no NULLS FIRST.
    expect(sql).toContain('ck."nextApiCheckAt" <= $2');
    expect(sql).not.toMatch(/"nextApiCheckAt" IS NULL OR/);
    expect(sql).toContain('NOT (ck."_id" = ANY($5::uuid[]))');
    expect(sql).toContain('ORDER BY ck."nextApiCheckAt" ASC LIMIT $3');
    expect(sql).not.toContain("NULLS FIRST");
    // getSafeApiInterval's rule: a whole minute or more, else the default.
    expect(sql).toContain(
      'UPDATE "OpenStackCloudCheck" AS ck SET "nextApiCheckAt" = $2::timestamptz + ( CASE WHEN ck."apiCheckIntervalInMinutes" >= 1 THEN ck."apiCheckIntervalInMinutes" ELSE $7::int END ) * INTERVAL \'1 minute\'',
    );
    // Only what the statement wrote is answered, the longest overdue first.
    expect(sql).toContain(
      'INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id" ORDER BY "due"."dueAt" ASC',
    );

    expect(statement.parameters[0]).toBe(PROBE_ID.toString());
    expect(statement.parameters[1]).toBeInstanceOf(Date);
    expect(statement.parameters[2]).toBe(3);
    expect(statement.parameters[3]).toEqual(
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    );
    // Only real ids reach the statement - as a bound array, never as SQL.
    expect(statement.parameters[4]).toEqual([OTHER_CHECK_ID]);
    expect(statement.parameters[5]).toBe(IsBillingEnabled);
    expect(statement.parameters[6]).toBe(
      DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
    );
  });

  test("a lifecycle check claim takes a pending sweep too, and moves each by its own lifecycle interval", async () => {
    const service: FakeService = serviceWith(checkOf());

    await OpenStackCheckStore.claimLifecycleChecks(service, {
      probeId: PROBE_ID,
      runningIds: [],
      limit: 2,
    });

    // The claim, then the set-aside of what it stepped over (ClaimSetAside).
    expect(service.statements).toHaveLength(2);
    const statement: { sql: string; parameters: Array<unknown> } =
      service.statements[0]!;
    const sql: string = statement.sql.replace(/\s+/g, " ");

    expect(sql).toContain("FOR NO KEY UPDATE OF ck SKIP LOCKED");
    expect(sql).not.toMatch(/FOR UPDATE/);
    expect(sql).toContain(
      '(ck."isLifecycleCheckEnabled" = true OR ck."isSweepPending" = true)',
    );
    expect(sql).toContain('ck."nextLifecycleCheckAt" <= $2');
    expect(sql).not.toMatch(/"nextLifecycleCheckAt" IS NULL OR/);
    expect(sql).toContain(
      'UPDATE "OpenStackCloudCheck" AS ck SET "nextLifecycleCheckAt" = $2::timestamptz + ( CASE WHEN ck."lifecycleCheckIntervalInMinutes" >= 1 THEN ck."lifecycleCheckIntervalInMinutes" ELSE $7::int END ) * INTERVAL \'1 minute\'',
    );
    expect(sql).not.toContain("nextApiCheckAt");
    expect(statement.parameters[2]).toBe(2);
    expect(statement.parameters[6]).toBe(
      DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
    );
  });

  test("nothing claimed reads nothing back", async () => {
    const service: FakeService = serviceWith(null);
    const read: ReturnType<typeof jest.fn> = jest.fn();
    service.findBy = read as unknown as OpenStackCheckService["findBy"];

    expect(
      await OpenStackCheckStore.claimApiChecks(service, {
        probeId: PROBE_ID,
        runningIds: [],
        limit: 4,
      }),
    ).toEqual([]);
    // The claim, and the set-aside of what it stepped over.
    expect(service.statements).toHaveLength(2);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the lifecycle check a probe is handed", () => {
  test("carries what a run needs, and only ever its own credential", async () => {
    const jobs: Array<OpenStackLifecycleCheckJob> =
      await OpenStackCheckStore.claimLifecycleChecks(
        serviceWith(
          checkOf({
            pinnedLifecycleProjectId: "the-project-id",
            osProfilerKey: "the-key",
            lifecycleCheckOptions: {
              isVolumeEnabled: true,
              volumeSizeInGiB: 2,
            },
          }),
        ),
        { probeId: PROBE_ID, runningIds: [], limit: 4 },
      );

    expect(jobs).toEqual([
      expect.objectContaining({
        openStackCloudCheckId: CHECK_ID,
        credential: {
          kind: "applicationCredential",
          id: "the-checks-credential",
          secret: "the-checks-secret",
        },
        intervalInMinutes: 30,
        checkKey: getOpenStackCheckKey(CHECK_ID),
        expectedProjectName: "oneuptime-checks",
        pinnedProjectId: "the-project-id",
        osProfilerKey: "the-key",
        options: { isVolumeEnabled: true, volumeSizeInGiB: 2 },
      }),
    ]);
    expect(jobs[0]?.isSweepOnly).toBeUndefined();
  });

  test("with no credential of its own it is not handed out, whatever the cloud has", async () => {
    const service: FakeService = serviceWith(
      checkOf({ credentialSecret: undefined, isCredentialSet: false }),
    );

    expect(
      await OpenStackCheckStore.claimLifecycleChecks(service, {
        probeId: PROBE_ID,
        runningIds: [],
        limit: 4,
      }),
    ).toEqual([]);
    expect(String(service.updates[0]?.["checkError"])).toContain(
      "credential of its own",
    );
  });

  test("nor without a project, nor where its credential was not entered for", async () => {
    expect(
      await OpenStackCheckStore.claimLifecycleChecks(
        serviceWith(checkOf({ lifecycleProjectName: undefined })),
        { probeId: PROBE_ID, runningIds: [], limit: 4 },
      ),
    ).toEqual([]);

    expect(
      await OpenStackCheckStore.claimLifecycleChecks(
        serviceWith(
          checkOf({
            credentialBinding: bindingOf({
              ...CLOUD,
              collectionProbeId: OTHER_PROBE_ID,
            }),
          }),
        ),
        { probeId: PROBE_ID, runningIds: [], limit: 4 },
      ),
    ).toEqual([]);
  });

  test("turned off with a sweep to do, it only sweeps", async () => {
    const jobs: Array<OpenStackLifecycleCheckJob> =
      await OpenStackCheckStore.claimLifecycleChecks(
        serviceWith(
          checkOf({ isLifecycleCheckEnabled: false, isSweepPending: true }),
        ),
        { probeId: PROBE_ID, runningIds: [], limit: 4 },
      );

    expect(jobs[0]?.isSweepOnly).toBe(true);
  });

  test("with no regions set it speaks for those it last found, should it fail to log in", async () => {
    const jobs: Array<OpenStackLifecycleCheckJob> =
      await OpenStackCheckStore.claimLifecycleChecks(
        serviceWith(
          checkOf({
            openStackCloud: { ...CLOUD, collectionRegions: [] },
            lifecycleRecords: {
              One: { regionName: "One", phaseVerdicts: {}, recent: [] },
              "": { regionName: "", phaseVerdicts: {}, recent: [] },
            },
          }),
        ),
        { probeId: PROBE_ID, runningIds: [], limit: 4 },
      );

    expect(jobs[0]?.regions).toEqual(["One"]);
  });
});

describe("what a probe reports", () => {
  test("only the probe that runs this check is heard", async () => {
    expect(
      await OpenStackCheckStore.recordReport(serviceWith(checkOf()), {
        probeId: OTHER_PROBE_ID,
        report: reportOf(),
        scopeVersion: "1",
        now: NOW,
      }),
    ).toMatchObject({ accepted: false });
  });

  test("a report of settings that have since changed is dropped", async () => {
    const service: FakeService = serviceWith(checkOf());

    expect(
      await OpenStackCheckStore.recordReport(service, {
        probeId: PROBE_ID,
        report: reportOf({ settingsVersion: 3 }),
        scopeVersion: "1",
        now: NOW,
      }),
    ).toMatchObject({ accepted: false });
    expect(service.updates).toEqual([]);
  });

  test("a report naming no check, or a check that is gone, is refused", async () => {
    expect(
      await OpenStackCheckStore.recordReport(serviceWith(checkOf()), {
        probeId: PROBE_ID,
        report: reportOf({ openStackCloudCheckId: "not-an-id" }),
        scopeVersion: "1",
      }),
    ).toMatchObject({ accepted: false });

    expect(
      await OpenStackCheckStore.recordReport(serviceWith(null), {
        probeId: PROBE_ID,
        report: reportOf(),
        scopeVersion: "1",
      }),
    ).toMatchObject({ accepted: false });
  });

  test("another project's probe is not heard, even if a stale row names it", async () => {
    expect(
      await OpenStackCheckStore.recordReport(
        serviceWith(
          checkOf({
            openStackCloud: {
              ...CLOUD,
              collectionProbe: {
                isGlobalProbe: false,
                projectId: new ObjectID("66666666-6666-4666-8666-666666666666"),
              },
            },
          }),
        ),
        {
          probeId: PROBE_ID,
          report: reportOf(),
          scopeVersion: "1",
        },
      ),
    ).toMatchObject({ accepted: false });
  });

  test("an API check is kept, and goes out with what the last lifecycle run said", async () => {
    const service: FakeService = serviceWith(
      checkOf({
        lifecycleRecords: mergeOpenStackLifecycleRuns({
          records: undefined,
          runs: [runOf({ finishedAt: "2026-11-05T09:55:00.000Z" })],
        }),
      }),
    );

    const outcome: OpenStackCheckReportOutcome =
      await OpenStackCheckStore.recordReport(service, {
        probeId: PROBE_ID,
        report: reportOf({
          kind: "api",
          lifecycle: undefined,
          api: {
            startedAt: NOW.toISOString(),
            durationInMs: 1,
            regionNames: ["RegionOne"],
            token: { status: "Passed", durationInMs: 1 },
            services: [],
            certificates: [],
            warnings: [],
          },
        }),
        scopeVersion: "1",
        now: NOW,
      });

    expect(outcome.accepted).toBe(true);
    expect(service.updates[0]?.["lastApiCheckAt"]).toEqual(NOW);
    expect(metricNamesOf(outcome)).toEqual(
      expect.arrayContaining([
        "openstack_check_token_success",
        "openstack_check_lifecycle_success",
        "openstack_check_lifecycle_phase_success",
      ]),
    );
  });

  test("a lifecycle run is kept, and pins the project it verified, once", async () => {
    const service: FakeService = serviceWith(checkOf());

    const outcome: OpenStackCheckReportOutcome =
      await OpenStackCheckStore.recordReport(service, {
        probeId: PROBE_ID,
        report: reportOf(),
        scopeVersion: "1",
        now: NOW,
      });

    expect(outcome.accepted).toBe(true);
    expect(service.updates[0]).toMatchObject({
      lastLifecycleCheckAt: NOW,
      pinnedLifecycleProjectId: "the-project-id",
    });

    const records: OpenStackLifecycleRecords = service.updates[0]?.[
      "lifecycleRecords"
    ] as OpenStackLifecycleRecords;

    expect(records["RegionOne"]?.lastVerdict?.status).toBe("Succeeded");
    expect(metricNamesOf(outcome)).toContain(
      "openstack_check_lifecycle_success",
    );

    const repeat: FakeService = serviceWith(
      checkOf({ pinnedLifecycleProjectId: "already" }),
    );

    await OpenStackCheckStore.recordReport(repeat, {
      probeId: PROBE_ID,
      report: reportOf(),
      scopeVersion: "1",
      now: NOW,
    });

    expect(repeat.updates[0]?.["pinnedLifecycleProjectId"]).toBeUndefined();
  });

  test("a refused run pins nothing", async () => {
    const service: FakeService = serviceWith(checkOf());

    await OpenStackCheckStore.recordReport(service, {
      probeId: PROBE_ID,
      report: reportOf({
        lifecycle: [runOf({ status: "Refused", message: "No." })],
      }),
      scopeVersion: "1",
      now: NOW,
    });

    expect(service.updates[0]?.["pinnedLifecycleProjectId"]).toBeUndefined();
  });

  test("a sweep that finds nothing left ends the sweep, and forgets the secret and the key", async () => {
    const service: FakeService = serviceWith(
      checkOf({
        isApiCheckEnabled: false,
        isLifecycleCheckEnabled: false,
        isSweepPending: true,
      }),
    );

    await OpenStackCheckStore.recordReport(service, {
      probeId: PROBE_ID,
      report: reportOf({
        lifecycle: [
          runOf({
            status: "Swept",
            janitor: { removed: [], remainingCount: 0, errors: [] },
          }),
        ],
      }),
      scopeVersion: "1",
      now: NOW,
    });

    expect(service.updates[0]).toMatchObject({
      isSweepPending: false,
      credentialSecret: null,
      osProfilerKey: null,
      isCredentialSet: false,
      isOsProfilerKeySet: false,
    });
  });

  test("a sweep that leaves something goes on, with the secret", async () => {
    const service: FakeService = serviceWith(
      checkOf({
        isApiCheckEnabled: false,
        isLifecycleCheckEnabled: false,
        isSweepPending: true,
      }),
    );

    await OpenStackCheckStore.recordReport(service, {
      probeId: PROBE_ID,
      report: reportOf({
        lifecycle: [
          runOf({
            status: "Swept",
            janitor: { removed: [], remainingCount: 2, errors: [] },
          }),
        ],
      }),
      scopeVersion: "1",
      now: NOW,
    });

    expect(service.updates[0]?.["isSweepPending"]).toBeUndefined();
    expect(service.updates[0]?.["credentialSecret"]).toBeUndefined();
  });

  test("what cannot be a report is refused without being kept", async () => {
    const service: FakeService = serviceWith(checkOf());

    for (const report of [
      reportOf({ kind: "api", api: undefined }),
      reportOf({ lifecycle: [] }),
      reportOf({ lifecycle: [{ runId: "x" } as OpenStackLifecycleRun] }),
      reportOf({ kind: "nonsense" as never }),
    ]) {
      expect(
        await OpenStackCheckStore.recordReport(service, {
          probeId: PROBE_ID,
          report: report,
          scopeVersion: "1",
          now: NOW,
        }),
      ).toMatchObject({ accepted: false });
    }

    expect(service.updates).toEqual([]);
  });
});

describe("what a region's record comes to", () => {
  test("a failed run is the verdict, and each phase it reached says so", () => {
    const records: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: undefined,
      runs: [
        runOf({
          status: "Failed",
          failedStep: OpenStackLifecycleStep.ServerActive,
          fault: { source: "nova", code: 500, message: "No valid host." },
          phases: {
            [OpenStackLifecyclePhase.Boot]: "Failed",
            [OpenStackLifecyclePhase.Volume]: "NotReached",
            [OpenStackLifecyclePhase.FloatingIp]: "Off",
          },
        }),
      ],
    });

    expect(records["RegionOne"]?.lastVerdict?.fault?.message).toBe(
      "No valid host.",
    );
    expect(records["RegionOne"]?.phaseVerdicts).toEqual({
      [OpenStackLifecyclePhase.Boot]: "Failed",
    });
    expect(records["RegionOne"]?.recent[0]).toMatchObject({
      status: "Failed",
      failedStep: OpenStackLifecycleStep.ServerActive,
    });
  });

  test("a phase a run did not reach keeps what it last came to, and one turned off goes", () => {
    const first: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: undefined,
      runs: [
        runOf({
          phases: {
            [OpenStackLifecyclePhase.Boot]: "Passed",
            [OpenStackLifecyclePhase.Volume]: "Failed",
            [OpenStackLifecyclePhase.FloatingIp]: "Passed",
          },
        }),
      ],
    });

    const second: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: first,
      runs: [
        runOf({
          status: "Failed",
          phases: {
            [OpenStackLifecyclePhase.Boot]: "Failed",
            [OpenStackLifecyclePhase.Volume]: "NotReached",
            [OpenStackLifecyclePhase.FloatingIp]: "Off",
          },
        }),
      ],
    });

    expect(second["RegionOne"]?.phaseVerdicts).toEqual({
      [OpenStackLifecyclePhase.Boot]: "Failed",
      [OpenStackLifecyclePhase.Volume]: "Failed",
    });
  });

  test("an attempt with no verdict says nothing of the cloud: the verdict stands beside it", () => {
    const first: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: undefined,
      runs: [runOf()],
    });

    const second: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: first,
      runs: [runOf({ status: "Skipped", message: "Later." })],
    });

    expect(second["RegionOne"]?.lastVerdict?.status).toBe("Succeeded");
    expect(second["RegionOne"]?.lastAttempt?.status).toBe("Skipped");

    const third: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: second,
      runs: [runOf()],
    });

    expect(third["RegionOne"]?.lastAttempt).toBeUndefined();
  });

  test("a run that knew no region speaks for those it already knows, or for none", () => {
    const known: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: undefined,
      runs: [runOf({ regionName: "One" }), runOf({ regionName: "Two" })],
    });

    const failed: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: known,
      runs: [runOf({ regionName: "", status: "Failed" })],
    });

    expect(Object.keys(failed).sort()).toEqual(["One", "Two"]);
    expect(failed["One"]?.lastVerdict?.status).toBe("Failed");

    expect(
      Object.keys(
        mergeOpenStackLifecycleRuns({
          records: undefined,
          runs: [runOf({ regionName: "", status: "Failed" })],
        }),
      ),
    ).toEqual([""]);
  });

  test("a region no longer run in goes, so it stops being said", () => {
    const known: OpenStackLifecycleRecords = mergeOpenStackLifecycleRuns({
      records: undefined,
      runs: [runOf({ regionName: "One" }), runOf({ regionName: "Two" })],
    });

    expect(
      Object.keys(
        mergeOpenStackLifecycleRuns({
          records: known,
          runs: [runOf({ regionName: "One" })],
        }),
      ),
    ).toEqual(["One"]);
  });

  test("keeps so many runs, newest first", () => {
    let records: OpenStackLifecycleRecords | undefined = undefined;

    for (
      let index: number = 0;
      index < OPENSTACK_LIFECYCLE_RUNS_KEPT + 5;
      index++
    ) {
      records = mergeOpenStackLifecycleRuns({
        records: records,
        runs: [runOf({ runId: `run-${index}` })],
      });
    }

    const recent: Array<OpenStackLifecycleRunBrief> =
      records!["RegionOne"]!.recent;

    expect(recent).toHaveLength(OPENSTACK_LIFECYCLE_RUNS_KEPT);
    expect(recent[0]?.runId).toBe(`run-${OPENSTACK_LIFECYCLE_RUNS_KEPT + 4}`);
  });
});

describe("what a report may hold, whatever a probe sent", () => {
  test("a fault is a known source, a whole code and a bounded message", () => {
    expect(
      sanitizeOpenStackCheckFault({
        source: "nova",
        code: 500,
        message: "No valid host.",
      }),
    ).toEqual({ source: "nova", code: 500, message: "No valid host." });

    expect(
      sanitizeOpenStackCheckFault({ source: "<script>", message: "x" }),
    ).toEqual({ source: "probe", message: "x" });

    expect(
      sanitizeOpenStackCheckFault({
        source: "nova",
        message: "x".repeat(5000),
      })?.message.length,
    ).toBe(1000);

    expect(sanitizeOpenStackCheckFault({ source: "nova" })).toBeUndefined();
    expect(sanitizeOpenStackCheckFault("text")).toBeUndefined();
  });

  test("a run with an unknown step or status is held to what is known", () => {
    expect(sanitizeOpenStackLifecycleRun(null)).toBeNull();
    expect(
      sanitizeOpenStackLifecycleRun({ ...runOf(), status: "Great" }),
    ).toBeNull();
    expect(
      sanitizeOpenStackLifecycleRun({ ...runOf(), startedAt: "whenever" }),
    ).toBeNull();

    const run: OpenStackLifecycleRun | null = sanitizeOpenStackLifecycleRun({
      ...runOf(),
      steps: [
        { step: "made_up", status: "Passed", durationInMs: 1 },
        { step: "server_active", status: "Odd", durationInMs: -5 },
      ],
      phases: { boot: "Passed", made_up: "Passed", volume: "Weird" },
      failedStep: "made_up",
      warnings: new Array(100).fill("warning"),
    });

    expect(run?.steps).toEqual([
      { step: "server_active", status: "Failed", durationInMs: 0 },
    ]);
    expect(run?.phases).toEqual({ boot: "Passed" });
    expect(run?.failedStep).toBeUndefined();
    expect(run?.warnings).toHaveLength(20);
  });

  test("an API check is held the same way", () => {
    expect(sanitizeOpenStackApiCheckResult("nope")).toBeNull();
    expect(sanitizeOpenStackApiCheckResult({ token: {} })).toBeNull();

    const result: OpenStackApiCheckResult | null =
      sanitizeOpenStackApiCheckResult({
        startedAt: NOW.toISOString(),
        durationInMs: 5,
        regionNames: ["One", 1],
        token: { status: "Lovely", errorCode: "Not a code", message: "Hello" },
        services: [
          { serviceType: "compute", outcome: "Answered", durationInMs: 1 },
          { serviceType: "image", outcome: "Great" },
          { outcome: "Answered" },
        ],
        certificates: [
          { host: "a", port: 443, validTo: NOW.toISOString() },
          { host: "b", port: 70000, validTo: NOW.toISOString() },
          { host: "c", port: 443, validTo: "not a date" },
        ],
      });

    expect(result?.regionNames).toEqual(["One"]);
    expect(result?.token).toEqual({
      status: "Failed",
      durationInMs: 0,
      message: "Hello",
    });
    expect(result?.services).toHaveLength(1);
    expect(
      result?.certificates.map((one: OpenStackCertificateResult) => {
        return one.host;
      }),
    ).toEqual(["a"]);
  });
});
