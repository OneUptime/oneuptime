import { describe, expect, jest, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import OpenStackProbeCollectionStore, {
  OpenStackCollectionCloudRecord,
  OpenStackCollectionCloudService,
  OpenStackCollectionReportOutcome,
} from "../../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import logger from "../../../../Server/Utils/Logger";
import { SubscriptionStatusUtil } from "../../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../../Types/OpenStack/OpenStackCollectionStatus";
import {
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackCollectionSummary,
  OpenStackConnectionTestSummary,
  OpenStackPresentedCertificate,
} from "../../../../Types/OpenStack/OpenStackProbeCollection";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import {
  DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
} from "../../../../Utils/OpenStack/OpenStackCollectionSettings";

/*
 * The database half of probe collection, against a recording fake of the cloud service:
 * which clouds a probe is handed (once, its own, due, with the credential), and what a report
 * may write (only its probe's, only the current settings' status). No table exists yet for
 * this to run against, so the fake is written to the interface the service will meet.
 */

const PROBE_ID: ObjectID = new ObjectID("4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0001");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "4d1b9f52-7a0e-4f34-9a0b-2b7c3f1d0002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7c0e9d1a-1111-4b2c-8d3e-000000000001",
);
const CLOUD_ID: string = "9e8d7c6b-2222-4a1b-9c0d-000000000001";
const CLOUD_ID_2: string = "9e8d7c6b-2222-4a1b-9c0d-000000000002";

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

interface Query {
  sql: string;
  parameters: Array<unknown>;
}

interface FakeService {
  service: OpenStackCollectionCloudService;
  queries: Array<Query>;
  findByCalls: Array<Record<string, unknown>>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
}

function fakeService(data: {
  // What the claim's one statement answers: the ids it claimed, in claim order.
  claimedIds?: Array<string>;
  clouds?: Array<OpenStackCollectionCloudRecord>;
  cloud?: OpenStackCollectionCloudRecord | null;
  updateFails?: boolean;
}): FakeService {
  const queries: Array<Query> = [];
  const findByCalls: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  return {
    queries: queries,
    findByCalls: findByCalls,
    updates: updates,
    service: {
      // No transaction to open: the claim is one self-committing statement.
      getRepository: () => {
        return {
          manager: {
            query: async (
              sql: string,
              parameters: Array<unknown>,
            ): Promise<unknown> => {
              queries.push({ sql: sql, parameters: parameters });

              return (data.claimedIds || []).map((id: string) => {
                return { _id: id };
              });
            },
          },
        };
      },
      findBy: async (
        options: Record<string, unknown>,
      ): Promise<Array<OpenStackCollectionCloudRecord>> => {
        findByCalls.push(options);
        return data.clouds || [];
      },
      findOneById: async (): Promise<OpenStackCollectionCloudRecord | null> => {
        return data.cloud === undefined ? null : data.cloud;
      },
      updateColumnsByIdWithoutHooks: async (input: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        if (data.updateFails) {
          throw new Error("The database is gone.");
        }

        updates.push({ id: input.id.toString(), data: input.data });
      },
    },
  };
}

function cloudRow(
  overrides: Partial<OpenStackCollectionCloudRecord> = {},
): OpenStackCollectionCloudRecord {
  return {
    _id: CLOUD_ID,
    name: "Production",
    authUrl: "https://keystone.example.com:5000",
    endpointInterface: "public",
    collectionRegions: ["RegionOne", "RegionTwo"],
    credentialKind: "applicationCredential",
    applicationCredentialId: "an-id",
    credentialSecret: "the-secret",
    trustedCertificateFingerprints: [FINGERPRINT],
    collectionIntervalInMinutes: 5,
    collectionSettingsVersion: 4,
    ...overrides,
  };
}

function collectedCloud(
  overrides: Partial<OpenStackCollectionCloudRecord> = {},
): OpenStackCollectionCloudRecord {
  return {
    _id: CLOUD_ID,
    projectId: PROJECT_ID,
    name: "Production",
    collectionMethod: OpenStackCollectionMethod.Probe,
    collectionProbeId: PROBE_ID,
    collectionProbe: { isGlobalProbe: false, projectId: PROJECT_ID },
    collectionSettingsVersion: 4,
    ...overrides,
  };
}

function report(
  overrides: Partial<OpenStackCollectionReport> = {},
): OpenStackCollectionReport {
  return {
    openStackCloudId: CLOUD_ID,
    settingsVersion: 4,
    collectedAt: "2026-11-04T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 1200,
    ...overrides,
  };
}

async function claim(
  service: OpenStackCollectionCloudService,
  overrides: { runningOpenStackCloudIds?: Array<string>; limit?: number } = {},
): Promise<Array<OpenStackCollectionJob>> {
  return await OpenStackProbeCollectionStore.claimDueClouds(service, {
    probeId: PROBE_ID,
    runningOpenStackCloudIds: overrides.runningOpenStackCloudIds || [],
    limit: overrides.limit ?? 4,
  });
}

describe("claiming clouds", () => {
  test("no free slots asks nothing", async () => {
    const fake: FakeService = fakeService({});

    await expect(claim(fake.service, { limit: 0 })).resolves.toEqual([]);
    await expect(claim(fake.service, { limit: -1 })).resolves.toEqual([]);

    expect(fake.queries).toEqual([]);
  });

  test("the SQL says which clouds, in the rules a probe is held to", async () => {
    const fake: FakeService = fakeService({});

    await claim(fake.service);

    const [select] = fake.queries;

    expect(select?.sql).toContain('c."collectionProbeId" = $1');
    expect(select?.sql).toContain('c."collectionMethod" = $5');
    expect(select?.sql).toContain('c."deletedAt" IS NULL');
    expect(select?.sql).toContain('c."isArchived" = false');
    expect(select?.sql).toContain('c."isCredentialSet" = true');
    expect(select?.sql).toContain('c."authUrl" IS NOT NULL');
    expect(select?.sql).toContain(
      '(c."nextCollectionAt" IS NULL OR c."nextCollectionAt" <= $2)',
    );
    expect(select?.sql).toContain('NOT (c."_id" = ANY($6::uuid[]))');
    /*
     * Two work requests never hand one cloud out twice - with FOR NO KEY
     * UPDATE, never FOR UPDATE: the foreign-key check of a row that names a
     * cloud takes FOR KEY SHARE, which FOR UPDATE would make wait (OneUptime
     * issue #7194).
     */
    expect(select?.sql).toContain("FOR NO KEY UPDATE OF c SKIP LOCKED");
    expect(select?.sql).not.toMatch(/FOR UPDATE/);
    // The longest overdue first.
    expect(select?.sql).toContain(
      'ORDER BY c."nextCollectionAt" ASC NULLS FIRST',
    );
    expect(select?.sql).toContain("LIMIT $3");
  });

  test("the tenancy backstop holds rows written before the save hooks did", async () => {
    const fake: FakeService = fakeService({});

    await claim(fake.service);

    const sql: string = fake.queries[0]?.sql as string;

    expect(sql).toContain(
      '(pr."isGlobalProbe" = false AND pr."projectId" = c."projectId")',
    );
    expect(sql).toContain(
      '(pr."isGlobalProbe" = true AND $7::boolean = false)',
    );
    expect(sql).toContain('pr."deletedAt" IS NULL');
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toContain('p."isBlocked" = false');
    expect(sql).toContain('p."paymentProviderSubscriptionStatus" IS NULL');
    expect(sql).toContain(
      'p."paymentProviderMeteredSubscriptionStatus" IS NULL',
    );
  });

  test("its parameters", async () => {
    const fake: FakeService = fakeService({});

    await claim(fake.service, {
      runningOpenStackCloudIds: [CLOUD_ID_2],
      limit: 3,
    });

    const [probeId, now, limit, statuses, method, running, billing] = fake
      .queries[0]?.parameters as Array<unknown>;

    expect(probeId).toBe(PROBE_ID.toString());
    expect(now).toBeInstanceOf(Date);
    expect(limit).toBe(3);
    expect(statuses).toEqual(
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    );
    expect(method).toBe(OpenStackCollectionMethod.Probe);
    expect(running).toEqual([CLOUD_ID_2]);
    expect(billing).toBe(IsBillingEnabled);
  });

  test("what a probe says it is running is not trusted to be an id: SQL would throw on it", async () => {
    const fake: FakeService = fakeService({});

    await claim(fake.service, {
      runningOpenStackCloudIds: [CLOUD_ID, "not-an-id", "'; DROP TABLE x; --"],
    });

    expect(fake.queries[0]?.parameters[5]).toEqual([CLOUD_ID]);
  });

  test("nothing due touches nothing, and reads nothing", async () => {
    const fake: FakeService = fakeService({ claimedIds: [] });

    await expect(claim(fake.service)).resolves.toEqual([]);

    expect(fake.queries).toHaveLength(1);
    expect(fake.findByCalls).toEqual([]);
  });

  test("each claimed cloud's next collection moves an interval on, in the same statement", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID, CLOUD_ID_2],
      clouds: [],
    });

    await claim(fake.service);

    // One statement locks, moves and answers: nothing waits between them.
    expect(fake.queries).toHaveLength(1);
    const statement: Query = fake.queries[0]!;
    const sql: string = statement.sql.replace(/\s+/g, " ");

    expect(sql).toContain('UPDATE "OpenStackCloud" AS c');
    // getSafeInterval's rule: none or not positive is the default, else 1 to 60.
    expect(sql).toContain(
      'SET "nextCollectionAt" = $2::timestamptz + ( CASE WHEN c."collectionIntervalInMinutes" IS NULL OR c."collectionIntervalInMinutes" <= 0 THEN $8::int ELSE LEAST(GREATEST(c."collectionIntervalInMinutes", $9::int), $10::int) END ) * INTERVAL \'1 minute\'',
    );
    expect(sql).toContain('FROM "due" WHERE c."_id" = "due"."_id"');
    expect(statement.parameters.slice(7)).toEqual([
      DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
      MIN_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
      MAX_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
    ]);
    // Only what the statement wrote is answered, the longest overdue first.
    expect(sql).toContain(
      'INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id" ORDER BY "due"."dueAt" ASC NULLS FIRST',
    );
  });

  test("an application credential's job", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID],
      clouds: [cloudRow()],
    });

    await expect(claim(fake.service)).resolves.toEqual([
      {
        openStackCloudId: CLOUD_ID,
        cloudName: "Production",
        authUrl: "https://keystone.example.com:5000",
        credential: {
          kind: "applicationCredential",
          id: "an-id",
          secret: "the-secret",
        },
        regions: ["RegionOne", "RegionTwo"],
        endpointInterface: "public",
        trustedCertificateFingerprints: [FINGERPRINT],
        collectionIntervalInMinutes: 5,
        settingsVersion: 4,
        // What a cloud nobody has set anything on reads of its instances.
        options: { instanceSeriesMode: "automatic", keptProjectIds: [] },
      },
    ]);
  });

  test("a password's job", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID],
      clouds: [
        cloudRow({
          credentialKind: "password",
          applicationCredentialId: undefined,
          keystoneUsername: "monitor",
          userDomainName: "Users",
          projectName: "monitoring",
          projectDomainName: "Projects",
          credentialSecret: "hunter2",
        }),
      ],
    });

    const [job] = await claim(fake.service);

    expect(job?.credential).toEqual({
      kind: "password",
      username: "monitor",
      password: "hunter2",
      userDomainName: "Users",
      projectName: "monitoring",
      projectDomainName: "Projects",
    });
  });

  test("it reads as OneUptime, because that is what decrypts the secret, and only what it needs", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID],
      clouds: [cloudRow()],
    });

    await claim(fake.service);

    expect(fake.findByCalls[0]).toMatchObject({
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
    expect(
      Object.keys(
        fake.findByCalls[0]?.["select"] as Record<string, unknown>,
      ).sort(),
    ).toEqual(
      [
        "_id",
        "name",
        "authUrl",
        "endpointInterface",
        "instanceMetricsOptions",
        "collectionRegions",
        "credentialKind",
        "applicationCredentialId",
        "keystoneUsername",
        "userDomainName",
        "projectName",
        "projectDomainName",
        "credentialSecret",
        "trustedCertificateFingerprints",
        "collectionIntervalInMinutes",
        "collectionSettingsVersion",
        "collectionOptions",
      ].sort(),
    );
  });

  test("the options go with the job, for the probe to read what it was asked for", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID],
      clouds: [
        cloudRow({
          collectionOptions: { collectPorts: true, portNetworkIds: ["n"] },
        }),
      ],
    });

    const [job] = await claim(fake.service);

    expect(job?.options).toEqual({
      collectPorts: true,
      portNetworkIds: ["n"],
      instanceSeriesMode: "automatic",
      keptProjectIds: [],
    });
  });

  test("the longest overdue first, as they were claimed, whatever order they read back in", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID, CLOUD_ID_2],
      clouds: [cloudRow({ _id: CLOUD_ID_2 }), cloudRow({ _id: CLOUD_ID })],
    });

    const jobs: Array<OpenStackCollectionJob> = await claim(fake.service);

    expect(
      jobs.map((job: OpenStackCollectionJob) => {
        return job.openStackCloudId;
      }),
    ).toEqual([CLOUD_ID, CLOUD_ID_2]);
  });

  test("a row it cannot make a job of is not handed out", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID, CLOUD_ID_2],
      clouds: [
        cloudRow({ _id: CLOUD_ID, credentialSecret: undefined }),
        cloudRow({ _id: CLOUD_ID_2, authUrl: undefined }),
      ],
    });

    await expect(claim(fake.service)).resolves.toEqual([]);
  });

  test("what a saved row is missing has a safe answer", async () => {
    const fake: FakeService = fakeService({
      claimedIds: [CLOUD_ID],
      clouds: [
        cloudRow({
          name: undefined,
          collectionRegions: undefined,
          endpointInterface: "somewhere",
          trustedCertificateFingerprints: undefined,
          collectionIntervalInMinutes: undefined,
          collectionSettingsVersion: undefined,
        }),
      ],
    });

    const [job] = await claim(fake.service);

    expect(job).toMatchObject({
      cloudName: "",
      regions: [],
      endpointInterface: "public",
      trustedCertificateFingerprints: [],
      collectionIntervalInMinutes: 2,
      settingsVersion: 0,
    });
  });
});

describe("the credential a row holds", () => {
  test.each([
    [
      "no secret",
      { credentialKind: "applicationCredential", applicationCredentialId: "a" },
    ],
    ["no kind", { applicationCredentialId: "a", credentialSecret: "s" }],
    ["an unknown kind", { credentialKind: "other", credentialSecret: "s" }],
    [
      "an application credential with no ID",
      { credentialKind: "applicationCredential", credentialSecret: "s" },
    ],
    [
      "a password with no user",
      { credentialKind: "password", projectName: "p", credentialSecret: "s" },
    ],
    [
      "a password with no project",
      {
        credentialKind: "password",
        keystoneUsername: "u",
        credentialSecret: "s",
      },
    ],
  ])(
    "%s holds none it can use",
    (_name: string, row: Record<string, string>) => {
      expect(OpenStackProbeCollectionStore.readCredential(row)).toBeNull();
    },
  );

  test("a password's domains are Default unless named", () => {
    expect(
      OpenStackProbeCollectionStore.readCredential({
        credentialKind: "password",
        keystoneUsername: "u",
        projectName: "p",
        credentialSecret: "s",
      }),
    ).toMatchObject({
      userDomainName: "Default",
      projectDomainName: "Default",
    });
  });
});

describe("the fingerprints a row holds", () => {
  test("in the one spelling, without repeats, and without what is not one", () => {
    expect(
      OpenStackProbeCollectionStore.readFingerprints([
        FINGERPRINT,
        FINGERPRINT.toLowerCase(),
        "not one",
        7,
        null,
      ]),
    ).toEqual([FINGERPRINT]);
  });

  test.each([[null], [undefined], ["x"], [{}]])(
    "%j is none",
    (value: unknown) => {
      expect(OpenStackProbeCollectionStore.readFingerprints(value)).toEqual([]);
    },
  );
});

describe("a report", () => {
  async function record(
    fake: FakeService,
    overrides: Partial<OpenStackCollectionReport> = {},
    probeId: ObjectID = PROBE_ID,
  ): Promise<OpenStackCollectionReportOutcome> {
    return await OpenStackProbeCollectionStore.recordCollectionReport(
      fake.service,
      { probeId: probeId, report: report(overrides) },
    );
  }

  test.each([[""], ["not-an-id"], ["'; DROP TABLE x; --"]])(
    "naming no cloud (%j) is not heard",
    async (openStackCloudId: string) => {
      const fake: FakeService = fakeService({});

      await expect(
        record(fake, { openStackCloudId: openStackCloudId }),
      ).resolves.toEqual({
        accepted: false,
        reason: "The report names no cloud.",
      });
    },
  );

  test.each([
    ["a cloud that does not exist", null],
    [
      "a cloud on the agent now",
      collectedCloud({ collectionMethod: OpenStackCollectionMethod.Agent }),
    ],
    ["a cloud with no probe", collectedCloud({ collectionProbeId: undefined })],
    [
      "a cloud another probe collects",
      collectedCloud({ collectionProbeId: OTHER_PROBE_ID }),
    ],
    ["a cloud with no project", collectedCloud({ projectId: undefined })],
  ])(
    "about %s is not heard",
    async (_name: string, cloud: OpenStackCollectionCloudRecord | null) => {
      const fake: FakeService = fakeService({ cloud: cloud });

      const outcome: OpenStackCollectionReportOutcome = await record(fake);

      expect(outcome.accepted).toBe(false);
      expect(outcome.reason).toContain(
        "This probe does not collect that cloud",
      );
      expect(fake.updates).toEqual([]);
    },
  );

  test("from a probe of another project is not heard: its data must not reach this cloud", async () => {
    const fake: FakeService = fakeService({
      cloud: collectedCloud({
        collectionProbe: {
          isGlobalProbe: false,
          projectId: new ObjectID("7c0e9d1a-1111-4b2c-8d3e-000000000002"),
        },
      }),
    });

    const outcome: OpenStackCollectionReportOutcome = await record(fake);

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain("another project");
    expect(fake.updates).toEqual([]);
  });

  test("an id in another case is the same probe", async () => {
    const fake: FakeService = fakeService({
      cloud: collectedCloud({
        collectionProbeId: new ObjectID(PROBE_ID.toString().toUpperCase()),
      }),
    });

    expect((await record(fake)).accepted).toBe(true);
  });

  test("that succeeded clears what went wrong before", async () => {
    const fake: FakeService = fakeService({ cloud: collectedCloud() });

    const outcome: OpenStackCollectionReportOutcome = await record(fake);

    expect(outcome).toEqual({
      accepted: true,
      projectId: PROJECT_ID,
      cloudName: "Production",
      isCurrent: true,
    });

    expect(fake.updates[0]?.id).toBe(CLOUD_ID);
    expect(fake.updates[0]?.data).toMatchObject({
      collectionStatus: OpenStackCollectionStatus.Succeeded,
      collectionErrorCode: null,
      collectionError: null,
      presentedCertificate: null,
    });
    expect(fake.updates[0]?.data["lastCollectionAt"]).toBeInstanceOf(Date);
    expect(fake.updates[0]?.data["lastSuccessfulCollectionAt"]).toBeInstanceOf(
      Date,
    );
  });

  test("that partly succeeded keeps its error, and still counts as a success", async () => {
    const fake: FakeService = fakeService({ cloud: collectedCloud() });

    await record(fake, {
      status: "PartiallySucceeded",
      errorCode: OpenStackCollectionErrorCode.ServiceOverloaded,
      errorMessage: "Networking (Neutron) in RegionOne said to wait.",
    });

    expect(fake.updates[0]?.data).toMatchObject({
      collectionStatus: OpenStackCollectionStatus.PartiallySucceeded,
      collectionErrorCode: OpenStackCollectionErrorCode.ServiceOverloaded,
      collectionError: "Networking (Neutron) in RegionOne said to wait.",
      presentedCertificate: null,
    });
    expect(fake.updates[0]?.data["lastSuccessfulCollectionAt"]).toBeInstanceOf(
      Date,
    );
  });

  test("that failed says why, and is no success", async () => {
    const fake: FakeService = fakeService({ cloud: collectedCloud() });

    await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
      errorMessage: "Keystone refused it.",
    });

    expect(fake.updates[0]?.data).toMatchObject({
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.InvalidCredential,
      collectionError: "Keystone refused it.",
    });
    expect(fake.updates[0]?.data["lastSuccessfulCollectionAt"]).toBeUndefined();
    expect(fake.updates[0]?.data["lastCollectionAt"]).toBeInstanceOf(Date);
  });

  test.each([
    OpenStackCollectionErrorCode.UntrustedCertificate,
    OpenStackCollectionErrorCode.CertificateChanged,
  ])(
    "that failed with %s keeps what it showed, to be trusted",
    async (code: OpenStackCollectionErrorCode) => {
      const fake: FakeService = fakeService({ cloud: collectedCloud() });

      await record(fake, {
        status: "Failed",
        errorCode: code,
        errorMessage: "Not trusted.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT.toLowerCase(),
          subject: "CN=keystone",
          issuer: "CN=keystone",
          isSelfSigned: true,
          host: "keystone.example.com",
          port: 5000,
        },
      });

      expect(fake.updates[0]?.data["presentedCertificate"]).toEqual({
        fingerprint256: FINGERPRINT,
        subject: "CN=keystone",
        issuer: "CN=keystone",
        isSelfSigned: true,
        host: "keystone.example.com",
        port: 5000,
      });
    },
  );

  test("a certificate with any other failure is nothing to trust", async () => {
    const fake: FakeService = fakeService({ cloud: collectedCloud() });

    await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
      presentedCertificate: {
        fingerprint256: FINGERPRINT,
        subject: "CN=keystone",
        issuer: "CN=keystone",
        isSelfSigned: true,
      },
    });

    expect(fake.updates[0]?.data["presentedCertificate"]).toBeNull();
  });

  test("a status it does not know is a failure, and a code it does not know is Internal", async () => {
    const fake: FakeService = fakeService({ cloud: collectedCloud() });

    await record(fake, {
      status: "Whatever" as OpenStackCollectionReport["status"],
      errorCode: "Whatever" as OpenStackCollectionErrorCode,
      errorMessage: "",
    });

    expect(fake.updates[0]?.data).toMatchObject({
      collectionStatus: OpenStackCollectionStatus.Failed,
      collectionErrorCode: OpenStackCollectionErrorCode.Internal,
    });
    // No sentence from the probe: the code's own title, rather than an empty box.
    expect(typeof fake.updates[0]?.data["collectionError"]).toBe("string");
    expect(
      (fake.updates[0]?.data["collectionError"] as string).length,
    ).toBeGreaterThan(0);
  });

  test("for settings that changed since delivers its data, and leaves the status to the new ones", async () => {
    const fake: FakeService = fakeService({
      cloud: collectedCloud({ collectionSettingsVersion: 5 }),
    });

    const outcome: OpenStackCollectionReportOutcome = await record(fake, {
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
      summary: {
        credentialKind: "applicationCredential",
        regionNames: [],
        services: [],
        hypervisorCount: 0,
        instanceCount: 0,
        networkCount: 0,
        volumeCount: 0,
        projectCount: 0,
        warnings: [],
      },
    });

    expect(outcome).toMatchObject({ accepted: true, isCurrent: false });
    expect(
      Object.keys(fake.updates[0]?.data as Record<string, unknown>),
    ).toEqual(["lastCollectionAt"]);
  });

  test("a cloud with no version yet is version 0", async () => {
    const fake: FakeService = fakeService({
      cloud: collectedCloud({ collectionSettingsVersion: undefined }),
    });

    expect((await record(fake, { settingsVersion: 0 })).isCurrent).toBe(true);
  });

  test("it says what it could not write, and does not swallow it", async () => {
    const fake: FakeService = fakeService({
      cloud: collectedCloud(),
      updateFails: true,
    });

    const logged: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    await expect(record(fake)).rejects.toThrow("The database is gone.");

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  test("the summary goes with it, in bounds", async () => {
    const fake: FakeService = fakeService({ cloud: collectedCloud() });

    await record(fake, {
      summary: {
        credentialKind: "applicationCredential",
        regionNames: ["RegionOne"],
        services: [],
        hypervisorCount: 2,
        instanceCount: 4,
        networkCount: 1,
        volumeCount: 0,
        projectCount: 7,
        warnings: [],
      },
    });

    expect(fake.updates[0]?.data["collectionSummary"]).toMatchObject({
      hypervisorCount: 2,
      instanceCount: 4,
      regionNames: ["RegionOne"],
    });
  });
});

describe("the interval a row holds", () => {
  test.each([
    [null, 2],
    [undefined, 2],
    [0, 2],
    [-5, 2],
    [Number.NaN, 2],
    [1, 1],
    [2, 2],
    [2.4, 2],
    [0.2, 1],
    [60, 60],
    [1000, 60],
  ])("%s reads as %s", (value: number | null | undefined, interval: number) => {
    expect(OpenStackProbeCollectionStore.getSafeInterval(value)).toBe(interval);
  });
});

describe("the claim order", () => {
  test("is the claim's, and rows it never claimed are left out", () => {
    expect(
      OpenStackProbeCollectionStore.inClaimOrder(
        [{ _id: "B" }, { _id: "a" }, { _id: "c" }, { name: "no id" }] as Array<{
          _id?: string;
        }>,
        ["A", "b", "gone"],
      ),
    ).toEqual([{ _id: "a" }, { _id: "B" }]);
  });
});

describe("the sentence kept for a failure", () => {
  test("is the probe's own", () => {
    expect(
      OpenStackProbeCollectionStore.getErrorText({
        errorCode: OpenStackCollectionErrorCode.ApiError,
        errorMessage: "  It said no.  ",
      }),
    ).toBe("It said no.");
  });

  test.each([[undefined], [""], ["   "], [7]])(
    "or the code's title, for %j",
    (errorMessage: unknown) => {
      expect(
        OpenStackProbeCollectionStore.getErrorText({
          errorCode: OpenStackCollectionErrorCode.ApiError,
          errorMessage: errorMessage,
        }),
      ).toBeTruthy();
    },
  );

  test("and fits the column", () => {
    const text: string | null = OpenStackProbeCollectionStore.getErrorText({
      errorCode: OpenStackCollectionErrorCode.ApiError,
      errorMessage: "x".repeat(ColumnLength.LongText + 100),
    });

    expect(text?.length).toBe(ColumnLength.LongText);
    expect(text?.endsWith("…")).toBe(true);
  });
});

describe("a certificate as the probe reported it", () => {
  test("is held to what the dashboard reads", () => {
    const certificate: OpenStackPresentedCertificate | null =
      OpenStackProbeCollectionStore.sanitizePresentedCertificate({
        fingerprint256: FINGERPRINT.toLowerCase().split(":").join(""),
        subject: "CN=a",
        issuer: "x".repeat(5000),
        isSelfSigned: "yes",
        validFrom: "2026-01-01",
        validTo: 7,
        subjectAltName: "DNS:a",
        verificationError: "SELF_SIGNED",
        host: "keystone.example.com",
        port: 5000,
        somethingElse: "dropped",
      });

    expect(certificate?.fingerprint256).toBe(FINGERPRINT);
    expect(certificate?.issuer.length).toBe(1000);
    expect(certificate?.isSelfSigned).toBe(false);
    expect(certificate?.validTo).toBeUndefined();
    expect(certificate).toMatchObject({
      validFrom: "2026-01-01",
      subjectAltName: "DNS:a",
      verificationError: "SELF_SIGNED",
      host: "keystone.example.com",
      port: 5000,
    });
    expect(certificate).not.toHaveProperty("somethingElse");
  });

  test.each([
    [null],
    [undefined],
    [7],
    [{}],
    [{ fingerprint256: "not one" }],
    [{ fingerprint256: 7 }],
  ])("%j has no fingerprint, and so is nothing to trust", (value: unknown) => {
    expect(
      OpenStackProbeCollectionStore.sanitizePresentedCertificate(value),
    ).toBeNull();
  });

  test.each([[0], [-1], [70000], ["x"], [1.5]])(
    "a port of %j is not one",
    (port: unknown) => {
      expect(
        OpenStackProbeCollectionStore.sanitizePresentedCertificate({
          fingerprint256: FINGERPRINT,
          port: port,
        })?.port,
      ).toBeUndefined();
    },
  );
});

describe("a summary as the probe reported it", () => {
  test("whole counts, bounded strings, bounded lists", () => {
    const summary: OpenStackCollectionSummary | null =
      OpenStackProbeCollectionStore.sanitizeSummary({
        credentialKind: "somethingElse",
        projectName: "x".repeat(1000),
        roleNames: ["admin", 7, "  "],
        regionNames: ["RegionOne"],
        hypervisorCount: 2.9,
        instanceCount: -1,
        networkCount: "x",
        volumeCount: Number.POSITIVE_INFINITY,
        projectCount: 3,
        resourceCount: 6,
        datapointCount: 100,
        requestCount: 20,
        computeMicroversions: { RegionOne: "2.87" },
        instanceReadModes: { RegionOne: "Full" },
        warnings: Array.from({ length: 100 }, (_v: unknown, i: number) => {
          return `warning ${i}`;
        }),
        services: [
          {
            service: "compute",
            regionName: "RegionOne",
            outcome: "Failed",
            errorCode: OpenStackCollectionErrorCode.ApiError,
            errorMessage: "No.",
            backingOffUntil: "2026-11-04T12:00:00.000Z",
            durationInMs: 12,
            requestCount: 3,
          },
          { service: "compute" },
          { outcome: "Failed" },
          7,
          {
            service: "network",
            outcome: "Succeeded",
            errorCode: "not a code",
            durationInMs: "x",
          },
        ],
      });

    expect(summary).toMatchObject({
      credentialKind: "applicationCredential",
      roleNames: ["admin"],
      regionNames: ["RegionOne"],
      hypervisorCount: 2,
      instanceCount: 0,
      networkCount: 0,
      volumeCount: 0,
      projectCount: 3,
      resourceCount: 6,
      datapointCount: 100,
      requestCount: 20,
      computeMicroversions: { RegionOne: "2.87" },
      instanceReadModes: { RegionOne: "Full" },
    });
    expect(summary?.projectName?.length).toBe(ColumnLength.ShortText * 2);
    expect(summary?.warnings).toHaveLength(20);

    expect(summary?.services).toEqual([
      {
        service: "compute",
        regionName: "RegionOne",
        outcome: "Failed",
        errorCode: OpenStackCollectionErrorCode.ApiError,
        errorMessage: "No.",
        backingOffUntil: "2026-11-04T12:00:00.000Z",
        durationInMs: 12,
        requestCount: 3,
      },
      {
        service: "network",
        regionName: "",
        outcome: "Succeeded",
        durationInMs: 0,
        requestCount: 0,
      },
    ]);
  });

  test("a password's kind stays", () => {
    expect(
      OpenStackProbeCollectionStore.sanitizeSummary({
        credentialKind: "password",
      })?.credentialKind,
    ).toBe("password");
  });

  test("what it can leave out stays out", () => {
    const summary: OpenStackCollectionSummary | null =
      OpenStackProbeCollectionStore.sanitizeSummary({});

    expect(summary).not.toHaveProperty("projectName");
    expect(summary).not.toHaveProperty("roleNames");
    expect(summary).not.toHaveProperty("requestCount");
    expect(summary).not.toHaveProperty("computeMicroversions");
  });

  test.each([[null], [undefined], [7], ["x"]])(
    "%j is none",
    (value: unknown) => {
      expect(OpenStackProbeCollectionStore.sanitizeSummary(value)).toBeNull();
    },
  );
});

describe("a test's summary as the probe reported it", () => {
  test("held to the same bounds", () => {
    const summary: OpenStackConnectionTestSummary | null =
      OpenStackProbeCollectionStore.sanitizeTestSummary({
        credentialKind: "password",
        projectName: "monitoring",
        roleNames: ["reader"],
        hasAccessRules: true,
        isUnrestricted: "yes",
        canProbablyWrite: false,
        regionsInCatalog: ["RegionOne"],
        servicesByRegion: { RegionOne: ["compute", 7] },
        accessLevel: "ProjectView",
        warnings: ["a warning"],
        reads: [
          {
            regionName: "RegionOne",
            service: "compute",
            read: "services",
            access: "Refused",
            reason: "HTTP 403",
            goesWithout: "the Services page.",
            fix: "x".repeat(5000),
          },
          7,
          { service: "network" },
        ],
      });

    expect(summary).toMatchObject({
      credentialKind: "password",
      projectName: "monitoring",
      roleNames: ["reader"],
      hasAccessRules: true,
      isUnrestricted: false,
      canProbablyWrite: false,
      regionsInCatalog: ["RegionOne"],
      servicesByRegion: { RegionOne: ["compute"] },
      accessLevel: "ProjectView",
      warnings: ["a warning"],
    });

    expect(summary?.reads).toHaveLength(2);
    expect(summary?.reads[0]?.fix?.length).toBe(1000);
    expect(summary?.reads[1]).toMatchObject({
      service: "network",
      read: "",
      access: "Failing",
    });
  });

  test("a level it does not say is Other", () => {
    expect(
      OpenStackProbeCollectionStore.sanitizeTestSummary({})?.accessLevel,
    ).toBe("Other");
  });

  test.each([[null], [undefined], [7]])("%j is none", (value: unknown) => {
    expect(OpenStackProbeCollectionStore.sanitizeTestSummary(value)).toBeNull();
  });
});
