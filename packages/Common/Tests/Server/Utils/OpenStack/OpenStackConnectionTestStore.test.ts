import { describe, expect, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import OpenStackConnectionTestStore, {
  OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE,
  OPENSTACK_TEST_NOT_REPORTED_MESSAGE,
  OpenStackConnectionTestRecord,
  OpenStackConnectionTestService,
  OpenStackSavedCloudForTest,
} from "../../../../Server/Utils/OpenStack/OpenStackConnectionTestStore";
import ObjectID from "../../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackConnectionTestStatus, {
  MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT,
  OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS,
  OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS,
} from "../../../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
} from "../../../../Types/OpenStack/OpenStackProbeCollection";

/*
 * "Test connection": checked like the connection it is about to become, handed once to the
 * probe it names, with the secret wiped from the row as it is handed out, answered only by
 * that probe, and failed with the reason when no probe picks it up or reports in time. The
 * table is the phase's to add, so this runs against the interface its service will meet.
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

const AUTH_URL: string = "https://keystone.example.com:5000";

const FINGERPRINT: string = Array.from({ length: 32 }, () => {
  return "AA";
}).join(":");
const OTHER_FINGERPRINT: string = Array.from({ length: 32 }, () => {
  return "BB";
}).join(":");

function savedCloud(
  overrides: Partial<OpenStackSavedCloudForTest> = {},
): OpenStackSavedCloudForTest {
  return {
    collectionMethod: OpenStackCollectionMethod.Probe,
    authUrl: AUTH_URL,
    credentialKind: "applicationCredential",
    applicationCredentialId: "saved-id",
    credentialSecret: "saved-secret",
    isCredentialSet: true,
    collectionProbeId: PROBE_ID,
    trustedCertificateFingerprints: [FINGERPRINT],
    ...overrides,
  };
}

async function prepare(
  values: Record<string, unknown>,
  overrides: Partial<
    Parameters<typeof OpenStackConnectionTestStore.prepareCreate>[0]
  > = {},
): Promise<Record<string, unknown>> {
  await OpenStackConnectionTestStore.prepareCreate({
    values: values,
    projectId: PROJECT_ID,
    probeId: PROBE_ID,
    openStackCloudId: null,
    readSavedCloud: async (): Promise<OpenStackSavedCloudForTest | null> => {
      return null;
    },
    countActiveTests: async (): Promise<number> => {
      return 0;
    },
    assertProbeCanCollect: async (): Promise<void> => {},
    ...overrides,
  });

  return values;
}

const GIVEN: Record<string, unknown> = {
  authUrl: "https://keystone.example.com:5000/v3/",
  applicationCredentialId: " an-id ",
  credentialSecret: "a-secret",
};

describe("starting a test", () => {
  test("what it was given, normalized as a saved cloud's would be", async () => {
    const values: Record<string, unknown> = await prepare({
      ...GIVEN,
      collectionRegions: [" RegionOne ", "RegionOne"],
      trustedCertificateFingerprints: [FINGERPRINT.toLowerCase()],
    });

    expect(values).toMatchObject({
      authUrl: AUTH_URL,
      endpointInterface: "public",
      collectionRegions: ["RegionOne"],
      trustedCertificateFingerprints: [FINGERPRINT],
      credentialKind: "applicationCredential",
      applicationCredentialId: "an-id",
      credentialSecret: "a-secret",
    });
  });

  test("a user name and password, with their project", async () => {
    const values: Record<string, unknown> = await prepare({
      authUrl: AUTH_URL,
      keystoneUsername: "monitor",
      credentialSecret: "hunter2",
      projectName: "monitoring",
    });

    expect(values).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "monitor",
      credentialSecret: "hunter2",
      projectName: "monitoring",
      userDomainName: "Default",
      projectDomainName: "Default",
    });
  });

  test("nothing asked of the regions means every one the catalog names", async () => {
    expect((await prepare({ ...GIVEN }))["collectionRegions"]).toEqual([]);
  });

  test.each([
    ["no project", { projectId: null }, GIVEN, "project is missing"],
    ["no probe", { probeId: null }, GIVEN, "Pick the probe to test from"],
    [
      "plain HTTP",
      {},
      { ...GIVEN, authUrl: "http://keystone.example.com" },
      "Use https://",
    ],
    [
      "no address",
      {},
      { ...GIVEN, authUrl: undefined },
      "Enter Keystone's address",
    ],
    [
      "an address no probe connects to",
      {},
      { ...GIVEN, authUrl: "https://127.0.0.1" },
      "Loopback",
    ],
    [
      "an interface there is no such thing as",
      {},
      { ...GIVEN, endpointInterface: "private" },
      "public, internal or admin",
    ],
    [
      "a region that is not one",
      {},
      { ...GIVEN, collectionRegions: [7] },
      "A region's name is text",
    ],
    [
      "a fingerprint that is not one",
      {},
      { ...GIVEN, trustedCertificateFingerprints: ["no"] },
      "SHA-256",
    ],
    [
      "no secret, and no cloud to take one from",
      {},
      { authUrl: AUTH_URL },
      "Enter an application credential's ID and secret",
    ],
    [
      "a secret with nothing naming it",
      {},
      { authUrl: AUTH_URL, credentialSecret: "s" },
      "needs both its ID and its secret",
    ],
    [
      "a password with no project",
      {},
      { authUrl: AUTH_URL, keystoneUsername: "u", credentialSecret: "s" },
      "the project they log in to",
    ],
  ])(
    "%s is refused",
    async (
      _name: string,
      overrides: object,
      values: Record<string, unknown>,
      words: string,
    ) => {
      await expect(prepare({ ...values }, overrides)).rejects.toThrow(words);
    },
  );

  test("a probe that may not hold the credential is refused before it reads a saved one", async () => {
    let wasRead: boolean = false;

    const readSavedCloud: () => Promise<OpenStackSavedCloudForTest | null> =
      async (): Promise<OpenStackSavedCloudForTest | null> => {
        wasRead = true;
        return savedCloud();
      };

    await expect(
      prepare(
        { authUrl: AUTH_URL },
        {
          openStackCloudId: CLOUD_ID,
          readSavedCloud: readSavedCloud,
          assertProbeCanCollect: async (): Promise<void> => {
            throw new Error(
              "Shared probes never receive OpenStack credentials.",
            );
          },
        },
      ),
    ).rejects.toThrow("Shared probes");

    expect(wasRead).toBe(false);
  });

  test("too many at once: a person is told to wait, and the cloud is not asked for more", async () => {
    await expect(
      prepare(
        { ...GIVEN },
        {
          countActiveTests: async (): Promise<number> => {
            return MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT;
          },
        },
      ),
    ).rejects.toThrow("Several connection tests are still running");
  });

  test("one under that is let through", async () => {
    await expect(
      prepare(
        { ...GIVEN },
        {
          countActiveTests: async (): Promise<number> => {
            return MAX_ACTIVE_OPENSTACK_CONNECTION_TESTS_PER_PROJECT - 1;
          },
        },
      ),
    ).resolves.toBeDefined();
  });
});

describe("a test of a saved cloud", () => {
  function ofSaved(
    values: Record<string, unknown>,
    saved: OpenStackSavedCloudForTest | null,
    probeId: ObjectID = PROBE_ID,
  ): Promise<Record<string, unknown>> {
    return prepare(values, {
      openStackCloudId: CLOUD_ID,
      probeId: probeId,
      readSavedCloud: async (): Promise<OpenStackSavedCloudForTest | null> => {
        return saved;
      },
    });
  }

  test("that does not exist, however it does not, is simply not found", async () => {
    await expect(ofSaved({ ...GIVEN }, null)).rejects.toThrow(
      "Cloud not found.",
    );
    await expect(ofSaved({ authUrl: AUTH_URL }, null)).rejects.toThrow(
      "Cloud not found.",
    );
  });

  test("may use its saved credential, without anyone seeing it", async () => {
    const values: Record<string, unknown> = await ofSaved(
      {
        authUrl: AUTH_URL,
        trustedCertificateFingerprints: [FINGERPRINT],
      },
      savedCloud(),
    );

    expect(values).toMatchObject({
      credentialKind: "applicationCredential",
      applicationCredentialId: "saved-id",
      credentialSecret: "saved-secret",
    });
  });

  test("a saved password too", async () => {
    const values: Record<string, unknown> = await ofSaved(
      {
        authUrl: AUTH_URL,
        trustedCertificateFingerprints: [FINGERPRINT],
      },
      savedCloud({
        credentialKind: "password",
        applicationCredentialId: undefined,
        keystoneUsername: "monitor",
        projectName: "monitoring",
        credentialSecret: "hunter2",
      }),
    );

    expect(values).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "monitor",
      credentialSecret: "hunter2",
    });
  });

  test("a cloud the agent reports has no saved credential to use", async () => {
    await expect(
      ofSaved(
        { authUrl: AUTH_URL },
        savedCloud({
          collectionMethod: OpenStackCollectionMethod.Agent,
          isCredentialSet: false,
        }),
      ),
    ).rejects.toThrow("Enter an application credential's ID and secret");
  });

  test("one that holds none has none to use", async () => {
    await expect(
      ofSaved(
        { authUrl: AUTH_URL },
        savedCloud({ isCredentialSet: false, credentialSecret: undefined }),
      ),
    ).rejects.toThrow("Enter an application credential's ID and secret");
  });

  test("pointing it at a server of one's own does not deliver the saved secret there", async () => {
    await expect(
      ofSaved(
        {
          authUrl: "https://evil.example.com:5000",
          trustedCertificateFingerprints: [FINGERPRINT],
        },
        savedCloud(),
      ),
    ).rejects.toThrow("only sent to the Keystone it was entered for");
  });

  test("nor a probe of one's own", async () => {
    await expect(
      ofSaved(
        { authUrl: AUTH_URL, trustedCertificateFingerprints: [FINGERPRINT] },
        savedCloud(),
        OTHER_PROBE_ID,
      ),
    ).rejects.toThrow("only sent through the probe it was entered for");
  });

  test("nor a certificate of one's own", async () => {
    await expect(
      ofSaved(
        {
          authUrl: AUTH_URL,
          trustedCertificateFingerprints: [FINGERPRINT, OTHER_FINGERPRINT],
        },
        savedCloud(),
      ),
    ).rejects.toThrow("only sent to the certificates that were trusted");
  });

  test("the very certificate the probe found there may be tried with it", async () => {
    const values: Record<string, unknown> = await ofSaved(
      {
        authUrl: AUTH_URL,
        trustedCertificateFingerprints: [FINGERPRINT, OTHER_FINGERPRINT],
      },
      savedCloud({
        presentedCertificate: { fingerprint256: OTHER_FINGERPRINT },
      }),
    );

    expect(values["credentialSecret"]).toBe("saved-secret");
  });

  test("a new password retyped for it: the saved names are that password's", async () => {
    const values: Record<string, unknown> = await ofSaved(
      { authUrl: AUTH_URL, credentialSecret: "retyped" },
      savedCloud({
        credentialKind: "password",
        applicationCredentialId: undefined,
        keystoneUsername: "monitor",
        projectName: "monitoring",
        credentialSecret: undefined,
      }),
    );

    expect(values).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "monitor",
      projectName: "monitoring",
      credentialSecret: "retyped",
    });
  });

  test("a test that brings its own secret may go anywhere, because it is its own", async () => {
    const values: Record<string, unknown> = await ofSaved(
      {
        ...GIVEN,
        authUrl: "https://other.example.com:5000",
      },
      savedCloud(),
    );

    expect(values).toMatchObject({
      authUrl: "https://other.example.com:5000",
      applicationCredentialId: "an-id",
      credentialSecret: "a-secret",
    });
  });
});

interface FakeTestService {
  service: OpenStackConnectionTestService;
  queries: Array<{ sql: string; parameters: Array<unknown> }>;
  order: Array<string>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  findOneByCalls: Array<Record<string, unknown>>;
}

function fakeService(data: {
  selectedRows?: Array<{ _id: string }>;
  tests?: Array<OpenStackConnectionTestRecord>;
  test?: OpenStackConnectionTestRecord | null;
}): FakeTestService {
  const queries: Array<{ sql: string; parameters: Array<unknown> }> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const findOneByCalls: Array<Record<string, unknown>> = [];
  const order: Array<string> = [];

  return {
    queries: queries,
    order: order,
    updates: updates,
    findOneByCalls: findOneByCalls,
    service: {
      executeTransaction: async <T>(
        run: (manager: {
          query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
        }) => Promise<T>,
      ): Promise<T> => {
        return await run({
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            queries.push({ sql: sql, parameters: parameters });

            return sql.trim().startsWith("SELECT")
              ? data.selectedRows || []
              : [];
          },
        });
      },
      countBy: async (): Promise<{ toNumber: () => number }> => {
        return {
          toNumber: (): number => {
            return 0;
          },
        };
      },
      findBy: async (): Promise<Array<OpenStackConnectionTestRecord>> => {
        order.push("read");
        return data.tests || [];
      },
      findOneBy: async (
        options: Record<string, unknown>,
      ): Promise<OpenStackConnectionTestRecord | null> => {
        findOneByCalls.push(options);
        return data.test === undefined ? null : data.test;
      },
      updateColumnsByIdWithoutHooks: async (input: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        order.push("wipe");
        updates.push({ id: input.id.toString(), data: input.data });
      },
    },
  };
}

function testRow(
  overrides: Partial<OpenStackConnectionTestRecord> = {},
): OpenStackConnectionTestRecord {
  return {
    _id: TEST_ID,
    authUrl: AUTH_URL,
    endpointInterface: "internal",
    collectionRegions: ["RegionOne"],
    credentialKind: "applicationCredential",
    applicationCredentialId: "an-id",
    credentialSecret: "a-secret",
    trustedCertificateFingerprints: [FINGERPRINT],
    ...overrides,
  };
}

describe("handing tests to a probe", () => {
  function claim(
    fake: FakeTestService,
    limit: number = 5,
  ): Promise<Array<OpenStackConnectionTestJob>> {
    return OpenStackConnectionTestStore.claimPendingTests(fake.service, {
      probeId: PROBE_ID,
      limit: limit,
    });
  }

  test("no room asks nothing", async () => {
    const fake: FakeTestService = fakeService({});

    await expect(claim(fake, 0)).resolves.toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  test("only what names this probe, is pending, is its own and has not gone stale", async () => {
    const fake: FakeTestService = fakeService({});

    const before: number = Date.now();

    await claim(fake);

    const [select] = fake.queries;

    expect(select?.sql).toContain('t."probeId" = $1');
    expect(select?.sql).toContain('t."status" = $2');
    expect(select?.sql).toContain('t."createdAt" >= $3');
    expect(select?.sql).toContain("FOR UPDATE OF t SKIP LOCKED");
    expect(select?.sql).toContain(
      '(pr."isGlobalProbe" = false AND pr."projectId" = t."projectId")',
    );
    expect(select?.sql).toContain(
      '(pr."isGlobalProbe" = true AND $5::boolean = false)',
    );

    expect(select?.parameters[0]).toBe(PROBE_ID.toString());
    expect(select?.parameters[1]).toBe(OpenStackConnectionTestStatus.Pending);
    expect(select?.parameters[3]).toBe(5);
    expect(select?.parameters[4]).toBe(IsBillingEnabled);

    const oldest: number = (select?.parameters[2] as Date).getTime();

    expect(oldest).toBeGreaterThanOrEqual(
      before -
        OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000 -
        1000,
    );
    expect(oldest).toBeLessThanOrEqual(
      Date.now() - OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000,
    );
  });

  test("nothing pending touches nothing", async () => {
    const fake: FakeTestService = fakeService({ selectedRows: [] });

    await expect(claim(fake)).resolves.toEqual([]);
    expect(fake.queries).toHaveLength(1);
    expect(fake.order).toEqual([]);
  });

  test("once each: running from the moment it is claimed", async () => {
    const fake: FakeTestService = fakeService({
      selectedRows: [{ _id: TEST_ID }],
      tests: [testRow()],
    });

    await claim(fake);

    expect(fake.queries[1]?.sql).toContain('"status" = $1');
    expect(fake.queries[1]?.sql).toContain('"claimedAt" = $2::timestamptz');
    expect(fake.queries[1]?.parameters[0]).toBe(
      OpenStackConnectionTestStatus.Running,
    );
    expect(fake.queries[1]?.parameters[2]).toEqual([TEST_ID]);
  });

  test("the job holds the secret, and the row no longer does", async () => {
    const fake: FakeTestService = fakeService({
      selectedRows: [{ _id: TEST_ID }],
      tests: [testRow()],
    });

    await expect(claim(fake)).resolves.toEqual([
      {
        openStackCloudConnectionTestId: TEST_ID,
        authUrl: AUTH_URL,
        credential: {
          kind: "applicationCredential",
          id: "an-id",
          secret: "a-secret",
        },
        regions: ["RegionOne"],
        endpointInterface: "internal",
        trustedCertificateFingerprints: [FINGERPRINT],
      },
    ]);

    expect(fake.updates).toEqual([
      { id: TEST_ID, data: { credentialSecret: null } },
    ]);
    // Read, then wiped: there is no moment a wiped row is what gets handed out.
    expect(fake.order).toEqual(["read", "wipe"]);
  });

  test("the oldest first, however they read back", async () => {
    const fake: FakeTestService = fakeService({
      selectedRows: [{ _id: TEST_ID }, { _id: SECOND_TEST_ID }],
      tests: [testRow({ _id: SECOND_TEST_ID }), testRow({ _id: TEST_ID })],
    });

    const jobs: Array<OpenStackConnectionTestJob> = await claim(fake);

    expect(
      jobs.map((job: OpenStackConnectionTestJob) => {
        return job.openStackCloudConnectionTestId;
      }),
    ).toEqual([TEST_ID, SECOND_TEST_ID]);
  });

  test("a row it cannot make a job of is wiped all the same, and not handed out", async () => {
    const fake: FakeTestService = fakeService({
      selectedRows: [{ _id: TEST_ID }],
      tests: [testRow({ authUrl: undefined })],
    });

    await expect(claim(fake)).resolves.toEqual([]);
    expect(fake.updates).toHaveLength(1);
  });

  test("what a row is missing has a safe answer", async () => {
    const fake: FakeTestService = fakeService({
      selectedRows: [{ _id: TEST_ID }],
      tests: [
        testRow({
          collectionRegions: undefined,
          endpointInterface: "somewhere",
          trustedCertificateFingerprints: undefined,
        }),
      ],
    });

    expect((await claim(fake))[0]).toMatchObject({
      regions: [],
      endpointInterface: "public",
      trustedCertificateFingerprints: [],
    });
  });
});

describe("what a probe reports", () => {
  function report(
    overrides: Partial<OpenStackConnectionTestReport> = {},
  ): OpenStackConnectionTestReport {
    return {
      openStackCloudConnectionTestId: TEST_ID,
      status: "Succeeded",
      durationInMs: 10,
      ...overrides,
    };
  }

  function record(
    fake: FakeTestService,
    overrides: Partial<OpenStackConnectionTestReport> = {},
  ): Promise<boolean> {
    return OpenStackConnectionTestStore.recordTestReport(fake.service, {
      probeId: PROBE_ID,
      report: report(overrides),
    });
  }

  test.each([[""], ["not-an-id"]])(
    "naming no test (%j) is not heard",
    async (id: string) => {
      const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

      await expect(
        record(fake, { openStackCloudConnectionTestId: id }),
      ).resolves.toBe(false);
      expect(fake.findOneByCalls).toEqual([]);
    },
  );

  test("only the probe it was handed to answers it, and only while it runs", async () => {
    const fake: FakeTestService = fakeService({ test: null });

    await expect(record(fake)).resolves.toBe(false);

    expect(fake.findOneByCalls[0]?.["query"]).toMatchObject({
      probeId: PROBE_ID,
      status: OpenStackConnectionTestStatus.Running,
    });
    expect(fake.updates).toEqual([]);
  });

  test("a success, and no secret left behind", async () => {
    const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

    await expect(record(fake)).resolves.toBe(true);

    expect(fake.updates[0]?.id).toBe(TEST_ID);
    expect(fake.updates[0]?.data).toMatchObject({
      status: OpenStackConnectionTestStatus.Succeeded,
      errorCode: null,
      errorMessage: null,
      presentedCertificate: null,
      credentialSecret: null,
    });
    expect(fake.updates[0]?.data["completedAt"]).toBeInstanceOf(Date);
  });

  test("a failure says why", async () => {
    const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

    await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
      errorMessage: "Keystone refused it.",
    });

    expect(fake.updates[0]?.data).toMatchObject({
      status: OpenStackConnectionTestStatus.Failed,
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
      errorMessage: "Keystone refused it.",
      credentialSecret: null,
    });
  });

  test("a certificate it could not trust comes back with what it showed", async () => {
    const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

    await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      errorMessage: "Not trusted.",
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=a",
        issuer: "CN=a",
        isSelfSigned: true,
      },
    });

    expect(fake.updates[0]?.data["presentedCertificate"]).toMatchObject({
      fingerprint256: FINGERPRINT,
    });
  });

  test("a certificate with another failure is nothing to trust", async () => {
    const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

    await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.NoPermission,
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=a",
        issuer: "CN=a",
        isSelfSigned: true,
      },
    });

    expect(fake.updates[0]?.data["presentedCertificate"]).toBeNull();
  });

  test("a code it does not know is Internal", async () => {
    const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

    await record(fake, {
      status: "Failed",
      errorCode: "Whatever" as OpenStackCollectionErrorCode,
    });

    expect(fake.updates[0]?.data["errorCode"]).toBe(
      OpenStackCollectionErrorCode.Internal,
    );
    expect(fake.updates[0]?.data["errorMessage"]).toBeTruthy();
  });

  test("a failed test still says what it found before it stopped", async () => {
    const fake: FakeTestService = fakeService({ test: { _id: TEST_ID } });

    await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.CertificateChanged,
      summary: {
        credentialKind: "applicationCredential",
        roleNames: ["reader"],
        hasAccessRules: false,
        isUnrestricted: false,
        canProbablyWrite: false,
        regionsInCatalog: ["RegionOne"],
        servicesByRegion: {},
        accessLevel: "Other",
        reads: [],
        warnings: [],
      },
    });

    expect(fake.updates[0]?.data["summary"]).toMatchObject({
      regionsInCatalog: ["RegionOne"],
      accessLevel: "Other",
    });
  });
});

describe("the tests nobody will answer", () => {
  function expire(): Promise<
    Array<{ sql: string; parameters: Array<unknown> }>
  > {
    const queries: Array<{ sql: string; parameters: Array<unknown> }> = [];

    return OpenStackConnectionTestStore.expireStaleTests({
      query: async (sql: string, parameters: Array<unknown>): Promise<void> => {
        queries.push({ sql: sql, parameters: parameters });
      },
    }).then(() => {
      return queries;
    });
  }

  test("one no probe picked up fails, says why, and takes its secret with it", async () => {
    const before: number = Date.now();

    const [pending] = await expire();

    expect(pending?.sql).toContain('"credentialSecret" = NULL');
    expect(pending?.sql).toContain('"status" = $5');
    expect(pending?.sql).toContain('"createdAt" < $6::timestamptz');
    expect(pending?.parameters[0]).toBe(OpenStackConnectionTestStatus.Failed);
    expect(pending?.parameters[1]).toBe(
      OpenStackCollectionErrorCode.ProbeNotAvailable,
    );
    expect(typeof pending?.parameters[2]).toBe("string");
    expect(pending?.parameters[2]).toContain("did not pick up the test");
    expect(OPENSTACK_TEST_NOT_PICKED_UP_MESSAGE).toContain("OneUptime");
    expect(pending?.parameters[4]).toBe(OpenStackConnectionTestStatus.Pending);

    const cutoff: number = (pending?.parameters[5] as Date).getTime();

    expect(cutoff).toBeGreaterThanOrEqual(
      before -
        OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000 -
        1000,
    );
    expect(cutoff).toBeLessThanOrEqual(
      Date.now() - OPENSTACK_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS * 1000,
    );
  });

  test("one a probe took and never answered fails too", async () => {
    const [, running] = await expire();

    expect(running?.sql).toContain('"credentialSecret" = NULL');
    expect(running?.sql).toContain('"claimedAt" < $6::timestamptz');
    expect(running?.parameters.slice(0, 3)).toEqual([
      OpenStackConnectionTestStatus.Failed,
      OpenStackCollectionErrorCode.TimedOut,
      OPENSTACK_TEST_NOT_REPORTED_MESSAGE,
    ]);
    expect(running?.parameters[4]).toBe(OpenStackConnectionTestStatus.Running);

    const cutoff: number = (running?.parameters[5] as Date).getTime();

    expect(cutoff).toBeLessThanOrEqual(
      Date.now() - OPENSTACK_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS * 1000,
    );
  });
});
