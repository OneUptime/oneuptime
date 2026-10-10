import { describe, expect, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import VMwareProbeCollectionStore, {
  VMwareCollectionReportOutcome,
} from "../../../../Server/Utils/VMware/VMwareProbeCollectionStore";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import { SubscriptionStatusUtil } from "../../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../../Types/ObjectID";
import VMwareCollectionErrorCode from "../../../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../../Types/VMware/VMwareCollectionStatus";
import {
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwarePresentedCertificate,
} from "../../../../Types/VMware/VMwareProbeCollection";

/*
 * The database half of probe collection, against a recording fake of the
 * vCenter service: which vCenters a probe is handed (once, its own, due, with
 * the password), and what a report may write (only its probe's, only the
 * current settings' status).
 */

const PROBE_ID: ObjectID = new ObjectID("4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0001");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7c0e9d1a-1111-4b2c-8d3e-000000000001",
);
const VCENTER_ID: string = "9e8d7c6b-2222-4a1b-9c0d-000000000001";
const VCENTER_ID_2: string = "9e8d7c6b-2222-4a1b-9c0d-000000000002";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

interface Query {
  sql: string;
  parameters: Array<unknown>;
}

interface FakeService {
  service: DatabaseService<VMwareVCenter>;
  queries: Array<Query>;
  findByCalls: Array<Record<string, unknown>>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
}

function fakeService(data: {
  selectedRows?: Array<{
    _id: string;
    collectionIntervalInMinutes: number | null;
  }>;
  vcenters?: Array<VMwareVCenter>;
  vcenter?: VMwareVCenter | null;
}): FakeService {
  const queries: Array<Query> = [];
  const findByCalls: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  const service: unknown = {
    executeTransaction: async <T>(
      run: (manager: unknown) => Promise<T>,
    ): Promise<T> => {
      return await run({
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<unknown> => {
          queries.push({ sql: sql, parameters: parameters });
          return sql.trim().startsWith("SELECT") ? data.selectedRows || [] : [];
        },
      });
    },
    findBy: async (options: Record<string, unknown>): Promise<unknown> => {
      findByCalls.push(options);
      return data.vcenters || [];
    },
    findOneById: async (): Promise<unknown> => {
      return data.vcenter === undefined ? null : data.vcenter;
    },
    updateColumnsByIdWithoutHooks: async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      updates.push({ id: input.id.toString(), data: input.data });
    },
  };

  return {
    service: service as DatabaseService<VMwareVCenter>,
    queries: queries,
    findByCalls: findByCalls,
    updates: updates,
  };
}

type Overrides<T> = { [Key in keyof T]?: T[Key] | undefined };

function vcenterRow(overrides: Overrides<VMwareVCenter> = {}): VMwareVCenter {
  const vcenter: VMwareVCenter = new VMwareVCenter();
  vcenter._id = VCENTER_ID;
  vcenter.name = "Production";
  vcenter.vcenterUrl = "https://vcsa.example.com";
  vcenter.vcenterUsername = "oneuptime@vsphere.local";
  vcenter.vcenterPassword = "secret";
  vcenter.collectionIntervalInMinutes = 5;
  vcenter.collectionSettingsVersion = 4;
  Object.assign(vcenter, overrides);
  return vcenter;
}

function collectedVCenter(
  overrides: Record<string, unknown> = {},
): VMwareVCenter {
  const vcenter: VMwareVCenter = new VMwareVCenter();
  vcenter._id = VCENTER_ID;
  vcenter.projectId = PROJECT_ID;
  vcenter.name = "Production";
  vcenter.collectionMethod = VMwareCollectionMethod.Probe;
  vcenter.collectionProbeId = PROBE_ID;
  vcenter.collectionSettingsVersion = 4;
  Object.assign(vcenter, {
    collectionProbe: {
      _id: PROBE_ID.toString(),
      isGlobalProbe: false,
      projectId: PROJECT_ID,
    },
    ...overrides,
  });
  return vcenter;
}

function report(
  overrides: Partial<VMwareCollectionReport> = {},
): VMwareCollectionReport {
  return {
    vmwareVCenterId: VCENTER_ID,
    settingsVersion: 4,
    collectedAt: "2026-10-10T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 1200,
    summary: {
      productName: "VMware vCenter Server",
      apiType: "VirtualCenter",
      datacenterCount: 1,
      clusterCount: 2,
      hostCount: 5,
      vmCount: 10,
      poweredOnVmCount: 9,
      templateCount: 1,
      datastoreCount: 3,
      resourcePoolCount: 4,
      resourceCount: 30,
      datapointCount: 400,
      warnings: [],
    },
    ...overrides,
  };
}

function presented(): VMwarePresentedCertificate {
  return {
    fingerprint256: FINGERPRINT.toLowerCase().replace(/:/g, ""),
    subject: "CN=vcsa.example.com",
    issuer: "CN=CA, DC=vsphere, DC=local",
    isSelfSigned: false,
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2028-01-01T00:00:00.000Z",
    verificationError: "unable to get local issuer certificate",
  };
}

describe("VMwareProbeCollectionStore.claimDueVCenters", () => {
  test("claims nothing - and asks nothing - when the probe has no free slot", async () => {
    const fake: FakeService = fakeService({});

    expect(
      await VMwareProbeCollectionStore.claimDueVCenters(fake.service, {
        probeId: PROBE_ID,
        runningVMwareVCenterIds: [],
        limit: 0,
      }),
    ).toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  test("selects only this probe's due vCenters it may collect, skipping running ones, and locks them", async () => {
    const fake: FakeService = fakeService({});

    await VMwareProbeCollectionStore.claimDueVCenters(fake.service, {
      probeId: PROBE_ID,
      runningVMwareVCenterIds: [VCENTER_ID_2, "not-an-id", "'; DROP TABLE"],
      limit: 3,
    });

    expect(fake.queries).toHaveLength(1);
    const select: Query = fake.queries[0]!;

    expect(select.parameters[0]).toBe(PROBE_ID.toString());
    expect(select.parameters[1]).toBeInstanceOf(Date);
    expect(select.parameters[2]).toBe(3);
    expect(select.parameters[3]).toEqual(
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    );
    expect(select.parameters[4]).toBe(VMwareCollectionMethod.Probe);
    // Only real ids reach the query - as a bound array, never as SQL.
    expect(select.parameters[5]).toEqual([VCENTER_ID_2]);
    expect(select.parameters[6]).toBe(IsBillingEnabled);

    for (const clause of [
      'vc."collectionProbeId" = $1',
      'vc."collectionMethod" = $5',
      'vc."isVCenterPasswordSet" = true',
      'vc."deletedAt" IS NULL',
      '(vc."nextCollectionAt" IS NULL OR vc."nextCollectionAt" <= $2)',
      'NOT (vc."_id" = ANY($6::uuid[]))',
      '(pr."isGlobalProbe" = false AND pr."projectId" = vc."projectId")',
      '(pr."isGlobalProbe" = true AND $7::boolean = false)',
      'pr."deletedAt" IS NULL',
      'p."deletedAt" IS NULL',
      "LIMIT $3",
      "FOR UPDATE OF vc SKIP LOCKED",
    ]) {
      expect(select.sql).toContain(clause);
    }
  });

  test("moves each claimed vCenter's next collection one interval on, in the same transaction", async () => {
    const fake: FakeService = fakeService({
      selectedRows: [
        { _id: VCENTER_ID, collectionIntervalInMinutes: 5 },
        { _id: VCENTER_ID_2, collectionIntervalInMinutes: null },
      ],
      vcenters: [],
    });

    await VMwareProbeCollectionStore.claimDueVCenters(fake.service, {
      probeId: PROBE_ID,
      runningVMwareVCenterIds: [],
      limit: 4,
    });

    expect(fake.queries).toHaveLength(2);
    const now: Date = fake.queries[0]!.parameters[1] as Date;
    const update: Query = fake.queries[1]!;

    expect(update.sql).toBe(
      'UPDATE "VMwareVCenter" SET "nextCollectionAt" = CASE "_id" WHEN $1 THEN $2::timestamptz WHEN $3 THEN $4::timestamptz END WHERE "_id" IN ($5, $6)',
    );
    expect(update.parameters[0]).toBe(VCENTER_ID);
    expect((update.parameters[1] as Date).getTime() - now.getTime()).toBe(
      5 * 60_000,
    );
    expect(update.parameters[2]).toBe(VCENTER_ID_2);
    // No interval saved: the default two minutes.
    expect((update.parameters[3] as Date).getTime() - now.getTime()).toBe(
      2 * 60_000,
    );
    expect(update.parameters.slice(4)).toEqual([VCENTER_ID, VCENTER_ID_2]);
  });

  test("hands each claimed vCenter out with its credentials, read as OneUptime", async () => {
    const fake: FakeService = fakeService({
      selectedRows: [{ _id: VCENTER_ID, collectionIntervalInMinutes: 5 }],
      vcenters: [
        vcenterRow({
          trustedCertificateFingerprint: FINGERPRINT.replace(
            /:/g,
            "",
          ).toLowerCase(),
        }),
      ],
    });

    const jobs: Array<VMwareCollectionJob> =
      await VMwareProbeCollectionStore.claimDueVCenters(fake.service, {
        probeId: PROBE_ID,
        runningVMwareVCenterIds: [],
        limit: 4,
      });

    expect(jobs).toEqual([
      {
        vmwareVCenterId: VCENTER_ID,
        vcenterName: "Production",
        vcenterUrl: "https://vcsa.example.com",
        username: "oneuptime@vsphere.local",
        password: "secret",
        trustedCertificateFingerprint: FINGERPRINT,
        collectionIntervalInMinutes: 5,
        settingsVersion: 4,
      },
    ]);

    const read: Record<string, unknown> = fake.findByCalls[0]!;
    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["select"]).toMatchObject({ vcenterPassword: true });
  });

  test("a claimed vCenter missing its address, user or password is not handed out", async () => {
    const fake: FakeService = fakeService({
      selectedRows: [{ _id: VCENTER_ID, collectionIntervalInMinutes: 5 }],
      vcenters: [
        vcenterRow({ vcenterPassword: undefined }),
        vcenterRow({ _id: VCENTER_ID_2, vcenterUrl: undefined }),
        vcenterRow({ vcenterUsername: undefined }),
      ],
    });

    expect(
      await VMwareProbeCollectionStore.claimDueVCenters(fake.service, {
        probeId: PROBE_ID,
        runningVMwareVCenterIds: [],
        limit: 4,
      }),
    ).toEqual([]);
  });

  test("an interval outside the bounds is held to them; an unsaved version is 0", async () => {
    const fake: FakeService = fakeService({
      selectedRows: [{ _id: VCENTER_ID, collectionIntervalInMinutes: 500 }],
      vcenters: [
        vcenterRow({
          collectionIntervalInMinutes: 500,
          collectionSettingsVersion: undefined,
        }),
      ],
    });

    const [job] = await VMwareProbeCollectionStore.claimDueVCenters(
      fake.service,
      { probeId: PROBE_ID, runningVMwareVCenterIds: [], limit: 1 },
    );

    expect(job!.collectionIntervalInMinutes).toBe(60);
    expect(job!.settingsVersion).toBe(0);
    expect(job!.trustedCertificateFingerprint).toBeUndefined();
  });
});

describe("VMwareProbeCollectionStore.recordCollectionReport", () => {
  test("a report naming no vCenter is not accepted", async () => {
    const fake: FakeService = fakeService({});

    expect(
      await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report({ vmwareVCenterId: "x" }),
      }),
    ).toEqual({ accepted: false, reason: "The report names no vCenter." });
    expect(fake.updates).toEqual([]);
  });

  test.each([
    ["a vCenter that does not exist", null],
    [
      "a vCenter another probe collects",
      collectedVCenter({ collectionProbeId: OTHER_PROBE_ID }),
    ],
    [
      "a vCenter the agent collects now",
      collectedVCenter({ collectionMethod: VMwareCollectionMethod.Agent }),
    ],
    [
      "a vCenter with no probe",
      collectedVCenter({ collectionProbeId: undefined }),
    ],
  ])(
    "is not heard for %s",
    async (_name: string, vcenter: VMwareVCenter | null) => {
      const fake: FakeService = fakeService({ vcenter: vcenter });

      const outcome: VMwareCollectionReportOutcome =
        await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
          probeId: PROBE_ID,
          report: report(),
        });

      expect(outcome).toEqual({
        accepted: false,
        reason:
          "This probe does not collect that vCenter (any more): it was deleted, switched to the VMware agent, or moved to another probe.",
      });
      expect(fake.updates).toEqual([]);
    },
  );

  test("a probe the rules no longer allow is not heard, even as the vCenter's probe", async () => {
    const fake: FakeService = fakeService({
      vcenter: collectedVCenter({
        collectionProbe: {
          _id: PROBE_ID.toString(),
          isGlobalProbe: false,
          projectId: new ObjectID("7c0e9d1a-1111-4b2c-8d3e-000000000999"),
        },
      }),
    });

    const outcome: VMwareCollectionReportOutcome =
      await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report(),
      });

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe(
      "This probe belongs to another project. Pick one of this project's probes.",
    );
  });

  test("a global probe is heard on a self-hosted instance only", async () => {
    const fake: FakeService = fakeService({
      vcenter: collectedVCenter({
        collectionProbe: {
          _id: PROBE_ID.toString(),
          isGlobalProbe: true,
          projectId: undefined,
        },
      }),
    });

    const outcome: VMwareCollectionReportOutcome =
      await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report(),
      });

    expect(outcome.accepted).toBe(!IsBillingEnabled);
  });

  test("a success of the current settings: status, cleared error, the summary - case-insensitively the vCenter's probe", async () => {
    const fake: FakeService = fakeService({ vcenter: collectedVCenter() });

    const outcome: VMwareCollectionReportOutcome =
      await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: new ObjectID(PROBE_ID.toString().toUpperCase()),
        report: report(),
      });

    expect(outcome).toEqual({
      accepted: true,
      projectId: PROJECT_ID,
      vcenterName: "Production",
      isCurrent: true,
    });

    const written: Record<string, unknown> = fake.updates[0]!.data;
    expect(fake.updates[0]!.id).toBe(VCENTER_ID);
    expect(written).toMatchObject({
      collectionStatus: VMwareCollectionStatus.Succeeded,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
      collectionSummary: report().summary,
    });
    expect(written["lastCollectionAt"]).toBeInstanceOf(Date);
    expect(written["lastSuccessfulCollectionAt"]).toBeInstanceOf(Date);
  });

  test("a failure keeps the reason, and the certificate only when trusting it is the fix", async () => {
    const untrusted: FakeService = fakeService({ vcenter: collectedVCenter() });

    await VMwareProbeCollectionStore.recordCollectionReport(untrusted.service, {
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        summary: undefined,
        errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
        errorMessage: "vcsa.example.com's certificate is not trusted.",
        presentedCertificate: presented(),
      }),
    });

    expect(untrusted.updates[0]!.data).toMatchObject({
      collectionStatus: VMwareCollectionStatus.Failed,
      collectionErrorCode: VMwareCollectionErrorCode.UntrustedCertificate,
      collectionError: "vcsa.example.com's certificate is not trusted.",
      presentedCertificate: { ...presented(), fingerprint256: FINGERPRINT },
    });
    expect(
      untrusted.updates[0]!.data["lastSuccessfulCollectionAt"],
    ).toBeUndefined();

    const refused: FakeService = fakeService({ vcenter: collectedVCenter() });

    await VMwareProbeCollectionStore.recordCollectionReport(refused.service, {
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: VMwareCollectionErrorCode.InvalidLogin,
        errorMessage: "Refused.",
        presentedCertificate: presented(),
      }),
    });

    expect(refused.updates[0]!.data["presentedCertificate"]).toBeNull();
    expect(refused.updates[0]!.data["collectionSummary"]).toBeUndefined();
  });

  test("a code the server does not know is Internal, and a missing message is the code's title", async () => {
    const fake: FakeService = fakeService({ vcenter: collectedVCenter() });

    await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: "Made-up" as VMwareCollectionErrorCode,
        errorMessage: "   ",
      }),
    });

    expect(fake.updates[0]!.data).toMatchObject({
      collectionErrorCode: VMwareCollectionErrorCode.Internal,
      collectionError: "The probe hit an unexpected error",
    });
  });

  test("a report of older settings delivers its data but leaves the status to the new ones", async () => {
    const fake: FakeService = fakeService({ vcenter: collectedVCenter() });

    const outcome: VMwareCollectionReportOutcome =
      await VMwareProbeCollectionStore.recordCollectionReport(fake.service, {
        probeId: PROBE_ID,
        report: report({
          settingsVersion: 3,
          status: "Failed",
          errorCode: VMwareCollectionErrorCode.InvalidLogin,
        }),
      });

    expect(outcome).toMatchObject({ accepted: true, isCurrent: false });
    expect(Object.keys(fake.updates[0]!.data)).toEqual(["lastCollectionAt"]);
  });
});

describe("VMwareProbeCollectionStore sanitizers", () => {
  test("a presented certificate is held to the dashboard's shape", () => {
    expect(
      VMwareProbeCollectionStore.sanitizePresentedCertificate({
        fingerprint256: FINGERPRINT,
        subject: "x".repeat(5000),
        issuer: 7,
        isSelfSigned: "yes",
        validTo: "  2028-01-01T00:00:00.000Z  ",
        verificationError: "",
        extra: "dropped",
      }),
    ).toEqual({
      fingerprint256: FINGERPRINT,
      subject: `${"x".repeat(999)}…`,
      issuer: "",
      isSelfSigned: false,
      validTo: "2028-01-01T00:00:00.000Z",
    });

    expect(
      VMwareProbeCollectionStore.sanitizePresentedCertificate({
        fingerprint256: "not one",
      }),
    ).toBeNull();
    expect(
      VMwareProbeCollectionStore.sanitizePresentedCertificate("x"),
    ).toBeNull();
    expect(
      VMwareProbeCollectionStore.sanitizePresentedCertificate(null),
    ).toBeNull();
  });

  test("a summary keeps whole, non-negative counts and bounded words", () => {
    expect(
      VMwareProbeCollectionStore.sanitizeSummary({
        datacenterCount: "2",
        clusterCount: -1,
        hostCount: 4.7,
        vmCount: Number.NaN,
        poweredOnVmCount: null,
        warnings: [
          "vSAN is not enabled.",
          7,
          "",
          ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
            return `warning ${index}`;
          }),
        ],
        productName: "VMware vCenter Server",
        apiType: "   ",
        datapointCount: 12,
      }),
    ).toEqual({
      datacenterCount: 2,
      clusterCount: 0,
      hostCount: 4,
      vmCount: 0,
      poweredOnVmCount: 0,
      templateCount: 0,
      datastoreCount: 0,
      resourcePoolCount: 0,
      warnings: [
        "vSAN is not enabled.",
        ...Array.from({ length: 19 }, (_value: unknown, index: number) => {
          return `warning ${index}`;
        }),
      ],
      productName: "VMware vCenter Server",
      datapointCount: 12,
    });

    expect(VMwareProbeCollectionStore.sanitizeSummary(undefined)).toBeNull();
    expect(VMwareProbeCollectionStore.sanitizeSummary("x")).toBeNull();
  });

  test("an interval is held to whole minutes from one to sixty, two when there is none", () => {
    expect(VMwareProbeCollectionStore.getSafeInterval(undefined)).toBe(2);
    expect(VMwareProbeCollectionStore.getSafeInterval(null)).toBe(2);
    expect(VMwareProbeCollectionStore.getSafeInterval(0)).toBe(2);
    expect(VMwareProbeCollectionStore.getSafeInterval(-5)).toBe(2);
    expect(VMwareProbeCollectionStore.getSafeInterval(0.4)).toBe(1);
    expect(VMwareProbeCollectionStore.getSafeInterval(7.6)).toBe(8);
    expect(VMwareProbeCollectionStore.getSafeInterval(600)).toBe(60);
  });

  test("rows read back by id come out in the order they were claimed", () => {
    const rows: Array<{ _id?: string | undefined; name: string }> = [
      { _id: "B", name: "second" },
      { name: "no id" },
      { _id: "a", name: "first" },
      { _id: "x", name: "never claimed" },
    ];

    expect(
      VMwareProbeCollectionStore.inClaimOrder(rows, ["A", "b", "missing"]).map(
        (row: { name: string }) => {
          return row.name;
        },
      ),
    ).toEqual(["first", "second"]);
  });

  test("text is trimmed and bounded, and only text is text", () => {
    expect(VMwareProbeCollectionStore.boundText("  hello  ", 10)).toBe("hello");
    expect(VMwareProbeCollectionStore.boundText("abcdef", 4)).toBe("abc…");
    expect(VMwareProbeCollectionStore.boundText("   ", 4)).toBeNull();
    expect(VMwareProbeCollectionStore.boundText(5, 4)).toBeNull();
  });
});
