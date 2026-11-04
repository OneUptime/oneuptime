import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import { Service as OpenStackCloudConnectionTestServiceType } from "../../../Server/Services/OpenStackCloudConnectionTestService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE,
  OPENSTACK_TEST_NOT_REPORTED_MESSAGE,
} from "../../../Server/Utils/OpenStack/OpenStackConnectionTestStore";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "../../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import Probe from "../../../Models/DatabaseModels/Probe";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackConnectionTestStatus, {
  MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT,
  OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { EntityManager } from "typeorm";

/*
 * "Test connection", through the service: the real rules (OpenStackConnectionTestStore) over
 * the real service, with the database stubbed where it would be asked.
 *
 * A test is checked like the connection it is about to become, handed once to the probe it
 * names with the secret wiped from the row as it is handed out, answered only by that probe,
 * and failed with the reason when no probe picks it up or reports in time. The store's own
 * suite holds each rule to its words. This one holds the service to asking the right rows:
 * the cloud within the test's own project, the probe as a cloud's collection probe, and the
 * tests of this project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333334",
);
const CLOUD_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const TEST_ID: string = "55555555-5555-4555-8555-555555555555";
const SECOND_TEST_ID: string = "55555555-5555-4555-8555-555555555556";

const FINGERPRINT: string =
  "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA";

type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<OpenStackCloudConnectionTest>,
  ) => Promise<OnCreate<OpenStackCloudConnectionTest>>;
  getRelationsCheckedByService: () => Array<string>;
};

function buildService(): {
  service: OpenStackCloudConnectionTestServiceType;
  internals: ServiceInternals;
} {
  const service: OpenStackCloudConnectionTestServiceType =
    new OpenStackCloudConnectionTestServiceType();

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

function savedCloud(overrides: Record<string, unknown> = {}): OpenStackCloud {
  const cloud: OpenStackCloud = new OpenStackCloud(CLOUD_ID);
  cloud.collectionMethod = OpenStackCollectionMethod.Probe;
  cloud.authUrl = "https://keystone.example.com:5000";
  cloud.credentialKind = "applicationCredential";
  cloud.applicationCredentialId = "saved-id";
  cloud.credentialSecret = "saved-secret";
  cloud.isCredentialSet = true;
  cloud.collectionProbeId = PROBE_ID;
  Object.assign(cloud, overrides);
  return cloud;
}

function makeCreateBy(
  data: Record<string, unknown>,
): CreateBy<OpenStackCloudConnectionTest> {
  const test: OpenStackCloudConnectionTest = new OpenStackCloudConnectionTest();
  Object.assign(test, data);

  return {
    data: test,
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<OpenStackCloudConnectionTest>;
}

function newTest(
  extra: Record<string, unknown> = {},
): CreateBy<OpenStackCloudConnectionTest> {
  return makeCreateBy({
    authUrl: "keystone.example.com:5000/v3",
    applicationCredentialId: " typed-id ",
    credentialSecret: "typed-secret",
    probeId: PROBE_ID,
    ...extra,
  });
}

type Spy = { mock: { calls: Array<Array<unknown>> } };

function stubProbe(probe: Probe | null): Spy {
  return jest
    .spyOn(ProbeService, "findOneById")
    .mockResolvedValue(probe as never) as unknown as Spy;
}

function stubSavedCloud(cloud: OpenStackCloud | null): Spy {
  return jest
    .spyOn(OpenStackCloudService, "findOneBy")
    .mockResolvedValue(cloud as never) as unknown as Spy;
}

function stubActiveTests(
  service: OpenStackCloudConnectionTestServiceType,
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
  service: OpenStackCloudConnectionTestServiceType,
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
  service: OpenStackCloudConnectionTestServiceType,
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

function stubRepositoryManager(
  service: OpenStackCloudConnectionTestServiceType,
): Array<RecordedStatement> {
  const statements: Array<RecordedStatement> = [];

  jest.spyOn(service, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        statements.push({ sql, params });
        return [];
      },
    },
  } as never);

  return statements;
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
  test("normalizes the address and the credential's name, and keeps the typed secret", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);

    const createBy: CreateBy<OpenStackCloudConnectionTest> = newTest({
      trustedCertificateFingerprints: [
        FINGERPRINT.replace(/:/g, "").toLowerCase(),
      ],
      collectionRegions: [" RegionOne ", "RegionOne"],
    });
    const result: OnCreate<OpenStackCloudConnectionTest> =
      await internals.onBeforeCreate(createBy);

    expect(createBy.data).toMatchObject({
      authUrl: "https://keystone.example.com:5000",
      endpointInterface: "public",
      collectionRegions: ["RegionOne"],
      credentialKind: "applicationCredential",
      applicationCredentialId: "typed-id",
      credentialSecret: "typed-secret",
      trustedCertificateFingerprints: [FINGERPRINT],
    });
    expect(createBy.data.probeId!.toString()).toBe(PROBE_ID.toString());
    expect(result.createBy).toBe(createBy);
    expect(result.carryForward).toBeNull();
  });

  test("a relation is as good as an id", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    stubSavedCloud(savedCloud());

    const createBy: CreateBy<OpenStackCloudConnectionTest> = newTest({
      probeId: undefined,
      probe: new Probe(PROBE_ID),
      openStackCloud: new OpenStackCloud(CLOUD_ID),
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.probeId!.toString()).toBe(PROBE_ID.toString());
    expect(createBy.data.openStackCloudId!.toString()).toBe(
      CLOUD_ID.toString(),
    );
  });

  test.each([
    [
      "no address",
      { authUrl: "" },
      "Enter Keystone's address, such as https://keystone.example.com:5000/v3.",
    ],
    [
      "plain http",
      { authUrl: "http://keystone.example.com:5000" },
      "Use https://. OneUptime never sends a credential or a token unencrypted. For a cloud whose APIs only speak plain HTTP, turn on TLS, or use the OpenStack agent, which runs beside it.",
    ],
    [
      "no probe",
      { probeId: undefined },
      "Pick the probe to test from: one in a network that can reach the cloud's APIs.",
    ],
    [
      "no secret and no cloud to take one from",
      { credentialSecret: "" },
      "Enter an application credential's ID and secret.",
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
        "Pick a probe of your own. Shared probes never receive OpenStack credentials: add a probe in the cloud's network and pick it here.",
      );
    } else {
      await internals.onBeforeCreate(newTest());
    }
  });

  test("a probe that does not exist gets the answer another project's would", async () => {
    const { service, internals } = buildService();
    stubActiveTests(service, 0);
    stubProbe(null);

    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "Probe not found. Pick one of this project's probes.",
    );
  });

  test("a test of a saved cloud may use its credential, for the address, probe and certificates it was saved for", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    const lookup: Spy = stubSavedCloud(savedCloud());

    const createBy: CreateBy<OpenStackCloudConnectionTest> = newTest({
      applicationCredentialId: undefined,
      credentialSecret: "",
      openStackCloudId: CLOUD_ID,
    });
    await internals.onBeforeCreate(createBy);

    expect(createBy.data).toMatchObject({
      credentialKind: "applicationCredential",
      applicationCredentialId: "saved-id",
      credentialSecret: "saved-secret",
    });

    // Read only within the test's own project, as OneUptime, with what the rule compares.
    expect(lookup.mock.calls[0]![0]).toMatchObject({
      query: { _id: CLOUD_ID, projectId: PROJECT_ID },
      select: {
        collectionMethod: true,
        authUrl: true,
        credentialKind: true,
        applicationCredentialId: true,
        keystoneUsername: true,
        userDomainName: true,
        projectName: true,
        projectDomainName: true,
        credentialSecret: true,
        isCredentialSet: true,
        collectionProbeId: true,
        trustedCertificateFingerprints: true,
        presentedCertificate: true,
      },
      props: { isRoot: true },
    });
  });

  test("a saved credential is never tested against another address, probe or chosen certificate", async () => {
    const { service, internals } = buildService();
    stubActiveTests(service, 0);
    stubSavedCloud(savedCloud());

    stubProbe(probeRow());
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            credentialSecret: "",
            openStackCloudId: CLOUD_ID,
            authUrl: "https://attacker.example.com",
          }),
        ),
      ),
    ).toBe(
      "Enter the credential again: a saved credential is only sent to the Keystone it was entered for.",
    );

    stubProbe(probeRow({ _id: OTHER_PROBE_ID.toString() }));
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            credentialSecret: "",
            openStackCloudId: CLOUD_ID,
            probeId: OTHER_PROBE_ID,
          }),
        ),
      ),
    ).toBe(
      "Enter the credential again: a saved credential is only sent through the probe it was entered for.",
    );

    stubProbe(probeRow());
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({
            credentialSecret: "",
            openStackCloudId: CLOUD_ID,
            trustedCertificateFingerprints: [FINGERPRINT],
          }),
        ),
      ),
    ).toBe(
      "Enter the credential again: a saved credential is only sent to the certificates that were trusted when it was entered.",
    );
  });

  test("trusting the certificate the probe found there may use the saved credential", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);
    stubSavedCloud(
      savedCloud({ presentedCertificate: { fingerprint256: FINGERPRINT } }),
    );

    const createBy: CreateBy<OpenStackCloudConnectionTest> = newTest({
      credentialSecret: "",
      openStackCloudId: CLOUD_ID,
      trustedCertificateFingerprints: [FINGERPRINT],
    });
    await internals.onBeforeCreate(createBy);

    expect(createBy.data.credentialSecret).toBe("saved-secret");
  });

  test("a cloud of another project, or none, is not found, and one with no saved credential asks for it", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    stubActiveTests(service, 0);

    stubSavedCloud(null);
    expect(
      await refusal(
        internals.onBeforeCreate(newTest({ openStackCloudId: CLOUD_ID })),
      ),
    ).toBe("Cloud not found.");

    stubSavedCloud(
      savedCloud({ collectionMethod: OpenStackCollectionMethod.Agent }),
    );
    expect(
      await refusal(
        internals.onBeforeCreate(
          newTest({ credentialSecret: "", openStackCloudId: CLOUD_ID }),
        ),
      ),
    ).toBe("Enter an application credential's ID and secret.");

    // A typed secret needs no saved one, but the cloud must still be this project's.
    stubSavedCloud(
      savedCloud({ isCredentialSet: false, credentialSecret: undefined }),
    );
    const createBy: CreateBy<OpenStackCloudConnectionTest> = newTest({
      openStackCloudId: CLOUD_ID,
    });
    await internals.onBeforeCreate(createBy);
    expect(createBy.data.credentialSecret).toBe("typed-secret");
  });

  test("a project cannot flood its probes with tests, counted within that project", async () => {
    const { service, internals } = buildService();
    stubProbe(probeRow());
    const count: Spy = stubActiveTests(
      service,
      MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT,
    );

    expect(await refusal(internals.onBeforeCreate(newTest()))).toBe(
      "Several connection tests are still running in this project. Wait for them to finish, then test again.",
    );

    const query: Record<string, unknown> = (
      count.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(JSON.stringify(query["status"])).toContain(
      OpenStackConnectionTestStatus.Pending,
    );
    expect(JSON.stringify(query["status"])).toContain(
      OpenStackConnectionTestStatus.Running,
    );
    expect(count.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });
  });

  test("the project's references are the service's own to answer for", () => {
    const { internals } = buildService();

    expect(internals.getRelationsCheckedByService()).toEqual([
      "probe",
      "openStackCloud",
    ]);
  });
});

describe("claimPendingTests: each test is handed once, to its own probe, and its secret wiped", () => {
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
      'FROM "OpenStackCloudConnectionTest" t',
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
    expect(select.params[1]).toBe(OpenStackConnectionTestStatus.Pending);
    expect(select.params[3]).toBe(5);
    expect(select.params[4]).toBe(IsBillingEnabled);

    const age: number = Date.now() - (select.params[2] as Date).getTime();
    expect(age).toBeGreaterThanOrEqual(
      OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000 - 5000,
    );
    expect(age).toBeLessThanOrEqual(
      OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000 + 5000,
    );

    expect(flatten(statements[1]!.sql)).toBe(
      'UPDATE "OpenStackCloudConnectionTest" SET "status" = $1, "claimedAt" = $2::timestamptz WHERE "_id" = ANY($3::uuid[])',
    );
    expect(statements[1]!.params[0]).toBe(
      OpenStackConnectionTestStatus.Running,
    );
    expect(statements[1]!.params[2]).toEqual([TEST_ID, SECOND_TEST_ID]);
  });

  test("hands out what the probe needs, then wipes every claimed test's secret", async () => {
    const { service } = buildService();
    stubTransaction(service, [[{ _id: TEST_ID }, { _id: SECOND_TEST_ID }]]);

    const first: OpenStackCloudConnectionTest =
      new OpenStackCloudConnectionTest();
    first._id = TEST_ID;
    first.authUrl = "https://keystone.example.com:5000";
    first.endpointInterface = "internal";
    first.collectionRegions = ["RegionOne"];
    first.credentialKind = "applicationCredential";
    first.applicationCredentialId = "typed-id";
    first.credentialSecret = "typed-secret";
    first.trustedCertificateFingerprints = [FINGERPRINT.toLowerCase()];

    const second: OpenStackCloudConnectionTest =
      new OpenStackCloudConnectionTest();
    second._id = SECOND_TEST_ID;
    second.authUrl = "https://keystone.example.com:5000";
    second.credentialKind = "applicationCredential";
    second.applicationCredentialId = "typed-id";
    // Its secret is already gone, so it is not handed out.

    const read: Spy = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([second, first] as never) as unknown as Spy;
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    const jobs: Array<OpenStackConnectionTestJob> =
      await service.claimPendingTests({ probeId: PROBE_ID, limit: 5 });

    expect(jobs).toEqual([
      {
        openStackCloudConnectionTestId: TEST_ID,
        authUrl: "https://keystone.example.com:5000",
        credential: {
          kind: "applicationCredential",
          id: "typed-id",
          secret: "typed-secret",
        },
        regions: ["RegionOne"],
        endpointInterface: "internal",
        trustedCertificateFingerprints: [FINGERPRINT],
      },
    ]);
    expect(read.mock.calls[0]![0]).toMatchObject({
      select: { credentialSecret: true },
      props: { isRoot: true },
    });
    expect(writes).toEqual([
      { id: TEST_ID, data: { credentialSecret: null } },
      { id: SECOND_TEST_ID, data: { credentialSecret: null } },
    ]);
  });
});

describe("recordTestReport: only the probe a test was handed to answers it, once", () => {
  function report(
    overrides: Partial<OpenStackConnectionTestReport> = {},
  ): OpenStackConnectionTestReport {
    return {
      openStackCloudConnectionTestId: TEST_ID,
      status: "Succeeded",
      durationInMs: 300,
      ...overrides,
    };
  }

  function stubRunningTest(
    service: OpenStackCloudConnectionTestServiceType,
    found: boolean,
  ): Spy {
    const test: OpenStackCloudConnectionTest = new OpenStackCloudConnectionTest(
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
        report: report({ openStackCloudConnectionTestId: "nope" }),
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
        status: OpenStackConnectionTestStatus.Running,
      },
      props: { isRoot: true },
    });
    expect(writes).toEqual([]);
  });

  test("a success is settled, and no secret is left", async () => {
    const { service } = buildService();
    stubRunningTest(service, true);
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    expect(
      await service.recordTestReport({ probeId: PROBE_ID, report: report() }),
    ).toBe(true);
    expect(writes[0]!.id).toBe(TEST_ID);
    expect(writes[0]!.data).toMatchObject({
      status: OpenStackConnectionTestStatus.Succeeded,
      errorCode: null,
      errorMessage: null,
      presentedCertificate: null,
      credentialSecret: null,
    });
    expect(writes[0]!.data["completedAt"]).toBeInstanceOf(Date);
  });

  test("a failure keeps why, and the certificate when trusting it is the fix", async () => {
    const { service } = buildService();
    stubRunningTest(service, true);
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      stubColumnWrites(service);

    await service.recordTestReport({
      probeId: PROBE_ID,
      report: report({
        status: "Failed",
        errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
        errorMessage: "Not trusted.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=keystone",
          issuer: "CN=CA",
          isSelfSigned: false,
        },
      }),
    });

    expect(writes[0]!.data).toMatchObject({
      status: OpenStackConnectionTestStatus.Failed,
      errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      errorMessage: "Not trusted.",
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=keystone",
        issuer: "CN=CA",
        isSelfSigned: false,
      },
      credentialSecret: null,
    });
  });
});

describe("expireStaleTests: a person is never left waiting on a test nobody will answer", () => {
  test("fails tests no probe picked up, and tests whose probe never reported, wiping their secrets", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubRepositoryManager(service);

    await service.expireStaleTests();

    expect(statements).toHaveLength(2);

    const [pickup, run] = statements;

    expect(flatten(pickup!.sql)).toBe(
      'UPDATE "OpenStackCloudConnectionTest" SET "status" = $1, "errorCode" = $2, "errorMessage" = $3, "completedAt" = $4::timestamptz, "credentialSecret" = NULL WHERE "status" = $5 AND "deletedAt" IS NULL AND "createdAt" < $6::timestamptz',
    );
    expect(pickup!.params.slice(0, 3)).toEqual([
      OpenStackConnectionTestStatus.Failed,
      OpenStackCollectionErrorCode.ProbeNotAvailable,
      OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE,
    ]);
    expect(pickup!.params[4]).toBe(OpenStackConnectionTestStatus.Pending);
    expect(
      (pickup!.params[3] as Date).getTime() -
        (pickup!.params[5] as Date).getTime(),
    ).toBe(OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000);

    expect(flatten(run!.sql)).toContain('"claimedAt" < $6::timestamptz');
    expect(run!.params.slice(0, 3)).toEqual([
      OpenStackConnectionTestStatus.Failed,
      OpenStackCollectionErrorCode.TimedOut,
      OPENSTACK_TEST_NOT_REPORTED_MESSAGE,
    ]);
    expect(run!.params[4]).toBe(OpenStackConnectionTestStatus.Running);
    expect(
      (run!.params[3] as Date).getTime() - (run!.params[5] as Date).getTime(),
    ).toBe(OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS * 1000);
  });

  test("an installation with its own name reads that name in the reason that names the product", async () => {
    installFakeEnterpriseModule({ productBranding: { productName: "Acme" } });

    try {
      const { service } = buildService();
      const statements: Array<RecordedStatement> =
        stubRepositoryManager(service);

      await service.expireStaleTests();

      expect(statements[0]!.params[2]).toBe(
        "The probe did not pick up the test. It may be offline, or run a version of Acme older than OpenStack collection. Update it, or pick another probe.",
      );
      // The other never names the product.
      expect(statements[1]!.params[2]).toBe(
        OPENSTACK_TEST_NOT_REPORTED_MESSAGE,
      );
    } finally {
      uninstallEnterpriseModule();
    }

    // Without a name of its own, the sentence is OneUptime's.
    expect(OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE).toContain(
      "a version of OneUptime",
    );
  });
});

describe("what is kept of a test", () => {
  test("nothing past a day: it is a moment's question", () => {
    const { service } = buildService();

    expect(service.hardDeleteItemByColumnName).toBe("createdAt");
    expect(service.hardDeleteItemsOlderThanDays).toBe(1);
  });
});
