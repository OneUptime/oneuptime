import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import ProbeService from "../../../Server/Services/ProbeService";
import { Service as VMwareVCenterConnectionTestServiceType } from "../../../Server/Services/VMwareVCenterConnectionTestService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Probe from "../../../Models/DatabaseModels/Probe";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterConnectionTest from "../../../Models/DatabaseModels/VMwareVCenterConnectionTest";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import VMwareCollectionErrorCode from "../../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareConnectionTestStatus, {
  MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT,
  VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../../Types/VMware/VMwareConnectionTestStatus";
import {
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
} from "../../../Types/VMware/VMwareProbeCollection";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { EntityManager } from "typeorm";

/*
 * "Test connection": checked like the connection it is about to become,
 * handed once to the probe it names - the password wiped from the row as it
 * is handed out - answered only by that probe, and failed with the reason
 * when no probe picks it up or reports in time.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333334",
);
const VCENTER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const TEST_ID: string = "55555555-5555-4555-8555-555555555555";
const SECOND_TEST_ID: string = "55555555-5555-4555-8555-555555555556";

const FINGERPRINT: string =
  "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<VMwareVCenterConnectionTest>,
  ) => Promise<OnCreate<VMwareVCenterConnectionTest>>;
};

function buildService(): {
  service: VMwareVCenterConnectionTestServiceType;
  internals: ServiceInternals;
} {
  const service: VMwareVCenterConnectionTestServiceType =
    new VMwareVCenterConnectionTestServiceType();

  return { service, internals: service as unknown as ServiceInternals };
}

type Overrides<T> = { [Key in keyof T]?: T[Key] | undefined };

function probeRow(overrides: Overrides<Probe> = {}): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  probe.isGlobalProbe = false;
  Object.assign(probe, overrides);
  return probe;
}

function savedVCenter(overrides: Record<string, unknown> = {}): VMwareVCenter {
  const vcenter: VMwareVCenter = new VMwareVCenter(VCENTER_ID);
  vcenter.collectionMethod = VMwareCollectionMethod.Probe;
  vcenter.vcenterUrl = "https://vcsa.example.com";
  vcenter.vcenterPassword = "saved-secret";
  vcenter.isVCenterPasswordSet = true;
  vcenter.collectionProbeId = PROBE_ID;
  Object.assign(vcenter, overrides);
  return vcenter;
}

function makeCreateBy(
  data: Record<string, unknown>,
): CreateBy<VMwareVCenterConnectionTest> {
  const test: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest();
  Object.assign(test, data);

  return {
    data: test,
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<VMwareVCenterConnectionTest>;
}

function newTest(
  extra: Record<string, unknown> = {},
): CreateBy<VMwareVCenterConnectionTest> {
  return makeCreateBy({
    vcenterUrl: "vcsa.example.com/ui",
    vcenterUsername: "  oneuptime@vsphere.local ",
    vcenterPassword: "typed-secret",
    probeId: PROBE_ID,
    ...extra,
  });
}

type Spy = { mock: { calls: Array<Array<unknown>> } };

function stubProbe(probe: Probe | null): void {
  jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probe as never);
}

function stubSavedVCenter(vcenter: VMwareVCenter | null): Spy {
  return jest
    .spyOn(VMwareVCenterService, "findOneBy")
    .mockResolvedValue(vcenter as never) as unknown as Spy;
}

function stubActiveTests(
  service: VMwareVCenterConnectionTestServiceType,
  count: number,
): Spy {
  return jest
    .spyOn(service, "countBy")
    .mockResolvedValue(new PositiveNumber(count) as never) as unknown as Spy;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("Expected the call to be refused.");
}

interface RecordedStatement {
  sql: string;
  params: Array<unknown>;
}

function stubTransaction(
  service: VMwareVCenterConnectionTestServiceType,
  results: Array<unknown>,
): Array<RecordedStatement> {
  const statements: Array<RecordedStatement> = [];
  const queue: Array<unknown> = [...results];

  jest
    .spyOn(service, "executeTransaction")
    .mockImplementation(
      async <TResult>(
        runInTransaction: (entityManager: EntityManager) => Promise<TResult>,
      ): Promise<TResult> => {
        return await runInTransaction({
          query: async (
            sql: string,
            params: Array<unknown>,
          ): Promise<unknown> => {
            statements.push({ sql, params });
            return queue.length > 0 ? queue.shift() : [];
          },
        } as unknown as EntityManager);
      },
    );

  return statements;
}

function stubColumnWrites(
  service: VMwareVCenterConnectionTestServiceType,
): Array<{ id: string; data: Record<string, unknown> }> {
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];

  jest
    .spyOn(service, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      writes.push({ id: input.id.toString(), data: input.data });
    }) as never);

  return writes;
}

const WHITESPACE: RegExp = /\s+/g;

function flatten(sql: string): string {
  return sql.replace(WHITESPACE, " ").trim();
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubProjectDirectory({});
});

describe("onBeforeCreate: a test is checked like the connection it is about to become", () => {
  test("normalizes the address, user name and certificate, and keeps the typed password", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);

    const createBy: CreateBy<VMwareVCenterConnectionTest> = newTest({
      trustedCertificateFingerprint: FINGERPRINT.replace(
        /:/g,
        "",
      ).toLowerCase(),
    });
    await internals.onBeforeCreate(createBy);

    expect(createBy.data).toMatchObject({
      vcenterUrl: "https://vcsa.example.com",
      vcenterUsername: "oneuptime@vsphere.local",
      vcenterPassword: "typed-secret",
      trustedCertificateFingerprint: FINGERPRINT,
    });
    expect(createBy.data.probeId!.toString()).toBe(PROBE_ID.toString());
  });

  test.each([
    [
      "no address",
      { vcenterUrl: "" },
      "Enter vCenter's address, such as vcsa.example.com or https://10.0.0.20.",
    ],
    [
      "plain http",
      { vcenterUrl: "http://vcsa.example.com" },
      "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
    ],
    [
      "no user name",
      { vcenterUsername: " " },
      "Enter the vCenter user name, such as oneuptime@vsphere.local.",
    ],
    [
      "a user name over 256 characters",
      { vcenterUsername: "u".repeat(257) },
      "The vCenter user name may be at most 256 characters.",
    ],
    [
      "a fingerprint that is not one",
      { trustedCertificateFingerprint: "nope" },
      "The trusted certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal characters, such as AB:CD:EF:... .",
    ],
    [
      "no probe",
      { probeId: undefined },
      "Pick the probe to test from: one in a network that can reach vCenter on TCP 443.",
    ],
    [
      "a password over 256 characters",
      { vcenterPassword: "p".repeat(257) },
      "The vCenter password may be at most 256 characters.",
    ],
    [
      "no password and no vCenter to take it from",
      { vcenterPassword: "" },
      "Enter the vCenter password.",
    ],
  ])(
    "refuses %s",
    async (_name: string, extra: Record<string, unknown>, message: string) => {
      const { service, internals } = buildService();
      stubProbe(probeRow());
      stubActiveTests(service, 0);

      expect(await refusal(internals.onBeforeCreate(newTest(extra)))).toBe(
        message,
      );
    },
  );

  test("a probe of another project is refused, and a global one only on OneUptime Cloud", async () => {
    const { service, internals } = buildService();
    stubActiveTests(service, 0);

    stubProbe(
      probeRow({
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      }),
    );
    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "This probe belongs to another project. Pick one of this project's probes.",
    );

    jest.restoreAllMocks();
    stubProjectDirectory({});
    stubActiveTests(service, 0);
    stubProbe(probeRow({ isGlobalProbe: true, projectId: undefined }));

    if (IsBillingEnabled) {
      expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
        "Pick a probe of your own. OneUptime's shared probes never receive vCenter passwords - add a probe in vCenter's network and pick it here.",
      );
    } else {
      await internals.onBeforeCreate(newTest());
    }
  });

  test("a test of a saved vCenter may use its password - for the address, probe and certificate it was saved for", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    const lookup: Spy = stubSavedVCenter(savedVCenter());

    const createBy: CreateBy<VMwareVCenterConnectionTest> = newTest({
      vcenterPassword: "",
      vmwareVCenterId: VCENTER_ID,
    });
    await internals.onBeforeCreate(createBy);

    expect(createBy.data.vcenterPassword).toBe("saved-secret");
    // Read only within the test's own project.
    expect(lookup.mock.calls[0]![0]).toMatchObject({
      query: { _id: VCENTER_ID, projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("a saved password is never tested against another address, probe or chosen certificate", async () => {
    const { service, internals } = buildService();
    stubActiveTests(service, 0);
    stubSavedVCenter(savedVCenter());

    stubProbe(probeRow());
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            vcenterPassword: "",
            vmwareVCenterId: VCENTER_ID,
            vcenterUrl: "https://attacker.example.com",
          }),
        ),
      ),
    ).toBe(
      "Enter the password again: a saved password is only sent to the vCenter address it was entered for.",
    );

    stubProbe(probeRow({ _id: OTHER_PROBE_ID.toString() }));
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            vcenterPassword: "",
            vmwareVCenterId: VCENTER_ID,
            probeId: OTHER_PROBE_ID,
          }),
        ),
      ),
    ).toBe(
      "Enter the password again: a saved password is only sent through the probe it was entered for.",
    );

    stubProbe(probeRow());
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            vcenterPassword: "",
            vmwareVCenterId: VCENTER_ID,
            trustedCertificateFingerprint: FINGERPRINT,
          }),
        ),
      ),
    ).toBe(
      "Enter the password again: a saved password is only sent to the certificate that was trusted when it was entered.",
    );
  });

  test("trusting the certificate the probe found there may use the saved password", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    stubSavedVCenter(
      savedVCenter({ presentedCertificate: { fingerprint256: FINGERPRINT } }),
    );

    const createBy: CreateBy<VMwareVCenterConnectionTest> = newTest({
      vcenterPassword: "",
      vmwareVCenterId: VCENTER_ID,
      trustedCertificateFingerprint: FINGERPRINT,
    });
    await internals.onBeforeCreate(createBy);

    expect(createBy.data.vcenterPassword).toBe("saved-secret");
  });

  test("a vCenter of another project - or none - is not found; one with no saved password asks for it", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);

    stubSavedVCenter(null);
    expect(
      await refusal(
        internals.onBeforeCreate(newTest({ vmwareVCenterId: VCENTER_ID })),
      ),
    ).toBe("vCenter not found.");

    stubSavedVCenter(
      savedVCenter({ collectionMethod: VMwareCollectionMethod.Agent }),
    );
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({ vcenterPassword: "", vmwareVCenterId: VCENTER_ID }),
        ),
      ),
    ).toBe("Enter the vCenter password.");

    // A typed password needs no saved one - but the vCenter must still be this project's.
    stubSavedVCenter(
      savedVCenter({ isVCenterPasswordSet: false, vcenterPassword: undefined }),
    );
    const createBy: CreateBy<VMwareVCenterConnectionTest> = newTest({
      vmwareVCenterId: VCENTER_ID,
    });
    await internals.onBeforeCreate(createBy);
    expect(createBy.data.vcenterPassword).toBe("typed-secret");
  });

  test("a project cannot flood its probes with tests", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    const count: Spy = stubActiveTests(
      service,
      MAX_ACTIVE_VMWARE_CONNECTION_TESTS_PER_PROJECT,
    );

    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "Several connection tests are still running in this project. Wait for them to finish, then test again.",
    );
    expect(count.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });
});

describe("claimPendingTests: each test is handed once, to its own probe, and its password wiped", () => {
  test("claims nothing without a free slot", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, []);

    expect(
      await service.claimPendingTests({ probeId: PROBE_ID, limit: 0 }),
    ).toEqual([]);
    expect(statements).toEqual([]);
  });

  test("selects this probe's fresh pending tests it may run, locks them and marks them running", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      [{ _id: TEST_ID }, { _id: SECOND_TEST_ID }],
    ]);
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    stubColumnWrites(service);

    await service.claimPendingTests({ probeId: PROBE_ID, limit: 5 });

    expect(statements).toHaveLength(2);
    const select: RecordedStatement = statements[0]!;
    const sql: string = flatten(select.sql);

    for (const clause of [
      't."probeId" = $1',
      't."status" = $2',
      't."deletedAt" IS NULL',
      't."createdAt" >= $3',
      '(pr."isGlobalProbe" = false AND pr."projectId" = t."projectId")',
      '(pr."isGlobalProbe" = true AND $5::boolean = false)',
      "LIMIT $4",
      "FOR UPDATE OF t SKIP LOCKED",
    ]) {
      expect(sql).toContain(clause);
    }

    expect(select.params[0]).toBe(PROBE_ID.toString());
    expect(select.params[1]).toBe(VMwareConnectionTestStatus.Pending);
    expect(select.params[3]).toBe(5);
    expect(select.params[4]).toBe(IsBillingEnabled);

    const cutoff: Date = select.params[2] as Date;
    const age: number = Date.now() - cutoff.getTime();
    expect(age).toBeGreaterThanOrEqual(
      VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000 - 5000,
    );
    expect(age).toBeLessThanOrEqual(
      VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000 + 5000,
    );

    expect(flatten(statements[1]!.sql)).toBe(
      'UPDATE "VMwareVCenterConnectionTest" SET "status" = $1, "claimedAt" = $2::timestamptz WHERE "_id" = ANY($3::uuid[])',
    );
    expect(statements[1]!.params[0]).toBe(VMwareConnectionTestStatus.Running);
    expect(statements[1]!.params[2]).toEqual([TEST_ID, SECOND_TEST_ID]);
  });

  test("hands out what the probe needs, then wipes every claimed test's password", async () => {
    const { service } = buildService();
    stubTransaction(service, [[{ _id: TEST_ID }, { _id: SECOND_TEST_ID }]]);

    const first: VMwareVCenterConnectionTest =
      new VMwareVCenterConnectionTest();
    first._id = TEST_ID;
    first.vcenterUrl = "https://vcsa.example.com";
    first.vcenterUsername = "oneuptime@vsphere.local";
    first.vcenterPassword = "typed-secret";
    first.trustedCertificateFingerprint = FINGERPRINT.toLowerCase();

    const second: VMwareVCenterConnectionTest =
      new VMwareVCenterConnectionTest();
    second._id = SECOND_TEST_ID;
    second.vcenterUrl = "https://vcsa.example.com";
    second.vcenterUsername = "oneuptime@vsphere.local";
    // Its password is already gone: not handed out.

    const read: Spy = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([first, second] as never) as unknown as Spy;
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    const jobs: Array<VMwareConnectionTestJob> =
      await service.claimPendingTests({ probeId: PROBE_ID, limit: 5 });

    expect(jobs).toEqual([
      {
        vmwareVCenterConnectionTestId: TEST_ID,
        vcenterUrl: "https://vcsa.example.com",
        username: "oneuptime@vsphere.local",
        password: "typed-secret",
        trustedCertificateFingerprint: FINGERPRINT,
      },
    ]);
    expect(read.mock.calls[0]![0]).toMatchObject({
      select: { vcenterPassword: true },
      props: { isRoot: true },
    });
    expect(writes).toEqual([
      { id: TEST_ID, data: { vcenterPassword: null } },
      { id: SECOND_TEST_ID, data: { vcenterPassword: null } },
    ]);
  });
});

describe("recordTestReport: only the probe a test was handed to answers it, once", () => {
  function report(
    overrides: Partial<VMwareConnectionTestReport> = {},
  ): VMwareConnectionTestReport {
    return {
      vmwareVCenterConnectionTestId: TEST_ID,
      status: "Succeeded",
      durationInMs: 300,
      summary: {
        apiType: "VirtualCenter",
        datacenterCount: 1,
        clusterCount: 2,
        hostCount: 5,
        vmCount: 10,
        poweredOnVmCount: 10,
        templateCount: 0,
        datastoreCount: 1,
        resourcePoolCount: 5,
        warnings: [],
      },
      ...overrides,
    };
  }

  function stubRunningTest(
    service: VMwareVCenterConnectionTestServiceType,
    found: boolean,
  ): Spy {
    const test: VMwareVCenterConnectionTest = new VMwareVCenterConnectionTest(
      new ObjectID(TEST_ID),
    );

    return jest
      .spyOn(service, "findOneBy")
      .mockResolvedValue((found ? test : null) as never) as unknown as Spy;
  }

  test("a report naming no test is not heard", async () => {
    const { service } = buildService();
    const lookup: Spy = stubRunningTest(service, true);

    expect(
      await service.recordTestReport({
        probeId: PROBE_ID,
        report: report({ vmwareVCenterConnectionTestId: "nope" }),
      }),
    ).toBe(false);
    expect(lookup.mock.calls).toHaveLength(0);
  });

  test("is looked up as this probe's running test, and not heard otherwise", async () => {
    const { service } = buildService();
    const lookup: Spy = stubRunningTest(service, false);
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    expect(
      await service.recordTestReport({ probeId: PROBE_ID, report: report() }),
    ).toBe(false);
    expect(lookup.mock.calls[0]![0]).toMatchObject({
      query: {
        _id: new ObjectID(TEST_ID),
        probeId: PROBE_ID,
        status: VMwareConnectionTestStatus.Running,
      },
      props: { isRoot: true },
    });
    expect(writes).toEqual([]);
  });

  test("a success keeps what the probe found, and no password", async () => {
    const { service } = buildService();
    stubRunningTest(service, true);
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    expect(
      await service.recordTestReport({ probeId: PROBE_ID, report: report() }),
    ).toBe(true);
    expect(writes[0]!.data).toMatchObject({
      status: VMwareConnectionTestStatus.Succeeded,
      errorCode: null,
      errorMessage: null,
      presentedCertificate: null,
      summary: report().summary,
      vcenterPassword: null,
    });
    expect(writes[0]!.data["completedAt"]).toBeInstanceOf(Date);
  });

  test("a failure keeps why - and the certificate when trusting it is the fix", async () => {
    const { service } = buildService();
    stubRunningTest(service, true);
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    await service.recordTestReport({
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
        errorMessage: "Not trusted.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=vcsa",
          issuer: "CN=CA",
          isSelfSigned: false,
        },
      }),
    });

    expect(writes[0]!.data).toMatchObject({
      status: VMwareConnectionTestStatus.Failed,
      errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
      errorMessage: "Not trusted.",
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=vcsa",
        issuer: "CN=CA",
        isSelfSigned: false,
      },
      summary: null,
      vcenterPassword: null,
    });
  });

  test("a code the server does not know is Internal, with its title when there is no message", async () => {
    const { service } = buildService();
    stubRunningTest(service, true);
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    await service.recordTestReport({
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: "Unheard-of" as VMwareCollectionErrorCode,
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "",
          issuer: "",
          isSelfSigned: false,
        },
      }),
    });

    expect(writes[0]!.data).toMatchObject({
      errorCode: VMwareCollectionErrorCode.Internal,
      errorMessage: "The probe hit an unexpected error",
      presentedCertificate: null,
    });
  });
});

describe("expireStaleTests: a person is never left waiting on a test nobody will answer", () => {
  test("fails tests no probe picked up, and tests whose probe never reported - wiping their passwords", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = [];

    jest.spyOn(service, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          statements.push({ sql, params });
          return [];
        },
      },
    } as never);

    await service.expireStaleTests();

    expect(statements).toHaveLength(2);

    const [pickup, run] = statements;

    expect(flatten(pickup!.sql)).toBe(
      'UPDATE "VMwareVCenterConnectionTest" SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "vcenterPassword" = NULL WHERE "status" = $5 AND "deletedAt" IS NULL AND "createdAt" < $6::timestamptz',
    );
    expect(pickup!.params.slice(0, 3)).toEqual([
      VMwareConnectionTestStatus.Failed,
      VMwareCollectionErrorCode.ProbeNotAvailable,
      "The probe did not pick up the test. It may be offline, or run a OneUptime version older than VMware collection - update it, or pick another probe.",
    ]);
    expect(pickup!.params[4]).toBe(VMwareConnectionTestStatus.Pending);
    expect(
      (pickup!.params[3] as Date).getTime() -
        (pickup!.params[5] as Date).getTime(),
    ).toBe(VMWARE_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000);

    expect(flatten(run!.sql)).toContain('"claimedAt" < $6::timestamptz');
    expect(run!.params.slice(0, 3)).toEqual([
      VMwareConnectionTestStatus.Failed,
      VMwareCollectionErrorCode.TimedOut,
      "The probe did not report back in time.",
    ]);
    expect(run!.params[4]).toBe(VMwareConnectionTestStatus.Running);
    expect(
      (run!.params[3] as Date).getTime() - (run!.params[5] as Date).getTime(),
    ).toBe(VMWARE_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS * 1000);
  });
});
